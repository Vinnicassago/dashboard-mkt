import Link from "next/link";
import { FONTE_META } from "@/lib/cascata";
import { dica } from "@/lib/dicionario";
import { DONO_LABEL } from "@/lib/dono";
import type { EtapaFunil, MetaDaEtapa } from "@/lib/funil";
import { formatarAlvo } from "@/lib/metas";
import { comPeriodo } from "@/lib/range";
import { formatCurrency, formatInt, formatIntComSinal, formatPercent } from "@/lib/format";
import { StatusMetaBadge, type MetaExibida } from "@/components/kpi/status-meta";
import { cn } from "@/lib/utils";

/**
 * O funil de conversão, na vertical, etapa a etapa: volume, conversão da
 * anterior, custo por unidade, dono, fonte, meta e Δ contra o período anterior.
 * Os números vêm prontos de `montarFunil` (lib/funil.ts); aqui só se imprime.
 */

/** Fração pequena não vira "0,0%" — 112 em 374 mil é "<0,1%", não "nada". */
function pct(v: number): string {
  if (v > 0 && v < 0.001) return "<0,1%";
  return formatPercent(v);
}

/** A meta da etapa no formato do badge: "1º contato no prazo 62% (n = 40) · meta 90%". */
function metaExibida(m: MetaDaEtapa): MetaExibida {
  const partes: string[] = [];
  if (m.formato === "pct") partes.push(`${m.nome} ${m.n > 0 ? formatPercent(m.valor) : "—"} (n = ${formatInt(m.n)})`);
  partes.push(m.alvo != null ? `meta ${formatarAlvo(m.metrica, m.alvo)}` : "sem meta");
  return { alvoTexto: partes.join(" · "), avaliacao: m.alvo != null ? m.avaliacao : undefined, provisoria: m.provisoria };
}

function Junta({ etapa, rangeKey }: { etapa: EtapaFunil; rangeKey?: string }) {
  const parados = etapa.parados
    ? `▸ ${formatInt(etapa.parados)} ${etapa.parados === 1 ? "parado" : "parados"} agora`
    : null;
  return (
    <div className="flex items-stretch gap-3 pl-1">
      <div
        aria-hidden
        className={cn(
          "ml-[7px] w-px shrink-0",
          etapa.trocaDeSistema ? "border-l border-dashed border-[var(--rule-strong,var(--border))]" : "bg-border",
        )}
      />
      <div className="flex min-h-[2rem] flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-xs">
        {etapa.daAnterior !== undefined ? (
          <span className="tabular font-medium text-muted-foreground">{pct(etapa.daAnterior)} da anterior</span>
        ) : etapa.valor != null ? (
          <span className="text-muted-foreground" title="Abaixo de 3 na etapa anterior: taxa não é taxa">taxa sem amostra</span>
        ) : null}
        {etapa.dono ? (
          <span className="rounded border px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
            {DONO_LABEL[etapa.dono]}
          </span>
        ) : null}
        {etapa.trocaDeSistema ? <span className="text-muted-foreground">o dado troca de sistema aqui</span> : null}
        {parados && etapa.etapaFila ? (
          <Link
            href={comPeriodo(`/fila?etapa=${etapa.etapaFila}`, rangeKey)}
            className="font-medium text-[var(--danger-text)] underline-offset-4 hover:underline"
          >
            {parados}
          </Link>
        ) : parados ? (
          <span className="font-medium text-[var(--danger-text)]">{parados}</span>
        ) : null}
      </div>
    </div>
  );
}

export function FunilConversao({ etapas, rangeKey }: { etapas: EtapaFunil[]; rangeKey?: string }) {
  return (
    <div className="flex flex-col">
      {etapas.map((d, i) => {
        const desconhecido = d.valor === null;
        const delta = d.anterior !== undefined && d.valor != null ? d.valor - d.anterior : undefined;
        return (
          <div key={d.key}>
            {i > 0 ? <Junta etapa={d} rangeKey={rangeKey} /> : null}
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className={cn(
                  "mt-2 size-3.5 shrink-0 rounded-full border-2",
                  d.ehAncora ? "border-primary bg-primary/20" : "border-border bg-card",
                )}
              />
              <div className={cn("min-w-0 flex-1 rounded-lg border px-4 py-3", d.ehAncora && "bg-foreground/[0.03]", desconhecido && "border-dashed")}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className={cn("text-sm", d.ehAncora ? "font-semibold" : "font-medium")} title={d.dica ? dica(d.dica) : undefined}>
                    {d.label}
                  </p>
                  <p className={cn("tabular text-xl font-semibold", desconhecido && "text-muted-foreground")}>
                    {desconhecido ? "—" : formatInt(d.valor!)}
                    {delta !== undefined ? (
                      <span className="ml-2 text-xs font-medium text-muted-foreground" title="Diferença contra o período anterior, de mesmo tamanho">
                        {formatIntComSinal(delta)} vs. anterior
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="rounded border px-1.5 py-px text-[10px] uppercase tracking-wide">{FONTE_META[d.fonte].sistema}</span>
                  {d.custo ? (
                    <span className="tabular" title={d.custo.dica ? dica(d.custo.dica) : undefined}>
                      {d.custo.prefixo ? `${d.custo.prefixo} ` : ""}
                      {formatCurrency(d.custo.valor)} {d.custo.rotulo}
                    </span>
                  ) : null}
                  {d.meta ? <StatusMetaBadge meta={metaExibida(d.meta)} /> : null}
                </div>
                {d.nota ? (
                  <p className={cn("mt-1.5 text-xs leading-relaxed", desconhecido ? "text-[var(--danger-text)]" : "text-muted-foreground")}>{d.nota}</p>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
