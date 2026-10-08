"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Mail, MessageCircle, RotateCcw, Search, Trash2 } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { LEAD_STATUSES, LEAD_STATUS_META, statusLabel } from "@/lib/lead-status";
import { deleteLeadAction, restoreLeadAction } from "@/app/(dashboard)/pessoas/actions";
import { RegistrarStatus, StatusBadge } from "@/components/tables/lead-status";
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
  /** Já teve reunião marcada (`everBooked`). */
  jaAgendou: boolean;
  /** Tentativas de contato (decide a confirmação de "Sem resposta"). */
  tentativas: number;
  diasComTentativa: number;
  /** Data DA reunião. Lead agendado antes de out/2026 não tem (a coluna diz isso). */
  meetingFor?: string;
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
          const motivo = window.prompt(
            `Excluir o lead "${name}"?\n\nEle sai das listas e dos números, mas fica no histórico e pode ser restaurado. Qual o motivo (teste, duplicado, spam…)?`,
          );
          if (motivo == null) return;
          if (!motivo.trim()) {
            setMsg("Diga o motivo da exclusão.");
            return;
          }
          start(async () => {
            const result = await deleteLeadAction(id, motivo);
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

function buildColumns(canEdit: boolean, canDelete: boolean): Column<LeadDirectoryRow>[] {
  return [
    {
      key: "name",
      header: "Nome",
      sortable: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <Link href={`/pessoas/${encodeURIComponent(r.id)}`} className="font-medium hover:underline">
          {r.name}
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (r) => LEAD_STATUS_META[r.status].order,
      render: (r) =>
        canEdit ? (
          <RegistrarStatus
            id={r.id}
            name={r.name}
            status={r.status}
            jaAgendou={r.jaAgendou}
            tentativas={r.tentativas}
            diasComTentativa={r.diasComTentativa}
            podeReabrir={canDelete}
          />
        ) : (
          <StatusBadge status={r.status} />
        ),
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
      key: "createdAt",
      header: "Entrada",
      sortable: true,
      sortValue: (r) => r.createdAt,
      render: (r) => <span className="text-muted-foreground">{formatDateTime(r.createdAt)}</span>,
    },
    {
      key: "meetingFor",
      header: "Reunião",
      align: "right",
      sortable: true,
      sortValue: (r) => r.meetingFor ?? "",
      render: (r) =>
        r.meetingFor ? (
          formatDateTime(r.meetingFor)
        ) : r.jaAgendou ? (
          <span className="text-muted-foreground" title="Agendado antes de a data da reunião ser registrada">
            data não registrada
          </span>
        ) : (
          "—"
        ),
    },
    ...(canDelete
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

/**
 * Telefone como TEXTO para o Excel: sem isso ele abre 5511999990000 como número e
 * grava "5,51E+12" — foi assim que telefones viraram notação científica. O
 * importador de leads desfaz o `="…"`.
 */
function csvTelefone(v?: string): string {
  return v ? `="${v.replace(/"/g, "")}"` : "";
}

function buildCsv(rows: LeadDirectoryRow[]): string {
  const header = ["Nome", "E-mail", "Telefone", "Status", "Origem", "Entrada", "Reunião"];
  const lines = rows.map((r) =>
    [
      csvCell(r.name),
      csvCell(r.email ?? ""),
      csvTelefone(r.phone),
      csvCell(statusLabel(r.status)),
      csvCell(r.creativeName),
      csvCell(formatDateTime(r.createdAt)),
      csvCell(r.meetingFor ? formatDateTime(r.meetingFor) : ""),
    ].join(";"),
  );
  // BOM + CRLF so Excel pt-BR opens accents and columns correctly
  return "﻿" + [header.join(";"), ...lines].join("\r\n");
}

/**
 * "perdidos" agrupa os quatro motivos num filtro só — quem procura um lead
 * perdido raramente lembra por qual motivo ele saiu. Os motivos individuais
 * continuam disponíveis logo depois.
 */
type StatusFilter = LeadStatus | "todos" | "perdidos";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "todos", label: "Todos" },
  ...LEAD_STATUSES.filter((s) => !LEAD_STATUS_META[s].lost).map((s) => ({
    key: s as StatusFilter,
    label: LEAD_STATUS_META[s].label,
  })),
  { key: "perdidos", label: "Perdidos" },
  ...LEAD_STATUSES.filter((s) => LEAD_STATUS_META[s].lost).map((s) => ({
    key: s as StatusFilter,
    label: LEAD_STATUS_META[s].label,
  })),
];

export function LeadsDirectory({
  rows,
  canEdit = false,
  canDelete = false,
}: {
  rows: LeadDirectoryRow[];
  /** Mudar status (leads:write — comercial e administrador). */
  canEdit?: boolean;
  /** Excluir é só do administrador (e reversível — ver `DeletedLeads`). */
  canDelete?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("todos");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    return rows.filter((r) => {
      if (status === "perdidos") {
        if (!LEAD_STATUS_META[r.status].lost) return false;
      } else if (status !== "todos" && r.status !== status) {
        return false;
      }
      if (!q) return true;
      const inText =
        r.name.toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q);
      const inPhone = qDigits.length > 0 && (r.phone ?? "").replace(/\D/g, "").includes(qDigits);
      return inText || inPhone;
    });
  }, [rows, query, status]);

  // Quantos leads em cada aba — as contagens somam o total (exceto "Perdidos",
  // que agrupa os quatro motivos).
  const contagem = useMemo(() => {
    const c: Record<string, number> = { todos: rows.length, perdidos: 0 };
    for (const r of rows) {
      c[r.status] = (c[r.status] ?? 0) + 1;
      if (LEAD_STATUS_META[r.status].lost) c.perdidos++;
    }
    return c;
  }, [rows]);

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

      <div className="flex flex-wrap items-center gap-1">
        {FILTERS.map((f) => (
          <span key={f.key} className="contents">
            {/* separa visualmente o funil ativo dos motivos de perda */}
            {f.key === "perdidos" ? <span aria-hidden className="mx-1 h-4 w-px bg-border" /> : null}
            <button
              type="button"
              onClick={() => setStatus(f.key)}
              title={f.key !== "todos" && f.key !== "perdidos" ? LEAD_STATUS_META[f.key].hint : undefined}
              className={cn(
                "rounded-lg px-3 py-1 text-xs font-medium transition-colors",
                status === f.key
                  ? "bg-primary text-primary-foreground"
                  : "border text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label} <span className="tabular-nums opacity-70">({contagem[f.key] ?? 0})</span>
            </button>
          </span>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          Nenhum lead encontrado.
        </p>
      ) : (
        <DataTable
          columns={buildColumns(canEdit, canDelete)}
          rows={filtered}
          initialSortKey="createdAt"
          initialSortDir="desc"
          rowKey={(r) => r.id}
        />
      )}
    </div>
  );
}

export interface DeletedLeadRow {
  id: string;
  name: string;
  deletedAt: string;
  deletedBy?: string;
  deletedReason?: string;
}

/** Leads excluídos: quem, quando e por quê — e o botão de desfazer. */
export function DeletedLeads({ rows, canRestore }: { rows: DeletedLeadRow[]; canRestore: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-lg border text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span>
              <span className="font-medium">{r.name}</span>{" "}
              <span className="text-muted-foreground">
                · excluído em {formatDateTime(r.deletedAt)}
                {r.deletedBy ? ` por ${r.deletedBy}` : ""}
                {r.deletedReason ? ` — ${r.deletedReason}` : ""}
              </span>
            </span>
            {canRestore ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const result = await restoreLeadAction(r.id);
                    setMsg(result.message);
                    if (result.ok) router.refresh();
                  })
                }
                className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <RotateCcw className="size-3.5" />
                Restaurar
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {msg ? <p className="text-xs text-muted-foreground">{msg}</p> : null}
    </div>
  );
}
