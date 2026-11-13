import type { DashboardData } from "./types";
import { awarenessKpis, type DateRange } from "./metrics";
import { custoExibivel, kpisDoPeriodo } from "./kpis";
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
  const kp = kpisDoPeriodo(data, range);
  const k = kp.overview;

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

  // Criativo para escalar ou pausar não sai daqui (Fase 4): era a 3ª régua de
  // "escalar". O sinal do criativo mora em `lib/sinal-do-criativo.ts` (a Mídia).

  // Duas visões, dois nomes (dicionario.ts): a taxa é da COORTE (dos leads do
  // período, quantos agendaram); as reuniões agendadas são do PERÍODO. O custo
  // por reunião só com a régua única (`custoExibivel`).
  out.push(
    `${formatInt(k.leads)} leads no período; ${formatInt(k.meetingsCoorte)} deles agendaram (${formatPercent(
      k.leadToMeeting,
    )} lead→reunião). ${formatInt(k.meetings)} reuniões agendadas no período` +
      (custoExibivel(kp.custoPorReuniao) ? `, a ${formatCurrency(kp.custoPorReuniao.valor)} por reunião.` : "."),
  );

  if (k.meetingsCoorte > 0) {
    out.push(
      `Comparecimento: ${formatPercent(k.showRate)} de quem agendou (${formatInt(
        k.attended,
      )} de ${formatInt(k.meetingsCoorte)}). Acompanhe no-shows para não inflar o topo do funil.`,
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
