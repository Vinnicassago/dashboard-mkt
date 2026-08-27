import { DollarSign, CalendarCheck, Target, UserPlus, Sparkles, Users, Radio, Heart, ExternalLink, MessageCircle } from "lucide-react";
import Link from "next/link";
import { ExampleBanner } from "@/components/example-banner";
import { KpiCard, type KpiDelta } from "@/components/kpi/kpi-card";
import { ObjectiveSplitBar } from "@/components/kpi/objective-split";
import { DataQualityCard } from "@/components/kpi/data-quality";
import { GoalBar } from "@/components/kpi/goal-bar";
import { absDelta, pctDelta } from "@/components/kpi/delta";
import { FunnelChart } from "@/components/charts/funnel-chart";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { ChartCard } from "@/components/ui/chart-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getData, getState } from "@/lib/data/store";
import { aiAnalysisKey } from "@/lib/data/backend";
import { activeBrandSlug } from "@/lib/active-brand";
import { brandDef } from "@/lib/brands";
import { pageRange } from "@/lib/page-range";
import { getTransferidos } from "@/lib/robo/client";
import {
  actualForGoal,
  awarenessKpis,
  buildFunnel,
  dailySeries,
  dataQualityChecks,
  delta,
  followerSeries,
  goalProgress,
  igAccountTotals,
  igEngagementSeries,
  overviewKpis,
  previousRange,
  type DataWarning,
  type DateRange,
} from "@/lib/metrics";
import { getLastSync } from "@/lib/meta/sync";
import { buildInsights } from "@/lib/insights";
import { buildRecommendations, type Recommendation } from "@/lib/recommendations";
import type { AiAnalysis, DashboardData } from "@/lib/types";
import { RecommendationsCard } from "@/components/kpi/recommendations";
import { AiAnalysisCard } from "@/components/kpi/ai-analysis";
import { isAiConfigured } from "@/lib/ai/config";
import { periodOf } from "@/lib/ai/briefing";
import { can } from "@/lib/auth/guard";
import { RANGE_PRESETS } from "@/lib/range";
import {
  formatCompact,
  formatCurrency,
  formatCurrency0,
  formatCurrencyOrDash,
  formatDecimal,
  formatInt,
  formatPercent,
  formatPercentValue,
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
  retencao_reels: "Retenção de reels",
  alcance_base: "Alcance sobre a base",
  saves_1k: "Salvos / 1k views",
  comentarios_post: "Coment. / post",
  compartilhamentos_post: "Compart. / post",
  posts_semana: "Posts / semana",
  conversas_dm: "Conversas de DM",
};

function goalValueText(metric: GoalMetric, v: number): string {
  if (metric === "cpl" || metric === "cpr" || metric === "spend") return formatCurrency0(v);
  // metas percentuais guardam VALOR percentual (40 = 40%)
  if (metric === "retencao_reels" || metric === "alcance_base") return formatPercentValue(v, 0);
  if (
    metric === "saves_1k" ||
    metric === "comentarios_post" ||
    metric === "compartilhamentos_post" ||
    metric === "posts_semana"
  )
    return formatDecimal(v, 1);
  return formatInt(v);
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const brand = brandDef(await activeBrandSlug());
  const data = await getData(brand.slug);
  const { range, rangeKey } = pageRange(data, (await searchParams).range);

  // Leads que o robô do WhatsApp qualificou e passou ao especialista no período.
  // Null quando o robô não está configurado — aí o card mantém o valor do store.
  const transferidos = await getTransferidos(range?.from, range?.to);

  // Leitura de IA guardada (Etapa 3). Só é buscada e exibida quando a camada de
  // IA está ligada — sem chave, o card nem existe.
  const aiEnabled = isAiConfigured();
  const analysis = aiEnabled ? await getState<AiAnalysis>(aiAnalysisKey(brand.slug)) : null;
  const canWrite = await can("data:write");
  const aiCard = aiEnabled ? (
    <AiAnalysisCard
      analysis={analysis}
      rangeKey={rangeKey}
      rangeLabel={RANGE_PRESETS.find((r) => r.key === rangeKey)?.label ?? "o período"}
      currentPeriod={periodOf(range)}
      canWrite={canWrite}
    />
  ) : null;

  const insights = buildInsights(data, range);
  const recs = buildRecommendations(data, range, new Date().toISOString());
  const hint = range ? "vs. período anterior" : "no período";

  const lastSync = await getLastSync();
  const warnings = dataQualityChecks(data, {
    nowIso: new Date().toISOString(),
    lastSyncAds: lastSync.ads,
  });

  // Marca de awareness (krone.capital): visão de crescimento de perfil, não de funil.
  if (brand.type === "awareness") {
    return (
      <AwarenessOverview data={data} range={range} recs={recs} insights={insights} warnings={warnings} hint={hint} aiCard={aiCard} />
    );
  }

  const k = overviewKpis(data, range);
  const prev = range ? overviewKpis(data, previousRange(range)) : undefined;
  const funnel = buildFunnel(data, range);
  const series = dailySeries(data, range);

  // Orgânico do perfil — o pago compra visita, mas é o orgânico que converte quem chega.
  const ig = igAccountTotals(data.igAccountDaily, range);
  const igPrev = range ? igAccountTotals(data.igAccountDaily, previousRange(range)) : undefined;
  const igDaily = igEngagementSeries(data.igAccountDaily, range);
  const hasOrganic = ig.days > 0;

  return (
    <div className="space-y-6">
      {data.isSeed ? <ExampleBanner /> : null}
      <DataQualityCard warnings={warnings} />

      {/* Hero KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-5">
        <KpiCard
          label="Investimento"
          value={formatCurrency0(k.spend)}
          Icon={DollarSign}
          delta={makeDelta(k.spend, prev?.spend, true)}
          hint={hint}
          spark={series.map((d) => d.spend)}
        />
        <KpiCard
          label="Leads"
          value={formatInt(k.leads)}
          Icon={UserPlus}
          delta={makeDelta(k.leads, prev?.leads, true)}
          hint={hint}
          spark={series.map((d) => d.leads)}
        />
        <KpiCard
          label={k.hasDiscovery ? "CPL · conversão" : "CPL"}
          value={formatCurrency(k.cpl)}
          Icon={Target}
          delta={makeDelta(k.cpl, prev?.cpl, false)}
          hint={hint}
        />
        <KpiCard
          label={transferidos == null ? "Reuniões agendadas" : "Transferidos ao especialista"}
          value={formatInt(transferidos ?? k.meetings)}
          Icon={CalendarCheck}
          delta={transferidos == null ? makeDelta(k.meetings, prev?.meetings, true) : undefined}
          hint={transferidos == null ? hint : "leads quentes entregues pelo robô"}
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

      {aiCard}

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

      {/* Orgânico do perfil — saúde da base que recebe o tráfego pago */}
      {hasOrganic ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold tracking-tight">
              Orgânico — {brand.handle}
            </h2>
            <Link
              href="/instagram"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-primary"
            >
              ver Instagram <ExternalLink className="size-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-5">
            <KpiCard
              label="Alcance orgânico"
              value={formatCompact(ig.reach)}
              Icon={Radio}
              delta={igPrev ? pctDelta(ig.reach, igPrev.reach) : undefined}
              hint={hint}
              spark={igDaily.map((d) => d.reach)}
            />
            <KpiCard
              label="Novos seguidores"
              value={`${ig.netNew >= 0 ? "+" : ""}${formatInt(ig.netNew)}`}
              Icon={Users}
              delta={igPrev ? pctDelta(ig.netNew, igPrev.netNew) : undefined}
              hint={hint}
            />
            <KpiCard
              label="Aquecimento da base"
              value={formatPercent(ig.engagementOnBase)}
              Icon={Heart}
              hint="interações/dia ÷ seguidores"
              delta={igPrev ? pctDelta(ig.engagementOnBase, igPrev.engagementOnBase) : undefined}
              spark={igDaily.map((d) => d.warmth)}
            />
            <KpiCard
              label="Conversas de DM"
              value={ig.hasDmData ? formatInt(ig.dmConversations) : "—"}
              Icon={MessageCircle}
              hint={ig.hasDmData ? "registro manual" : "registre no Config"}
              delta={
                igPrev && ig.hasDmData && igPrev.hasDmData
                  ? pctDelta(ig.dmConversations, igPrev.dmConversations)
                  : undefined
              }
            />
            <KpiCard
              label="Cliques no link da bio"
              value={formatInt(ig.profileLinkTaps)}
              Icon={ExternalLink}
              delta={igPrev ? pctDelta(ig.profileLinkTaps, igPrev.profileLinkTaps) : undefined}
              hint={`CTR da bio ${formatPercent(ig.linkTapRate)}`}
            />
          </div>
        </div>
      ) : null}

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
              if (actual == null) {
                // Sem dado para medir (ex.: retenção sem duração preenchida) —
                // um GoalBar em 0 leria como "0% da meta", que é outra coisa.
                return (
                  <div
                    key={`${goal.metric}-${goal.period}`}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="font-medium text-muted-foreground">
                      {GOAL_LABEL[goal.metric]}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      sem dado — registre no Config · meta{" "}
                      {goalValueText(goal.metric, goal.target)}
                    </span>
                  </div>
                );
              }
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

      {/* Próximas ações */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Próximas ações
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RecommendationsCard recs={recs} fallback={insights} />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Visão Geral de uma marca de awareness (krone.capital): crescimento de perfil,
 * custo por seguidor e alcance — sem funil de lead/CPR. Usa o bundle
 * `awarenessKpis` (Fase 2). Custos aparecem como "—" quando não há crescimento.
 */
function AwarenessOverview({
  data,
  range,
  recs,
  insights,
  warnings,
  hint,
  aiCard,
}: {
  data: DashboardData;
  range: DateRange | undefined;
  recs: Recommendation[];
  insights: string[];
  warnings: DataWarning[];
  hint: string;
  aiCard: React.ReactNode;
}) {
  const a = awarenessKpis(data, range);
  const prevA = range ? awarenessKpis(data, previousRange(range)) : undefined;
  const series = followerSeries(data.igAccountDaily, range);
  const followersGoal = data.goals.find((g) => g.metric === "followers");
  const gp = followersGoal ? goalProgress(followersGoal, a.followersEnd) : undefined;

  return (
    <div className="space-y-6">
      {data.isSeed ? <ExampleBanner /> : null}
      <DataQualityCard warnings={warnings} />

      {/* Hero KPIs de crescimento */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-5">
        <KpiCard
          label="Seguidores"
          value={formatInt(a.followersEnd)}
          Icon={Users}
          delta={absDelta(a.netNewFollowers)}
          hint={hint}
          highlight
        />
        <KpiCard
          label="Novos seguidores"
          value={`${a.netNewFollowers >= 0 ? "+" : ""}${formatInt(a.netNewFollowers)}`}
          Icon={UserPlus}
          delta={prevA ? pctDelta(a.netNewFollowers, prevA.netNewFollowers) : undefined}
          hint={hint}
        />
        <KpiCard
          label="Investimento"
          value={formatCurrency0(a.spend)}
          Icon={DollarSign}
          delta={prevA ? pctDelta(a.spend, prevA.spend) : undefined}
          hint={hint}
        />
        <KpiCard
          label="Custo por seguidor"
          value={formatCurrencyOrDash(a.costPerFollower)}
          Icon={Sparkles}
          hint="North Star"
          highlight
        />
        <KpiCard
          label="Custo / 1k alcance"
          value={formatCurrencyOrDash(a.costPerReach)}
          Icon={Radio}
          hint="alcance da conta"
        />
      </div>

      {aiCard}

      {/* Meta de seguidores */}
      {followersGoal && gp ? (
        <Card>
          <CardHeader>
            <CardTitle>Meta de seguidores</CardTitle>
          </CardHeader>
          <CardContent>
            <GoalBar
              label="Seguidores"
              valueText={formatInt(a.followersEnd)}
              targetText={formatInt(followersGoal.target)}
              pct={gp.pct}
              onTrack={gp.onTrack}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* Crescimento */}
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

      {/* Próximas ações */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Próximas ações
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RecommendationsCard recs={recs} fallback={insights} />
        </CardContent>
      </Card>
    </div>
  );
}
