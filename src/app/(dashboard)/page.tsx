import { DollarSign, CalendarCheck, Target, UserPlus, Sparkles } from "lucide-react";
import { ExampleBanner } from "@/components/example-banner";
import { KpiCard, type KpiDelta } from "@/components/kpi/kpi-card";
import { ObjectiveSplitBar } from "@/components/kpi/objective-split";
import { GoalBar } from "@/components/kpi/goal-bar";
import { FunnelChart } from "@/components/charts/funnel-chart";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { ChartCard } from "@/components/ui/chart-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getData } from "@/lib/data/store";
import { pageRange } from "@/lib/page-range";
import {
  actualForGoal,
  buildFunnel,
  dailySeries,
  delta,
  goalProgress,
  overviewKpis,
  previousRange,
} from "@/lib/metrics";
import { buildInsights } from "@/lib/insights";
import {
  formatCurrency,
  formatCurrency0,
  formatInt,
  formatPercent,
} from "@/lib/format";
import type { GoalMetric } from "@/lib/types";
import { CHART } from "@/components/charts/colors";

function makeDelta(
  cur: number,
  prev: number | undefined,
  higherIsGood: boolean,
): KpiDelta | undefined {
  if (prev === undefined) return undefined;
  const d = delta(cur, prev);
  if (d.direction === "flat") return { text: "estável", direction: "flat", intent: "neutral" };
  const isGood = (d.direction === "up") === higherIsGood;
  return {
    text: formatPercent(Math.abs(d.pct), 0),
    direction: d.direction,
    intent: isGood ? "good" : "bad",
  };
}

const GOAL_LABEL: Record<GoalMetric, string> = {
  leads: "Leads",
  meetings: "Reuniões",
  cpl: "CPL",
  cpr: "Custo por reunião",
  spend: "Investimento",
  followers: "Seguidores",
};

function goalValueText(metric: GoalMetric, v: number): string {
  return metric === "cpl" || metric === "cpr" || metric === "spend"
    ? formatCurrency0(v)
    : formatInt(v);
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const data = await getData();
  const { range } = pageRange(data, (await searchParams).range);

  const k = overviewKpis(data, range);
  const prev = range ? overviewKpis(data, previousRange(range)) : undefined;
  const funnel = buildFunnel(data, range);
  const series = dailySeries(data, range);
  const insights = buildInsights(data, range);
  const hint = prev ? "vs. período anterior" : "no período";

  return (
    <div className="space-y-6">
      {data.isSeed ? <ExampleBanner /> : null}

      {/* Hero KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-5">
        <KpiCard
          label="Investimento"
          value={formatCurrency0(k.spend)}
          Icon={DollarSign}
          delta={makeDelta(k.spend, prev?.spend, true)}
          hint={hint}
        />
        <KpiCard
          label="Leads"
          value={formatInt(k.leads)}
          Icon={UserPlus}
          delta={makeDelta(k.leads, prev?.leads, true)}
          hint={hint}
        />
        <KpiCard
          label={k.hasDiscovery ? "CPL · conversão" : "CPL"}
          value={formatCurrency(k.cpl)}
          Icon={Target}
          delta={makeDelta(k.cpl, prev?.cpl, false)}
          hint={hint}
        />
        <KpiCard
          label="Reuniões agendadas"
          value={formatInt(k.meetings)}
          Icon={CalendarCheck}
          delta={makeDelta(k.meetings, prev?.meetings, true)}
          hint={hint}
          highlight
        />
        <KpiCard
          label="Custo por reunião"
          value={formatCurrency(k.cpr)}
          Icon={Sparkles}
          delta={makeDelta(k.cpr, prev?.cpr, false)}
          hint="North Star"
          highlight
        />
      </div>

      {/* Orçamento por objetivo — só aparece quando há gasto de descoberta */}
      {k.hasDiscovery ? (
        <Card>
          <CardHeader>
            <CardTitle>Orçamento por objetivo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ObjectiveSplitBar conversao={k.spendConversao} descoberta={k.spendDescoberta} />
            <p className="text-xs text-muted-foreground">
              CPL e Custo por reunião acima usam só o orçamento de conversão. Com a descoberta
              incluída (blended): CPL {formatCurrency(k.cplBlended)} · Custo por reunião{" "}
              {formatCurrency(k.cprBlended)}.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Funnel */}
      <ChartCard
        title="Funil da campanha"
        description="Impressões → Cliques → Leads → Reuniões, com a conversão entre etapas."
      >
        <FunnelChart stages={funnel} />
      </ChartCard>

      {/* Time series */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Investimento por dia" description="Ritmo de gasto (pacing).">
          <TimeSeriesChart
            data={series}
            series={[{ key: "spend", label: "Investimento", color: CHART.series[0] }]}
            yFormat="currency0"
            valueFormat="currency"
          />
        </ChartCard>
        <ChartCard title="Leads por dia" description="Cadastros gerados por dia.">
          <TimeSeriesChart
            data={series}
            series={[{ key: "leads", label: "Leads", color: CHART.series[2] }]}
            yFormat="int"
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="CPL por dia" description="Custo por lead ao longo do tempo.">
          <TimeSeriesChart
            data={series}
            series={[{ key: "cpl", label: "CPL", color: CHART.series[1], kind: "line" }]}
            yFormat="currency0"
            valueFormat="currency"
          />
        </ChartCard>

        <Card>
          <CardHeader>
            <CardTitle>Metas vs. realizado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.goals.map((goal) => {
              const actual = actualForGoal(goal, data, range);
              const gp = goalProgress(goal, actual);
              return (
                <GoalBar
                  key={`${goal.metric}-${goal.period}`}
                  label={GOAL_LABEL[goal.metric]}
                  valueText={goalValueText(goal.metric, actual)}
                  targetText={goalValueText(goal.metric, goal.target)}
                  pct={gp.pct}
                  onTrack={gp.onTrack}
                />
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Insights */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Leitura rápida
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {insights.map((text, i) => (
              <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
