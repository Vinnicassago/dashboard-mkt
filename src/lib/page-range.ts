import { dataDateRange, type DateRange } from "./metrics";
import { resolveRange } from "./range";
import type { DashboardData } from "./types";

/** Resolve the active period for a page from the `range` search param. */
export function pageRange(
  data: DashboardData,
  rangeKey?: string,
): { range: DateRange | undefined; span: DateRange; rangeKey: string } {
  const span = dataDateRange(data);
  return { range: resolveRange(rangeKey, span), span, rangeKey: rangeKey ?? "all" };
}
