import Papa from "papaparse";
import type { Lead, LeadStatus } from "./types";

/**
 * Importador de leads (backfill). Aceita o CSV exportado do rastreamento da
 * landing page (colunas created_at, event_id, nome, whatsapp, email, utm_*,
 * fbp, fbc, Status). Casa 1:1 com o que o /api/track grava — inclusive o
 * esquema de id `LEAD-LP-<8 chars do event_id>` — para que um lead já capturado
 * ao vivo e o mesmo lead importado da planilha sejam a MESMA linha (upsert por
 * id), sem duplicar.
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

// Mapeia rótulos de status (livres) para o enum interno.
const STATUS_MAP: Record<string, LeadStatus> = {
  "": "lead",
  lead: "lead",
  novo: "lead",
  agendou: "agendou",
  agendado: "agendou",
  agendada: "agendou",
  "reuniao agendada": "agendou",
  compareceu: "compareceu",
  realizada: "compareceu",
  realizado: "compareceu",
  cliente: "cliente",
  fechado: "cliente",
  vendido: "cliente",
  ganho: "cliente",
  perdido: "perdido",
  perdida: "perdido",
  desqualificado: "perdido",
  "nao qualificado": "perdido",
};

function toStatus(raw?: string): LeadStatus {
  return STATUS_MAP[norm(raw ?? "")] ?? "lead";
}

/** Mesmo esquema de id do /api/track, para deduplicar com os leads ao vivo. */
function leadIdFrom(eventId: string, fallbackSeed: string): string {
  const ev = eventId.trim();
  return ev ? `LEAD-LP-${ev.slice(0, 8)}` : `LEAD-IMP-${fallbackSeed}`;
}

export interface LeadsParseResult {
  leads: Lead[];
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
  let skipped = 0;
  parsed.data.forEach((r, i) => {
    const name = (map.name ? r[map.name] : "")?.trim() ?? "";
    const createdAt = (map.createdAt ? r[map.createdAt] : "")?.trim() ?? "";
    if (!name || !/^\d{4}-\d{2}-\d{2}/.test(createdAt)) {
      skipped++;
      return;
    }
    const eventId = (map.eventId ? r[map.eventId] : "")?.trim() ?? "";
    const id = leadIdFrom(eventId, `${createdAt.slice(0, 10).replace(/-/g, "")}-${i}`);
    const pick = (f: Field) => (map[f] ? r[map[f]!]?.trim() || undefined : undefined);
    byId.set(id, {
      id,
      createdAt,
      name,
      email: pick("email"),
      phone: pick("phone"),
      utmSource: pick("utmSource"),
      utmCampaign: pick("utmCampaign"),
      utmContent: pick("utmContent"),
      status: toStatus(map.status ? r[map.status] : ""),
      fbc: pick("fbc"),
      fbp: pick("fbp"),
    });
  });

  const leads = [...byId.values()];
  if (leads.length === 0) {
    throw new Error("Nenhum lead válido encontrado no CSV.");
  }
  return { leads, matchedColumns: map, skipped };
}

/** Modelo pronto para preencher, no formato do rastreamento da landing page. */
export const LEADS_CSV_TEMPLATE = [
  "created_at,event_id,Status,nome,whatsapp,email,utm_source,utm_campaign,utm_content,fbp,fbc",
  "2026-07-27T21:53:40-03:00,lead_d9de70b9-e60a-4ce5,,Fabio,31997598013,fabio@gmail.com,metaads,CP - Leads - Brunno quevedo,video brunno 2 diagnostico|12025253786,,",
  "2026-07-28T00:02:32-03:00,lead_4d50c064-7d47-4c25,agendou,Beatriz,72727383838,beatriz@gmail.com,ig,,link_in_bio,,",
].join("\n");
