import { Award, TrendingDown, AlertTriangle } from "lucide-react";
import { CreativesTable } from "@/components/tables/creatives-table";
import { HorizontalBars } from "@/components/charts/horizontal-bars";
import { ChartCard } from "@/components/ui/chart-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { CHART } from "@/components/charts/colors";
import { getData } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { pageRange } from "@/lib/page-range";
import { creativePerformance } from "@/lib/metrics";
import { formatCurrency, formatPercent } from "@/lib/format";

function short(name: string, max = 24): string {
  return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

export default async function CriativosPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const data = await getData(await activeBrandSlug());
  const { range } = pageRange(data, (await searchParams).range);

  const perf = creativePerformance(data, range);
  const withLeads = perf.filter((c) => c.leads > 0);

  // Amostra mínima: só elege "melhor CPL" entre criativos com leads suficientes,
  // para não recomendar escalar um vencedor de ruído (1 lead a R$10 "vence" 40 a R$35).
  const MIN_LEADS = 5;
  const enough = withLeads.filter((c) => c.leads >= MIN_LEADS);
  const bestCpl = [...(enough.length ? enough : withLeads)].sort((a, b) => a.cpl - b.cpl)[0];
  const bestCplLowSample = bestCpl != null && bestCpl.leads < MIN_LEADS;
  const bestCtr = [...perf].sort((a, b) => b.ctr - a.ctr)[0];
  const fatigued = perf.filter((c) => c.fatigue.level === "fadigado");

  const cplBars = [...withLeads]
    .sort((a, b) => a.cpl - b.cpl)
    .map((c) => ({ label: short(c.name), value: c.cpl }));
  const ctrBars = [...perf]
    .sort((a, b) => b.ctr - a.ctr)
    .map((c) => ({ label: short(c.name), value: c.ctr }));

  if (perf.length === 0) {
    return (
      <EmptyState
        title="Sem dados de criativos no período"
        hint="Importe o relatório de anúncios em Importar / Config para comparar os criativos."
      />
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Compare os criativos para escalar o que traz reunião barata e pausar o que
        só gasta. Ordene a tabela por qualquer coluna.
      </p>

      {fatigued.length > 0 ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-[var(--danger-text)]/30 bg-[var(--danger-text)]/[0.04] px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--danger-text)]" />
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">
              {fatigued.length} criativo(s) fadigando:
            </span>{" "}
            {fatigued.map((c) => c.name).join(", ")}. Renove a arte antes que o custo
            dispare — a fadiga infla o CPL e, na cascata, o custo por reunião.
          </p>
        </div>
      ) : null}

      {/* Highlights */}
      <div className="grid gap-4 sm:grid-cols-2">
        {bestCpl ? (
          <Card>
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex size-10 items-center justify-center rounded-lg bg-[var(--good)]/12 text-[var(--good)]">
                <Award className="size-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Melhor CPL</p>
                <p className="font-semibold">{bestCpl.name}</p>
                <p className="text-sm text-muted-foreground">
                  {formatCurrency(bestCpl.cpl)} por lead · {bestCpl.leads} leads · {bestCpl.meetings} reuniões
                </p>
                {bestCplLowSample ? (
                  <p className="mt-0.5 text-xs text-[var(--danger-text)]">
                    Amostra pequena ({bestCpl.leads} leads) — confirme antes de escalar.
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ) : null}
        {bestCtr ? (
          <Card>
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <TrendingDown className="size-5 rotate-180" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Maior CTR</p>
                <p className="font-semibold">{bestCtr.name}</p>
                <p className="text-sm text-muted-foreground">
                  {formatPercent(bestCtr.ctr)} de cliques
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Comparison bars */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="CPL por criativo" description="Menor é melhor.">
          {cplBars.length ? (
            <HorizontalBars data={cplBars} valueFormat="currency" />
          ) : (
            <EmptyState title="Ainda sem leads por criativo" />
          )}
        </ChartCard>
        <ChartCard title="CTR por criativo" description="Cliques no link ÷ impressões.">
          <HorizontalBars data={ctrBars} valueFormat="percent" barColor={CHART.series[1]} />
        </ChartCard>
      </div>

      {/* Full table */}
      <Card>
        <CardHeader>
          <CardTitle>Todos os criativos</CardTitle>
        </CardHeader>
        <CardContent>
          <CreativesTable rows={perf} />
        </CardContent>
      </Card>
    </div>
  );
}
