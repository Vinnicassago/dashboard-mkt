"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, MessageCircle, Check, ChevronDown, Mail, Undo2 } from "lucide-react";
import { salvarComercial } from "@/app/(dashboard)/pessoas/comercial-actions";
import { desfazerTentativa, registrarTentativa } from "@/app/(dashboard)/pessoas/actions";
import { RegistrarStatus } from "@/components/tables/lead-status";
import {
  ETAPAS_QUENTES,
  FILA_ETAPAS,
  formatEspera,
  type FilaEtapa,
  type FilaItem,
  type FiltroFila,
} from "@/lib/fila";
import { CANAL_LABEL, linkWhatsapp, type CanalContato } from "@/lib/contato";
import { formatDateTime } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A fila de contato — o painel de trabalho do comercial.
 *
 * Cada cartão traz a ação do próprio degrau: quem foi transferido ao especialista
 * é marcado como "abordado"; lead do painel recebe TENTATIVA (canal + resultado,
 * em um clique) ou DESFECHO. Ver o problema e resolvê-lo é o mesmo gesto — sem
 * isso a lista viraria mais um relatório para copiar em outra tela.
 */

/** Cor do prazo: verde até metade, âmbar até estourar, vermelho depois. */
function corDoPrazo(atraso: number): string {
  if (atraso >= 1) return "text-[var(--danger-text)]";
  if (atraso >= 0.5) return "text-[var(--warning-text)]";
  return "text-[var(--success-text)]";
}

const horaBrt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});

/** Linha de contexto do cartão: o que esperar desta pessoa, em uma frase. */
function Contexto({ item }: { item: FilaItem }) {
  if (item.etapa === "novo" && item.venceEm && item.atraso < 1) {
    return <span>prazo vence às {horaBrt.format(new Date(item.venceEm))}</span>;
  }
  if (item.etapa === "retornar" && item.contato) {
    const c = item.contato;
    return (
      <span>
        {c.tentativas} {c.tentativas === 1 ? "tentativa" : "tentativas"}
        {c.ultima ? ` · última ${formatDateTime(c.ultima)}` : ""}
        {item.status === "no_show" ? " · não compareceu" : c.falou ? " · já falou, sem desfecho" : ""}
      </span>
    );
  }
  if (item.reuniao) return <span>reunião {formatDateTime(item.reuniao)}</span>;
  return null;
}

function FilaCard({
  item,
  canEdit,
  mensagemWhatsapp,
  onDone,
  onTentativa,
}: {
  item: FilaItem;
  canEdit: boolean;
  mensagemWhatsapp: string;
  onDone: (id: string) => void;
  onTentativa: (
    t: { leadId: string; eventoId: string; nome: string; itemId: string; msg: string },
    /** Falou com a pessoa: o cartão fica na tela até o desfecho. */
    fixar?: FilaItem,
  ) => void;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [painel, setPainel] = useState<"tentativa" | "desfecho" | null>(
    item.etapa === "confirmar" || item.etapa === "sem-desfecho" ? "desfecho" : null,
  );
  const [canal, setCanal] = useState<CanalContato>("whatsapp");
  const meta = FILA_ETAPAS[item.etapa];
  const doPainel = Boolean(item.leadId && !item.sessionId);
  const aceitaTentativa = doPainel && (item.etapa === "novo" || item.etapa === "retornar");

  function marcarAbordado() {
    if (!item.sessionId) return;
    start(async () => {
      const r = await salvarComercial(item.sessionId!, "abordado", "sim", item.telefone);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) onDone(item.id);
    });
  }

  function tentativa(falou: boolean) {
    if (!item.leadId) return;
    start(async () => {
      const r = await registrarTentativa(item.leadId!, canal, falou);
      setMsg({ ok: r.ok, text: r.message });
      if (!r.ok || !r.eventoId) return;
      if (falou) {
        // Falou com a pessoa: o próximo passo é o desfecho, no mesmo cartão — que
        // fica fixado, porque o servidor já tirou o lead da fila.
        setPainel("desfecho");
        onTentativa(
          { leadId: item.leadId!, eventoId: r.eventoId, nome: item.nome, itemId: "", msg: r.message },
          { ...item, status: item.status === "lead" ? "em_contato" : item.status },
        );
      } else {
        onTentativa({ leadId: item.leadId!, eventoId: r.eventoId, nome: item.nome, itemId: item.id, msg: r.message });
      }
    });
  }

  return (
    <Card className={cn(item.atraso >= 1 && item.etapa !== "confirmar" && "border-[var(--danger)]/40")}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {item.leadId ? (
              <Link
                href={`/pessoas/${encodeURIComponent(item.leadId)}`}
                className="block truncate font-medium hover:underline"
                title="Abrir a ficha"
              >
                {item.nome}
              </Link>
            ) : (
              <p className="truncate font-medium">{item.nome}</p>
            )}
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {item.etapa !== "confirmar" ? (
                <span className={cn("inline-flex items-center gap-1 font-medium", corDoPrazo(item.atraso))}>
                  <Clock className="size-3" />
                  {formatEspera(item.horasEsperando)}
                  {item.atraso >= 1 ? ` · ${Math.floor(item.atraso)}× o prazo` : ""}
                </span>
              ) : null}
              <span>{meta.label}</span>
              <Contexto item={item} />
              {item.score != null ? <span>score {item.score}</span> : null}
              {item.tambemEm.map((e) => (
                <span key={e} className="rounded border px-1.5 py-px">
                  também em {FILA_ETAPAS[e].label.toLowerCase()}
                </span>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {item.telefone ? (
              <a
                href={linkWhatsapp(item.telefone, mensagemWhatsapp, item.nome)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  // Depois de mandar a mensagem, registrar é um clique.
                  if (aceitaTentativa && canEdit) {
                    setCanal("whatsapp");
                    setPainel("tentativa");
                  }
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-foreground/5"
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
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                <Check className="size-3.5" />
                Abordado
              </button>
            ) : null}
            {canEdit && aceitaTentativa ? (
              <button
                type="button"
                onClick={() => setPainel((p) => (p === "tentativa" ? null : "tentativa"))}
                disabled={pending}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-foreground/5 disabled:opacity-50",
                  painel === "tentativa" && "border-primary text-primary",
                )}
              >
                Tentativa
                <ChevronDown className={cn("size-3.5 transition-transform", painel === "tentativa" && "rotate-180")} />
              </button>
            ) : null}
            {canEdit && doPainel ? (
              <button
                type="button"
                onClick={() => setPainel((p) => (p === "desfecho" ? null : "desfecho"))}
                disabled={pending}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-foreground/5 disabled:opacity-50",
                  painel === "desfecho" && "border-primary text-primary",
                )}
              >
                Desfecho
                <ChevronDown className={cn("size-3.5 transition-transform", painel === "desfecho" && "rotate-180")} />
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

        {painel === "tentativa" && aceitaTentativa ? (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground">Canal:</span>
            {(Object.keys(CANAL_LABEL) as CanalContato[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCanal(c)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs",
                  canal === c ? "border-primary text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {CANAL_LABEL[c]}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <button
              type="button"
              disabled={pending}
              onClick={() => tentativa(false)}
              className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-foreground/5 disabled:opacity-50"
            >
              Sem resposta
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => tentativa(true)}
              className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              Conseguiu falar
            </button>
          </div>
        ) : null}

        {painel === "desfecho" && item.leadId && item.status ? (
          <div className="border-t pt-3">
            <RegistrarStatus
              id={item.leadId}
              name={item.nome}
              status={item.status}
              jaAgendou={item.jaAgendou ?? false}
              tentativas={item.contato?.tentativas}
              diasComTentativa={item.contato?.diasComTentativa}
              modo="botoes"
              onDone={(m) => {
                setMsg({ ok: true, text: m });
                onDone(item.id);
              }}
            />
          </div>
        ) : null}

        {msg ? (
          <p className={cn("text-xs", msg.ok ? "text-muted-foreground" : "text-[var(--danger-text)]")}>{msg.text}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface UltimaTentativa {
  leadId: string;
  eventoId: string;
  nome: string;
  itemId: string;
  msg: string;
}

/** Quanto tempo o "Desfazer" fica na tela depois de uma tentativa. */
const DESFAZER_MS = 10_000;

export function FilaList({
  itens,
  canEdit,
  filtroInicial = "todos",
  etapasVisiveis,
  mensagemWhatsapp,
}: {
  itens: FilaItem[];
  canEdit: boolean;
  /** Vem do link que trouxe até aqui (farol, ações da semana). */
  filtroInicial?: FiltroFila;
  /** Etapas que existem nesta operação (sem as do robô quando ele está desligado). */
  etapasVisiveis: FilaEtapa[];
  /** Modelo da mensagem do WhatsApp; `{nome}` vira o primeiro nome. */
  mensagemWhatsapp: string;
}) {
  const router = useRouter();
  const [resolvidos, setResolvidos] = useState<string[]>([]);
  const [filtro, setFiltro] = useState<FiltroFila>(filtroInicial);
  const [ultima, setUltima] = useState<UltimaTentativa | null>(null);
  /** Cartões que a lista do servidor já tirou mas ainda esperam o desfecho. */
  const [fixos, setFixos] = useState<FilaItem[]>([]);
  const [desfazendo, startDesfazer] = useTransition();

  // O "Desfazer" some sozinho depois de alguns segundos.
  useEffect(() => {
    if (!ultima) return;
    const t = setTimeout(() => setUltima(null), DESFAZER_MS);
    return () => clearTimeout(t);
  }, [ultima]);

  const noFiltro = (i: FilaItem, f: FiltroFila) =>
    f === "todos" || (f === "quentes" ? ETAPAS_QUENTES.includes(i.etapa) : i.etapa === f);

  const visiveis = useMemo(() => {
    const doServidor = new Set(itens.map((i) => i.id));
    const extras = fixos.filter((f) => !doServidor.has(f.id));
    return [...extras, ...itens].filter((i) => !resolvidos.includes(i.id) && (extras.includes(i) || noFiltro(i, filtro)));
  }, [itens, fixos, resolvidos, filtro]);

  function onDone(id: string) {
    // Some da lista na hora e revalida no servidor: o comercial não perde o
    // lugar onde estava depois de cada ligação.
    setResolvidos((r) => [...r, id]);
    setFixos((f) => f.filter((x) => x.id !== id));
    router.refresh();
  }

  function onTentativa(t: UltimaTentativa, fixar?: FilaItem) {
    setUltima(t);
    if (fixar) setFixos((f) => [fixar, ...f.filter((x) => x.id !== fixar.id)]);
    if (t.itemId) onDone(t.itemId);
  }

  function desfazer() {
    if (!ultima) return;
    const alvo = ultima;
    startDesfazer(async () => {
      await desfazerTentativa(alvo.leadId, alvo.eventoId);
      setUltima(null);
      setResolvidos((r) => r.filter((id) => id !== alvo.itemId));
      router.refresh();
    });
  }

  const abas: { key: FiltroFila; label: string }[] = [
    // "Esperando contato agora" usa as MESMAS palavras e o MESMO número do farol.
    ...(etapasVisiveis.some((e) => ETAPAS_QUENTES.includes(e))
      ? [{ key: "quentes" as FiltroFila, label: `Esperando contato agora (${itens.filter((i) => noFiltro(i, "quentes")).length})` }]
      : []),
    { key: "todos", label: `Todos (${itens.length})` },
    ...etapasVisiveis.map((e) => ({
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

      {ultima ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-xs">
          <span>
            <span className="font-medium">{ultima.nome}:</span> {ultima.msg}
          </span>
          <button
            type="button"
            onClick={desfazer}
            disabled={desfazendo}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium hover:bg-foreground/5 disabled:opacity-50"
          >
            <Undo2 className="size-3.5" />
            Desfazer
          </button>
        </div>
      ) : null}

      {visiveis.length === 0 ? (
        <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          Ninguém esperando aqui. {resolvidos.length > 0 ? "Bom trabalho." : ""}
        </p>
      ) : (
        <div className="space-y-3">
          {visiveis.map((item) => (
            <FilaCard
              key={item.id}
              item={item}
              canEdit={canEdit}
              mensagemWhatsapp={mensagemWhatsapp}
              onDone={onDone}
              onTentativa={onTentativa}
            />
          ))}
        </div>
      )}
    </div>
  );
}
