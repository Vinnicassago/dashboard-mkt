/**
 * Id do lead que chega pela landing page (ou pela planilha de backfill, que usa o
 * mesmo esquema) — fonte ÚNICA. Puro, sem I/O.
 *
 * O id sai do `event_id` do formulário, que é o que permite reconhecer um
 * REENVIO: a mesma pessoa mandando o formulário de novo cai no mesmo id e vira
 * um evento no lead que já existe, nunca um lead novo nem um lead zerado.
 *
 * Até out/2026 o id usava só os 8 primeiros caracteres do event_id. Para ids no
 * formato `lead_<uuid>` isso deixava 3 caracteres úteis (4.096 combinações), e
 * duas pessoas diferentes podiam cair no mesmo id — a segunda sobrescrevia a
 * primeira. Ids novos usam o event_id inteiro; o formato antigo continua sendo
 * reconhecido para que reenvios e reimportações de leads antigos não dupliquem.
 */

import { mesmoTelefone } from "./phone";

export interface ContatoLead {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** Só caracteres seguros para id; corta em 64 para não virar chave gigante. */
function limpar(eventId: string): string {
  return eventId.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

/** Id atual: o event_id inteiro. */
export function idLeadLp(eventId: string): string {
  return `LEAD-LP-${limpar(eventId)}`;
}

/** Id do esquema antigo (8 primeiros caracteres), só para reconhecer leads antigos. */
export function idLeadLpLegado(eventId: string): string {
  return `LEAD-LP-${eventId.trim().slice(0, 8)}`;
}

function emailIgual(a?: string | null, b?: string | null): boolean {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

/** Nome comparável: sem acento, caixa e espaços extras; o genérico não conta. */
export function chaveNome(nome?: string | null): string | null {
  const n = (nome ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return n && n !== "lead sem nome" ? n : null;
}

/**
 * Os dois registros são, com certeza, de pessoas DIFERENTES? Só afirma com
 * evidência: os dois têm telefone (ou e-mail), nenhum contato bate e o nome
 * também não. Mesmo código de sessão + mesmo nome é a mesma pessoa corrigindo
 * o próprio telefone, não uma colisão. Sem contato comparável não há como dizer
 * — e aí também não é colisão.
 */
export function pessoaDiferente(a: ContatoLead, b: ContatoLead): boolean {
  const telefones = Boolean(a.phone && b.phone);
  const emails = Boolean(a.email && b.email);
  if (!telefones && !emails) return false;
  const na = chaveNome(a.name);
  if (na && na === chaveNome(b.name)) return false;
  if (telefones && mesmoTelefone(a.phone, b.phone)) return false;
  if (emails && emailIgual(a.email, b.email)) return false;
  return true;
}

/**
 * Há prova POSITIVA de que é a mesma pessoa: nome, telefone ou e-mail batem.
 * Mais exigente que `!pessoaDiferente` — sem contato comparável, aqui é "não".
 */
export function mesmaPessoa(a: ContatoLead, b: ContatoLead): boolean {
  const na = chaveNome(a.name);
  return (
    Boolean(na && na === chaveNome(b.name)) ||
    mesmoTelefone(a.phone, b.phone) ||
    emailIgual(a.email, b.email)
  );
}

export type ResolucaoId =
  /** Ninguém com esse id: lead novo. */
  | { tipo: "novo"; id: string }
  /** Já existe, e é a mesma pessoa (ou não dá para dizer): reenvio. */
  | { tipo: "reenvio"; id: string }
  /** O id já é de outra pessoa: lead novo com id próprio. */
  | { tipo: "colisao"; id: string; idOcupado: string };

/**
 * Decide o id de um lead que chega com `eventId`. `existente` consulta um lead
 * pelo id (o chamador busca no banco os candidatos antes — esta função é pura).
 * `sufixo` desempata uma colisão; em produção é aleatório.
 */
export function resolverIdLead(
  eventId: string,
  contato: ContatoLead,
  existente: (id: string) => ContatoLead | null | undefined,
  sufixo: () => string,
): ResolucaoId {
  const atual = idLeadLp(eventId);
  const legado = idLeadLpLegado(eventId);

  const noAtual = existente(atual);
  if (noAtual) {
    return pessoaDiferente(noAtual, contato)
      ? { tipo: "colisao", id: `${atual}-${sufixo()}`, idOcupado: atual }
      : { tipo: "reenvio", id: atual };
  }

  // Lead gravado no esquema antigo: só é reenvio com PROVA de que é a mesma
  // pessoa. O prefixo curto é sabidamente compartilhado — a LP B manda
  // "consorcio_b_<uuid>", e TODO lead dela cabia em "LEAD-LP-consorci". Sem
  // prova, o lead novo fica com o id inteiro, livre.
  if (legado !== atual) {
    const noLegado = existente(legado);
    if (noLegado && mesmaPessoa(noLegado, contato)) return { tipo: "reenvio", id: legado };
  }
  return { tipo: "novo", id: atual };
}

/** Candidatos que o chamador precisa consultar antes de `resolverIdLead`. */
export function candidatosIdLead(eventId: string): string[] {
  const atual = idLeadLp(eventId);
  const legado = idLeadLpLegado(eventId);
  return legado === atual ? [atual] : [atual, legado];
}
