import { ArrowDown, ArrowUp, Minus, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
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
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: KpiDelta;
  Icon?: LucideIcon;
  highlight?: boolean;
}) {
  const DeltaIcon =
    delta?.direction === "up" ? ArrowUp : delta?.direction === "down" ? ArrowDown : Minus;

  return (
    <Card className={cn("p-5", highlight && "ring-1 ring-primary/40")}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight tabular">{value}</p>
      <div className="mt-1.5 flex items-center gap-2 text-xs">
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
    </Card>
  );
}
