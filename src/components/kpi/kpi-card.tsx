import { ArrowDown, ArrowUp, Minus, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { KpiSparkline } from "./kpi-sparkline";
import { cn } from "@/lib/utils";

export interface KpiDelta {
  text: string;
  direction: "up" | "down" | "flat";
  intent: "good" | "bad" | "neutral";
}

const intentClass: Record<KpiDelta["intent"], string> = {
  good: "text-[var(--success-text)]",
  bad: "text-[var(--danger-text)]",
  neutral: "text-muted-foreground",
};

export function KpiCard({
  label,
  value,
  hint,
  delta,
  Icon,
  highlight = false,
  spark,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: KpiDelta;
  Icon?: LucideIcon;
  highlight?: boolean;
  /** Série diária opcional — vira uma sparkline sutil no rodapé do card. */
  spark?: number[];
}) {
  const DeltaIcon =
    delta?.direction === "up" ? ArrowUp : delta?.direction === "down" ? ArrowDown : Minus;

  return (
    <Card
      className={cn(
        "relative isolate overflow-hidden p-5",
        highlight && "ring-1 ring-primary/40",
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular sm:text-3xl">{value}</p>
      {/* min-h reserva a linha do delta/hint p/ cards sem eles ficarem da mesma altura. */}
      <div className="mt-1.5 flex min-h-[1.25rem] items-center gap-2 text-xs">
        {delta ? (
          <span
            className={cn("inline-flex items-center gap-0.5 font-medium", intentClass[delta.intent])}
          >
            <DeltaIcon className="size-3.5" />
            {delta.text}
          </span>
        ) : null}
        {hint ? <span className="text-muted-foreground">{hint}</span> : null}
      </div>
      {spark && spark.length > 1 ? (
        <KpiSparkline
          data={spark}
          className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-9 w-full"
        />
      ) : null}
    </Card>
  );
}
