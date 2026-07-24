"use client";

import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusSelect, statusOrder } from "./lead-status";
import type { LeadStatus } from "@/lib/types";
import { formatDateTime } from "@/lib/format";

export interface LeadRow {
  id: string;
  createdAt: string;
  name: string;
  creativeName: string;
  status: LeadStatus;
  meetingAt?: string;
}

function buildColumns(canEdit: boolean): Column<LeadRow>[] {
  return [
    {
      key: "createdAt",
      header: "Entrada",
      sortable: true,
      sortValue: (r) => r.createdAt,
      render: (r) => (
        <span className="text-muted-foreground">{formatDateTime(r.createdAt)}</span>
      ),
    },
    {
      key: "name",
      header: "Nome",
      sortable: true,
      sortValue: (r) => r.name,
      render: (r) => <span className="font-medium">{r.name}</span>,
    },
    {
      key: "creativeName",
      header: "Origem (criativo)",
      sortable: true,
      sortValue: (r) => r.creativeName,
      render: (r) => <span className="text-muted-foreground">{r.creativeName}</span>,
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (r) => statusOrder[r.status],
      render: (r) => (
        <StatusSelect id={r.id} name={r.name} status={r.status} canEdit={canEdit} />
      ),
    },
    {
      key: "meetingAt",
      header: "Reunião",
      align: "right",
      sortable: true,
      sortValue: (r) => r.meetingAt ?? "",
      render: (r) => (r.meetingAt ? formatDateTime(r.meetingAt) : "—"),
    },
  ];
}

export function LeadsTable({ rows, canEdit = true }: { rows: LeadRow[]; canEdit?: boolean }) {
  return (
    <DataTable
      columns={buildColumns(canEdit)}
      rows={rows}
      initialSortKey="createdAt"
      initialSortDir="desc"
      rowKey={(r) => r.id}
    />
  );
}
