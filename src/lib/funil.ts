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
 *   segue os leads que ENTRARAM no período até onde chegaram. A cascata já era
 *   coorte de Leads para baixo; a vista de período troca só esses degraus.
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

const pct = (v: number) => formatPercent(v, v < 0.1 ? 1 : 0);

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
    detalhe: `(${DONO_LABEL[t.dono]}) — ${pct(t.taxa!)} contra ${regua} ${pct(t.referencia!.taxa)}. ${textoDoImpacto(g)}.`,
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
  /** Conversão da etapa anterior — ausente abaixo da amostra ou sem leitura. */
  daAnterior?: number;
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

export interface FunilConversao {
  vista: VistaFunil;
  etapas: EtapaFunil[];
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
  reuniao: "por reunião realizada",
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

/** Traduz os degraus da cascata nas etapas do funil, na vista pedida. */
function etapasDaCascata(degraus: Degrau[], e: EntradaFunil): EtapaFunil[] {
  const { data, range, kpis, robo, comercial, vista } = e;
  const semRobo = !robo && !comercial;
  const periodo = vista === "periodo";
  const out: EtapaFunil[] = [];

  for (const d of degraus) {
    // Envios de formulário são EVENTOS, não pessoas: viram nota de medição.
    if (d.key === "envios") continue;
    const et: EtapaFunil = {
      key: d.key,
      label: d.label,
      valor: d.valor,
      fonte: d.fonte,
      dono: d.dono,
      ehAncora: d.ehAncora,
      trocaDeSistema: d.trocaDeSistema,
      nota: d.nota,
      dica: d.key === "leads" ? "leads" : undefined,
      custo:
        d.custoUnitario !== undefined
          ? { valor: d.custoUnitario, prefixo: d.custoPrefixo, rotulo: ROTULO_CUSTO[d.key] ?? "cada", dica: d.key === "leads" ? "cpl" : undefined }
          : undefined,
      parados: d.parados,
      etapaFila: d.etapaFila,
    };

    if (semRobo && d.key === "reunioes") {
      // Quem espera o 1º contato está parado ANTES do 1º contato, não antes da reunião.
      et.parados = undefined;
      et.etapaFila = undefined;
      if (periodo) {
        et.label = "Reuniões agendadas";
        et.dica = "reunioes_agendadas";
        et.valor = kpis.reunioesAgendadas.valor;
        et.nota = "marcadas no período, pela data do agendamento — a north star";
        // O custo por reunião do dicionário (verba de conversão ÷ reuniões de
        // conversão do período), com a régua única da quarentena.
        if (custoExibivel(kpis.custoPorReuniao)) {
          et.custo = {
            valor: kpis.custoPorReuniao.valor,
            prefixo: kpis.custoPorReuniao.confianca ? (kpis.custoPorReuniao.confianca.nivel === "piso" ? "≥" : "≤") : undefined,
            rotulo: ROTULO_CUSTO.reunioes,
            dica: "custo_por_reuniao",
          };
        }
      } else {
        et.label = "Agendaram reunião";
        et.dica = "agendaram";
      }
    }
    if (semRobo && d.key === "compareceu") {
      et.label = "Reuniões realizadas";
      if (periodo) {
        et.valor = eventosNoPeriodo(data, range).realizadas;
        et.nota = "pela data em que a reunião aconteceu";
      } else {
        et.nota = "dos leads que entraram no período";
      }
    }
    if (semRobo && d.key === "clientes") {
      et.label = "Vendas";
      if (periodo) {
        et.valor = eventosNoPeriodo(data, range).vendas;
        et.nota = "fechadas no período, pela data do fechamento";
      } else {
        et.nota = "dos leads que entraram no período";
      }
    }

    out.push(et);

    if (d.key === "leads" && semRobo) {
      // O 1º contato é a etapa do comercial que o relatório pede no funil — e é
      // onde quem ainda não foi contatado está parado (a aba "Novos" da Fila).
      const semContato = data.leads.filter((l) => l.status === "lead").length;
      out.push({
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
      });
    }
  }

  // Conversão da anterior, recalculada entre as etapas que ficaram. Abaixo da
  // amostra mínima "1 de 1" imprimiria "100%" com cara de medição.
  for (let i = 1; i < out.length; i++) {
    const d = out[i];
    const ant = out[i - 1];
    d.daAnterior = d.valor != null && ant.valor != null && ant.valor >= AMOSTRA_MINIMA ? d.valor / ant.valor : undefined;
  }
  return out;
}

/** A métrica com meta que rege cada etapa do painel, por vista. */
function metricaDaEtapa(key: string, vista: VistaFunil): MetricaComMeta | undefined {
  if (key === "leads") return "leads";
  if (key === "primeiro_contato") return "primeiro_contato_no_prazo";
  if (key === "reunioes") return vista === "periodo" ? "reunioes_agendadas" : "taxa_lead_agendada";
  if (key === "compareceu") return "comparecimento";
  return undefined;
}

export function montarFunil(e: EntradaFunil): FunilConversao {
  const { data, range, kpis, robo, comercial, vista } = e;
  const cascata = montarCascata({ data, range, robo, comercial, kpis });
  const etapas = etapasDaCascata(cascata.degraus, e);

  // Δ: o MESMO funil no período anterior (só com período concreto). As etapas
  // do robô e do atendimento são contagens da campanha inteira — sem "antes".
  if (range) {
    const ant = previousRange(range);
    const kAnt = kpisDoPeriodo(data, ant, { hoje: e.hoje, agora: e.agora });
    const cascAnt = montarCascata({ data, range: ant, robo, comercial, kpis: kAnt });
    const porKey = new Map(etapasDaCascata(cascAnt.degraus, { ...e, range: ant, kpis: kAnt }).map((x) => [x.key, x.valor]));
    for (const et of etapas) {
      if (et.fonte === "robo" || et.fonte === "comercial") continue;
      const v = porKey.get(et.key);
      if (v != null) et.anterior = v;
    }
  }

  // Meta (com vigência) colada à etapa que ela rege. Contagem só com alvo;
  // taxa sempre — sem alvo o badge diz "sem meta" (princípio 2 do relatório).
  const regua = new Map(reguaDoPeriodo(kpis, data, range, e.hoje).map((l) => [l.metrica, l]));
  for (const et of etapas) {
    const metrica = metricaDaEtapa(et.key, vista);
    const l = metrica ? regua.get(metrica) : undefined;
    if (!metrica || !l) continue;
    const def = META_DEF[metrica];
    if (def.formato !== "pct" && l.alvo == null) continue;
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

  return { vista, etapas, investimentoConversao: cascata.investimentoConversao, cascata };
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
  const ant = range ? igAccountTotals(data.igAccountDaily, previousRange(range)) : null;
  const semDado = ig.days === 0;
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

  return { etapas, extras, dias: ig.days, semDado, investimentoDescoberta: verba };
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
