import type { DashboardData, PostDraft } from "./types";
import {
  aggregatePostPerformance,
  awarenessKpis,
  bucketOfAd,
  filterAds,
  formatPerformance,
  postPerformance,
  postingCadence,
  previousRange,
  type DateRange,
} from "./metrics";
import { isAwareness } from "./brands";
import { hojeEmBrasilia } from "./range";
// A régua editorial mora no playbook (o guia como código) — nunca hardcode aqui.
import {
  DM_MAX_SHARE,
  PILARES_PROIBIDOS,
  REEL,
  WEEKLY_MIX,
  hasPlaybook,
} from "./content/playbook";
import { gradeDaSemana } from "./content/outcomes";
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
 * CTA, grade), que aparecem em Conteúdo (até 2, `acoesDaGrade`) e, para a marca
 * de awareness, no Início dela; a IA recebe a lista inteira. Para a marca de
 * awareness, também as de crescimento de perfil, que são o funil dela. Puro.
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
  /** A ação em UMA linha, com o verbo e o número (≤ 10 palavras) — a que a tela do Conteúdo mostra (o `detail` vai para o ⓘ). Só nas regras de `IDS_DE_CONTEUDO`. */
  linha?: string;
}

/** As regras de CONTEÚDO orgânico que a tela do Conteúdo mostra (`acoesDaGrade`): cadência, grade da semana e formato. `grade-composicao` (média do período) fica de fora: continua na lista da IA. */
export const IDS_DE_CONTEUDO = [
  "no-recent-post",
  "retention-drop",
  "reels-too-long",
  "cta-dm-excess",
  "pillar-frase",
  "same-day-pileup",
  "grade-da-semana",
] as const;

const ORDER: Record<Severity, number> = { agora: -1, alta: 0, media: 1, baixa: 2 };

/**
 * `drafts` (as peças da Produção; opcional) entram SÓ na grade da semana
 * (`grade-da-semana`): um dia de feed com peça planejada não está vazio.
 */
export function buildRecommendations(
  data: DashboardData,
  range: DateRange | undefined,
  nowIso: string,
  drafts: PostDraft[] = [],
): Recommendation[] {
  // Marca de awareness (só seguidores): ações de crescimento, não de CPR/CPL.
  if (isAwareness(data.campaign.brand)) return buildAwarenessRecommendations(data, range, nowIso, drafts);
  return buildOrganicContentRecommendations(data, range, nowIso, drafts)
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
  drafts: PostDraft[] = [],
): Recommendation[] {
  const recs: Recommendation[] = [];
  // SEM early-return com posts vazio: o alerta de cadência usa o histórico
  // completo e a grade da semana lê a semana corrente — os dois precisam
  // disparar justamente quando a janela está sem posts (grade parada).
  // Mesmo universo orgânico do placar do Conteúdo: sem testes nem impulsionados.
  const posts = postPerformance(data.igPosts, range, undefined, data.creatives).filter(
    (p) => !p.isTest && !p.boosted,
  );
  const agg = aggregatePostPerformance(posts);

  // 1. Sem publicar há dias (alta com 5+): a base só esquenta com cadência.
  // Mesma grade dos agregados: sem testes nem impulsionados (Fase 6.5).
  const cadence = postingCadence(data.igPosts, undefined, nowIso, data.creatives);
  // Canibalização é lida DENTRO do período selecionado (alerta 6).
  const cadenceInRange = range ? postingCadence(data.igPosts, range, nowIso, data.creatives) : cadence;
  // null = nunca houve post da grade: não é "a grade parou" (não há grade).
  const diasSemPost = cadence.daysSinceLast;
  if (diasSemPost !== null && diasSemPost >= 3) {
    recs.push({
      id: "no-recent-post",
      severity: diasSemPost >= 5 ? "alta" : "media",
      title: "Publique hoje — a grade parou",
      linha: `Publique hoje: ${formatInt(diasSemPost)} dias sem post da grade`,
      detail: `${formatInt(diasSemPost)} dias sem post novo. Sem cadência o algoritmo esfria a entrega; retome com um reel curto (≤25s) de gancho forte.`,
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
        linha: `Revise o gancho dos reels: retenção ${formatPercent(cur)} contra ${formatPercent(prev)}`,
        detail: `Retenção média ${formatPercent(cur)} vs ${formatPercent(prev)} no período anterior. Revise o gancho dos primeiros 2 segundos — entre direto no número ou na afirmação polêmica.`,
      });
    } else if (cur == null || prev == null) {
      const curW = agg.avgWatchTime ?? null;
      const prevW = prevAgg.avgWatchTime ?? null;
      if (curW != null && prevW != null && prevW > 0 && curW < prevW * 0.85) {
        const curTxt = formatDecimal(curW, 1);
        const prevTxt = formatDecimal(prevW, 1);
        recs.push({
          id: "retention-drop",
          severity: "media",
          title: "Tempo assistido dos reels caindo",
          linha: `Revise o gancho: reels com ${curTxt} s contra ${prevTxt} s`,
          detail: `Tempo médio assistido: ${curTxt} s contra ${prevTxt} s no período anterior. Preencha a duração dos reels em Conteúdo → Registros para acompanhar a retenção % real (meta: 40%).`,
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
      linha:
        overHard.length > 0
          ? `Encurte os reels: ${formatInt(overHard.length)} acima de ${REEL.hardMaxDurationSec}s`
          : `Encurte os reels: ${formatInt(overSoft.length)} acima de ${REEL.maxDurationSec}s`,
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
      linha: `Peça menos DM: ${formatPercent(agg.dmCtaShare)} dos posts pedem DM`,
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
      linha: `Tire os cards de frase: ${formatInt(frasePosts.length)} no período`,
      detail: `${formatInt(frasePosts.length)} post(s) de frase/motivacional no período. É o formato de pior desempenho do diagnóstico — substitua por carrossel de método ou prova social.`,
    });
  }

  // 6. Canibalização (média): o guia é literal — "nunca 2 peças no mesmo dia".
  if (cadenceInRange.maxSameDay >= 2) {
    recs.push({
      id: "same-day-pileup",
      severity: "media",
      title: "Espace as publicações (1 por dia)",
      linha:
        cadenceInRange.daysWithPileup >= 2
          ? `Espace os posts: ${formatInt(cadenceInRange.daysWithPileup)} dias com 2 ou mais`
          : `Espace os posts: ${formatInt(cadenceInRange.maxSameDay)} no mesmo dia, em ${cadenceInRange.busiestDay ? formatDateShort(cadenceInRange.busiestDay) : "um dia"}`,
      detail: `${formatInt(cadenceInRange.daysWithPileup)} dia(s) com 2+ peças (pico de ${formatInt(cadenceInRange.maxSameDay)} em ${cadenceInRange.busiestDay ? formatDateShort(cadenceInRange.busiestDay) : "um mesmo dia"}) — elas disputam a mesma janela de teste do algoritmo e canibalizam a entrega inicial.`,
    });
  }

  // 6a. A grade da SEMANA CORRENTE (média): um dia de feed antes de hoje ficou sem
  //     post nem peça planejada. É o AGORA (não depende do período do seletor) e lê
  //     a MESMA função da Produção (`gradeDaSemana`): "{p} de {s}" é o "{p}/{s}
  //     slots com peça" de lá. Só com o guia (playbook) da marca.
  if (hasPlaybook(data.campaign.brand)) {
    const g = gradeDaSemana(data.igPosts, drafts, hojeEmBrasilia(new Date(nowIso)));
    if (g.vaziosAntesDeHoje.length > 0) {
      const vazios = g.vaziosAntesDeHoje.map(formatDateShort);
      const listaDeVazios =
        vazios.length === 1 ? vazios[0] : `${vazios.slice(0, -1).join(", ")} e ${vazios.at(-1)}`;
      const frases = [
        `Semana de ${formatDateShort(g.inicio)} a ${formatDateShort(g.fim)}: ${listaDeVazios} sem peça publicada nem planejada.`,
      ];
      if (cadenceInRange.days >= 7 && cadenceInRange.count > 0) {
        frases.push(
          `No período: ${formatDecimal(cadenceInRange.reelsPerWeek, 1)} reels e ${formatDecimal(cadenceInRange.carrosseisPerWeek, 1)} carrosséis por semana; o guia pede ${WEEKLY_MIX.reels} e ${WEEKLY_MIX.carrosseis}.`,
        );
      }
      frases.push("É a grade que cria hábito e expectativa na base.");
      recs.push({
        id: "grade-da-semana",
        severity: "media",
        title: "Complete a grade da semana",
        linha: `Complete a grade da semana: ${formatInt(g.preenchidos)} de ${formatInt(g.slotsDeFeed)} com peça`,
        detail: frases.join(" "),
      });
    }
  }

  // 6b. Composição da grade (baixa): o guia pede 4 reels + 2 carrosséis/semana.
  //     Só cobra quando há janela suficiente para a média significar algo. É a
  //     MÉDIA do período: fica na lista da IA, fora da tela do Conteúdo.
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
        title: "Equilibre os formatos da grade",
        detail: `${partes.join(" · ")}. A grade do guia é 4 reels + 2 carrosséis — é ela que cria hábito e expectativa na base.`,
      });
    }
  }

  // Toda ação de conteúdo é do marketing e leva ao lugar onde se age: ação sem
  // dono e sem destino é só texto. Com o guia, é a Produção (onde se planeja a
  // peça); sem ele, o Conteúdo.
  const producao = hasPlaybook(data.campaign.brand) ? "/conteudo/producao" : "/conteudo";
  const DESTINO: Record<string, string> = {
    ...Object.fromEntries(IDS_DE_CONTEUDO.map((id) => [id, producao])),
    "grade-composicao": producao,
  };
  return recs.map((r) => ({
    ...r,
    dono: r.dono ?? "MKT",
    href: r.href ?? DESTINO[r.id] ?? producao,
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
  drafts: PostDraft[] = [],
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

  recs.push(...buildOrganicContentRecommendations(data, range, nowIso, drafts));

  // 5. Descoberta otimizada para views/alcance amplo (média): compra número de
  // vaidade e esfria a base — o diagnóstico manda mudar o objetivo. Só na marca
  // de awareness (descoberta é o funil dela); na de conversão é verba de mídia,
  // não ação de grade (Fase 5 de nov/26). Depois das de conteúdo: a mesma ordem
  // de antes no Início dela.
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
      href: "/midia#conjuntos",
      dono: "MKT",
    });
  }

  // Dentro da mesma severidade, mais dinheiro parado vem primeiro.
  return recs
    .sort(
      (a, b) =>
        ORDER[a.severity] - ORDER[b.severity] || (b.midiaParada ?? 0) - (a.midiaParada ?? 0),
    )
    .slice(0, 6);
}
