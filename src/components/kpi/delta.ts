import { delta as computeDelta } from "@/lib/metrics";
import { formatInt, formatPercent } from "@/lib/format";
import type { KpiDelta } from "./kpi-card";

/**
 * Build a KpiCard delta comparing the current period to the previous one.
 * Returns `undefined` when there is no baseline (previous period is empty),
 * so the card simply shows no arrow instead of a misleading "+∞".
 */
export function pctDelta(
  current: number,
  previous: number,
  opts: { lowerIsBetter?: boolean } = {},
): KpiDelta | undefined {
  if (!(previous > 0)) return undefined;
  const d = computeDelta(current, previous);
  const good = opts.lowerIsBetter ? d.direction === "down" : d.direction === "up";
  const intent: KpiDelta["intent"] =
    d.direction === "flat" ? "neutral" : good ? "good" : "bad";
  const sign = d.abs > 0 ? "+" : "";
  return {
    text: `${sign}${formatPercent(d.pct)} vs. anterior`,
    direction: d.direction,
    intent,
  };
}

/** Absolute signed change, e.g. "+12 no período" for new followers. */
export function absDelta(value: number, suffix = "no período"): KpiDelta {
  const direction: KpiDelta["direction"] = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const intent: KpiDelta["intent"] = value > 0 ? "good" : value < 0 ? "bad" : "neutral";
  const sign = value > 0 ? "+" : "";
  return { text: `${sign}${formatInt(value)} ${suffix}`, direction, intent };
}
