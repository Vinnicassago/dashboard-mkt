import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { FormatPerf } from "@/lib/metrics";
import { formatCompact, formatDuration, formatInt, formatPercent } from "@/lib/format";

/**
 * Per-format comparison cards (reel vs carousel vs feed vs story). The list
 * arrives sorted best-engagement first; the highlight goes to the best format
 * WITH a reliable sample (1 post não coroa campeão).
 */
export function FormatBreakdown({ formats }: { formats: FormatPerf[] }) {
  if (formats.length === 0) return null;
  const destaque = formats.findIndex((f) => f.sampleOk);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {formats.map((f, i) => (
        <Card
          key={f.type}
          className={cn("p-4", i === destaque && "ring-1 ring-primary/40")}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">{f.label}</span>
            {!f.sampleOk ? (
              <Badge variant="muted">amostra pequena</Badge>
            ) : i === destaque ? (
              <Badge variant="good">Destaque</Badge>
            ) : (
              <span className="text-xs text-muted-foreground">
                {f.count} post{f.count > 1 ? "s" : ""}
              </span>
            )}
          </div>
          {i === destaque || !f.sampleOk ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {f.count} post{f.count > 1 ? "s" : ""}
            </p>
          ) : null}
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row label="Engajamento" value={formatPercent(f.avgEngagement)} />
            <Row label="Alcance médio" value={formatCompact(f.avgReach)} />
            <Row label="Taxa de salvamento" value={formatPercent(f.saveRate)} />
            <Row label="Taxa de compart." value={formatPercent(f.shareRate)} />
            {f.avgWatchTime != null ? (
              <Row label="Tempo médio assistido" value={formatDuration(f.avgWatchTime)} />
            ) : null}
            {f.totalWatchTime != null ? (
              <Row label="Tempo total assistido" value={`${formatInt(f.totalWatchTime / 60)} min`} />
            ) : null}
          </dl>
        </Card>
      ))}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  );
}
