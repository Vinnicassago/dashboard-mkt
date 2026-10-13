/**
 * Funil (Fase 6.2, J1 do relatório) — "onde exatamente estamos perdendo
 * reuniões?". Puro: recebe os dados e os KPIs, devolve o que a tela imprime.
 *
 * O que mora aqui, e por quê:
 *
 * - DOIS FUNIS com escopo próprio (S16). O de CONVERSÃO sai da cascata
 *   (`montarCascata`: impressões SÓ de campanhas de conversão → visitas → leads →
 *   1º contato → agendadas → realizadas → vendas); o de DESCOBERTA lê a conta do
 *   Instagram (`igAccountTotals`): alcance → visitas ao perfil → seguidores. Os
 *   dois nunca dividem um custo: a verba de conversão paga leads, a de descoberta
 *   paga seguidores.
 * - DUAS VISTAS do mesmo funil. "Por período (eventos)" conta o que ACONTECEU no
 *   período (reunião marcada pela data do agendamento — a north star); "por coorte"
 *   segue os leads que ENTRARAM no período até onde chegaram. De Leads para baixo
 *   as etapas do PAINEL (1º contato, reuniões, realizadas, vendas) são montadas
 *   aqui, pela vista, com ou sem robô; as do robô e do atendimento — contagens da
 *   campanha inteira, de outro sistema — vão num BLOCO separado, e com período
 *   definido não dividem a verba nem os leads dele (numerador e denominador de
 *   janelas diferentes). Reunião realizada e negócio fechado são o MESMO fato no
 *   painel e no atendimento: um número só, o do painel (o único com data), e o do
 *   atendimento vira nota na etapa quando não bate — nunca duas linhas com dois
 *   números. "X% da anterior" só entre populações ANINHADAS: o 1º
 *   contato é ramo paralelo (quem agenda direto não passa por ele), então a taxa
 *   de reuniões é sobre LEADS — e nunca passa de 100%.
 * - TENDÊNCIA das três taxas, semana a semana, com `kpisDoPeriodo` + `lpKpis`:
 *   o ponto do gráfico é o número do KPI daquela semana (ADR-03).
 * - COORTES com TODAS as semanas, inclusive as de 0 lead (B21), e a partição
 *   perdas + abertos + ganhos = leads, que é o que deixa a tabela conferível.
 * - PERDAS CONFIÁVEIS (B20): sem testes, sem duplicados, e quem chegou a agendar
 *   nunca é "perda sem reunião". "Onde atacar" é uma REGRA explícita, não um
 *   rótulo fixo por status; a confiança do registro cai quando os status do
 *   período entraram em lote ou com atraso (as réguas são as do motor, C5).
 *
 * A resposta da página — onde trava, com dono e impacto — é o MESMO gargalo da
 * Bússola (`lib/gargalo.ts`); aqui só a frase é montada.
 */

import { AMOSTRA_MINIMA, montarCascata, type CascataComercial, type CascataResult, type CascataRobo, type Degrau, type Fonte } from "./cascata";
import { eventosPorLead, resumoContato } from "./contato";
import { DONO_LABEL, type Dono } from "./dono";
import type { FilaEtapa } from "./fila";
import { FILA_ETAPAS } from "./fila";
import { textoDoImpacto, type Gargalo } from "./gargalo";
import { somarHorasUteis } from "./horario-util";
import { gruposDuplicados, pareceTeste } from "./identidade";
import { custoExibivel, kpisDoPeriodo, reguaDoPeriodo, type KpisDoPeriodo } from "./kpis";
import { LEAD_STATUS_META, LOST_STATUSES, MOTIVOS_CONTATO_INVALIDO, TENTATIVAS_PARA_SEM_RESPOSTA, isLostStatus } from "./lead-status";
import { META_DEF, type AvaliacaoMeta } from "./metas";
import {
  bucketOfAd,
  cohortWeekly,
  countAttended,
  countClients,
  dayOf,
  everBooked,
  filterAds,
  filterLeads,
  igAccountTotals,
  inRange,
  isAttended,
  isClient,
  lpKpis,
  previousRange,
  type DateRange,
} from "./metrics";
import { AMOSTRA_MIN, ATRASO_REGISTRO_HORAS, ATRASO_REGISTRO_SHARE, LOTE_JANELA_MIN, LOTE_MIN } from "./motor";
import { formatInt, formatPercent } from "./format";
import { segundaDaSemana, somarDias, ultimasSemanas } from "./semana";
import { diaCoberto, type Intervalo } from "./cobertura";
import type { MetricaId } from "./dicionario";
import type { DashboardData, Lead, LeadEvent, LeadStatus, MetricaComMeta } from "./types";

// ---------------------------------------------------------------- vistas

/**
 * `periodo` = o que aconteceu NO período (eventos, pela data do fato);
 * `coorte` = dos leads que ENTRARAM no período, até onde chegaram.
 */
export type VistaFunil = "periodo" | "coorte";

export const VISTAS_DO_FUNIL: { key: VistaFunil; label: string; hint: string }[] = [
  {
    key: "periodo",
    label: "Por período (eventos)",
    hint: "O que aconteceu no período: leads que entraram, reuniões marcadas, realizadas e vendas pela data do fato.",
  },
  {
    key: "coorte",
    label: "Por coorte (semana de entrada)",
    hint: "Dos leads que entraram no período, até onde chegaram — em qualquer data.",
  },
];

/** A vista da URL (`?vista=coorte`); qualquer outra coisa é a de período. */
export function vistaDoFunil(raw?: string | null): VistaFunil {
  return raw === "coorte" ? "coorte" : "periodo";
}

// ---------------------------------------------------------------- a resposta

/**
 * A linha de resposta — o gargalo com dono e impacto, nas MESMAS palavras do
 * bloco "Onde trava" da Bússola (`components/kpi/onde-trava.tsx`).
 */
export function fraseDoGargalo(g: Gargalo | null): { titulo: string; detalhe: string } {
  if (!g) {
    return {
      titulo: "Sem gargalo para apontar",
      detalhe: "nenhuma transição com amostra e uma régua (meta ou média de 8 semanas).",
    };
  }
  const t = g.transicao;
  const regua = t.referencia!.origem === "meta" ? "meta de" : "média de 8 semanas de";
  return {
    titulo: `Gargalo: ${t.rotulo}`,
    // As mesmas casas do "Onde trava": uma abaixo de 10%, nenhuma acima.
    detalhe: `(${DONO_LABEL[t.dono]}) — ${formatPercent(t.taxa!, t.taxa! < 0.1 ? 1 : 0)} contra ${regua} ${formatPercent(t.referencia!.taxa, t.referencia!.taxa < 0.1 ? 1 : 0)}. ${textoDoImpacto(g)}.`,
  };
}

// ---------------------------------------------------------------- funil de conversão

/** Meta (ou taxa sem meta) colada a uma etapa — serializável, pronta para o badge. */
export interface MetaDaEtapa {
  metrica: MetricaComMeta;
  nome: string;
  formato: "int" | "moeda" | "pct";
  valor: number;
  n: number;
  alvo?: number;
  avaliacao?: AvaliacaoMeta;
  provisoria?: boolean;
}

export interface EtapaFunil {
  key: string;
  label: string;
  /** `null` = sem leitura (fontes divergem, robô fora do ar). */
  valor: number | null;
  fonte: Fonte;
  dono?: Dono;
  ehAncora?: boolean;
  trocaDeSistema?: boolean;
  /**
   * Conversão da etapa anterior (0–1) — só entre populações aninhadas, com
   * amostra e leitura; nunca acima de 1. Ausente, `semTaxa` diz por quê.
   */
  daAnterior?: number;
  /** Sobre quem a taxa é quando não é a etapa logo acima ("dos leads"); ausente = "da anterior". */
  baseDaTaxa?: string;
  /** Por que não há "X% da anterior": populações que não se aninham (eventos do período, campanha inteira…). */
  semTaxa?: string;
  /** A entrada do dicionário que define este número (o ⓘ da tela), quando existe. */
  dica?: MetricaId;
  /** "R$ 12,30 por lead" — só com amostra; o custo por reunião segue `custoExibivel`. */
  custo?: { valor: number; prefixo?: "≥" | "≤"; rotulo: string; dica?: MetricaId };
  meta?: MetaDaEtapa;
  /** O mesmo número no período anterior (só com período concreto e fonte do painel). */
  anterior?: number;
  nota?: string;
  /** Quem está parado na junta que leva a esta etapa, e onde a Fila os lista. */
  parados?: number;
  etapaFila?: FilaEtapa;
}

export interface EntradaFunil {
  data: DashboardData;
  range: DateRange | undefined;
  /** Os KPIs do período (`kpisDoPeriodo`). */
  kpis: KpisDoPeriodo;
  /** `null` quando o robô está desligado ou a leitura falhou (como na cascata). */
  robo: CascataRobo | null;
  comercial: CascataComercial | null;
  vista: VistaFunil;
  /** AAAA-MM-DD (Brasília) e ISO. */
  hoje: string;
  agora: string;
}

/** As etapas do robô e do atendimento, fora da coluna do painel. */
export interface BlocoFunil {
  titulo: string;
  nota?: string;
  etapas: EtapaFunil[];
}

export interface FunilConversao {
  vista: VistaFunil;
  /** O funil do painel: Meta → LP → painel, nas duas vistas. */
  etapas: EtapaFunil[];
  /** Robô/atendimento ligados: as etapas deles, como bloco separado (contagens da campanha inteira). */
  bloco?: BlocoFunil;
  investimentoConversao: number;
  /** A cascata de origem (notas, vazamento, Pixel). */
  cascata: CascataResult;
}

const ROTULO_CUSTO: Record<string, string> = {
  visitas: "por visita",
  leads: "por lead",
  reunioes: "por reunião",
  conversas: "por conversa",
  responderam: "por resposta",
  convite: "por convite",
  transferidos: "por transferido",
  abordados: "por abordado",
};

/** Leads com 1ª tentativa registrada — na coorte (quem entrou) ou no período (quando aconteceu). */
function primeiroContatoRegistrado(data: DashboardData, range: DateRange | undefined, vista: VistaFunil): number {
  if (vista === "coorte") return filterLeads(data.leads, range).filter((l) => l.firstContactAt).length;
  return data.leads.filter((l) => l.firstContactAt && inRange(dayOf(l.firstContactAt), range)).length;
}

/** Reuniões que ACONTECERAM no período (pela data da reunião) e vendas fechadas nele. */
function eventosNoPeriodo(data: DashboardData, range: DateRange | undefined) {
  const realizadas = data.leads.filter((l) => isAttended(l) && inRange(dayOf(l.attendedAt ?? l.meetingFor ?? l.createdAt), range)).length;
  const vendas = data.leads.filter((l) => isClient(l) && inRange(dayOf(l.closedAt ?? l.createdAt), range)).length;
  return { realizadas, vendas };
}

/** Um degrau da cascata traduzido em etapa — os números vêm como estão. */
function traduzDegrau(d: Degrau): EtapaFunil {
  return {
    key: d.key,
    label: d.label,
    valor: d.valor,
    fonte: d.fonte,
    dono: d.dono,
    ehAncora: d.ehAncora,
    trocaDeSistema: d.trocaDeSistema,
    daAnterior: d.daAnterior,
    nota: d.nota,
    dica: d.key === "leads" ? "leads" : undefined,
    custo:
      d.custoUnitario !== undefined
        ? { valor: d.custoUnitario, prefixo: d.custoPrefixo, rotulo: ROTULO_CUSTO[d.key] ?? "cada", dica: d.key === "leads" ? "cpl" : undefined }
        : undefined,
    parados: d.parados,
    etapaFila: d.etapaFila,
  };
}

/** A vista de período conta EVENTOS de leads de qualquer data: não há "fração da etapa acima". */
export const SEM_TAXA_PERIODO = "sem taxa: eventos do período, de leads de qualquer data";
/** Mais gente que na base: não é a mesma população (ex.: quem agenda sem tentativa registrada). */
export const SEM_TAXA_NAO_ANINHADA = "sem taxa: mais gente que na etapa acima — não é a mesma população";
/** O robô e o atendimento não guardam data: a contagem deles não é fração dos leads do período. */
export const SEM_TAXA_CAMPANHA_INTEIRA = "sem taxa: contagem da campanha inteira, não dos leads do período";

/**
 * "X% da anterior" só entre populações ANINHADAS — quem chegou aqui é parte de
 * quem estava na base. Abaixo da amostra não é taxa (a tela diz "taxa sem
 * amostra"); mais gente que na base é outra população, e a tela diz isso em vez
 * de imprimir "166,7% da anterior".
 */
function taxaAninhada(et: EtapaFunil, base: number | null | undefined, rotulo?: string): void {
  et.daAnterior = undefined;
  if (et.valor == null || base == null || base < AMOSTRA_MINIMA) return;
  if (et.valor > base) {
    et.semTaxa = SEM_TAXA_NAO_ANINHADA;
    return;
  }
  et.daAnterior = et.valor / base;
  if (rotulo) et.baseDaTaxa = rotulo;
}

/**
 * O atendimento afirma sobre o MESMO fato que uma etapa do painel (reunião
 * realizada, negócio fechado). Um número por fato: a etapa é do PAINEL — o único
 * que tem data, então o único que corta período e coorte —, e o do atendimento só
 * aparece, como nota na própria etapa, quando os dois não batem na campanha
 * inteira (o escopo que os dois têm). Atendimento ACIMA do painel é divergência:
 * o painel não tem registro do que o atendimento diz que aconteceu. Sem período
 * os dois números falam do mesmo escopo, então a etapa vira "—" e a nota nomeia
 * os dois — a regra da cascata; com período, o número da etapa é o do painel
 * (não há outro que leia o período) e a nota diz que as fontes discordam.
 * Atendimento ABAIXO do painel não contradiz: ele só vê quem passou pelo
 * especialista — a nota diz isso, sem escolher lado.
 */
function cruzarComAtendimento(
  et: EtapaFunil,
  atendimento: number,
  painelNaCampanha: number,
  comPeriodo: boolean,
  unidade: [singular: string, plural: string],
): void {
  if (atendimento === painelNaCampanha) return;
  const qtd = `${formatInt(atendimento)} ${atendimento === 1 ? unidade[0] : unidade[1]}`;
  const juntar = (texto: string) => {
    et.nota = et.nota ? `${et.nota} · ${texto}` : texto;
  };
  if (atendimento < painelNaCampanha) {
    juntar(`o atendimento registra ${qtd} na campanha inteira — só quem passou pelo especialista`);
    return;
  }
  if (!comPeriodo) {
    et.valor = null;
    et.daAnterior = undefined;
    et.baseDaTaxa = undefined;
    et.semTaxa = undefined;
    et.nota = `o atendimento registra ${qtd} e o painel conta ${formatInt(painelNaCampanha)} — as fontes discordam`;
    return;
  }
  juntar(
    `na campanha inteira, o atendimento registra ${qtd} e o painel, ${formatInt(painelNaCampanha)} — as fontes discordam; o atendimento não guarda data, então o número do período é só o do painel`,
  );
}

/**
 * Traduz os degraus da cascata nas etapas do funil, na vista pedida. O funil do
 * PAINEL (Meta → LP → painel) existe nas duas vistas, com ou sem robô: de Leads
 * para baixo as etapas são montadas AQUI, pela vista — não pelo que a cascata
 * trouxe (ela só conhece a coorte). As etapas do robô e do atendimento viram um
 * BLOCO separado: contagens da campanha inteira, de outro sistema, que não cabem
 * numa coluna que lê o período.
 */
function etapasDaCascata(degraus: Degrau[], e: EntradaFunil): { etapas: EtapaFunil[]; bloco?: BlocoFunil } {
  const { data, range, kpis, comercial, vista } = e;
  const periodo = vista === "periodo";
  const etapas: EtapaFunil[] = [];
  const doRobo: EtapaFunil[] = [];

  for (const d of degraus) {
    // Envios de formulário são EVENTOS, não pessoas: viram nota de medição.
    if (d.key === "envios") continue;
    // O fundo do painel é montado abaixo, pela vista.
    if (d.key === "reunioes" || d.key === "compareceu" || d.key === "clientes") continue;
    // Reunião realizada e negócio fechado do atendimento são os MESMOS fatos de
    // "Reuniões realizadas" e "Vendas" do painel: no bloco, o card imprimia o
    // mesmo fato duas vezes ("0" no painel, "3" no atendimento) sem nada que os
    // ligasse. O número fica no painel e o do atendimento vira nota nele.
    if (d.key === "reuniao" || d.key === "negocio") continue;
    (d.fonte === "robo" || d.fonte === "comercial" ? doRobo : etapas).push(traduzDegrau(d));
  }

  // Topo: impressões → visitas → leads, cada uma fração da que ficou acima
  // (sem "envios" no meio, Leads é fração das visitas).
  for (let i = 1; i < etapas.length; i++) taxaAninhada(etapas[i], etapas[i - 1].valor);

  const leadCount = kpis.leads.valor;
  const ev = periodo ? eventosNoPeriodo(data, range) : undefined;

  // 1º contato: a etapa do comercial que o relatório pede — e um RAMO PARALELO
  // (`TRANSICOES.lead` inclui "agendado": quem agenda direto não passa por ela).
  // Sem a mesa do atendimento, quem ainda não teve tentativa está parado aqui (a
  // aba "Novos" da Fila) — a mesma regra da cascata; com ela, quem espera
  // aparece no bloco (aguardando abordagem), e contar aqui também seria dobrar.
  const semContato = comercial ? 0 : data.leads.filter((l) => l.status === "lead").length;
  const contato: EtapaFunil = {
    key: "primeiro_contato",
    label: "1º contato registrado",
    valor: primeiroContatoRegistrado(data, range, vista),
    fonte: "crm",
    dono: "COM",
    parados: semContato > 0 ? semContato : undefined,
    etapaFila: semContato > 0 ? "novo" : undefined,
    nota: periodo
      ? "tentativas de 1º contato feitas no período, pela data da 1ª tentativa"
      : "dos leads que entraram no período, quantos já tiveram uma tentativa de contato",
  };
  if (periodo) contato.semTaxa = SEM_TAXA_PERIODO;
  else taxaAninhada(contato, leadCount);
  etapas.push(contato);

  // Reuniões: por período, as AGENDADAS no período (a north star) com o custo por
  // reunião do dicionário; por coorte, "Agendaram" — e a taxa é sobre LEADS,
  // pulando o ramo paralelo (o mesmo "lead → reunião" dos KPIs).
  const reunioes: EtapaFunil = periodo
    ? {
        key: "reunioes",
        label: "Reuniões agendadas",
        dica: "reunioes_agendadas",
        valor: kpis.reunioesAgendadas.valor,
        fonte: "crm",
        dono: "COM",
        nota: "marcadas no período, pela data do agendamento — a north star",
        semTaxa: SEM_TAXA_PERIODO,
      }
    : {
        key: "reunioes",
        label: "Agendaram reunião",
        dica: "agendaram",
        valor: kpis.agendaram.valor,
        fonte: "crm",
        dono: "COM",
        nota: "dos leads que entraram no período, em qualquer data",
      };
  if (periodo) {
    // A régua única da quarentena (`custoExibivel`): abaixo dela, sem custo.
    if (custoExibivel(kpis.custoPorReuniao)) {
      reunioes.custo = {
        valor: kpis.custoPorReuniao.valor,
        prefixo: kpis.custoPorReuniao.confianca ? (kpis.custoPorReuniao.confianca.nivel === "piso" ? "≥" : "≤") : undefined,
        rotulo: ROTULO_CUSTO.reunioes,
        dica: "custo_por_reuniao",
      };
    }
  } else if (leadCount >= AMOSTRA_MINIMA) {
    reunioes.daAnterior = kpis.taxaLeadAgendada.valor;
    reunioes.baseDaTaxa = "dos leads";
  }
  etapas.push(reunioes);

  const compareceu: EtapaFunil = {
    key: "compareceu",
    label: "Reuniões realizadas",
    valor: periodo ? ev!.realizadas : kpis.overview.attended,
    fonte: "crm",
    dono: "COM",
    nota: periodo ? "pela data em que a reunião aconteceu" : "dos leads que entraram no período",
  };
  if (periodo) compareceu.semTaxa = SEM_TAXA_PERIODO;
  else taxaAninhada(compareceu, reunioes.valor);
  if (comercial) cruzarComAtendimento(compareceu, comercial.reunioesRealizadas, countAttended(data.leads), !!range, ["reunião realizada", "reuniões realizadas"]);
  etapas.push(compareceu);

  const clientes: EtapaFunil = {
    key: "clientes",
    label: "Vendas",
    valor: periodo ? ev!.vendas : kpis.overview.clients,
    fonte: "crm",
    dono: "COM",
    nota: periodo ? "fechadas no período, pela data do fechamento" : "dos leads que entraram no período",
  };
  if (periodo) clientes.semTaxa = SEM_TAXA_PERIODO;
  else taxaAninhada(clientes, compareceu.valor);
  if (comercial) cruzarComAtendimento(clientes, comercial.negociosFechados, countClients(data.leads), !!range, ["negócio fechado", "negócios fechados"]);
  etapas.push(clientes);

  if (doRobo.length === 0) return { etapas };

  // Bloco do robô/atendimento. As taxas DENTRO dele (responderam ÷ conversas…)
  // são campanha inteira sobre campanha inteira e ficam; a do primeiro degrau é
  // sobre Leads, e o custo é sobre a verba — do período, quando há período:
  // numerador e denominador de janelas diferentes, então saem (a nota fica).
  const primeiro = doRobo[0];
  if (range) {
    for (const et of doRobo) et.custo = undefined;
    primeiro.daAnterior = undefined;
    primeiro.semTaxa = SEM_TAXA_CAMPANHA_INTEIRA;
  } else {
    // Campanha inteira sobre campanha inteira: a taxa sobre os leads vale, com a
    // régua de aninhamento — o robô pode conversar com quem nunca passou pelo
    // formulário, e com mais conversas que leads ela deixa de ser fração.
    taxaAninhada(primeiro, leadCount, "dos leads");
  }
  for (const et of doRobo.slice(1)) {
    if (et.daAnterior !== undefined && et.daAnterior > 1) {
      et.daAnterior = undefined;
      et.semTaxa = SEM_TAXA_NAO_ANINHADA;
    }
  }
  return {
    etapas,
    bloco: {
      titulo: "No robô e no atendimento",
      nota:
        (range
          ? "contagens da campanha inteira (o robô não guarda data) — por isso sem custo, sem taxa sobre os leads do período e sem Δ"
          : "contagens da campanha inteira, sobre os mesmos leads do funil acima") +
        (comercial ? ". Reuniões realizadas e vendas ficam só no painel, acima — o número do atendimento entra como nota lá quando não bate" : ""),
      etapas: doRobo,
    },
  };
}

/**
 * A métrica com meta que rege cada etapa do painel. A de reuniões vem da `dica`
 * — a entrada do dicionário que a etapa de fato carrega —, nunca do par (key,
 * vista): a meta de "reuniões agendadas" só gruda no número de `kpis.reunioesAgendadas`.
 */
function metricaDaEtapa(et: EtapaFunil): MetricaComMeta | undefined {
  if (et.key === "leads") return "leads";
  if (et.key === "primeiro_contato") return "primeiro_contato_no_prazo";
  if (et.dica === "reunioes_agendadas") return "reunioes_agendadas";
  if (et.dica === "agendaram") return "taxa_lead_agendada";
  if (et.key === "compareceu") return "comparecimento";
  return undefined;
}

export function montarFunil(e: EntradaFunil): FunilConversao {
  const { data, range, kpis, robo, comercial, vista } = e;
  const cascata = montarCascata({ data, range, robo, comercial, kpis });
  const { etapas, bloco } = etapasDaCascata(cascata.degraus, e);

  // Δ: o MESMO funil no período anterior (só com período concreto). O bloco do
  // robô/atendimento é campanha inteira — sem "antes".
  if (range) {
    const ant = previousRange(range);
    const kAnt = kpisDoPeriodo(data, ant, { hoje: e.hoje, agora: e.agora });
    const cascAnt = montarCascata({ data, range: ant, robo, comercial, kpis: kAnt });
    const porKey = new Map(etapasDaCascata(cascAnt.degraus, { ...e, range: ant, kpis: kAnt }).etapas.map((x) => [x.key, x.valor]));
    for (const et of etapas) {
      const v = porKey.get(et.key);
      if (v != null) et.anterior = v;
    }
  }

  // Meta (com vigência) colada à etapa que ela rege. Contagem só com alvo;
  // taxa sempre — sem alvo o badge diz "sem meta" (princípio 2 do relatório).
  const regua = new Map(reguaDoPeriodo(kpis, data, range, e.hoje).map((l) => [l.metrica, l]));
  for (const et of etapas) {
    const metrica = metricaDaEtapa(et);
    const l = metrica ? regua.get(metrica) : undefined;
    if (!metrica || !l) continue;
    const def = META_DEF[metrica];
    if (def.formato !== "pct" && l.alvo == null) continue;
    // Meta de contagem: o badge avalia o número da MEDIDA ("meta 7 · 57%") sem
    // imprimi-lo — então só gruda numa etapa que mostra exatamente esse número.
    if (def.formato !== "pct" && et.valor !== l.medida.valor) continue;
    et.meta = {
      metrica,
      nome: def.nome,
      formato: def.formato,
      valor: l.medida.valor,
      n: l.medida.n,
      alvo: l.alvo,
      avaliacao: l.avaliacao,
      provisoria: l.meta?.provisoria,
    };
  }

  return { vista, etapas, bloco, investimentoConversao: cascata.investimentoConversao, cascata };
}

/** Impressões SÓ das campanhas de conversão no período — o topo do funil de conversão. */
export function impressoesDeConversao(data: DashboardData, range: DateRange | undefined): number {
  return filterAds(data.adDaily, range)
    .filter((r) => bucketOfAd(r) === "conversao")
    .reduce((s, r) => s + r.impressions, 0);
}

// ---------------------------------------------------------------- funil de descoberta

export interface EtapaDescoberta {
  key: "alcance" | "visitas_perfil" | "seguidores";
  label: string;
  valor: number | null;
  daAnterior?: number;
  custo?: { valor: number; rotulo: string };
  anterior?: number;
  nota?: string;
}

export interface FunilDescoberta {
  etapas: EtapaDescoberta[];
  /** Ao lado do funil, não degraus dele: cliques no link da bio e DMs (quando há registro). */
  extras: { key: string; label: string; valor: number; anterior?: number; nota?: string }[];
  /** Dias com dado do Instagram no período; 0 = sem leitura. */
  dias: number;
  semDado: boolean;
  /** Por que não há "vs. anterior": o período anterior sem leitura, ou com menos dias que este. */
  semComparacao?: string;
  investimentoDescoberta: number;
}

/**
 * Alcance → visitas ao perfil → seguidores, da conta do Instagram no período. O
 * alcance é a SOMA DIÁRIA (a mesma pessoa conta em cada dia) e o rótulo diz isso
 * — a API só dá o alcance único por janela, não por dia somável.
 */
export function funilDeDescoberta(
  data: DashboardData,
  range: DateRange | undefined,
  kpis: Pick<KpisDoPeriodo, "investimentoDescoberta">,
): FunilDescoberta {
  const ig = igAccountTotals(data.igAccountDaily, range);
  const semDado = ig.days === 0;
  // Período anterior sem dia sincronizado é SEM LEITURA, não zero: contra 0 a
  // tela imprimiria "+N vs. anterior" sobre um salto que não existiu. Com menos
  // dias que o atual, a soma também não compara — um buraco de sync vira "alta".
  const antBruto = range ? igAccountTotals(data.igAccountDaily, previousRange(range)) : null;
  const ant = antBruto && antBruto.days > 0 && antBruto.days >= ig.days ? antBruto : null;
  const semComparacao =
    antBruto && !ant && !semDado
      ? antBruto.days === 0
        ? "sem comparação: o período anterior não tem leitura do Instagram"
        : `sem comparação: o período anterior tem ${formatInt(antBruto.days)} ${antBruto.days === 1 ? "dia" : "dias"} com dado, contra ${formatInt(ig.days)} deste`
      : undefined;
  const verba = kpis.investimentoDescoberta.valor;
  const v = (n: number) => (semDado ? null : n);
  const taxa = (num: number, den: number) => (den >= AMOSTRA_MINIMA && num >= 0 ? num / den : undefined);

  const etapas: EtapaDescoberta[] = [
    {
      key: "alcance",
      label: "Alcance da conta",
      valor: v(ig.reach),
      anterior: ant?.reach,
      nota: "soma do alcance diário (pago + orgânico): a mesma pessoa conta em cada dia em que foi alcançada",
    },
    {
      key: "visitas_perfil",
      label: "Visitas ao perfil",
      valor: v(ig.profileViews),
      daAnterior: semDado ? undefined : taxa(ig.profileViews, ig.reach),
      anterior: ant?.profileViews,
    },
    {
      key: "seguidores",
      label: "Novos seguidores (líquido)",
      valor: v(ig.netNew),
      daAnterior: semDado ? undefined : taxa(ig.netNew, ig.profileViews),
      custo: !semDado && verba > 0 && ig.netNew > 0 ? { valor: verba / ig.netNew, rotulo: "por seguidor" } : undefined,
      anterior: ant?.netNew,
      nota: ig.hasFollowSplit
        ? `ganhos brutos ${formatInt(ig.followsTotal)} · deixaram de seguir ${formatInt(ig.unfollowsTotal)}`
        : "diferença entre o fim e o início do período — a Meta não separou ganho de churn nestes dias",
    },
  ];

  const extras: FunilDescoberta["extras"] = [];
  if (!semDado && ig.profileLinkTaps > 0) {
    extras.push({
      key: "link_bio",
      label: "Cliques no link da bio",
      valor: ig.profileLinkTaps,
      anterior: ant?.profileLinkTaps,
      nota: ig.hasLinkTapSplit ? `site ${formatInt(ig.linkTapsWebsite)} · WhatsApp ${formatInt(ig.linkTapsWhatsApp)}` : undefined,
    });
  }
  if (!semDado && ig.hasDmData) {
    extras.push({
      key: "dm",
      label: "Conversas de DM",
      valor: ig.dmConversations,
      anterior: ant?.hasDmData ? ant.dmConversations : undefined,
      nota: "registro manual — a API do Instagram não expõe DMs",
    });
  }

  return { etapas, extras, dias: ig.days, semDado, semComparacao, investimentoDescoberta: verba };
}

// ---------------------------------------------------------------- tendência semanal

export interface PontoTendencia {
  /** Segunda-feira da semana (AAAA-MM-DD). */
  semana: string;
  leads: number;
  visitas: number;
  /** Leads que entraram ÷ visitas da LP na semana (ausente sem visitas). */
  visitaLead?: number;
  /** O KPI "1º contato no prazo" da semana (ausente sem lead julgado). */
  leadContatoNoPrazo?: number;
  /** O KPI "lead → reunião" da semana (ausente sem lead). */
  leadAgendada?: number;
  /** Amostras que sustentam cada taxa. */
  n: { contato: number; leads: number; visitas: number };
  /** A semana de hoje ainda não fechou. */
  incompleta: boolean;
}

/**
 * As três taxas-chave nas últimas `n` semanas (segunda a domingo), cada ponto
 * calculado com `kpisDoPeriodo` + `lpKpis` daquela semana — os números são os
 * mesmos KPIs, só que por semana. Sem denominador a taxa fica AUSENTE (não "0%").
 */
export function tendenciaDasTaxas(data: DashboardData, hoje: string, n = 12, agora?: string): PontoTendencia[] {
  return ultimasSemanas(hoje, n).map((s) => {
    const r = { from: s.from, to: s.to };
    const k = kpisDoPeriodo(data, r, { hoje, agora });
    const lp = lpKpis(data, r);
    return {
      semana: s.semana,
      leads: k.leads.valor,
      visitas: lp.visits,
      visitaLead: lp.visits > 0 ? k.leads.valor / lp.visits : undefined,
      leadContatoNoPrazo: k.primeiroContatoNoPrazo.n > 0 ? k.primeiroContatoNoPrazo.valor : undefined,
      leadAgendada: k.leads.n > 0 ? k.taxaLeadAgendada.valor : undefined,
      n: { contato: k.primeiroContatoNoPrazo.n, leads: k.leads.n, visitas: lp.visits },
      incompleta: s.to >= hoje,
    };
  });
}

// ---------------------------------------------------------------- coortes

export type VeiculacaoDaSemana = "ok" | "pausada" | "sem_dados";

export interface CoorteSemana {
  /** Segunda-feira (AAAA-MM-DD). */
  semana: string;
  label: string;
  leads: number;
  /** O KPI "1º contato no prazo" da coorte (valor 0–1 e amostra julgada). */
  primeiroContatoNoPrazo: { valor: number; n: number };
  /** Agendaram (`isBooked`: desistência fora) — o mesmo "Agendaram" dos KPIs. */
  agendadas: number;
  realizadas: number;
  vendas: number;
  receita: number;
  /** Lead → agendada; `null` sem lead. */
  leadAgendada: number | null;
  /** Coorte recente, ainda maturando. */
  immature: boolean;
  /** Nenhuma linha de anúncio na semana: campanha pausada, ou sync sem cobertura (ADR-06). */
  semVeiculacao: boolean;
  veiculacao: VeiculacaoDaSemana;
  /** A partição conferível: perdas + abertos + ganhos = leads. */
  perdas: number;
  abertos: number;
  /** Chegaram a agendar (o FATO, `everBooked`), inclusive quem depois se perdeu ou desistiu. */
  ganhos: number;
}

const max = (a: string, b?: string) => (b && b > a ? b : a);
const min = (a: string, b?: string) => (b && b < a ? b : a);

/** A classificação ADR-06 de uma semana sem linha de anúncio. */
function veiculacaoDaSemana(r: DateRange, semVeiculacao: boolean, cobertura?: Intervalo[]): VeiculacaoDaSemana {
  if (!semVeiculacao) return "ok";
  if (!cobertura) return "pausada";
  for (let d = r.from; d <= r.to; d = somarDias(d, 1)) if (!diaCoberto(cobertura, d)) return "sem_dados";
  return "pausada";
}

/**
 * A tabela de coortes: TODAS as semanas do período (ou da primeira coorte até a
 * última), inclusive as sem lead (B21). Reaproveita `cohortWeekly` e completa com
 * o 1º contato no prazo (o KPI da semana) e a partição perdas/abertos/ganhos.
 */
export function coortesDoFunil(
  data: DashboardData,
  range: DateRange | undefined,
  opts: { agora: string; hoje: string; cobertura?: Intervalo[] },
): CoorteSemana[] {
  const base = cohortWeekly(data, range, opts.agora);
  const porSemana = new Map(base.map((c) => [c.week, c]));

  // Semanas: do início do período até o fim dele; na campanha inteira, as que
  // a coorte já traz (da primeira entrada até hoje).
  let semanas = base.map((c) => c.week);
  if (range) {
    semanas = [];
    for (let w = segundaDaSemana(range.from); w <= segundaDaSemana(range.to); w = somarDias(w, 7)) semanas.push(w);
  }
  if (semanas.length === 0) return [];

  const adsPorSemana = new Set(filterAds(data.adDaily, range).map((r) => segundaDaSemana(r.date)));
  const agoraMs = Date.parse(opts.agora);

  return semanas.map((semana) => {
    const c = porSemana.get(semana);
    const r: DateRange = { from: max(semana, range?.from), to: min(somarDias(semana, 6), range?.to) };
    const leads = filterLeads(data.leads, r);
    const k = kpisDoPeriodo(data, r, { hoje: opts.hoje, agora: opts.agora });
    const ganhos = leads.filter(everBooked).length;
    const perdas = leads.filter((l) => isLostStatus(l.status) && !everBooked(l)).length;
    const semVeiculacao = c ? c.semVeiculacao : !adsPorSemana.has(semana);
    return {
      semana,
      label: `${semana.slice(8, 10)}/${semana.slice(5, 7)}`,
      leads: leads.length,
      primeiroContatoNoPrazo: { valor: k.primeiroContatoNoPrazo.valor, n: k.primeiroContatoNoPrazo.n },
      agendadas: k.agendaram.valor,
      realizadas: c?.attended ?? leads.filter(isAttended).length,
      vendas: c?.clients ?? leads.filter(isClient).length,
      receita: c?.revenue ?? leads.filter(isClient).reduce((s, l) => s + (l.value ?? 0), 0),
      leadAgendada: leads.length > 0 ? k.taxaLeadAgendada.valor : null,
      immature: c?.immature ?? agoraMs - Date.parse(`${semana}T00:00:00Z`) < 7 * 86_400_000,
      semVeiculacao,
      veiculacao: veiculacaoDaSemana(r, semVeiculacao, opts.cobertura),
      perdas,
      abertos: leads.length - ganhos - perdas,
      ganhos,
    };
  });
}

// ---------------------------------------------------------------- perdas confiáveis

/** Para onde a perda aponta — a hipótese com regra explícita. */
export type AlvoDaPerda = "comercial" | "midia_formulario" | "oferta" | "indefinido";

export const ALVO_LABEL: Record<AlvoDaPerda, string> = {
  comercial: "Comercial",
  midia_formulario: "Mídia / formulário",
  oferta: "Oferta / pitch",
  indefinido: "Não dá para dizer",
};

/** Prazo do 1º contato (horas úteis) — a régua da Fila, não uma cópia. */
export const SLA_PRIMEIRO_CONTATO_HORAS = FILA_ETAPAS.novo.slaHoras;

/**
 * "Sem resposta" aponta para o COMERCIAL quando houve menos de 3 tentativas
 * (`TENTATIVAS_PARA_SEM_RESPOSTA`) OU a 1ª tentativa saiu fora do prazo de 1 hora
 * útil (`SLA_PRIMEIRO_CONTATO_HORAS`); só com 3+ tentativas, a primeira no prazo,
 * a culpa vai para a mídia/formulário. `primeiraNoPrazo === null` = sem tentativa
 * registrada, que é o caso mais claro de processo.
 */
export function ondeAtacarSemResposta(tentativas: number, primeiraNoPrazo: boolean | null): "comercial" | "midia_formulario" {
  if (tentativas < TENTATIVAS_PARA_SEM_RESPOSTA) return "comercial";
  if (primeiraNoPrazo !== true) return "comercial";
  return "midia_formulario";
}

/** A regra por motivo de perda. */
export function ondeAtacar(status: LeadStatus, c: { tentativas: number; primeiraNoPrazo: boolean | null }): AlvoDaPerda {
  if (status === "sem_resposta") return ondeAtacarSemResposta(c.tentativas, c.primeiraNoPrazo);
  if (status === "contato_invalido") return "midia_formulario";
  if (LEAD_STATUS_META[status].lossKind === "decisao") return "oferta";
  return "indefinido";
}

export interface LinhaPerda {
  status: LeadStatus;
  label: string;
  n: number;
  /** Fatia das perdas confiáveis (0–1). */
  share: number;
  /** Fração registrada mais de 72 h depois da entrada; `null` sem registro datado. */
  registradoComAtraso: number | null;
  /** Quantos leads da linha tinham registro datado (o n do atraso). */
  atrasoN: number;
  mediaTentativas: number;
  /** Para onde cada lead da linha aponta, pela regra. */
  ondeAtacar: Partial<Record<AlvoDaPerda, number>>;
  /** "Contato inválido" aberto pelo motivo registrado. */
  detalhes?: { motivo: string; label: string; n: number }[];
}

export interface PerdasConfiaveis {
  linhas: LinhaPerda[];
  /** Perdas sem reunião, depois da limpeza. */
  total: number;
  /** Leads do período que sobraram depois da limpeza (a base do %). */
  base: number;
  excluidos: {
    /** Cadastros com cara de teste (`pareceTeste`). */
    testes: number;
    /** Duplicados de outra pessoa (o principal fica). */
    duplicados: number;
    /** Encerrados DEPOIS de ter reunião: não são "perda sem reunião" (B20). */
    comReuniao: number;
  };
  /** "Sem resposta" sem nenhuma tentativa registrada — apontam para o comercial. */
  semTentativa: number;
}

/** O que a regra precisa saber de um lead perdido. */
function contextoDaPerda(l: Lead, evs: LeadEvent[]) {
  const rc = resumoContato(evs);
  const primeira = rc.primeira ?? l.firstContactAt;
  const prazo = somarHorasUteis(l.createdAt, SLA_PRIMEIRO_CONTATO_HORAS);
  const primeiraNoPrazo = primeira ? Date.parse(primeira) <= Date.parse(prazo) : null;
  // Quando o status de perda foi REGISTRADO: o último evento para ele, senão o marco.
  const registro = evs
    .filter((e) => e.action === "status_changed" && e.toStatus === l.status)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
  const registradoEm = registro?.createdAt ?? l.lostAt;
  const atraso = registradoEm ? Date.parse(registradoEm) - Date.parse(l.createdAt) > ATRASO_REGISTRO_HORAS * 3_600_000 : null;
  return { tentativas: rc.tentativas, primeiraNoPrazo, atraso };
}

/**
 * As perdas dos leads que entraram no período, confiáveis: sem testes, sem
 * duplicados e sem quem chegou a agendar (`everBooked` — o lead que teve reunião
 * não é "perda sem reunião"). `eventos` = histórico da marca (tentativas e
 * mudanças de status).
 */
export function perdasConfiaveis(data: DashboardData, range: DateRange | undefined, eventos: LeadEvent[]): PerdasConfiaveis {
  const vivos = data.leads.filter((l) => !l.deletedAt);
  const ehTeste = new Set(vivos.filter((l) => pareceTeste(l)).map((l) => l.id));
  // Duplicados se decidem na marca inteira: a cópia pode ter entrado em outro período.
  const duplicados = new Set(gruposDuplicados(vivos.filter((l) => !ehTeste.has(l.id))).flatMap((g) => g.duplicados.map((d) => d.id)));

  const doPeriodo = filterLeads(vivos, range);
  const base = doPeriodo.filter((l) => !ehTeste.has(l.id) && !duplicados.has(l.id));
  const perdidos = base.filter((l) => isLostStatus(l.status));
  const perdas = perdidos.filter((l) => !everBooked(l));
  const porLead = eventosPorLead(eventos);

  const linhas: LinhaPerda[] = [];
  let semTentativa = 0;
  for (const status of LOST_STATUSES) {
    const ls = perdas.filter((l) => l.status === status);
    if (ls.length === 0) continue;
    const ctx = ls.map((l) => ({ l, ...contextoDaPerda(l, porLead.get(l.id) ?? []) }));
    const comRegistro = ctx.filter((c) => c.atraso !== null);
    const alvos: Partial<Record<AlvoDaPerda, number>> = {};
    for (const c of ctx) {
      const a = ondeAtacar(status, c);
      alvos[a] = (alvos[a] ?? 0) + 1;
      if (status === "sem_resposta" && c.tentativas === 0) semTentativa += 1;
    }
    const linha: LinhaPerda = {
      status,
      label: LEAD_STATUS_META[status].label,
      n: ls.length,
      share: ls.length / perdas.length,
      registradoComAtraso: comRegistro.length > 0 ? comRegistro.filter((c) => c.atraso).length / comRegistro.length : null,
      atrasoN: comRegistro.length,
      mediaTentativas: ctx.reduce((s, c) => s + c.tentativas, 0) / ctx.length,
      ondeAtacar: alvos,
    };
    if (status === "contato_invalido") {
      const porMotivo = new Map<string, number>();
      for (const l of ls) {
        const m = l.lostReasonDetail?.trim() || "";
        porMotivo.set(m, (porMotivo.get(m) ?? 0) + 1);
      }
      linha.detalhes = [...porMotivo.entries()]
        .map(([motivo, n]) => ({
          motivo: motivo || "sem_motivo",
          label: motivo ? (MOTIVOS_CONTATO_INVALIDO[motivo] ?? motivo) : "Sem motivo registrado",
          n,
        }))
        .sort((a, b) => b.n - a.n);
    }
    linhas.push(linha);
  }
  linhas.sort((a, b) => b.n - a.n);

  return {
    linhas,
    total: perdas.length,
    base: base.length,
    excluidos: {
      testes: doPeriodo.filter((l) => ehTeste.has(l.id)).length,
      duplicados: doPeriodo.filter((l) => !ehTeste.has(l.id) && duplicados.has(l.id)).length,
      comReuniao: perdidos.length - perdas.length,
    },
    semTentativa,
  };
}

// ---------------------------------------------------------------- confiança do registro

export interface ConfiancaRegistro {
  /** Mudanças de status registradas no período. */
  total: number;
  /** Registradas mais de 72 h depois da entrada do lead. */
  atrasados: number;
  /** Registradas em lote (10 do mesmo usuário em 15 minutos). */
  emLote: number;
  /** atrasados ∪ em lote. */
  suspeitos: number;
  share: number;
  /** Mais de 30% suspeitos, com amostra: as taxas do período podem estar distorcidas. */
  baixa: boolean;
  texto: string;
}

/**
 * Quanto do registro do período é suspeito — em lote ou com atraso — com as
 * MESMAS réguas da regra C5 do motor (`ATRASO_REGISTRO_HORAS`, `LOTE_MIN`,
 * `LOTE_JANELA_MIN`, `ATRASO_REGISTRO_SHARE`). O selo só acende com amostra
 * (`AMOSTRA_MIN.C5`): 1 de 2 registros não diz nada sobre o processo.
 */
export function confiancaDoRegistro(data: DashboardData, range: DateRange | undefined, eventos: LeadEvent[]): ConfiancaRegistro {
  const porLead = new Map(data.leads.map((l) => [l.id, l]));
  const mudancas = eventos
    .filter((e) => e.action === "status_changed" && porLead.has(e.leadId) && inRange(dayOf(e.createdAt), range))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const total = mudancas.length;

  const suspeito = new Set<string>();
  let atrasados = 0;
  for (const e of mudancas) {
    if (Date.parse(e.createdAt) - Date.parse(porLead.get(e.leadId)!.createdAt) > ATRASO_REGISTRO_HORAS * 3_600_000) {
      atrasados += 1;
      suspeito.add(e.id);
    }
  }
  // Lote: toda janela de LOTE_JANELA_MIN minutos com LOTE_MIN registros do mesmo ator.
  const porAtor = new Map<string, LeadEvent[]>();
  for (const e of mudancas) porAtor.set(e.actor, [...(porAtor.get(e.actor) ?? []), e]);
  const emLote = new Set<string>();
  for (const evs of porAtor.values()) {
    const ts = evs.map((e) => Date.parse(e.createdAt));
    for (let j = 0, i = 0; j < ts.length; j++) {
      if (i < j) i = j;
      while (i + 1 < ts.length && ts[i + 1] - ts[j] <= LOTE_JANELA_MIN * 60_000) i++;
      if (i - j + 1 >= LOTE_MIN) for (let k = j; k <= i; k++) emLote.add(evs[k].id);
    }
  }
  for (const id of emLote) suspeito.add(id);

  const share = total > 0 ? suspeito.size / total : 0;
  const baixa = total >= AMOSTRA_MIN.C5 && share > ATRASO_REGISTRO_SHARE;
  const texto =
    total === 0
      ? "nenhuma mudança de status registrada no período"
      : `${formatPercent(share, 0)} dos ${formatInt(total)} registros de status do período entraram em lote ou com mais de ${ATRASO_REGISTRO_HORAS} h de atraso`;
  return { total, atrasados, emLote: emLote.size, suspeitos: suspeito.size, share, baixa, texto };
}

// ---------------------------------------------------------------- notas de medição

export interface NotaMedicao {
  titulo: string;
  detalhe: string;
}

/**
 * O que parece perda e é medição: cliques × visitas, Pixel × painel, eventos ×
 * pessoas. Recolhido, porque é contexto — a seção "Onde não agir" deixou de
 * existir e os textos dela moram aqui.
 */
export function notasDeMedicao(input: { data: DashboardData; range: DateRange | undefined; kpis: KpisDoPeriodo; cascata: CascataResult }): NotaMedicao[] {
  const { data, range, kpis, cascata } = input;
  const ads = filterAds(data.adDaily, range);
  const cliques = ads.reduce((s, r) => s + r.clicks, 0);
  const lp = lpKpis(data, range);
  const leads = kpis.leads.valor;
  const pixel = kpis.conversoesPixel.valor;
  const naoAgir = cascata.naoAgir;
  const out: NotaMedicao[] = [];

  if (cliques > 0 || lp.visits > 0) {
    const extra = naoAgir.find((n) => n.titulo.includes("“cliques”"));
    out.push({
      titulo: `Cliques × visitas: ${formatInt(cliques)} cliques (Meta) contra ${formatInt(lp.visits)} visitas (landing page)`,
      detalhe:
        (extra ? `${extra.detalhe} ` : "") +
        "“Cliques” não é degrau deste funil: a Meta soma `inline_link_clicks || clicks`, duas definições incompatíveis — nos conjuntos sem link, curtida, comentário e toque no perfil contam como clique. A visita na landing page é a primeira contagem de gente.",
    });
  }

  out.push({
    titulo: `Pixel × painel: ${formatInt(pixel)} conversões do Pixel contra ${formatInt(leads)} leads`,
    detalhe:
      "O Pixel conta EVENTOS na janela de atribuição da Meta, carimbados na data do clique — reenvios e duplicados entram. O painel conta PESSOAS (uma por cadastro). Quando divergem, os dois estão certos: contam coisas diferentes. O Pixel serve para a Meta otimizar a entrega e não entra em nenhuma taxa daqui.",
  });

  if (lp.formSubmits > 0 || lp.clicks > 0) {
    const cta = naoAgir.find((n) => n.titulo.includes("CTA"));
    out.push({
      titulo: `Eventos × pessoas: ${formatInt(lp.formSubmits)} envios de formulário viraram ${formatInt(leads)} leads`,
      detalhe:
        "Envio de formulário é evento, não pessoa: a mesma visitante pode enviar duas vezes (o reenvio vira histórico do mesmo lead, nunca um lead novo). " +
        (cta ? cta.detalhe : `Os ${formatInt(lp.clicks)} cliques no CTA são outro contador de evento ao lado de um contador de sessão.`),
    });
  }

  for (const n of naoAgir) {
    if (n.titulo.includes("“cliques”") || n.titulo.includes("CTA")) continue;
    out.push({ titulo: n.titulo, detalhe: n.detalhe });
  }
  return out;
}
