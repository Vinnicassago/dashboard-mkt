"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registrarConferencia } from "@/app/(dashboard)/midia/conferencia-actions";
import { conferenciaBate, lerValorEmReais, textoDaDiferenca } from "@/lib/conferencia";
import { formatCurrency0, formatDateTime } from "@/lib/format";
import type { ConferenciaGasto } from "@/lib/types";
import { cn } from "@/lib/utils";

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Conferir com o Gerenciador (E2-23): o gasto do período e o último sync, o
 * valor que o Gerenciador mostra, a diferença em % (até 5% verde, acima
 * vermelho) e o histórico das conferências.
 */
export function ConferenciaGerenciador({
  gastoPainel,
  periodo,
  ultimoSync,
  rangeKey,
  historico,
  podeEditar,
}: {
  gastoPainel: number;
  periodo: string;
  ultimoSync: string | null;
  rangeKey?: string;
  historico: ConferenciaGasto[];
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [valor, setValor] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; bate?: boolean; text: string } | null>(null);

  function conferir() {
    const v = lerValorEmReais(valor);
    start(async () => {
      const r = await registrarConferencia(rangeKey, v);
      setMsg({ ok: r.ok, bate: r.bate, text: r.message });
      if (r.ok) {
        setValor("");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-6 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Gasto no painel · {periodo}</p>
          <p className="tabular text-xl font-semibold">{formatCurrency0(gastoPainel)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Último sync de anúncios que deu certo</p>
          <p className="tabular">{ultimoSync ? formatDateTime(ultimoSync) : "nenhum registrado"}</p>
        </div>
        {podeEditar ? (
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Gasto que o Gerenciador mostra (R$)
              <input
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="ex.: 3.612,40"
                className="h-9 w-40 rounded-lg border bg-background px-2 text-sm tabular-nums"
              />
            </label>
            <button
              type="button"
              disabled={pending || !valor.trim()}
              onClick={conferir}
              className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {pending ? "Conferindo…" : "Conferir"}
            </button>
          </div>
        ) : null}
      </div>
      {msg ? (
        <p
          className={cn(
            "text-sm",
            !msg.ok ? "text-[var(--danger-text)]" : msg.bate ? "text-[var(--status-ok-text)]" : "text-[var(--status-fora-text)]",
          )}
          role="status"
        >
          {msg.text}
        </p>
      ) : null}
      {historico.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs tabular-nums">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Quando</th>
                <th className="py-1.5 pr-3 font-medium">Período</th>
                <th className="py-1.5 pr-3 text-right font-medium">Painel</th>
                <th className="py-1.5 pr-3 text-right font-medium">Gerenciador</th>
                <th className="py-1.5 pr-3 text-right font-medium">Diferença</th>
                <th className="py-1.5 font-medium">Por</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {historico.map((c) => {
                const bate = conferenciaBate(c.diferenca);
                return (
                  <tr key={c.id}>
                    <td className="py-1.5 pr-3">{formatDateTime(c.criadaEm)}</td>
                    <td className="py-1.5 pr-3">
                      {dataBr(c.periodoDe)} a {dataBr(c.periodoAte)}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{formatCurrency0(c.gastoPainel)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatCurrency0(c.gastoGerenciador)}</td>
                    <td className={cn("py-1.5 pr-3 text-right font-medium", bate ? "text-[var(--status-ok-text)]" : "text-[var(--status-fora-text)]")}>
                      {textoDaDiferenca(c.diferenca)} {bate ? "· ok" : "· acima de 5%"}
                    </td>
                    <td className="py-1.5">{c.criadaPor}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhuma conferência registrada ainda.</p>
      )}
    </div>
  );
}
