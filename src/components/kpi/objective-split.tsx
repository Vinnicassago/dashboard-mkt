import { CHART } from "@/components/charts/colors";
import { formatCurrency0, formatPercent } from "@/lib/format";

/**
 * Barra segmentada do orçamento por objetivo: Conversão vs Descoberta.
 * Presentational e serializável (só números) — cada página a envolve num Card.
 * Cores da paleta validada: âmbar da marca p/ conversão, chart-3 p/ descoberta.
 */
const COLORS = {
  conversao: CHART.series[0], // var(--primary)
  descoberta: CHART.series[1], // var(--chart-3)
} as const;

function Legend({
  color,
  label,
  value,
  pct,
}: {
  color: string;
  label: string;
  value: number;
  pct: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="tabular text-sm font-medium">{formatCurrency0(value)}</span>
      <span className="tabular text-xs text-muted-foreground">{formatPercent(pct, 0)}</span>
    </div>
  );
}

export function ObjectiveSplitBar({
  conversao,
  descoberta,
}: {
  conversao: number;
  descoberta: number;
}) {
  const total = conversao + descoberta;
  const convPct = total > 0 ? conversao / total : 1;
  const descPct = total > 0 ? descoberta / total : 0;

  return (
    <div className="space-y-3">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-foreground/[0.07]">
        <div style={{ width: `${convPct * 100}%`, background: COLORS.conversao }} />
        <div style={{ width: `${descPct * 100}%`, background: COLORS.descoberta }} />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1.5">
        <Legend color={COLORS.conversao} label="Conversão" value={conversao} pct={convPct} />
        <Legend color={COLORS.descoberta} label="Descoberta" value={descoberta} pct={descPct} />
      </div>
    </div>
  );
}
