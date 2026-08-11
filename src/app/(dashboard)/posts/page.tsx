import {
  FileText,
  Radio,
  Heart,
  Bookmark,
  Share2,
  MessageCircle,
  Clock,
  Users,
  CalendarDays,
  AlertTriangle,
} from "lucide-react";
import { KpiCard } from "@/components/kpi/kpi-card";
import { PostsTable } from "@/components/tables/posts-table";
import { FormatBreakdown } from "@/components/instagram/format-breakdown";
import { HorizontalBars } from "@/components/charts/horizontal-bars";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartCard } from "@/components/ui/chart-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CHART } from "@/components/charts/colors";
import { getData } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { pageRange } from "@/lib/page-range";
import {
  aggregatePostPerformance,
  ctaDistribution,
  pillarPerformance,
  postPerformance,
  formatPerformance,
  postingCadence,
  reelWatchSeries,
  weekdayPerformance,
  previousRange,
} from "@/lib/metrics";
import { pctDelta } from "@/components/kpi/delta";
import {
  formatCompact,
  formatDateShort,
  formatDecimal,
  formatDuration,
  formatInt,
  formatPercent,
} from "@/lib/format";

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const data = await getData(await activeBrandSlug());
  const { range } = pageRange(data, (await searchParams).range);

  const posts = postPerformance(data.igPosts, range, data.igAccountDaily);

  if (posts.length === 0) {
    return (
      <EmptyState
        title="Nenhum post no período"
        hint="Publique conteúdo e registre os insights para acompanhar o desempenho aqui."
        Icon={FileText}
      />
    );
  }

  const cur = aggregatePostPerformance(posts);
  const prev = range
    ? aggregatePostPerformance(
        postPerformance(data.igPosts, previousRange(range), data.igAccountDaily),
      )
    : undefined;

  const formats = formatPerformance(data.igPosts, range);
  // Campeão = melhor formato COM amostra confiável (a lista vem ordenada por engajamento).
  const champion = formats.find((f) => f.sampleOk) ?? formats[0];

  const cadence = postingCadence(data.igPosts, range, new Date().toISOString());
  const reelSeries = reelWatchSeries(data.igPosts, range);
  const topReels = [...posts]
    .filter((p) => p.type === "reel" && p.avgWatchTime != null)
    .sort((a, b) => (b.avgWatchTime ?? 0) - (a.avgWatchTime ?? 0))
    .slice(0, 5)
    .map((p, i) => ({
      label: p.caption.length > 32 ? `${p.caption.slice(0, 32)}…` : p.caption,
      value: p.avgWatchTime ?? 0,
      color: i === 0 ? CHART.good : CHART.series[0],
    }));

  // CTA e pilar: onde o diagnóstico manda racionar DM e cortar card de frase.
  const ctas = ctaDistribution(posts);
  const ctaBars = ctas.map((c) => ({
    label: `${c.label} · ${c.count} post${c.count > 1 ? "s" : ""}`,
    value: c.count,
    color: c.cta === "dm" && cur.dmCtaShare > 0.25 ? CHART.critical : CHART.series[0],
  }));
  const pillars = pillarPerformance(data.igPosts, range);
  const pillarBars = pillars.map((p, i) => ({
    label: `${p.pillar} · ${p.count} post${p.count > 1 ? "s" : ""}`,
    value: p.avgEngagement,
    color: i === 0 && p.sampleOk ? CHART.good : CHART.series[0],
  }));

  const byWeekday = [...weekdayPerformance(data.igPosts, range)].sort(
    (a, b) => b.avgEngagement - a.avgEngagement,
  );
  // Verde no melhor dia COM amostra confiável (dias de 1 post não coroam).
  const bestWeekday = byWeekday.find((w) => w.sampleOk);
  const weekdayBars = byWeekday.map((w) => ({
    label: `${w.label} · ${w.count} post${w.count > 1 ? "s" : ""}`,
    value: w.avgEngagement,
    color: w === bestWeekday ? CHART.good : CHART.series[0],
  }));
  const weekdayReliable = bestWeekday !== undefined;

  return (
    <div className="space-y-6">
      {/* Métricas-mestre do orgânico: sinais que compram alcance, não views */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Posts" value={formatInt(cur.count)} Icon={FileText} />
        <KpiCard
          label="Alcance médio"
          value={formatCompact(cur.avgReach)}
          Icon={Radio}
          delta={prev ? pctDelta(cur.avgReach, prev.avgReach) : undefined}
        />
        <KpiCard
          label="Alcance sobre a base"
          value={cur.avgReachOnBase != null ? formatPercent(cur.avgReachOnBase) : "—"}
          Icon={Users}
          hint="alcance por post ÷ seguidores · meta 35%+"
          delta={
            prev && cur.avgReachOnBase != null && prev.avgReachOnBase != null
              ? pctDelta(cur.avgReachOnBase, prev.avgReachOnBase)
              : undefined
          }
        />
        <KpiCard
          label="Engaj. médio"
          value={formatPercent(cur.avgEr)}
          Icon={Heart}
          delta={prev ? pctDelta(cur.avgEr, prev.avgEr) : undefined}
        />
        <KpiCard
          label="Salvos / 1k views"
          value={formatDecimal(cur.savesPer1k, 1)}
          Icon={Bookmark}
          hint="Σ salvos ÷ Σ views · meta 8+"
          delta={prev ? pctDelta(cur.savesPer1k, prev.savesPer1k) : undefined}
        />
        <KpiCard
          label="Compart. / post"
          value={formatDecimal(cur.sharesPerPost, 1)}
          Icon={Share2}
          hint="meta 5+"
          delta={prev ? pctDelta(cur.sharesPerPost, prev.sharesPerPost) : undefined}
        />
        <KpiCard
          label="Coment. / post"
          value={formatDecimal(cur.commentsPerPost, 1)}
          Icon={MessageCircle}
          hint="meta 8+"
          delta={prev ? pctDelta(cur.commentsPerPost, prev.commentsPerPost) : undefined}
        />
        <KpiCard
          label="Retenção média (reels)"
          value={
            cur.avgRetention != null
              ? formatPercent(cur.avgRetention)
              : cur.avgWatchTime != null
                ? formatDuration(cur.avgWatchTime)
                : "—"
          }
          Icon={Clock}
          hint={
            cur.avgRetention != null
              ? "assistido ÷ duração · meta 40%"
              : "tempo assistido — informe a duração no Config p/ ver %"
          }
          delta={
            prev && cur.avgRetention != null && prev.avgRetention != null
              ? pctDelta(cur.avgRetention, prev.avgRetention)
              : prev && cur.avgRetention == null && cur.avgWatchTime != null && prev.avgWatchTime != null
                ? pctDelta(cur.avgWatchTime, prev.avgWatchTime)
                : undefined
          }
        />
      </div>

      {/* Cadência de publicação */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-muted-foreground" />
              <p className="text-sm font-medium">Cadência de publicação</p>
            </div>
            <CadenceStat label="Posts / semana" value={formatDecimal(cadence.postsPerWeek, 1)} />
            <CadenceStat
              label="Maior intervalo"
              value={`${formatInt(cadence.maxGapDays)} dia${cadence.maxGapDays === 1 ? "" : "s"}`}
            />
            <CadenceStat
              label="Último post"
              value={
                cadence.daysSinceLast === 0
                  ? "hoje"
                  : `há ${formatInt(cadence.daysSinceLast)} dia${cadence.daysSinceLast === 1 ? "" : "s"}`
              }
            />
          </div>
          {cadence.maxSameDay >= 3 && cadence.busiestDay ? (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--danger-text)]" />
              <span>
                {formatInt(cadence.maxSameDay)} posts no mesmo dia (
                {formatDateShort(cadence.busiestDay)}) — publicações no mesmo dia competem entre si
                e canibalizam a entrega inicial. Espace 1 por dia.
              </span>
            </p>
          ) : null}
        </CardContent>
      </Card>

      {champion && champion.sampleOk ? (
        <Card>
          <CardContent className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                Formato pra priorizar na próxima semana
              </p>
              <p className="font-semibold">
                {champion.label}{" "}
                <span className="font-normal text-muted-foreground">— melhor engajamento</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge variant="good">{formatPercent(champion.avgEngagement)} engaj.</Badge>
              <span className="tabular text-muted-foreground">
                {formatCompact(champion.avgReach)} alcance médio
              </span>
              <span className="tabular text-muted-foreground">
                {formatPercent(champion.saveRate)} salvam.
              </span>
            </div>
          </CardContent>
        </Card>
      ) : champion ? (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">
            Ainda sem formato campeão — amostra pequena ({champion.count} post
            {champion.count > 1 ? "s" : ""} no melhor formato). Publique mais para comparar com
            confiança.
          </CardContent>
        </Card>
      ) : null}

      {/* Retenção de reels: a métrica que compra alcance de graça */}
      {reelSeries.length >= 2 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Retenção de reels"
            description="Tempo médio assistido por reel (linha = média móvel de 3). Subindo = o gancho está melhorando."
          >
            <TimeSeriesChart
              data={reelSeries}
              series={[
                { key: "avgWatchTime", label: "Tempo assistido", color: CHART.series[0] },
                { key: "movingAvg", label: "Média móvel", color: CHART.series[1], kind: "line" },
              ]}
              yFormat="duration"
            />
          </ChartCard>
          {topReels.length > 1 ? (
            <ChartCard
              title="Reels que mais retêm"
              description="Tempo médio assistido (verde = melhor). Estude o gancho desses."
            >
              <HorizontalBars data={topReels} valueFormat="duration" />
            </ChartCard>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-base font-semibold tracking-tight">Desempenho por formato</h2>
        <FormatBreakdown formats={formats} />
      </div>

      {/* CTA e pilar/série — a arquitetura de pedido e a taxonomia da grade */}
      <div className="grid gap-4 lg:grid-cols-2">
        {ctaBars.length > 1 ? (
          <ChartCard
            title="CTA pedido nos posts"
            description={`Regra do diagnóstico: DM em no máximo 1 a cada 4 posts (hoje ${formatPercent(cur.dmCtaShare, 0)}). Vermelho = excesso.`}
          >
            <HorizontalBars data={ctaBars} valueFormat="int" />
          </ChartCard>
        ) : null}
        {pillarBars.length > 0 ? (
          <ChartCard
            title="Engajamento por pilar / série"
            description="Séries taggeadas no Config (verde = melhor com amostra confiável). Posts sem tag ficam fora."
          >
            <HorizontalBars data={pillarBars} valueFormat="percent" />
          </ChartCard>
        ) : null}
      </div>

      {byWeekday.length > 1 && weekdayReliable ? (
        <ChartCard
          title="Melhor dia para postar"
          description="Engajamento médio por dia da semana (verde = melhor; dias com 1 post não contam como melhor)."
        >
          <HorizontalBars data={weekdayBars} valueFormat="percent" />
        </ChartCard>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Desempenho por post</CardTitle>
        </CardHeader>
        <CardContent>
          <PostsTable rows={posts} />
        </CardContent>
      </Card>
    </div>
  );
}

function CadenceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="tabular text-sm font-semibold">{value}</span>
    </div>
  );
}
