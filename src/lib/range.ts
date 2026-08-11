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

export function isRangeKey(v: string | undefined): v is RangeKey {
  // Object.hasOwn: a chave vem crua da URL — `in` deixaria "toString" etc. passarem.
  return v === "all" || (v !== undefined && Object.hasOwn(PRESET_DAYS, v));
}

/**
 * Resolve a preset key into a concrete DateRange, anchored to the dataset's
 * last day. `undefined` means "all data" (no filtering).
 */
export function resolveRange(
  key: string | undefined,
  span: { from: string; to: string },
): DateRange | undefined {
  if (!key || key === "all") return undefined;
  const days = Object.hasOwn(PRESET_DAYS, key) ? PRESET_DAYS[key] : 0;
  if (!days || !span.to) return undefined;
  const fromD = new Date(span.to + "T00:00:00Z");
  fromD.setUTCDate(fromD.getUTCDate() - (days - 1));
  let from = fromD.toISOString().slice(0, 10);
  if (span.from && from < span.from) from = span.from;
  return { from, to: span.to };
}
