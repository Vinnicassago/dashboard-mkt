import type { DateRange } from "./metrics";

/** Period presets shown in the header selector. */
export const RANGE_PRESETS = [
  { key: "all", label: "Campanha" },
  { key: "14d", label: "14 dias" },
  { key: "7d", label: "7 dias" },
] as const;

export type RangeKey = (typeof RANGE_PRESETS)[number]["key"];

export function isRangeKey(v: string | undefined): v is RangeKey {
  return v === "all" || v === "14d" || v === "7d";
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
  const days = key === "7d" ? 7 : key === "14d" ? 14 : 0;
  if (!days || !span.to) return undefined;
  const fromD = new Date(span.to + "T00:00:00Z");
  fromD.setUTCDate(fromD.getUTCDate() - (days - 1));
  let from = fromD.toISOString().slice(0, 10);
  if (span.from && from < span.from) from = span.from;
  return { from, to: span.to };
}
