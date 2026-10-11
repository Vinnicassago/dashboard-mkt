"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronsUpDown, type LucideIcon } from "lucide-react";
import { Table, TBody, TD, TH, THead, TR } from "./table";
import { EmptyState } from "./empty-state";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  /** Dica do cabeçalho (ⓘ): a definição do dicionário ou a régua da coluna. */
  headerTitle?: string;
  align?: "left" | "right";
  sortable?: boolean;
  /** Value used for sorting (defaults to render output not usable). */
  sortValue?: (row: T) => number | string;
  render: (row: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
}

/** Ordena pela coluna escolhida (a mesma regra para as linhas de cima e as filhas). */
function ordenarLinhas<T>(lista: T[], columns: Column<T>[], sortKey: string | undefined, sortDir: "asc" | "desc"): T[] {
  const col = columns.find((c) => c.key === sortKey);
  if (!col?.sortValue) return lista;
  const factor = sortDir === "asc" ? 1 : -1;
  return [...lista].sort((a, b) => {
    const va = col.sortValue!(a);
    const vb = col.sortValue!(b);
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * factor;
    return String(va).localeCompare(String(vb)) * factor;
  });
}

export function DataTable<T>({
  columns,
  rows,
  initialSortKey,
  initialSortDir = "desc",
  rowKey,
  emptyTitle = "Nada para mostrar",
  emptyHint,
  emptyIcon,
  filhas,
  detalhe,
  expandidoInicial = [],
}: {
  columns: Column<T>[];
  rows: T[];
  initialSortKey?: string;
  initialSortDir?: "asc" | "desc";
  rowKey: (row: T, index: number) => string;
  /** Estado vazio (ex.: busca sem resultado) — evita a tabela "sumir" só com o cabeçalho. */
  emptyTitle?: string;
  emptyHint?: string;
  emptyIcon?: LucideIcon;
  /**
   * Linhas EXPANSÍVEIS (Mídia: campanha → conjuntos, criativo → anúncios).
   * `filhas` devolve as linhas que ficam sob a linha aberta, com as MESMAS
   * colunas (e a mesma ordenação); `detalhe` é um bloco de largura inteira
   * sob a linha aberta — é para lá que vão as colunas secundárias quando a
   * tabela precisa caber no card (B13). A linha só ganha a seta quando tem
   * uma coisa ou outra.
   */
  filhas?: (row: T) => T[] | undefined;
  detalhe?: (row: T) => React.ReactNode;
  /** Chaves (de `rowKey`) abertas de início. */
  expandidoInicial?: string[];
}) {
  const [sortKey, setSortKey] = useState<string | undefined>(initialSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initialSortDir);
  const [abertas, setAbertas] = useState<ReadonlySet<string>>(() => new Set(expandidoInicial));

  const sorted = useMemo(() => ordenarLinhas(rows, columns, sortKey, sortDir), [rows, columns, sortKey, sortDir]);

  function toggle(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function alternar(chave: string) {
    setAbertas((s) => {
      const n = new Set(s);
      if (n.has(chave)) n.delete(chave);
      else n.add(chave);
      return n;
    });
  }

  /** Uma linha (e, aberta, as filhas e o detalhe). `nivel` indenta a primeira célula. */
  function linha(row: T, chave: string, nivel: number): React.ReactNode {
    const subLinhas = filhas?.(row);
    const temDetalhe = Boolean(detalhe);
    const expansivel = (subLinhas && subLinhas.length > 0) || temDetalhe;
    const aberta = expansivel && abertas.has(chave);
    return (
      <Fragment key={chave}>
        <TR className={cn("even:bg-foreground/[0.02]", nivel > 0 && "bg-foreground/[0.03] text-muted-foreground")}>
          {columns.map((c, i) => (
            <TD
              key={c.key}
              className={cn(c.align === "right" && "text-right tabular", c.className)}
              style={i === 0 && nivel > 0 ? { paddingLeft: `${0.75 + nivel * 1.5}rem` } : undefined}
            >
              {i === 0 && (filhas || detalhe) ? (
                <span className="flex min-w-0 items-start gap-1.5">
                  {expansivel ? (
                    <button
                      type="button"
                      onClick={() => alternar(chave)}
                      aria-expanded={aberta}
                      aria-label={aberta ? "Recolher" : "Expandir"}
                      className="mt-0.5 shrink-0 rounded text-muted-foreground hover:text-foreground"
                    >
                      {aberta ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </button>
                  ) : (
                    <span className="size-4 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">{c.render(row)}</span>
                </span>
              ) : (
                c.render(row)
              )}
            </TD>
          ))}
        </TR>
        {aberta && temDetalhe ? (
          <TR className="hover:bg-transparent">
            <td colSpan={columns.length} className="border-b bg-foreground/[0.02] px-3 py-3" style={{ paddingLeft: `${2.25 + nivel * 1.5}rem` }}>
              {detalhe!(row)}
            </td>
          </TR>
        ) : null}
        {aberta && subLinhas ? ordenarLinhas(subLinhas, columns, sortKey, sortDir).map((f, i) => linha(f, `${chave}/${rowKey(f, i)}`, nivel + 1)) : null}
      </Fragment>
    );
  }

  return (
    <Table>
      <THead>
        <TR className="hover:bg-transparent">
          {columns.map((c) => (
            <TH
              key={c.key}
              scope="col"
              aria-sort={
                c.sortable
                  ? sortKey === c.key
                    ? sortDir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                  : undefined
              }
              title={c.headerTitle}
              className={cn(c.align === "right" && "text-right", c.headerClassName)}
            >
              {c.sortable ? (
                <button
                  type="button"
                  onClick={() => toggle(c.key)}
                  className={cn(
                    "inline-flex items-center gap-1 uppercase hover:text-foreground",
                    c.align === "right" && "flex-row-reverse",
                    sortKey === c.key && "text-foreground",
                  )}
                >
                  {c.header}
                  {sortKey === c.key ? (
                    sortDir === "asc" ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowDown className="size-3" />
                    )
                  ) : (
                    <ChevronsUpDown className="size-3 opacity-40" />
                  )}
                </button>
              ) : (
                c.header
              )}
            </TH>
          ))}
        </TR>
      </THead>
      <TBody>
        {sorted.length === 0 ? (
          <TR className="hover:bg-transparent">
            <td colSpan={columns.length} className="px-3 py-6">
              <EmptyState title={emptyTitle} hint={emptyHint} Icon={emptyIcon} />
            </td>
          </TR>
        ) : (
          sorted.map((row, i) => linha(row, rowKey(row, i), 0))
        )}
      </TBody>
    </Table>
  );
}
