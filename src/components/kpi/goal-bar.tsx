import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Bullet-style "meta vs realizado" bar.
 * `pct` is progress toward the target (0–1+). For cost goals the caller passes
 * target/actual so more progress is still better.
 */
export function GoalBar({
  label,
  valueText,
  targetText,
  pct,
  onTrack,
}: {
  label: string;
  valueText: string;
  targetText: string;
  pct: number;
  onTrack: boolean;
}) {
  const width = Math.max(2, Math.min(100, pct * 100));
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular text-muted-foreground">
          <span className={cn("font-semibold", onTrack ? "text-[var(--success-text)]" : "text-foreground")}>
            {valueText}
          </span>{" "}
          / {targetText}
        </span>
      </div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-foreground/[0.07]">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            onTrack ? "bg-[var(--good)]" : "bg-primary",
          )}
          style={{ width: `${width}%` }}
        />
      </div>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {onTrack ? (
          <>
            <Check className="size-3 text-[var(--success-text)]" />
            <span>Meta atingida</span>
          </>
        ) : (
          <span>{Math.round(pct * 100)}% da meta</span>
        )}
      </div>
    </div>
  );
}
