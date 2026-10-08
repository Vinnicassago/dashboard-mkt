/**
 * A FILA ÚNICA — para quem ligar agora, nesta ordem.
 *
 * Hoje existem três filas que não se falam, cada uma numa tela diferente:
 *
 *   1. Leads sem status atualizado   (painel, /leads)     — nunca foram tocados
 *   2. Convite pendente              (robô, /robo)        — o robô ofereceu o
 *                                                           especialista e o lead
 *                                                           não respondeu
 *   3. Transferido sem 1º contato    (comercial, /comercial) — o mais quente de
 *                                                           todos, e o mais parado
 *
 * Elas se sobrepõem (a mesma pessoa pode estar em duas) e nenhuma tela mostra o
 * total. O resultado prático é que os leads mais caros do funil — os que já
 * passaram por mídia, landing page, robô e qualificação — ficam esperando dias
 * porque ninguém tem a lista.
 *
 * ORDENAÇÃO: por quanto cada um estourou o SEU SLA, não por tempo absoluto. Um
 * transferido esperando 6h (SLA 2h → 3×) vem antes de um lead parado há 30h
 * (SLA 48h → 0,6×), porque o custo de perdê-lo é muito maior. Ordenar por idade
 * crua enterraria os quentes sob o estoque antigo.
 *
 * Função PURA: recebe as três listas já carregadas e devolve uma só.
 */

import { formatarEspera } from "./format";
import { chaveTelefone } from "./phone";
import { horasUteisEntre, somarHorasUteis } from "./horario-util";
import { eventosPorLead, resumoContato, type ResumoContato } from "./contato";
import type { Lead, LeadEvent, LeadStatus } from "./types";

// ---------------------------------------------------------------- vocabulário

export type FilaEtapa =
  | "aguardando-contato"
  | "convite-pendente"
  | "novo"
  | "retornar"
  | "confirmar"
  | "sem-desfecho";
export type FilaDono = "COM" | "BOT";

/**
 * Filtros da página. "quentes" = quem a mídia já pagou para levar até o robô
 * ou o especialista — exatamente as pessoas que o farol conta.
 *
 * Existe porque o farol dizia "Abrir a fila (9)" e a página abria em "Pessoas
 * na fila: 37" (os 9 mais 28 leads antigos sem desfecho no painel). Clicar num
 * número e chegar em outro é a definição de dado desconexo: o link do farol
 * abre neste filtro para o número clicado ser o número visto.
 */
export type FiltroFila = FilaEtapa | "todos" | "quentes";
export const ETAPAS_QUENTES: FilaEtapa[] = ["aguardando-contato", "convite-pendente"];
/** Etapas que só existem com o robô ligado. */
export const ETAPAS_DO_ROBO: FilaEtapa[] = ["aguardando-contato", "convite-pendente"];

export interface EtapaMeta {
  label: string;
  /** Prazo em horas a partir do qual o item está atrasado. */
  slaHoras: number;
  /** O prazo conta só horas úteis (`lib/horario-util.ts`), não corridas. */
  horasUteis?: boolean;
  dono: FilaDono;
  /** O que aconteceu, para o card não precisar de legenda. */
  hint: string;
  /** Quanto mais fundo no funil, mais caro foi chegar até aqui. */
  profundidade: number;
}

/**
 * Fonte ÚNICA dos prazos. Os números vêm do diagnóstico da campanha: o SLA de 2h
 * entre transferência e primeiro contato é o que separa 16% de abordagem de um
 * funil que aproveita o que a mídia já pagou.
 */
export const FILA_ETAPAS: Record<FilaEtapa, EtapaMeta> = {
  "aguardando-contato": {
    label: "Esperando o 1º contato",
    slaHoras: 2,
    dono: "COM",
    hint: "O robô qualificou e passou ao especialista. Já autorizou a conversa.",
    profundidade: 3,
  },
  "convite-pendente": {
    label: "Convite sem resposta",
    slaHoras: 24,
    // O convite é do robô; retomar quem não respondeu é contato humano. Com dono
    // "robô", a ação mais urgente da home tinha verbo de gente e ninguém cobrado.
    dono: "COM",
    hint: "O robô ofereceu falar com o especialista e o lead não respondeu — retome pelo WhatsApp.",
    profundidade: 2,
  },
  /*
   * Etapas do painel (o comercial registra tudo aqui). O prazo do 1º contato era
   * 48h; com o robô parado, todo primeiro contato é manual, e quem tenta na 1ª
   * hora qualifica ~7× mais que quem tenta uma hora depois (HBR, 2011).
   */
  novo: {
    label: "Novos — ligar agora",
    slaHoras: 1,
    horasUteis: true,
    dono: "COM",
    hint: "Entrou e ninguém tentou contato. Prazo: 1 hora útil.",
    profundidade: 1,
  },
  retornar: {
    label: "Retornar hoje",
    slaHoras: 4,
    horasUteis: true,
    dono: "COM",
    hint: "Já houve tentativa e o retorno combinado pela cadência venceu.",
    profundidade: 1.5,
  },
  confirmar: {
    label: "Reuniões a confirmar",
    slaHoras: 48,
    dono: "COM",
    hint: "Reunião nas próximas 48 horas — confirme com a pessoa.",
    profundidade: 4,
  },
  "sem-desfecho": {
    label: "Reuniões sem desfecho",
    slaHoras: 24,
    horasUteis: true,
    dono: "COM",
    hint: "A data da reunião passou e ninguém registrou se ela aconteceu.",
    profundidade: 5,
  },
};

/** Horas sem resposta depois de falar com a pessoa até ela voltar à fila. */
const HORAS_APOS_CONVERSA = 24;
/** Reunião agendada antes de existir data (legado): sem desfecho depois disto. */
const DIAS_AGENDADO_SEM_DATA = 7;

export interface FilaItem {
  /** Chave estável para React e para as ações. */
  id: string;
  etapa: FilaEtapa;
  nome: string;
  telefone?: string;
  email?: string;
  /** Score do robô (0–10) quando a pessoa passou por ele. */
  score?: number;
  /** Desde quando está esperando NESTA etapa. */
  desde?: string;
  horasEsperando?: number;
  /** horasEsperando ÷ slaHoras. Acima de 1 = fora do prazo. É a ordenação. */
  atraso: number;
  /** Sessão no banco do robô — habilita marcar "abordado". */
  sessionId?: string;
  /** Lead no painel — habilita mudar status. */
  leadId?: string;
  /** Status atual do lead do painel (decide quais desfechos aparecem). */
  status?: LeadStatus;
  /** O lead do painel já teve reunião marcada — só então "Desistência" é opção. */
  jaAgendou?: boolean;
  /** Tentativas de contato já feitas (painel). */
  contato?: ResumoContato;
  /** Data da reunião (confirmar / sem desfecho). */
  reuniao?: string;
  /** Até quando cumpre o prazo (1º contato): "vence às…". */
  venceEm?: string;
  /** Contexto que o robô já colheu, para não começar a conversa do zero. */
  briefing?: string;
  /** Outras etapas em que esta mesma pessoa também aparece. */
  tambemEm: FilaEtapa[];
}

export interface FilaResumo {
  etapa: FilaEtapa;
  total: number;
  foraDoPrazo: number;
}

export interface FilaResult {
  itens: FilaItem[];
  resumo: FilaResumo[];
  /** Pessoas distintas — menor que a soma das filas quando há sobreposição. */
  total: number;
}

// ---------------------------------------------------------------- entradas

/** Linha do robô com convite pendente (vw_robo_leads). */
export interface EntradaConvite {
  nome: string | null;
  telefone: string | null;
  score: number | null;
  ultima_interacao: string | null;
}

/** Linha do comercial (vw_robo_comercial). */
export interface EntradaComercial {
  session_id: string;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  score: number | null;
  transferido_em: string | null;
  abordado_em: string | null;
  briefing: string | null;
}

export interface FilaInput {
  nowIso: string;
  /** Leads do painel. Só os que ainda não têm desfecho entram. */
  leads: Lead[];
  /** Histórico dos leads (tentativas de contato). Sem ele, ninguém está "em retorno". */
  eventos?: LeadEvent[];
  convites: EntradaConvite[];
  comercial: EntradaComercial[];
}

// ---------------------------------------------------------------- montagem

function horasDesde(iso: string | null | undefined, now: number): number | undefined {
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return undefined;
  return Math.max(0, (now - t) / 3_600_000);
}

/**
 * Atraso relativo ao prazo da etapa. Sem carimbo de tempo assumimos que está
 * no prazo (0) em vez de no topo: um dado faltando não é uma emergência, e
 * colocá-lo em primeiro empurraria para baixo quem realmente está atrasado.
 */
function calcAtraso(horas: number | undefined, slaHoras: number): number {
  if (horas === undefined) return 0;
  return horas / slaHoras;
}

export function montarFila(input: FilaInput): FilaResult {
  const now = new Date(input.nowIso).getTime();
  const itens: FilaItem[] = [];

  // 1. Transferidos sem primeiro contato — o degrau mais caro do funil.
  for (const c of input.comercial) {
    if (c.abordado_em) continue;
    const horas = horasDesde(c.transferido_em, now);
    itens.push({
      id: `com:${c.session_id}`,
      etapa: "aguardando-contato",
      nome: c.nome?.trim() || "Sem nome",
      telefone: c.telefone ?? undefined,
      email: c.email ?? undefined,
      score: c.score ?? undefined,
      desde: c.transferido_em ?? undefined,
      horasEsperando: horas,
      atraso: calcAtraso(horas, FILA_ETAPAS["aguardando-contato"].slaHoras),
      sessionId: c.session_id,
      briefing: c.briefing ?? undefined,
      tambemEm: [],
    });
  }

  // 2. Convite pendente no robô.
  for (const [i, p] of input.convites.entries()) {
    const horas = horasDesde(p.ultima_interacao, now);
    itens.push({
      id: `bot:${chaveTelefone(p.telefone) ?? i}`,
      etapa: "convite-pendente",
      nome: p.nome?.trim() || "Sem nome",
      telefone: p.telefone ?? undefined,
      score: p.score ?? undefined,
      desde: p.ultima_interacao ?? undefined,
      horasEsperando: horas,
      atraso: calcAtraso(horas, FILA_ETAPAS["convite-pendente"].slaHoras),
      tambemEm: [],
    });
  }

  // 3. Leads do painel: o trabalho do comercial, etapa por etapa.
  const porLead = eventosPorLead(input.eventos ?? []);
  for (const l of input.leads) {
    const etapa = etapaDoLead(l, porLead.get(l.id) ?? [], input.nowIso);
    if (!etapa) continue;
    const { nome: e, desde, horasUteis, reuniao, venceEm, contato } = etapa;
    const meta = FILA_ETAPAS[e];
    itens.push({
      id: `lead:${l.id}`,
      etapa: e,
      nome: l.name,
      telefone: l.phone,
      email: l.email,
      desde,
      horasEsperando: horasDesde(desde, now),
      atraso: e === "confirmar" ? etapa.atraso! : calcAtraso(horasUteis, meta.slaHoras),
      leadId: l.id,
      status: l.status,
      jaAgendou: Boolean(l.bookedAt) || ["agendado", "no_show", "reuniao_realizada"].includes(l.status),
      contato,
      reuniao,
      venceEm,
      tambemEm: [],
    });
  }

  /*
   * Dedupe por telefone. A mesma pessoa costuma estar em duas filas ao mesmo
   * tempo — transferida ao especialista E ainda como "lead" no painel, porque
   * ninguém mexeu no status. Sem juntar, a lista mostraria 32 cartões para 27
   * pessoas e o comercial ligaria duas vezes para a mesma.
   *
   * Vence a etapa mais profunda: se ela já chegou ao especialista, é lá que a
   * ação acontece — as outras aparições viram etiqueta no mesmo cartão.
   */
  const porTelefone = new Map<string, FilaItem>();
  const finais: FilaItem[] = [];
  for (const item of itens) {
    const chave = chaveTelefone(item.telefone);
    if (!chave) {
      finais.push(item);
      continue;
    }
    const existente = porTelefone.get(chave);
    if (!existente) {
      porTelefone.set(chave, item);
      finais.push(item);
      continue;
    }
    const a = FILA_ETAPAS[existente.etapa].profundidade;
    const b = FILA_ETAPAS[item.etapa].profundidade;
    const vencedor = b > a ? item : existente;
    const perdedor = b > a ? existente : item;
    // Herda o que o outro registro sabia e o outro só não tinha.
    vencedor.email ??= perdedor.email;
    vencedor.score ??= perdedor.score;
    vencedor.leadId ??= perdedor.leadId;
    vencedor.sessionId ??= perdedor.sessionId;
    vencedor.briefing ??= perdedor.briefing;
    // Só etiqueta quando a outra aparição é de OUTRA etapa. Duas linhas da mesma
    // etapa com o mesmo telefone são a mesma pessoa cadastrada duas vezes (ex.:
    // enviou o formulário da LP de novo) — fundir basta, etiquetar confundiria.
    if (perdedor.etapa !== vencedor.etapa && !vencedor.tambemEm.includes(perdedor.etapa)) {
      vencedor.tambemEm.push(perdedor.etapa);
    }
    // A espera que vale é a da etapa que venceu, mas se a pessoa está parada há
    // mais tempo na outra, é esse relógio que o comercial precisa ver.
    if (
      perdedor.horasEsperando !== undefined &&
      (vencedor.horasEsperando === undefined || perdedor.horasEsperando > vencedor.horasEsperando)
    ) {
      vencedor.horasEsperando = perdedor.horasEsperando;
      vencedor.desde = perdedor.desde;
      vencedor.atraso = calcAtraso(perdedor.horasEsperando, FILA_ETAPAS[vencedor.etapa].slaHoras);
    }
    if (vencedor !== existente) {
      finais.splice(finais.indexOf(existente), 1, vencedor);
      porTelefone.set(chave, vencedor);
    }
  }

  // Mais atrasado primeiro; empate resolve pela etapa mais funda (mais cara).
  finais.sort((a, b) => {
    if (b.atraso !== a.atraso) return b.atraso - a.atraso;
    return FILA_ETAPAS[b.etapa].profundidade - FILA_ETAPAS[a.etapa].profundidade;
  });

  const resumo: FilaResumo[] = (Object.keys(FILA_ETAPAS) as FilaEtapa[]).map((etapa) => {
    const doGrupo = finais.filter((i) => i.etapa === etapa);
    return {
      etapa,
      total: doGrupo.length,
      foraDoPrazo: doGrupo.filter((i) => i.atraso > 1).length,
    };
  });

  return { itens: finais, resumo, total: finais.length };
}

interface EtapaCalculada {
  nome: FilaEtapa;
  /** Desde quando esta etapa está esperando. */
  desde: string;
  /** Horas (úteis quando a etapa conta úteis) desde `desde`. */
  horasUteis: number;
  /** Só "confirmar": 0–1, mais perto da reunião = mais alto. */
  atraso?: number;
  reuniao?: string;
  venceEm?: string;
  contato?: ResumoContato;
}

/**
 * Em que etapa da fila um lead do painel está AGORA — ou nenhuma (não há nada a
 * fazer com ele neste momento). Pura; exportada para os testes.
 */
export function etapaDoLead(l: Lead, eventos: LeadEvent[], nowIso: string): EtapaCalculada | null {
  const now = Date.parse(nowIso);
  const uteis = (de: string) => horasUteisEntre(de, nowIso);
  // Lead reaberto (pelo administrador, ou porque preencheu o formulário de novo):
  // o relógio recomeça ali — senão quem voltou hoje entraria com "3 semanas".
  const reaberto = eventos
    .filter((e) => e.action === "reaberto")
    .map((e) => e.createdAt)
    .sort()
    .at(-1);
  const desdeReaberto = (base: string) => (reaberto && reaberto > base ? reaberto : base);

  if (l.status === "lead") {
    const desde = desdeReaberto(l.createdAt);
    return {
      nome: "novo",
      desde,
      horasUteis: uteis(desde),
      venceEm: somarHorasUteis(desde, FILA_ETAPAS.novo.slaHoras),
    };
  }

  if (l.status === "em_contato" || l.status === "no_show") {
    const contato = resumoContato(eventos);
    // Retorno devido: o combinado pela cadência; depois de uma conversa sem
    // desfecho, no dia seguinte; quem não compareceu, a partir da reunião.
    const devido = desdeReaberto(
      l.status === "no_show"
        ? (l.meetingFor ?? contato.ultima ?? l.createdAt)
        : (contato.proxima ??
          (contato.ultima
            ? new Date(Date.parse(contato.ultima) + HORAS_APOS_CONVERSA * 3_600_000).toISOString()
            : l.createdAt)),
    );
    if (Date.parse(devido) > now) return null; // ainda não é hora
    return { nome: "retornar", desde: devido, horasUteis: uteis(devido), contato };
  }

  if (l.status === "agendado") {
    if (l.meetingFor) {
      const ate = (Date.parse(l.meetingFor) - now) / 3_600_000;
      if (ate > FILA_ETAPAS.confirmar.slaHoras) return null; // longe ainda
      if (ate > 0) {
        return {
          nome: "confirmar",
          desde: l.bookedAt ?? l.createdAt,
          horasUteis: 0,
          atraso: 1 - ate / FILA_ETAPAS.confirmar.slaHoras,
          reuniao: l.meetingFor,
        };
      }
      return { nome: "sem-desfecho", desde: l.meetingFor, horasUteis: uteis(l.meetingFor), reuniao: l.meetingFor };
    }
    // Agendado antes de a data ser obrigatória: sem data, vira "sem desfecho"
    // uma semana depois do agendamento.
    const base = l.bookedAt ?? l.createdAt;
    const limite = Date.parse(base) + DIAS_AGENDADO_SEM_DATA * 86_400_000;
    if (limite > now) return null;
    const desde = new Date(limite).toISOString();
    return { nome: "sem-desfecho", desde, horasUteis: uteis(desde) };
  }

  return null;
}

/** A espera em linguagem de quem vai ligar — ver `formatarEspera` (format.ts). */
export const formatEspera = formatarEspera;
