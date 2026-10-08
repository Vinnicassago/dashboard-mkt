/**
 * Os KPIs do período — a porta ÚNICA das telas para leads, CPL, reuniões e
 * custo por reunião (ADR-03). Puro.
 *
 * Cada número sai com o que é preciso para exibi-lo honestamente: o valor, a
 * amostra (`n`, o denominador que o sustenta), o veredito de confiança
 * (`assessTrust`: quarentena, piso, teto) e, se pedido, o valor do período
 * anterior. Uma tela que mostra "CPL" mostra ESTE CPL — o lint proíbe as páginas
 * de montar KPI com os helpers de baixo nível, e o teste de consistência confere
 * que cascata, farol, motor de ações e IA leem os mesmos números.
 */

import {
  adKpis,
  filterAds,
  objectiveBreakdown,
  overviewKpis,
  previousRange,
  type AdKpis,
  type DateRange,
  type ObjectiveBreakdown,
  type OverviewKpis,
} from "./metrics";
import { assessTrust, MIN_REUNIOES, type MetricKey, type Quarentena, type TrustInput, type TrustReport } from "./trust";
import type { Intervalo } from "./cobertura";
import type { MetricaId } from "./dicionario";
import type { DashboardData } from "./types";
import { formatCurrency, formatCurrency0, formatInt, formatPercent } from "./format";

export interface Medida {
  id: MetricaId;
  valor: number;
  /** A amostra que sustenta o número: o denominador, ou a própria contagem. */
  n: number;
  /** O que dá para afirmar com ele (ausente = número limpo). */
  confianca?: Quarentena;
  /** O mesmo número no período anterior (só com `comparar`). */
  anterior?: number;
}

export interface KpisDoPeriodo {
  investimento: Medida;
  investimentoConversao: Medida;
  investimentoDescoberta: Medida;
  leads: Medida;
  leadsConversao: Medida;
  leadsOrganicos: Medida;
  cpl: Medida;
  reunioesAgendadas: Medida;
  reunioesConversao: Medida;
  custoPorReuniao: Medida;
  agendaram: Medida;
  taxaLeadAgendada: Medida;
  conversoesPixel: Medida;
  /** Há verba de descoberta no período (o CPL não a carrega — vale dizer). */
  temDescoberta: boolean;
  /** Números de entrega da Meta no período (impressões, CTR, CPM…), todas as campanhas. */
  entrega: AdKpis;
  /** A divisão por objetivo (conversão × descoberta) — a mesma de onde saem CPL e custo por reunião. */
  objetivos: ObjectiveBreakdown;
  trust: TrustReport;
  /**
   * O pacote completo (receita, CAC, comparecimento…) da MESMA conta — para os
   * consumidores da biblioteca que precisam de mais que os números acima.
   */
  overview: OverviewKpis;
}

export interface OpcoesKpis {
  /** Regras de marca resolvidas (env + Ajustes) — sem elas, as travas de marca não rodam. */
  brandRules?: TrustInput["brandRules"];
  /** Reuniões que o atendimento registrou no período; `null` = sem leitura. */
  roboReunioes?: number | null;
  /** "Hoje" em Brasília (AAAA-MM-DD). */
  hoje?: string;
  /** Dias cobertos por syncs de anúncio bem-sucedidos (ADR-06). */
  cobertura?: Intervalo[];
  /** Calcula também o período anterior, de mesmo tamanho. */
  comparar?: boolean;
}

export function kpisDoPeriodo(
  data: DashboardData,
  range: DateRange | undefined,
  opts: OpcoesKpis = {},
): KpisDoPeriodo {
  const k = overviewKpis(data, range);
  const entrega = adKpis(filterAds(data.adDaily, range));
  const pixel = entrega.leads;
  const trust = assessTrust({
    data,
    range,
    brandRules: opts.brandRules ?? [],
    kpis: {
      meetings: k.meetings,
      meetingsConversao: k.meetingsConversao,
      leads: k.leads,
      leadsConversao: k.leadsConversao,
      spendConversao: k.spendConversao,
      spendTotal: k.spend,
    },
    roboReunioes: opts.roboReunioes,
    hoje: opts.hoje,
    cobertura: opts.cobertura,
  });
  const p = opts.comparar && range ? overviewKpis(data, previousRange(range)) : undefined;

  const medida = (
    id: MetricaId,
    valor: number,
    n: number,
    metrica?: MetricKey,
    anterior?: number,
  ): Medida => ({
    id,
    valor,
    n,
    ...(metrica && trust.porMetrica[metrica] ? { confianca: trust.porMetrica[metrica] } : {}),
    ...(anterior !== undefined ? { anterior } : {}),
  });

  const leadsOrg = k.organicLeads;
  return {
    investimento: medida("investimento", k.spend, k.spend, "spend", p?.spend),
    investimentoConversao: medida("investimento_conversao", k.spendConversao, k.spendConversao, "spend", p?.spendConversao),
    investimentoDescoberta: medida("investimento_descoberta", k.spendDescoberta, k.spendDescoberta, "spend", p?.spendDescoberta),
    leads: medida("leads", k.leads, k.leads, undefined, p?.leads),
    leadsConversao: medida("leads_conversao", k.leadsConversao, k.leadsConversao, undefined, p?.leadsConversao),
    leadsOrganicos: medida("leads_organicos", leadsOrg, leadsOrg, undefined, p?.organicLeads),
    cpl: medida("cpl", k.cpl, k.leadsConversao, "cpl", p?.cpl),
    reunioesAgendadas: medida("reunioes_agendadas", k.meetings, k.meetings, "meetings", p?.meetings),
    reunioesConversao: medida("reunioes_conversao", k.meetingsConversao, k.meetingsConversao, "meetings", p?.meetingsConversao),
    custoPorReuniao: medida("custo_por_reuniao", k.cpr, k.meetingsConversao, "cpr", p?.cpr),
    agendaram: medida("agendaram", k.meetingsCoorte, k.meetingsCoorte, undefined, p?.meetingsCoorte),
    taxaLeadAgendada: medida("taxa_lead_agendada", k.leadToMeeting, k.leads, undefined, p?.leadToMeeting),
    conversoesPixel: medida("conversoes_pixel", pixel, pixel),
    temDescoberta: k.hasDiscovery,
    entrega,
    objetivos: objectiveBreakdown(data, range),
    trust,
    overview: k,
  };
}

// ---------------------------------------------------------------- exibição

/** Custo com denominador zero não existe (CLAUDE.md): "—", nunca "R$ 0,00". */
const CUSTOS: MetricaId[] = ["cpl", "custo_por_reuniao"];

/**
 * O custo por reunião tem UMA régua de amostra (`MIN_REUNIOES`): abaixo dela o
 * número não aparece em tela nenhuma, nem decide nada.
 */
export function custoExibivel(m: Medida): boolean {
  if (m.confianca?.nivel === "quarentena") return false;
  if (CUSTOS.includes(m.id) && m.n <= 0) return false;
  if (m.id === "custo_por_reuniao" && m.n < MIN_REUNIOES) return false;
  return true;
}

export type FormatoMedida = "moeda" | "moeda0" | "int" | "pct";

/**
 * O número pronto para a tela: "—" quando não sustenta (quarentena, sem
 * denominador, custo por reunião abaixo da régua); "≥"/"≤" quando é piso/teto.
 */
export function mostrar(m: Medida, formato: FormatoMedida): string {
  if (!custoExibivel(m)) return "—";
  const v =
    formato === "moeda"
      ? formatCurrency(m.valor)
      : formato === "moeda0"
        ? formatCurrency0(m.valor)
        : formato === "pct"
          ? formatPercent(m.valor)
          : formatInt(m.valor);
  if (!m.confianca) return v;
  return `${m.confianca.nivel === "piso" ? "≥" : "≤"} ${v}`;
}
