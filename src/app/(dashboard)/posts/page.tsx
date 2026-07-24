import { FileText, Radio, Heart } from "lucide-react";
import { KpiCard } from "@/components/kpi/kpi-card";
import { PostsTable } from "@/components/tables/posts-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getData } from "@/lib/data/store";
import { pageRange } from "@/lib/page-range";
import { postPerformance } from "@/lib/metrics";
import { formatCompact, formatInt, formatPercent } from "@/lib/format";

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const data = await getData();
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

  const totalReach = posts.reduce((s, p) => s + p.reach, 0);
  const avgReach = totalReach / posts.length;
  const avgEr =
    posts.reduce((s, p) => s + p.engagementRate, 0) / posts.length;
  const best = [...posts].sort((a, b) => b.engagementRate - a.engagementRate)[0];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Posts" value={formatInt(posts.length)} Icon={FileText} />
        <KpiCard label="Alcance médio" value={formatCompact(avgReach)} Icon={Radio} />
        <KpiCard label="Engaj. médio" value={formatPercent(avgEr)} Icon={Heart} />
        <KpiCard label="Alcance total" value={formatCompact(totalReach)} Icon={Radio} />
      </div>

      {best ? (
        <Card>
          <CardContent className="flex flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Post com maior engajamento</p>
              <p className="truncate font-semibold">{best.caption}</p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <Badge variant="good">{formatPercent(best.engagementRate)} engaj.</Badge>
              <span className="tabular text-muted-foreground">{formatInt(best.reach)} alcance</span>
            </div>
          </CardContent>
        </Card>
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
