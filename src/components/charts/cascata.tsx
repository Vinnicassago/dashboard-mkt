import { FONTE_META, type Degrau } from "@/lib/cascata";
import { formatCurrency, formatInt, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A cascata, na vertical.
 *
 * Vertical e não horizontal porque são 11 degraus atravessando quatro sistemas:
 * em linha eles viram tiras ilegíveis, e a junta — que é onde mora a informação —
 * some. Cada linha carrega o valor, a conversão da anterior, a fração da âncora
 * vigente, o custo unitário acumulado e a fonte.
 *
 * A junta entre dois degraus é tracejada quando o dado troca de sistema. É ali
 * que os números costumam parar de bater, e saber disso antes de investigar
 * economiza a suspeita errada.
 */

const DONO_LABEL = { MKT: "marketing", BOT: "robô", COM: "comercial" } as const;

/**
 * Fração muito pequena não vira "0,0%".
 *
 * 112 envios sobre 374.307 impressões é 0,03% — arredondar para 0,0% imprime
 * "nada chegou aqui", que é falso. Foi para evitar exatamente isso, repetido
 * oito linhas seguidas, que a cascata ganhou a segunda âncora.
 */
function pct(v: number): string {
  if (v > 0 && v < 0.001) return "<0,1%";
  return formatPercent(v);
}

function Junta({ degrau }: { degrau: Degrau }) {
  const perda = degrau.perda ?? 0;
  const grave = degrau.daAnterior !== undefined && degrau.daAnterior < 0.5;

  return (
    <div className="flex items-stretch gap-3 pl-1">
      <div
        className={cn(
          "ml-[7px] w-px shrink-0",
          degrau.trocaDeSistema
            ? "border-l border-dashed border-[var(--rule-strong,var(--border))]"
            : "bg-border",
        )}
        aria-hidden
      />
      <div className="flex min-h-[2rem] flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-xs">
        {degrau.daAnterior !== undefined ? (
          <span
            className={cn(
              "tabular font-medium",
              grave ? "text-[var(--danger-text)]" : "text-muted-foreground",
            )}
          >
            {pct(degrau.daAnterior)}
            {perda > 0 ? ` · −${formatInt(perda)}` : ""}
          </span>
        ) : null}
        {degrau.dono ? (
          <span className="rounded border px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
            {DONO_LABEL[degrau.dono]}
          </span>
        ) : null}
        {degrau.trocaDeSistema ? (
          <span className="text-muted-foreground">o dado troca de sistema aqui</span>
        ) : null}
        {degrau.parados ? (
          <span className="font-medium text-[var(--danger-text)]">
            ▸ {formatInt(degrau.parados)} parado(s) agora
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function Cascata({
  degraus,
  ancoraLabel = "do topo",
}: {
  degraus: Degrau[];
  /** Como nomear a fração da primeira âncora. */
  ancoraLabel?: string;
}) {
  /*
   * Rótulo da âncora vigente por degrau, resolvido ANTES do render: a partir de
   * "Leads" os percentuais passam a ser sobre leads, e é o rótulo que impede a
   * troca de base de passar despercebida.
   */
  const rotulos: string[] = [];
  let vigente = ancoraLabel;
  for (const [i, d] of degraus.entries()) {
    if (d.ehAncora && i > 0) vigente = `de ${d.label.toLowerCase()}`;
    rotulos.push(vigente);
  }

  return (
    <div className="flex flex-col">
      {degraus.map((d, i) => {
        const desconhecido = d.valor === null;
        const rotuloAncora = rotulos[i];

        return (
          <div key={d.key}>
            {i > 0 ? <Junta degrau={d} /> : null}

            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-2 size-3.5 shrink-0 rounded-full border-2",
                  d.ehAncora ? "border-primary bg-primary/20" : "border-border bg-card",
                )}
                aria-hidden
              />
              <div
                className={cn(
                  "min-w-0 flex-1 rounded-lg border px-4 py-3",
                  d.ehAncora && "bg-foreground/[0.03]",
                  desconhecido && "border-dashed",
                )}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className={cn("text-sm", d.ehAncora ? "font-semibold" : "font-medium")}>
                    {d.label}
                  </p>
                  <p
                    className={cn(
                      "tabular text-xl font-semibold",
                      desconhecido && "text-muted-foreground",
                    )}
                  >
                    {desconhecido ? "—" : formatInt(d.valor!)}
                  </p>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="rounded border px-1.5 py-px text-[10px] uppercase tracking-wide">
                    {FONTE_META[d.fonte].sistema}
                  </span>
                  {!desconhecido && d.daAncora !== undefined ? (
                    <span className="tabular">
                      {d.ehAncora && i > 0 ? "100%" : pct(d.daAncora)} {rotuloAncora}
                    </span>
                  ) : null}
                  {d.custoUnitario !== undefined ? (
                    <span className="tabular">{formatCurrency(d.custoUnitario)} cada</span>
                  ) : null}
                </div>

                {d.nota ? (
                  <p
                    className={cn(
                      "mt-1.5 text-xs leading-relaxed",
                      desconhecido ? "text-[var(--danger-text)]" : "text-muted-foreground",
                    )}
                  >
                    {d.nota}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
