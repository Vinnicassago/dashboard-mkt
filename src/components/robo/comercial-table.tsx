"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Mail, X, FileText } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { salvarComercial } from "@/app/(dashboard)/comercial/actions";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ComercialTableRow {
  session_id: string;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  score: number | null;
  saudacao_em: string | null;
  transferido_em: string | null;
  minutos_ate_transferencia: number | null;
  briefing: string | null;
  transcricao: string | null;
  abordado_em: string | null;
  reuniao_marcada: "sim" | "nao" | null;
  reuniao_realizada: "sim" | "nao" | null;
  negocio_fechado: "sim" | "nao" | null;
  obs_comercial: string | null;
  minutos_ate_abordagem: number | null;
}

type CampoDecisao = "reuniao_marcada" | "reuniao_realizada" | "negocio_fechado";

/** 27/08 12:47 — data curta, para a linha não crescer. */
function quandoCurto(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 135 → "2 h 15 min"; acima de um dia mostra "2 d 3 h". */
function duracao(min: number | null): string {
  if (min == null) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) {
    const m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(h / 24);
  const hr = h % 24;
  return hr ? `${d} d ${hr} h` : `${d} d`;
}

function Contato({ row }: { row: ComercialTableRow }) {
  if (!row.telefone && !row.email) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-0.5 whitespace-nowrap">
      {row.telefone ? (
        <a
          href={`https://wa.me/${row.telefone}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 hover:underline"
        >
          <MessageCircle className="size-3.5 text-[var(--success-text)]" />
          {row.telefone}
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

/** Botão compacto que abre o texto inteiro numa camada por cima. */
function TextoLongo({
  rotulo,
  titulo,
  texto,
  onAbrir,
}: {
  rotulo: string;
  titulo: string;
  texto: string | null;
  onAbrir: (t: { titulo: string; texto: string }) => void;
}) {
  if (!texto) return <span className="text-muted-foreground">—</span>;
  return (
    <button
      type="button"
      onClick={() => onAbrir({ titulo, texto })}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
    >
      <FileText className="size-3.5" />
      {rotulo}
    </button>
  );
}

function Modal({
  titulo,
  texto,
  onFechar,
}: {
  titulo: string;
  texto: string;
  onFechar: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onFechar}
      role="presentation"
    >
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-xl border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <h3 className="text-sm font-semibold">{titulo}</h3>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            className="rounded-md border p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{texto}</pre>
      </div>
    </div>
  );
}

function SelectSimNao({
  sessionId,
  telefone,
  campo,
  valor,
  rotulo,
  canEdit,
}: {
  sessionId: string;
  telefone: string | null;
  campo: CampoDecisao;
  valor: "sim" | "nao" | null;
  rotulo: string;
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const [nota, setNota] = useState<string | null>(null);
  const router = useRouter();

  if (!canEdit) {
    return valor ? (
      <Badge variant={valor === "sim" ? "good" : "muted"}>{valor === "sim" ? "Sim" : "Não"}</Badge>
    ) : (
      <span className="text-muted-foreground">—</span>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
    <select
      aria-label={rotulo}
      value={valor ?? ""}
      disabled={pending}
      onChange={(e) => {
        const v = e.target.value;
        // Venda fechada vira Purchase na Meta — o valor da carta ensina a
        // campanha a buscar negócio grande, não só volume.
        let valorNegocio: number | undefined;
        if (campo === "negocio_fechado" && v === "sim") {
          const raw = window.prompt("Valor da carta/contrato (R$):", "");
          if (raw === null) return;
          const parsed = Number(
            raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."),
          );
          valorNegocio = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
        }
        start(async () => {
          const r = await salvarComercial(sessionId, campo, v, telefone, valorNegocio);
          setNota(r.message);
          router.refresh();
        });
      }}
      className={cn(
        "h-7 rounded-md border bg-background px-1.5 text-xs focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
        pending && "opacity-50",
      )}
    >
      <option value="">—</option>
      <option value="sim">Sim</option>
      <option value="nao">Não</option>
    </select>
    {nota && nota !== "Salvo." ? (
      <span className="text-[11px] text-muted-foreground">{nota}</span>
    ) : null}
    </div>
  );
}

function Abordado({
  sessionId,
  abordadoEm,
  canEdit,
}: {
  sessionId: string;
  abordadoEm: string | null;
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!canEdit) {
    return abordadoEm ? <Badge variant="good">Sim</Badge> : <span className="text-muted-foreground">—</span>;
  }

  return (
    <select
      aria-label="Marcar como abordado"
      value={abordadoEm ? "sim" : ""}
      disabled={pending}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "" && abordadoEm && !window.confirm("Desmarcar apaga o horário do primeiro contato. Continuar?")) {
          return;
        }
        start(async () => {
          await salvarComercial(sessionId, "abordado", v);
          router.refresh();
        });
      }}
      className={cn(
        "h-7 rounded-md border bg-background px-1.5 text-xs focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
        pending && "opacity-50",
      )}
    >
      <option value="">—</option>
      <option value="sim">Sim</option>
    </select>
  );
}

function Observacao({
  sessionId,
  valor,
  canEdit,
}: {
  sessionId: string;
  valor: string | null;
  canEdit: boolean;
}) {
  const [texto, setTexto] = useState(valor ?? "");
  const [pending, start] = useTransition();
  const [salvo, setSalvo] = useState(false);
  const router = useRouter();

  if (!canEdit) {
    return <span className="text-xs text-muted-foreground">{valor || "—"}</span>;
  }

  return (
    <div className="flex w-52 flex-col gap-1">
      <textarea
        value={texto}
        rows={2}
        placeholder="Anotações do atendimento"
        disabled={pending}
        onChange={(e) => {
          setTexto(e.target.value);
          setSalvo(false);
        }}
        onBlur={() => {
          if (texto === (valor ?? "")) return;
          start(async () => {
            await salvarComercial(sessionId, "obs_comercial", texto);
            setSalvo(true);
            router.refresh();
          });
        }}
        className="w-full resize-y rounded-md border bg-background p-1.5 text-xs focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
      />
      {salvo ? <span className="text-[11px] text-muted-foreground">Salvo.</span> : null}
    </div>
  );
}

export function ComercialTable({
  rows,
  canEdit = true,
}: {
  rows: ComercialTableRow[];
  canEdit?: boolean;
}) {
  const [modal, setModal] = useState<{ titulo: string; texto: string } | null>(null);

  const columns: Column<ComercialTableRow>[] = [
    {
      key: "saudacao",
      header: "Contato robô",
      sortable: true,
      sortValue: (r) => r.saudacao_em ?? "",
      render: (r) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {quandoCurto(r.saudacao_em)}
        </span>
      ),
    },
    {
      key: "nome",
      header: "Nome",
      sortable: true,
      sortValue: (r) => r.nome ?? "",
      render: (r) => <span className="font-medium whitespace-nowrap">{r.nome ?? "—"}</span>,
    },
    {
      key: "ate_transferencia",
      header: "Até transferir",
      align: "right",
      sortable: true,
      sortValue: (r) => r.minutos_ate_transferencia ?? Number.MAX_SAFE_INTEGER,
      render: (r) => (
        <span
          title={r.transferido_em ? `Transferido em ${formatDateTime(r.transferido_em)}` : undefined}
          className={cn("whitespace-nowrap", r.minutos_ate_transferencia == null && "text-muted-foreground")}
        >
          {duracao(r.minutos_ate_transferencia)}
        </span>
      ),
    },
    { key: "contato", header: "Contato", render: (r) => <Contato row={r} /> },
    {
      key: "briefing",
      header: "Contexto",
      render: (r) => (
        <TextoLongo
          rotulo="Contexto"
          titulo={`Contexto — ${r.nome ?? "lead"}`}
          texto={r.briefing}
          onAbrir={setModal}
        />
      ),
    },
    {
      key: "transcricao",
      header: "Transcrição",
      render: (r) => (
        <TextoLongo
          rotulo="Conversa"
          titulo={`Conversa — ${r.nome ?? "lead"}`}
          texto={r.transcricao}
          onAbrir={setModal}
        />
      ),
    },
    {
      key: "abordado",
      header: "Abordado",
      render: (r) => (
        <Abordado sessionId={r.session_id} abordadoEm={r.abordado_em} canEdit={canEdit} />
      ),
    },
    {
      key: "tempo",
      header: "Até 1º contato",
      align: "right",
      sortable: true,
      sortValue: (r) => r.minutos_ate_abordagem ?? Number.MAX_SAFE_INTEGER,
      render: (r) => (
        <span className={cn(r.minutos_ate_abordagem == null && "text-muted-foreground")}>
          {duracao(r.minutos_ate_abordagem)}
        </span>
      ),
    },
    {
      key: "reuniao_marcada",
      header: "Reunião marcada",
      render: (r) => (
        <SelectSimNao
          sessionId={r.session_id}
          telefone={r.telefone}
          campo="reuniao_marcada"
          valor={r.reuniao_marcada}
          rotulo={`Reunião marcada com ${r.nome ?? "lead"}`}
          canEdit={canEdit}
        />
      ),
    },
    {
      key: "reuniao_realizada",
      header: "Reunião realizada",
      render: (r) => (
        <SelectSimNao
          sessionId={r.session_id}
          telefone={r.telefone}
          campo="reuniao_realizada"
          valor={r.reuniao_realizada}
          rotulo={`Reunião realizada com ${r.nome ?? "lead"}`}
          canEdit={canEdit}
        />
      ),
    },
    {
      key: "negocio_fechado",
      header: "Negócio fechado",
      render: (r) => (
        <SelectSimNao
          sessionId={r.session_id}
          telefone={r.telefone}
          campo="negocio_fechado"
          valor={r.negocio_fechado}
          rotulo={`Negócio fechado com ${r.nome ?? "lead"}`}
          canEdit={canEdit}
        />
      ),
    },
    {
      key: "obs",
      header: "Anotações",
      render: (r) => (
        <Observacao sessionId={r.session_id} valor={r.obs_comercial} canEdit={canEdit} />
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.session_id}
        initialSortKey="tempo"
        initialSortDir="asc"
        emptyTitle="Nenhum lead transferido ainda"
        emptyHint="Quando o robô qualificar um lead e o cliente autorizar o contato, ele aparece aqui."
      />
      {modal ? (
        <Modal titulo={modal.titulo} texto={modal.texto} onFechar={() => setModal(null)} />
      ) : null}
    </>
  );
}
