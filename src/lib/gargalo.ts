/**
 * Onde está travando — as transições do funil, com dono, e o GARGALO. Puro.
 *
 * A pergunta é "onde trava?", e a resposta é UMA transição: a de menor razão
 * entre a taxa real e a referência (a meta vigente ou, sem meta, a média das 8
 * semanas anteriores — e o rótulo diz qual das duas). Abaixo de 10 entradas a
 * taxa não é taxa, e a transição não concorre a gargalo.
 *
 * O impacto estimado é o do relatório: volume que entra na etapa × (referência −
 * real) × produto das taxas seguintes até "agendada" (usando a referência quando
 * a real é 0). Inteiro, e só com amostra — com 1 lead "+0,3 reunião" é enfeite.
 *
 * As etapas do robô ficam de fora de propósito: o robô está parado (decisão de
 * negócio de out/2026) e a cascata completa, em Jornada, já o mostra quando ele
 * volta. Aqui são as transições que o painel mede sozinho.
 */

import type { Dono } from "./dono";
import { kpisDoPeriodo, type KpisDoPeriodo } from "./kpis";
import { metaVigente } from "./metas";
import { bucketOfAd, filterAds, inRange, lpKpis, previousRange, type DateRange } from "./metrics";
import { formatInt } from "./format";
import { diasDoPeriodo, janelaAnterior } from "./semana";
import type { DashboardData, MetricaComMeta } from "./types";

export type TransicaoId = "impressao_visita" | "visita_lead" | "lead_contato" | "lead_agendada" | "agendada_realizada";

/** Abaixo disto a transição mostra o dono e o n, mas não a taxa — nem concorre a gargalo. */
export const AMOSTRA_GARGALO = 10;

/** Janela da média de referência quando não há meta: as 8 semanas anteriores ao período. */
export const DIAS_DA_MEDIA = 56;

export interface Referencia {
  taxa: number;
  /** De onde veio a régua — a tela diz "meta" ou "média de 8 sem.". */
  origem: "meta" | "media8s";
  provisoria?: boolean;
}

export interface Transicao {
  id: TransicaoId;
  rotulo: string;
  dono: Dono;
  /** Volume que entra na etapa no período (a base da taxa). */
  entradas: number;
  saidas: number;
  /** `null` abaixo da amostra mínima. */
  taxa: number | null;
  referencia?: Referencia;
  /** taxa ÷ referência — só com as duas. */
  razao?: number;
  /** taxa − taxa do período anterior (pontos de fração), só com amostra nos dois. */
  delta?: number;
  /** A meta que rege esta transição, quando existe uma na régua. */
  metrica?: MetricaComMeta;
  href: string;
}

export interface Gargalo {
  transicao: Transicao;
  razao: number;
  /** O impacto, quando dá para estimar. */
  impacto: ImpactoGargalo | null;
  /** Por que não há impacto (amostra, nada a ganhar…). */
  semImpacto?: string;
}

export interface ImpactoGargalo {
  /** Reuniões a mais por semana, inteiro. */
  porSemana: number;
  /** No período inteiro. */
  noPeriodo: number;
  unidade: "reunioes_agendadas" | "reunioes_realizadas";
}

const ROTULO: Record<TransicaoId, string> = {
  impressao_visita: "Impressão → Visita",
  visita_lead: "Visita → Lead",
  lead_contato: "Lead → 1º contato ≤ 1 h",
  lead_agendada: "Lead → Agendada",
  agendada_realizada: "Agendada → Realizada",
};

const DONO: Record<TransicaoId, Dono> = {
  impressao_visita: "MKT",
  visita_lead: "LP",
  lead_contato: "COM",
  lead_agendada: "COM",
  agendada_realizada: "ESP",
};

const METRICA: Partial<Record<TransicaoId, MetricaComMeta>> = {
  lead_contato: "primeiro_contato_no_prazo",
  lead_agendada: "taxa_lead_agendada",
  agendada_realizada: "comparecimento",
};

const HREF: Record<TransicaoId, string> = {
  impressao_visita: "/dinheiro",
  visita_lead: "/jornada",
  lead_contato: "/fila?etapa=novo",
  lead_agendada: "/jornada",
  agendada_realizada: "/fila?etapa=sem-desfecho",
};

/** As transições que vêm DEPOIS desta até "agendada" (para o impacto compor). */
const SEGUINTES: Record<TransicaoId, TransicaoId[]> = {
  impressao_visita: ["visita_lead", "lead_agendada"],
  visita_lead: ["lead_agendada"],
  // O 1º contato é um ramo paralelo a "lead → agendada", não um degrau antes
  // dele; para estimar, trata-se quem foi contatado tarde como quem não agendou.
  lead_contato: ["lead_agendada"],
  lead_agendada: [],
  agendada_realizada: [],
};

interface Bruta {
  entradas: number;
  saidas: number;
}

/** Entradas e saídas de cada transição num período, a partir dos KPIs dele. */
function brutas(data: DashboardData, range: DateRange | undefined, k: KpisDoPeriodo): Record<TransicaoId, Bruta> {
  const impressoesConversao = filterAds(data.adDaily, range)
    .filter((r) => bucketOfAd(r) === "conversao")
    .reduce((s, r) => s + r.impressions, 0);
  const lp = lpKpis(data, range);
  return {
    impressao_visita: { entradas: impressoesConversao, saidas: lp.visits },
    visita_lead: { entradas: lp.visits, saidas: k.leads.valor },
    lead_contato: { entradas: k.primeiroContatoNoPrazo.n, saidas: Math.round(k.primeiroContatoNoPrazo.valor * k.primeiroContatoNoPrazo.n) },
    lead_agendada: { entradas: k.leads.valor, saidas: k.agendaram.valor },
    agendada_realizada: { entradas: k.comparecimento.n, saidas: Math.round(k.comparecimento.valor * k.comparecimento.n) },
  };
}

const taxaDe = (b: Bruta): number | null => (b.entradas >= AMOSTRA_GARGALO ? b.saidas / b.entradas : null);

/** Há linha da landing page dentro do período (ou em qualquer data, na campanha inteira)? */
export function temLpNoPeriodo(data: DashboardData, range: DateRange | undefined): boolean {
  return data.lpDaily.some((r) => inRange(r.date, range));
}

/** "+3 reuniões por semana se batesse a meta" — um texto, uma fonte (placar e Onde trava). */
export function textoDoImpacto(g: Gargalo): string {
  const origem = g.transicao.referencia?.origem === "meta" ? "meta" : "média";
  if (!g.impacto) return g.semImpacto ?? "estimativa indisponível";
  const n = g.impacto.porSemana;
  const unidade =
    g.impacto.unidade === "reunioes_realizadas"
      ? n === 1 ? "reunião realizada" : "reuniões realizadas"
      : n === 1 ? "reunião" : "reuniões";
  return `+${formatInt(n)} ${unidade} por semana se batesse a ${origem}`;
}

export interface OpcoesGargalo {
  /** "Agora" (ISO) e "hoje" (AAAA-MM-DD) — passam aos KPIs das janelas de comparação. */
  agora: string;
  hoje: string;
}

/**
 * O período concreto por trás de `range` ("campanha inteira" = do primeiro dado
 * até hoje) — o que divide o impacto em semanas. Sem isto, na campanha inteira
 * o número do período saía rotulado "por semana".
 */
export type PeriodoConcreto = DateRange;

/**
 * As transições do período. Sem landing page registrada, as duas primeiras não
 * existem (a LP é outra fonte; sem dado dela, "0 visitas" seria mentira).
 */
export function transicoesDoFunil(
  data: DashboardData,
  range: DateRange | undefined,
  kpis: KpisDoPeriodo,
  opts: OpcoesGargalo,
): Transicao[] {
  const atual = brutas(data, range, kpis);
  // A landing page só entra com dado NO período: histórico sem linha nesta
  // semana é rastreio que parou, não "0 visitas" — e "—" não é "0".
  const temLp = temLpNoPeriodo(data, range);
  const ids = (Object.keys(ROTULO) as TransicaoId[]).filter(
    (id) => temLp || (id !== "impressao_visita" && id !== "visita_lead"),
  );

  // Comparações só com um período concreto: "campanha inteira" não tem "antes".
  const anterior = range ? brutas(data, previousRange(range), kpisDoPeriodo(data, previousRange(range), opts)) : null;
  const media = range
    ? brutas(data, janelaAnterior(range, DIAS_DA_MEDIA), kpisDoPeriodo(data, janelaAnterior(range, DIAS_DA_MEDIA), opts))
    : null;
  const fim = range?.to ?? opts.hoje;

  return ids.map((id) => {
    const b = atual[id];
    const taxa = taxaDe(b);
    const metrica = METRICA[id];
    const meta = metrica ? metaVigente(data.metas, metrica, fim) : undefined;
    let referencia: Referencia | undefined;
    if (meta?.alvo != null) {
      referencia = { taxa: meta.alvo, origem: "meta", provisoria: meta.provisoria };
    } else if (media) {
      const t = taxaDe(media[id]);
      if (t != null) referencia = { taxa: t, origem: "media8s" };
    }
    const taxaAnterior = anterior ? taxaDe(anterior[id]) : null;
    return {
      id,
      rotulo: ROTULO[id],
      dono: DONO[id],
      entradas: b.entradas,
      saidas: b.saidas,
      taxa,
      referencia,
      razao: taxa != null && referencia && referencia.taxa > 0 ? taxa / referencia.taxa : undefined,
      delta: taxa != null && taxaAnterior != null ? taxa - taxaAnterior : undefined,
      metrica,
      href: HREF[id],
    };
  });
}

/**
 * O gargalo: menor razão taxa ÷ referência entre as transições com amostra e
 * referência. Empate (razões iguais) fica com a mais funda — é a mais cara.
 */
export function gargalo(transicoes: Transicao[], periodo: PeriodoConcreto): Gargalo | null {
  let pior: Transicao | null = null;
  for (const t of transicoes) {
    if (t.taxa == null || t.razao == null) continue;
    if (!pior || t.razao <= pior.razao!) pior = t;
  }
  if (!pior) return null;
  const imp = impactoEstimado(transicoes, pior, periodo);
  return { transicao: pior, razao: pior.razao!, ...imp };
}

/**
 * Impacto do relatório: volume que entra × (referência − real) × produto das
 * taxas seguintes até "agendada" (referência quando a real é 0). Inteiro e só com
 * amostra; abaixo de uma reunião por semana o número não se sustenta.
 */
export function impactoEstimado(
  transicoes: Transicao[],
  t: Transicao,
  periodo: PeriodoConcreto,
): { impacto: ImpactoGargalo | null; semImpacto?: string } {
  if (t.taxa == null || !t.referencia) return { impacto: null, semImpacto: "estimativa indisponível (sem amostra ou sem régua)" };
  const ganho = t.referencia.taxa - t.taxa;
  if (ganho <= 0) return { impacto: null, semImpacto: "já está na régua — nada a ganhar aqui" };
  const porId = new Map(transicoes.map((x) => [x.id, x]));
  let produto = 1;
  for (const id of SEGUINTES[t.id]) {
    const s = porId.get(id);
    if (!s) continue;
    const taxa = s.taxa != null && s.taxa > 0 ? s.taxa : s.referencia?.taxa;
    if (taxa == null) return { impacto: null, semImpacto: "estimativa indisponível (etapa seguinte sem amostra nem régua)" };
    produto *= taxa;
  }
  const semanas = diasDoPeriodo(periodo) / 7;
  const noPeriodo = t.entradas * ganho * produto;
  const porSemana = noPeriodo / semanas;
  if (porSemana < 0.5) return { impacto: null, semImpacto: "estimativa indisponível (menos de uma reunião por semana)" };
  return {
    impacto: {
      porSemana: Math.round(porSemana),
      noPeriodo: Math.round(noPeriodo),
      unidade: t.id === "agendada_realizada" ? "reunioes_realizadas" : "reunioes_agendadas",
    },
  };
}
