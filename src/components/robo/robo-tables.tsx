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

export interface PendenteRow {
  nome: string | null;
  telefone: string | null;
  score: number | null;
  ultima_interacao: string | null;
}

const ETAPA_LABEL: Record<string, string> = {
  nao_respondeu: "Não respondeu",
  em_conversa: "Em conversa",
  convite_pendente: "Convite pendente",
  declinou: "Declinou",
  frio: "Frio",
  transferido: "Transferido",
};

function quando(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

/** Leads que receberam o convite e não responderam — exigem contato manual. */
export function PendentesTable({ rows }: { rows: PendenteRow[] }) {
  const columns: Column<PendenteRow>[] = [
    { key: "nome", header: "Lead", render: (r) => r.nome ?? "—" },
    {
      key: "telefone",
      header: "WhatsApp",
      render: (r) =>
        r.telefone ? (
          <a
            href={`https://wa.me/${r.telefone}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            {r.telefone}
          </a>
        ) : (
          "—"
        ),
    },
    {
      key: "score",
      header: "Score",
      align: "right",
      sortable: true,
      sortValue: (r) => r.score ?? 0,
      render: (r) => r.score ?? "—",
    },
    {
      key: "ultima",
      header: "Última mensagem",
      align: "right",
      sortable: true,
      sortValue: (r) => r.ultima_interacao ?? "",
      render: (r) => quando(r.ultima_interacao),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r, i) => r.telefone ?? String(i)}
      initialSortKey="score"
      emptyTitle="Nenhum convite pendente"
    />
  );
}
