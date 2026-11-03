import { formatInt } from "@/lib/format";
import type { LinhaDeMeta, Ritmo } from "@/lib/live-painel";
import { cn } from "@/lib/utils";

/** Status sempre com texto — a cor nunca é a única pista (tokens --status-*). */
export const RITMO_LABEL: Record<Ritmo, string> = {
  no_ritmo: "no ritmo",
  perto: "perto",
  atras: "atrás do ritmo",
  sem_ritmo: "",
};
const RITMO_COR: Record<Ritmo, string> = {
  no_ritmo: "text-[var(--status-ok-text)]",
  perto: "text-[var(--status-perto-text)]",
  atras: "text-[var(--status-fora-text)]",
  sem_ritmo: "text-muted-foreground",
};
const RITMO_FUNDO: Record<Ritmo, string> = {
  no_ritmo: "bg-[var(--status-ok)]",
  perto: "bg-[var(--status-perto)]",
  atras: "bg-[var(--status-fora)]",
  sem_ritmo: "bg-primary",
};

/**
 * Meta × realizado com a marca de onde deveria estar hoje (proporcional aos dias
 * de captação). Número manual ainda não digitado aparece como "—", nunca como 0.
 */
export function RitmoBar({ linha }: { linha: LinhaDeMeta }) {
  const { valor, meta, esperado, ritmo } = linha;
  const pct = valor != null && meta ? Math.min(1, valor / meta) : 0;
  const marca = esperado != null && meta ? Math.min(1, esperado / meta) : null;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{linha.rotulo}</span>
        <span className="tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">{valor == null ? "—" : formatInt(valor)}</span>
          {meta != null ? ` / ${formatInt(meta)}` : " · sem meta"}
          {ritmo !== "sem_ritmo" ? <span className={cn("ml-2 text-xs font-medium", RITMO_COR[ritmo])}>{RITMO_LABEL[ritmo]}</span> : null}
        </span>
      </div>
      {meta != null ? (
        <div
          className="relative h-2 rounded-full bg-foreground/[0.08]"
          role="progressbar"
          aria-label={`${linha.rotulo}: ${valor ?? "sem número"} de ${meta}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct * 100)}
        >
          <div className={cn("h-2 rounded-full", RITMO_FUNDO[ritmo])} style={{ width: `${Math.max(valor ? 2 : 0, pct * 100)}%` }} />
          {marca != null ? (
            <span
              className="absolute -top-1 h-4 w-0.5 rounded bg-foreground/70"
              style={{ left: `calc(${marca * 100}% - 1px)` }}
              title={`Onde deveria estar hoje: ${formatInt(Math.round(esperado!))}`}
              aria-hidden
            />
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {esperado != null ? `deveria estar em ${formatInt(Math.round(esperado))} hoje` : null}
        {esperado != null && linha.nota ? " · " : null}
        {linha.nota}
      </p>
    </div>
  );
}
