import { ChevronRight } from "lucide-react";
import type { FunnelStage } from "@/lib/metrics";
import { formatInt, formatPercent } from "@/lib/format";
import { CHART } from "./colors";

/**
 * Funnel as connected stat blocks with the step conversion between them.
 * Stat-block form avoids the "invisible sliver" problem of proportional
 * funnel bars when the top stage dwarfs the bottom. Direct labels throughout.
 */
export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const top = stages[0]?.value ?? 0;

  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
      {stages.map((s, i) => (
        <div key={s.key} className="flex flex-1 items-stretch gap-2">
          {i > 0 ? (
            <div className="flex shrink-0 items-center justify-center md:flex-col">
              <div className="flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground">
                <ChevronRight className="size-3 md:hidden" />
                {formatPercent(s.fromPrev ?? 0)}
              </div>
            </div>
          ) : null}
          <div className="flex-1 rounded-xl border bg-card p-4">
            <div
              className="mb-2 h-1 w-8 rounded-full"
              style={{ background: CHART.funnel[i] }}
            />
            <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular">{formatInt(s.value)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {i === 0 ? "topo do funil" : `${formatPercent(top ? s.value / top : 0)} do topo`}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
