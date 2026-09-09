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
  /** Explicação curta, exibida na quebra de perdas e como title do seletor. */
  hint: string;
}

export const LEAD_STATUS_META: Record<LeadStatus, LeadStatusMeta> = {
  lead: {
    label: "Novo",
    variant: "muted",
    order: 4,
    lost: false,
    hint: "Entrou e ainda não foi contatado — é este o estoque da fila do comercial.",
  },
  agendado: {
    label: "Agendado",
    variant: "default",
    order: 5,
    lost: false,
    hint: "Reunião marcada. É esta transição que avisa a Meta e o GA4.",
  },
  reuniao_realizada: {
    label: "Reunião realizada",
    variant: "good",
    order: 6,
    lost: false,
    hint: "Compareceu à reunião.",
  },
  cliente: {
    label: "Cliente",
    variant: "good",
    order: 7,
    lost: false,
    hint: "Fechou — com o valor da carta registrado.",
  },
  contato_invalido: {
    label: "Contato inválido",
    variant: "outline",
    order: 0,
    lost: true,
    lossKind: "qualidade",
    hint: "Telefone ou e-mail não existe. Lead que a mídia nunca deveria ter cobrado.",
  },
  sem_resposta: {
    label: "Sem resposta",
    variant: "warning",
    order: 1,
    lost: true,
    lossKind: "qualidade",
    hint: "Contato válido, mas nunca retornou as tentativas.",
  },
  sem_interesse: {
    label: "Não tem interesse",
    variant: "critical",
    order: 2,
    lost: true,
    lossKind: "decisao",
    hint: "Falou com o comercial e disse que não quer.",
  },
  desistencia: {
    label: "Desistência",
    variant: "critical",
    order: 3,
    lost: true,
    lossKind: "decisao",
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
  "agendado",
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

/** Status que contam como reunião marcada (o denominador do CPR). */
export const BOOKED_STATUSES: LeadStatus[] = ["agendado", "reuniao_realizada", "cliente"];

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
