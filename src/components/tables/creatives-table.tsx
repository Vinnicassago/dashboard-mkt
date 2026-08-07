"use client";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import type { CreativePerf, FatigueLevel } from "@/lib/metrics";
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

const FAT_TONE: Record<FatigueLevel, string> = {
  fadigado: "var(--critical)",
  atencao: "var(--primary)",
  saudavel: "var(--good)",
  novo: "var(--muted)",
};
const FAT_LABEL: Record<FatigueLevel, string> = {
  fadigado: "Fadigando",
  atencao: "Atenção",
  saudavel: "Saudável",
  novo: "Novo",
};
const FAT_ORDER: Record<FatigueLevel, number> = { fadigado: 3, atencao: 2, saudavel: 1, novo: 0 };

/** Semáforo: verde = saudável, âmbar = atenção, vermelho = fraco. */
function tone(v: number | undefined, good: number, ok: number): string {
  if (v == null) return "var(--muted)";
  if (v >= good) return "var(--good)";
  if (v >= ok) return "var(--primary)";
  return "var(--critical)";
}

function RateCell({ value, color }: { value?: number; color: string }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center justify-end gap-1.5 tabular">
      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
      {formatPercent(value)}
    </span>
  );
}

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
    header: "Gancho (3s)",
    align: "right",
    sortable: true,
    sortValue: (r) => r.hookRate ?? -1,
    render: (r) => <RateCell value={r.hookRate} color={tone(r.hookRate, 0.18, 0.1)} />,
  },
  {
    key: "hold",
    header: "Retenção",
    align: "right",
    sortable: true,
    sortValue: (r) => r.holdRate ?? -1,
    render: (r) => <RateCell value={r.holdRate} color={tone(r.holdRate, 0.3, 0.15)} />,
  },
  {
    key: "fatigue",
    header: "Saúde",
    sortable: true,
    sortValue: (r) => FAT_ORDER[r.fatigue.level],
    render: (r) => (
      <span
        className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm"
        title={r.fatigue.reason}
      >
        <span className="size-2 shrink-0 rounded-full" style={{ background: FAT_TONE[r.fatigue.level] }} />
        {FAT_LABEL[r.fatigue.level]}
      </span>
    ),
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
