"use client";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import type { CreativePerf } from "@/lib/metrics";
import {
  formatCurrency,
  formatInt,
  formatPercent,
} from "@/lib/format";

const formatBadge: Record<CreativePerf["format"], string> = {
  video: "Vídeo",
  carrossel: "Carrossel",
  imagem: "Imagem",
};

const columns: Column<CreativePerf>[] = [
  {
    key: "name",
    header: "Criativo",
    sortable: true,
    sortValue: (r) => r.name,
    render: (r) => (
      <div className="flex flex-col gap-1">
        <span className="font-medium">{r.name}</span>
        <span className="flex items-center gap-1.5">
          <Badge variant="muted">{formatBadge[r.format]}</Badge>
          <span className="text-xs text-muted-foreground">{r.adset}</span>
        </span>
      </div>
    ),
    className: "max-w-[280px]",
  },
  { key: "spend", header: "Gasto", align: "right", sortable: true, sortValue: (r) => r.spend, render: (r) => formatCurrency(r.spend) },
  { key: "ctr", header: "CTR", align: "right", sortable: true, sortValue: (r) => r.ctr, render: (r) => formatPercent(r.ctr) },
  { key: "cpc", header: "CPC", align: "right", sortable: true, sortValue: (r) => r.cpc, render: (r) => formatCurrency(r.cpc) },
  { key: "cpl", header: "CPL", align: "right", sortable: true, sortValue: (r) => r.cpl, render: (r) => formatCurrency(r.cpl) },
  { key: "leads", header: "Leads", align: "right", sortable: true, sortValue: (r) => r.leads, render: (r) => formatInt(r.leads) },
  { key: "meetings", header: "Reuniões", align: "right", sortable: true, sortValue: (r) => r.meetings, render: (r) => formatInt(r.meetings) },
  {
    key: "cpr",
    header: "Custo/reunião",
    align: "right",
    sortable: true,
    sortValue: (r) => r.cpr,
    render: (r) => (r.meetings > 0 ? formatCurrency(r.cpr) : "—"),
  },
  {
    key: "hook",
    header: "Hook rate",
    align: "right",
    sortable: true,
    sortValue: (r) => r.hookRate ?? -1,
    render: (r) => (r.hookRate != null ? formatPercent(r.hookRate) : "—"),
  },
];

export function CreativesTable({ rows }: { rows: CreativePerf[] }) {
  return (
    <DataTable
      columns={columns}
      rows={rows}
      initialSortKey="spend"
      initialSortDir="desc"
      rowKey={(r) => r.adId}
    />
  );
}
