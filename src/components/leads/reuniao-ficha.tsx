"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registrarResultadoDaReuniao } from "@/app/(dashboard)/leads/actions";
import { CopiarResumo } from "@/components/live/live-forms";
import { RESULTADOS_DA_REUNIAO, type ResultadoDaReuniao } from "@/lib/reuniao";
import { cn } from "@/lib/utils";

/**
 * A reunião na ficha (E5-05): a linha para o Brunno na véspera e, depois da
 * reunião realizada, o resultado que ainda não é status (proposta enviada ou vai
 * pensar). Vendeu e "não tem interesse" continuam pelo "Registrar" de sempre.
 */
export function ReuniaoNaFicha({
  id,
  status,
  vespera,
  resultado,
  canEdit,
}: {
  id: string;
  status: string;
  /** A linha da véspera; null quando não há reunião marcada pela frente. */
  vespera: string | null;
  resultado?: { resultado: ResultadoDaReuniao; quando: string };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function registrar(r: ResultadoDaReuniao) {
    start(async () => {
      const res = await registrarResultadoDaReuniao(id, r);
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok) router.refresh();
    });
  }

  if (!vespera && status !== "reuniao_realizada") return null;
  return (
    <div className="space-y-3 border-t pt-3">
      {vespera ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Para o Brunno, na véspera</p>
          <CopiarResumo texto={vespera} rotulo="Copiar mensagem da véspera" />
        </div>
      ) : null}
      {status === "reuniao_realizada" ? (
        <div className="space-y-2">
          <p className="text-xs font-medium">
            Resultado da reunião:{" "}
            <span className="font-normal text-muted-foreground">
              {resultado ? `${RESULTADOS_DA_REUNIAO[resultado.resultado]} (${resultado.quando})` : "ainda não registrado"}
            </span>
          </p>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              {(Object.keys(RESULTADOS_DA_REUNIAO) as ResultadoDaReuniao[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={pending}
                  onClick={() => registrar(r)}
                  className={cn(
                    "h-8 rounded-md border px-3 text-xs font-medium hover:bg-foreground/5 disabled:opacity-50",
                    resultado?.resultado === r && "border-primary/40 bg-primary/10",
                  )}
                >
                  {RESULTADOS_DA_REUNIAO[r]}
                </button>
              ))}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Vendeu: registre “Cliente” com o valor da carta. Não quis: “Não tem interesse” (o motivo vai numa anotação).
          </p>
          {msg ? (
            <p className={cn("text-xs", msg.ok ? "text-muted-foreground" : "text-[var(--danger-text)]")}>{msg.text}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
