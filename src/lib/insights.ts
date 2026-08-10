import type { DashboardData } from "./types";
import {
  awarenessKpis,
  creativePerformance,
  overviewKpis,
  type DateRange,
} from "./metrics";
import { isAwareness } from "./brands";
import {
  formatCompact,
  formatCurrency,
  formatCurrency0,
  formatInt,
  formatPercent,
} from "./format";

/** A few short, data-grounded insights for the overview. */
export function buildInsights(data: DashboardData, range?: DateRange): string[] {
  // Marca de awareness (só seguidores) não tem funil de lead — insights próprios.
  if (isAwareness(data.campaign.brand)) return buildAwarenessInsights(data, range);

  const out: string[] = [];
  const creatives = creativePerformance(data, range).filter((c) => c.leads > 0);
  const k = overviewKpis(data, range);

  if (k.hasDiscovery) {
    const totalSpend = k.spendConversao + k.spendDescoberta;
    const descShare = totalSpend > 0 ? k.spendDescoberta / totalSpend : 0;
    out.push(
      `Descoberta consumiu ${formatCurrency0(k.spendDescoberta)} (${formatPercent(
        descShare,
        0,
      )}) do orçamento — fora do CPL/CPR. O CPL fiel de conversão é ${formatCurrency(
        k.cpl,
      )} (seria ${formatCurrency(k.cplBlended)} misturando tudo).`,
    );
  }

  if (creatives.length >= 2) {
    const byCpl = [...creatives].sort((a, b) => a.cpl - b.cpl);
    const best = byCpl[0];
    const worst = byCpl[byCpl.length - 1];
    const ratio = best.cpl > 0 ? worst.cpl / best.cpl : 0;
    out.push(
      `Melhor criativo por CPL: "${best.name}" a ${formatCurrency(best.cpl)}` +
        (ratio > 1.2
          ? ` — ${ratio.toFixed(1)}× mais barato que o pior ("${worst.name}", ${formatCurrency(worst.cpl)}). Vale escalar o vencedor e pausar o pior.`
          : "."),
    );
  }

  out.push(
    `${formatInt(k.leads)} leads geraram ${formatInt(k.meetings)} reuniões (${formatPercent(
      k.leadToMeeting,
    )} de conversão lead→reunião), a ${formatCurrency(k.cpr)} por reunião.`,
  );

  if (k.meetings > 0) {
    out.push(
      `Comparecimento: ${formatPercent(k.showRate)} das reuniões agendadas (${formatInt(
        k.attended,
      )} de ${formatInt(k.meetings)}). Acompanhe no-shows para não inflar o topo do funil.`,
    );
  }

  return out.slice(0, 3);
}

/** Insights de uma marca de awareness: crescimento, custo por seguidor, descoberta. */
function buildAwarenessInsights(data: DashboardData, range?: DateRange): string[] {
  const a = awarenessKpis(data, range);
  const out: string[] = [];

  if (a.netNewFollowers !== 0) {
    const cost =
      a.costPerFollower != null ? ` a ${formatCurrency(a.costPerFollower)} por seguidor` : "";
    const spent = a.spend > 0 ? ` (investimento ${formatCurrency0(a.spend)})` : "";
    out.push(`${a.netNewFollowers > 0 ? "+" : ""}${formatInt(a.netNewFollowers)} seguidores no período${cost}${spent}.`);
  }

  if (a.hasReachSplit && a.reach > 0) {
    out.push(
      `${formatPercent(a.discoveryRate)} do alcance foi de não-seguidores — ${
        a.discoveryRate >= 0.5
          ? "boa descoberta de gente nova."
          : "alcance concentrado em quem já segue; teste conteúdo mais compartilhável (Reels, saves)."
      }`,
    );
  }

  if (a.reach > 0) {
    const cpr = a.costPerReach != null ? ` a ${formatCurrency(a.costPerReach)}/mil` : "";
    out.push(
      `Alcance de ${formatCompact(a.reach)}${cpr}, com ${formatPercent(a.engagementRate)} de engajamento da conta.`,
    );
  }

  return out.slice(0, 3);
}
