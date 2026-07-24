"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Table, TBody, TD, TH, THead, TR } from "./table";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  sortable?: boolean;
  /** Value used for sorting (defaults to render output not usable). */
  sortValue?: (row: T) => number | string;
  render: (row: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
}

export function DataTable<T>({
  columns,
  rows,
  initialSortKey,
  initialSortDir = "desc",
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  initialSortKey?: string;
  initialSortDir?: "asc" | "desc";
  rowKey: (row: T, index: number) => string;
}) {
  const [sortKey, setSortKey] = useState<string | undefined>(initialSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initialSortDir);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const factor = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * factor;
      return String(va).localeCompare(String(vb)) * factor;
    });
  }, [rows, columns, sortKey, sortDir]);

  function toggle(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <Table>
      <THead>
        <TR className="hover:bg-transparent">
          {columns.map((c) => (
            <TH
              key={c.key}
              className={cn(c.align === "right" && "text-right", c.headerClassName)}
            >
              {c.sortable ? (
                <button
                  type="button"
                  onClick={() => toggle(c.key)}
                  className={cn(
                    "inline-flex items-center gap-1 hover:text-foreground",
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
        {sorted.map((row, i) => (
          <TR key={rowKey(row, i)}>
            {columns.map((c) => (
              <TD
                key={c.key}
                className={cn(c.align === "right" && "text-right tabular", c.className)}
              >
                {c.render(row)}
              </TD>
            ))}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
