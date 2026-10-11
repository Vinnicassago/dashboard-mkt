import type { FunilDescoberta as Descoberta } from "@/lib/funil";
import { formatCurrency, formatCurrency0, formatInt, formatIntComSinal, formatPercent } from "@/lib/format";

/**
 * O funil de descoberta: alcance → visitas ao perfil → seguidores, da conta do
 * Instagram no período. Escopo próprio: nada aqui divide a verba de conversão.
 */
export function FunilDescoberta({ funil }: { funil: Descoberta }) {
  if (funil.semDado) {
    return (
      <p className="text-sm text-muted-foreground">
        Sem leitura do Instagram no período — nenhum dia sincronizado. “—” não é zero: o perfil pode ter alcançado gente que o painel não viu.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {funil.etapas.map((e) => {
          const delta = e.anterior !== undefined && e.valor != null ? e.valor - e.anterior : undefined;
          return (
            <li key={e.key} className="rounded-lg border px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-sm font-medium">{e.label}</p>
                <p className="tabular text-xl font-semibold">
                  {e.valor == null ? "—" : e.key === "seguidores" ? formatIntComSinal(e.valor) : formatInt(e.valor)}
                  {delta !== undefined ? (
                    <span className="ml-2 text-xs font-medium text-muted-foreground" title="Diferença contra o período anterior, de mesmo tamanho">
                      {formatIntComSinal(delta)} vs. anterior
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="rounded border px-1.5 py-px text-[10px] uppercase tracking-wide">Instagram</span>
                {e.daAnterior !== undefined ? <span className="tabular">{formatPercent(e.daAnterior)} da anterior</span> : null}
                {e.custo ? (
                  <span className="tabular">
                    {formatCurrency(e.custo.valor)} {e.custo.rotulo}
                  </span>
                ) : null}
              </div>
              {e.nota ? <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{e.nota}</p> : null}
            </li>
          );
        })}
      </ol>
      {funil.extras.length > 0 ? (
        <dl className="grid grid-cols-2 gap-3 border-t pt-3 text-xs">
          {funil.extras.map((x) => (
            <div key={x.key}>
              <dt className="text-muted-foreground">{x.label}</dt>
              <dd className="tabular text-base font-semibold">
                {formatInt(x.valor)}
                {x.anterior !== undefined ? (
                  <span className="ml-1.5 text-xs font-medium text-muted-foreground">{formatIntComSinal(x.valor - x.anterior)}</span>
                ) : null}
              </dd>
              {x.nota ? <dd className="text-muted-foreground">{x.nota}</dd> : null}
            </div>
          ))}
        </dl>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {funil.dias} {funil.dias === 1 ? "dia" : "dias"} com dado no período
        {funil.investimentoDescoberta > 0 ? ` · ${formatCurrency0(funil.investimentoDescoberta)} de verba de descoberta` : " · sem verba de descoberta"}
      </p>
    </div>
  );
}
