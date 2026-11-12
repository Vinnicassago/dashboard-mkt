/**
 * Funil (Fase 3, nov/26) — "onde exatamente estamos perdendo reuniões?". Puro:
 * recebe os dados, os KPIs, os eventos e o estado do robô e devolve a tela
 * inteira (`montarFunilDaTela`); a página só carrega (`funil-server.ts`) e
 * renderiza.
 *
 * Só COORTE (os leads que entraram no período, até onde chegaram) e só conversão.
 * De cima para baixo:
 *
 * - A MANCHETE é `ondeTrava` (`lib/onde-trava.ts`): a maior perda em PESSOAS, com
 *   o dono da etapa e o link do grupo da Fila — sem meta nem média.
 * - O FUNIL é o topo da cascata (`montarCascata`: impressões de conversão →
 *   visitas na LP → Leads, com as duas âncoras) mais o funil do PROCESSO
 *   (`funilDoProcesso`, `lib/funil-processo.ts`: robô → agendamento → reunião →
 *   venda, a MESMA passada pela coorte que o Início recorta). Os números de Leads,
 *   Agendaram, Reuniões realizadas e Vendas são os de `kpisDoPeriodo`; o CPL da
 *   linha Leads é o do cartão do Início (`custoExibivel` + `mostrar`).
 * - "POR QUE PERDEMOS" são as perdas confiáveis (B20): sem testes, sem cópias de
 *   duplicado (`testesEDuplicados`, a régua das juntas) e sem quem chegou a
 *   agendar. Uma linha por motivo, com quem encerrou — o comercial (status de
 *   perda) ou o robô (`encerramentoDoRobo`, só para quem está no trecho do robô) —
 *   e vale o PRIMEIRO encerramento. "Onde atacar" é uma REGRA explícita.
 * - Recolhidos: a TENDÊNCIA (visita → lead e lead → agendada por semana, com os
 *   KPIs daquela semana) e as COORTES com TODAS as semanas, inclusive as de 0 lead
 *   (B21). As duas taxas usam a régua única `AMOSTRA_MINIMA`.
 *
 * A confiança do registro (lote/atraso, as réguas do motor) vira o alerta
 * `registro-suspeito` e uma frase no ⓘ das perdas. Nenhum nome, telefone, e-mail
 * ou texto livre de lead sai daqui: o objeto da tela é só contagem e texto.
 */

import { alertaLpSemDado, alertasDeConfianca, type Alerta } from "./alertas";
import { AMOSTRA_MINIMA, FONTE_META, montarCascata, type Degrau, type Fonte } from "./cascata";
import { diaCoberto, type Intervalo } from "./cobertura";
import { eventosPorLead, resumoContato } from "./contato";
import { dica } from "./dicionario";
import { montarFila, SLA_PRIMEIRO_CONTATO_HORAS } from "./fila";
import { formatCurrency0, formatDecimal, formatInt, formatPercent } from "./format";
import {
  CONFIRMACAO_DESDE,
  dicaDoRecorteDoRobo,
  funilDoProcesso,
  idsDoTrechoDoRobo,
  ROTULO_DO_DEGRAU,
  textoDaTaxa,
  type DegrauDoProcesso,
  type DegrauId,
  type EntradaDoProcesso,
  type FunilDoProcesso,
} from "./funil-processo";
import { diaDoLead, somarHorasUteis } from "./horario-util";
import { testesEDuplicados } from "./identidade";
import { custoExibivel, kpisDoPeriodo, mostrar, type KpisDoPeriodo } from "./kpis";
import { LEAD_STATUS_META, MOTIVOS_CONTATO_INVALIDO, TENTATIVAS_PARA_SEM_RESPOSTA, isLostStatus } from "./lead-status";
import {
  cohortWeekly,
  everBooked,
  filterAds,
  filterLeads,
  inRange,
  isAttended,
  isClient,
  lpKpis,
  type DateRange,
} from "./metrics";
import { AMOSTRA_MIN, ATRASO_REGISTRO_HORAS, ATRASO_REGISTRO_SHARE, LOTE_JANELA_MIN, LOTE_MIN } from "./motor";
import { ATOR_N8N } from "./n8n/entrada";
import { ondeTrava, type OndeTrava } from "./onde-trava";
import { encerramentoDoRobo, reabertosPorLead, ROBO_INICIO, type MotivoDoRobo, type RoboAgora } from "./robo/situacao";
import { segundaDaSemana, somarDias, ultimasSemanas } from "./semana";
import type { MetricKey } from "./trust";
import type { DashboardData, Lead, LeadEvent, LeadStatus } from "./types";

/** "29/10" a partir de "2026-10-29". */
const dm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/** "1 lead" / "3 leads" — o número formatado e a palavra no singular quando é 1. */
const qtd = (n: number, um: string, varios: string) => `${formatInt(n)} ${n === 1 ? um : varios}`;

// ---------------------------------------------------------------- a tela

/** Semanas da tendência (o relatório pede 10–12). */
const SEMANAS_TENDENCIA = 12;

export interface EntradaFunil {
  data: DashboardData;
  range: DateRange | undefined;
  /** A chave do período (`?range=`), para os links da manchete. */
  rangeKey: string;
  /** Os KPIs do período (`kpisDoPeriodo`, sem `comparar`). */
  kpis: KpisDoPeriodo;
  /** O histórico da marca inteiro (`listLeadEvents({ limit: 0 })`). */
  eventos: readonly LeadEvent[];
  /** `estadoDoRoboAgora` — o MESMO da Fila e do Início. Ausente ou desligado = sem o robô. */
  robo?: RoboAgora;
  /** Dias cobertos por syncs de anúncio (ADR-06), para as coortes. */
  cobertura?: Intervalo[];
  /** ISO e AAAA-MM-DD (Brasília). */
  agora: string;
  hoje: string;
}

export interface LinhaDoFunil {
  id: "impressoes" | "visitas" | DegrauId;
  rotulo: string;
  /** "1.500" | "≥ 12". */
  texto: string;
  /** "62%" | "13% dos leads" | null (o ⓘ diz por quê). */
  taxa: string | null;
  /** 0–1, só de Leads para baixo (a âncora é Leads = 100%). */
  barra: number | null;
  /** `FONTE_META[fonte].sistema`. */
  selo: string;
  /** A fonte difere da linha anterior: junta tracejada antes desta. */
  trocaDeSistema: boolean;
  /** primeira-msg, responderam, aceitaram, confirmaram. */
  recuo: boolean;
  /** Leads: "CPL R$ 26,25"; Vendas: a receita, se > 0. */
  extra: string | null;
  /** O ⓘ da linha, pronto (com o sufixo do `semTaxa`, K38). */
  dica: string;
}

export interface LinhaDePerdaNaTela {
  motivo: MotivoDaPerda;
  n: number;
  rotulo: string;
  quem: "robô" | "comercial";
  /** Na ordem fixa; `n` só com 2 ou mais alvos. */
  alvos: { rotulo: string; n: number | null }[];
  dica: string;
}

export interface FunilDaTela {
  manchete: OndeTrava;
  /** null com 0 lead no período (K34): a manchete é o vazio. */
  funil: {
    titulo: string;
    dica: string;
    /** Só com o trecho do robô na tela e a leitura parada; desenhada ACIMA do `ol`. */
    leituraParada: { desde: string | null; texto: string } | null;
    linhas: LinhaDoFunil[];
    /** Desenhada logo depois da linha "agendaram". */
    ponte: string | null;
  } | null;
  /** null com 0 lead no período (K34). Sem perdas: `linhas` vazia e o título diz "Nenhuma perda…". */
  perdas: { titulo: string; dica: string; linhas: LinhaDePerdaNaTela[] } | null;
  semanas: { resumo: "Semana a semana"; dica: string; pontos: PontoTendencia[] };
  coortes: { resumo: "Coorte por semana de entrada"; dica: string; linhas: CoorteSemana[] };
  alertas: Alerta[];
}

const DICA_DO_CARD =
  "Cada lead que entrou ({recorte}) até onde chegou. Acima de Leads, a base são as impressões; de Leads para baixo, Leads = 100% e o % é sobre a etapa de cima — Agendaram é sobre os leads (há quem agende sem passar pelo robô); Confirmaram e Reuniões realizadas, sobre Agendaram. Tracejado: o dado troca de sistema. De Agendaram em diante, o registro é manual (o comercial registra até o Calendly entrar). % só com 3 ou mais na etapa de cima. Cliques não é etapa: a Meta soma duas definições de clique. O Pixel conta eventos; aqui são pessoas.";

const DICA_DAS_SEMANAS =
  "Últimas 12 semanas (segunda a domingo), cada ponto com os KPIs daquela semana: visita → lead e lead → agendada. A última semana ainda não fechou; semana com menos de 3 na base, ou com mais leads que visitas, fica sem ponto.";

const DICA_DAS_COORTES =
  "O que aconteceu com os leads de cada semana de entrada, em qualquer data. Agendaram, Realizadas e Vendas contam os leads daquela semana, não as reuniões da semana. Semana sem lead aparece com 0 e o motivo: “campanha pausada” (o sync cobriu e não veio anúncio) ou “sem dados do anúncio” (nenhum sync cobriu). “Maturando” = semana recente, ainda sem tempo de agendar. “Lead → agendada” só com 3 ou mais leads.";

/** O porquê de uma linha sem %, no ⓘ dela (K38). */
type SemTaxa = NonNullable<DegrauDoProcesso["semTaxa"]> | NonNullable<Degrau["semTaxa"]>;

function sufixoSemTaxa(s: SemTaxa | null | undefined, topo = false): string {
  switch (s) {
    case "amostra":
      return ` Sem %: menos de ${formatInt(AMOSTRA_MINIMA)} na etapa de cima.`;
    case "nao-aninhada":
      // No topo, mais leads que visitas é gente que não passou pela LP — não é
      // registro antigo de agendamento.
      return topo
        ? " Sem %: há mais aqui do que na etapa de cima (nem todos passaram por ela)."
        : " Sem %: há mais aqui do que na etapa de cima (registro antigo sem a data do agendamento).";
    case "leitura-parada":
      return " Sem %: a leitura do robô está parada; o número é o mínimo.";
    case "registro-parcial":
      return ` Sem %: há reunião de antes de ${dm(CONFIRMACAO_DESDE)}, quando o painel não registrava a confirmação; o número é o mínimo.`;
    case "recorte":
      return " Sem %: é um recorte dos leads, não uma etapa.";
    case "lp-sem-dado":
      return " Sem %: a landing page não registrou visitas no período (o rastreio pode ter parado).";
    default:
      return "";
  }
}

/** O ⓘ de Vendas (§6.2.1, K11): receita, sem valor, CAC/ROAS/ticket com 3+ vendas, valor por reunião com 3+ agendaram. */
function dicaDeVendas(data: DashboardData, range: DateRange | undefined, k: KpisDoPeriodo): string {
  const o = k.overview;
  const semValor = filterLeads(data.leads, range).filter((l) => !l.deletedAt && isClient(l) && !(l.value && l.value > 0)).length;
  const partes = [dica("vendas"), `Receita ${formatCurrency0(o.revenue)}.`];
  if (semValor > 0) partes.push(`${qtd(semValor, "sem valor registrado", "sem valor registrado")}.`);
  if (o.clients >= AMOSTRA_MINIMA) {
    const nivelConv = k.investimentoConversao.confianca?.nivel;
    const nivelTotal = k.investimento.confianca?.nivel;
    const pfxVerba = nivelConv === "piso" ? "≥ " : nivelConv === "teto" ? "≤ " : "";
    const pfxRoas = nivelTotal === "piso" ? "≤ " : nivelTotal === "teto" ? "≥ " : "";
    const cac = o.spendConversao > 0 && nivelConv !== "quarentena" ? `${pfxVerba}${formatCurrency0(o.cac)}` : "—";
    const roas = o.spend > 0 && nivelTotal !== "quarentena" ? `${pfxRoas}${formatDecimal(o.roas, 2)}×` : "—";
    partes.push(`CAC ${cac} · ROAS ${roas} · ticket médio ${formatCurrency0(o.ticket)}.`);
  } else {
    partes.push(`CAC, ROAS e ticket médio só com ${formatInt(AMOSTRA_MINIMA)} ou mais vendas.`);
  }
  if (o.meetingsCoorte >= AMOSTRA_MINIMA) partes.push(`Valor por reunião: ${formatCurrency0(o.valuePerMeeting)}.`);
  return partes.join(" ");
}

/** O ⓘ de cada degrau do processo (§6.2), antes do sufixo do `semTaxa`. */
function dicaDoDegrau(d: DegrauDoProcesso, p: FunilDoProcesso, data: DashboardData, range: DateRange | undefined, k: KpisDoPeriodo): string {
  switch (d.id) {
    case "com-robo":
      return `${dica("com_robo")} ${dicaDoRecorteDoRobo(p)}`;
    case "agendaram":
      return (
        dica("agendaram") +
        (p.desistiram > 0
          ? ` ${formatInt(p.desistiram)} ${p.desistiram === 1 ? "agendou e desistiu" : "agendaram e desistiram"} — fora daqui (política do custo por reunião).`
          : "")
      );
    // O verbete já diz desde quando o registro existe e sobre quem é o % de Realizadas; aqui
    // só o que ele não diz (o sufixo `registro-parcial` explica o piso).
    case "confirmaram":
      return (
        dica("confirmaram") +
        (p.realizadasSemConfirmacao > 0
          ? ` ${qtd(p.realizadasSemConfirmacao, "reunião realizada", "reuniões realizadas")} sem confirmação registrada.`
          : "")
      );
    case "realizadas":
      return `${dica("reunioes_realizadas")} É o comparecimento da coorte.`;
    case "vendas":
      return dicaDeVendas(data, range, k);
    default:
      return dica(d.dica);
  }
}

/** O título do card: "120 leads → 15 agendaram → 2 vendas" (singular quando é 1). */
function tituloDoFunil(p: FunilDoProcesso): string {
  const n = (id: DegrauId) => p.degraus.find((d) => d.id === id)?.n ?? 0;
  const a = n("agendaram");
  const v = n("vendas");
  return `${qtd(p.leads, "lead", "leads")} → ${formatInt(a)} ${a === 1 ? "agendou" : "agendaram"} → ${qtd(v, "venda", "vendas")}`;
}

/** As linhas do card: o topo da cascata (impressões, visitas) e o funil do processo, com Leads unindo os dois. */
function linhasDoFunil(
  topo: Degrau[],
  p: FunilDoProcesso,
  data: DashboardData,
  range: DateRange | undefined,
  k: KpisDoPeriodo,
  impressoesDescoberta: number,
): LinhaDoFunil[] {
  const linhas: LinhaDoFunil[] = [];
  const fontes: Fonte[] = [];
  const empurrar = (l: Omit<LinhaDoFunil, "selo" | "trocaDeSistema">, fonte: Fonte) => {
    linhas.push({ ...l, selo: FONTE_META[fonte].sistema, trocaDeSistema: fontes.length > 0 && fontes[fontes.length - 1] !== fonte });
    fontes.push(fonte);
  };
  const temImpressoes = topo.some((d) => d.key === "impressoes");

  for (const d of topo) {
    if (d.key === "impressoes") {
      empurrar(
        {
          id: "impressoes",
          rotulo: d.label,
          texto: formatInt(d.valor),
          taxa: null,
          barra: null,
          recuo: false,
          extra: null,
          dica: `Impressões só de anúncios de conversão${
            impressoesDescoberta > 0 ? `; ${formatInt(impressoesDescoberta)} de descoberta ficam fora` : ""
          }. Acima de Leads a base são as impressões.`,
        },
        d.fonte,
      );
    } else if (d.key === "visitas") {
      empurrar(
        {
          id: "visitas",
          rotulo: d.label,
          texto: formatInt(d.valor),
          taxa: d.daAnterior != null ? textoDaTaxa(d.daAnterior, { topo: true }) : null,
          barra: null,
          recuo: false,
          extra: null,
          dica: (temImpressoes ? "Visitas na landing page, sobre as impressões." : "Visitas na landing page.") + sufixoSemTaxa(d.semTaxa, true),
        },
        d.fonte,
      );
    }
  }

  const leadsDoTopo = topo.find((d) => d.key === "leads");
  // A base do % da linha Leads (a da cascata): as visitas, senão as impressões.
  const baseDosLeads = topo.some((d) => d.key === "visitas") ? "as visitas na LP" : temImpressoes ? "as impressões" : null;
  for (const d of p.degraus) {
    if (d.id === "leads") {
      const cpl = custoExibivel(k.cpl);
      const conv = k.leadsConversao.valor;
      empurrar(
        {
          id: "leads",
          rotulo: d.rotulo,
          texto: d.texto,
          taxa: leadsDoTopo?.daAnterior != null ? textoDaTaxa(leadsDoTopo.daAnterior, { topo: true }) : null,
          barra: d.daAncora,
          recuo: false,
          // O MESMO número e a mesma régua do cartão do Início (K18).
          extra: cpl ? `CPL ${mostrar(k.cpl, "moeda")}` : null,
          dica:
            dica("leads") +
            (cpl ? ` ${dica("cpl")} Sobre ${qtd(conv, "lead", "leads")} de conversão.` : "") +
            ` Verba de conversão no período: ${mostrar(k.investimentoConversao, "moeda0")}.` +
            (leadsDoTopo?.daAnterior != null && baseDosLeads ? ` O % é sobre ${baseDosLeads}.` : "") +
            sufixoSemTaxa(leadsDoTopo?.semTaxa, true),
        },
        d.fonte,
      );
      continue;
    }

    // "dos leads" só quando a base NÃO é a última linha anterior de recuo igual ou
    // menor (na prática, Agendaram com o robô — ramo paralelo sobre Leads).
    let taxa: string | null = null;
    if (d.taxa != null) {
      taxa = textoDaTaxa(d.taxa);
      const anterior = [...linhas].reverse().find((l) => d.recuo || !l.recuo);
      if (d.base && anterior && anterior.id !== d.base) {
        taxa += d.base === "leads" ? " dos leads" : ` sobre ${ROTULO_DO_DEGRAU[d.base]}`;
      }
    }
    empurrar(
      {
        id: d.id,
        rotulo: d.rotulo,
        texto: d.texto,
        taxa,
        barra: d.daAncora,
        recuo: d.recuo,
        extra: d.id === "vendas" && k.overview.revenue > 0 ? formatCurrency0(k.overview.revenue) : null,
        dica: dicaDoDegrau(d, p, data, range, k) + (d.taxa == null && d.semTaxa !== "ancora" ? sufixoSemTaxa(d.semTaxa) : ""),
      },
      d.fonte,
    );
  }
  return linhas;
}

/** O fim do ⓘ do card, conforme o robô. */
function fimDaDicaDoCard(p: FunilDoProcesso, roboLigado: boolean): string {
  if (p.comRobo) return p.parada ? " Leitura do robô parada: os números do robô são o mínimo, sem %." : "";
  if (roboLigado) return ` Nenhum lead do período passou pelo robô (ele começou em ${dm(ROBO_INICIO)}): o funil é o do painel.`;
  return " Sem o robô: o funil é o do painel.";
}

const ORDEM_DOS_ALVOS: AlvoDaPerda[] = ["comercial", "midia_formulario", "oferta", "robo", "indefinido"];

/** O ⓘ de uma linha de perda (§5.4). */
function dicaDaPerda(l: LinhaPerda, semTentativa: number): string {
  const partes = [`${formatPercent(l.share, 0)} das perdas.`];
  if (l.quem === "robo") {
    const abertos = l.abertos ?? 0;
    partes.push(
      `Fim da conversa registrado pelo robô; ${
        abertos > 0 ? `${formatInt(abertos)} ${abertos === 1 ? "segue aberto" : "seguem abertos"}` : "nenhum segue aberto"
      } no painel (o status não muda). Pausado não conta.`,
    );
    if (l.motivo === "robo-pos-convite") partes.push("O robô não registra recusa: a pessoa esfriou depois de receber o convite.");
    return partes.join(" ");
  }
  partes.push(
    l.registradoComAtraso != null
      ? `Registrado com atraso (> ${ATRASO_REGISTRO_HORAS} h): ${formatPercent(l.registradoComAtraso, 0)} (n = ${formatInt(l.atrasoN)}).`
      : "Sem registro datado do status.",
  );
  partes.push(`Média de ${formatDecimal(l.mediaTentativas, 1)} tentativas.`);
  if (l.peloN8n && l.peloN8n > 0) partes.push(`${formatInt(l.peloN8n)} ${l.peloN8n === 1 ? "registrado" : "registrados"} pelo n8n.`);
  if (l.detalhes?.length) partes.push(`Motivos: ${l.detalhes.map((d) => `${d.label} ${formatInt(d.n)}`).join(", ")}.`);
  if (l.status === "sem_resposta") {
    partes.push(
      `“Sem resposta” vai ao comercial com menos de ${formatInt(TENTATIVAS_PARA_SEM_RESPOSTA)} tentativas ou com a 1ª fora de ${formatInt(SLA_PRIMEIRO_CONTATO_HORAS)} hora útil (para quem o robô não recebeu); com ${formatInt(TENTATIVAS_PARA_SEM_RESPOSTA)} ou mais no prazo, à mídia/formulário.`,
    );
    if (semTentativa > 0) partes.push(`${formatInt(semTentativa)} sem nenhuma tentativa.`);
  }
  return partes.join(" ");
}

/** O card "Por que perdemos" (§2.3, §5.4). */
function perdasDaTela(perdas: PerdasConfiaveis, confianca: ConfiancaRegistro): NonNullable<FunilDaTela["perdas"]> {
  const ex = perdas.excluidos;
  const sem = [
    ex.testes > 0 ? qtd(ex.testes, "teste", "testes") : "",
    ex.duplicados > 0 ? `${qtd(ex.duplicados, "cópia", "cópias")} de duplicado` : "",
  ].filter(Boolean);
  const rft = perdas.roboForaDoTrecho;
  const dicaDoTitulo = [
    `${perdas.base === 1 ? "Do 1 lead" : `Dos ${formatInt(perdas.base)} leads`} do período${sem.length ? ` (sem ${sem.join(" e ")})` : ""}, ${perdas.total > 0 ? qtd(perdas.total, "encerrado", "encerrados") : "nenhum encerrado"} sem nunca agendar${
      ex.comReuniao > 0
        ? `; ${formatInt(ex.comReuniao)} ${ex.comReuniao === 1 ? "encerrado depois de agendar fica fora" : "encerrados depois de agendar ficam fora"}`
        : ""
    }.`,
    "Quem encerrou: robô (fim da conversa) ou comercial (status no painel); vale o primeiro.",
    "Onde atacar: no ⓘ de cada linha.",
    rft > 0
      ? `${formatInt(rft)} ${rft === 1 ? "encerrado pelo robô fora do trecho dele (live e outros) não entra." : "encerrados pelo robô fora do trecho dele (live e outros) não entram."}`
      : "",
    // A forma curta da confiança (o texto inteiro é o do alerta `registro-suspeito`): o ⓘ
    // fica em ≤ 70 palavras com todos os opcionais (K39).
    confianca.total === 0
      ? "Registro: nenhuma mudança de status no período."
      : `Registro: ${formatPercent(confianca.share, 0)} de ${formatInt(confianca.total)} em lote ou com atraso > ${ATRASO_REGISTRO_HORAS} h.`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    titulo: perdas.total > 0 ? `Perdemos ${formatInt(perdas.total)} sem reunião` : "Nenhuma perda sem reunião no período",
    dica: dicaDoTitulo,
    linhas: perdas.linhas.map((l) => {
      const alvos = ORDEM_DOS_ALVOS.filter((a) => (l.ondeAtacar[a] ?? 0) > 0);
      return {
        motivo: l.motivo,
        n: l.n,
        rotulo: l.label,
        quem: l.quem === "robo" ? ("robô" as const) : ("comercial" as const),
        alvos: alvos.map((a) => ({ rotulo: ALVO_LABEL[a], n: alvos.length > 1 ? (l.ondeAtacar[a] ?? 0) : null })),
        dica: dicaDaPerda(l, perdas.semTentativa),
      };
    }),
  };
}

/**
 * A tela do Funil inteira, pura (§6.2). A Fila é a MESMA da /fila (todos os
 * leads, todos os eventos, o robô só ligado); o processo, a manchete e as perdas
 * saem da MESMA entrada — um número por fato.
 */
export function montarFunilDaTela(e: EntradaFunil): FunilDaTela {
  const { data, range, rangeKey, kpis: k, eventos, agora, hoje } = e;
  const roboLigado = Boolean(e.robo?.ligado);
  const fila = montarFila({ nowIso: agora, leads: data.leads, eventos: [...eventos], robo: roboLigado ? e.robo : undefined });
  const entrada: EntradaDoProcesso = { data, range, kpis: k, eventos, robo: e.robo, fila, agora };
  const p = funilDoProcesso(entrada);
  const manchete = ondeTrava(p, { rangeKey });
  const confianca = confiancaDoRegistro(data, range, eventos);

  const semanas: FunilDaTela["semanas"] = {
    resumo: "Semana a semana",
    dica: DICA_DAS_SEMANAS,
    pontos: tendenciaDasTaxas(data, hoje, SEMANAS_TENDENCIA, agora),
  };
  const coortes: FunilDaTela["coortes"] = {
    resumo: "Coorte por semana de entrada",
    dica: DICA_DAS_COORTES,
    linhas: coortesDoFunil(data, range, { agora, hoje, cobertura: e.cobertura }),
  };
  const alertas = alertasDoFunil({ data, range, kpis: k, confianca, hoje });

  if (p.leads === 0) return { manchete, funil: null, perdas: null, semanas, coortes, alertas };

  const topo = montarCascata({ data, range, kpis: k });
  // A linha do robô nas perdas só existe com o trecho do robô na tela (K5).
  const perdas = perdasConfiaveis(data, range, eventos, p.comRobo ? { trechoDoRobo: idsDoTrechoDoRobo(entrada) } : undefined);

  return {
    manchete,
    funil: {
      titulo: tituloDoFunil(p),
      dica: DICA_DO_CARD.replace("{recorte}", p.recorte) + fimDaDicaDoCard(p, roboLigado),
      leituraParada: p.comRobo ? p.leituraParada : null,
      linhas: linhasDoFunil(topo.degraus, p, data, range, k, topo.impressoesDescoberta),
      ponte: p.ponte?.texto ?? null,
    },
    perdas: perdasDaTela(perdas, confianca),
    semanas,
    coortes,
    alertas,
  };
}

/** As travas que mexem num número que o Funil mostra: a verba (ⓘ de Leads e Vendas) e o CPL (linha Leads). */
const METRICAS_DO_FUNIL: MetricKey[] = ["spend", "cpl", "cplBlended"];

/**
 * Os alertas do Funil (K3): as travas de `kpisDoPeriodo` que afetam verba ou CPL,
 * a landing page que parou (`alertaLpSemDado`, o mesmo do Início) e o registro de
 * status suspeito. Saem as do custo por reunião (`sem-reuniao`, `cpr-amostra`,
 * `fontes-divergem`) e a atribuição: o Funil não mostra esses números — o
 * precedente de `alertasDaLive`.
 */
export function alertasDoFunil(e: {
  data: DashboardData;
  range: DateRange | undefined;
  kpis: KpisDoPeriodo;
  confianca: ConfiancaRegistro;
  hoje: string;
}): Alerta[] {
  const { data, range, kpis, confianca, hoje } = e;
  return [
    ...alertasDeConfianca(kpis.trust.travas.filter((t) => t.afeta.some((m) => METRICAS_DO_FUNIL.includes(m)))),
    ...alertaLpSemDado(data, range, hoje),
    ...(confianca.baixa
      ? [
          {
            id: "registro-suspeito",
            nivel: "aviso" as const,
            titulo: "Registro de status suspeito no período",
            detalhe: `${confianca.texto}: as taxas e as perdas do período podem estar distorcidas.`,
          },
        ]
      : []),
  ];
}

// ---------------------------------------------------------------- tendência semanal

export interface PontoTendencia {
  /** Segunda-feira da semana (AAAA-MM-DD). */
  semana: string;
  leads: number;
  visitas: number;
  /**
   * Leads que entraram ÷ visitas da LP na semana — ausente abaixo de `AMOSTRA_MINIMA`
   * visitas ou com mais leads que visitas (não aninhada: gente que não passou pela LP),
   * a MESMA regra da linha Leads do funil.
   */
  visitaLead?: number;
  /** O KPI "lead → reunião" da semana (ausente abaixo de `AMOSTRA_MINIMA` leads). */
  leadAgendada?: number;
  /** Amostras que sustentam cada taxa. */
  n: { leads: number; visitas: number };
  /** A semana de hoje ainda não fechou. */
  incompleta: boolean;
}

/**
 * As taxas-chave nas últimas `n` semanas (segunda a domingo), cada ponto
 * calculado com `kpisDoPeriodo` + `lpKpis` daquela semana — os números são os
 * mesmos KPIs, só que por semana. Abaixo de `AMOSTRA_MINIMA` na base, ou com mais
 * leads que visitas, a taxa fica AUSENTE (não "0%", nem "100%" de 1 de 1, nem
 * "166%") — as MESMAS réguas do funil (K17, aninhamento). O "1º contato no prazo"
 * não entra (F3-D14): continua em `kpisDoPeriodo`, fora do Funil.
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
      visitaLead: lp.visits >= AMOSTRA_MINIMA && k.leads.valor <= lp.visits ? k.leads.valor / lp.visits : undefined,
      leadAgendada: k.leads.n >= AMOSTRA_MINIMA ? k.taxaLeadAgendada.valor : undefined,
      n: { leads: k.leads.n, visitas: lp.visits },
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

/**
 * A classificação ADR-06 de uma semana sem linha de anúncio. Só os dias até
 * `hoje` contam: dia depois de hoje é FUTURO, nem "sem dados" nem "pausada" (C9)
 * — a semana em curso não vira "sem dados" pelos dias que ainda não chegaram, e
 * a que nem começou não tem marca. Dia antes da 1ª linha de anúncio da marca
 * (`primeiroDado`) também não conta: a semana toda de antes da campanha não tem
 * marca (o mesmo corte do `resolveRange` e da trava de cobertura).
 */
function veiculacaoDaSemana(
  r: DateRange,
  semVeiculacao: boolean,
  hoje: string,
  cobertura?: Intervalo[],
  primeiroDado?: string,
): VeiculacaoDaSemana {
  if (!semVeiculacao || r.from > hoje || (primeiroDado && r.to < primeiroDado)) return "ok";
  if (!cobertura) return "pausada";
  const ate = min(r.to, hoje);
  for (let d = max(r.from, primeiroDado); d <= ate; d = somarDias(d, 1)) if (!diaCoberto(cobertura, d)) return "sem_dados";
  return "pausada";
}

/**
 * A tabela de coortes: TODAS as semanas do período (ou da primeira coorte até a
 * última), inclusive as sem lead (B21). Reaproveita `cohortWeekly` e completa com
 * "Agendaram" (o KPI da semana) e a partição perdas/abertos/ganhos. O "1º contato no
 * prazo" saiu da coorte (F3-D14): o KPI continua em `kpisDoPeriodo`.
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
  const primeiroDado = data.adDaily.reduce<string | undefined>((m, r) => (!m || r.date < m ? r.date : m), undefined);
  const agoraMs = Date.parse(opts.agora);

  return semanas.map((semana) => {
    const c = porSemana.get(semana);
    const r: DateRange = { from: max(semana, range?.from), to: min(somarDias(semana, 6), range?.to) };
    const leads = filterLeads(data.leads, r);
    const k = kpisDoPeriodo(data, r, { hoje: opts.hoje, agora: opts.agora });
    const ganhos = leads.filter(everBooked).length;
    const perdas = leads.filter((l) => isLostStatus(l.status) && !everBooked(l)).length;
    const semVeiculacao = r.from <= opts.hoje && (c ? c.semVeiculacao : !adsPorSemana.has(semana));
    return {
      semana,
      label: `${semana.slice(8, 10)}/${semana.slice(5, 7)}`,
      leads: leads.length,
      agendadas: k.agendaram.valor,
      realizadas: c?.attended ?? leads.filter(isAttended).length,
      vendas: c?.clients ?? leads.filter(isClient).length,
      receita: c?.revenue ?? leads.filter(isClient).reduce((s, l) => s + (l.value ?? 0), 0),
      leadAgendada: leads.length > 0 ? k.taxaLeadAgendada.valor : null,
      immature: c?.immature ?? agoraMs - Date.parse(`${semana}T00:00:00Z`) < 7 * 86_400_000,
      semVeiculacao,
      veiculacao: veiculacaoDaSemana(r, semVeiculacao, opts.hoje, opts.cobertura, primeiroDado),
      perdas,
      abertos: leads.length - ganhos - perdas,
      ganhos,
    };
  });
}

// ---------------------------------------------------------------- perdas confiáveis

/** Para onde a perda aponta — a hipótese com regra explícita. */
export type AlvoDaPerda = "comercial" | "midia_formulario" | "oferta" | "robo" | "indefinido";

export const ALVO_LABEL: Record<AlvoDaPerda, string> = {
  comercial: "Comercial",
  midia_formulario: "Mídia / formulário",
  oferta: "Oferta / pitch",
  robo: "Robô (roteiro)",
  indefinido: "Não dá para dizer",
};

/** A chave de uma linha de perda: o status (comercial) ou o fim da conversa pelo robô. */
export type MotivoDaPerda = LeadStatus | "robo-pos-convite" | "robo-esfriou" | "robo-opt-out";

const MOTIVO_DO_ROBO: Record<MotivoDoRobo, Extract<MotivoDaPerda, `robo-${string}`>> = {
  "pos-convite": "robo-pos-convite",
  esfriou: "robo-esfriou",
  "opt-out": "robo-opt-out",
};

const ROTULO_DO_ROBO: Record<Extract<MotivoDaPerda, `robo-${string}`>, string> = {
  "robo-pos-convite": "Esfriou depois do convite",
  "robo-esfriou": "Esfriou na conversa",
  "robo-opt-out": "Pediu para não receber mensagens",
};

/**
 * "Onde atacar" das linhas do robô: esfriou depois do convite → não dá para
 * dizer (o robô não registra recusa, K24); esfriou na conversa → o roteiro do
 * robô; não quer mensagens → mídia/formulário.
 */
const ALVO_DO_ROBO: Record<Extract<MotivoDaPerda, `robo-${string}`>, AlvoDaPerda> = {
  "robo-pos-convite": "indefinido",
  "robo-esfriou": "robo",
  "robo-opt-out": "midia_formulario",
};

/** Desempate das linhas com o mesmo n (§5.3). */
const ORDEM_DAS_LINHAS: MotivoDaPerda[] = [
  "sem_resposta",
  "contato_invalido",
  "sem_interesse",
  "desistencia",
  "robo-pos-convite",
  "robo-esfriou",
  "robo-opt-out",
];

/** Prazo do 1º contato (horas úteis) — mora em `lib/fila.ts` (a régua da Fila, não uma cópia). */
export { SLA_PRIMEIRO_CONTATO_HORAS };

/**
 * "Sem resposta" aponta para o COMERCIAL quando houve menos de 3 tentativas
 * (`TENTATIVAS_PARA_SEM_RESPOSTA`) OU a 1ª tentativa saiu fora do prazo de 1 hora
 * útil (`SLA_PRIMEIRO_CONTATO_HORAS`); só com 3+ tentativas, a primeira no prazo,
 * a culpa vai para a mídia/formulário. `primeiraNoPrazo === null` = sem tentativa
 * registrada, que é o caso mais claro de processo. Para o lead que o robô recebeu
 * (`roboVistoEm`) o prazo não vale — `contextoDaPerda` já manda `primeiraNoPrazo`
 * como `true` e só as tentativas contam (11.7); o texto da tela diz isso.
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
  /** A chave da linha. */
  motivo: MotivoDaPerda;
  /** Só nas linhas do comercial. */
  status?: LeadStatus;
  /** Status: `LEAD_STATUS_META[s].label`; robô: o rótulo do fim da conversa. */
  label: string;
  /** Quem encerrou: o comercial (status de perda) ou o robô (fim da conversa). */
  quem: "comercial" | "robo";
  n: number;
  /** Fatia das perdas confiáveis (0–1). */
  share: number;
  /** Fração registrada mais de 72 h depois da entrada; `null` sem registro datado (e no robô). */
  registradoComAtraso: number | null;
  /** Quantos leads da linha tinham registro datado (o n do atraso); 0 no robô. */
  atrasoN: number;
  mediaTentativas: number;
  /** Para onde cada lead da linha aponta, pela regra. */
  ondeAtacar: Partial<Record<AlvoDaPerda, number>>;
  /**
   * "Contato inválido" aberto pelo motivo (K25): `lostReasonDetail` é NORMALIZADO
   * ANTES de agrupar — chave de `MOTIVOS_CONTATO_INVALIDO` → ela; vazio →
   * "sem_motivo"; qualquer outro texto → "outro", com o rótulo DA TABELA. Texto
   * livre nunca sai (LGPD, F3-D23).
   */
  detalhes?: { motivo: string; label: string; n: number }[];
  /** Status registrados pela API do n8n (`ATOR_N8N`) nesta linha — só no ⓘ. */
  peloN8n?: number;
  /** Linhas do robô: quantos seguem abertos no painel (o status não muda). */
  abertos?: number;
}

export interface PerdasConfiaveis {
  linhas: LinhaPerda[];
  /** Perdas sem reunião, depois da limpeza (pessoas — uma linha por pessoa). */
  total: number;
  /** Leads do período que sobraram depois da limpeza (a base do %). */
  base: number;
  excluidos: {
    /** Cadastros com cara de teste (`pareceTeste`). */
    testes: number;
    /** Cópias de duplicado de outra pessoa (o principal fica). */
    duplicados: number;
    /** Encerrados DEPOIS de ter reunião: não são "perda sem reunião" (B20). */
    comReuniao: number;
  };
  /** "Sem resposta" sem nenhuma tentativa registrada — apontam para o comercial. */
  semTentativa: number;
  /** Leads da base com fim de conversa pelo robô FORA do trecho do robô (live, antes, reabertos…), abertos: não viram linha do robô (K5). */
  roboForaDoTrecho: number;
}

/**
 * O que a regra precisa saber de um lead perdido. O lead que o robô recebeu
 * (`roboVistoEm`) teve o 1º contato pelo robô (11.7): "1ª tentativa fora do
 * prazo" não se aplica a ele — só "menos de 3 tentativas" manda para o comercial.
 * `registradoEm` é quando o status de perda ATUAL foi registrado: o último
 * `status_changed` para ele, senão o marco `lostAt`.
 */
function contextoDaPerda(l: Lead, evs: LeadEvent[]) {
  const rc = resumoContato(evs);
  const primeira = rc.primeira ?? l.firstContactAt;
  const prazo = somarHorasUteis(l.createdAt, SLA_PRIMEIRO_CONTATO_HORAS);
  // Com o robô, a 1ª tentativa humana conta como "no prazo": o prazo de 1 hora útil não vale.
  const primeiraNoPrazo = !primeira ? null : l.roboVistoEm ? true : Date.parse(primeira) <= Date.parse(prazo);
  const registro = isLostStatus(l.status)
    ? evs
        .filter((e) => e.action === "status_changed" && e.toStatus === l.status)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .at(-1)
    : undefined;
  const registradoEm = isLostStatus(l.status) ? (registro?.createdAt ?? l.lostAt) : undefined;
  const atraso = registradoEm ? Date.parse(registradoEm) - Date.parse(l.createdAt) > ATRASO_REGISTRO_HORAS * 3_600_000 : null;
  return { tentativas: rc.tentativas, primeiraNoPrazo, atraso, registradoEm, peloN8n: registro?.actor === ATOR_N8N };
}

/** A chave normalizada do motivo de "Contato inválido" (K25): só chaves da tabela saem. */
function motivoNormalizado(detalhe: string | undefined): { motivo: string; label: string } {
  const m = detalhe?.trim() ?? "";
  if (!m) return { motivo: "sem_motivo", label: "Sem motivo registrado" };
  const chave = Object.prototype.hasOwnProperty.call(MOTIVOS_CONTATO_INVALIDO, m) ? m : "outro";
  return { motivo: chave, label: MOTIVOS_CONTATO_INVALIDO[chave] };
}

/**
 * As perdas dos leads que entraram no período, confiáveis: sem testes, sem cópias
 * de duplicado (`testesEDuplicados`, a régua das juntas do funil do processo) e
 * sem quem chegou a agendar (`everBooked` — o lead que teve reunião não é "perda
 * sem reunião"). `eventos` = histórico da marca (tentativas, mudanças de status,
 * reabertos).
 *
 * Com `opts.trechoDoRobo` (os ids de "Com o robô", `idsDoTrechoDoRobo` — só com o
 * trecho do robô na tela), o fim da conversa pelo robô (`encerramentoDoRobo`)
 * também é perda, com o lead aberto ou não — SÓ para quem está no trecho (K5). Uma
 * pessoa, uma linha: vale o PRIMEIRO encerramento (o do robô com data ≤ o registro
 * do status; sem data do robô, o status). Fora do trecho, o fim da conversa de um
 * lead aberto só entra na contagem `roboForaDoTrecho`. Sem `trechoDoRobo`: só os
 * status de perda, como sempre.
 */
export function perdasConfiaveis(
  data: DashboardData,
  range: DateRange | undefined,
  eventos: readonly LeadEvent[],
  opts?: { trechoDoRobo?: ReadonlySet<string> },
): PerdasConfiaveis {
  const vivos = data.leads.filter((l) => !l.deletedAt);
  // Testes e cópias se decidem na marca inteira: a cópia pode ter entrado em outro período.
  const { testes, duplicados } = testesEDuplicados(data.leads);

  const doPeriodo = filterLeads(vivos, range);
  const base = doPeriodo.filter((l) => !testes.has(l.id) && !duplicados.has(l.id));
  const perdidos = base.filter((l) => isLostStatus(l.status));
  const porLead = eventosPorLead([...eventos]);
  const trecho = opts?.trechoDoRobo;
  const reabertos = trecho ? reabertosPorLead(eventos) : new Map<string, string>();

  type Item = { l: Lead; ctx: ReturnType<typeof contextoDaPerda> };
  const porMotivo = new Map<MotivoDaPerda, Item[]>();
  const juntar = (m: MotivoDaPerda, it: Item) => porMotivo.set(m, [...(porMotivo.get(m) ?? []), it]);
  let roboForaDoTrecho = 0;

  for (const l of base) {
    if (everBooked(l)) continue;
    const perdido = isLostStatus(l.status);
    const enc = trecho ? encerramentoDoRobo(l, reabertos.get(l.id)) : null;
    if (!perdido && !enc) continue;
    const ctx = contextoDaPerda(l, porLead.get(l.id) ?? []);
    if (enc && trecho?.has(l.id)) {
      // Vale o primeiro: o robô com data antes (ou no mesmo instante) do registro do status.
      const roboPrimeiro =
        !perdido || (enc.em != null && (!ctx.registradoEm || Date.parse(enc.em) <= Date.parse(ctx.registradoEm)));
      if (roboPrimeiro) {
        juntar(MOTIVO_DO_ROBO[enc.motivo], { l, ctx });
        continue;
      }
    } else if (enc && !perdido) {
      roboForaDoTrecho += 1;
      continue;
    }
    juntar(l.status, { l, ctx });
  }

  const total = [...porMotivo.values()].reduce((s, xs) => s + xs.length, 0);
  const linhas: LinhaPerda[] = [];
  let semTentativa = 0;
  for (const [motivo, itens] of porMotivo) {
    const doRobo = motivo.startsWith("robo-");
    const mediaTentativas = itens.reduce((s, c) => s + c.ctx.tentativas, 0) / itens.length;
    if (doRobo) {
      const m = motivo as Extract<MotivoDaPerda, `robo-${string}`>;
      linhas.push({
        motivo,
        label: ROTULO_DO_ROBO[m],
        quem: "robo",
        n: itens.length,
        share: itens.length / total,
        registradoComAtraso: null,
        atrasoN: 0,
        mediaTentativas,
        ondeAtacar: { [ALVO_DO_ROBO[m]]: itens.length },
        abertos: itens.filter((c) => !isLostStatus(c.l.status)).length,
      });
      continue;
    }
    const status = motivo as LeadStatus;
    const comRegistro = itens.filter((c) => c.ctx.atraso !== null);
    const alvos: Partial<Record<AlvoDaPerda, number>> = {};
    for (const c of itens) {
      const a = ondeAtacar(status, c.ctx);
      alvos[a] = (alvos[a] ?? 0) + 1;
      if (status === "sem_resposta" && c.ctx.tentativas === 0) semTentativa += 1;
    }
    const peloN8n = itens.filter((c) => c.ctx.peloN8n).length;
    const linha: LinhaPerda = {
      motivo,
      status,
      label: LEAD_STATUS_META[status].label,
      quem: "comercial",
      n: itens.length,
      share: itens.length / total,
      registradoComAtraso: comRegistro.length > 0 ? comRegistro.filter((c) => c.ctx.atraso).length / comRegistro.length : null,
      atrasoN: comRegistro.length,
      mediaTentativas,
      ondeAtacar: alvos,
      ...(peloN8n > 0 ? { peloN8n } : {}),
    };
    if (status === "contato_invalido") {
      const porChave = new Map<string, { motivo: string; label: string; n: number }>();
      for (const { l } of itens) {
        const k = motivoNormalizado(l.lostReasonDetail);
        const atual = porChave.get(k.motivo);
        porChave.set(k.motivo, { ...k, n: (atual?.n ?? 0) + 1 });
      }
      linha.detalhes = [...porChave.values()].sort((a, b) => b.n - a.n);
    }
    linhas.push(linha);
  }
  linhas.sort((a, b) => b.n - a.n || ORDEM_DAS_LINHAS.indexOf(a.motivo) - ORDEM_DAS_LINHAS.indexOf(b.motivo));

  return {
    linhas,
    total,
    base: base.length,
    excluidos: {
      testes: doPeriodo.filter((l) => testes.has(l.id)).length,
      duplicados: doPeriodo.filter((l) => !testes.has(l.id) && duplicados.has(l.id)).length,
      comReuniao: perdidos.filter(everBooked).length,
    },
    semTentativa,
    roboForaDoTrecho,
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
 * `LOTE_JANELA_MIN`, `ATRASO_REGISTRO_SHARE`). Só fica "baixa" com amostra
 * (`AMOSTRA_MIN.C5`): 1 de 2 registros não diz nada sobre o processo. Baixa vira o
 * alerta `registro-suspeito` (`alertasDoFunil`); o texto vai ao ⓘ das perdas.
 */
export function confiancaDoRegistro(data: DashboardData, range: DateRange | undefined, eventos: readonly LeadEvent[]): ConfiancaRegistro {
  const porLead = new Map(data.leads.map((l) => [l.id, l]));
  const mudancas = eventos
    .filter((e) => e.action === "status_changed" && porLead.has(e.leadId) && inRange(diaDoLead(e.createdAt), range))
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
