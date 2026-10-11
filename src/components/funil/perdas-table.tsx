"use client";

import { DataTable, type Column } from "@/components/ui/data-table";
import { ALVO_LABEL, type AlvoDaPerda, type LinhaPerda } from "@/lib/funil";
import { formatDecimal, formatInt, formatPercent } from "@/lib/format";

/**
 * Perdas confiáveis, por motivo. "Onde atacar" é a regra de `lib/funil.ts`
 * aplicada lead a lead — a linha mostra para onde cada um apontou, não um rótulo
 * fixo por status.
 */

const ORDEM_ALVO: AlvoDaPerda[] = ["comercial", "midia_formulario", "oferta", "indefinido"];

const columns: Column<LinhaPerda>[] = [
  {
    key: "motivo",
    header: "Motivo",
    sortable: true,
    sortValue: (r) => r.label,
    render: (r) => (
      <div>
        <p className="font-medium">{r.label}</p>
        {r.detalhes ? (
          <ul className="mt-0.5 text-xs text-muted-foreground">
            {r.detalhes.map((d) => (
              <li key={d.motivo}>
                {d.label}: <span className="tabular">{formatInt(d.n)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    ),
  },
  { key: "n", header: "Leads", align: "right", sortable: true, sortValue: (r) => r.n, render: (r) => formatInt(r.n) },
  { key: "share", header: "% das perdas", align: "right", sortable: true, sortValue: (r) => r.share, render: (r) => formatPercent(r.share) },
  {
    key: "atraso",
    header: "% registrado com atraso",
    align: "right",
    sortable: true,
    sortValue: (r) => r.registradoComAtraso ?? -1,
    render: (r) =>
      r.registradoComAtraso == null ? (
        <span title="Nenhum registro datado: sem evento de status nem marco de perda">—</span>
      ) : (
        <span title={`Status registrado mais de 72 h depois da entrada · n = ${formatInt(r.atrasoN)}`}>{formatPercent(r.registradoComAtraso)}</span>
      ),
  },
  {
    key: "tentativas",
    header: "Média de tentativas",
    align: "right",
    sortable: true,
    sortValue: (r) => r.mediaTentativas,
    render: (r) => formatDecimal(r.mediaTentativas, 1),
  },
  {
    key: "atacar",
    header: "Onde atacar",
    render: (r) => (
      <span className="flex flex-wrap gap-1.5">
        {ORDEM_ALVO.filter((a) => (r.ondeAtacar[a] ?? 0) > 0).map((a) => (
          <span key={a} className="rounded border px-1.5 py-px text-xs">
            {ALVO_LABEL[a]} <span className="tabular font-medium">{formatInt(r.ondeAtacar[a])}</span>
          </span>
        ))}
      </span>
    ),
  },
];

export function PerdasTable({ linhas }: { linhas: LinhaPerda[] }) {
  return (
    <DataTable
      columns={columns}
      rows={linhas}
      initialSortKey="n"
      rowKey={(r) => r.status}
      emptyTitle="Nenhuma perda confiável no período"
      emptyHint="Depois de tirar testes, duplicados e quem chegou a agendar, não sobrou lead encerrado sem reunião."
    />
  );
}
