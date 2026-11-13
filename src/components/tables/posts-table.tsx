"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { ROTULO_DO_TIPO, type LinhaDePost } from "@/lib/conteudo-tela";
import { formatInt, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const columns: Column<LinhaDePost>[] = [
  {
    key: "iso",
    header: "Publicado",
    sortable: true,
    sortValue: (r) => r.iso,
    render: (r) => <span className="whitespace-nowrap text-muted-foreground">{r.data}</span>,
  },
  {
    key: "legenda",
    header: "Post",
    sortable: true,
    sortValue: (r) => r.legenda,
    render: (r) => (
      <div className="flex flex-col gap-1">
        {r.href ? (
          <a
            href={r.href}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex max-w-[320px] items-center gap-1 font-medium hover:text-primary"
          >
            <span className="line-clamp-1">{r.legenda}</span>
            <ExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
          </a>
        ) : (
          <span className="line-clamp-1 max-w-[320px] font-medium">{r.legenda}</span>
        )}
        <div className="flex flex-wrap gap-1">
          <Badge variant="muted">{r.tipoTexto}</Badge>
          {r.teste ? <Badge variant="warning">Teste</Badge> : null}
          {r.impulsionado && !r.teste ? <Badge variant="default">Impulsionado</Badge> : null}
        </div>
      </div>
    ),
  },
  { key: "alcance", header: "Alcance", align: "right", sortable: true, sortValue: (r) => r.alcance, render: (r) => formatInt(r.alcance) },
  { key: "views", header: "Views", align: "right", sortable: true, sortValue: (r) => r.views, render: (r) => formatInt(r.views) },
  {
    key: "interacoes",
    header: "Interações",
    align: "right",
    sortable: true,
    sortValue: (r) => r.interacoes,
    render: (r) => formatInt(r.interacoes),
  },
  { key: "salvos", header: "Salvos", align: "right", sortable: true, sortValue: (r) => r.salvos, render: (r) => formatInt(r.salvos) },
  {
    key: "compartilhamentos",
    header: "Compart.",
    align: "right",
    sortable: true,
    sortValue: (r) => r.compartilhamentos,
    render: (r) => formatInt(r.compartilhamentos),
  },
  {
    key: "engajamento",
    header: "Engaj.",
    align: "right",
    sortable: true,
    // Sem alcance não há taxa: fica por último nas duas direções (o `DataTable` põe o não-finito no fim).
    sortValue: (r) => r.engajamento ?? Number.NaN,
    render: (r) =>
      r.engajamento === null ? <span className="text-muted-foreground">—</span> : formatPercent(r.engajamento),
  },
];

const TIPOS = ["feed", "carrossel", "reel", "story"] as const;
type Filtro = "todos" | "teste" | LinhaDePost["tipo"];

/**
 * "Todos os posts" do Conteúdo (Fase 5 de nov/26, §2.6): os posts do período, os de
 * teste e os impulsionados com selo. Recebe só `LinhaDePost` — pronta no servidor
 * (`montarConteudoDaTela`): a data é o dia de Brasília que decide o período, a legenda
 * é a curta (a completa abre no post) e nada de URL do CDN nem marca. Só leitura: marcar
 * ou desmarcar um teste é em Registros.
 */
export function PostsTable({ linhas }: { linhas: LinhaDePost[] }) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const presentes = useMemo(() => TIPOS.filter((t) => linhas.some((r) => r.tipo === t)), [linhas]);
  const temTeste = useMemo(() => linhas.some((r) => r.teste), [linhas]);
  const filtradas =
    filtro === "todos"
      ? linhas
      : filtro === "teste"
        ? linhas.filter((r) => r.teste)
        : linhas.filter((r) => r.tipo === filtro);

  return (
    <div className="min-w-0 space-y-3">
      {presentes.length > 1 || temTeste ? (
        <div className="flex flex-wrap gap-1.5">
          <Chip ativo={filtro === "todos"} onClick={() => setFiltro("todos")}>
            Todos
          </Chip>
          {presentes.map((t) => (
            <Chip key={t} ativo={filtro === t} onClick={() => setFiltro(t)}>
              {ROTULO_DO_TIPO[t]}
            </Chip>
          ))}
          {temTeste ? (
            <Chip ativo={filtro === "teste"} onClick={() => setFiltro("teste")}>
              Testes
            </Chip>
          ) : null}
        </div>
      ) : null}
      <DataTable
        columns={columns}
        rows={filtradas}
        initialSortKey="iso"
        initialSortDir="desc"
        rowKey={(r) => r.id}
      />
    </div>
  );
}

function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        ativo ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
