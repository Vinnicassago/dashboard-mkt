import { Users, TrendingUp, Eye, Radio, Heart, ExternalLink, Percent, UserRound, Info, Sparkles, DollarSign } from "lucide-react";
import { KpiCard } from "@/components/kpi/kpi-card";
import { GoalBar } from "@/components/kpi/goal-bar";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { FunnelChart } from "@/components/charts/funnel-chart";
import { ChartCard } from "@/components/ui/chart-card";
import { HorizontalBars } from "@/components/charts/horizontal-bars";
import { EmptyState } from "@/components/ui/empty-state";
import { CHART } from "@/components/charts/colors";
import { getData } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { brandDef } from "@/lib/brands";
import { pageRange } from "@/lib/page-range";
import {
  awarenessKpis,
  buildOrganicFunnel,
  followerSeries,
  goalProgress,
  igAccountTotals,
  inRange,
  previousRange,
} from "@/lib/metrics";
import { absDelta, pctDelta } from "@/components/kpi/delta";
import { formatCompact, formatCurrency0, formatCurrencyOrDash, formatDecimal, formatInt, formatPercent } from "@/lib/format";

export default async function InstagramPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const brand = brandDef(await activeBrandSlug());
  const data = await getData(brand.slug);
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
  // Marca de awareness (krone): eficiência do investimento pago em seguidores.
  const aware = brand.type === "awareness" ? awarenessKpis(data, range) : null;

  const orgFunnel = buildOrganicFunnel(data.igAccountDaily, range);

  // Meta de seguidores: progresso + projeção linear pelo ritmo do período.
  const followersGoal = data.goals.find((g) => g.metric === "followers");
  const gp = followersGoal ? goalProgress(followersGoal, cur.followersEnd) : undefined;
  const windowDays = rows.length;
  const avgGain = windowDays > 1 ? cur.netNew / (windowDays - 1) : cur.netNew;
  const remaining = followersGoal ? Math.max(0, followersGoal.target - cur.followersEnd) : 0;
  const daysAtRate = avgGain > 0 ? Math.ceil(remaining / avgGain) : null;
  const goalOutlook = !followersGoal
    ? ""
    : gp?.onTrack
      ? "Meta batida 🎉"
      : avgGain > 0 && daysAtRate != null
        ? `Faltam ${formatInt(remaining)} · no ritmo de +${formatDecimal(avgGain, 1)}/dia, ~${daysAtRate} dias.`
        : `Faltam ${formatInt(remaining)} · sem crescimento no período para projetar.`;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard
          label="Seguidores"
          value={formatInt(cur.followersEnd)}
          Icon={Users}
          delta={absDelta(cur.netNew)}
        />
        {aware ? (
          <>
            <KpiCard
              label="Custo por seguidor"
              value={formatCurrencyOrDash(aware.costPerFollower)}
              Icon={Sparkles}
              hint="North Star"
              highlight
            />
            <KpiCard
              label="Custo / 1k alcance"
              value={formatCurrencyOrDash(aware.costPerReach)}
              Icon={Radio}
              hint="alcance da conta"
            />
            <KpiCard label="Investimento" value={formatCurrency0(aware.spend)} Icon={DollarSign} />
          </>
        ) : null}
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
        <ChartCard
          title="Funil orgânico do perfil"
          description="Alcance → visita ao perfil → novo seguidor. Onde perde: muito alcance e pouca visita = gancho fraco; muita visita e poucos seguidores = feed/prova social."
        >
          <FunnelChart stages={orgFunnel} />
        </ChartCard>
        {followersGoal && gp ? (
          <ChartCard title="Meta de seguidores" description={goalOutlook}>
            <GoalBar
              label="Seguidores"
              valueText={formatInt(cur.followersEnd)}
              targetText={formatInt(followersGoal.target)}
              pct={gp.pct}
              onTrack={gp.onTrack}
            />
          </ChartCard>
        ) : null}
      </div>

      {cur.hasReachSplit ? (
        <ChartCard
          title="Descoberta — alcance por tipo de conta"
          description={`${formatPercent(cur.discoveryRate)} do alcance foi de não-seguidores (gente nova).`}
        >
          <HorizontalBars
            data={[
              { label: "Seguidores", value: cur.reachFollowers, color: CHART.series[0] },
              { label: "Não-seguidores", value: cur.reachNonFollowers, color: CHART.series[1] },
            ]}
            valueFormat="compact"
          />
        </ChartCard>
      ) : null}

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
