import type { DashboardData } from "./types";
import {
  adsetPerformance,
  campaignPacing,
  creativePerformance,
  overviewKpis,
  type DateRange,
} from "./metrics";
import { formatCurrency, formatCurrency0, formatInt } from "./format";

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

  return recs.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]).slice(0, 6);
}
