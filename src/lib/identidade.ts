/**
 * Identidade e higiene do lead (D2) — puro, sem I/O.
 *
 * A auditoria achou telefone em mais de 7 formatos, e-mail com "gamil.com",
 * cadastros de teste ("nome"/"email") contados como "Contato inválido" (perda
 * de MÍDIA) e a mesma pessoa duas vezes com status conflitantes. Aqui ficam as
 * regras que reconhecem cada caso; quem decide o que fazer é uma pessoa (lista
 * "Revisar" em Pessoas) — nada é excluído ou mesclado sozinho.
 */

import { chaveNome } from "./lead-id";
import { chaveTelefone, mesmoTelefone, normalizarTelefone } from "./phone";
import { LEAD_STATUS_META, isLostStatus } from "./lead-status";
import { everBooked } from "./metrics";
import type { Lead } from "./types";

/** Telefone em E.164 ("+5511999990000"), ou `null` se não tem cara de telefone BR. */
export function telefoneE164(phone?: string | null): string | null {
  if (!phone) return null;
  const d = normalizarTelefone(phone);
  // 55 + DDD (2) + 8 ou 9 dígitos.
  if (!/^55\d{10,11}$/.test(d)) return null;
  return `+${d}`;
}

const DOMINIOS_COM_ERRO = /@(gamil|gmial|gmai|gmal|gnail|hotmial|hotmal|hotmil|outlok|yaho)\.|\.(con|clm|cpm|comm|om|co)$/i;

/** O e-mail tem cara de digitado errado? (Sinaliza; nunca corrige sozinho.) */
export function emailSuspeito(email?: string | null): string | null {
  if (!email) return null;
  const e = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return "formato inválido";
  if (DOMINIOS_COM_ERRO.test(e)) return "domínio com erro de digitação";
  return null;
}

/** Problemas de formato do contato, para a lista "Revisar" e a ficha. */
export function problemasDeContato(l: Pick<Lead, "phone" | "email">): string[] {
  const out: string[] = [];
  if (l.phone && !telefoneE164(l.phone)) out.push("telefone com tamanho inválido");
  if (!l.phone && !l.email) out.push("sem telefone nem e-mail");
  const e = emailSuspeito(l.email);
  if (e) out.push(`e-mail: ${e}`);
  return out;
}

const NOMES_DE_TESTE = new Set(["nome", "teste", "test", "testando", "asdf", "xxx", "aaa", "fulano", "lead teste"]);

/** Parece cadastro de teste? Devolve o porquê (para quem revisa confirmar). */
export function pareceTeste(l: Pick<Lead, "name" | "email" | "phone">): string | null {
  const nome = chaveNome(l.name);
  if (nome && NOMES_DE_TESTE.has(nome)) return `nome “${l.name}”`;
  const email = (l.email ?? "").trim().toLowerCase();
  if (email === "email" || /^(teste?|test)\d*@/.test(email)) return `e-mail “${l.email}”`;
  const d = (l.phone ?? "").replace(/\D/g, "");
  if (/(\d)\1{6,}/.test(d)) return `telefone “${l.phone}”`;
  return null;
}

/** Chave do telefone para agrupar — só se tiver dígitos de telefone (lixo não agrupa). */
function chaveFone(phone?: string | null): string | null {
  const k = chaveTelefone(phone);
  return k && k.length >= 12 ? k : null;
}

/**
 * Mesma pessoa pelo CONTATO (telefone ou e-mail) — nunca pelo nome: nomes se
 * repetem, telefone e e-mail identificam. Usado na entrada (dedupe) e na
 * sugestão de mesclagem.
 */
export function mesmoContato(a: Pick<Lead, "phone" | "email">, b: Pick<Lead, "phone" | "email">): boolean {
  if (chaveFone(a.phone) && chaveFone(b.phone) && mesmoTelefone(a.phone, b.phone)) return true;
  const ea = a.email?.trim().toLowerCase();
  const eb = b.email?.trim().toLowerCase();
  return Boolean(ea && eb && ea === eb);
}

/** O lead já cadastrado que é esta pessoa (mesma marca, não excluído), se houver. */
export function acharMesmaPessoa(
  contato: Pick<Lead, "phone" | "email">,
  leads: Lead[],
  brand: string,
): Lead | undefined {
  if (!chaveFone(contato.phone) && !contato.email?.trim()) return undefined;
  return leads.find((l) => l.brand === brand && !l.deletedAt && mesmoContato(l, contato));
}

/** Quem fica como principal numa mesclagem: quem carrega mais história. */
function peso(l: Lead): number {
  const meta = LEAD_STATUS_META[l.status];
  // Caminho feliz vale pela posição; perda vale pouco (mas mais que nada).
  const status = isLostStatus(l.status) ? 1 : meta.order;
  const marcos = [l.firstContactAt, l.bookedAt, l.attendedAt, l.closedAt].filter(Boolean).length;
  return marcos * 10 + status;
}

export interface GrupoDuplicado {
  principal: Lead;
  duplicados: Lead[];
  /** Os status discordam (ex.: "Não tem interesse" × "Contato inválido"). */
  conflito: boolean;
}

/**
 * Grupos de leads que são a mesma pessoa (mesmo telefone ou e-mail). O principal
 * é quem carrega mais história (marcos, status mais avançado); empate fica com o
 * mais antigo.
 */
export function gruposDuplicados(leads: Lead[]): GrupoDuplicado[] {
  const vivos = leads.filter((l) => !l.deletedAt);
  // União por telefone e por e-mail (A~B por telefone, B~C por e-mail = um grupo).
  const pai = new Map<string, string>();
  const raiz = (id: string): string => {
    const p = pai.get(id) ?? id;
    if (p === id) return id;
    const r = raiz(p);
    pai.set(id, r);
    return r;
  };
  const unir = (a: string, b: string) => {
    const ra = raiz(a);
    const rb = raiz(b);
    if (ra !== rb) pai.set(rb, ra);
  };
  const porChave = new Map<string, string>();
  for (const l of vivos) {
    const chaves = [
      chaveFone(l.phone) ? `t:${l.brand}:${chaveFone(l.phone)}` : null,
      l.email?.trim() ? `e:${l.brand}:${l.email.trim().toLowerCase()}` : null,
    ].filter(Boolean) as string[];
    for (const k of chaves) {
      const outro = porChave.get(k);
      if (outro) unir(outro, l.id);
      else porChave.set(k, l.id);
    }
  }
  const grupos = new Map<string, Lead[]>();
  for (const l of vivos) {
    const r = raiz(l.id);
    grupos.set(r, [...(grupos.get(r) ?? []), l]);
  }
  const out: GrupoDuplicado[] = [];
  for (const membros of grupos.values()) {
    if (membros.length < 2) continue;
    const ordem = [...membros].sort(
      (a, b) => peso(b) - peso(a) || a.createdAt.localeCompare(b.createdAt),
    );
    out.push({
      principal: ordem[0],
      duplicados: ordem.slice(1),
      conflito: new Set(membros.map((m) => m.status)).size > 1,
    });
  }
  return out.sort((a, b) => b.duplicados.length - a.duplicados.length);
}

export interface Revisao {
  /** Cara de cadastro de teste — confirmar e excluir (sai de "Contato inválido"). */
  testes: { lead: Lead; porque: string }[];
  /** A mesma pessoa em mais de um cadastro. */
  duplicados: GrupoDuplicado[];
  /** "Desistência" de quem nunca agendou: legado de antes da Fase 1 (B19). */
  desistenciaSemReuniao: Lead[];
  /** Contato que não dá para usar como está (telefone curto, e-mail com erro). */
  contatoComProblema: { lead: Lead; problemas: string[] }[];
}

/** O que uma pessoa precisa olhar na base — nada aqui é corrigido sozinho. */
export function paraRevisar(leads: Lead[]): Revisao {
  const vivos = leads.filter((l) => !l.deletedAt);
  const testes = vivos.flatMap((lead) => {
    const porque = pareceTeste(lead);
    return porque ? [{ lead, porque }] : [];
  });
  const ehTeste = new Set(testes.map((t) => t.lead.id));
  return {
    testes,
    // Teste não entra como duplicado: "nome"/"email" repetidos não são uma pessoa.
    duplicados: gruposDuplicados(vivos.filter((l) => !ehTeste.has(l.id))),
    desistenciaSemReuniao: vivos.filter((l) => l.status === "desistencia" && !everBooked(l)),
    contatoComProblema: vivos.flatMap((lead) => {
      if (ehTeste.has(lead.id)) return [];
      const problemas = problemasDeContato(lead);
      return problemas.length ? [{ lead, problemas }] : [];
    }),
  };
}
