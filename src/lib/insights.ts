import type { DashboardData } from "./types";
import {
  creativePerformance,
  overviewKpis,
  type DateRange,
} from "./metrics";
import { formatCurrency, formatCurrency0, formatInt, formatPercent } from "./format";

/** A few short, data-grounded insights for the overview. */
export function buildInsights(data: DashboardData, range?: DateRange): string[] {
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
