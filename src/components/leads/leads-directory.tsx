"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Mail, MessageCircle, Search, Trash2 } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusSelect, statusMeta, statusOrder } from "@/components/tables/lead-status";
import { deleteLeadAction } from "@/app/(dashboard)/funil/actions";
import type { LeadStatus } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface LeadDirectoryRow {
  id: string;
  createdAt: string;
  name: string;
  email?: string;
  phone?: string;
  creativeName: string;
  status: LeadStatus;
  meetingAt?: string;
}

/** Digits only, with Brazilian country code, for a wa.me link. */
function waLink(phone: string): string {
  let digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length >= 10 && digits.length <= 11) digits = `55${digits}`;
  return `https://wa.me/${digits}`;
}

function ContactCell({ row }: { row: LeadDirectoryRow }) {
  if (!row.phone && !row.email) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {row.phone ? (
        <a
          href={waLink(row.phone)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 hover:underline"
        >
          <MessageCircle className="size-3.5 text-[var(--success-text)]" />
          {row.phone}
        </a>
      ) : null}
      {row.email ? (
        <a
          href={`mailto:${row.email}`}
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:underline"
        >
          <Mail className="size-3.5" />
          {row.email}
        </a>
      ) : null}
    </div>
  );
}

function DeleteLeadButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        aria-label={`Excluir ${name}`}
        title="Excluir lead"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Excluir o lead "${name}"? Esta ação não pode ser desfeita.`)) return;
          start(async () => {
            const result = await deleteLeadAction(id);
            if (result.ok) {
              router.refresh();
            } else {
              setMsg(result.message);
            }
          });
        }}
        className={cn(
          "inline-flex size-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:border-[var(--danger-text)] hover:text-[var(--danger-text)]",
          pending && "opacity-50",
        )}
      >
        <Trash2 className="size-3.5" />
      </button>
      {msg ? <span className="text-[11px] text-[var(--danger-text)]">{msg}</span> : null}
    </div>
  );
}

function buildColumns(canEdit: boolean): Column<LeadDirectoryRow>[] {
  return [
    {
      key: "name",
      header: "Nome",
      sortable: true,
      sortValue: (r) => r.name,
      render: (r) => <span className="font-medium">{r.name}</span>,
    },
    {
      key: "contact",
      header: "Contato",
      render: (r) => <ContactCell row={r} />,
    },
    {
      key: "creativeName",
      header: "Origem",
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
      key: "createdAt",
      header: "Entrada",
      sortable: true,
      sortValue: (r) => r.createdAt,
      render: (r) => <span className="text-muted-foreground">{formatDateTime(r.createdAt)}</span>,
    },
    {
      key: "meetingAt",
      header: "Reunião",
      align: "right",
      sortable: true,
      sortValue: (r) => r.meetingAt ?? "",
      render: (r) => (r.meetingAt ? formatDateTime(r.meetingAt) : "—"),
    },
    ...(canEdit
      ? [
          {
            key: "actions",
            header: "",
            align: "right" as const,
            render: (r: LeadDirectoryRow) => <DeleteLeadButton id={r.id} name={r.name} />,
          },
        ]
      : []),
  ];
}

function csvCell(v: string): string {
  return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function buildCsv(rows: LeadDirectoryRow[]): string {
  const header = ["Nome", "E-mail", "Telefone", "Status", "Origem", "Entrada", "Reunião"];
  const lines = rows.map((r) =>
    [
      r.name,
      r.email ?? "",
      r.phone ?? "",
      statusMeta[r.status].label,
      r.creativeName,
      formatDateTime(r.createdAt),
      r.meetingAt ? formatDateTime(r.meetingAt) : "",
    ]
      .map((c) => csvCell(String(c)))
      .join(";"),
  );
  // BOM + CRLF so Excel pt-BR opens accents and columns correctly
  return "﻿" + [header.join(";"), ...lines].join("\r\n");
}

const FILTERS: { key: LeadStatus | "todos"; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "lead", label: "Leads" },
  { key: "agendou", label: "Agendou" },
  { key: "compareceu", label: "Compareceu" },
  { key: "cliente", label: "Cliente" },
  { key: "perdido", label: "Perdido" },
];

export function LeadsDirectory({
  rows,
  canEdit = true,
}: {
  rows: LeadDirectoryRow[];
  canEdit?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LeadStatus | "todos">("todos");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return rows.filter((r) => {
      if (status !== "todos" && r.status !== status) return false;
      if (!q) return true;
      const inText =
        r.name.toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q);
      const inPhone = qDigits.length > 0 && (r.phone ?? "").replace(/\D/g, "").includes(qDigits);
      return inText || inPhone;
    });
  }, [rows, query, status]);

  function exportCsv() {
    const blob = new Blob([buildCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome, e-mail ou telefone"
            className="h-9 w-full rounded-lg border bg-background pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <Download className="size-4" />
          Exportar CSV ({filtered.length})
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStatus(f.key)}
            className={cn(
              "rounded-lg px-3 py-1 text-xs font-medium transition-colors",
              status === f.key
                ? "bg-primary text-primary-foreground"
                : "border text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          Nenhum lead encontrado.
        </p>
      ) : (
        <DataTable
          columns={buildColumns(canEdit)}
          rows={filtered}
          initialSortKey="createdAt"
          initialSortDir="desc"
          rowKey={(r) => r.id}
        />
      )}
    </div>
  );
}
