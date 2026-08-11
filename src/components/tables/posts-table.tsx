"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CTA_LABEL, type PostPerf } from "@/lib/metrics";
import { formatDateShort, formatDecimal, formatDuration, formatInt, formatPercent } from "@/lib/format";

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
        {r.permalink ? (
          <a
            href={r.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex max-w-[320px] items-center gap-1 font-medium hover:text-primary"
          >
            <span className="line-clamp-1">{r.caption}</span>
            <ExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          </a>
        ) : (
          <span className="line-clamp-1 max-w-[320px] font-medium">{r.caption}</span>
        )}
        <div className="flex flex-wrap gap-1">
          <Badge variant="muted">{typeLabel[r.type]}</Badge>
          {r.pillar ? <Badge variant="muted">{r.pillar}</Badge> : null}
          {r.cta ? <Badge variant="muted">CTA: {CTA_LABEL[r.cta]}</Badge> : null}
        </div>
      </div>
    ),
  },
  { key: "reach", header: "Alcance", align: "right", sortable: true, sortValue: (r) => r.reach, render: (r) => formatInt(r.reach) },
  { key: "views", header: "Views", align: "right", sortable: true, sortValue: (r) => r.views, render: (r) => formatInt(r.views) },
  { key: "likes", header: "Curtidas", align: "right", sortable: true, sortValue: (r) => r.likes, render: (r) => formatInt(r.likes) },
  { key: "comments", header: "Coment.", align: "right", sortable: true, sortValue: (r) => r.comments, render: (r) => formatInt(r.comments) },
  { key: "saved", header: "Salvos", align: "right", sortable: true, sortValue: (r) => r.saved, render: (r) => formatInt(r.saved) },
  {
    key: "savesPer1k",
    header: "Salvos/1k",
    align: "right",
    sortable: true,
    sortValue: (r) => r.savesPer1k,
    render: (r) =>
      r.views > 0 ? formatDecimal(r.savesPer1k, 1) : <span className="text-muted-foreground">—</span>,
  },
  { key: "shares", header: "Compart.", align: "right", sortable: true, sortValue: (r) => r.shares, render: (r) => formatInt(r.shares) },
  {
    key: "avgWatchTime",
    header: "Retenção",
    align: "right",
    sortable: true,
    // Retenção % em [0,1] no topo; reels só com segundos mapeiam para (-1,0)
    // monotônicos (sempre abaixo de qualquer %); sem nada, -2 por último.
    sortValue: (r) => r.retention ?? (r.avgWatchTime != null ? -1 / (1 + r.avgWatchTime) : -2),
    render: (r) =>
      r.type === "reel" && r.retention != null ? (
        <span>
          {formatPercent(r.retention, 0)}{" "}
          <span className="text-xs text-muted-foreground">· {formatDuration(r.avgWatchTime)}</span>
        </span>
      ) : r.type === "reel" && r.avgWatchTime != null ? (
        formatDuration(r.avgWatchTime)
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "engagementRate",
    header: "Engaj.",
    align: "right",
    sortable: true,
    sortValue: (r) => r.engagementRate,
    render: (r) => formatPercent(r.engagementRate),
  },
];

const ALL_TYPES = ["feed", "carrossel", "reel", "story"] as const;

export function PostsTable({ rows }: { rows: PostPerf[] }) {
  const [type, setType] = useState<"all" | PostPerf["type"]>("all");
  const present = useMemo(
    () => ALL_TYPES.filter((t) => rows.some((r) => r.type === t)),
    [rows],
  );
  const filtered = type === "all" ? rows : rows.filter((r) => r.type === type);

  return (
    <div className="space-y-3">
      {present.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          <Chip active={type === "all"} onClick={() => setType("all")}>
            Todos
          </Chip>
          {present.map((t) => (
            <Chip key={t} active={type === t} onClick={() => setType(t)}>
              {typeLabel[t]}
            </Chip>
          ))}
        </div>
      ) : null}
      <DataTable
        columns={columns}
        rows={filtered}
        initialSortKey="publishedAt"
        initialSortDir="desc"
        rowKey={(r) => r.id}
      />
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
