import Link from "next/link";
import { comPeriodo } from "@/lib/range";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Farol } from "@/lib/farol";
import { formatCurrency0, formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * O farol — o primeiro bloco da Visão Geral, e o único desse tamanho.
 *
 * Hierarquia é escassez: se dois blocos gritam, nenhum grita. Por isso o
 * `highlight` saiu de todos os KPI cards quando este entrou, e por isso ele
 * carrega no máximo quatro coisas — verbo, número, veredito, ação.
 */

const ESTILO = {
  pare: {
    card: "border-[var(--danger)]/45 bg-[var(--danger-text)]/[0.045]",
    verbo: "text-[var(--danger-text)]",
  },
  atencao: {
    card: "border-[var(--warning)]/45 bg-[var(--warning-text)]/[0.045]",
    verbo: "text-[var(--warning-text)]",
  },
  ok: {
    card: "border-[var(--good)]/45",
    verbo: "text-[var(--success-text)]",
  },
  "sem-dado": {
    card: "border-dashed",
    verbo: "text-muted-foreground",
  },
} as const;

export function FarolCard({ farol, rangeKey }: { farol: Farol; rangeKey?: string }) {
  const e = ESTILO[farol.estado];

  return (
    <Card className={cn("overflow-hidden", e.card)}>
      <CardContent className="space-y-4 p-6 sm:p-7">
        <p className={cn("text-sm font-semibold tracking-[0.14em]", e.verbo)}>{farol.verbo}</p>

        <div className="space-y-1">
          <p className="tabular text-4xl font-semibold leading-none sm:text-5xl">
            {farol.valor == null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <>
                {farol.piso ? <span className="text-muted-foreground">≥ </span> : null}
                {farol.formato === "moeda"
                  ? formatCurrency0(farol.valor)
                  : formatInt(farol.valor)}
              </>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {farol.rotulo}
            {farol.base ? <span className="text-muted-foreground/70"> · {farol.base}</span> : null}
          </p>
        </div>

        <p className="max-w-2xl text-base leading-relaxed">{farol.veredito}</p>

        {farol.porQueEsteNumero ? (
          <p className="max-w-2xl border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
            {farol.porQueEsteNumero}
          </p>
        ) : null}

        {farol.acao ? (
          <Link
            href={comPeriodo(farol.acao.href, rangeKey)}
            className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
          >
            {farol.acao.label}
            <ArrowRight className="size-4" />
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
