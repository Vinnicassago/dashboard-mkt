import Papa from "papaparse";
import type { AdDaily } from "./types";

/** Strip accents + lowercase for tolerant header matching. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .split("")
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c < 0x0300 || c > 0x036f; // drop combining diacritical marks
    })
    .join("")
    .trim()
    .toLowerCase();
}

/** Parse a locale-friendly number ("12,34" or "12.34" or "1234"). */
export function parseNum(raw: unknown): number {
  if (raw == null) return 0;
  let s = String(raw).replace(/[^\d.,-]/g, "").trim();
  if (!s) return 0;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

// Column candidates (English + Portuguese exports from Meta Ads Manager).
const FIELDS = {
  date: ["dia", "day", "date", "data", "reporting starts", "inicio dos relatorios"],
  adId: ["id do anuncio", "ad id", "identificacao do anuncio"],
  adName: ["nome do anuncio", "ad name", "anuncio"],
  adset: ["nome do conjunto de anuncios", "ad set name", "conjunto de anuncios", "ad set"],
  campaign: ["nome da campanha", "campaign name", "campanha"],
  objective: ["objetivo", "objective", "objetivo da campanha", "campaign objective"],
  spend: ["valor gasto", "valor usado", "amount spent", "spend", "valor gasto (brl)", "valor usado (brl)"],
  impressions: ["impressoes", "impressions"],
  reach: ["alcance", "reach"],
  clicks: ["cliques no link", "link clicks", "cliques", "clicks", "cliques (todos)"],
  leads: ["leads", "resultados", "results", "cadastros", "clientes potenciais"],
} as const;

type Field = keyof typeof FIELDS;

function buildHeaderMap(headers: string[]): Partial<Record<Field, string>> {
  const map: Partial<Record<Field, string>> = {};
  const normalized = headers.map((h) => ({ raw: h, n: norm(h) }));
  for (const field of Object.keys(FIELDS) as Field[]) {
    for (const cand of FIELDS[field]) {
      const hit = normalized.find((h) => h.n === cand || h.n.includes(cand));
      if (hit) {
        map[field] = hit.raw;
        break;
      }
    }
  }
  return map;
}

function toIsoDate(raw: string): string {
  const s = raw.trim();
  // already yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // dd/mm/yyyy
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return s.slice(0, 10);
}

export interface ParseResult {
  rows: AdDaily[];
  matchedColumns: Partial<Record<Field, string>>;
  skipped: number;
}

export function parseAdsCsv(text: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  const headers = parsed.meta.fields ?? [];
  const map = buildHeaderMap(headers);

  if (!map.date || !map.spend) {
    throw new Error(
      "CSV não reconhecido: preciso pelo menos das colunas de data (Dia) e valor gasto. Use o modelo abaixo ou exporte o relatório do Ads Manager em CSV.",
    );
  }

  const rows: AdDaily[] = [];
  let skipped = 0;
  for (const r of parsed.data) {
    const date = map.date ? toIsoDate(r[map.date] ?? "") : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      skipped++;
      continue;
    }
    const adName = map.adName ? r[map.adName] : undefined;
    const adId = (map.adId ? r[map.adId] : undefined) || adName || "sem-id";
    const impressions = map.impressions ? parseNum(r[map.impressions]) : 0;
    const reach = map.reach ? parseNum(r[map.reach]) : 0;
    const objective = map.objective ? r[map.objective]?.trim() : undefined;
    rows.push({
      date,
      campaign: (map.campaign ? r[map.campaign] : "") || "Campanha importada",
      adset: (map.adset ? r[map.adset] : "") || "—",
      adId: String(adId).trim(),
      objective: objective || undefined,
      spend: map.spend ? parseNum(r[map.spend]) : 0,
      impressions,
      reach: reach || impressions,
      frequency: reach > 0 ? impressions / reach : 0,
      clicks: map.clicks ? Math.round(parseNum(r[map.clicks])) : 0,
      leads: map.leads ? Math.round(parseNum(r[map.leads])) : 0,
    });
  }

  if (rows.length === 0) {
    throw new Error("Nenhuma linha válida encontrada no CSV.");
  }
  return { rows, matchedColumns: map, skipped };
}

/** A ready-to-fill CSV template matching the parser's expected columns. */
export const ADS_CSV_TEMPLATE = [
  "Dia,Nome do anúncio,ID do anúncio,Nome do conjunto de anúncios,Nome da campanha,Objetivo,Valor gasto,Impressões,Alcance,Cliques no link,Leads",
  "2026-07-23,Vídeo — Cansado de financiar?,AD-01,Público Frio — Interesses,Consórcio — Geração de Leads,OUTCOME_LEADS,180.50,7200,5100,142,19",
  "2026-07-23,Carrossel — Consórcio x Financiamento,AD-02,Público Frio — Interesses,Consórcio — Geração de Leads,OUTCOME_LEADS,150.00,6100,4300,88,11",
  "2026-07-23,Reel — Bastidores do escritório,AD-07,Descoberta — Seguidores,Consórcio — Descoberta de Perfil,OUTCOME_ENGAGEMENT,60.00,9800,8200,41,0",
].join("\n");
