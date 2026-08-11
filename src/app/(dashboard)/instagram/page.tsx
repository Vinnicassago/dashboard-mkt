import { Users, TrendingUp, Eye, Radio, Heart, ExternalLink, Percent, UserRound, Info, Sparkles, DollarSign, MessageCircle } from "lucide-react";
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
  buildProfileClickFunnel,
  followerSeries,
  goalProgress,
  igAccountTotals,
  igEngagementSeries,
  inRange,
  previousRange,
  weeklyDmSeries,
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
  const clickFunnel = buildProfileClickFunnel(data.igAccountDaily, range);
  const engagementDaily = igEngagementSeries(data.igAccountDaily, range);
  const dmWeeks = weeklyDmSeries(data.igAccountDaily, range);

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
        <KpiCard
          label="Alcance diário sobre a base"
          value={formatPercent(cur.reachRateOnBase)}
          Icon={Users}
          hint="alcance/dia ÷ seguidores · saudável 30%+"
          delta={prev ? pctDelta(cur.reachRateOnBase, prev.reachRateOnBase) : undefined}
        />
        <KpiCard
          label="Aquecimento da base"
          value={formatPercent(cur.engagementOnBase)}
          Icon={Heart}
          hint="interações/dia ÷ seguidores"
          delta={prev ? pctDelta(cur.engagementOnBase, prev.engagementOnBase) : undefined}
        />
        <KpiCard
          label="Conversas de DM"
          value={cur.hasDmData ? formatInt(cur.dmConversations) : "—"}
          Icon={MessageCircle}
          hint={cur.hasDmData ? "registro manual" : "registre no Config"}
          delta={
            prev && cur.hasDmData && prev.hasDmData
              ? pctDelta(cur.dmConversations, prev.dmConversations)
              : undefined
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Funil orgânico do perfil"
          description="Alcance → visita ao perfil → novo seguidor. Onde perde: muito alcance e pouca visita = gancho fraco; muita visita e poucos seguidores = feed/prova social."
        >
          <FunnelChart stages={orgFunnel} />
        </ChartCard>
        <ChartCard
          title="Funil do link da bio"
          description={`Views → visita ao perfil → clique no link. CTR da bio (cliques ÷ visitas): ${formatPercent(cur.linkTapRate)}.`}
        >
          <FunnelChart stages={clickFunnel} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
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
        <ChartCard
          title="Engajamento sobre o alcance"
          description="Interações ÷ alcance do dia — qualidade do conteúdo para quem o viu."
        >
          <TimeSeriesChart
            data={engagementDaily}
            series={[
              { key: "engagementRate", label: "Sobre o alcance", color: CHART.series[0], kind: "line" },
            ]}
            yFormat="percent"
          />
        </ChartCard>
        <ChartCard
          title="Aquecimento da base por dia"
          description="Interações ÷ seguidores — a base fria esquentando (ou não)."
        >
          <TimeSeriesChart
            data={engagementDaily}
            series={[
              { key: "warmth", label: "Sobre a base", color: CHART.series[1], kind: "line" },
            ]}
            yFormat="percent"
          />
        </ChartCard>
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

      {dmWeeks.length > 0 ? (
        <ChartCard
          title="Conversas de DM por semana"
          description="A métrica de negócio do perfil (registro manual no Config — a API não expõe DMs)."
        >
          <HorizontalBars
            data={dmWeeks.map((w) => ({
              label: `Semana de ${w.label}`,
              value: w.conversations,
              color: CHART.series[0],
            }))}
            valueFormat="int"
          />
        </ChartCard>
      ) : null}

      <div className="flex items-start gap-2.5 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
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
