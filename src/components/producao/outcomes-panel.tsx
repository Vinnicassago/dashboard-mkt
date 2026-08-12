import { TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { OutcomeReport } from "@/lib/content/outcomes";
import { formatCompact, formatDateShort, formatDecimal, formatInt, formatPercent } from "@/lib/format";

/**
 * Previsto × realizado. Server component — tudo já vem calculado pelo módulo
 * puro. A regra de ouro aqui é NÃO concluir cedo: com poucos pares a tela mostra
 * só a lista, porque uma "descoberta" que o próximo post derruba é pior que
 * nenhuma.
 */
export function OutcomesPanel({ report }: { report: OutcomeReport }) {
  if (report.pairs.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-1 p-5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <TrendingUp className="size-4 text-muted-foreground" />
            Previsto × realizado
          </p>
          <p className="text-sm text-muted-foreground">
            Nenhuma peça vinculada ao post que ela virou. Ao publicar, vincule a peça no editor —
            é o que permite descobrir quais regras do guia realmente predizem alcance neste
            perfil.
          </p>
        </CardContent>
      </Card>
    );
  }

  const confiaveis = report.porRegra.filter((r) => r.sampleOk);

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <TrendingUp className="size-4 text-muted-foreground" />
          <p className="text-sm font-medium">Previsto × realizado</p>
          <Badge variant={report.sampleOk ? "good" : "muted"}>
            {report.pairs.length} peça(s) vinculada(s)
          </Badge>
          {report.correlacaoNotaAlcance != null ? (
            <span className="text-xs text-muted-foreground">
              correlação nota × alcance: {formatDecimal(report.correlacaoNotaAlcance, 2)}
            </span>
          ) : null}
        </div>

        {!report.sampleOk ? (
          <p className="rounded-lg bg-foreground/[0.04] px-3 py-2 text-xs text-muted-foreground">
            Amostra pequena: com menos de {report.minSample} peças vinculadas, qualquer diferença
            aqui é ruído. A tabela abaixo já vale como registro; as conclusões aparecem quando
            houver base.
          </p>
        ) : null}

        {/* ---- por faixa de nota ---- */}
        {report.sampleOk && report.porFaixaDeNota.length > 1 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Desempenho por nota do validador
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {report.porFaixaDeNota.map((b) => (
                <div key={b.faixa} className="rounded-lg border p-2.5">
                  <p className="text-xs text-muted-foreground">Nota {b.faixa}</p>
                  <p className="tabular text-sm font-semibold">
                    {formatCompact(b.alcanceMedio)} alcance
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {b.n} peça(s) · {formatPercent(b.engajamentoMedio)} engaj. ·{" "}
                    {formatDecimal(b.salvos1kMedio, 1)} salvos/1k
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* ---- por regra ---- */}
        {confiaveis.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Cumprir a regra rendeu mais alcance?
            </p>
            <ul className="space-y-1.5">
              {confiaveis.map((r) => {
                const ganho = r.lift > 1;
                const forte = r.lift >= 1.3 || r.lift <= 0.77;
                return (
                  <li
                    key={r.ruleId}
                    className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border p-2.5"
                  >
                    <span className="min-w-0 text-sm">{r.label}</span>
                    <span className="flex items-center gap-2 text-xs">
                      <span className="tabular text-muted-foreground">
                        {formatCompact(r.alcanceMedioCumpriu)} vs{" "}
                        {formatCompact(r.alcanceMedioViolou)}
                      </span>
                      <Badge variant={!forte ? "muted" : ganho ? "good" : "critical"}>
                        {formatDecimal(r.lift, 1)}×
                      </Badge>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-[11px] text-muted-foreground">
              Alcance médio de quem cumpriu vs quem violou. Acima de 1,0 = cumprir rendeu mais.
              Só aparecem regras com pelo menos 2 peças de cada lado.
            </p>
          </div>
        ) : report.sampleOk ? (
          <p className="text-xs text-muted-foreground">
            Ainda não há regra com peças suficientes dos dois lados (cumprindo e violando) para
            comparar.
          </p>
        ) : null}

        {/* ---- pares ---- */}
        <div className="space-y-1.5 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">Peças publicadas</p>
          <ul className="space-y-1">
            {report.pairs.map((p) => (
              <li
                key={p.draftId}
                className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  {p.hookText || "(sem gancho)"}
                  <span className="text-muted-foreground">
                    {" "}
                    · {formatDateShort(p.publishedAt.slice(0, 10))}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant={p.score >= 90 ? "good" : p.score >= 70 ? "warning" : "critical"}>
                    {p.score}
                  </Badge>
                  <span className="tabular">{formatInt(p.reach)} alcance</span>
                  {p.retention != null ? (
                    <span className="tabular">{formatPercent(p.retention, 0)} ret.</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
