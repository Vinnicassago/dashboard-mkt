/**
 * Motor de ações v2 (H5 do relatório) — o que fazer esta semana. Puro.
 *
 * Cada regra tem id, dono, gatilho, amostra mínima, impacto e confiança, e vira
 * UMA frase com número e um link para onde se age. A ordem é severidade ×
 * impacto × confiança — mais a regra do farol, que continua valendo como regra
 * de ORDEM: C1 (gente sem o 1º contato, fora do prazo) vem primeiro sempre que
 * existir, porque essas pessoas já foram pagas, ainda dá para recuperá-las e
 * destravá-las não custa verba nova.
 *
 * Duas disciplinas herdadas do painel:
 *   • o motor decide com os MESMOS números do placar (`kpisDoPeriodo`) — nunca
 *     com um CPL ou um custo por reunião que a tela esconde (quarentena);
 *   • o impacto aparece em número inteiro e só com amostra; sem amostra a ação
 *     entra pela severidade e o rótulo diz "estimativa indisponível".
 *
 * A confiança cai quando um alerta de dado afeta a métrica da regra: dias sem
 * gasto (piso) e sync falhando derrubam as de mídia; registro em lote (C5)
 * derruba as de taxa do comercial.
 *
 * O estado (feita / ignorada com motivo) vale por SEMANA e vem de fora
 * (`acoes_estado`): na semana seguinte a ação é reavaliada do zero.
 *
 * As regras de conteúdo orgânico (cadência, formato, CTA) continuam em
 * `recommendations.ts` e aparecem em Conteúdo, não aqui.
 */

import type { Dono } from "./dono";
import { montarFila, type EntradaComercial, type EntradaConvite, type FilaResult } from "./fila";
import { custoExibivel, kpisDoPeriodo, periodoDaRegua, reguaDoPeriodo, type KpisDoPeriodo } from "./kpis";
import { metaVigente, taxasObservadas } from "./metas";
import {
  adsetPerformance,
  creativePerformance,
  dailySeries,
  filterLeads,
  lpKpis,
  rotuloCriativo,
  type DateRange,
} from "./metrics";
import type { Intervalo } from "./cobertura";
import { atribuidor } from "./atribuicao";
import { MIN_REUNIOES } from "./trust";
import { diasDoPeriodo, janelaAnterior, segundaDaSemana } from "./semana";
import {
  formatCurrency,
  formatCurrency0,
  formatDateShort,
  formatInt,
  formatPercent,
  formatarEspera,
} from "./format";
import type { AcaoEstado, DashboardData, LeadEvent } from "./types";

// ---------------------------------------------------------------- vocabulário

export type RegraId =
  | "C1" | "C2" | "C3" | "C4" | "C5"
  | "M1" | "M2" | "M3" | "M4" | "M5" | "M6" | "M7"
  | "L1" | "L2"
  | "D1" | "D2"
  | "G1";

/**
 * `agora` = já custou dinheiro e ainda dá para recuperar sem gastar mais;
 * `alta` = esta semana; `media` = otimizar; `baixa` = oportunidade.
 */
export type SeveridadeAcao = "agora" | "alta" | "media" | "baixa";
export type ConfiancaAcao = "alta" | "media" | "baixa";

export interface ImpactoAcao {
  valor: number;
  unidade: "reunioes" | "reunioes_semana" | "reais_semana";
  /** Pronto para a tela: "≈ 3 reuniões a mais por semana". */
  texto: string;
}

export interface Acao {
  /** Estável entre renders: regra + alvo ("M3:120003"). É a chave do estado. */
  id: string;
  regra: RegraId;
  dono: Dono;
  severidade: SeveridadeAcao;
  /** A frase com o número. */
  titulo: string;
  /** Por quê e o que fazer. */
  detalhe: string;
  href: string;
  impacto?: ImpactoAcao;
  /** Por que não há impacto estimado. */
  semImpacto?: string;
  confianca: ConfiancaAcao;
  confiancaMotivo?: string;
  amostra: { n: number; minimo: number };
  /** O que alguém decidiu sobre ela nesta semana. */
  estado?: AcaoEstado;
  /** O peso que ordenou a lista (severidade × impacto × confiança). */
  prioridade: number;
}

export interface EntradaMotor {
  data: DashboardData;
  range: DateRange | undefined;
  kpis: KpisDoPeriodo;
  /** Histórico dos leads da marca (tentativas, status) — sem ele, C1/C4/C5 ficam cegos. */
  eventos: LeadEvent[];
  /**
   * As filas do robô (convite pendente, transferidos sem 1º contato), quando ele
   * está ligado — a mesma entrada da página Fila, para o número da ação ser o
   * número que a página abre. Ausente ou vazio = robô desligado.
   */
  robo?: { convites: EntradaConvite[]; comercial: EntradaComercial[] };
  fontes?: {
    adsFalha?: { desde: string; erro: string } | null;
    /** Gasto sem marca nos últimos 30 dias. */
    gastoSemMarca?: number;
  };
  /** Estados da semana corrente (`listAcoesEstado`), qualquer ordem. */
  estados?: AcaoEstado[];
  /** Dias cobertos por syncs de anúncio bem-sucedidos (ADR-06) — D1 separa "parado" de "sem dado". */
  cobertura?: Intervalo[];
  /** ISO. */
  agora: string;
  /** AAAA-MM-DD (Brasília). */
  hoje: string;
}

// ---------------------------------------------------------------- réguas

/** Amostras mínimas por regra (o relatório fixa C3, M2 e M4; as outras seguem o mesmo espírito). */
export const AMOSTRA_MIN = {
  C2: 5,
  C3: 20,
  C5: 10,
  M1: 5,
  M2: MIN_REUNIOES,
  M4: 10,
  L1: 100,
  L2: 10,
} as const;

/** M1: CPL acima disto da média de 4 semanas dispara mesmo sem alvo. */
export const CPL_ACIMA_DA_MEDIA = 1.2;
/** M4: contato inválido acima disto é problema de formulário/segmentação. */
export const CONTATO_INVALIDO_MAX = 0.25;
/** M5: verba de descoberta acima disto do total pede uma meta de descoberta. */
export const DESCOBERTA_MAX = 0.3;
/** L1: visita → lead abaixo disto da média de 4 semanas. */
export const LP_QUEDA = 0.8;
/** L2: envios × leads divergindo mais que isto. */
export const DIVERGENCIA_LP = 0.15;
/** D1: dias cobertos pelo sync sem gasto, com a campanha ativa, a partir de. */
export const DIAS_SEM_GASTO_MIN = 2;
/** C5: status registrado mais de 72 h depois da entrada; lote = 10 em 15 min. */
export const ATRASO_REGISTRO_HORAS = 72;
export const ATRASO_REGISTRO_SHARE = 0.3;
export const LOTE_MIN = 10;
export const LOTE_JANELA_MIN = 15;

const PESO_SEVERIDADE: Record<SeveridadeAcao, number> = { agora: 4, alta: 3, media: 2, baixa: 1 };
const PESO_CONFIANCA: Record<ConfiancaAcao, number> = { alta: 1, media: 0.7, baixa: 0.4 };

/** Segunda-feira da semana de hoje: a chave do estado das ações. */
export const semanaDaAcao = (hoje: string) => segundaDaSemana(hoje);

/** Assinatura curta e determinística de um conjunto de ids (a identidade de uma ação por pessoas). */
export function assinatura(ids: string[]): string {
  let h = 5381;
  for (const ch of [...ids].sort().join("|")) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

// ---------------------------------------------------------------- helpers

const pct = (v: number) => formatPercent(v, v < 0.1 ? 1 : 0);
const plural = (n: number, um: string, muitos: string) => (n === 1 ? um : muitos);

interface Contexto extends EntradaMotor {
  semanas: number;
  observadas: ReturnType<typeof taxasObservadas>;
  /** A Fila de contato, montada aqui com a mesma função da página. */
  fila: FilaResult;
  /** Taxa lead → agendada de referência: a meta, senão a observada (com amostra). */
  taxaAgendada: number | null;
  registroEmLote: boolean;
}

/** Taxa lead → agendada que serve de régua para "quantas reuniões isso vale". */
function taxaAgendadaDeReferencia(c: Omit<Contexto, "taxaAgendada" | "registroEmLote">): number | null {
  const meta = metaVigente(c.data.metas, "taxa_lead_agendada", c.hoje)?.alvo;
  if (meta != null && meta > 0) return meta;
  return c.observadas.suficiente && c.observadas.a != null && c.observadas.a > 0 ? c.observadas.a : null;
}

/** Converte um impacto em R$/semana para reuniões/semana, para a ordenação comparar. */
function emReunioes(c: Contexto, imp?: ImpactoAcao): number {
  if (!imp) return 0;
  if (imp.unidade !== "reais_semana") return imp.valor;
  const cpr =
    metaVigente(c.data.metas, "custo_por_reuniao", c.hoje)?.alvo ??
    (custoExibivel(c.kpis.custoPorReuniao) ? c.kpis.custoPorReuniao.valor : null);
  return cpr && cpr > 0 ? imp.valor / cpr : 0;
}

function confiancaDeMidia(c: Contexto): { confianca: ConfiancaAcao; motivo?: string } {
  if (c.fontes?.adsFalha) return { confianca: "baixa", motivo: "a sincronização da Meta está falhando — o gasto pode estar incompleto" };
  if (c.kpis.trust.porMetrica.spend?.nivel === "piso") return { confianca: "media", motivo: "faltam dias de gasto no período (os valores são piso)" };
  return { confianca: "alta" };
}

function confiancaDoComercial(c: Contexto): { confianca: ConfiancaAcao; motivo?: string } {
  if (c.registroEmLote) return { confianca: "media", motivo: "há status registrados em lote ou com atraso — a taxa pode estar subnotificada" };
  return { confianca: "alta" };
}

// ---------------------------------------------------------------- regras

function regraC1(c: Contexto): Acao | null {
  // Quem espera o 1º contato além do prazo: "Novos" do painel (1 hora útil) e,
  // com o robô ligado, transferidos sem abordagem e convites sem resposta.
  const naEtapa = c.fila.itens.filter(
    (i) => i.etapa === "novo" || i.etapa === "aguardando-contato" || i.etapa === "convite-pendente",
  );
  const esperando = naEtapa.filter((i) => i.atraso > 1);
  if (esperando.length === 0) return null;
  const painel = esperando.filter((i) => i.etapa === "novo").length;
  const noRobo = esperando.length - painel;
  const total = esperando.length;
  const maisAntigo = Math.max(...esperando.map((i) => i.horasEsperando ?? 0));
  // Mídia já paga por essas pessoas: o CPL do painel por cabeça (o custo de um
  // lead; quem passou pelo robô custou ao menos isso).
  const cpl = custoExibivel(c.kpis.cpl) ? c.kpis.cpl.valor : 0;
  const midia = total * cpl;

  const href = painel > 0 && noRobo > 0 ? "/fila" : painel > 0 ? "/fila?etapa=novo" : "/fila?etapa=quentes";
  const taxa = c.taxaAgendada;
  const recuperaveis = taxa != null ? Math.round(total * taxa) : 0;
  const partes = [
    painel > 0 ? `${formatInt(painel)} do painel sem nenhuma tentativa além de 1 hora útil` : "",
    noRobo > 0 ? `${formatInt(noRobo)} ${plural(noRobo, "pessoa", "pessoas")} do robô além do prazo da etapa` : "",
  ].filter(Boolean);
  return {
    // O id carrega QUEM está esperando: "feita" vale para estas pessoas. Se
    // outras passarem do prazo (ou estas continuarem), a ação volta ao topo —
    // senão um "Feito" de segunda escondia cinco pessoas novas até domingo.
    id: `C1:${assinatura(esperando.map((i) => i.id))}`,
    regra: "C1",
    dono: "COM",
    severidade: "agora",
    titulo: `${formatInt(total)} ${plural(total, "lead", "leads")} sem 1º contato além do prazo — o mais antigo há ${formatarEspera(maisAntigo)}`,
    detalhe:
      `A Fila mostra ${formatInt(naEtapa.length)} esperando o 1º contato; ${formatInt(total)} já ${total === 1 ? "passou" : "passaram"} do prazo da etapa. ` +
      `${partes.join("; ")}. ` +
      (midia > 0 ? `${formatCurrency0(midia)} de mídia já paga esperando um contato. ` : "") +
      "Não custa verba nova: ligue primeiro para quem está há mais tempo.",
    href,
    impacto:
      recuperaveis >= 1
        ? { valor: recuperaveis, unidade: "reunioes", texto: `≈ ${formatInt(recuperaveis)} ${plural(recuperaveis, "reunião recuperável", "reuniões recuperáveis")}` }
        : undefined,
    semImpacto: recuperaveis >= 1 ? undefined : "estimativa indisponível (sem taxa lead → reunião com amostra)",
    confianca: "alta",
    amostra: { n: total, minimo: 1 },
    prioridade: 0,
  };
}

function regraC2(c: Contexto): Acao | null {
  const m = c.kpis.primeiroContatoNoPrazo;
  const meta = metaVigente(c.data.metas, "primeiro_contato_no_prazo", c.hoje)?.alvo;
  if (meta == null || m.n < AMOSTRA_MIN.C2 || m.valor >= meta) return null;
  const razao = m.valor / meta;
  const mediana = c.kpis.medianaPrimeiroContatoHoras;
  const conf = confiancaDoComercial(c);
  return {
    id: "C2",
    regra: "C2",
    dono: "COM",
    severidade: razao < 0.5 ? "alta" : "media",
    titulo: `Só ${pct(m.valor)} dos leads tiveram 1º contato em até 1 h útil (meta ${pct(meta)})`,
    detalhe:
      `${formatInt(m.n)} leads julgados no período` +
      (mediana != null ? `; a 1ª tentativa demora ${formatarEspera(mediana)} úteis na mediana` : "") +
      ". Quem tenta na 1ª hora qualifica ~7× mais que quem tenta uma hora depois: combine o aviso de lead novo com quem atende.",
    href: "/fila?etapa=novo",
    semImpacto: "estimativa indisponível (o painel não mede o efeito da velocidade em reuniões)",
    confianca: conf.confianca,
    confiancaMotivo: conf.motivo,
    amostra: { n: m.n, minimo: AMOSTRA_MIN.C2 },
    prioridade: 0,
  };
}

function regraC3(c: Contexto): Acao | null {
  const meta = metaVigente(c.data.metas, "taxa_lead_agendada", c.hoje);
  const o = c.observadas;
  if (!meta?.alvo || o.a == null || o.amostra.leads < AMOSTRA_MIN.C3 || o.a >= meta.alvo * 0.8) return null;
  const leadsPorSemana = o.amostra.leads / 8;
  const aMenos = leadsPorSemana * (meta.alvo - o.a);
  const inteiro = Math.round(aMenos);
  const conf = confiancaDoComercial(c);
  return {
    id: "C3",
    regra: "C3",
    dono: "COM",
    severidade: "alta",
    titulo:
      `Lead → agendada em ${pct(o.a)} contra meta de ${pct(meta.alvo)}` +
      (inteiro >= 1 ? `: cerca de ${formatInt(inteiro)} ${plural(inteiro, "reunião", "reuniões")} a menos por semana` : ""),
    detalhe: `Nas últimas 8 semanas: ${formatInt(o.amostra.leads)} leads, ${formatInt(o.amostra.agendadas)} agendadas. ${meta.provisoria ? "A meta é provisória (sem amostra quando foi calculada). " : ""}Olhe a cadência de tentativas e o roteiro do 1º contato antes de mexer na mídia.`,
    href: "/jornada",
    impacto: inteiro >= 1 ? { valor: inteiro, unidade: "reunioes_semana", texto: `≈ ${formatInt(inteiro)} ${plural(inteiro, "reunião", "reuniões")} a mais por semana` } : undefined,
    semImpacto: inteiro >= 1 ? undefined : "estimativa indisponível (menos de uma reunião por semana)",
    confianca: meta.provisoria && conf.confianca === "alta" ? "media" : conf.confianca,
    confiancaMotivo: conf.motivo ?? (meta.provisoria ? "a meta é provisória" : undefined),
    amostra: { n: o.amostra.leads, minimo: AMOSTRA_MIN.C3 },
    prioridade: 0,
  };
}

function regraC4(c: Contexto): Acao | null {
  const datas = c.fila.itens
    .filter((i) => i.etapa === "sem-desfecho")
    .map((i) => i.reuniao ?? i.desde ?? "")
    .filter(Boolean)
    .sort();
  if (datas.length === 0) return null;
  const n = datas.length;
  return {
    id: "C4",
    regra: "C4",
    dono: "COM",
    severidade: "alta",
    titulo: `${formatInt(n)} ${plural(n, "reunião", "reuniões")} com data passada sem registro de comparecimento (${n === 1 ? "" : "a primeira em "}${formatDateShort(datas[0])})`,
    detalhe:
      "Sem o desfecho, o comparecimento (a métrica de proteção da north star) fica sem base e a pessoa some da fila. Registre “Reunião realizada” ou “Não compareceu”.",
    href: "/fila?etapa=sem-desfecho",
    semImpacto: "estimativa indisponível (é registro, não conversão)",
    confianca: "alta",
    amostra: { n, minimo: 1 },
    prioridade: 0,
  };
}

/** C5 devolve também o sinal que rebaixa a confiança das taxas do comercial. */
function regraC5(c: Omit<Contexto, "registroEmLote" | "taxaAgendada">): Acao | null {
  const porLead = new Map(c.data.leads.map((l) => [l.id, l]));
  const mudancas = c.eventos
    .filter((e) => e.action === "status_changed" && porLead.has(e.leadId))
    .filter((e) => !c.range || (e.createdAt.slice(0, 10) >= c.range.from && e.createdAt.slice(0, 10) <= c.range.to))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (mudancas.length < AMOSTRA_MIN.C5) return null;

  // Registro em lote: um mesmo ator com LOTE_MIN registros em LOTE_JANELA_MIN minutos.
  let lote = 0;
  const porAtor = new Map<string, number[]>();
  for (const e of mudancas) porAtor.set(e.actor, [...(porAtor.get(e.actor) ?? []), Date.parse(e.createdAt)]);
  for (const ts of porAtor.values()) {
    for (let i = 0, j = 0; i < ts.length; i++) {
      while (ts[i] - ts[j] > LOTE_JANELA_MIN * 60_000) j++;
      lote = Math.max(lote, i - j + 1);
    }
  }
  // Registro atrasado: o status entrou mais de 72 h depois da entrada do lead.
  const atrasados = mudancas.filter(
    (e) => Date.parse(e.createdAt) - Date.parse(porLead.get(e.leadId)!.createdAt) > ATRASO_REGISTRO_HORAS * 3_600_000,
  ).length;
  const share = atrasados / mudancas.length;
  const emLote = lote >= LOTE_MIN;
  if (!emLote && share < ATRASO_REGISTRO_SHARE) return null;
  return {
    id: "C5",
    regra: "C5",
    dono: "GESTAO",
    severidade: "media",
    titulo: emLote
      ? `O funil deste período pode estar subnotificado: ${formatInt(lote)} status registrados em lote`
      : `${pct(share)} dos status do período foram registrados mais de 72 h depois da entrada`,
    detalhe:
      `${formatInt(mudancas.length)} mudanças de status no período` +
      (emLote ? `, ${formatInt(lote)} delas pelo mesmo usuário em ${LOTE_JANELA_MIN} minutos` : "") +
      (share > 0 ? `; ${pct(share)} com mais de 72 h de atraso` : "") +
      ". Registro tardio distorce o 1º contato, a taxa lead → reunião e a comparação entre semanas. Combine o registro no mesmo dia.",
    href: "/pessoas#historico",
    semImpacto: "estimativa indisponível (é qualidade de registro, não conversão)",
    confianca: "alta",
    amostra: { n: mudancas.length, minimo: AMOSTRA_MIN.C5 },
    prioridade: 0,
  };
}

function regraM1(c: Contexto): Acao | null {
  const cpl = c.kpis.cpl;
  if (!custoExibivel(cpl) || cpl.n < AMOSTRA_MIN.M1) return null;
  const alvo = metaVigente(c.data.metas, "cpl", c.hoje)?.alvo;
  let ref: { valor: number; origem: "alvo" | "media" } | null = null;
  if (alvo != null && alvo > 0) {
    if (cpl.valor <= alvo) return null;
    ref = { valor: alvo, origem: "alvo" };
  } else if (c.range) {
    const antes = kpisDoPeriodo(c.data, janelaAnterior(c.range, 28), { hoje: c.hoje, agora: c.agora, cobertura: c.cobertura }).cpl;
    // A média só é régua quando é um custo de verdade: com gasto zero (sync que
    // começou depois) a razão viraria infinita; com piso, a média real é maior.
    if (!custoExibivel(antes) || antes.n < AMOSTRA_MIN.M1 || !(antes.valor > 0) || antes.confianca) return null;
    if (cpl.valor <= antes.valor * CPL_ACIMA_DA_MEDIA) return null;
    ref = { valor: antes.valor, origem: "media" };
  }
  if (!ref) return null;
  const razao = cpl.valor / ref.valor;
  const leadsPorSemana = c.kpis.leadsConversao.valor / c.semanas;
  const aMais = (cpl.valor - ref.valor) * leadsPorSemana;
  const conf = confiancaDeMidia(c);
  return {
    id: "M1",
    regra: "M1",
    dono: "MKT",
    severidade: razao > 1.5 ? "alta" : "media",
    titulo:
      ref.origem === "alvo"
        ? `CPL de ${formatCurrency(cpl.valor)} contra alvo de ${formatCurrency(ref.valor)} (+${pct(razao - 1)})`
        : `CPL de ${formatCurrency(cpl.valor)} (+${pct(razao - 1)} contra a média de 4 semanas)`,
    detalhe: `${formatInt(cpl.n)} leads de conversão no período. Corte os criativos mais caros e realoque para os que trazem lead barato; o CPL do Pixel não entra nesta conta.`,
    href: "/dinheiro#criativos",
    impacto:
      aMais >= 1
        ? { valor: Math.round(aMais), unidade: "reais_semana", texto: `≈ ${formatCurrency0(aMais)} por semana a mais do que a régua` }
        : undefined,
    semImpacto: aMais >= 1 ? undefined : "estimativa indisponível",
    confianca: conf.confianca,
    confiancaMotivo: conf.motivo,
    amostra: { n: cpl.n, minimo: AMOSTRA_MIN.M1 },
    prioridade: 0,
  };
}

function regraM2(c: Contexto): Acao | null {
  const cpr = c.kpis.custoPorReuniao;
  const alvo = metaVigente(c.data.metas, "custo_por_reuniao", c.hoje)?.alvo;
  if (!custoExibivel(cpr) || alvo == null || alvo <= 0 || cpr.valor <= alvo) return null;
  const conjuntos = adsetPerformance(c.data, c.range).filter((a) => a.bucket === "conversao" && a.meetings >= MIN_REUNIOES && a.spend > 0);
  const pior = conjuntos.sort((a, b) => b.cpr - a.cpr)[0];
  const aMais = (cpr.valor - alvo) * (cpr.n / c.semanas);
  const conf = confiancaDeMidia(c);
  return {
    id: "M2",
    regra: "M2",
    dono: "MKT",
    severidade: "alta",
    titulo: `Custo por reunião de ${formatCurrency(cpr.valor)} contra alvo de ${formatCurrency(alvo)} (+${pct(cpr.valor / alvo - 1)})`,
    detalhe:
      `${formatInt(cpr.n)} reuniões de conversão no período. ` +
      (pior
        ? `O conjunto mais caro é “${pior.adset}” (${formatCurrency(pior.cpr)} por reunião, ${formatInt(pior.meetings)} reuniões): pause-o ou reduza a verba dele.`
        : "Nenhum conjunto tem 3 reuniões sozinho — compare pelo CPL do painel antes de pausar."),
    href: "/dinheiro#conjuntos",
    impacto:
      aMais >= 1
        ? { valor: Math.round(aMais), unidade: "reais_semana", texto: `≈ ${formatCurrency0(aMais)} por semana acima do alvo` }
        : undefined,
    semImpacto: aMais >= 1 ? undefined : "estimativa indisponível",
    confianca: conf.confianca,
    confiancaMotivo: conf.motivo,
    amostra: { n: cpr.n, minimo: AMOSTRA_MIN.M2 },
    prioridade: 0,
  };
}

function regrasM3(c: Contexto): Acao[] {
  const criativos = creativePerformance(c.data, c.range);
  const fadigados = criativos.filter((x) => x.fatigue.level === "fadigado" && x.spend > 0).sort((a, b) => b.spend - a.spend);
  const conf = confiancaDeMidia(c);
  return fadigados.slice(0, 2).map((x) => {
    const rotulo = rotuloCriativo(x, criativos);
    const caro = x.leadsPainel >= 5 && custoExibivel(c.kpis.cpl) && x.cplPainel >= c.kpis.cpl.valor * 1.5;
    const cpl = x.leadsPainel > 0 ? `CPL ${formatCurrency(x.cplPainel)} em ${formatInt(x.leadsPainel)} leads` : "nenhum lead do painel no período";
    return {
      id: `M3:${x.adId}`,
      regra: "M3",
      dono: "MKT",
      severidade: caro ? "alta" : "media",
      titulo: caro ? `Pause “${rotulo}”: fadigado e ${formatCurrency(x.cplPainel)} por lead` : `Renove a arte de “${rotulo}” (fadigando)`,
      detalhe: `${x.fatigue.reason}. ${cpl}. ${caro ? "Pause no Ads Manager e suba uma variação." : "Suba uma variação nova no mesmo conjunto antes que o custo dispare."}`,
      href: "/dinheiro#criativos",
      semImpacto: "estimativa indisponível (fadiga antecipa custo, não o mede)",
      confianca: conf.confianca,
      confiancaMotivo: conf.motivo,
      amostra: { n: x.impressions, minimo: 500 },
      prioridade: 0,
    } satisfies Acao;
  });
}

function regrasM4(c: Contexto): Acao[] {
  const leads = filterLeads(c.data.leads, c.range);
  const atribuir = atribuidor(c.data.creatives);
  const adToAdset = new Map<string, string>();
  for (const r of c.data.adDaily) if (!adToAdset.has(r.adId)) adToAdset.set(r.adId, r.adset);
  const porConjunto = new Map<string, { n: number; invalidos: number }>();
  const porAnuncio = new Map<string, { n: number; invalidos: number }>();
  for (const l of leads) {
    const adId = atribuir(l).adId;
    if (!adId) continue;
    const inv = l.status === "contato_invalido" ? 1 : 0;
    const a = porAnuncio.get(adId) ?? { n: 0, invalidos: 0 };
    porAnuncio.set(adId, { n: a.n + 1, invalidos: a.invalidos + inv });
    const adset = adToAdset.get(adId);
    if (!adset) continue;
    const s = porConjunto.get(adset) ?? { n: 0, invalidos: 0 };
    porConjunto.set(adset, { n: s.n + 1, invalidos: s.invalidos + inv });
  }
  const out: Acao[] = [];
  const conjuntosQueDispararam = new Set<string>();
  for (const [adset, v] of porConjunto) {
    if (v.n < AMOSTRA_MIN.M4 || v.invalidos / v.n <= CONTATO_INVALIDO_MAX) continue;
    conjuntosQueDispararam.add(adset);
    out.push({
      id: `M4:${adset}`,
      regra: "M4",
      dono: "MKT",
      severidade: "alta",
      titulo: `Conjunto “${adset}”: ${pct(v.invalidos / v.n)} de contatos inválidos — revisar formulário e segmentação`,
      detalhe: `${formatInt(v.invalidos)} de ${formatInt(v.n)} leads do período com telefone ou e-mail inválido. Lead que não existe custa como lead e nunca vira reunião.`,
      href: "/dinheiro#conjuntos",
      semImpacto: "estimativa indisponível",
      confianca: "alta",
      amostra: { n: v.n, minimo: AMOSTRA_MIN.M4 },
      prioridade: 0,
    });
  }
  const criativos = creativePerformance(c.data, c.range);
  for (const [adId, v] of porAnuncio) {
    if (v.n < AMOSTRA_MIN.M4 || v.invalidos / v.n <= CONTATO_INVALIDO_MAX) continue;
    if (conjuntosQueDispararam.has(adToAdset.get(adId) ?? "")) continue;
    const cr = criativos.find((x) => x.adId === adId);
    const nome = cr ? rotuloCriativo(cr, criativos) : adId;
    out.push({
      id: `M4:ad:${adId}`,
      regra: "M4",
      dono: "MKT",
      severidade: "alta",
      titulo: `Criativo “${nome}”: ${pct(v.invalidos / v.n)} de contatos inválidos — revisar formulário e segmentação`,
      detalhe: `${formatInt(v.invalidos)} de ${formatInt(v.n)} leads do período com telefone ou e-mail inválido.`,
      href: "/dinheiro#criativos",
      semImpacto: "estimativa indisponível",
      confianca: "alta",
      amostra: { n: v.n, minimo: AMOSTRA_MIN.M4 },
      prioridade: 0,
    });
  }
  return out;
}

function regraM5(c: Contexto): Acao | null {
  const total = c.kpis.investimento.valor;
  const desc = c.kpis.investimentoDescoberta.valor;
  if (!c.kpis.temDescoberta || total <= 0 || desc / total <= DESCOBERTA_MAX) return null;
  const temMetaDeDescoberta = c.data.goals.some((g) => g.metric === "followers" || g.metric === "alcance_base");
  if (temMetaDeDescoberta) return null;
  const conf = confiancaDeMidia(c);
  return {
    id: "M5",
    regra: "M5",
    dono: "MKT",
    severidade: "media",
    titulo: `${pct(desc / total)} da verba (${formatCurrency0(desc)}) em descoberta, sem meta de seguidores ou alcance`,
    detalhe: "Verba de descoberta não gera lead e sai do CPL — sem uma meta própria, não há como dizer se está valendo. Cadastre a meta de seguidores (ou de alcance) ou reduza a fatia.",
    href: "/config#metas-conteudo",
    semImpacto: "estimativa indisponível",
    confianca: conf.confianca,
    confiancaMotivo: conf.motivo,
    amostra: { n: Math.round(total), minimo: 1 },
    prioridade: 0,
  };
}

/** Além do relatório: o vencedor com amostra, para escalar (regra v1 que continua valendo). */
function regraM6(c: Contexto): Acao | null {
  if (!custoExibivel(c.kpis.custoPorReuniao)) return null;
  const criativos = creativePerformance(c.data, c.range);
  const vencedor = criativos
    .filter((x) => x.meetings >= MIN_REUNIOES && x.spend > 0 && x.fatigue.level !== "fadigado")
    .sort((a, b) => a.cpr - b.cpr)[0];
  if (!vencedor) return null;
  const conf = confiancaDeMidia(c);
  return {
    id: `M6:${vencedor.adId}`,
    regra: "M6",
    dono: "MKT",
    severidade: "baixa",
    titulo: `Escale “${rotuloCriativo(vencedor, criativos)}”: ${formatCurrency(vencedor.cpr)} por reunião`,
    detalhe: `${formatInt(vencedor.meetings)} reuniões e ${formatInt(vencedor.leadsPainel)} leads no período. Aumente o orçamento 10–20% e observe 48–72 h.`,
    href: "/dinheiro#criativos",
    semImpacto: "estimativa indisponível",
    confianca: conf.confianca,
    confiancaMotivo: conf.motivo,
    amostra: { n: vencedor.meetings, minimo: MIN_REUNIOES },
    prioridade: 0,
  };
}

/** Além do relatório: a verba de conversão fora do ritmo da meta (a régua da Fase 4). */
function regraM7(c: Contexto): Acao | null {
  const linha = reguaDoPeriodo(c.kpis, c.data, c.range, c.hoje).find((l) => l.metrica === "investimento_conversao");
  if (!linha?.avaliacao || linha.avaliacao.status !== "vermelho" || linha.alvo == null) return null;
  const abaixo = linha.avaliacao.razao < 1;
  const conf = confiancaDeMidia(c);
  return {
    id: "M7",
    regra: "M7",
    dono: "MKT",
    severidade: "media",
    titulo: `Verba de conversão ${abaixo ? "abaixo" : "acima"} do ritmo: ${formatCurrency0(linha.medida.valor)} contra ${formatCurrency0(linha.alvo)} previstos (${pct(linha.avaliacao.razao)})`,
    detalhe: abaixo
      ? "Verba parada não gera lead: confira se a campanha está entregando (pausa, aprendizado, limite diário)."
      : "Acima do previsto o orçamento acaba antes da semana: reduza o limite diário ou revise a meta.",
    href: "/dinheiro",
    semImpacto: "estimativa indisponível",
    confianca: conf.confianca,
    confiancaMotivo: conf.motivo,
    amostra: { n: Math.round(linha.medida.valor), minimo: 1 },
    prioridade: 0,
  };
}

function regraL1(c: Contexto): Acao | null {
  if (!c.range) return null;
  const agora = lpKpis(c.data, c.range);
  const antes = lpKpis(c.data, janelaAnterior(c.range, 28));
  if (agora.visits < AMOSTRA_MIN.L1 || antes.visits < AMOSTRA_MIN.L1) return null;
  if (antes.visitToLead <= 0 || agora.visitToLead >= antes.visitToLead * LP_QUEDA) return null;
  const visitasPorSemana = agora.visits / c.semanas;
  const taxa = c.taxaAgendada;
  const reunioes = taxa != null ? visitasPorSemana * (antes.visitToLead - agora.visitToLead) * taxa : 0;
  const inteiro = Math.round(reunioes);
  return {
    id: "L1",
    regra: "L1",
    dono: "LP",
    severidade: "media",
    titulo: `Visita → lead caiu para ${pct(agora.visitToLead)} (média de 4 semanas: ${pct(antes.visitToLead)})`,
    detalhe: `${formatInt(agora.visits)} visitas e ${formatInt(agora.formSubmits)} envios no período. Confira o formulário, a velocidade da página e se o anúncio promete o que a página entrega.`,
    href: "/jornada",
    impacto: inteiro >= 1 ? { valor: inteiro, unidade: "reunioes_semana", texto: `≈ ${formatInt(inteiro)} ${plural(inteiro, "reunião", "reuniões")} a mais por semana` } : undefined,
    semImpacto: inteiro >= 1 ? undefined : "estimativa indisponível (menos de uma reunião por semana)",
    confianca: "alta",
    amostra: { n: agora.visits, minimo: AMOSTRA_MIN.L1 },
    prioridade: 0,
  };
}

function regraL2(c: Contexto): Acao | null {
  const lp = lpKpis(c.data, c.range);
  const leads = c.kpis.leads.valor;
  if (lp.formSubmits < AMOSTRA_MIN.L2 || leads < AMOSTRA_MIN.L2) return null;
  const diff = (leads - lp.formSubmits) / Math.max(lp.formSubmits, leads);
  if (Math.abs(diff) <= DIVERGENCIA_LP) return null;
  return {
    id: "L2",
    regra: "L2",
    dono: "DADOS",
    severidade: "alta",
    titulo: `A landing page registrou ${formatInt(lp.formSubmits)} envios e o painel ${formatInt(leads)} leads (${diff > 0 ? "+" : "−"}${pct(Math.abs(diff))})`,
    detalhe:
      "Reenvios da mesma pessoa viram um lead só, então alguma diferença é normal. Acima de 15%, confira o rastreio (/api/track), a chave TRACK_INGEST_KEY e se a LP manda todos os campos.",
    href: "/config#integracoes",
    semImpacto: "estimativa indisponível",
    confianca: "alta",
    amostra: { n: Math.max(lp.formSubmits, leads), minimo: AMOSTRA_MIN.L2 },
    prioridade: 0,
  };
}

function regraD1(c: Contexto): Acao | null {
  if (c.fontes?.adsFalha) {
    return {
      id: "D1",
      regra: "D1",
      dono: "DADOS",
      severidade: "alta",
      titulo: `A sincronização da Meta está falhando desde ${formatDateShort(c.fontes.adsFalha.desde)}`,
      detalhe: `${c.fontes.adsFalha.erro} Enquanto isso, investimento, CPL e custo por reunião param no último sync que deu certo.`,
      href: "/config#integracoes",
      semImpacto: "estimativa indisponível",
      confianca: "alta",
      amostra: { n: 1, minimo: 1 },
      prioridade: 0,
    };
  }
  const trava = c.kpis.trust.travas.find((t) => t.id === "cobertura-de-dias");
  if (trava) {
    return {
      id: "D1",
      regra: "D1",
      dono: "DADOS",
      severidade: "media",
      titulo: trava.titulo,
      detalhe: trava.detalhe,
      href: trava.cta?.href ?? "/config#integracoes",
      semImpacto: "estimativa indisponível",
      confianca: "alta",
      amostra: { n: 1, minimo: 1 },
      prioridade: 0,
    };
  }
  // Campanha ativa, sync cobrindo os dias, e nenhum gasto: a verba está parada
  // (anúncio reprovado, limite da conta, conjunto pausado) — não é falta de dado.
  if (!c.range || !c.cobertura || c.data.campaign.status !== "ativa") return null;
  const parados = dailySeries(c.data, c.range, c.cobertura).filter((p) => p.date < c.hoje && p.semVeiculacao).length;
  if (parados < DIAS_SEM_GASTO_MIN) return null;
  return {
    id: "D1",
    regra: "D1",
    dono: "DADOS",
    severidade: "media",
    titulo: `${formatInt(parados)} dias do período sem nenhum gasto, com a campanha ativa`,
    detalhe:
      "O sync cobriu esses dias e não veio linha de anúncio: a Meta não entregou (conjunto pausado, anúncio reprovado, limite da conta). Confira no Ads Manager — verba parada não gera lead.",
    href: "/dinheiro",
    semImpacto: "estimativa indisponível",
    confianca: "alta",
    amostra: { n: parados, minimo: DIAS_SEM_GASTO_MIN },
    prioridade: 0,
  };
}

function regraD2(c: Contexto): Acao | null {
  const gasto = c.fontes?.gastoSemMarca ?? 0;
  if (gasto <= 0) return null;
  return {
    id: "D2",
    regra: "D2",
    dono: "DADOS",
    severidade: "media",
    titulo: `${formatCurrency0(gasto)} de gasto sem marca classificada (30 dias)`,
    detalhe: "Nenhuma regra de marca reivindica essas campanhas: o gasto está fora do investimento, do CPL e do custo por reunião de todas as marcas. Diga de quem são e reclassifique.",
    href: "/config#marcas",
    semImpacto: "estimativa indisponível",
    confianca: "alta",
    amostra: { n: Math.round(gasto), minimo: 1 },
    prioridade: 0,
  };
}

function regraG1(c: Contexto): Acao | null {
  const tem = (m: Parameters<typeof metaVigente>[1]) => metaVigente(c.data.metas, m, c.hoje) != null;
  const semMetas = !tem("reunioes_agendadas") && !tem("cpl") && !tem("custo_por_reuniao");
  if (semMetas) {
    return {
      id: "G1",
      regra: "G1",
      dono: "GESTAO",
      severidade: "alta",
      titulo: "Sem metas, o painel não colore nada — cadastre pela calculadora",
      detalhe: "Reuniões, CPL e custo por reunião ficam sem verde nem vermelho, e metade das ações desta lista não tem régua para disparar. Leva 2 minutos em Ajustes → Metas.",
      href: "/config#metas",
      semImpacto: "estimativa indisponível",
      confianca: "alta",
      amostra: { n: 0, minimo: 0 },
      prioridade: 0,
    };
  }
  if (!tem("investimento_conversao") && c.data.campaign.budgetTotal <= 0) {
    return {
      id: "G1",
      regra: "G1",
      dono: "GESTAO",
      severidade: "media",
      titulo: "Sem orçamento de conversão cadastrado, o ritmo da verba não tem régua",
      detalhe: "Cadastre o orçamento semanal de conversão (a calculadora sugere um) para o painel dizer se a verba está no ritmo.",
      href: "/config#metas",
      semImpacto: "estimativa indisponível",
      confianca: "alta",
      amostra: { n: 0, minimo: 0 },
      prioridade: 0,
    };
  }
  return null;
}

// ---------------------------------------------------------------- o motor

/**
 * As ações da semana, ordenadas. Abertas primeiro (C1 à frente de todas), depois
 * as feitas e as ignoradas — que continuam na lista completa, só não disputam o
 * topo.
 */
export function motorDeAcoes(e: EntradaMotor): Acao[] {
  // "Campanha inteira" = do primeiro dado até hoje (a mesma régua do placar).
  const semanas = diasDoPeriodo(periodoDaRegua(e.data, e.range, e.hoje)) / 7;
  const observadas = taxasObservadas(e.data, e.hoje, e.agora);
  const fila = montarFila({
    nowIso: e.agora,
    leads: e.data.leads,
    eventos: e.eventos,
    convites: e.robo?.convites ?? [],
    comercial: e.robo?.comercial ?? [],
  });
  const base = { ...e, semanas, observadas, fila };
  const c5 = regraC5(base);
  const c: Contexto = {
    ...base,
    taxaAgendada: taxaAgendadaDeReferencia(base),
    registroEmLote: c5 != null,
  };

  const acoes: Acao[] = [
    regraC1(c),
    regraC2(c),
    regraC3(c),
    regraC4(c),
    c5,
    regraM1(c),
    regraM2(c),
    ...regrasM3(c),
    ...regrasM4(c),
    regraM5(c),
    regraM6(c),
    regraM7(c),
    regraL1(c),
    regraL2(c),
    regraD1(c),
    regraD2(c),
    regraG1(c),
  ].filter((a): a is Acao => a != null);

  // O estado da semana: a última decisão por ação.
  const porAcao = new Map<string, AcaoEstado>();
  for (const s of [...(e.estados ?? [])].sort((a, b) => a.em.localeCompare(b.em))) porAcao.set(s.acao, s);
  for (const a of acoes) {
    const s = porAcao.get(a.id);
    if (s && s.estado !== "reaberta") a.estado = s;
    a.prioridade = PESO_SEVERIDADE[a.severidade] * (1 + emReunioes(c, a.impacto)) * PESO_CONFIANCA[a.confianca];
  }

  return acoes.sort((a, b) => {
    const abertaA = a.estado ? 1 : 0;
    const abertaB = b.estado ? 1 : 0;
    if (abertaA !== abertaB) return abertaA - abertaB;
    // A regra do farol: gente parada vence qualquer custo.
    if ((a.regra === "C1") !== (b.regra === "C1")) return a.regra === "C1" ? -1 : 1;
    return b.prioridade - a.prioridade || a.id.localeCompare(b.id);
  });
}

/** As ações abertas (sem feita/ignorada nesta semana). */
export const acoesAbertas = (acoes: Acao[]) => acoes.filter((a) => !a.estado);

/** O que o briefing da IA recebe: só o essencial, sem recalcular. */
export function resumoDasAcoes(acoes: Acao[]): { regra: RegraId; dono: Dono; severidade: SeveridadeAcao; titulo: string; estado?: string }[] {
  return acoes.map((a) => ({
    regra: a.regra,
    dono: a.dono,
    severidade: a.severidade,
    titulo: a.titulo,
    estado: a.estado?.estado,
  }));
}
