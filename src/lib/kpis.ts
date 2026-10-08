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
  dayOf,
  filterAds,
  filterLeads,
  inRange,
  isAttended,
  isBooked,
  objectiveBreakdown,
  overviewKpis,
  previousRange,
  type AdKpis,
  type DateRange,
  type ObjectiveBreakdown,
  type OverviewKpis,
} from "./metrics";
import { FILA_ETAPAS } from "./fila";
import { horasUteisEntre, somarHorasUteis } from "./horario-util";
import { hojeEmBrasilia } from "./range";
import {
  META_DEF,
  METRICAS_COM_META,
  alvoNoPeriodo,
  statusContraMeta,
  type AvaliacaoMeta,
} from "./metas";
import { assessTrust, MIN_REUNIOES, type MetricKey, type Quarentena, type TrustInput, type TrustReport } from "./trust";
import type { Intervalo } from "./cobertura";
import type { MetricaId } from "./dicionario";
import type { DashboardData, Meta, MetricaComMeta } from "./types";
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
  /** Dos leads do período cujo prazo já fechou, a fração com 1ª tentativa dentro dele (1 hora útil). */
  primeiroContatoNoPrazo: Medida;
  /** Mediana, em horas úteis, da entrada à 1ª tentativa (só quem teve tentativa). */
  medianaPrimeiroContatoHoras: number | null;
  /** Reuniões com data já passada no período: a fração que aconteceu. */
  comparecimento: Medida;
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
  /** "Agora" (ISO) — o que separa prazo vencido de prazo correndo. Ausente = o relógio. */
  agora?: string;
}

/**
 * 1º contato no prazo (1 hora útil, FILA_ETAPAS.novo). Entra quem já teve a 1ª
 * tentativa ou quem ainda espera com o prazo vencido; quem espera dentro do
 * prazo ainda não perdeu nada, e quem foi encerrado sem tentativa registrada
 * (legado de antes da Fase 2) não tem como ser julgado — fica fora do n.
 */
function primeiroContato(data: DashboardData, range: DateRange | undefined, agoraIso: string) {
  const sla = FILA_ETAPAS.novo.slaHoras;
  let base = 0;
  let noPrazo = 0;
  const horas: number[] = [];
  for (const l of filterLeads(data.leads, range)) {
    const prazo = somarHorasUteis(l.createdAt, sla);
    if (l.firstContactAt) {
      base += 1;
      if (l.firstContactAt <= prazo) noPrazo += 1;
      horas.push(horasUteisEntre(l.createdAt, l.firstContactAt));
    } else if (l.status === "lead" && agoraIso > prazo) {
      base += 1;
    }
  }
  horas.sort((a, b) => a - b);
  const meio = Math.floor(horas.length / 2);
  const mediana = horas.length === 0 ? null : horas.length % 2 ? horas[meio] : (horas[meio - 1] + horas[meio]) / 2;
  return { valor: base > 0 ? noPrazo / base : 0, n: base, mediana };
}

/** Comparecimento: das reuniões MARCADAS PARA o período cuja data já passou, quantas aconteceram. */
function comparecimentoDoPeriodo(data: DashboardData, range: DateRange | undefined, agoraIso: string) {
  const passadas = data.leads.filter(
    (l) => isBooked(l) && l.meetingFor && l.meetingFor < agoraIso && inRange(dayOf(l.meetingFor), range),
  );
  const foram = passadas.filter(isAttended).length;
  return { valor: passadas.length > 0 ? foram / passadas.length : 0, n: passadas.length };
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
  const agora = opts.agora ?? new Date().toISOString();
  const pc = primeiroContato(data, range, agora);
  const comp = comparecimentoDoPeriodo(data, range, agora);

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
    primeiroContatoNoPrazo: medida("primeiro_contato_no_prazo", pc.valor, pc.n),
    medianaPrimeiroContatoHoras: pc.mediana,
    comparecimento: medida("comparecimento", comp.valor, comp.n),
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

// ---------------------------------------------------------------- régua (metas)

export interface LinhaDaRegua {
  metrica: MetricaComMeta;
  medida: Medida;
  /** Alvo do período inteiro (contagem e verba somam dia a dia). */
  alvo?: number;
  /** A meta que vale no fim do período. */
  meta?: Meta;
  /** Parte do período não tinha meta. */
  parcial: boolean;
  /** Sem avaliação quando não há meta OU o número não se sustenta ("—"). */
  avaliacao?: AvaliacaoMeta;
}

const MEDIDA_DA_META: Record<MetricaComMeta, (k: KpisDoPeriodo) => Medida> = {
  reunioes_agendadas: (k) => k.reunioesAgendadas,
  leads: (k) => k.leads,
  cpl: (k) => k.cpl,
  custo_por_reuniao: (k) => k.custoPorReuniao,
  taxa_lead_agendada: (k) => k.taxaLeadAgendada,
  primeiro_contato_no_prazo: (k) => k.primeiroContatoNoPrazo,
  comparecimento: (k) => k.comparecimento,
  investimento_conversao: (k) => k.investimentoConversao,
};

/**
 * O período concreto da régua: "campanha inteira" vai do início da campanha (ou
 * do primeiro dado) até hoje.
 */
export function periodoDaRegua(data: DashboardData, range: DateRange | undefined, hoje: string): DateRange {
  if (range) return range;
  const primeiro = [data.campaign.startDate, ...data.adDaily.map((r) => r.date), ...data.leads.map((l) => dayOf(l.createdAt))]
    .filter(Boolean)
    .sort()[0];
  return { from: primeiro ?? hoje, to: hoje };
}

/**
 * Cada métrica com meta, contra a meta que vale no período. Taxa sem amostra,
 * custo que não se exibe ("—") e período que a meta não cobre inteiro ficam sem
 * status — cor sobre comparação que não se sustenta seria pior que nenhuma cor.
 */
export function reguaDoPeriodo(
  k: KpisDoPeriodo,
  data: DashboardData,
  range: DateRange | undefined,
  hoje: string = hojeEmBrasilia(),
): LinhaDaRegua[] {
  const periodo = periodoDaRegua(data, range, hoje);
  return METRICAS_COM_META.map((metrica) => {
    const medida = MEDIDA_DA_META[metrica](k);
    const a = alvoNoPeriodo(data.metas, metrica, periodo);
    const def = META_DEF[metrica];
    const sustenta =
      def.formato === "moeda" && def.regra === "menor"
        ? custoExibivel(medida)
        : def.formato === "pct"
          ? medida.n > 0
          : medida.confianca?.nivel !== "quarentena";
    return {
      metrica,
      medida,
      alvo: a?.alvo,
      meta: a?.meta,
      parcial: a?.parcial ?? false,
      // Parte do período sem meta: comparar o total do período com o alvo de
      // poucos dias (ou julgar o passado pela meta de hoje) mente — sem status.
      avaliacao: a && !a.parcial && sustenta ? statusContraMeta(medida.valor, a.alvo, def.regra) : undefined,
    };
  });
}
