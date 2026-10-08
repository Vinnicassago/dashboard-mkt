import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import type { Gargalo, Transicao } from "@/lib/gargalo";
import { AMOSTRA_GARGALO, textoDoImpacto } from "@/lib/gargalo";
import { DONO_LABEL } from "@/lib/dono";
import { comPeriodo } from "@/lib/range";
import { formatInt, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * ONDE TRAVA — o funil em transições, cada uma com dono, taxa, régua, Δ e n.
 * O gargalo é a de menor razão taxa ÷ régua (meta, ou média de 8 semanas — e o
 * rótulo diz qual). Abaixo de 10 entradas a taxa não aparece. Clicar numa
 * transição abre a página onde se age nela.
 */

const pct = (v: number) => formatPercent(v, v < 0.1 ? 1 : 0);
const pontos = (d: number) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${(Math.abs(d) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pts`;

function Celula({ t, ehGargalo, rangeKey }: { t: Transicao; ehGargalo: boolean; rangeKey?: string }) {
  const semAmostra = t.taxa == null;
  return (
    <Link
      href={comPeriodo(t.href, rangeKey)}
      className={cn(
        "flex min-w-[9.5rem] flex-1 flex-col gap-0.5 rounded-lg border px-3 py-2 transition-colors hover:bg-foreground/[0.03]",
        ehGargalo && "border-[var(--status-fora)]/60 bg-[var(--status-fora)]/[0.05]",
      )}
    >
      <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{t.rotulo}</span>
        <span className="shrink-0 rounded border px-1 py-px text-[10px] uppercase tracking-wide">{DONO_LABEL[t.dono]}</span>
      </span>
      <span className="tabular text-lg font-semibold leading-tight">
        {semAmostra ? <span className="text-muted-foreground">—</span> : pct(t.taxa!)}
        {t.delta !== undefined ? (
          <span className={cn("ml-1.5 text-xs font-medium", t.delta > 0 ? "text-[var(--success-text)]" : t.delta < 0 ? "text-[var(--danger-text)]" : "text-muted-foreground")}>
            {pontos(t.delta)}
          </span>
        ) : null}
      </span>
      <span className="text-[11px] text-muted-foreground">
        {semAmostra
          ? `n = ${formatInt(t.entradas)} (< ${AMOSTRA_GARGALO})`
          : t.referencia
            ? `${t.referencia.origem === "meta" ? "meta" : "média 8 sem."} ${pct(t.referencia.taxa)}${t.referencia.provisoria ? " (prov.)" : ""} · n = ${formatInt(t.entradas)}`
            : `sem régua · n = ${formatInt(t.entradas)}`}
      </span>
    </Link>
  );
}

export function OndeTrava({ transicoes, gargalo, rangeKey }: { transicoes: Transicao[]; gargalo: Gargalo | null; rangeKey?: string }) {
  const g = gargalo;
  return (
    <Card data-bloco="onde-trava">
      <CardContent className="space-y-2.5 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium">Onde trava</p>
          <Link href={comPeriodo("/jornada", rangeKey)} className="text-xs font-medium text-primary underline-offset-4 hover:underline">
            Funil completo →
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {transicoes.map((t) => (
            <Celula key={t.id} t={t} ehGargalo={g?.transicao.id === t.id} rangeKey={rangeKey} />
          ))}
        </div>
        <p className="text-sm">
          {g ? (
            <>
              <span className="font-medium text-[var(--status-fora-text)]">► Gargalo: {g.transicao.rotulo}</span>{" "}
              <span className="text-muted-foreground">
                ({DONO_LABEL[g.transicao.dono]}) — {pct(g.transicao.taxa!)} contra{" "}
                {g.transicao.referencia!.origem === "meta" ? "meta de" : "média de 8 semanas de"} {pct(g.transicao.referencia!.taxa)}.{" "}
                {textoDoImpacto(g)}.
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              Sem gargalo para apontar: nenhuma transição com {AMOSTRA_GARGALO} entradas e uma régua (meta ou média de 8 semanas).
            </span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
