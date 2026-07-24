"use client";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import type { PostPerf } from "@/lib/metrics";
import { formatDateShort, formatInt, formatPercent } from "@/lib/format";

const typeLabel: Record<PostPerf["type"], string> = {
  feed: "Feed",
  carrossel: "Carrossel",
  reel: "Reel",
  story: "Story",
};

const columns: Column<PostPerf>[] = [
  {
    key: "publishedAt",
    header: "Publicado",
    sortable: true,
    sortValue: (r) => r.publishedAt,
    render: (r) => (
      <span className="text-muted-foreground">{formatDateShort(r.publishedAt)}</span>
    ),
  },
  {
    key: "caption",
    header: "Post",
    sortable: true,
    sortValue: (r) => r.caption,
    render: (r) => (
      <div className="flex flex-col gap-1">
        <span className="line-clamp-1 max-w-[320px] font-medium">{r.caption}</span>
        <Badge variant="muted" className="w-fit">{typeLabel[r.type]}</Badge>
      </div>
    ),
  },
  { key: "reach", header: "Alcance", align: "right", sortable: true, sortValue: (r) => r.reach, render: (r) => formatInt(r.reach) },
  { key: "views", header: "Views", align: "right", sortable: true, sortValue: (r) => r.views, render: (r) => formatInt(r.views) },
  { key: "likes", header: "Curtidas", align: "right", sortable: true, sortValue: (r) => r.likes, render: (r) => formatInt(r.likes) },
  { key: "comments", header: "Coment.", align: "right", sortable: true, sortValue: (r) => r.comments, render: (r) => formatInt(r.comments) },
  { key: "saved", header: "Salvos", align: "right", sortable: true, sortValue: (r) => r.saved, render: (r) => formatInt(r.saved) },
  { key: "shares", header: "Compart.", align: "right", sortable: true, sortValue: (r) => r.shares, render: (r) => formatInt(r.shares) },
  {
    key: "engagementRate",
    header: "Engaj.",
    align: "right",
    sortable: true,
    sortValue: (r) => r.engagementRate,
    render: (r) => formatPercent(r.engagementRate),
  },
];

export function PostsTable({ rows }: { rows: PostPerf[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      initialSortKey="publishedAt"
      initialSortDir="desc"
      rowKey={(r) => r.id}
    />
  );
}
