"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { reenviarCapiAction, setRoboAtivoAction, syncNowAction, type ActionState } from "@/app/(dashboard)/configuracoes/actions";
import { cn } from "@/lib/utils";
import { LIMITE_REENVIO_MANUAL } from "@/lib/capi-politica";
import { Message, SubmitButton, inputCls } from "./form-primitives";

/** Integrações e saúde (relatório §7.7, item 2): sincronizar agora e a chave do robô. */

export function SyncPanel() {
  const [state, action] = useActionState(syncNowAction, null);
  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <select name="source" defaultValue="all" className={cn(inputCls, "w-auto")}>
            <option value="all">Tudo</option>
            <option value="ads">Só tráfego pago</option>
            <option value="instagram">Só Instagram</option>
          </select>
          <SubmitButton>
            <RefreshCw className="size-4" />
            Sincronizar agora
          </SubmitButton>
        </div>
        <Message state={state} />
      </form>
    </div>
  );
}

/** Chave liga/desliga do robô de WhatsApp + atendimento do especialista (D5). */
export function RoboToggle({ ativo }: { ativo: boolean }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState | null>(null);
  const router = useRouter();
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={ativo}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await setRoboAtivoAction(!ativo);
            setState(r);
            router.refresh();
          })
        }
        className={cn(
          "inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium disabled:opacity-50",
          ativo ? "border-[var(--success-text)]/40 text-[var(--success-text)]" : "text-muted-foreground",
        )}
      >
        {pending ? "…" : ativo ? "Ativo — desativar" : "Desativado — ativar"}
      </button>
      {state ? <span className="max-w-56 text-right text-[11px] text-muted-foreground">{state.message}</span> : null}
    </div>
  );
}

/** "Reenviar agora" dos eventos da CAPI que ainda não chegaram (Fase 7). */
export function ReenviarCapi({ pendentes }: { pendentes: number }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState | null>(null);
  const router = useRouter();
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await reenviarCapiAction();
            setState(r);
            router.refresh();
          })
        }
        className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium disabled:opacity-50"
      >
        <RefreshCw className="size-3.5" />
        {pending
          ? "Reenviando…"
          : pendentes > LIMITE_REENVIO_MANUAL
            ? `Reenviar agora (${LIMITE_REENVIO_MANUAL} de ${pendentes})`
            : `Reenviar agora${pendentes > 0 ? ` (${pendentes})` : ""}`}
      </button>
      {state ? <span className="max-w-56 text-right text-[11px] text-muted-foreground">{state.message}</span> : null}
    </div>
  );
}
