"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { salvarManuaisDaLive } from "@/app/(dashboard)/configuracoes/live-actions";
import type { RelatorioDaLive } from "@/lib/live-painel";
import { cn } from "@/lib/utils";

const numCls = "h-8 w-28 rounded-md border bg-background px-2 text-xs tabular-nums disabled:opacity-70";

/** Presentes na live (pico e total) e vendas (quantidade e valor de carta) — o que o sistema não sabe. */
export function ManuaisForm({
  atual,
  podeEditar,
}: {
  atual: { presentesPico?: number; presentesTotal?: number; vendasQtd?: number; vendasValor?: number; atualizadoEm?: string; atualizadoPor?: string };
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState({
    presentesPico: atual.presentesPico?.toString() ?? "",
    presentesTotal: atual.presentesTotal?.toString() ?? "",
    vendasQtd: atual.vendasQtd?.toString() ?? "",
    vendasValor: atual.vendasValor?.toString() ?? "",
  });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

  function salvar() {
    start(async () => {
      const r = await salvarManuaisDaLive({
        presentesPico: n(v.presentesPico),
        presentesTotal: n(v.presentesTotal),
        vendasQtd: n(v.vendasQtd),
        vendasValor: n(v.vendasValor),
      });
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }

  const campo = (k: keyof typeof v, rotulo: string, step = "1") => (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {rotulo}
      <input
        type="number"
        min="0"
        step={step}
        value={v[k]}
        disabled={!podeEditar || pending}
        onChange={(e) => setV((cur) => ({ ...cur, [k]: e.target.value }))}
        className={numCls}
      />
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4">
        {campo("presentesPico", "Presentes — pico")}
        {campo("presentesTotal", "Presentes — total")}
        {campo("vendasQtd", "Vendas — quantidade")}
        {campo("vendasValor", "Vendas — valor de carta (R$)", "100")}
      </div>
      <p className="text-xs text-muted-foreground">
        {atual.atualizadoEm
          ? `Último registro: ${new Date(atual.atualizadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}${atual.atualizadoPor ? ` por ${atual.atualizadoPor}` : ""}.`
          : "Ainda sem registro — o YouTube e as vendas não chegam sozinhos."}
      </p>
      {podeEditar ? (
        <button
          type="button"
          disabled={pending}
          onClick={salvar}
          className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Salvando…" : "Salvar números"}
        </button>
      ) : null}
      {msg ? <p className={cn("text-xs", msg.ok ? "text-muted-foreground" : "text-[var(--danger-text)]")}>{msg.text}</p> : null}
    </div>
  );
}

/** Os textos que as tarefas da live pedem: escolhe qual, copia e mostra junto. */
export function RelatoriosParaCopiar({ relatorios }: { relatorios: RelatorioDaLive[] }) {
  const [id, setId] = useState(relatorios[0]?.id);
  const atual = relatorios.find((r) => r.id === id) ?? relatorios[0];
  if (!atual) return null;
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Relatório" className="flex flex-wrap gap-1.5">
        {relatorios.map((r) => (
          <button
            key={r.id}
            type="button"
            role="tab"
            aria-selected={r.id === atual.id}
            onClick={() => setId(r.id)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs",
              r.id === atual.id ? "border-primary/40 bg-primary/10 font-medium" : "text-muted-foreground hover:bg-foreground/5",
            )}
          >
            {r.rotulo} <span className="text-muted-foreground">· {r.quando}</span>
          </button>
        ))}
      </div>
      <CopiarResumo key={atual.id} texto={atual.texto} rotulo={`Copiar ${atual.rotulo.split(" (")[0].toLowerCase()}`} />
    </div>
  );
}

/** Copia um texto para o ClickUp; mostra o texto junto, para conferir e copiar à mão. */
export function CopiarResumo({ texto, rotulo = "Copiar resumo semanal" }: { texto: string; rotulo?: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(texto);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2500);
          } catch {
            setCopiado(false);
          }
        }}
        className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-foreground/5"
      >
        {copiado ? <Check className="size-4 text-[var(--success-text)]" /> : <Copy className="size-4" />}
        {copiado ? "Copiado" : rotulo}
      </button>
      <pre className="whitespace-pre-wrap rounded-lg border bg-foreground/[0.03] p-3 font-mono text-xs leading-relaxed">{texto}</pre>
    </div>
  );
}
