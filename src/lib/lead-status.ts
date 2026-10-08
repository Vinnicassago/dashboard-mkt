/**
 * Régua dos status de lead — fonte ÚNICA.
 *
 * Rótulo, cor, posição no funil e "isto encerra o lead?" moram todos aqui. UI,
 * métricas, importação de CSV e seed leem desta tabela; nenhum deles repete a
 * lista de status. Status novo = uma entrada aqui, e o resto acompanha.
 *
 * Não importa nada além de `types` — roda no servidor e no cliente.
 */
import type { Lead, LeadStatus } from "./types";

export type LeadStatusVariant = "muted" | "default" | "good" | "warning" | "critical" | "outline";

/**
 * Por que o lead se perdeu — a distinção que muda a decisão:
 * - `qualidade`: nunca virou conversa. O problema está na mídia (segmentação,
 *   criativo, formulário) — o comercial não teve chance.
 * - `decisao`: falou com a gente e não avançou. O problema está na oferta ou no
 *   pitch — a mídia entregou.
 */
export type LossKind = "qualidade" | "decisao";

export interface LeadStatusMeta {
  label: string;
  variant: LeadStatusVariant;
  /** Posição no funil: maior = mais perto do fechamento. Usado nas ordenações. */
  order: number;
  /** Encerra o lead (nenhum motivo de perda volta para a fila do comercial). */
  lost: boolean;
  lossKind?: LossKind;
  /**
   * Onde o problema provavelmente está, como a quebra de perdas deve dizer. Não é
   * o mesmo que `lossKind`: "Sem resposta" conta como qualidade no CPL, mas
   * sozinho não diz se a pessoa parou no número errado, no robô ou na demora do
   * contato — escrever "Mídia" ali empurrava o time para a segmentação sem prova.
   */
  origemDaPerda?: string;
  /** Como ler esta perda antes de agir, quando o motivo sozinho engana. */
  leituraDaPerda?: string;
  /** Explicação curta, exibida na quebra de perdas e como title do seletor. */
  hint: string;
}

export const LEAD_STATUS_META: Record<LeadStatus, LeadStatusMeta> = {
  lead: {
    label: "Novo",
    variant: "muted",
    order: 4,
    lost: false,
    hint: "Entrou e ninguém tentou contato ainda — é o topo da fila do comercial.",
  },
  em_contato: {
    label: "Em contato",
    variant: "outline",
    order: 5,
    lost: false,
    hint: "Já houve tentativa de contato; a próxima segue a cadência.",
  },
  agendado: {
    label: "Agendado",
    variant: "default",
    order: 6,
    lost: false,
    hint: "Reunião marcada, com data e hora.",
  },
  no_show: {
    label: "Não compareceu",
    variant: "warning",
    order: 7,
    lost: false,
    hint: "Tinha reunião marcada e não apareceu. Dá para remarcar.",
  },
  reuniao_realizada: {
    label: "Reunião realizada",
    variant: "good",
    order: 8,
    lost: false,
    hint: "Compareceu à reunião.",
  },
  cliente: {
    label: "Cliente",
    variant: "good",
    order: 9,
    lost: false,
    hint: "Fechou — com o valor da carta registrado.",
  },
  contato_invalido: {
    label: "Contato inválido",
    variant: "outline",
    order: 0,
    lost: true,
    lossKind: "qualidade",
    origemDaPerda: "Formulário / mídia",
    hint: "Telefone ou e-mail não existe. Lead que a mídia nunca deveria ter cobrado.",
  },
  sem_resposta: {
    label: "Sem resposta",
    variant: "warning",
    order: 1,
    lost: true,
    lossKind: "qualidade",
    origemDaPerda: "Não dá para dizer",
    leituraDaPerda:
      "não diz onde a pessoa parou: pode ser número errado, a 1ª mensagem do robô sem retorno ou demora no 1º contato. Cruze com “Dentro do robô”, abaixo, antes de mexer na segmentação",
    hint: "Contato válido, mas nunca retornou as tentativas.",
  },
  sem_interesse: {
    label: "Não tem interesse",
    variant: "critical",
    order: 2,
    lost: true,
    lossKind: "decisao",
    origemDaPerda: "Oferta / pitch",
    hint: "Falou com o comercial e disse que não quer.",
  },
  desistencia: {
    label: "Desistência",
    variant: "critical",
    order: 3,
    lost: true,
    lossKind: "decisao",
    origemDaPerda: "Oferta / pitch",
    hint: "Avançou (chegou a agendar) e desistiu antes de fechar.",
  },
};

/**
 * Ordem de EXIBIÇÃO (seletor, filtros, quebra de perdas): caminho feliz na
 * sequência em que acontece, perdas depois. Diferente de `order`, que é a
 * posição no funil usada para ordenar tabelas.
 */
export const LEAD_STATUSES: LeadStatus[] = [
  "lead",
  "em_contato",
  "agendado",
  "no_show",
  "reuniao_realizada",
  "cliente",
  "contato_invalido",
  "sem_resposta",
  "sem_interesse",
  "desistencia",
];

/** Status que encerram o lead como perda, na ordem de exibição. */
export const LOST_STATUSES: LeadStatus[] = LEAD_STATUSES.filter((s) => LEAD_STATUS_META[s].lost);

/** O caminho happy-path — tudo que ainda não é perda. */
export const OPEN_STATUSES: LeadStatus[] = LEAD_STATUSES.filter((s) => !LEAD_STATUS_META[s].lost);

/**
 * Status que contam como reunião marcada (o denominador do CPR). "Não
 * compareceu" entra: a reunião FOI agendada — o comparecimento é outra métrica.
 */
export const BOOKED_STATUSES: LeadStatus[] = ["agendado", "no_show", "reuniao_realizada", "cliente"];

export function statusLabel(s: LeadStatus): string {
  return LEAD_STATUS_META[s].label;
}

export function statusRank(s: LeadStatus): number {
  return LEAD_STATUS_META[s].order;
}

export function isLostStatus(s: LeadStatus): boolean {
  return LEAD_STATUS_META[s].lost;
}

/** Está marcado como reunião (agendado, realizado ou já virou cliente). */
export function isBookedStatus(s: LeadStatus): boolean {
  return BOOKED_STATUSES.includes(s);
}

export function isLead(l: Lead): boolean {
  return l.status === "lead";
}

// ---------------------------------------------------------------- transições

/**
 * MÁQUINA DE ESTADOS — de onde se pode ir para onde. Fonte ÚNICA (D3).
 *
 * - `em_contato` NÃO é destino manual: quem põe o lead nele é a tentativa de
 *   contato (`registrarTentativa`), que é o que conta para velocidade e cadência.
 * - "Desistência" só a partir de quem teve reunião (agendado, não compareceu,
 *   realizada). Havia 11 leads em "Desistência" sem nunca terem agendado.
 * - Status de perda e "Cliente" encerram: sair deles é REABRIR (só
 *   administrador, com motivo — `reabrirLead`), não uma transição comum.
 * - "Agendado → Agendado" é remarcar (nova data).
 */
export const TRANSICOES: Record<LeadStatus, LeadStatus[]> = {
  lead: ["agendado", "contato_invalido", "sem_resposta", "sem_interesse"],
  em_contato: ["agendado", "contato_invalido", "sem_resposta", "sem_interesse"],
  agendado: ["agendado", "reuniao_realizada", "no_show", "desistencia"],
  no_show: ["agendado", "sem_resposta", "desistencia"],
  reuniao_realizada: ["cliente", "sem_interesse", "desistencia"],
  cliente: [],
  contato_invalido: [],
  sem_resposta: [],
  sem_interesse: [],
  desistencia: [],
};

/** Estados de onde não se sai sem reabrir. */
export function encerrado(s: LeadStatus): boolean {
  return TRANSICOES[s].length === 0;
}

/** Motivos de "Contato inválido" — dizem se o problema é do formulário ou do número. */
export const MOTIVOS_CONTATO_INVALIDO: Record<string, string> = {
  numero_inexistente: "Número não existe",
  sem_whatsapp: "Sem WhatsApp",
  pessoa_errada: "Pessoa errada",
  email_invalido: "E-mail inválido",
  outro: "Outro",
};

/**
 * Régua de "Sem resposta": 3 tentativas em pelo menos 2 dias diferentes. Antes
 * disso o painel pede confirmação — "Sem resposta" registrado na 1ª ligação
 * vira, na quebra de perdas, um problema de mídia que era de insistência.
 */
export const TENTATIVAS_PARA_SEM_RESPOSTA = 3;
export const DIAS_PARA_SEM_RESPOSTA = 2;

/** O que uma transição precisa saber do lead. */
export interface EstadoParaTransicao {
  status: LeadStatus;
  /** `everBooked()` (metrics.ts) — o lead já teve reunião marcada. */
  jaAgendou: boolean;
  /** Tentativas registradas (`resumoContato`) — decidem se "Sem resposta" pede confirmação. */
  tentativas?: number;
  diasComTentativa?: number;
}

/** O que algumas transições exigem junto. */
export interface DadosDaTransicao {
  /** Data e hora da reunião (ISO) — obrigatória para "Agendado" (e para remarcar). */
  meetingFor?: string;
  /** Valor da carta (R$) — obrigatório para "Cliente". */
  value?: number;
  /** Chave de MOTIVOS_CONTATO_INVALIDO — obrigatória para "Contato inválido". */
  motivo?: string;
  /** Encerrar como "Sem resposta" antes da régua de tentativas. */
  confirmado?: boolean;
}

export type DadoExigido = "data" | "valor" | "motivo" | "confirmacao";

function abaixoDaRegua(l: EstadoParaTransicao): boolean {
  return (
    (l.tentativas ?? 0) < TENTATIVAS_PARA_SEM_RESPOSTA ||
    (l.diasComTentativa ?? 0) < DIAS_PARA_SEM_RESPOSTA
  );
}

/** Que dado extra a interface precisa pedir antes de confirmar. */
export function dadoExigido(para: LeadStatus, l?: EstadoParaTransicao): DadoExigido | null {
  if (para === "agendado") return "data";
  if (para === "cliente") return "valor";
  if (para === "contato_invalido") return "motivo";
  if (para === "sem_resposta" && (!l || abaixoDaRegua(l))) return "confirmacao";
  return null;
}

/** Destinos que a interface oferece. O servidor confere de novo com `podeTransitar`. */
export function destinosPermitidos(l: EstadoParaTransicao): LeadStatus[] {
  return TRANSICOES[l.status];
}

/**
 * A transição pode acontecer? `null` = pode; texto = por que não (vai direto
 * para a tela).
 */
export function podeTransitar(
  l: EstadoParaTransicao,
  para: LeadStatus,
  dados: DadosDaTransicao = {},
): string | null {
  if (para === "em_contato") {
    return "“Em contato” é registrado pela tentativa de contato, não escolhido na lista.";
  }
  if (encerrado(l.status)) {
    return `O lead está encerrado como “${statusLabel(l.status)}”. Para reabrir, peça a um administrador.`;
  }
  if (!TRANSICOES[l.status].includes(para)) {
    if (para === "desistencia") {
      return "Desistência é de quem chegou a agendar. Para quem nunca agendou, use “Não tem interesse”.";
    }
    if (para === l.status) return `O lead já está em “${statusLabel(para)}”.`;
    return `De “${statusLabel(l.status)}” não dá para ir direto para “${statusLabel(para)}”.`;
  }
  if (para === "agendado") {
    const t = dados.meetingFor ? Date.parse(dados.meetingFor) : NaN;
    if (!Number.isFinite(t)) return "Informe a data e a hora da reunião.";
  }
  if (para === "cliente" && !(dados.value != null && dados.value > 0)) {
    return "Informe o valor da carta (R$).";
  }
  if (para === "contato_invalido" && !(dados.motivo && dados.motivo in MOTIVOS_CONTATO_INVALIDO)) {
    return "Diga por que o contato é inválido.";
  }
  if (para === "sem_resposta" && abaixoDaRegua(l) && !dados.confirmado) {
    return `Só ${l.tentativas ?? 0} tentativa(s) em ${l.diasComTentativa ?? 0} dia(s) — a régua pede ${TENTATIVAS_PARA_SEM_RESPOSTA} em pelo menos ${DIAS_PARA_SEM_RESPOSTA} dias. Confirme para encerrar mesmo assim.`;
  }
  return null;
}

/**
 * Régua anterior, ainda gravada em linhas anteriores à migração e em CSV
 * exportado do dashboard velho. `perdido` não dizia POR QUE se perdeu; entra em
 * "sem resposta", a leitura que menos afirma sobre o lead (ver a migração em
 * `db/schema.ts` e `supabase/migrations/0011_lead_status_reasons.sql`).
 */
const LEGACY_STATUS: Record<string, LeadStatus> = {
  agendou: "agendado",
  compareceu: "reuniao_realizada",
  perdido: "sem_resposta",
  "no show": "no_show",
  noshow: "no_show",
  faltou: "no_show",
};

/** Sem acento, minúsculo, `_`/pontuação viram espaço: "Reunião realizada" === "reuniao_realizada". */
function key(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // marcas de acentuação separadas pelo NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Toda forma reconhecida de cada status: o nome interno, o RÓTULO exibido e os
 * nomes da régua antiga. Incluir o rótulo é o que faz o CSV exportado pela aba
 * Leads (que grava "Reunião realizada", não `reuniao_realizada`) voltar inteiro
 * na reimportação — e continua valendo para status adicionados depois.
 */
const STATUS_BY_KEY: Record<string, LeadStatus> = (() => {
  const out: Record<string, LeadStatus> = {};
  for (const s of LEAD_STATUSES) {
    out[key(s)] = s;
    out[key(LEAD_STATUS_META[s].label)] = s;
  }
  for (const [legacy, s] of Object.entries(LEGACY_STATUS)) out[key(legacy)] = s;
  return out;
})();

/** Aceita nome interno, rótulo ou régua antiga; o que não reconhecer vira "lead". */
export function normalizeLeadStatus(raw: string | null | undefined): LeadStatus {
  return STATUS_BY_KEY[key(raw ?? "")] ?? "lead";
}
