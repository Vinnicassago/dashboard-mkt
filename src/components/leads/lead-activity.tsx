"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { statusMeta } from "@/components/tables/lead-status";
import type { LeadEvent } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { CANAL_LABEL, type CanalContato } from "@/lib/contato";

/** O que aconteceu, em uma linha — usado no histórico de Pessoas e na ficha. */
export function DescricaoEvento({ e }: { e: LeadEvent }) {
  if (e.action === "nota") {
    return <span className="whitespace-pre-line">{e.payload?.texto}</span>;
  }
  if (e.action === "mesclado") {
    return (
      <span className="text-muted-foreground">
        Recebeu o cadastro duplicado de {e.payload?.nome ?? "outra entrada"}
        {e.payload?.status ? ` (estava como ${e.payload.status})` : ""}
      </span>
    );
  }
  if (e.action === "tentativa") {
    const canal = CANAL_LABEL[(e.payload?.canal ?? "") as CanalContato] ?? "Contato";
    return (
      <span className="text-muted-foreground">
        Tentativa por {canal.toLowerCase()} —{" "}
        {e.payload?.falou === "sim" ? "falou com a pessoa" : "sem resposta"}
        {e.payload?.proxima ? ` · próxima ${formatDateTime(e.payload.proxima)}` : ""}
        {e.occurredAt && Math.abs(Date.parse(e.occurredAt) - Date.parse(e.createdAt)) > 15 * 60_000
          ? ` · feita em ${formatDateTime(e.occurredAt)}`
          : ""}
      </span>
    );
  }
  if (e.action === "desfeito") {
    return <span className="text-muted-foreground">Desfez uma tentativa registrada por engano</span>;
  }
  if (e.action === "reaberto") {
    return (
      <span className="flex items-center gap-1.5">
        Reaberto{e.payload?.motivo ? ` — ${e.payload.motivo}` : ""}
        {e.toStatus ? <Badge variant={statusMeta[e.toStatus].variant}>{statusMeta[e.toStatus].label}</Badge> : null}
      </span>
    );
  }
  if (e.action === "reenvio") {
    const novo = [e.payload?.telefoneNovo, e.payload?.emailNovo].filter(Boolean).join(" · ");
    return (
      <span className="text-muted-foreground">
        {e.payload?.pelo
          ? `Preencheu o formulário de novo (reconhecido pelo ${e.payload.pelo})`
          : "Reenviou o formulário"}
        {novo ? ` com contato diferente: ${novo}` : ""}
        {e.payload?.origemNova ? ` · veio por ${e.payload.origemNova.split("|")[0]}` : ""} — o cadastro
        não foi alterado
      </span>
    );
  }
  if (e.action === "excluido") {
    return (
      <span className="text-[var(--danger-text)]">
        Excluído{e.payload?.motivo ? ` — ${e.payload.motivo}` : ""}
      </span>
    );
  }
  if (e.action === "restaurado") {
    return <span className="text-[var(--success-text)]">Restaurado</span>;
  }
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
    <span className="flex flex-wrap items-center gap-1.5">
      {e.fromStatus ? (
        <Badge variant={statusMeta[e.fromStatus].variant}>{statusMeta[e.fromStatus].label}</Badge>
      ) : null}
      <ArrowRight className="size-3 text-muted-foreground" />
      {e.toStatus ? (
        <Badge variant={statusMeta[e.toStatus].variant}>{statusMeta[e.toStatus].label}</Badge>
      ) : null}
      {e.payload?.correcao ? <span className="text-xs text-muted-foreground">correção: {e.payload.correcao}</span> : null}
      {e.payload?.reuniao ? (
        <span className="text-xs text-muted-foreground">reunião {formatDateTime(e.payload.reuniao)}</span>
      ) : null}
      {e.payload?.motivo ? <span className="text-xs text-muted-foreground">{e.payload.motivo}</span> : null}
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
    render: (r) => (
      <Link href={`/pessoas/${encodeURIComponent(r.leadId)}`} className="hover:underline">
        {r.leadName}
      </Link>
    ),
  },
  {
    key: "change",
    header: "Mudança",
    render: (r) => <DescricaoEvento e={r} />,
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
        Nenhuma alteração registrada ainda. Cada criação, reenvio, mudança de status e
        exclusão aparece aqui.
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
