"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, RotateCcw } from "lucide-react";
import { resetSeedAction, resyncAdsCleanAction, type ActionState } from "@/app/(dashboard)/configuracoes/actions";
import { CONFIRMACAO_PERIGO } from "@/lib/perigo";
import { cn } from "@/lib/utils";
import { Message } from "./form-primitives";

/**
 * Zona de perigo (relatório §7.7, item 7). O navegador só pede a confirmação;
 * quem confere a palavra, o papel e registra na auditoria é o servidor
 * (`resetSeedAction`, `resyncAdsCleanAction`).
 */

export function ResetButton() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState | null>(null);
  const router = useRouter();
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const digitado = window.prompt(
            `Isso APAGA anúncios, Instagram e metas e grava o exemplo no lugar. Os leads reais não são apagados: ficam excluídos (dá para restaurar em Leads), com o histórico.\n\nPara confirmar, digite ${CONFIRMACAO_PERIGO}:`,
          );
          if (digitado == null) return;
          startTransition(async () => {
            const result = await resetSeedAction(digitado);
            setState(result);
            router.refresh();
          });
        }}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--danger-text)]/40 px-3 text-sm font-medium text-[var(--danger-text)] hover:bg-[var(--danger-text)]/5 disabled:opacity-50"
      >
        <RotateCcw className="size-4" />
        Restaurar dados de exemplo
      </button>
      <Message state={state} />
    </div>
  );
}

/**
 * Conserto de gasto dobrado (CSV somado à API): baixa da Meta todo o histórico
 * guardado e só então troca as linhas. Se a busca falhar, nada é apagado.
 * Confirma como o reset — a palavra digitada, não um "OK": o Enter num
 * `confirm` nativo trocava todo o `ad_daily` por engano.
 */
export function CleanResyncAdsButton() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState | null>(null);
  const router = useRouter();
  return (
    <div className="space-y-1.5 border-t pt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const digitado = window.prompt(
            `Isso baixa da Meta todo o histórico de anúncios guardado e, se a busca der certo, troca as linhas atuais pelas novas. Se a Meta falhar, nada é apagado. Leads e o restante não são afetados.\n\nPara confirmar, digite ${CONFIRMACAO_PERIGO}:`,
          );
          if (digitado == null) return;
          startTransition(async () => {
            const result = await resyncAdsCleanAction(digitado);
            setState(result);
            router.refresh();
          });
        }}
        className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <RefreshCw className={cn("size-4", pending && "animate-spin")} />
        {pending ? "Baixando da Meta…" : "Refazer o histórico de anúncios a partir da Meta"}
      </button>
      <p className="text-xs text-muted-foreground">
        Use se os números de tráfego pago estiverem dobrados (dados de CSV somados com os da Meta). Busca
        primeiro, troca depois: com a Meta fora do ar, nada é apagado.
      </p>
      <Message state={state} />
    </div>
  );
}
