import type { DashboardData } from "./types";
import {
  adsetPerformance,
  aggregatePostPerformance,
  awarenessKpis,
  bucketOfAd,
  campaignPacing,
  creativePerformance,
  filterAds,
  formatPerformance,
  overviewKpis,
  postPerformance,
  postingCadence,
  previousRange,
  type DateRange,
} from "./metrics";
import { isAwareness } from "./brands";
import { formatCompact, formatCurrency, formatCurrency0, formatInt, formatPercent } from "./format";

/**
 * Motor de "Próximas ações": transforma os números em decisões priorizadas
 * (escalar, pausar, realocar, ajustar ritmo). Puro — recebe os dados e a hora
 * (nowIso) e devolve uma lista ordenada por severidade. É o núcleo da bússola.
 */

export type Severity = "alta" | "media" | "baixa";

export interface Recommendation {
  id: string;
  severity: Severity;
  title: string; // a AÇÃO (verbo)
  detail: string; // porquê + número
}

const ORDER: Record<Severity, number> = { alta: 0, media: 1, baixa: 2 };

export function buildRecommendations(
  data: DashboardData,
  range: DateRange | undefined,
  nowIso: string,
): Recommendation[] {
  // Marca de awareness (só seguidores): ações de crescimento, não de CPR/CPL.
  if (isAwareness(data.campaign.brand)) return buildAwarenessRecommendations(data, range, nowIso);

  const recs: Recommendation[] = [];
  const k = overviewKpis(data, range);
  const creatives = creativePerformance(data, range);
  const convAdsets = adsetPerformance(data, range).filter((a) => a.bucket === "conversao");
  const goalCpl = data.goals.find((g) => g.metric === "cpl")?.target;
  const goalCpr = data.goals.find((g) => g.metric === "cpr")?.target;

  // 1. Criativos fadigando (alta) — o maior ralo de verba.
  const fatigued = creatives
    .filter((c) => c.fatigue.level === "fadigado" && c.spend > 0)
    .sort((a, b) => b.spend - a.spend);
  for (const c of fatigued.slice(0, 2)) {
    recs.push({
      id: `fatigue-${c.adId}`,
      severity: "alta",
      title: `Renove ou pause "${c.name}"`,
      detail: `Fadigando (${c.fatigue.reason}). CPL ${formatCurrency(c.cpl)}${c.meetings ? ` · CPR ${formatCurrency(c.cpr)}` : ""}. Suba uma variação nova antes do custo disparar.`,
    });
  }

  // 2. CPR/CPL acima da meta (alta).
  if (goalCpr && k.meetings > 0 && k.cpr > goalCpr) {
    recs.push({
      id: "cpr-over",
      severity: "alta",
      title: "Custo por reunião acima da meta",
      detail: `CPR ${formatCurrency(k.cpr)} vs meta ${formatCurrency0(goalCpr)}. Pause os conjuntos de pior CPR e concentre no que agenda barato.`,
    });
  } else if (goalCpl && k.leads > 0 && k.cpl > goalCpl) {
    recs.push({
      id: "cpl-over",
      severity: "alta",
      title: "CPL acima da meta",
      detail: `CPL ${formatCurrency(k.cpl)} vs meta ${formatCurrency0(goalCpl)}. Corte os criativos mais caros e realoque para os vencedores.`,
    });
  }

  // 3. Realocar budget entre conjuntos por CPR (média).
  const withCpr = convAdsets.filter((a) => a.meetings > 0 && a.spend > 0);
  if (withCpr.length >= 2) {
    const best = withCpr.reduce((m, a) => (a.cpr < m.cpr ? a : m));
    const worst = withCpr.reduce((m, a) => (a.cpr > m.cpr ? a : m));
    if (worst.adset !== best.adset && worst.cpr > best.cpr * 1.5) {
      recs.push({
        id: "realloc",
        severity: "media",
        title: `Realoque budget para "${best.adset}"`,
        detail: `"${worst.adset}" tem CPR ${formatCurrency(worst.cpr)} (${(worst.cpr / best.cpr).toFixed(1)}× o de "${best.adset}", ${formatCurrency(best.cpr)}). Mova aos poucos — 10–20% a cada 2–3 dias, para não resetar o aprendizado.`,
      });
    }
  }

  // 4. Escalar o vencedor por CPR, com amostra mínima e sem estar fadigado (média).
  const winner = creatives
    .filter((c) => c.meetings >= 2 && c.spend > 0 && c.fatigue.level !== "fadigado")
    .sort((a, b) => a.cpr - b.cpr)[0];
  if (winner) {
    recs.push({
      id: `scale-${winner.adId}`,
      severity: "media",
      title: `Escale "${winner.name}"`,
      detail: `Melhor CPR ${formatCurrency(winner.cpr)} com ${winner.meetings} reuniões e ${formatInt(winner.leads)} leads. Aumente o budget 10–20% e observe 48–72h.`,
    });
  }

  // 5. Ritmo de gasto (média).
  const pacing = campaignPacing(data, nowIso);
  if (pacing.status === "over" && pacing.projectedSpend) {
    recs.push({
      id: "pace-over",
      severity: "media",
      title: "Ritmo de gasto acima do orçamento",
      detail: `No ritmo atual, gasto projetado ${formatCurrency0(pacing.projectedSpend)} vs orçamento ${formatCurrency0(pacing.budget)}. Reduza o budget diário para não estourar antes do fim.`,
    });
  } else if (pacing.status === "sub" && pacing.projectedSpend && pacing.budget > 0) {
    recs.push({
      id: "pace-sub",
      severity: "baixa",
      title: "Sobrando orçamento no ritmo atual",
      detail: `Gasto projetado ${formatCurrency0(pacing.projectedSpend)} de ${formatCurrency0(pacing.budget)}. Há espaço para escalar os vencedores sem estourar.`,
    });
  }

  recs.push(...buildOrganicContentRecommendations(data, range, nowIso));
  return recs.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]).slice(0, 6);
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
  const posts = postPerformance(data.igPosts, range);
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
    const prevAgg = aggregatePostPerformance(postPerformance(data.igPosts, previousRange(range)));
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
          detail: `Tempo médio assistido caiu vs o período anterior. Preencha a duração dos reels no Config para acompanhar a retenção % real (meta: 40%).`,
        });
      }
    }
  }

  // 3. Reels longos demais (média): o diagnóstico pede ≤25s até a retenção subir.
  const longReels = posts.filter(
    (p) => p.type === "reel" && p.durationSec != null && p.durationSec > 30,
  );
  if (longReels.length > 0) {
    const maxDur = Math.max(...longReels.map((p) => p.durationSec ?? 0));
    recs.push({
      id: "reels-too-long",
      severity: "media",
      title: "Encurte os reels para até 25s",
      detail: `${formatInt(longReels.length)} reel(s) do período acima de 30s (maior: ${formatInt(maxDur)}s). Nos seus dados, reels curtos retêm ~2× mais — corte a introdução e entre direto no conflito.`,
    });
  }

  // 4. CTA de DM em excesso (média): pedir DM em tudo mata comentário/salvamento.
  if (posts.length >= 4 && agg.dmCtaShare > 0.25) {
    recs.push({
      id: "cta-dm-excess",
      severity: "media",
      title: "Racione o CTA de DM (máx. 1 a cada 4 posts)",
      detail: `${formatPercent(agg.dmCtaShare)} dos posts pedem DM — o CTA de maior atrito. Troque por "salva pra decidir depois", pergunta nos comentários ou marcação; são esses os sinais que o algoritmo premia.`,
    });
  }

  // 5. Card de frase na grade (baixa): pior formato do perfil, com folga.
  const frasePosts = posts.filter((p) => p.pillar && /frase|motivacional/i.test(p.pillar));
  if (frasePosts.length > 0) {
    recs.push({
      id: "pillar-frase",
      severity: "baixa",
      title: "Tire os cards de frase da grade",
      detail: `${formatInt(frasePosts.length)} post(s) de frase/motivacional no período. É o formato de pior desempenho do diagnóstico — substitua por carrossel de método ou prova social.`,
    });
  }

  // 6. Canibalização (baixa): várias peças no mesmo dia competem entre si.
  if (cadenceInRange.maxSameDay >= 3) {
    recs.push({
      id: "same-day-pileup",
      severity: "baixa",
      title: "Espace as publicações (1 por dia)",
      detail: `${formatInt(cadenceInRange.maxSameDay)} posts num mesmo dia — eles disputam a mesma janela de teste do algoritmo e canibalizam a entrega inicial.`,
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
    recs.push({
      id: "vanity-objective",
      severity: "media",
      title: "Mude o objetivo da campanha de descoberta",
      detail: `${formatCurrency0(vanitySpend)} rodando otimizado para views/alcance amplo — isso compra visualização de quem nunca vai engajar. Prefira engajamento com público restrito (interesse + região + renda) ou mensagens.`,
    });
  }

  return recs;
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
  return recs.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]).slice(0, 6);
}
