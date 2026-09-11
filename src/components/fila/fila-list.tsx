"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock, MessageCircle, Check, ChevronDown, Mail } from "lucide-react";
import { salvarComercial } from "@/app/(dashboard)/comercial/actions";
import { changeLeadStatus } from "@/app/(dashboard)/funil/actions";
import {
  ETAPAS_QUENTES,
  FILA_ETAPAS,
  formatEspera,
  type FilaEtapa,
  type FilaItem,
  type FiltroFila,
} from "@/lib/fila";
import { LEAD_STATUS_META, LOST_STATUSES, statusLabel } from "@/lib/lead-status";
import type { LeadStatus } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A fila de contato — uma lista de telefones ordenada por quem está esperando
 * há mais tempo além do prazo da sua etapa.
 *
 * Cada cartão traz a ação do próprio degrau: quem foi transferido ao especialista
 * é marcado como "abordado" (que escreve nos DOIS bancos, via salvarComercial);
 * quem é lead do painel recebe um desfecho. Ver o problema e resolvê-lo é o mesmo
 * gesto — sem isso a lista viraria mais um relatório para copiar em outra tela.
 */

const ETAPA_COR: Record<FilaEtapa, string> = {
  "aguardando-contato": "text-[var(--danger-text)] border-[var(--danger)]/40",
  "convite-pendente": "text-[var(--warning-text)] border-[var(--warning)]/40",
  "sem-status": "text-muted-foreground",
};

function whatsappHref(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

function FilaCard({
  item,
  canEdit,
  onDone,
}: {
  item: FilaItem;
  canEdit: boolean;
  onDone: (id: string) => void;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const meta = FILA_ETAPAS[item.etapa];
  const atrasado = item.atraso > 1;

  function marcarAbordado() {
    if (!item.sessionId) return;
    start(async () => {
      const r = await salvarComercial(item.sessionId!, "abordado", "sim", item.telefone);
      setMsg(r.message);
      if (r.ok) onDone(item.id);
    });
  }

  function mudarStatus(status: LeadStatus) {
    if (!item.leadId) return;
    start(async () => {
      const r = await changeLeadStatus(item.leadId!, status);
      setMsg(r.message);
      if (r.ok) onDone(item.id);
    });
  }

  return (
    <Card className={cn(atrasado && item.etapa === "aguardando-contato" && "border-[var(--danger)]/40")}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{item.nome}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className={cn("inline-flex items-center gap-1", atrasado && ETAPA_COR[item.etapa])}>
                <Clock className="size-3" />
                {formatEspera(item.horasEsperando)}
                {atrasado ? ` · ${Math.floor(item.atraso)}× o prazo` : ""}
              </span>
              <span>{meta.label}</span>
              {item.score != null ? <span>score {item.score}</span> : null}
              {item.tambemEm.map((e) => (
                <span key={e} className="rounded border px-1.5 py-px">
                  também em {FILA_ETAPAS[e].label.toLowerCase()}
                </span>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {item.telefone ? (
              <a
                href={whatsappHref(item.telefone)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-foreground/5"
              >
                <MessageCircle className="size-3.5" />
                WhatsApp
              </a>
            ) : null}
            {canEdit && item.sessionId ? (
              <button
                type="button"
                onClick={marcarAbordado}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                <Check className="size-3.5" />
                Abordado
              </button>
            ) : null}
            {canEdit && !item.sessionId && item.leadId ? (
              <button
                type="button"
                onClick={() => setAberto((v) => !v)}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-foreground/5 disabled:opacity-50"
              >
                Registrar
                <ChevronDown className={cn("size-3.5 transition-transform", aberto && "rotate-180")} />
              </button>
            ) : null}
          </div>
        </div>

        {item.telefone || item.email ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {item.telefone ? <span className="tabular">{item.telefone}</span> : null}
            {item.email ? (
              <span className="inline-flex items-center gap-1 truncate">
                <Mail className="size-3" />
                {item.email}
              </span>
            ) : null}
          </div>
        ) : null}

        {item.briefing ? (
          <p className="rounded-md bg-foreground/[0.04] p-2.5 text-xs leading-relaxed text-muted-foreground">
            {item.briefing}
          </p>
        ) : null}

        {aberto && item.leadId ? (
          <div className="flex flex-wrap gap-1.5 border-t pt-3">
            {(["agendado", ...LOST_STATUSES] as LeadStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => mudarStatus(s)}
                disabled={pending}
                title={LEAD_STATUS_META[s].hint}
                className="rounded-md border px-2 py-1 text-xs hover:bg-foreground/5 disabled:opacity-50"
              >
                {statusLabel(s)}
              </button>
            ))}
          </div>
        ) : null}

        {msg ? <p className="text-xs text-muted-foreground">{msg}</p> : null}
      </CardContent>
    </Card>
  );
}

export function FilaList({
  itens,
  canEdit,
  filtroInicial = "todos",
}: {
  itens: FilaItem[];
  canEdit: boolean;
  /** Vem do link que trouxe até aqui (farol, ações da semana). */
  filtroInicial?: FiltroFila;
}) {
  const router = useRouter();
  const [resolvidos, setResolvidos] = useState<string[]>([]);
  const [filtro, setFiltro] = useState<FiltroFila>(filtroInicial);

  const noFiltro = (i: FilaItem, f: FiltroFila) =>
    f === "todos" || (f === "quentes" ? ETAPAS_QUENTES.includes(i.etapa) : i.etapa === f);

  const visiveis = useMemo(
    () => itens.filter((i) => !resolvidos.includes(i.id) && noFiltro(i, filtro)),
    [itens, resolvidos, filtro],
  );

  function onDone(id: string) {
    // Some da lista na hora e revalida no servidor: o comercial não perde o
    // lugar onde estava depois de cada ligação.
    setResolvidos((r) => [...r, id]);
    router.refresh();
  }

  // "Esperando contato agora" usa as MESMAS palavras e o MESMO número do farol.
  const abas: { key: FiltroFila; label: string }[] = [
    { key: "quentes", label: `Esperando contato agora (${itens.filter((i) => noFiltro(i, "quentes")).length})` },
    { key: "todos", label: `Todos (${itens.length})` },
    ...(Object.keys(FILA_ETAPAS) as FilaEtapa[]).map((e) => ({
      key: e,
      label: `${FILA_ETAPAS[e].label} (${itens.filter((i) => i.etapa === e).length})`,
    })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {abas.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => setFiltro(a.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              filtro === a.key ? "bg-foreground text-background" : "hover:bg-foreground/5",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          Ninguém esperando aqui. {resolvidos.length > 0 ? "Bom trabalho." : ""}
        </p>
      ) : (
        <div className="space-y-3">
          {visiveis.map((item) => (
            <FilaCard key={item.id} item={item} canEdit={canEdit} onDone={onDone} />
          ))}
        </div>
      )}
    </div>
  );
}
