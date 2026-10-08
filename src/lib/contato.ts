/**
 * Tentativas de contato — o que o comercial fez com cada lead. Puro.
 *
 * Não existe contador gravado no lead: tudo sai dos eventos `tentativa` do
 * histórico (ADR-02). Contador e evento viveriam em dois lugares e um dia
 * discordariam; o histórico é um só.
 *
 * Uma tentativa desfeita (evento `desfeito` apontando para ela) não conta.
 */

import { diaBrt } from "./horario-util";
import { normalizarTelefone } from "./phone";
import type { LeadEvent } from "./types";

/** Link do WhatsApp com a mensagem pronta; `{nome}` vira o primeiro nome. */
export function linkWhatsapp(phone: string, mensagem: string, nome: string): string {
  const primeiro = nome.trim().split(/\s+/)[0] ?? "";
  const texto = mensagem.replace(/\{nome\}/g, primeiro);
  return `https://wa.me/${normalizarTelefone(phone)}?text=${encodeURIComponent(texto)}`;
}

export type CanalContato = "whatsapp" | "ligacao" | "email";

export const CANAL_LABEL: Record<CanalContato, string> = {
  whatsapp: "WhatsApp",
  ligacao: "Ligação",
  email: "E-mail",
};

/**
 * Cadência de retorno, em horas corridas, depois da 1ª, 2ª e 3ª tentativa sem
 * resposta. Depois da 3ª (em pelo menos 2 dias) o painel sugere "Sem resposta".
 */
export const CADENCIA_HORAS = [2, 24, 48];

export interface ResumoContato {
  tentativas: number;
  /** Quando aconteceu a 1ª e a última tentativa. */
  primeira?: string;
  ultima?: string;
  /** Próxima tentativa combinada (da última tentativa sem resposta). */
  proxima?: string;
  /** Em quantos dias diferentes (Brasília) houve tentativa. */
  diasComTentativa: number;
  /** Alguma tentativa chegou a falar com a pessoa. */
  falou: boolean;
}

/** Quando o fato aconteceu (o registro pode ser posterior). */
export const quando = (e: LeadEvent) => e.occurredAt ?? e.createdAt;

/** Resumo das tentativas de UM lead. `eventos` = histórico dele (qualquer ordem). */
export function resumoContato(eventos: LeadEvent[]): ResumoContato {
  const desfeitos = new Set(
    eventos.filter((e) => e.action === "desfeito" && e.payload?.evento).map((e) => e.payload!.evento),
  );
  const tentativas = eventos
    .filter((e) => e.action === "tentativa" && !desfeitos.has(e.id))
    .sort((a, b) => Date.parse(quando(a)) - Date.parse(quando(b)));
  const ultima = tentativas.at(-1);
  return {
    tentativas: tentativas.length,
    primeira: tentativas[0] ? quando(tentativas[0]) : undefined,
    ultima: ultima ? quando(ultima) : undefined,
    proxima: ultima?.payload?.falou === "sim" ? undefined : ultima?.payload?.proxima,
    diasComTentativa: new Set(tentativas.map((e) => diaBrt(quando(e)))).size,
    falou: tentativas.some((e) => e.payload?.falou === "sim"),
  };
}

/**
 * Quando tentar de novo, depois de uma tentativa SEM resposta. `n` = quantas
 * tentativas já existem contando esta. Depois da última da cadência, `undefined`
 * (a régua já permite encerrar como "Sem resposta").
 */
export function proximaPelaCadencia(ocorreuEm: string, n: number): string | undefined {
  const horas = CADENCIA_HORAS[n - 1];
  if (horas == null) return undefined;
  return new Date(Date.parse(ocorreuEm) + horas * 3_600_000).toISOString();
}

/** Agrupa um histórico inteiro por lead, para resumir vários de uma vez. */
export function eventosPorLead(eventos: LeadEvent[]): Map<string, LeadEvent[]> {
  const map = new Map<string, LeadEvent[]>();
  for (const e of eventos) {
    const list = map.get(e.leadId) ?? [];
    list.push(e);
    map.set(e.leadId, list);
  }
  return map;
}
