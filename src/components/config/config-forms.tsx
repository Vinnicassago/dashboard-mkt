"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Download, RefreshCw, RotateCcw, Upload } from "lucide-react";
import {
  addLeadAction,
  addManualIgDay,
  importAdsCsv,
  resetSeedAction,
  resyncAdsCleanAction,
  setGoalsAction,
  syncNowAction,
  type ActionState,
} from "@/app/(dashboard)/config/actions";
import { cn } from "@/lib/utils";

const inputCls =
  "h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40";
const labelCls = "text-xs font-medium text-muted-foreground";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

function SubmitButton({ children }: { children: React.ReactNode }) {
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

function Message({ state }: { state: ActionState | null }) {
  if (!state) return null;
  return (
    <p
      className={cn(
        "text-sm",
        state.ok ? "text-[var(--success-text)]" : "text-[var(--danger-text)]",
      )}
    >
      {state.message}
    </p>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

// ---- CSV import -----------------------------------------------------

export function ImportForm({ template }: { template: string }) {
  const [state, action] = useActionState(importAdsCsv, null);

  function downloadTemplate() {
    const blob = new Blob([template], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-anuncios.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <form action={action} className="space-y-3">
      <input
        type="file"
        name="file"
        accept=".csv,text/csv"
        className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary"
      />
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton>
          <Upload className="size-4" />
          Importar CSV
        </SubmitButton>
        <button
          type="button"
          onClick={downloadTemplate}
          className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <Download className="size-4" />
          Baixar modelo
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

// ---- manual Instagram day ------------------------------------------

export function ManualIgForm() {
  const [state, action] = useActionState(addManualIgDay, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Data">
          <input type="date" name="date" defaultValue={today()} className={inputCls} required />
        </Field>
        <Field label="Seguidores (total)">
          <input type="number" name="followers" min="0" className={inputCls} />
        </Field>
        <Field label="Alcance">
          <input type="number" name="reach" min="0" className={inputCls} />
        </Field>
        <Field label="Views">
          <input type="number" name="views" min="0" className={inputCls} />
        </Field>
        <Field label="Cliques no link">
          <input type="number" name="profileLinkTaps" min="0" className={inputCls} />
        </Field>
        <Field label="Contas engajadas">
          <input type="number" name="accountsEngaged" min="0" className={inputCls} />
        </Field>
        <Field label="Interações">
          <input type="number" name="totalInteractions" min="0" className={inputCls} />
        </Field>
      </div>
      <SubmitButton>Salvar snapshot</SubmitButton>
      <Message state={state} />
    </form>
  );
}

// ---- add lead -------------------------------------------------------

export function LeadForm({ creatives }: { creatives: { adId: string; name: string }[] }) {
  const [state, action] = useActionState(addLeadAction, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nome">
          <input type="text" name="name" className={inputCls} required />
        </Field>
        <Field label="Data de entrada">
          <input type="date" name="date" defaultValue={today()} className={inputCls} required />
        </Field>
        <Field label="Telefone / WhatsApp">
          <input type="tel" name="phone" placeholder="(11) 98765-4321" className={inputCls} />
        </Field>
        <Field label="E-mail">
          <input type="email" name="email" placeholder="nome@email.com" className={inputCls} />
        </Field>
        <Field label="Origem (criativo)">
          <select name="utmContent" className={inputCls} defaultValue="">
            <option value="">— não sei —</option>
            {creatives.map((c) => (
              <option key={c.adId} value={c.adId}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select name="status" className={inputCls} defaultValue="lead">
            <option value="lead">Lead</option>
            <option value="agendou">Agendou reunião</option>
            <option value="compareceu">Compareceu</option>
            <option value="perdido">Perdido</option>
          </select>
        </Field>
        <Field label="Data da reunião (opcional)">
          <input type="date" name="meetingAt" className={inputCls} />
        </Field>
      </div>
      <SubmitButton>Adicionar lead</SubmitButton>
      <Message state={state} />
    </form>
  );
}

// ---- goals ----------------------------------------------------------

export function GoalsForm({ current }: { current: Partial<Record<string, number>> }) {
  const [state, action] = useActionState(setGoalsAction, null);
  const fields: { metric: string; label: string }[] = [
    { metric: "leads", label: "Leads (meta)" },
    { metric: "meetings", label: "Reuniões (meta)" },
    { metric: "cpl", label: "CPL alvo (R$)" },
    { metric: "cpr", label: "Custo/reunião alvo (R$)" },
    { metric: "followers", label: "Seguidores (meta)" },
  ];
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {fields.map((f) => (
          <Field key={f.metric} label={f.label}>
            <input
              type="number"
              name={`target_${f.metric}`}
              min="0"
              step="any"
              defaultValue={current[f.metric] ?? ""}
              className={inputCls}
            />
          </Field>
        ))}
      </div>
      <SubmitButton>Salvar metas</SubmitButton>
      <Message state={state} />
    </form>
  );
}

// ---- sync now -------------------------------------------------------

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
      <CleanResyncAdsButton />
    </div>
  );
}

/**
 * Fix for double-counted spend: wipes ad_daily + creatives (where CSV imports
 * and API rows live under different keys and get summed) and re-pulls cleanly
 * from Meta. Leads and everything else are untouched.
 */
function CleanResyncAdsButton() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState | null>(null);
  const router = useRouter();
  return (
    <div className="space-y-1.5 border-t pt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (
            !window.confirm(
              "Isso APAGA os dados de anúncios (gasto, criativos) e baixa tudo de novo, limpo, direto da Meta.\n\nSeus leads e o restante NÃO são afetados. Continuar?",
            )
          ) {
            return;
          }
          startTransition(async () => {
            const result = await resyncAdsCleanAction();
            setState(result);
            router.refresh();
          });
        }}
        className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <RefreshCw className={cn("size-4", pending && "animate-spin")} />
        {pending ? "Limpando e ressincronizando…" : "Zerar anúncios e ressincronizar"}
      </button>
      <p className="text-xs text-muted-foreground">
        Use se os números de tráfego pago estiverem dobrados (dados de CSV somados com os da Meta).
      </p>
      <Message state={state} />
    </div>
  );
}

// ---- reset ----------------------------------------------------------

export function ResetButton({ destructive = false }: { destructive?: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (
          destructive &&
          !window.confirm(
            "Isso APAGA os dados atuais do banco e grava o dataset de exemplo no lugar. Continuar?",
          )
        ) {
          return;
        }
        startTransition(async () => {
          await resetSeedAction();
          router.refresh();
        });
      }}
      className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      <RotateCcw className="size-4" />
      Restaurar dados de exemplo
    </button>
  );
}
