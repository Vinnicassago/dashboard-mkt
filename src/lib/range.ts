import type { DateRange } from "./metrics";

/** Period presets shown in the header selector. */
export const RANGE_PRESETS = [
  { key: "all", label: "Campanha" },
  { key: "90d", label: "90 dias" },
  { key: "30d", label: "30 dias" },
  { key: "14d", label: "14 dias" },
  { key: "7d", label: "7 dias" },
] as const;

export type RangeKey = (typeof RANGE_PRESETS)[number]["key"];

const PRESET_DAYS: Record<string, number> = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 };

/**
 * Período livre viaja na MESMA chave `range`, no formato "de..ate":
 *   2026-08-01..2026-08-27   entre duas datas
 *   2026-08-01..             daquela data em diante
 *   ..2026-08-27             até aquela data
 * Assim toda página que já lê `?range=` ganha o período livre de graça.
 */
const CUSTOM = /^(\d{4}-\d{2}-\d{2})?\.\.(\d{4}-\d{2}-\d{2})?$/;

export interface CustomRange {
  from?: string;
  to?: string;
}

export function parseCustomRange(key: string | undefined): CustomRange | null {
  if (!key) return null;
  const m = CUSTOM.exec(key);
  if (!m) return null;
  const [, from, to] = m;
  if (!from && !to) return null;
  if (from && to && from > to) return { from: to, to: from };
  return { from, to };
}

export function buildCustomKey(from: string, to: string): string {
  return `${from}..${to}`;
}

export function isRangeKey(v: string | undefined): boolean {
  // Object.hasOwn: a chave vem crua da URL — `in` deixaria "toString" etc. passarem.
  if (v === "all") return true;
  if (v === undefined) return false;
  return Object.hasOwn(PRESET_DAYS, v) || parseCustomRange(v) !== null;
}

/** dd/mm — rótulo curto para o botão e para o texto da análise de IA. */
function curto(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** Rótulo legível de qualquer chave de período. */
export function rangeLabel(key: string | undefined): string {
  const preset = RANGE_PRESETS.find((p) => p.key === (key ?? "all"));
  if (preset) return preset.label;
  const custom = parseCustomRange(key);
  if (!custom) return "o período";
  if (custom.from && custom.to) return `${curto(custom.from)} a ${curto(custom.to)}`;
  if (custom.from) return `desde ${curto(custom.from)}`;
  return `até ${curto(custom.to as string)}`;
}

/**
 * Resolve a preset key or a custom "from..to" into a concrete DateRange,
 * anchored to the dataset's last day. `undefined` means "all data".
 */
export function resolveRange(
  key: string | undefined,
  span: { from: string; to: string },
): DateRange | undefined {
  if (!key || key === "all") return undefined;

  // Período livre: recorta ao que existe de dado, para não pedir dia sem série.
  const custom = parseCustomRange(key);
  if (custom) {
    let from = custom.from ?? span.from;
    let to = custom.to ?? span.to;
    if (!from && !to) return undefined;
    if (span.from && from && from < span.from) from = span.from;
    if (span.to && to && to > span.to) to = span.to;
    if (!from || !to || from > to) return undefined;
    return { from, to };
  }

  const days = Object.hasOwn(PRESET_DAYS, key) ? PRESET_DAYS[key] : 0;
  if (!days || !span.to) return undefined;
  const fromD = new Date(span.to + "T00:00:00Z");
  fromD.setUTCDate(fromD.getUTCDate() - (days - 1));
  let from = fromD.toISOString().slice(0, 10);
  if (span.from && from < span.from) from = span.from;
  return { from, to: span.to };
}
