"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Undo2 } from "lucide-react";
import { anotarLead, desfazerTentativa, registrarTentativa } from "@/app/(dashboard)/pessoas/actions";
import { RegistrarStatus } from "@/components/tables/lead-status";
import { CANAL_LABEL, linkWhatsapp, type CanalContato } from "@/lib/contato";
import { encerrado } from "@/lib/lead-status";
import type { LeadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Quanto tempo o "Desfazer" fica na tela depois de uma tentativa. */
const DESFAZER_MS = 10_000;

/**
 * As ações da ficha — as mesmas da Fila (tentativa, desfecho) mais a anotação.
 * Quem abre a ficha de alguém costuma estar com a pessoa na linha: registrar
 * tem de ser ali, não em outra tela.
 */
export function FichaAcoes({
  id,
  name,
  status,
  jaAgendou,
  tentativas,
  diasComTentativa,
  telefone,
  mensagemWhatsapp,
  canEdit,
  podeReabrir,
}: {
  id: string;
  name: string;
  status: LeadStatus;
  jaAgendou: boolean;
  tentativas: number;
  diasComTentativa: number;
  telefone?: string;
  mensagemWhatsapp: string;
  canEdit: boolean;
  podeReabrir: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [canal, setCanal] = useState<CanalContato>("whatsapp");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [desfazivel, setDesfazivel] = useState<string | null>(null);
  const [nota, setNota] = useState("");

  useEffect(() => {
    if (!desfazivel) return;
    const t = setTimeout(() => setDesfazivel(null), DESFAZER_MS);
    return () => clearTimeout(t);
  }, [desfazivel]);

  const fechado = encerrado(status);

  function tentativa(falou: boolean) {
    start(async () => {
      const r = await registrarTentativa(id, canal, falou);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setDesfazivel(r.eventoId ?? null);
        router.refresh();
      }
    });
  }

  function desfazer() {
    if (!desfazivel) return;
    const alvo = desfazivel;
    start(async () => {
      const r = await desfazerTentativa(id, alvo);
      setDesfazivel(null);
      setMsg({ ok: r.ok, text: r.message });
      router.refresh();
    });
  }

  function salvarNota() {
    start(async () => {
      const r = await anotarLead(id, nota);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setNota("");
        router.refresh();
      }
    });
  }

  const chip = (ativo: boolean) =>
    cn(
      "rounded-full border px-2.5 py-1 text-xs",
      ativo ? "border-primary text-primary" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="space-y-5">
      {telefone ? (
        <a
          href={linkWhatsapp(telefone, mensagemWhatsapp, name)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setCanal("whatsapp")}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-foreground/5"
        >
          <MessageCircle className="size-4 text-[var(--success-text)]" />
          Abrir o WhatsApp com a mensagem
        </a>
      ) : null}

      {canEdit && !fechado ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Tentativa de contato</h3>
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(CANAL_LABEL) as CanalContato[]).map((c) => (
              <button key={c} type="button" onClick={() => setCanal(c)} className={chip(canal === c)}>
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
            {desfazivel ? (
              <button
                type="button"
                disabled={pending}
                onClick={desfazer}
                className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium hover:bg-foreground/5 disabled:opacity-50"
              >
                <Undo2 className="size-3.5" />
                Desfazer
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {canEdit ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Desfecho</h3>
          <RegistrarStatus
            id={id}
            name={name}
            status={status}
            jaAgendou={jaAgendou}
            tentativas={tentativas}
            diasComTentativa={diasComTentativa}
            podeReabrir={podeReabrir}
            modo="botoes"
            onDone={(m) => {
              setMsg({ ok: true, text: m });
              router.refresh();
            }}
          />
        </section>
      ) : null}

      {canEdit ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Anotação</h3>
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="O que a pessoa disse, o que ficou combinado…"
            className="w-full rounded-lg border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
          <button
            type="button"
            disabled={pending || !nota.trim()}
            onClick={salvarNota}
            className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-foreground/5 disabled:opacity-50"
          >
            Salvar anotação
          </button>
        </section>
      ) : null}

      {msg ? (
        <p className={cn("text-xs", msg.ok ? "text-muted-foreground" : "text-[var(--danger-text)]")}>{msg.text}</p>
      ) : null}
    </div>
  );
}
