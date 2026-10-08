/**
 * Metas — a régua (Fase 4, M1 do relatório). Puro.
 *
 * Três peças:
 *   1. a CALCULADORA (`calcularMetas`): as metas saem da conta de unidade, de
 *      trás para frente — quanto a empresa pode pagar por uma venda → por uma
 *      reunião → por um lead (seção 9 do relatório);
 *   2. a VIGÊNCIA (`metaVigente`, `alvoNoPeriodo`): mudar uma meta insere uma
 *      linha nova; cada dia é julgado pela meta que valia nele;
 *   3. o STATUS (`statusContraMeta`): verde/âmbar/vermelho, SEMPRE com texto.
 */

import type { DashboardData, EntradasCalculadora, Meta, MetricaComMeta } from "./types";
import { dayOf, isAttended, isBooked, isClient, type DateRange } from "./metrics";
import { formatCurrency, formatCurrency0, formatInt, formatPercent } from "./format";

// ---------------------------------------------------------------- definições

export type RegraMeta = "maior" | "menor" | "ritmo";

export interface DefMeta {
  nome: string;
  /** maior = quanto mais, melhor; menor = custo; ritmo = orçamento (nem muito acima nem abaixo). */
  regra: RegraMeta;
  formato: "int" | "moeda" | "pct";
  /** `periodo`: o alvo semanal soma dia a dia (contagem, verba). `razao`: vale igual para qualquer período. */
  escala: "periodo" | "razao";
}

export const META_DEF: Record<MetricaComMeta, DefMeta> = {
  reunioes_agendadas: { nome: "Reuniões agendadas", regra: "maior", formato: "int", escala: "periodo" },
  leads: { nome: "Leads", regra: "maior", formato: "int", escala: "periodo" },
  cpl: { nome: "CPL", regra: "menor", formato: "moeda", escala: "razao" },
  custo_por_reuniao: { nome: "Custo por reunião", regra: "menor", formato: "moeda", escala: "razao" },
  taxa_lead_agendada: { nome: "Lead → reunião", regra: "maior", formato: "pct", escala: "razao" },
  primeiro_contato_no_prazo: { nome: "1º contato no prazo", regra: "maior", formato: "pct", escala: "razao" },
  comparecimento: { nome: "Comparecimento", regra: "maior", formato: "pct", escala: "razao" },
  investimento_conversao: { nome: "Orçamento de conversão", regra: "ritmo", formato: "moeda", escala: "periodo" },
};

export const METRICAS_COM_META = Object.keys(META_DEF) as MetricaComMeta[];

// ---------------------------------------------------------------- calculadora

export interface SaidasCalculadora {
  /** V × c × m. */
  cacMax: number;
  /** CAC × f × s. */
  custoPorReuniaoMax: number;
  /** custo por reunião × a. */
  cplMax: number;
  /** N ÷ (f × s) ÷ 4,33. */
  reunioesPorSemana: number;
  /** reuniões ÷ a. */
  leadsPorSemana: number;
  /** leads × CPL. */
  orcamentoConversaoPorSemana: number;
}

/** Semanas por mês (52 ÷ 12). */
export const SEMANAS_POR_MES = 4.33;

export function calcularMetas(e: EntradasCalculadora): SaidasCalculadora {
  const cacMax = e.V * e.c * e.m;
  const custoPorReuniaoMax = cacMax * e.f * e.s;
  const cplMax = custoPorReuniaoMax * e.a;
  const fs = e.f * e.s;
  const reunioesPorSemana = fs > 0 ? e.N / fs / SEMANAS_POR_MES : 0;
  const leadsPorSemana = e.a > 0 ? reunioesPorSemana / e.a : 0;
  return {
    cacMax,
    custoPorReuniaoMax,
    cplMax,
    reunioesPorSemana,
    leadsPorSemana,
    orcamentoConversaoPorSemana: leadsPorSemana * cplMax,
  };
}

/** O que dá para validar antes de salvar (frações entre 0 e 1, valores positivos). */
export function errosDaCalculadora(e: EntradasCalculadora): string[] {
  const out: string[] = [];
  if (!(e.V > 0)) out.push("Informe o valor médio da carta.");
  if (!(e.N > 0)) out.push("Informe quantas vendas por mês.");
  for (const [k, nome] of [
    ["c", "a receita por venda"],
    ["m", "a fatia aceitável como custo de aquisição"],
    ["f", "o fechamento"],
    ["s", "o comparecimento"],
    ["a", "o lead → reunião"],
  ] as const) {
    const v = e[k];
    if (!(v > 0 && v <= 1)) out.push(`Informe ${nome} entre 0% e 100%.`);
  }
  return out;
}

// ---------------------------------------------------------------- taxas observadas

/** Janela da calibração: as últimas 8 semanas. */
export const DIAS_DE_CALIBRACAO = 56;
/** Abaixo disto a taxa observada não sustenta meta: ela é "provisória". */
export const AMOSTRA_MIN_LEADS = 20;
export const AMOSTRA_MIN_AGENDADAS = 5;

export interface TaxasObservadas {
  a: number | null;
  s: number | null;
  f: number | null;
  V: number | null;
  amostra: { leads: number; agendadas: number; reunioesPassadas: number; realizadas: number };
  /** ≥ 20 leads E ≥ 5 agendadas nas 8 semanas: dá para sugerir as taxas. */
  suficiente: boolean;
}

function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * As taxas que a campanha mostrou nas últimas 8 semanas, para a calculadora
 * sugerir — quando há amostra. `hoje` = AAAA-MM-DD (Brasília).
 */
export function taxasObservadas(data: DashboardData, hoje: string, agoraIso: string): TaxasObservadas {
  const de = somarDias(hoje, -(DIAS_DE_CALIBRACAO - 1));
  const naJanela = (iso?: string) => Boolean(iso && dayOf(iso) >= de && dayOf(iso) <= hoje);
  const coorte = data.leads.filter((l) => naJanela(l.createdAt));
  const agendadasNoPeriodo = data.leads.filter((l) => isBooked(l) && naJanela(l.bookedAt ?? l.meetingAt ?? l.createdAt));
  // Comparecimento: só reuniões cuja DATA já passou (as futuras ainda não podiam acontecer).
  const passadas = data.leads.filter(
    (l) => isBooked(l) && l.meetingFor && naJanela(l.meetingFor) && l.meetingFor < agoraIso,
  );
  const realizadas = data.leads.filter((l) => isAttended(l) && naJanela(l.attendedAt ?? l.meetingFor));
  const clientes = data.leads.filter((l) => isClient(l) && (l.value ?? 0) > 0);
  const div = (a: number, b: number) => (b > 0 ? a / b : null);
  return {
    a: div(coorte.filter(isBooked).length, coorte.length),
    s: div(passadas.filter(isAttended).length, passadas.length),
    f: div(realizadas.filter(isClient).length, realizadas.length),
    V: clientes.length ? clientes.reduce((s, l) => s + (l.value ?? 0), 0) / clientes.length : null,
    amostra: {
      leads: coorte.length,
      agendadas: agendadasNoPeriodo.length,
      reunioesPassadas: passadas.length,
      realizadas: realizadas.length,
    },
    suficiente: coorte.length >= AMOSTRA_MIN_LEADS && agendadasNoPeriodo.length >= AMOSTRA_MIN_AGENDADAS,
  };
}

/**
 * As metas que a calculadora grava — uma linha por métrica, todas com as
 * entradas, para a meta ser auditável. Sem amostra, saem "provisórias".
 */
export function metasDaCalculadora(
  e: EntradasCalculadora,
  opts: {
    brand: string;
    vigenteDesde: string;
    criadaEm: string;
    criadaPor: string;
    provisoria: boolean;
    /** Meta de 1º contato no prazo (fração) — não sai da conta de unidade. */
    primeiroContatoNoPrazo?: number;
    novoId: () => string;
  },
): Meta[] {
  const s = calcularMetas(e);
  const alvos: [MetricaComMeta, number][] = [
    ["reunioes_agendadas", s.reunioesPorSemana],
    ["leads", s.leadsPorSemana],
    ["cpl", s.cplMax],
    ["custo_por_reuniao", s.custoPorReuniaoMax],
    ["taxa_lead_agendada", e.a],
    ["comparecimento", e.s],
    ["investimento_conversao", s.orcamentoConversaoPorSemana],
  ];
  if (opts.primeiroContatoNoPrazo != null) alvos.push(["primeiro_contato_no_prazo", opts.primeiroContatoNoPrazo]);
  return alvos.map(([metrica, alvo]) => ({
    id: opts.novoId(),
    brand: opts.brand,
    metrica,
    periodo: "semana",
    alvo,
    vigenteDesde: opts.vigenteDesde,
    // 1º contato no prazo é decisão de processo, não estimativa de taxa.
    provisoria: metrica === "primeiro_contato_no_prazo" ? false : opts.provisoria,
    origem: "calculadora",
    entradas: e,
    criadaEm: opts.criadaEm,
    criadaPor: opts.criadaPor,
  }));
}

// ---------------------------------------------------------------- vigência

/** A meta que valia no dia (AAAA-MM-DD), ou nada (sem meta, ou meta limpa). */
export function metaVigente(metas: Meta[] | undefined, metrica: MetricaComMeta, dia: string): Meta | undefined {
  const candidata = (metas ?? [])
    .filter((m) => m.metrica === metrica && m.vigenteDesde <= dia)
    .sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde) || b.criadaEm.localeCompare(a.criadaEm))[0];
  return candidata && candidata.alvo != null ? candidata : undefined;
}

export interface AlvoDoPeriodo {
  alvo: number;
  /** A meta que vale no fim do período (a que se edita). */
  meta: Meta;
  /** Parte do período não tinha meta: o alvo cobre só os dias com meta. */
  parcial: boolean;
}

const DIAS_DO_PERIODO = { semana: 7, mes: SEMANAS_POR_MES * 7 } as const;

/**
 * O alvo do período inteiro. Custo e taxa valem como estão (a meta vigente no
 * fim); contagem e verba somam dia a dia — uma semana de meta 7 com 3 dias sob a
 * meta antiga de 5 vale 3×5/7 + 4×7/7.
 */
export function alvoNoPeriodo(metas: Meta[] | undefined, metrica: MetricaComMeta, range: DateRange): AlvoDoPeriodo | undefined {
  const fim = metaVigente(metas, metrica, range.to);
  if (META_DEF[metrica].escala === "razao") {
    // Custo e taxa valem como estão — mas se a meta começou no meio do período,
    // o começo dele não tinha régua (não se julga o passado pela meta de hoje).
    return fim ? { alvo: fim.alvo!, meta: fim, parcial: !metaVigente(metas, metrica, range.from) } : undefined;
  }
  let soma = 0;
  let comMeta = 0;
  let dias = 0;
  let ultima: Meta | undefined;
  for (let d = range.from; d <= range.to; d = somarDias(d, 1)) {
    dias += 1;
    const m = metaVigente(metas, metrica, d);
    if (!m) continue;
    comMeta += 1;
    ultima = m;
    soma += m.alvo! / DIAS_DO_PERIODO[m.periodo];
  }
  if (!ultima) return undefined;
  return { alvo: soma, meta: fim ?? ultima, parcial: comMeta < dias };
}

// ---------------------------------------------------------------- status

export type StatusMeta = "verde" | "ambar" | "vermelho";

export interface AvaliacaoMeta {
  status: StatusMeta;
  /** valor ÷ alvo. */
  razao: number;
  /** O status em palavras — cor nunca vem sozinha. */
  rotulo: string;
}

const pctTexto = (r: number) => `${Math.round(r * 100)}%`;

/**
 * Verde ≥ 100% da meta, âmbar 80–99%, vermelho < 80%. Custo (menor é melhor):
 * verde ≤ alvo, âmbar até 120%, vermelho acima. Ritmo de verba: verde entre 90%
 * e 110% do previsto, âmbar entre 75% e 125%, vermelho fora.
 */
export function statusContraMeta(valor: number, alvo: number, regra: RegraMeta): AvaliacaoMeta | undefined {
  if (!(alvo > 0) || !Number.isFinite(valor)) return undefined;
  const razao = valor / alvo;
  if (regra === "maior") {
    if (razao >= 1) return { status: "verde", razao, rotulo: "Na meta" };
    if (razao >= 0.8) return { status: "ambar", razao, rotulo: `Perto da meta (${pctTexto(razao)})` };
    return { status: "vermelho", razao, rotulo: `Abaixo da meta (${pctTexto(razao)})` };
  }
  if (regra === "menor") {
    if (razao <= 1) return { status: "verde", razao, rotulo: "Dentro do alvo" };
    if (razao <= 1.2) return { status: "ambar", razao, rotulo: `${pctTexto(razao - 1)} acima do alvo` };
    return { status: "vermelho", razao, rotulo: `${pctTexto(razao - 1)} acima do alvo` };
  }
  if (razao >= 0.9 && razao <= 1.1) return { status: "verde", razao, rotulo: "No ritmo" };
  const lado = razao < 1 ? "Abaixo do ritmo" : "Acima do ritmo";
  return { status: razao >= 0.75 && razao <= 1.25 ? "ambar" : "vermelho", razao, rotulo: `${lado} (${pctTexto(razao)})` };
}

// ---------------------------------------------------------------- recalibração

/**
 * Metas provisórias com mais de 8 semanas, quando já há amostra: hora de trocar
 * o chute pela taxa observada. Devolve as métricas de taxa a recalibrar.
 */
export function precisaRecalibrar(metas: Meta[] | undefined, observadas: TaxasObservadas, hoje: string): MetricaComMeta[] {
  if (!observadas.suficiente) return [];
  const limite = somarDias(hoje, -DIAS_DE_CALIBRACAO);
  const out: MetricaComMeta[] = [];
  for (const metrica of ["taxa_lead_agendada", "comparecimento"] as MetricaComMeta[]) {
    const m = metaVigente(metas, metrica, hoje);
    if (m?.provisoria && m.vigenteDesde <= limite) out.push(metrica);
  }
  return out;
}

// ---------------------------------------------------------------- exibição


/** O alvo em texto, no formato da métrica ("≈ 7" quando a conta não fecha em inteiro). */
export function formatarAlvo(metrica: MetricaComMeta, alvo: number): string {
  const f = META_DEF[metrica].formato;
  if (f === "pct") return formatPercent(alvo, 0);
  if (f === "moeda") return alvo >= 1000 ? formatCurrency0(alvo) : formatCurrency(alvo);
  const r = Math.round(alvo);
  return `${Math.abs(alvo - r) > 0.05 ? "≈ " : ""}${formatInt(r)}`;
}
