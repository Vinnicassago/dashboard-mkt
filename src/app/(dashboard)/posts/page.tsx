import { FileText, Radio, Heart, Bookmark, Share2 } from "lucide-react";
import { KpiCard } from "@/components/kpi/kpi-card";
import { PostsTable } from "@/components/tables/posts-table";
import { FormatBreakdown } from "@/components/instagram/format-breakdown";
import { HorizontalBars } from "@/components/charts/horizontal-bars";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartCard } from "@/components/ui/chart-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { CHART } from "@/components/charts/colors";
import { getData } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { pageRange } from "@/lib/page-range";
import {
  postPerformance,
  formatPerformance,
  weekdayPerformance,
  previousRange,
  type PostPerf,
} from "@/lib/metrics";
import { pctDelta } from "@/components/kpi/delta";
import { formatCompact, formatInt, formatPercent } from "@/lib/format";

function aggregate(list: PostPerf[]) {
  const reach = list.reduce((s, p) => s + p.reach, 0);
  const saved = list.reduce((s, p) => s + p.saved, 0);
  const shares = list.reduce((s, p) => s + p.shares, 0);
  const n = list.length;
  return {
    count: n,
    reach,
    avgReach: n ? reach / n : 0,
    avgEr: n ? list.reduce((s, p) => s + p.engagementRate, 0) / n : 0,
    saveRate: reach > 0 ? saved / reach : 0,
    shareRate: reach > 0 ? shares / reach : 0,
  };
}

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const data = await getData(await activeBrandSlug());
  const { range } = pageRange(data, (await searchParams).range);

  const posts = postPerformance(data.igPosts, range);

  if (posts.length === 0) {
    return (
      <EmptyState
        title="Nenhum post no período"
        hint="Publique conteúdo e registre os insights para acompanhar o desempenho aqui."
        Icon={FileText}
      />
    );
  }

  const cur = aggregate(posts);
  const prev = range ? aggregate(postPerformance(data.igPosts, previousRange(range))) : undefined;

  const formats = formatPerformance(data.igPosts, range);
  const champion = formats[0];

  const byWeekday = [...weekdayPerformance(data.igPosts, range)].sort(
    (a, b) => b.avgEngagement - a.avgEngagement,
  );
  const weekdayBars = byWeekday.map((w, i) => ({
    label: w.label,
    value: w.avgEngagement,
    color: i === 0 ? CHART.good : CHART.series[0],
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Posts" value={formatInt(cur.count)} Icon={FileText} />
        <KpiCard
          label="Alcance médio"
          value={formatCompact(cur.avgReach)}
          Icon={Radio}
          delta={prev ? pctDelta(cur.avgReach, prev.avgReach) : undefined}
        />
        <KpiCard
          label="Engaj. médio"
          value={formatPercent(cur.avgEr)}
          Icon={Heart}
          delta={prev ? pctDelta(cur.avgEr, prev.avgEr) : undefined}
        />
        <KpiCard
          label="Taxa de salvamento"
          value={formatPercent(cur.saveRate)}
          Icon={Bookmark}
          hint="salvos ÷ alcance"
          delta={prev ? pctDelta(cur.saveRate, prev.saveRate) : undefined}
        />
        <KpiCard
          label="Taxa de compart."
          value={formatPercent(cur.shareRate)}
          Icon={Share2}
          hint="compart. ÷ alcance"
          delta={prev ? pctDelta(cur.shareRate, prev.shareRate) : undefined}
        />
        <KpiCard label="Alcance total" value={formatCompact(cur.reach)} Icon={Radio} />
      </div>

      {champion ? (
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
      ) : null}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Desempenho por formato</h2>
        <FormatBreakdown formats={formats} />
      </div>

      {byWeekday.length > 1 ? (
        <ChartCard
          title="Melhor dia para postar"
          description="Engajamento médio por dia da semana (verde = melhor)."
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
