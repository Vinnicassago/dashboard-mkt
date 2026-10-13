"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Mail, MessageCircle, RotateCcw, Search, Trash2 } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { useComPeriodo } from "@/components/layout/use-periodo";
import { RegistrarStatus, StatusBadge } from "@/components/tables/lead-status";
import {
  deleteLeadAction,
  registrarExportacaoAction,
  restoreLeadAction,
} from "@/app/(dashboard)/leads/actions";
import { ETAPA_MAXIMA_LABEL, LEAD_STATUSES, LEAD_STATUS_META } from "@/lib/lead-status";
import { DONO_LABEL, type Dono } from "@/lib/dono";
import { FILA_ETAPAS } from "@/lib/fila";
import { dica } from "@/lib/dicionario";
import { formatDateTime, formatDateTimeCurta, formatarEspera } from "@/lib/format";
import { normalizarTelefone } from "@/lib/phone";
import { rangeLabel } from "@/lib/range";
import {
  FILTRO_VAZIO,
  SINALIZADOR_LABEL,
  aplicarFiltroSemStatus,
  contarPorStatus,
  descreverFiltro,
  montarCsvDeLeads,
  profundidadeDaEtapa,
  type AbaStatus,
  type FiltroDeLeads,
  type LinhaDeLead,
  type SinalizadorChave,
} from "@/lib/leads-vista";
import type { LeadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const DONOS = Object.keys(DONO_LABEL) as Dono[];
const SINAIS = Object.keys(SINALIZADOR_LABEL) as SinalizadorChave[];

// ---------------------------------------------------------------- células

/**
 * Telefone e e-mail sob o nome. Mascarado (papel Marketing) é só texto: um
 * `wa.me` com "•••" no meio não leva a lugar nenhum.
 */
function Contato({ row, mascarado }: { row: LinhaDeLead; mascarado: boolean }) {
  if (!row.phone && !row.email) {
    return <span className="text-xs text-muted-foreground">sem contato</span>;
  }
  if (mascarado) {
    return (
      <span className="text-xs text-muted-foreground" title="Contato mascarado para o papel Marketing (LGPD)">
        {[row.phone, row.email].filter(Boolean).join(" · ")}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
      {row.phone ? (
        <a
          href={`https://wa.me/${normalizarTelefone(row.phone)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 hover:underline"
        >
          <MessageCircle className="size-3 text-[var(--success-text)]" />
          {row.phone}
        </a>
      ) : null}
      {row.email ? (
        <a href={`mailto:${row.email}`} className="inline-flex items-center gap-1 text-muted-foreground hover:underline">
          <Mail className="size-3" />
          {row.email}
        </a>
      ) : null}
    </span>
  );
}

/** Os sinalizadores da pessoa — quem revisa decide; aqui só se mostra. */
function Sinais({ s }: { s: LinhaDeLead["sinalizadores"] }) {
  if (!s.teste && !s.duplicado && !s.contatoInvalido) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {s.teste ? (
        <Badge variant="outline" title={`Parece teste: ${s.teste}`}>
          {SINALIZADOR_LABEL.teste}
        </Badge>
      ) : null}
      {s.duplicado ? (
        <Badge variant="outline" title={s.duplicadoDe ? `Mesma pessoa que “${s.duplicadoDe}”` : "Tem outro cadastro com o mesmo contato"}>
          {s.duplicadoDe ? `Duplicado de ${s.duplicadoDe}` : "Tem duplicado"}
        </Badge>
      ) : null}
      {s.contatoInvalido ? (
        <Badge variant="outline" title="Telefone ou e-mail com formato inválido, ou já encerrado assim">
          {SINALIZADOR_LABEL.contato_invalido}
        </Badge>
      ) : null}
    </span>
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
        title="Excluir lead (reversível, com motivo)"
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

const foraDoPrazoCls = "text-[11px] font-medium text-[var(--status-fora-text)]";

/**
 * O que saiu das colunas para a tabela caber a 1366 px (regra 7.2: colunas
 * secundárias vão para a linha expandida): tentativas, reunião, dono e a
 * origem inteira.
 */
function DetalheDoLead({ r }: { r: LinhaDeLead }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
      <div className="flex items-baseline gap-1.5" title="Tentativas de contato registradas (as desfeitas não contam).">
        <dt className="text-muted-foreground">Tentativas</dt>
        <dd className="font-medium">
          {r.tentativas}
          {r.ultimaTentativa ? (
            <span className="font-normal text-muted-foreground">
              {" "}· última {formatDateTime(r.ultimaTentativa)}
              {r.falou ? " · já falou com a pessoa" : ""}
              {r.proximaTentativa ? ` · próxima ${formatDateTime(r.proximaTentativa)}` : ""}
            </span>
          ) : null}
        </dd>
      </div>
      <div className="flex items-baseline gap-1.5" title="Data da reunião marcada (o fato); o status diz o que aconteceu com ela.">
        <dt className="text-muted-foreground">Reunião</dt>
        <dd className="font-medium">
          {r.meetingFor ? formatDateTime(r.meetingFor) : r.jaAgendou ? "agendada sem data registrada" : "—"}
        </dd>
      </div>
      <div className="flex items-baseline gap-1.5" title="Quem age em seguida. Sem dono = lead encerrado.">
        <dt className="text-muted-foreground">Dono</dt>
        <dd className="font-medium">{r.dono ? DONO_LABEL[r.dono] : "— (encerrado)"}</dd>
      </div>
      <div className="flex min-w-0 items-baseline gap-1.5">
        <dt className="text-muted-foreground">Origem</dt>
        <dd className="font-medium">{r.origem.trilha}</dd>
      </div>
    </dl>
  );
}

/**
 * As colunas do relatório (7.5): cabeçalho e linha saem do MESMO array (B5).
 * O contato fica sob o nome — não é coluna, é como se chega à pessoa.
 */
function montarColunas(opts: {
  canEdit: boolean;
  canDelete: boolean;
  mascarado: boolean;
  comPeriodo: (href: string) => string;
}): Column<LinhaDeLead>[] {
  const { canEdit, canDelete, mascarado, comPeriodo } = opts;
  const cols: Column<LinhaDeLead>[] = [
    {
      key: "name",
      header: "Nome",
      sortable: true,
      sortValue: (r) => r.name,
      className: "max-w-[210px]",
      render: (r) => (
        <div className="flex min-w-0 flex-col gap-0.5 overflow-hidden">
          <Link href={comPeriodo(`/leads/${encodeURIComponent(r.id)}`)} className="font-medium hover:underline">
            {r.name}
          </Link>
          <Contato row={r} mascarado={mascarado} />
          <Sinais s={r.sinalizadores} />
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      headerTitle: "Onde o lead está AGORA. Muda; os fatos ficam nos marcos (etapa máxima).",
      sortable: true,
      sortValue: (r) => LEAD_STATUS_META[r.status].order,
      className: "max-w-[200px]",
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
      key: "etapaMaxima",
      header: "Etapa máxima",
      headerTitle: "Até onde chegou, pelos marcos gravados uma vez: quem agendou e se perdeu continua tendo agendado.",
      sortable: true,
      sortValue: (r) => profundidadeDaEtapa(r.etapaMaxima),
      render: (r) => <span>{ETAPA_MAXIMA_LABEL[r.etapaMaxima]}</span>,
    },
    {
      key: "createdAt",
      header: "Entrada",
      sortable: true,
      sortValue: (r) => r.createdAt,
      render: (r) => (
        <span className="whitespace-nowrap text-muted-foreground" title={formatDateTime(r.createdAt)}>
          {formatDateTimeCurta(r.createdAt)}
        </span>
      ),
    },
    {
      key: "primeiroContato",
      header: "Tempo até 1º contato",
      headerTitle: `${dica("primeiro_contato_no_prazo")} Aqui: horas úteis (seg–sex, 9h–18h) entre a entrada e a 1ª tentativa.`,
      align: "right",
      sortable: true,
      sortValue: (r) => r.horasAte1oContato ?? -1,
      render: (r) =>
        r.horasAte1oContato == null ? (
          <span className="text-muted-foreground" title="Nenhuma tentativa registrada ainda">
            —
          </span>
        ) : (
          <span className="whitespace-nowrap">
            {formatarEspera(r.horasAte1oContato)}
            {r.primeiroContatoNoPrazo === false ? (
              <span className={cn("ml-1", foraDoPrazoCls)} title={`A régua é ${FILA_ETAPAS.novo.slaHoras} hora útil`}>
                fora do prazo
              </span>
            ) : null}
          </span>
        ),
    },
    {
      key: "proximaAcao",
      header: "Próxima ação",
      headerTitle: "A mesma régua da Fila de contato — clique para abrir a Fila nessa etapa.",
      sortable: true,
      sortValue: (r) => (r.proximaAcao === "—" ? 0 : r.acaoAtrasada ? 2 : 1),
      className: "max-w-[130px]",
      render: (r) =>
        r.etapaDaFila ? (
          <Link
            href={comPeriodo(`/fila?etapa=${r.etapaDaFila}`)}
            title={r.acaoPorque}
            className="underline-offset-4 hover:underline"
          >
            {r.proximaAcao}
            {r.acaoAtrasada ? <span className={cn("ml-1", foraDoPrazoCls)}>· atrasada</span> : null}
          </Link>
        ) : (
          <span className="text-muted-foreground" title={r.acaoPorque}>
            —
          </span>
        ),
    },
    {
      key: "origem",
      header: "Origem",
      headerTitle: "Campanha › conjunto › anúncio, pela junção única lead → anúncio (id gravado na entrada, depois o utm_content).",
      sortable: true,
      sortValue: (r) => r.origem.trilha,
      render: (r) => (
        <span className="block max-w-[16ch] truncate text-muted-foreground" title={r.origem.trilha}>
          {r.origem.trilha}
        </span>
      ),
    },
    ...(canDelete
      ? [
          {
            key: "actions",
            header: "",
            align: "right" as const,
            render: (r: LinhaDeLead) => <DeleteLeadButton id={r.id} name={r.name} />,
          },
        ]
      : []),
  ];
  // Cabeçalho quebra linha e célula mais estreita: dez colunas cabem no card a
  // 1366 px sem a tabela virar rolagem horizontal.
  return cols.map((c) => ({
    ...c,
    headerClassName: `whitespace-normal leading-tight ${c.headerClassName ?? ""}`.trim(),
    className: `px-2 ${c.className ?? ""}`.trim(),
  }));
}

// ---------------------------------------------------------------- filtro ⇄ URL

const isStatus = (v: string | null): v is LeadStatus => Boolean(v) && (LEAD_STATUSES as string[]).includes(v!);
const isDono = (v: string | null): v is Dono => Boolean(v) && (DONOS as string[]).includes(v!);

/** O filtro que a URL carrega (o período já é `?range=`, lido pela página). */
function filtroDaUrl(p: URLSearchParams): FiltroDeLeads {
  const status = p.get("status");
  const dono = p.get("dono");
  const sinais = (p.get("sinal") ?? "")
    .split(",")
    .filter((s): s is SinalizadorChave => (SINAIS as string[]).includes(s));
  return {
    status: isStatus(status) ? status : "todos",
    campanha: p.get("campanha") || undefined,
    conjunto: p.get("conjunto") || undefined,
    dono: isDono(dono) ? dono : undefined,
    sinalizadores: sinais,
    busca: "",
  };
}

/**
 * Grava o filtro na URL sem ida ao servidor (`replaceState` — o Next sincroniza
 * `useSearchParams`). O link fica compartilhável e o período (`range`) é
 * preservado; a busca não vai: é digitação, e costuma ser PII.
 */
function urlComFiltro(f: FiltroDeLeads): string {
  const url = new URL(window.location.href);
  const p = url.searchParams;
  const set = (k: string, v: string | undefined) => (v ? p.set(k, v) : p.delete(k));
  set("status", f.status === "todos" ? undefined : f.status);
  set("campanha", f.campanha);
  set("conjunto", f.conjunto);
  set("dono", f.dono);
  set("sinal", f.sinalizadores.length ? f.sinalizadores.join(",") : undefined);
  return url.pathname + (p.toString() ? `?${p.toString()}` : "") + url.hash;
}

const selectCls =
  "h-8 rounded-md border bg-background px-2 text-xs text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none";

// ---------------------------------------------------------------- a tabela

export function LeadsDirectory({
  rows,
  rangeKey,
  canEdit = false,
  canDelete = false,
  canExport = false,
  mascararContato = false,
}: {
  rows: LinhaDeLead[];
  /** O `?range=` da página, para o registro da exportação dizer o período. */
  rangeKey: string;
  /** Mudar status (leads:write — comercial e administrador). */
  canEdit?: boolean;
  /** Excluir é só do administrador (e reversível — ver `DeletedLeads`). */
  canDelete?: boolean;
  /** Exportar CSV (leads:write) — o servidor confere de novo e registra. */
  canExport?: boolean;
  /** Papel Marketing: telefone e e-mail já chegam mascarados; sem links. */
  mascararContato?: boolean;
}) {
  const params = useSearchParams();
  const comPeriodo = useComPeriodo();
  const [filtro, setFiltro] = useState<FiltroDeLeads>(() => filtroDaUrl(new URLSearchParams(params.toString())));
  const [exportando, startExport] = useTransition();
  const [msgExport, setMsgExport] = useState<{ ok: boolean; text: string } | null>(null);

  // Filtro → URL (sem servidor). Só os campos que valem a pena compartilhar.
  const { status, campanha, conjunto, dono, sinalizadores } = filtro;
  useEffect(() => {
    const alvo = urlComFiltro({ status, campanha, conjunto, dono, sinalizadores, busca: "" });
    if (alvo !== window.location.pathname + window.location.search + window.location.hash) {
      // `null`, não o estado atual: é assim que o Next copia os internos dele e
      // sincroniza `useSearchParams` sem ir ao servidor.
      window.history.replaceState(null, "", alvo);
    }
  }, [status, campanha, conjunto, dono, sinalizadores]);

  const mudar = (patch: Partial<FiltroDeLeads>) => setFiltro((f) => ({ ...f, ...patch }));

  // Opções dos filtros saem das linhas: só se oferece o que existe.
  const campanhas = useMemo(
    () => [...new Set(rows.map((r) => r.origem.campanha).filter((c): c is string => Boolean(c)))].sort(),
    [rows],
  );
  const conjuntos = useMemo(
    () =>
      [
        ...new Set(
          rows
            .filter((r) => !filtro.campanha || r.origem.campanha === filtro.campanha)
            .map((r) => r.origem.conjunto)
            .filter((c): c is string => Boolean(c)),
        ),
      ].sort(),
    [rows, filtro.campanha],
  );
  const donos = useMemo(() => DONOS.filter((d) => rows.some((r) => r.dono === d)), [rows]);

  // As abas contam sobre TUDO menos o status — assim somam o "Todos" visível.
  const semStatus = useMemo(() => aplicarFiltroSemStatus(rows, filtro), [rows, filtro]);
  const contagem = useMemo(() => contarPorStatus(semStatus), [semStatus]);
  const filtradas = useMemo(
    () => (filtro.status === "todos" ? semStatus : semStatus.filter((r) => r.status === filtro.status)),
    [semStatus, filtro.status],
  );

  const colunas = useMemo(
    () => montarColunas({ canEdit, canDelete, mascarado: mascararContato, comPeriodo }),
    [canEdit, canDelete, mascararContato, comPeriodo],
  );

  const temFiltro =
    filtro.status !== "todos" ||
    Boolean(filtro.campanha || filtro.conjunto || filtro.dono) ||
    filtro.sinalizadores.length > 0 ||
    filtro.busca.trim().length > 0;

  function exportar() {
    setMsgExport(null);
    const linhas = filtradas;
    const descricao = descreverFiltro(filtro, rangeLabel(rangeKey));
    startExport(async () => {
      // Registra ANTES de montar o arquivo: sem registro, sem CSV. `ok: false`
      // inclui o registro que não entrou em audit_log — o arquivo não nasce.
      const r = await registrarExportacaoAction(descricao, linhas.length);
      if (!r.ok) {
        setMsgExport({ ok: false, text: r.message });
        return;
      }
      const blob = new Blob([montarCsvDeLeads(linhas)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "leads.csv";
      a.click();
      URL.revokeObjectURL(url);
      setMsgExport({ ok: true, text: r.message });
    });
  }

  const abas: { key: AbaStatus; label: string }[] = [
    { key: "todos", label: "Todos" },
    ...LEAD_STATUSES.map((s) => ({ key: s as AbaStatus, label: LEAD_STATUS_META[s].label })),
  ];
  const primeiraPerda = LEAD_STATUSES.find((s) => LEAD_STATUS_META[s].lost);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filtro.busca}
            onChange={(e) => mudar({ busca: e.target.value })}
            placeholder="Buscar por nome, e-mail ou telefone"
            className="h-9 w-full rounded-lg border bg-background pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
        {canExport ? (
          <div className="flex flex-col items-end gap-0.5">
            <button
              type="button"
              onClick={exportar}
              disabled={exportando || filtradas.length === 0}
              title="Exporta só o que o filtro mostra; a exportação fica registrada com quem exportou e o filtro"
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <Download className="size-4" />
              Exportar CSV ({filtradas.length})
            </button>
            {msgExport ? (
              <span
                role={msgExport.ok ? undefined : "alert"}
                className={cn(
                  "max-w-xs text-right text-[11px]",
                  msgExport.ok ? "text-muted-foreground" : "text-[var(--danger-text)]",
                )}
              >
                {msgExport.text}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Abas por status, com contagem: as de status somam o "Todos". */}
      <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Status">
        {abas.map((a) => {
          const ativa = filtro.status === a.key;
          const meta = a.key === "todos" ? null : LEAD_STATUS_META[a.key];
          return (
            <span key={a.key} className="contents">
              {/* separa visualmente o caminho feliz dos motivos de perda */}
              {a.key === primeiraPerda ? <span aria-hidden className="mx-1 h-4 w-px bg-border" /> : null}
              <button
                type="button"
                role="tab"
                aria-selected={ativa}
                onClick={() => mudar({ status: a.key })}
                title={meta?.hint}
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors",
                  ativa ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {meta ? <Badge variant={meta.variant}>{a.label}</Badge> : a.label}
                <span className="tabular-nums opacity-70">({contagem[a.key] ?? 0})</span>
              </button>
            </span>
          );
        })}
      </div>

      {/* Origem, dono e sinalizadores — refletidos na URL (link compartilhável). */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Campanha"
          value={filtro.campanha ?? ""}
          onChange={(e) => mudar({ campanha: e.target.value || undefined, conjunto: undefined })}
          className={selectCls}
        >
          <option value="">Toda campanha</option>
          {campanhas.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          aria-label="Conjunto"
          value={filtro.conjunto ?? ""}
          onChange={(e) => mudar({ conjunto: e.target.value || undefined })}
          className={selectCls}
        >
          <option value="">Todo conjunto</option>
          {conjuntos.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          aria-label="Dono"
          value={filtro.dono ?? ""}
          onChange={(e) => mudar({ dono: isDono(e.target.value) ? e.target.value : undefined })}
          className={selectCls}
        >
          <option value="">Todo dono</option>
          {donos.map((d) => (
            <option key={d} value={d}>
              {DONO_LABEL[d]}
            </option>
          ))}
        </select>
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        {SINAIS.map((s) => {
          const marcado = filtro.sinalizadores.includes(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={marcado}
              onClick={() =>
                mudar({
                  sinalizadores: marcado
                    ? filtro.sinalizadores.filter((x) => x !== s)
                    : [...filtro.sinalizadores, s],
                })
              }
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs",
                marcado ? "border-primary text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {SINALIZADOR_LABEL[s]}
            </button>
          );
        })}
        {temFiltro ? (
          <button
            type="button"
            onClick={() => setFiltro(FILTRO_VAZIO)}
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Limpar filtros
          </button>
        ) : null}
      </div>

      <DataTable
        columns={colunas}
        rows={filtradas}
        initialSortKey="createdAt"
        initialSortDir="desc"
        rowKey={(r) => r.id}
        detalhe={(r) => <DetalheDoLead r={r} />}
        emptyTitle={rows.length === 0 ? "Nenhum lead no período" : "Nenhum lead com esses filtros"}
        emptyHint={rows.length === 0 ? "Troque o período no cabeçalho." : "Limpe um filtro ou troque a aba."}
      />
    </div>
  );
}

// ---------------------------------------------------------------- excluídos

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
