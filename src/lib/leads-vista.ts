/**
 * A vista de Leads — cada linha da tabela pronta para a tela, e os filtros,
 * as contagens e o CSV que a tela usa. Puro, sem I/O.
 *
 * A página não calcula nada (ADR-03): carrega os dados e o histórico e chama
 * `montarLinhasDeLeads`. Tudo o que uma coluna mostra sai da fonte única de
 * cada fato — etapa máxima dos marcos (`etapaMaxima`), tentativas do histórico
 * (`resumoContato`), o atendimento agora da MESMA régua da Fila (`etapaDoLead`
 * com o robô) e de `situacaoDoRobo`, origem da junção única (`origemDoLead`),
 * dono de `lib/dono.ts` — para o que Leads diz de uma pessoa ser o que a Fila e
 * o Funil dizem dela.
 */

import { eventosPorLead, resumoContato, type ResumoContato } from "./contato";
import { DONO_LABEL, type Dono } from "./dono";
import {
  etapaDoLead,
  etapaEVoltaDoLead,
  FILA_ETAPAS,
  HORAS_APOS_CONVERSA,
  reunioesPorTelefone,
  type FilaEtapa,
  type VoltaDaCadencia,
} from "./fila";
import { formatDateTime, formatDateTimeCurta, formatarEspera } from "./format";
import { gruposDuplicados, pareceTeste, problemasDeContato } from "./identidade";
import {
  ETAPAS_MAXIMAS,
  ETAPA_MAXIMA_LABEL,
  LEAD_STATUSES,
  etapaMaxima,
  isLostStatus,
  statusLabel,
  type EtapaMaxima,
} from "./lead-status";
import { everBooked, filterLeads, type DateRange } from "./metrics";
import { origemDoLead, type Origem } from "./origem";
import { ETAPA_DA_LIVE, etapaDaLive, type EtapaDaLive } from "./fila-live";
import type { Expediente } from "./turno";
import {
  BENS,
  CLASSES,
  CLASSES_NA_FILA,
  FAIXAS_PARCELA,
  FAIXAS_VALOR,
  FINALIDADES,
  PRAZOS_COMPRA,
  STATUS_ATENDIMENTO,
  STATUS_REUNIAO,
  classeDiverge,
  classeDoLead,
  statusAtendimento,
  statusReuniao,
  type Bem,
  type Classe,
  type FaixaParcela,
  type FaixaValor,
  type Finalidade,
  type PrazoCompra,
  type StatusAtendimento,
  type StatusReuniao,
} from "./qualificacao";
import { ROBO_ETAPA_LABEL, ROBO_INICIO } from "./robo/etapa";
import {
  FILTROS_DO_ROBO,
  FILTRO_ROBO_LABEL,
  RESGATE_MOTIVO_LABEL,
  RESGATE_ROBO_NAO_FALOU_H,
  RESGATE_SEM_RESPOSTA_H,
  casaFiltroRobo,
  leadAberto,
  reabertoDe,
  reabertoNoPainelDe,
  refDoRobo,
  situacaoDoRobo,
  type FiltroRobo,
  type RoboNaFila,
  type SituacaoRobo,
} from "./robo/situacao";
import type { DashboardData, Lead, LeadEvent, LeadStatus } from "./types";

// ---------------------------------------------------------------- vocabulário

/** O que fazer com o lead AGORA, nas palavras da Fila (robô desligado). "—" = nada neste momento. */
export type ProximaAcao = "ligar agora" | "retornar" | "confirmar reunião" | "registrar desfecho" | "—";

/** Cada etapa da Fila da live, no mesmo vocabulário. */
const ACAO_DA_LIVE: Record<EtapaDaLive, ProximaAcao> = {
  primeira: "ligar agora",
  cadencia: "retornar",
  retornar: "retornar",
  encerrar: "registrar desfecho",
};

/** Cada grupo da Fila, no verbo de quem vai agir — o texto do robô DESLIGADO (o de antes). */
export const ACAO_DA_ETAPA: Record<FilaEtapa, ProximaAcao> = {
  novo: "ligar agora",
  retornar: "retornar",
  // Os grupos do robô ligado têm texto próprio (`atendimentoNoGrupo`); aqui só por completude.
  resgate: "ligar agora",
  "convite-aceito": "ligar agora",
  confirmar: "confirmar reunião",
  "sem-desfecho": "registrar desfecho",
};

export type SinalizadorChave = "teste" | "duplicado" | "contato_invalido";

export const SINALIZADOR_LABEL: Record<SinalizadorChave, string> = {
  teste: "Teste",
  duplicado: "Duplicado",
  contato_invalido: "Contato inválido",
};

export interface Sinalizadores {
  /** Por que parece cadastro de teste (`pareceTeste`), ou null. */
  teste: string | null;
  /** A mesma pessoa tem outro cadastro (mesmo telefone ou e-mail). */
  duplicado: boolean;
  /** Nome do cadastro principal quando ESTE é o duplicado. */
  duplicadoDe?: string;
  /** Contato com formato inválido, ou já encerrado como "Contato inválido". */
  contatoInvalido: boolean;
}

/**
 * Onde a pessoa está AGORA e quem age — a coluna "Atendimento" de Leads (§7).
 * Montada da MESMA `etapaDoLead` da Fila (com o robô) e de `situacaoDoRobo`, sem
 * precedência própria: o grupo da Fila vence; fora dela, o robô (em conversa,
 * esperando resposta, encerrado), "Antes do robô" ou nada. Robô desligado: o
 * texto de antes ("ligar agora", "retornar"…), sem prefixo.
 */
export interface AtendimentoAgora {
  /** Quem age em seguida; sem dono = lead encerrado. O filtro "dono" lê daqui. */
  dono?: Dono;
  /** "Robô · em conversa há 2 h", "Resgate · 1 tentativa", "Comercial · confirmar 18/11"… */
  texto: string;
  /** O porquê (dica da célula). */
  dica: string;
  /** Passou do prazo do grupo da Fila (ou do turno da live). */
  atrasado: boolean;
  /** A ordem da coluna: o atraso relativo da Fila (maior = mais urgente; nada a fazer = −1). */
  ordem: number;
  /** O grupo da Fila onde a ação mora (`/fila?etapa=<g>#<g>`, ou `/fila#live`). */
  href?: string;
}

export interface LinhaDeLead {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  createdAt: string;
  status: LeadStatus;
  /** Já teve reunião marcada (`everBooked`) — decide os destinos do editor. */
  jaAgendou: boolean;
  /** Data DA reunião. Agendado antes de out/2026 não tem (a coluna diz isso). */
  meetingFor?: string;
  etapaMaxima: EtapaMaxima;
  tentativas: number;
  diasComTentativa: number;
  falou: boolean;
  ultimaTentativa?: string;
  proximaTentativa?: string;
  /** Onde a pessoa está agora e quem age (a coluna "Atendimento"). */
  atendimentoAgora: AtendimentoAgora;
  /** Grupo da Fila em que a pessoa está agora (o link da coluna abre nele). */
  etapaDaFila?: FilaEtapa;
  /** A ação vem da Fila da live (A e B, pelo prazo do turno). */
  naFilaDaLive: boolean;
  /** As chaves do filtro do robô em que a pessoa entra (`casaFiltroRobo`). Robô desligado: nenhuma. */
  robo: FiltroRobo[];
  /** Pediu ao robô para não receber mensagens (LGPD): sem botão de WhatsApp. */
  optOut: boolean;
  origem: Origem;
  sinalizadores: Sinalizadores;
  // ---- ficha da live (lib/qualificacao.ts) ----
  /** A classe que vale (a do painel; sem ela, a do n8n) — `classeDoLead`. */
  classe?: Classe;
  /** A do painel e a do n8n discordam. */
  classeDiverge: boolean;
  bem?: Bem;
  faixaValor?: FaixaValor;
  finalidade?: Finalidade;
  faixaParcela?: FaixaParcela;
  prazoCompra?: PrazoCompra;
  /** A leitura em cinco estados do atendimento ("Status do atendimento"). */
  atendimento: StatusAtendimento;
  reuniao?: StatusReuniao;
  /** Clicou no link da comunidade. */
  comunidade: boolean;
  /** Mensagem automática: saiu, falhou (status "falhou") ou não há registro. */
  msg1: Msg1Situacao;
}

/** A mensagem automática do lead, como o filtro e o CSV leem. */
export type Msg1Situacao = "enviada" | "falhou" | "nao";
export const MSG1_SITUACAO_LABEL: Record<Msg1Situacao, string> = {
  enviada: "Enviada",
  falhou: "Falhou",
  nao: "Sem registro",
};

function msg1Situacao(l: Pick<Lead, "msg1EnviadaEm" | "msg1Status">): Msg1Situacao {
  if (l.msg1Status === "falhou") return "falhou";
  return l.msg1EnviadaEm ? "enviada" : "nao";
}

// ---------------------------------------------------------------- montagem

/**
 * Quem age em seguida. Na Fila, o dono da etapa; fora dela, o especialista
 * conduz quem já compareceu (e o cliente); quem espera a cadência ou a reunião
 * continua com o comercial; perda encerrada não tem dono — ninguém age.
 */
function donoDoLead(l: Lead, etapa: FilaEtapa | undefined): Dono | undefined {
  if (etapa) return FILA_ETAPAS[etapa].dono;
  if (l.status === "reuniao_realizada" || l.status === "cliente") return "ESP";
  if (isLostStatus(l.status)) return undefined;
  return "COM";
}

/**
 * O motivo de não haver ação agora — para a dica do "—" não ser um zero disfarçado.
 * `voltaARetornar`: só com o robô desligado e sem classe a pessoa volta ao grupo
 * "Retornar hoje" (com o robô, quem a cadência escondeu tem a `volta` da Fila; a
 * live tem a régua dela).
 */
function porqueSemAcao(l: Lead, contato: ResumoContato, voltaARetornar: boolean): string {
  if (isLostStatus(l.status)) return `Encerrado como “${statusLabel(l.status)}”.`;
  if (l.status === "cliente") return "Fechou — nada a fazer.";
  if (l.status === "reuniao_realizada") return "Compareceu; o desfecho (cliente ou não) é do especialista.";
  // Já confirmada (fato da ficha ou do n8n): sai de "a confirmar" nos dois modos (11.5).
  if (l.status === "agendado" && l.meetingFor && l.reuniaoConfirmadaEm) {
    return `Reunião em ${formatDateTime(l.meetingFor)} — já confirmada; registre o desfecho depois dela.`;
  }
  if (l.status === "agendado" && l.meetingFor) {
    return `Reunião em ${formatDateTime(l.meetingFor)} — confirmar ${FILA_ETAPAS.confirmar.slaHoras} h antes.`;
  }
  if (l.status === "agendado") return "Agendado sem data registrada; vira “sem desfecho” uma semana depois.";
  if (contato.proxima) return `Retorno combinado pela cadência para ${formatDateTime(contato.proxima)}.`;
  // Tentativa sem retorno combinado (falou e não fechou nada, ou a cadência
  // acabou): a Fila traz a pessoa de volta HORAS_APOS_CONVERSA depois da última
  // tentativa — a MESMA conta de `etapaDoLead`. Até lá existe um prazo; dizer
  // "nada pendente" esconderia o relógio que estoura amanhã.
  if (voltaARetornar && l.status === "em_contato" && contato.ultima) {
    const volta = new Date(Date.parse(contato.ultima) + HORAS_APOS_CONVERSA * 3_600_000).toISOString();
    const conversa = contato.falou ? " — já falou com a pessoa" : "";
    return (
      `Última tentativa em ${formatDateTime(contato.ultima)}${conversa}, sem desfecho; ` +
      `volta à Fila (“${FILA_ETAPAS.retornar.label}”) em ${formatDateTime(volta)}, ${HORAS_APOS_CONVERSA} h depois.`
    );
  }
  return "Nada pendente neste momento.";
}

const tentativasTxt = (n: number) => `${n} ${n === 1 ? "tentativa" : "tentativas"}`;
/** "18/11" — o dia em Brasília. */
const diaCurto = (iso: string) => formatDateTimeCurta(iso).split(" ")[0];
/** " há 2 h" (vazio sem data). */
const haQuanto = (desde: string | null | undefined, agora: string) =>
  desde ? ` há ${formatarEspera(Math.max(0, Date.parse(agora) - Date.parse(desde)) / 3_600_000)}` : "";
/** O link do grupo: `?etapa=` abre a Fila nele e a âncora rola até ele. */
const linkDoGrupo = (g: FilaEtapa) => `/fila?etapa=${g}#${g}`;

type Etapa = NonNullable<ReturnType<typeof etapaDoLead>>;
type Live = NonNullable<ReturnType<typeof etapaDaLive>>;

/** O atraso relativo da Fila (a mesma conta de `montarFila`); a live pelo prazo do turno. */
function ordemDe(etapa: Etapa | null, live: Live | null, agora: string): number {
  if (etapa) {
    return etapa.nome === "confirmar" ? (etapa.atraso ?? 0) : etapa.horasUteis / FILA_ETAPAS[etapa.nome].slaHoras;
  }
  if (live) {
    const passou = (Date.parse(agora) - Date.parse(live.prazo)) / 3_600_000;
    return live.prazo < agora ? 1 + Math.max(0, passou) : 0.5;
  }
  return -1;
}

/** A dica de quem está num grupo da Fila: o que aconteceu e o prazo. */
function dicaDoGrupo(etapa: Etapa): string {
  const hint = FILA_ETAPAS[etapa.nome].hint;
  if (etapa.nome === "resgate" && etapa.motivo) {
    const prazo = etapa.venceEm ? ` Prazo: ${formatDateTime(etapa.venceEm)}.` : "";
    return `Resgate — ${RESGATE_MOTIVO_LABEL[etapa.motivo]}.${prazo}`;
  }
  if ((etapa.nome === "confirmar" || etapa.nome === "sem-desfecho") && etapa.reuniao) {
    return `${hint} Reunião: ${formatDateTime(etapa.reuniao)}.`;
  }
  return etapa.venceEm ? `${hint} Vence ${formatDateTime(etapa.venceEm)}.` : `${hint} Desde ${formatDateTime(etapa.desde)}.`;
}

/** O texto de quem está num grupo da Fila com o robô ligado. */
function textoDoGrupo(etapa: Etapa, contato: ResumoContato): string {
  switch (etapa.nome) {
    case "resgate":
      return `Resgate · ${
        contato.tentativas > 0 ? tentativasTxt(contato.tentativas) : etapa.motivo ? RESGATE_MOTIVO_LABEL[etapa.motivo] : "retomar o contato"
      }`;
    case "convite-aceito":
      return "Comercial · conferir Calendly";
    case "confirmar":
      return etapa.reuniao ? `Comercial · confirmar ${diaCurto(etapa.reuniao)}` : "Comercial · confirmar reunião";
    case "sem-desfecho":
      return "Comercial · registrar desfecho";
    default:
      return ACAO_DA_ETAPA[etapa.nome];
  }
}

interface EntradaDoAtendimento {
  l: Lead;
  agora: string;
  contato: ResumoContato;
  etapa: Etapa | null;
  /** Fora do grupo agora só pela cadência humana (`etapaEVoltaDoLead`, robô ligado). */
  volta?: VoltaDaCadencia;
  /** Aceitou o convite e a mesma pessoa já agendou por outro cadastro (`etapaEVoltaDoLead`). */
  reuniaoEmOutroCadastro?: boolean;
  live: Live | null;
  classe: Classe | undefined;
  /** C e X sem grupo: fora da Fila de contato (só em Leads). */
  foraDaFila: boolean;
  /** `situacaoDoRobo` (desligada quando o robô está desligado). */
  s: SituacaoRobo;
}

/**
 * A coluna "Atendimento" — sem precedência própria: o grupo da Fila (a MESMA
 * `etapaDoLead`), depois a Fila da live (como antes), depois quem a cadência
 * humana tirou do grupo agora (a `volta` da MESMA conta — sem link: a Fila não
 * mostra a pessoa até lá), depois o robô.
 */
export function atendimentoDoLead(e: EntradaDoAtendimento): AtendimentoAgora {
  const { l, agora, contato, etapa, volta, reuniaoEmOutroCadastro, live, classe, foraDaFila, s } = e;
  const ordem = ordemDe(etapa, live, agora);
  const daLive = (texto: string): AtendimentoAgora => ({
    dono: "COM",
    texto,
    dica: `Fila da live (classe ${classe}): ${ETAPA_DA_LIVE[live!.etapa].label.toLowerCase()} — prazo ${formatDateTime(live!.prazo)}.`,
    atrasado: live!.prazo < agora,
    ordem,
    href: "/fila#live",
  });
  const nada = (dica = porqueSemAcao(l, contato, !s.ligado && !classe)): AtendimentoAgora => ({
    dono: donoDoLead(l, undefined),
    texto: "—",
    dica,
    atrasado: false,
    ordem,
  });

  // ---- robô desligado: o texto de antes, sem prefixo ----
  if (!s.ligado) {
    if (etapa) {
      return {
        dono: FILA_ETAPAS[etapa.nome].dono,
        texto: ACAO_DA_ETAPA[etapa.nome],
        dica: etapa.venceEm
          ? `${FILA_ETAPAS[etapa.nome].hint} Vence ${formatDateTime(etapa.venceEm)}.`
          : `${FILA_ETAPAS[etapa.nome].hint} Desde ${formatDateTime(etapa.desde)}.`,
        atrasado: etapa.nome === "confirmar" ? false : ordem > 1,
        ordem,
        href: linkDoGrupo(etapa.nome),
      };
    }
    if (live) return daLive(ACAO_DA_LIVE[live.etapa]);
    if (foraDaFila) return nada(`Classe ${classe}: fica fora da Fila de contato (só em Leads).`);
    return nada();
  }

  // ---- robô ligado ----
  if (etapa) {
    return {
      dono: FILA_ETAPAS[etapa.nome].dono,
      texto: textoDoGrupo(etapa, contato),
      dica: dicaDoGrupo(etapa),
      atrasado: etapa.nome === "confirmar" ? false : ordem > 1,
      ordem,
      href: linkDoGrupo(etapa.nome),
    };
  }
  // A live está congelada: o texto de antes.
  if (live) return daLive(ACAO_DA_LIVE[live.etapa]);

  // A cadência humana tirou a pessoa do grupo agora: ela volta na próxima da cadência.
  if (volta) {
    const grupo = FILA_ETAPAS[volta.nome].label;
    const porque =
      volta.nome === "convite-aceito"
        ? FILA_ETAPAS["convite-aceito"].hint
        : `Resgate — ${volta.motivo ? RESGATE_MOTIVO_LABEL[volta.motivo] : "retomar o contato"}.`;
    const ultima = contato.ultima
      ? ` Última tentativa em ${formatDateTime(contato.ultima)}${contato.falou ? " — já falou com a pessoa" : ""}.`
      : "";
    return {
      dono: "COM",
      texto: `${grupo} · volta ${formatDateTimeCurta(volta.volta)}`,
      dica: `${porque}${ultima} Volta ao grupo “${grupo}” da Fila em ${formatDateTime(volta.volta)}, pela cadência.`,
      atrasado: false,
      ordem: 0,
    };
  }
  if (reuniaoEmOutroCadastro) {
    return {
      dono: "COM",
      texto: "Reunião em outro cadastro",
      dica: "Aceitou o convite e a mesma pessoa (mesmo telefone) já agendou por outro cadastro. Dá para mesclar em Leads → Revisar.",
      atrasado: false,
      ordem: 0,
    };
  }
  if (foraDaFila) return nada(`Classe ${classe}: fica fora da Fila de contato (só em Leads).`);
  if (!s.noRecorte) return nada();

  if (s.antesDoRobo) {
    // Quem tem retorno combinado nos últimos 7 dias está no Resgate (ou na `volta` acima).
    return {
      dono: "COM",
      texto: "Antes do robô",
      dica: `Entrou antes do robô (${dataBr(ROBO_INICIO)}): fica fora da Fila de contato.`,
      atrasado: false,
      ordem: 0,
    };
  }

  // Com o robô de WhatsApp.
  const robo = (texto: string, dica: string): AtendimentoAgora => ({ dono: "BOT", texto: `Robô · ${texto}`, dica, atrasado: false, ordem: 0 });
  if (s.balde === "em-conversa") {
    return robo(
      `em conversa${haQuanto(s.desde, agora)}`,
      `Conversando com o robô de WhatsApp${s.desde ? ` — última interação em ${formatDateTime(s.desde)}` : ""}.`,
    );
  }
  if (s.balde === "esperando") {
    return robo(
      `esperando resposta${haQuanto(s.desde, agora)}`,
      `O robô mandou a 1ª mensagem${s.desde ? ` em ${formatDateTime(s.desde)}` : ""}; sem resposta em ${RESGATE_SEM_RESPOSTA_H} h, vai para o resgate.`,
    );
  }
  if (s.balde === "encerrado") {
    return robo("encerrado", `O robô encerrou a conversa${s.desde ? ` em ${formatDateTime(s.desde)}` : ""}.`);
  }
  if (s.naoRecebido) {
    return robo("não recebeu", `O robô ainda não recebeu este lead; depois de ${RESGATE_ROBO_NAO_FALOU_H} h, vai para o resgate.`);
  }
  if (s.semPrimeiraMsg) {
    return robo(
      "sem a 1ª mensagem",
      `O robô recebeu e ainda não mandou a 1ª mensagem; depois de ${RESGATE_ROBO_NAO_FALOU_H} h, vai para o resgate.`,
    );
  }
  if (s.etapa) {
    return robo(`${ROBO_ETAPA_LABEL[s.etapa]}${haQuanto(s.desde, agora)}`, `Com o robô de WhatsApp: ${ROBO_ETAPA_LABEL[s.etapa]}.`);
  }
  return robo("aguardando a 1ª mensagem", "Acabou de entrar: o robô manda a 1ª mensagem em alguns minutos.");
}

/**
 * As linhas da tabela de Leads. `eventos` = histórico da marca (todas as
 * tentativas); `agora` em ISO para a função seguir pura. Com `range`, só os
 * leads que ENTRARAM no período — a coorte, como a aba Funil lê.
 */
export function montarLinhasDeLeads(
  data: DashboardData,
  eventos: LeadEvent[],
  agora: string,
  opts: {
    range?: DateRange;
    /** O turno da live: a próxima ação dos A e B sai da Fila da live (`etapaDaLive`). */
    expediente?: Expediente;
    /** O robô (`estadoDoRoboAgora`) — o MESMO da Fila. Ausente ou desligado = o texto de antes. */
    robo?: RoboNaFila;
  } = {},
): LinhaDeLead[] {
  const origem = origemDoLead(data);
  const porLead = eventosPorLead(eventos);
  const robo = opts.robo?.ligado ? opts.robo : undefined;
  const ref = refDoRobo(robo, agora);

  // Duplicados olham a base INTEIRA (um duplicado pode ter entrado fora do período).
  const grupoDe = new Map<string, { principal: Lead }>();
  for (const g of gruposDuplicados(data.leads)) {
    for (const m of [g.principal, ...g.duplicados]) grupoDe.set(m.id, { principal: g.principal });
  }

  // O mesmo contexto da Fila: quem já agendou por outro cadastro (a mesma pessoa).
  const ctx = { reunioesPorTelefone: reunioesPorTelefone(data.leads) };

  const leads = filterLeads(data.leads, opts.range).filter((l) => !l.deletedAt);
  return leads.map((l): LinhaDeLead => {
    const proprios = porLead.get(l.id) ?? [];
    const contato = resumoContato(proprios);
    const { etapa, volta, reuniaoEmOutroCadastro } = etapaEVoltaDoLead(l, proprios, agora, robo, ctx);
    // Da ficha da live: A e B têm a próxima ação na Fila da live; C e X, nenhuma.
    const classe = classeDoLead(l);
    const live = classe && opts.expediente && !etapa ? etapaDaLive(l, proprios, opts.expediente) : null;
    const foraDaFila = Boolean(classe && !CLASSES_NA_FILA.includes(classe) && !etapa && leadAberto(l));
    const reabertoEm = reabertoDe(proprios);
    const s = situacaoDoRobo(l, { agora, ref, ligado: Boolean(robo), reabertoEm, reabertoNoPainel: reabertoNoPainelDe(proprios) });
    const grupo = grupoDe.get(l.id);
    return {
      id: l.id,
      name: l.name,
      email: l.email,
      phone: l.phone,
      createdAt: l.createdAt,
      status: l.status,
      jaAgendou: everBooked(l),
      meetingFor: l.meetingFor,
      etapaMaxima: etapaMaxima(l),
      tentativas: contato.tentativas,
      diasComTentativa: contato.diasComTentativa,
      falou: contato.falou,
      ultimaTentativa: contato.ultima,
      proximaTentativa: contato.proxima,
      atendimentoAgora: atendimentoDoLead({ l, agora, contato, etapa, volta, reuniaoEmOutroCadastro, live, classe, foraDaFila, s }),
      etapaDaFila: etapa?.nome,
      naFilaDaLive: Boolean(live),
      robo: FILTROS_DO_ROBO.filter((k) => casaFiltroRobo(l, k, s, { agora, reabertoEm })),
      optOut: Boolean(l.roboOptOutEm),
      origem: origem(l),
      sinalizadores: {
        teste: pareceTeste(l),
        duplicado: Boolean(grupo),
        duplicadoDe: grupo && grupo.principal.id !== l.id ? grupo.principal.name : undefined,
        contatoInvalido: l.status === "contato_invalido" || problemasDeContato(l).length > 0,
      },
      classe: classeDoLead(l),
      classeDiverge: classeDiverge(l),
      bem: l.bem,
      faixaValor: l.faixaValor,
      finalidade: l.finalidade,
      faixaParcela: l.faixaParcela,
      prazoCompra: l.prazoCompra,
      atendimento: statusAtendimento(l),
      reuniao: statusReuniao(l),
      comunidade: Boolean(l.comunidadeEm),
      msg1: msg1Situacao(l),
    };
  });
}

// ---------------------------------------------------------------- abas e filtros

export type AbaStatus = LeadStatus | "todos";

/** Contagem por aba — as de status SOMAM "todos", sempre (aceite 7.5). */
export function contarPorStatus(linhas: Pick<LinhaDeLead, "status">[]): Record<AbaStatus, number> {
  const c = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<AbaStatus, number>;
  c.todos = linhas.length;
  for (const r of linhas) c[r.status] += 1;
  return c;
}

export interface FiltroDeLeads {
  status: AbaStatus;
  campanha?: string;
  conjunto?: string;
  /** Quem age em seguida (`atendimentoAgora.dono`). */
  dono?: Dono;
  /** Onde a pessoa está com o robô (`casaFiltroRobo`) — as chaves dos links da barra da Fila, da B1 e do alerta. */
  robo?: FiltroRobo;
  /** Qualquer um dos marcados basta (OU) — quem filtra por sinal quer ver o que revisar. */
  sinalizadores: SinalizadorChave[];
  /** Nome, e-mail ou telefone. */
  busca: string;
  // ---- ficha da live ----
  /** "ab" = qualificados (A ou B); "sem" = sem classe (faltam respostas e o n8n não mandou). */
  classe?: Classe | "ab" | "sem";
  bem?: Bem;
  faixaValor?: FaixaValor;
  finalidade?: Finalidade;
  faixaParcela?: FaixaParcela;
  prazoCompra?: PrazoCompra;
  atendimento?: StatusAtendimento;
  /** "nunca" = nunca agendou (o fato, `everBooked`) — quem desistiu já agendou. */
  reuniao?: StatusReuniao | "nunca";
  comunidade?: "sim" | "nao";
  msg1?: Msg1Situacao;
}

/**
 * Os filtros da ficha da live: chave na URL e no pedido de exportação →
 * vocabulário que valida o valor e rótulo para o registro. Fonte única para a
 * tela, a URL, a exportação e `descreverFiltro`.
 */
export const FILTROS_DA_FICHA = {
  classe: { rotulo: "Classe", vocab: { ...CLASSES, ab: "A e B (qualificados)", sem: "Sem classe" } },
  bem: { rotulo: "Bem", vocab: BENS },
  faixaValor: { rotulo: "Valor", vocab: FAIXAS_VALOR },
  finalidade: { rotulo: "Finalidade", vocab: FINALIDADES },
  faixaParcela: { rotulo: "Parcela", vocab: FAIXAS_PARCELA },
  prazoCompra: { rotulo: "Prazo", vocab: PRAZOS_COMPRA },
  // A chave `atendimento` (na URL e nos links já compartilhados) NÃO muda; o nome
  // "Atendimento" agora é a coluna de quem age (`atendimentoAgora`).
  atendimento: { rotulo: "Status do atendimento", vocab: STATUS_ATENDIMENTO },
  reuniao: { rotulo: "Reunião", vocab: { ...STATUS_REUNIAO, nunca: "Nunca agendou" } },
  comunidade: { rotulo: "Comunidade", vocab: { sim: "Clicou", nao: "Não clicou" } },
  msg1: { rotulo: "Mensagem automática", vocab: MSG1_SITUACAO_LABEL },
} as const satisfies Record<string, { rotulo: string; vocab: Record<string, string> }>;
export type FiltroDaFicha = keyof typeof FILTROS_DA_FICHA;
export const CHAVES_FILTRO_FICHA = Object.keys(FILTROS_DA_FICHA) as FiltroDaFicha[];

/** O valor da linha que o filtro da ficha compara. */
function valorNaLinha(r: LinhaDeLead, k: FiltroDaFicha): string | undefined {
  switch (k) {
    case "classe":
      return r.classe ?? "sem";
    case "comunidade":
      return r.comunidade ? "sim" : "nao";
    default:
      return r[k];
  }
}

/** A linha passa no filtro da ficha? Os dois grupos (A e B, nunca agendou) não são um valor só. */
function casaFiltroDaFicha(r: LinhaDeLead, k: FiltroDaFicha, v: string): boolean {
  if (k === "classe" && v === "ab") return r.classe === "A" || r.classe === "B";
  if (k === "reuniao" && v === "nunca") return !r.jaAgendou;
  return valorNaLinha(r, k) === v;
}

export const FILTRO_VAZIO: FiltroDeLeads = { status: "todos", sinalizadores: [], busca: "" };

function temSinal(r: LinhaDeLead, s: SinalizadorChave): boolean {
  if (s === "teste") return r.sinalizadores.teste !== null;
  if (s === "duplicado") return r.sinalizadores.duplicado;
  return r.sinalizadores.contatoInvalido;
}

/** Tudo MENOS o status — é sobre este conjunto que as abas contam. */
export function aplicarFiltroSemStatus(linhas: LinhaDeLead[], f: FiltroDeLeads): LinhaDeLead[] {
  const q = f.busca.trim().toLowerCase();
  const qDigitos = q.replace(/\D/g, "");
  return linhas.filter((r) => {
    if (f.campanha && r.origem.campanha !== f.campanha) return false;
    if (f.conjunto && r.origem.conjunto !== f.conjunto) return false;
    if (f.dono && r.atendimentoAgora.dono !== f.dono) return false;
    if (f.robo && !r.robo.includes(f.robo)) return false;
    if (f.sinalizadores.length && !f.sinalizadores.some((s) => temSinal(r, s))) return false;
    for (const k of CHAVES_FILTRO_FICHA) {
      const v = f[k];
      if (v && !casaFiltroDaFicha(r, k, v)) return false;
    }
    if (!q) return true;
    const noTexto = r.name.toLowerCase().includes(q) || (r.email ?? "").toLowerCase().includes(q);
    const noFone = qDigitos.length > 0 && (r.phone ?? "").replace(/\D/g, "").includes(qDigitos);
    return noTexto || noFone;
  });
}

export function aplicarFiltro(linhas: LinhaDeLead[], f: FiltroDeLeads): LinhaDeLead[] {
  const base = aplicarFiltroSemStatus(linhas, f);
  return f.status === "todos" ? base : base.filter((r) => r.status === f.status);
}

/**
 * O filtro em palavras, para o registro da exportação ("quem exportou o quê").
 * A busca entra só como "sim": o texto digitado costuma ser um telefone ou um
 * e-mail, e PII não vai para o log de auditoria.
 */
export function descreverFiltro(f: FiltroDeLeads, periodo: string): string {
  const partes = [`período: ${periodo}`, `status: ${f.status === "todos" ? "todos" : statusLabel(f.status)}`];
  if (f.campanha) partes.push(`campanha: ${f.campanha}`);
  if (f.conjunto) partes.push(`conjunto: ${f.conjunto}`);
  if (f.dono) partes.push(`dono: ${DONO_LABEL[f.dono]}`);
  if (f.robo) partes.push(`robô: ${FILTRO_ROBO_LABEL[f.robo]}`);
  if (f.sinalizadores.length) partes.push(`sinalizadores: ${f.sinalizadores.map((s) => SINALIZADOR_LABEL[s]).join(", ")}`);
  for (const k of CHAVES_FILTRO_FICHA) {
    const v = f[k];
    if (v) partes.push(`${FILTROS_DA_FICHA[k].rotulo.toLowerCase()}: ${(FILTROS_DA_FICHA[k].vocab as Record<string, string>)[v]}`);
  }
  if (f.busca.trim()) partes.push("busca: sim");
  return partes.join(" · ");
}

const TETO_TEXTO_DO_FILTRO = 200;
const textoDoPedido = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, TETO_TEXTO_DO_FILTRO) : undefined;

/**
 * O filtro que o navegador PEDE na exportação, conferido campo a campo: o que
 * não for um status, um dono, uma chave do robô ou um sinalizador conhecido cai para "sem filtro"
 * nesse campo. Quem exporta é o servidor (`/leads/exportar`), que recalcula as
 * linhas e aplica ESTE filtro — o navegador só diz o que quer, não o que levou.
 */
export function filtroDoPedido(entrada: unknown): FiltroDeLeads {
  const e = (entrada && typeof entrada === "object" ? entrada : {}) as Record<string, unknown>;
  const status =
    typeof e.status === "string" && (LEAD_STATUSES as string[]).includes(e.status) ? (e.status as LeadStatus) : "todos";
  const dono = typeof e.dono === "string" && Object.hasOwn(DONO_LABEL, e.dono) ? (e.dono as Dono) : undefined;
  const robo = ehFiltroRobo(e.robo) ? e.robo : undefined;
  const sinalizadores = Array.isArray(e.sinalizadores)
    ? [
        ...new Set(
          e.sinalizadores.filter(
            (s): s is SinalizadorChave => typeof s === "string" && Object.hasOwn(SINALIZADOR_LABEL, s),
          ),
        ),
      ]
    : [];
  return {
    status,
    campanha: textoDoPedido(e.campanha),
    conjunto: textoDoPedido(e.conjunto),
    dono,
    robo,
    sinalizadores,
    busca: textoDoPedido(e.busca) ?? "",
    ...filtrosDaFichaDe(e),
  };
}

/** É uma chave do filtro do robô (`FILTROS_DO_ROBO`)? A URL e o pedido de exportação conferem aqui. */
export function ehFiltroRobo(v: unknown): v is FiltroRobo {
  return typeof v === "string" && (FILTROS_DO_ROBO as readonly string[]).includes(v);
}

/** Os filtros da ficha de um objeto qualquer (pedido, URL): o que não é do vocabulário cai. */
export function filtrosDaFichaDe(e: Record<string, unknown>): Partial<FiltroDeLeads> {
  const out: Record<string, string> = {};
  for (const k of CHAVES_FILTRO_FICHA) {
    const v = e[k];
    if (typeof v === "string" && Object.hasOwn(FILTROS_DA_FICHA[k].vocab, v)) out[k] = v;
  }
  return out as Partial<FiltroDeLeads>;
}

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

/**
 * O período no registro da exportação, com as datas que o servidor de fato
 * aplicou — não só o rótulo da chave: "7 dias" muda de sentido a cada dia, e uma
 * chave que não resolve (período inteiro no futuro, chave inválida) exporta a
 * campanha inteira. O registro diz o que saiu.
 */
export function periodoDoRegistro(rotulo: string, range: DateRange | undefined): string {
  if (!range) return "Campanha (todo o histórico)";
  return `${rotulo} (${dataBr(range.from)} a ${dataBr(range.to)})`;
}

/** Onde a tela pede o CSV (route handler da página Leads). */
export const ROTA_EXPORTAR_LEADS = "/leads/exportar";

/** Cabeçalho da resposta com quantos leads SAÍRAM — o aviso da tela lê daqui, não do filtro. */
export const CABECALHO_QTD_EXPORTADA = "x-leads-exportados";

/** "1 lead" / "3 leads" — a contagem do registro e do aviso da exportação. */
export function qtdDeLeads(n: number): string {
  return `${n} lead${n === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------- CSV

/**
 * Uma célula de texto. Dois cuidados: citar o que carrega `;`, aspas ou quebra
 * de linha, e NEUTRALIZAR o começo que o Excel executa — `=`, `+`, `-`, `@`
 * (também atrás de tab/CR). Nome, e-mail e utm_content vêm do formulário
 * público da LP: um nome `=HYPERLINK(...)` viraria link ou fórmula na máquina
 * do comercial ao abrir o arquivo. O apóstrofo faz o Excel ler como texto. O
 * único `=` de propósito é o de `csvTelefone`, que não passa por aqui.
 */
function csvCell(v: string): string {
  const perigoso = /^[=+\-@\t\r]/.test(v);
  const texto = perigoso ? `'${v}` : v;
  return perigoso || /[;"\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/**
 * Telefone como TEXTO para o Excel: sem isso ele abre 5511999990000 como número
 * e grava "5,51E+12" — foi assim que telefones viraram notação científica. O
 * importador de leads (`lerTelefone`) desfaz o `="…"`.
 *
 * Esta é a única célula que sai como fórmula, e o telefone também vem do
 * formulário público da LP (gravado só com trim): um `11;=1+1;x` partia a
 * linha em células e a do meio era executada, e uma quebra de linha abria uma
 * linha nova começando com `=`. Por isso só passam dígitos e os separadores de
 * telefone (+, parênteses, espaço, ponto, hífen) — o resto sai.
 */
export function csvTelefone(v?: string): string {
  const limpo = (v ?? "")
    .replace(/[^\d+().\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return limpo ? `="${limpo}"` : "";
}

export const CSV_CABECALHO = [
  "Nome",
  "E-mail",
  "Telefone",
  "Status",
  "Etapa máxima",
  "Entrada",
  "Tentativas",
  // Onde a pessoa está e quem age (`atendimentoAgora.texto`) — substitui "Tempo
  // até 1º contato", "Próxima ação" e "Dono" (nov/26).
  "Atendimento",
  "Campanha",
  "Conjunto",
  "Anúncio",
  "Reunião",
  "Classe",
  "Classe (n8n diverge)",
  "Bem",
  "Valor",
  "Finalidade",
  "Parcela",
  "Prazo",
  "Status do atendimento",
  "Status da reunião",
  "Comunidade",
  "Mensagem automática",
] as const;

/** CSV pt-BR (`;`, BOM, CRLF) das linhas recebidas — e só delas: o filtro vale. */
export function montarCsvDeLeads(linhas: LinhaDeLead[]): string {
  const corpo = linhas.map((r) =>
    [
      csvCell(r.name),
      csvCell(r.email ?? ""),
      csvTelefone(r.phone),
      csvCell(statusLabel(r.status)),
      csvCell(ETAPA_MAXIMA_LABEL[r.etapaMaxima]),
      csvCell(formatDateTime(r.createdAt)),
      String(r.tentativas),
      csvCell(r.atendimentoAgora.texto === "—" ? "" : r.atendimentoAgora.texto),
      csvCell(r.origem.campanha ?? ""),
      csvCell(r.origem.conjunto ?? ""),
      csvCell(r.origem.anuncio === "—" ? "" : r.origem.anuncio),
      csvCell(r.meetingFor ? formatDateTime(r.meetingFor) : r.jaAgendou ? "data não registrada" : ""),
      csvCell(r.classe ?? ""),
      csvCell(r.classeDiverge ? "sim" : ""),
      csvCell(r.bem ? BENS[r.bem] : ""),
      csvCell(r.faixaValor ? FAIXAS_VALOR[r.faixaValor] : ""),
      csvCell(r.finalidade ? FINALIDADES[r.finalidade] : ""),
      csvCell(r.faixaParcela ? FAIXAS_PARCELA[r.faixaParcela] : ""),
      csvCell(r.prazoCompra ? PRAZOS_COMPRA[r.prazoCompra] : ""),
      csvCell(STATUS_ATENDIMENTO[r.atendimento]),
      csvCell(r.reuniao ? STATUS_REUNIAO[r.reuniao] : ""),
      csvCell(r.comunidade ? "sim" : "não"),
      csvCell(MSG1_SITUACAO_LABEL[r.msg1]),
    ].join(";"),
  );
  // BOM + CRLF: é assim que o Excel pt-BR abre acentos e colunas certos.
  return "﻿" + [CSV_CABECALHO.join(";"), ...corpo].join("\r\n");
}

/** Profundidade da etapa máxima, para ordenar a coluna. */
export function profundidadeDaEtapa(e: EtapaMaxima): number {
  return ETAPAS_MAXIMAS.indexOf(e);
}
