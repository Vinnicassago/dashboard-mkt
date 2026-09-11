import Link from "next/link";
import { AlertTriangle, Settings2, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { comPeriodo } from "@/lib/range";
import type { Trava } from "@/lib/trust";
import { cn } from "@/lib/utils";

/**
 * "Antes de decidir" — o que impede os números acima de sustentarem uma decisão.
 *
 * Vem DEPOIS dos KPIs de propósito: o estado da campanha vem antes do estado do
 * painel. O aviso de que um número não é confiável já está colado ao próprio
 * número (KpiCard em quarentena mostra "—"); esta faixa é a explicação e o
 * caminho para resolver, não o alerta.
 *
 * `config` é separado do resto: campo em branco não é culpa da campanha, então
 * não usa a cor de alerta — mas continua na lista, porque uma regra desligada
 * muda o que o painel consegue te dizer.
 */

const ESTILO = {
  quarentena: {
    Icon: AlertTriangle,
    card: "border-[var(--danger)]/40",
    icon: "text-[var(--danger-text)]",
    tag: "não dá para decidir com isto",
  },
  teto: {
    Icon: TrendingDown,
    card: "border-[var(--warning)]/40",
    icon: "text-[var(--warning-text)]",
    tag: "o valor real é menor",
  },
  piso: {
    Icon: TrendingUp,
    card: "border-[var(--warning)]/40",
    icon: "text-[var(--warning-text)]",
    tag: "o valor real é maior",
  },
  config: {
    Icon: Settings2,
    card: "",
    icon: "text-muted-foreground",
    tag: "falta configurar",
  },
} as const;

export function TrustBand({ travas, rangeKey }: { travas: Trava[]; rangeKey?: string }) {
  if (travas.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-base font-medium">
        Antes de decidir{" "}
        <span className="text-sm font-normal text-muted-foreground">
          · {travas.length} {travas.length === 1 ? "ressalva" : "ressalvas"} sobre os números
          acima
        </span>
      </h2>

      <div className="grid gap-3 lg:grid-cols-2">
        {travas.map((t) => {
          const e = ESTILO[t.nivel];
          return (
            <Card key={t.id} className={cn(e.card)}>
              <CardContent className="flex items-start gap-3 p-4">
                <e.Icon className={cn("mt-0.5 size-4 shrink-0", e.icon)} />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">
                    {t.titulo}{" "}
                    <span className="font-normal text-muted-foreground">— {e.tag}</span>
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{t.detalhe}</p>
                  {t.cta ? (
                    <Link
                      href={comPeriodo(t.cta.href, rangeKey)}
                      className="inline-block pt-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {t.cta.label} →
                    </Link>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
