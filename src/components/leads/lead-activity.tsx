"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { statusMeta } from "@/components/tables/lead-status";
import type { LeadEvent } from "@/lib/types";
import { formatDateTime } from "@/lib/format";

function ChangeCell({ e }: { e: LeadEvent }) {
  if (e.action === "created") {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        Novo lead
        {e.toStatus && e.toStatus !== "lead" ? (
          <Badge variant={statusMeta[e.toStatus].variant}>{statusMeta[e.toStatus].label}</Badge>
        ) : null}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      {e.fromStatus ? (
        <Badge variant={statusMeta[e.fromStatus].variant}>{statusMeta[e.fromStatus].label}</Badge>
      ) : null}
      <ArrowRight className="size-3 text-muted-foreground" />
      {e.toStatus ? (
        <Badge variant={statusMeta[e.toStatus].variant}>{statusMeta[e.toStatus].label}</Badge>
      ) : null}
    </span>
  );
}

const columns: Column<LeadEvent>[] = [
  {
    key: "createdAt",
    header: "Quando",
    sortable: true,
    sortValue: (r) => r.createdAt,
    render: (r) => <span className="text-muted-foreground">{formatDateTime(r.createdAt)}</span>,
  },
  {
    key: "actor",
    header: "Quem",
    sortable: true,
    sortValue: (r) => r.actor,
    render: (r) => <span className="font-medium">{r.actor}</span>,
  },
  {
    key: "leadName",
    header: "Lead",
    sortable: true,
    sortValue: (r) => r.leadName,
    render: (r) => r.leadName,
  },
  {
    key: "change",
    header: "Mudança",
    render: (r) => <ChangeCell e={r} />,
  },
];

export function LeadActivity({ events }: { events: LeadEvent[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return events;
    return events.filter(
      (e) => e.leadName.toLowerCase().includes(q) || e.actor.toLowerCase().includes(q),
    );
  }, [events, query]);

  if (events.length === 0) {
    return (
      <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
        Nenhuma alteração registrada ainda. Cada criação e mudança de status aparece aqui.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative w-full sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por lead ou por quem alterou"
          className="h-9 w-full rounded-lg border bg-background pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
        />
      </div>
      <DataTable
        columns={columns}
        rows={filtered}
        initialSortKey="createdAt"
        initialSortDir="desc"
        rowKey={(r) => r.id}
      />
    </div>
  );
}
