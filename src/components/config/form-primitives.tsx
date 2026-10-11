"use client";

import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/(dashboard)/configuracoes/actions";
import { cn } from "@/lib/utils";

/** Peças comuns dos formulários de Configurações (um arquivo por vista). */

export const inputCls =
  "h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40";
export const labelCls = "text-xs font-medium text-muted-foreground";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function Message({ state }: { state: ActionState | null }) {
  if (!state) return null;
  return (
    <p className={cn("text-sm", state.ok ? "text-[var(--success-text)]" : "text-[var(--danger-text)]")}>
      {state.message}
    </p>
  );
}

/** Data LOCAL (não UTC): à noite no Brasil, toISOString() já apontaria p/ amanhã. */
export const hojeLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Baixa um texto como arquivo (modelos de CSV). */
export function baixarArquivo(nome: string, conteudo: string, tipo = "text/csv;charset=utf-8") {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}
