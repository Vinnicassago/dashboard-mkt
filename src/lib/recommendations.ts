import type { DashboardData } from "./types";
import {
  aggregatePostPerformance,
  awarenessKpis,
  bucketOfAd,
  filterAds,
  formatPerformance,
  postPerformance,
  inRange,
  postingCadence,
  previousRange,
  type DateRange,
} from "./metrics";
import { isAwareness } from "./brands";
// A régua editorial mora no playbook (o guia como código) — nunca hardcode aqui.
import {
  DM_MAX_SHARE,
  PILARES_PROIBIDOS,
  REEL,
  ROTINA_DIARIA,
  WEEKLY_MIX,
  hasPlaybook,
} from "./content/playbook";
import { presenceRoutine } from "./content/outcomes";
import {
  formatCompact,
  formatCurrency,
  formatCurrency0,
  formatDateShort,
  formatDecimal,
  formatInt,
  formatPercent,
} from "./format";

/**
 * Ações de CONTEÚDO e de crescimento — o que sobrou do motor v1.
 *
 * O funil pago (gente parada, CPL, custo por reunião, fadiga, conjuntos, ritmo)
 * mora no motor v2 (`lib/motor.ts`), com regra, dono, amostra, impacto e estado
 * por semana. Aqui ficam as regras de conteúdo orgânico (cadência, formato,
 * CTA, grade), que aparecem em Conteúdo — e, para a marca de awareness, as de
 * crescimento de perfil, que são o funil dela. Puro.
 */

export type Severity = "agora" | "alta" | "media" | "baixa";

export interface Recommendation {
  id: string;
  severity: Severity;
  title: string; // a AÇÃO (verbo)
  detail: string; // porquê + número
  /** Para onde a ação leva. Sem destino, "ação" é só texto. */
  href?: string;
  /** Quem executa: marketing, comercial ou o robô. */
  dono?: "MKT" | "COM" | "BOT";
  /** Mídia já paga presa atrás desta ação — desempata a ordem. */
  midiaParada?: number;
}

const ORDER: Record<Severity, number> = { agora: -1, alta: 0, media: 1, baixa: 2 };

export function buildRecommendations(
  data: DashboardData,
  range: DateRange | undefined,
  nowIso: string,
): Recommendation[] {
  // Marca de awareness (só seguidores): ações de crescimento, não de CPR/CPL.
  if (isAwareness(data.campaign.brand)) return buildAwarenessRecommendations(data, range, nowIso);
  return buildOrganicContentRecommendations(data, range, nowIso)
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || (b.midiaParada ?? 0) - (a.midiaParada ?? 0))
    .slice(0, 6);
}

/**
 * Alertas de CONTEÚDO orgânico derivados do diagnóstico do perfil: retenção,
 * cadência, CTA e formato. Compartilhados pelas duas marcas — são regras sobre
 * a grade, não sobre o funil pago.
 */
function buildOrganicContentRecommendations(
  data: DashboardData,
  range: DateRange | undefined,
  nowIso: string,
): Recommendation[] {
  const recs: Recommendation[] = [];
  // SEM early-return com posts vazio: o alerta de cadência usa o histórico
  // completo e precisa disparar justamente quando a janela está sem posts
  // (grade parada), e o de objetivo de campanha nem depende de posts.
  // Mesmo universo orgânico da página Posts: sem testes nem impulsionados.
  const posts = postPerformance(data.igPosts, range, undefined, data.creatives).filter(
    (p) => !p.isTest && !p.boosted,
  );
  const agg = aggregatePostPerformance(posts);

  // 1. Sem publicar há dias (alta com 5+): a base só esquenta com cadência.
  const cadence = postingCadence(data.igPosts, undefined, nowIso);
  // Canibalização é lida DENTRO do período selecionado (alerta 6).
  const cadenceInRange = range ? postingCadence(data.igPosts, range, nowIso) : cadence;
  if (cadence.daysSinceLast >= 3) {
    recs.push({
      id: "no-recent-post",
      severity: cadence.daysSinceLast >= 5 ? "alta" : "media",
      title: "Publique hoje — a grade parou",
      detail: `${formatInt(cadence.daysSinceLast)} dias sem post novo. Sem cadência o algoritmo esfria a entrega; retome com um reel curto (≤25s) de gancho forte.`,
    });
  }

  // 2. Retenção de reels caindo vs período anterior (média).
  if (range) {
    const prevAgg = aggregatePostPerformance(
      postPerformance(data.igPosts, previousRange(range), undefined, data.creatives),
    );
    const cur = agg.avgRetention ?? null;
    const prev = prevAgg.avgRetention ?? null;
    if (cur != null && prev != null && prev > 0 && cur < prev * 0.85) {
      recs.push({
        id: "retention-drop",
        severity: "media",
        title: "Retenção dos reels caindo",
        detail: `Retenção média ${formatPercent(cur)} vs ${formatPercent(prev)} no período anterior. Revise o gancho dos primeiros 2 segundos — entre direto no número ou na afirmação polêmica.`,
      });
    } else if (cur == null || prev == null) {
      const curW = agg.avgWatchTime ?? null;
      const prevW = prevAgg.avgWatchTime ?? null;
      if (curW != null && prevW != null && prevW > 0 && curW < prevW * 0.85) {
        recs.push({
          id: "retention-drop",
          severity: "media",
          title: "Tempo assistido dos reels caindo",
          detail: `Tempo médio assistido caiu vs o período anterior. Preencha a duração dos reels em Ajustes para acompanhar a retenção % real (meta: 40%).`,
        });
      }
    }
  }

  // 3. Reels longos demais. O guia separa dois patamares: acima de 25s sai do
  //    padrão (aviso); acima de 30s é "Nunca mais" (alta) até a retenção subir.
  const overSoft = posts.filter(
    (p) => p.type === "reel" && p.durationSec != null && p.durationSec > REEL.maxDurationSec,
  );
  const overHard = overSoft.filter((p) => (p.durationSec ?? 0) > REEL.hardMaxDurationSec);
  if (overSoft.length > 0) {
    const maxDur = Math.max(...overSoft.map((p) => p.durationSec ?? 0));
    recs.push({
      id: "reels-too-long",
      severity: overHard.length > 0 ? "alta" : "media",
      title: `Encurte os reels para até ${REEL.maxDurationSec}s`,
      detail:
        overHard.length > 0
          ? `${formatInt(overHard.length)} reel(s) acima de ${REEL.hardMaxDurationSec}s (maior: ${formatInt(maxDur)}s) — é o limite que o guia proíbe. Formato longo só quando a retenção média passar de 40%.`
          : `${formatInt(overSoft.length)} reel(s) do período acima de ${REEL.maxDurationSec}s (maior: ${formatInt(maxDur)}s). Corte a introdução e entre direto no conflito.`,
    });
  }

  // 4. CTA de DM em excesso (média): pedir DM em tudo mata comentário/salvamento.
  if (posts.length >= 4 && agg.dmCtaShare > DM_MAX_SHARE) {
    recs.push({
      id: "cta-dm-excess",
      severity: "media",
      title: "Racione o CTA de DM (máx. 1 a cada 4 posts)",
      detail: `${formatPercent(agg.dmCtaShare)} dos posts pedem DM — o CTA de maior atrito. Troque por "salva pra decidir depois", pergunta nos comentários ou marcação; são esses os sinais que o algoritmo premia.`,
    });
  }

  // 5. Card de frase na grade (baixa): pior formato do perfil, com folga.
  const frasePosts = posts.filter((p) => p.pillar && PILARES_PROIBIDOS.test(p.pillar));
  if (frasePosts.length > 0) {
    recs.push({
      id: "pillar-frase",
      severity: "baixa",
      title: "Tire os cards de frase da grade",
      detail: `${formatInt(frasePosts.length)} post(s) de frase/motivacional no período. É o formato de pior desempenho do diagnóstico — substitua por carrossel de método ou prova social.`,
    });
  }

  // 6. Canibalização (média): o guia é literal — "nunca 2 peças no mesmo dia".
  if (cadenceInRange.maxSameDay >= 2) {
    recs.push({
      id: "same-day-pileup",
      severity: "media",
      title: "Espace as publicações (1 por dia)",
      detail: `${formatInt(cadenceInRange.daysWithPileup)} dia(s) com 2+ peças (pico de ${formatInt(cadenceInRange.maxSameDay)} em ${cadenceInRange.busiestDay ? formatDateShort(cadenceInRange.busiestDay) : "um mesmo dia"}) — elas disputam a mesma janela de teste do algoritmo e canibalizam a entrega inicial.`,
    });
  }

  // 6b. Composição da grade (baixa): o guia pede 4 reels + 2 carrosséis/semana.
  //     Só cobra quando há janela suficiente para a média significar algo.
  if (cadenceInRange.days >= 7 && cadenceInRange.count > 0) {
    const faltamReels = WEEKLY_MIX.reels - cadenceInRange.reelsPerWeek;
    const faltamCarros = WEEKLY_MIX.carrosseis - cadenceInRange.carrosseisPerWeek;
    if (faltamReels >= 1 || faltamCarros >= 1) {
      const partes: string[] = [];
      if (faltamReels >= 1)
        partes.push(`${formatDecimal(cadenceInRange.reelsPerWeek, 1)} reels/semana (meta ${WEEKLY_MIX.reels})`);
      if (faltamCarros >= 1)
        partes.push(`${formatDecimal(cadenceInRange.carrosseisPerWeek, 1)} carrosséis/semana (meta ${WEEKLY_MIX.carrosseis})`);
      recs.push({
        id: "grade-composicao",
        severity: "baixa",
        title: "Complete a grade da semana",
        detail: `${partes.join(" · ")}. A grade do guia é 4 reels + 2 carrosséis — é ela que cria hábito e expectativa na base.`,
      });
    }
  }

  // 6c. Rotina de presença (média): "dia útil sem story" é um "Nunca mais", e a
  //     rotina é o que aquece a base entre um post e outro. Só cobra quando há
  //     registro — sem dado, o alerta seria sobre a ausência de anotação.
  const rotina = presenceRoutine(data.igAccountDaily.filter((r) => inRange(r.date, range)));
  if (rotina.temDados && rotina.diasUteisSemStory > 0) {
    recs.push({
      id: "dias-sem-story",
      severity: "media",
      title: "Publique stories todo dia útil",
      detail: `${formatInt(rotina.diasUteisSemStory)} dia(s) útil(eis) sem nenhum story (de ${formatInt(rotina.diasUteis)} registrados). O guia pede ${ROTINA_DIARIA.storiesMin}–${ROTINA_DIARIA.storiesMax} por dia, com ao menos 1 interativo — é o que mantém a base quente entre um post e outro.`,
    });
  }

  // 7. Descoberta otimizada para views/alcance amplo (média): compra número de
  // vaidade e esfria a base — o diagnóstico manda mudar o objetivo.
  const VANITY = /OUTCOME_AWARENESS|VIDEO_VIEWS|REACH|BRAND_AWARENESS|THRUPLAY|IMPRESSIONS/;
  const vanityAds = filterAds(data.adDaily, range).filter(
    (r) => r.spend > 0 && bucketOfAd(r) === "descoberta" && r.objective && VANITY.test(r.objective.toUpperCase()),
  );
  const vanitySpend = vanityAds.reduce((s, r) => s + r.spend, 0);
  if (vanitySpend > 0) {
    // Nomeia o conjunto: "a campanha de descoberta" não diz qual mudar no Ads Manager.
    const conjuntos = [...new Set(vanityAds.map((r) => r.adset || r.campaign).filter(Boolean))];
    recs.push({
      id: "vanity-objective",
      severity: "media",
      title:
        conjuntos.length === 1
          ? `Mude o objetivo de "${conjuntos[0]}"`
          : `Mude o objetivo de ${conjuntos.length} conjuntos de descoberta`,
      detail: `${formatCurrency0(vanitySpend)} rodando otimizado para views/alcance amplo — isso compra visualização de quem nunca vai engajar. Prefira engajamento com público restrito (interesse + região + renda) ou mensagens.`,
    });
  }

  // Toda ação de conteúdo e de verba de descoberta é do marketing e leva ao
  // lugar onde se age: ação sem dono e sem destino é só texto.
  const producao = hasPlaybook(data.campaign.brand) ? "/conteudo/producao" : "/conteudo/posts";
  const DESTINO: Record<string, string> = {
    "no-recent-post": producao,
    "same-day-pileup": producao,
    "grade-composicao": producao,
    "dias-sem-story": producao,
    "pillar-frase": producao,
    "vanity-objective": "/dinheiro#conjuntos",
  };
  return recs.map((r) => ({
    ...r,
    dono: r.dono ?? "MKT",
    href: r.href ?? DESTINO[r.id] ?? "/conteudo/posts",
  }));
}

/**
 * Próximas ações para uma marca de awareness (krone.capital): a alavanca é
 * crescimento de seguidores / descoberta, não CPR. Puro — recebe os dados já
 * recortados pela marca.
 */
function buildAwarenessRecommendations(
  data: DashboardData,
  range: DateRange | undefined,
  nowIso: string,
): Recommendation[] {
  const recs: Recommendation[] = [];
  const a = awarenessKpis(data, range);

  // 1. Gastou e não cresceu (alta) — o maior alarme de uma campanha de seguidores.
  if (a.spend > 0 && a.netNewFollowers <= 0) {
    recs.push({
      id: "no-growth",
      severity: "alta",
      title: "Investiu e não ganhou seguidores no período",
      detail: `${formatCurrency0(a.spend)} gastos sem crescimento líquido de seguidores. Revise segmentação e o gancho do criativo — o conteúdo não está convertendo alcance em follow.`,
    });
  }

  // 2. Pouca descoberta (média) — alcance preso em quem já segue.
  if (a.hasReachSplit && a.reach > 0 && a.discoveryRate < 0.35) {
    recs.push({
      id: "discovery-low",
      severity: "media",
      title: "Pouca descoberta de novos perfis",
      detail: `Só ${formatPercent(a.discoveryRate)} do alcance foi de não-seguidores. Priorize Reels e conteúdo compartilhável (saves/compartilhamentos) para alcançar gente nova.`,
    });
  }

  // 3. Dobre a aposta no formato de maior engajamento (média).
  const formats = formatPerformance(data.igPosts, range);
  if (formats.length >= 2 && formats[0].count >= 2) {
    const best = formats[0];
    recs.push({
      id: "format-double-down",
      severity: "media",
      title: `Invista em ${best.label}`,
      detail: `É o formato de maior engajamento (${formatPercent(best.avgEngagement)}, alcance médio ${formatCompact(best.avgReach)}). Aumente a frequência desse formato.`,
    });
  }

  // 4. Custo por seguidor como referência (baixa), quando há investimento.
  if (a.costPerFollower != null && a.spend > 0) {
    recs.push({
      id: "cost-per-follower",
      severity: "baixa",
      title: "Acompanhe o custo por seguidor",
      detail: `Custo por seguidor no período: ${formatCurrency(a.costPerFollower)} (${formatInt(a.netNewFollowers)} seguidores por ${formatCurrency0(a.spend)}). Use como referência para comparar criativos e segmentações.`,
    });
  }

  recs.push(...buildOrganicContentRecommendations(data, range, nowIso));
  // Dentro da mesma severidade, mais dinheiro parado vem primeiro.
  return recs
    .sort(
      (a, b) =>
        ORDER[a.severity] - ORDER[b.severity] || (b.midiaParada ?? 0) - (a.midiaParada ?? 0),
    )
    .slice(0, 6);
}
