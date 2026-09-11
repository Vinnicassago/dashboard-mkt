"use client";

import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { formatInt } from "@/lib/format";

export interface MotivoRow {
  etapa: string;
  motivo: string;
  leads: number;
  score_medio: number | null;
  turnos_medios: number | null;
}

const ETAPA_LABEL: Record<string, string> = {
  nao_respondeu: "Não respondeu",
  em_conversa: "Em conversa",
  convite_pendente: "Convite pendente",
  declinou: "Declinou",
  frio: "Frio",
  transferido: "Transferido",
};

/** Onde cada grupo de leads parou, e por qual decisão do robô. */
export function MotivosTable({ rows }: { rows: MotivoRow[] }) {
  const columns: Column<MotivoRow>[] = [
    {
      key: "etapa",
      header: "Etapa",
      render: (r) => (
        <Badge variant={r.etapa === "transferido" ? "good" : "muted"}>
          {ETAPA_LABEL[r.etapa] ?? r.etapa}
        </Badge>
      ),
    },
    { key: "motivo", header: "Decisão do robô", render: (r) => r.motivo },
    {
      key: "leads",
      header: "Leads",
      align: "right",
      sortable: true,
      sortValue: (r) => r.leads,
      render: (r) => formatInt(r.leads),
    },
    {
      key: "score",
      header: "Score médio",
      align: "right",
      sortable: true,
      sortValue: (r) => r.score_medio ?? 0,
      render: (r) => r.score_medio ?? "—",
    },
    {
      key: "turnos",
      header: "Turnos",
      align: "right",
      render: (r) => r.turnos_medios ?? "—",
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r, i) => `${r.etapa}-${i}`}
      initialSortKey="leads"
      emptyTitle="Nenhuma conversa ainda"
      emptyHint="Assim que os leads começarem a responder no WhatsApp, o resumo aparece aqui."
    />
  );
}
