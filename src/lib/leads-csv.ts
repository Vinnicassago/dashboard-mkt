import Papa from "papaparse";
import type { Lead, LeadStatus } from "./types";
import { DEFAULT_BRAND } from "./types";
import { normalizeLeadStatus, statusLabel } from "./lead-status";
import { idLeadLp } from "./lead-id";
import { idsDoUtm } from "./atribuicao";

/**
 * Importador de leads (backfill). Aceita o CSV exportado do rastreamento da
 * landing page (colunas created_at, event_id, nome, whatsapp, email, utm_*,
 * fbp, fbc, Status). Casa 1:1 com o que o /api/track grava — inclusive o
 * esquema de id de `lib/lead-id.ts` — para que um lead já capturado ao vivo e o
 * mesmo lead importado da planilha sejam a MESMA linha, sem duplicar. Quem
 * importa resolve o id contra o banco (formato antigo, colisão) com
 * `resolverIdLead`, usando o `eventId` devolvido aqui.
 */

/** Strip accents + lowercase for tolerant header matching. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .split("")
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c < 0x0300 || c > 0x036f;
    })
    .join("")
    .trim()
    .toLowerCase();
}

// Candidatos de cabeçalho (export do rastreamento + variações comuns).
const FIELDS = {
  eventId: ["event_id", "eventid", "id do evento"],
  createdAt: ["created_at", "criado em", "submitted_at", "enviado em", "data/hora", "data e hora", "data", "timestamp"],
  name: ["nome", "name", "nome completo"],
  email: ["email", "e-mail"],
  phone: ["whatsapp", "telefone", "phone", "celular", "fone"],
  status: ["status", "situacao", "etapa"],
  utmSource: ["utm_source", "origem"],
  utmCampaign: ["utm_campaign", "campanha"],
  utmContent: ["utm_content", "conteudo", "anuncio"],
  utmMedium: ["utm_medium", "meio"],
  utmTerm: ["utm_term", "termo"],
  fbclid: ["fbclid"],
  fbc: ["fbc"],
  fbp: ["fbp"],
} as const;

type Field = keyof typeof FIELDS;

function buildHeaderMap(headers: string[]): Partial<Record<Field, string>> {
  const map: Partial<Record<Field, string>> = {};
  const normalized = headers.map((h) => ({ raw: h, n: norm(h) }));
  for (const field of Object.keys(FIELDS) as Field[]) {
    for (const cand of FIELDS[field]) {
      // Exato primeiro; só cai no "inclui" para candidatos longos (evita "data"
      // capturar "created_at" etc.).
      const hit =
        normalized.find((h) => h.n === cand) ??
        (cand.length >= 5 ? normalized.find((h) => h.n.includes(cand)) : undefined);
      if (hit) {
        map[field] = hit.raw;
        break;
      }
    }
  }
  return map;
}

// Como o comercial DIGITA o status na planilha. O nome interno, o rótulo exibido
// e a régua antiga já são resolvidos por `normalizeLeadStatus` — aqui ficam só
// as variações que nenhuma das duas formas cobre, para as tabelas não drifitarem.
const STATUS_ALIASES: Record<string, LeadStatus> = {
  "sem contato": "lead",
  "em contato": "em_contato",
  "tentando contato": "em_contato",
  "em atendimento": "em_contato",
  agendada: "agendado",
  marcada: "agendado",
  "reuniao agendada": "agendado",
  realizada: "reuniao_realizada",
  realizado: "reuniao_realizada",
  "reuniao feita": "reuniao_realizada",
  fechado: "cliente",
  vendido: "cliente",
  ganho: "cliente",
  "telefone invalido": "contato_invalido",
  "numero invalido": "contato_invalido",
  "contato errado": "contato_invalido",
  "nao existe": "contato_invalido",
  "nao atende": "sem_resposta",
  "nao respondeu": "sem_resposta",
  "sem retorno": "sem_resposta",
  sumiu: "sem_resposta",
  "nao quis": "sem_interesse",
  recusou: "sem_interesse",
  desqualificado: "sem_interesse",
  "nao qualificado": "sem_interesse",
  desistiu: "desistencia",
  cancelou: "desistencia",
  "no show": "no_show",
  faltou: "no_show",
  "nao compareceu": "no_show",
  "nao apareceu": "no_show",
};

function toStatus(raw?: string): LeadStatus {
  const key = norm(raw ?? "");
  return STATUS_ALIASES[key] ?? normalizeLeadStatus(key);
}

/**
 * Telefone da planilha. Desfaz o `="…"` com que o painel exporta (para o Excel
 * não converter em número) e RECUSA notação científica: "5,51299E+12" já perdeu
 * os últimos dígitos quando o Excel salvou — normalizar daria um número errado
 * com cara de certo. Melhor sem telefone do que com o de outra pessoa.
 */
export function lerTelefone(raw?: string): { valor?: string; ilegivel: boolean } {
  if (!raw) return { ilegivel: false };
  const v = raw.replace(/^="?|"$/g, "").trim();
  if (/^\d+([.,]\d+)?e\+?\d+$/i.test(v)) return { ilegivel: true };
  return { valor: v || undefined, ilegivel: false };
}

/** Mesmo esquema de id do /api/track, para deduplicar com os leads ao vivo. */
function leadIdFrom(eventId: string, fallbackSeed: string): string {
  const ev = eventId.trim();
  return ev ? idLeadLp(ev) : `LEAD-IMP-${fallbackSeed}`;
}

export interface LeadsParseResult {
  leads: Lead[];
  /** event_id de cada lead (por id), para o importador resolver contra o banco. */
  eventIds: Map<string, string>;
  /** Telefones em notação científica ("5,51299E+12") — vieram de um Excel e perderam dígitos. */
  telefonesIlegiveis: number;
  matchedColumns: Partial<Record<Field, string>>;
  skipped: number;
}

export function parseLeadsCsv(text: string): LeadsParseResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: true,
  });
  const headers = parsed.meta.fields ?? [];
  const map = buildHeaderMap(headers);

  if (!map.name || !map.createdAt) {
    throw new Error(
      "CSV de leads não reconhecido: preciso pelo menos das colunas de nome e data (created_at). Baixe o modelo abaixo para ver o formato.",
    );
  }

  const byId = new Map<string, Lead>();
  const eventIds = new Map<string, string>();
  let skipped = 0;
  let telefonesIlegiveis = 0;
  parsed.data.forEach((r, i) => {
    const name = (map.name ? r[map.name] : "")?.trim() ?? "";
    const createdAt = (map.createdAt ? r[map.createdAt] : "")?.trim() ?? "";
    if (!name || !/^\d{4}-\d{2}-\d{2}/.test(createdAt)) {
      skipped++;
      return;
    }
    const eventId = (map.eventId ? r[map.eventId] : "")?.trim() ?? "";
    const id = leadIdFrom(eventId, `${createdAt.slice(0, 10).replace(/-/g, "")}-${i}`);
    if (eventId) eventIds.set(id, eventId);
    const pick = (f: Field) => (map[f] ? r[map[f]!]?.trim() || undefined : undefined);
    const phone = lerTelefone(pick("phone"));
    if (phone.ilegivel) telefonesIlegiveis++;
    byId.set(id, {
      id,
      brand: DEFAULT_BRAND,
      createdAt,
      name,
      email: pick("email"),
      phone: phone.valor,
      utmSource: pick("utmSource"),
      utmCampaign: pick("utmCampaign"),
      utmContent: pick("utmContent"),
      // Os mesmos ids que /api/track grava (D6): conjunto e campanha pelo UTM.
      ...idsDoUtm({ utm_campaign: pick("utmCampaign"), utm_term: pick("utmTerm"), utm_content: pick("utmContent") }),
      utmMedium: pick("utmMedium"),
      utmTerm: pick("utmTerm"),
      fbclid: pick("fbclid"),
      status: toStatus(map.status ? r[map.status] : ""),
      fbc: pick("fbc"),
      fbp: pick("fbp"),
    });
  });

  const leads = [...byId.values()];
  if (leads.length === 0) {
    throw new Error("Nenhum lead válido encontrado no CSV.");
  }
  return { leads, eventIds, matchedColumns: map, skipped, telefonesIlegiveis };
}

/**
 * Modelo pronto para preencher, no formato do rastreamento da landing page.
 * Status em branco = lead novo; os demais aceitam o nome do status ou os
 * apelidos de `STATUS_ALIASES` ("não atende", "desistiu", "fechado"…).
 */
export const LEADS_CSV_TEMPLATE = [
  "created_at,event_id,Status,nome,whatsapp,email,utm_source,utm_campaign,utm_content,fbp,fbc",
  "2026-07-27T21:53:40-03:00,lead_d9de70b9-e60a-4ce5,,Fabio,31997598013,fabio@gmail.com,metaads,CP - Leads - Brunno quevedo,video brunno 2 diagnostico|12025253786,,",
  "2026-07-28T00:02:32-03:00,lead_4d50c064-7d47-4c25,agendado,Beatriz,72727383838,beatriz@gmail.com,ig,,link_in_bio,,",
  "2026-07-28T09:15:07-03:00,lead_8b31af02-1c99-40aa,não atende,Rogério,11988887777,rogerio@gmail.com,metaads,CP - Leads - Brunno quevedo,video brunno 2 diagnostico|12025253786,,",
].join("\n");

// ---------------------------------------------------------------- prévia (Fase 6.6)

export type CampoDoCsv = Field;

export interface LinhaDaPrevia {
  /**
   * Número da linha FÍSICA na planilha (1 é o cabeçalho). Linha em branco conta
   * no número, mas não aparece — "Linha 7" é a linha 7 do arquivo.
   */
  linha: number;
  nome: string;
  criadoEm: string;
  /** Telefone como TEXTO — nunca convertido em número. */
  telefone?: string;
  email?: string;
  status: LeadStatus;
  /** Como veio escrito, quando não foi reconhecido (entra como "Novo"). */
  statusOriginal?: string;
  /** Impedem a linha: ela é ignorada na importação. */
  erros: string[];
  /** A linha entra, mas algo ficou em branco ou foi interpretado. */
  avisos: string[];
}

export interface PreviaLeads {
  /** Colunas obrigatórias que não foram encontradas — com alguma aqui nada é importado. */
  faltam: string[];
  /** Coluna da planilha reconhecida para cada campo. */
  colunas: Partial<Record<CampoDoCsv, string>>;
  linhas: LinhaDaPrevia[];
  /** Leads que entrariam (linhas sem erro, sem contar as repetidas). */
  validas: number;
  comErro: number;
  comAviso: number;
  /** Linhas com o mesmo event_id de uma anterior: só a última vale. */
  repetidas: number;
}

/** O texto da coluna Status é um status que o importador reconhece? */
function statusReconhecido(raw: string): boolean {
  const k = norm(raw);
  if (k in STATUS_ALIASES) return true;
  if (normalizeLeadStatus(k) !== "lead") return true;
  // "lead" e "Novo" também são reconhecidos — só que viram o mesmo "lead".
  return k === "lead" || k === norm(statusLabel("lead"));
}

/**
 * A régua do `skipEmptyLines: true` do Papa, que `parseLeadsCsv` usa: a linha
 * era só a quebra (um campo, vazio). ",,," NÃO é vazia — aparece na prévia com
 * "Nome em branco" e o importador a conta como ignorada, igual.
 */
function linhaVazia(r: Record<string, string>): boolean {
  const valores = Object.values(r);
  return valores.length === 1 && valores[0] === "";
}

/**
 * Validação e prévia ANTES de importar (relatório §7.7, item 5): a mesma
 * leitura de `parseLeadsCsv`, linha a linha, dizendo o que entra, o que é
 * ignorado e por quê. Pura — roda no navegador para retorno imediato; o
 * servidor refaz a leitura na importação de verdade. Nunca lança: sem as
 * colunas obrigatórias devolve `faltam`.
 */
export function previaLeadsCsv(text: string): PreviaLeads {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    // SEM pular as vazias: o índice de cada registro é a linha física do arquivo,
    // e a coluna "Linha" da prévia é onde a pessoa vai procurar o erro. Pulá-las
    // aqui fazia a prévia dizer "Linha 6" para a linha 7 de uma planilha com um
    // registro apagado no Excel. As vazias saem abaixo, pela régua do importador.
    skipEmptyLines: false,
  });
  const map = buildHeaderMap(parsed.meta.fields ?? []);
  const faltam: string[] = [];
  if (!map.name) faltam.push("nome");
  if (!map.createdAt) faltam.push("created_at (data)");
  if (faltam.length > 0) {
    return { faltam, colunas: map, linhas: [], validas: 0, comErro: 0, comAviso: 0, repetidas: 0 };
  }

  const pick = (r: Record<string, string>, f: Field) => (map[f] ? r[map[f]!]?.trim() || undefined : undefined);
  const idsVistos = new Set<string>();
  let repetidas = 0;
  // Posição entre as linhas NÃO vazias — o mesmo `i` com que `parseLeadsCsv`
  // monta o id de reserva de quem vem sem event_id.
  let ordem = -1;
  const linhas: LinhaDaPrevia[] = [];
  parsed.data.forEach((r, i) => {
    if (linhaVazia(r)) return;
    ordem++;
    const erros: string[] = [];
    const avisos: string[] = [];
    const nome = pick(r, "name") ?? "";
    const criadoEm = pick(r, "createdAt") ?? "";
    if (!nome) erros.push("Nome em branco.");
    if (!criadoEm) erros.push("Data em branco.");
    else if (!/^\d{4}-\d{2}-\d{2}/.test(criadoEm)) erros.push(`Data “${criadoEm}” fora do formato AAAA-MM-DD.`);

    const telefoneRaw = pick(r, "phone");
    const telefone = lerTelefone(telefoneRaw);
    if (telefone.ilegivel) {
      avisos.push(`Telefone “${telefoneRaw}” em notação científica: o Excel cortou os dígitos — fica em branco.`);
    }
    const email = pick(r, "email");
    if (email && !email.includes("@")) avisos.push(`E-mail “${email}” sem @.`);
    if (!telefone.valor && !email) avisos.push("Sem telefone nem e-mail: não dá para contatar nem reconhecer um reenvio.");

    const statusRaw = pick(r, "status");
    const status = toStatus(statusRaw);
    const statusOriginal = statusRaw && !statusReconhecido(statusRaw) ? statusRaw : undefined;
    if (statusOriginal) avisos.push(`Status “${statusOriginal}” não reconhecido: entra como “Novo”.`);

    const eventId = pick(r, "eventId") ?? "";
    if (erros.length === 0) {
      const id = leadIdFrom(eventId, `${criadoEm.slice(0, 10).replace(/-/g, "")}-${ordem}`);
      if (idsVistos.has(id)) {
        repetidas++;
        avisos.push("Mesmo event_id de uma linha anterior: só esta (a última) vale.");
      }
      idsVistos.add(id);
    }

    // `i` é o índice físico (0 = a linha logo abaixo do cabeçalho, que é a 1).
    linhas.push({ linha: i + 2, nome, criadoEm, telefone: telefone.valor, email, status, statusOriginal, erros, avisos });
  });

  return {
    faltam,
    colunas: map,
    linhas,
    validas: idsVistos.size,
    comErro: linhas.filter((l) => l.erros.length > 0).length,
    comAviso: linhas.filter((l) => l.erros.length === 0 && l.avisos.length > 0).length,
    repetidas,
  };
}
