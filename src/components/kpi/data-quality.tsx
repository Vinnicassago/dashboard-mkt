import { AlertTriangle, Info } from "lucide-react";
import type { DataWarning } from "@/lib/metrics";

/**
 * Guardrail de decisão: dado atrasado/quebrado leva a decisão errada. Só
 * aparece quando há algo a sinalizar. Server component.
 */
export function DataQualityCard({ warnings }: { warnings: DataWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="rounded-xl border border-[var(--danger-text)]/30 bg-[var(--danger-text)]/[0.04] p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="size-4 text-[var(--danger-text)]" />
        Qualidade dos dados
      </div>
      <ul className="space-y-1.5">
        {warnings.map((w, i) => (
          <li key={i} className="flex gap-2 text-sm text-muted-foreground">
            {w.level === "warn" ? (
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--danger-text)]" />
            ) : (
              <Info className="mt-0.5 size-3.5 shrink-0" />
            )}
            <span>{w.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
