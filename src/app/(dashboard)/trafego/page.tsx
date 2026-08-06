import {
  DollarSign,
  Eye,
  MousePointerClick,
  Percent,
  Radio,
  Target,
  UserPlus,
  Users,
} from "lucide-react";
import { KpiCard } from "@/components/kpi/kpi-card";
import { ObjectiveSplitBar } from "@/components/kpi/objective-split";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { ChartCard } from "@/components/ui/chart-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CHART } from "@/components/charts/colors";
import { getData } from "@/lib/data/store";
import { pageRange } from "@/lib/page-range";
import {
  adKpis,
  dailySeries,
  filterAds,
  groupBy,
  objectiveBreakdown,
  OBJECTIVE_LABEL,
} from "@/lib/metrics";
import {
  formatCurrency,
  formatCurrency0,
  formatDecimal,
  formatInt,
  formatPercent,
} from "@/lib/format";
import { cn } from "@/lib/utils";

/** Uma linha rótulo → valor dentro das colunas por objetivo. */
function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("tabular text-sm font-medium", highlight && "text-primary")}>
        {value}
      </span>
    </div>
  );
}

const BUCKET_DOT: Record<"conversao" | "descoberta", string> = {
  conversao: CHART.series[0],
  descoberta: CHART.series[1],
};

export default async function TrafegoPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const data = await getData();
  const { range } = pageRange(data, (await searchParams).range);

  const ads = filterAds(data.adDaily, range);
  const k = adKpis(ads);
  const series = dailySeries(data, range);
  const byAdset = groupBy(ads, (r) => r.adset);
  const obj = objectiveBreakdown(data, range);

  const spentAllTime = data.adDaily.reduce((s, r) => s + r.spend, 0);
  const budget = data.campaign.budgetTotal;
  const pacing = budget > 0 ? Math.min(1, spentAllTime / budget) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Investimento" value={formatCurrency0(k.spend)} Icon={DollarSign} />
        <KpiCard label="Impressões" value={formatInt(k.impressions)} Icon={Eye} />
        <KpiCard label="Alcance" value={formatInt(k.reach)} Icon={Users} />
        <KpiCard label="Cliques" value={formatInt(k.clicks)} Icon={MousePointerClick} />
        <KpiCard label="CTR" value={formatPercent(k.ctr)} Icon={Percent} />
        <KpiCard
          label="CPL"
          value={formatCurrency(obj.conversao.cpl)}
          Icon={Target}
          hint={obj.hasDiscovery ? "só conversão" : undefined}
        />
      </div>

      {/* Orçamento por objetivo — a separação Conversão × Descoberta */}
      <Card>
        <CardHeader>
          <CardTitle>Orçamento por objetivo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <ObjectiveSplitBar
            conversao={obj.conversao.spend}
            descoberta={obj.descoberta.spend}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Conversão */}
            <div className="space-y-2 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <UserPlus className="size-4 text-primary" />
                <p className="font-medium">Conversão — geração de leads</p>
              </div>
              <Stat label="Investimento" value={formatCurrency0(obj.conversao.spend)} />
              <Stat label="Leads" value={formatInt(obj.conversao.leads)} />
              <Stat label="CPL" value={formatCurrency(obj.conversao.cpl)} highlight />
              <Stat label="Reuniões" value={formatInt(obj.conversao.meetings)} />
              <Stat label="Custo por reunião" value={formatCurrency(obj.conversao.cpr)} highlight />
            </div>

            {/* Descoberta */}
            <div className="space-y-2 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <Radio className="size-4 text-muted-foreground" />
                <p className="font-medium">Descoberta — alcance &amp; seguidores</p>
              </div>
              {obj.hasDiscovery ? (
                <>
                  <Stat label="Investimento" value={formatCurrency0(obj.descoberta.spend)} />
                  <Stat label="Alcance" value={formatInt(obj.descoberta.reach)} />
                  <Stat label="CPM" value={formatCurrency(obj.descoberta.cpm)} />
                  <Stat
                    label="Custo / mil alcançados"
                    value={formatCurrency(obj.descoberta.costPerReach)}
                  />
                  <Stat
                    label="Seguidores no período"
                    value={`+${formatInt(obj.netNewFollowers)}`}
                  />
                  <Stat
                    label="Custo / seguidor (est.)"
                    value={formatCurrency(obj.costPerFollowerEst)}
                    highlight
                  />
                  <p className="pt-1 text-xs text-muted-foreground">
                    Estimativa: seguidores são da conta (orgânico + pago); a Meta não atribui
                    seguidores por anúncio.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum anúncio de descoberta no período. Todo o orçamento foi para conversão.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Budget pacing */}
      <Card>
        <CardHeader>
          <CardTitle>Budget da campanha</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="tabular text-2xl font-semibold">{formatCurrency0(spentAllTime)}</span>
            <span className="text-muted-foreground">
              de {formatCurrency0(budget)} · {formatPercent(pacing, 0)} consumido
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-foreground/[0.07]">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pacing * 100}%` }} />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span>CPM {formatCurrency(k.cpm)}</span>
            <span>CPC {formatCurrency(k.cpc)}</span>
            <span>Frequência {formatDecimal(k.frequency, 2)}</span>
            <span>Budget diário {formatCurrency0(data.campaign.dailyBudget ?? 0)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Series */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Investimento por dia" description="Pacing diário de gasto.">
          <TimeSeriesChart
            data={series}
            series={[{ key: "spend", label: "Investimento", color: CHART.series[0] }]}
            yFormat="currency0"
            valueFormat="currency"
          />
        </ChartCard>
        <ChartCard title="Cliques por dia" description="Cliques no link do anúncio.">
          <TimeSeriesChart
            data={series}
            series={[{ key: "clicks", label: "Cliques", color: CHART.series[2] }]}
            yFormat="int"
          />
        </ChartCard>
      </div>

      {/* Per-adset table */}
      <Card>
        <CardHeader>
          <CardTitle>Por conjunto de anúncios</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Conjunto</TH>
                <TH>Objetivo</TH>
                <TH className="text-right">Gasto</TH>
                <TH className="text-right">Impressões</TH>
                <TH className="text-right">Cliques</TH>
                <TH className="text-right">CTR</TH>
                <TH className="text-right">Leads</TH>
                <TH className="text-right">CPL</TH>
              </TR>
            </THead>
            <TBody>
              {byAdset.map((g) => (
                <TR key={g.key}>
                  <TD className="font-medium">{g.key}</TD>
                  <TD>
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: BUCKET_DOT[g.bucket] }}
                      />
                      {OBJECTIVE_LABEL[g.bucket]}
                    </span>
                  </TD>
                  <TD className="text-right tabular">{formatCurrency0(g.spend)}</TD>
                  <TD className="text-right tabular">{formatInt(g.impressions)}</TD>
                  <TD className="text-right tabular">{formatInt(g.clicks)}</TD>
                  <TD className="text-right tabular">{formatPercent(g.ctr)}</TD>
                  <TD className="text-right tabular">{formatInt(g.leads)}</TD>
                  <TD className="text-right tabular">
                    {g.bucket === "conversao" ? formatCurrency(g.cpl) : "—"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
