import { Users, TrendingUp, Eye, Radio, Heart, ExternalLink, Percent, UserRound, Info } from "lucide-react";
import { KpiCard } from "@/components/kpi/kpi-card";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { ChartCard } from "@/components/ui/chart-card";
import { EmptyState } from "@/components/ui/empty-state";
import { CHART } from "@/components/charts/colors";
import { getData } from "@/lib/data/store";
import { pageRange } from "@/lib/page-range";
import { followerSeries, igAccountTotals, inRange, previousRange } from "@/lib/metrics";
import { absDelta, pctDelta } from "@/components/kpi/delta";
import { formatCompact, formatInt, formatPercent } from "@/lib/format";

export default async function InstagramPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const data = await getData();
  const { range } = pageRange(data, (await searchParams).range);

  const rows = data.igAccountDaily.filter((r) => inRange(r.date, range));
  const series = followerSeries(data.igAccountDaily, range);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Sem dados do Instagram no período"
        hint="A conta foi criada há pouco — insights podem levar até 48h para consolidar. Registre snapshots diários em Importar / Config."
      />
    );
  }

  const cur = igAccountTotals(data.igAccountDaily, range);
  const prev = range ? igAccountTotals(data.igAccountDaily, previousRange(range)) : undefined;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard
          label="Seguidores"
          value={formatInt(cur.followersEnd)}
          Icon={Users}
          delta={absDelta(cur.netNew)}
        />
        <KpiCard
          label="Alcance"
          value={formatCompact(cur.reach)}
          Icon={Radio}
          delta={prev ? pctDelta(cur.reach, prev.reach) : undefined}
        />
        <KpiCard
          label="Views"
          value={formatCompact(cur.views)}
          Icon={Eye}
          delta={prev ? pctDelta(cur.views, prev.views) : undefined}
        />
        <KpiCard
          label="Interações"
          value={formatCompact(cur.interactions)}
          Icon={Heart}
          delta={prev ? pctDelta(cur.interactions, prev.interactions) : undefined}
        />
        <KpiCard
          label="Visitas ao perfil"
          value={formatCompact(cur.profileViews)}
          Icon={UserRound}
          delta={prev ? pctDelta(cur.profileViews, prev.profileViews) : undefined}
        />
        <KpiCard
          label="Cliques no link"
          value={formatInt(cur.profileLinkTaps)}
          Icon={ExternalLink}
          delta={prev ? pctDelta(cur.profileLinkTaps, prev.profileLinkTaps) : undefined}
        />
        <KpiCard
          label="Taxa de clique no link"
          value={formatPercent(cur.linkTapRate)}
          Icon={Percent}
          hint="cliques ÷ visitas"
        />
        <KpiCard
          label="Engaj. da conta"
          value={formatPercent(cur.engagementRate)}
          Icon={TrendingUp}
          hint="interações ÷ alcance"
          delta={prev ? pctDelta(cur.engagementRate, prev.engagementRate) : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Seguidores" description="Total de seguidores ao longo do tempo.">
          <TimeSeriesChart
            data={series}
            series={[{ key: "followers", label: "Seguidores", color: CHART.series[0] }]}
            yFormat="int"
          />
        </ChartCard>
        <ChartCard title="Novos seguidores por dia" description="Crescimento líquido diário.">
          <TimeSeriesChart
            data={series}
            series={[{ key: "gain", label: "Novos seguidores", color: CHART.series[2] }]}
            yFormat="int"
          />
        </ChartCard>
      </div>

      <ChartCard title="Alcance e Views por dia" description="Quantas contas viram o conteúdo.">
        <TimeSeriesChart
          data={series}
          series={[
            { key: "reach", label: "Alcance", color: CHART.series[0] },
            { key: "views", label: "Views", color: CHART.series[1] },
          ]}
          yFormat="compact"
          valueFormat="int"
        />
      </ChartCard>

      <div className="flex items-start gap-2.5 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p>
          Dados demográficos (idade, cidade) e a série de seguidos/deixaram de seguir
          só ficam disponíveis com <span className="font-medium text-foreground">100+ seguidores</span>{" "}
          e podem levar até 48h — por isso não aparecem nos primeiros dias de uma conta nova.
        </p>
      </div>
    </div>
  );
}
