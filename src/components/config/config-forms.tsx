"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Download, RefreshCw, RotateCcw, Upload } from "lucide-react";
import {
  addLeadAction,
  addManualIgDay,
  importAdsCsv,
  importLeadsCsv,
  reclassifyAdsAction,
  resetSeedAction,
  resyncAdsCleanAction,
  setBrandMatchAction,
  setDmConversationsAction,
  setGoalsAction,
  syncNowAction,
  updatePostsMetaAction,
  type ActionState,
} from "@/app/(dashboard)/config/actions";
import { BRANDS } from "@/lib/brands";
import { DEFAULT_BRAND } from "@/lib/types";
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

// Data LOCAL (não UTC): à noite no Brasil, toISOString() já apontaria p/ amanhã.
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

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

// ---- leads import ---------------------------------------------------

export function LeadsImportForm({ template }: { template: string }) {
  const [state, action] = useActionState(importLeadsCsv, null);

  function downloadTemplate() {
    const blob = new Blob([template], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-leads.csv";
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
          Importar leads
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
        <Field label="Visitas ao perfil">
          <input type="number" name="profileViews" min="0" className={inputCls} />
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

// ---- conversas de DM (registro manual) ------------------------------

export function DmForm() {
  const [state, action] = useActionState(setDmConversationsAction, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
        <Field label="Data">
          <input type="date" name="date" defaultValue={today()} className={inputCls} required />
        </Field>
        <Field label="Conversas iniciadas">
          <input type="number" name="dmConversations" min="0" className={inputCls} required />
        </Field>
      </div>
      <SubmitButton>Registrar conversas</SubmitButton>
      <Message state={state} />
    </form>
  );
}

// ---- conteúdo dos posts (duração de reel, pilar/série, CTA) ---------

export interface PostMetaRow {
  id: string;
  dateLabel: string; // dd/mm já formatado
  type: string;
  caption: string;
  durationSec?: number;
  pillar?: string;
  ctaType?: string;
  /** CTA detectado pela heurística da legenda (mostrado como o "Auto") */
  detectedCta?: string;
  /** post de teste (validação de gancho) — fora da análise orgânica */
  isTest?: boolean;
}

const PILLAR_SUGGESTIONS = [
  "Simulação da semana",
  "Mito ou verdade",
  "Bastidor",
  "Prova social",
  "Card de frase",
];

const CTA_OPTIONS: { value: string; label: string }[] = [
  { value: "dm", label: "DM" },
  { value: "comentario", label: "Comentário" },
  { value: "salvamento", label: "Salvamento" },
  { value: "marcacao", label: "Marcação" },
  { value: "outro", label: "Outro" },
];

export function PostsMetaForm({ posts }: { posts: PostMetaRow[] }) {
  const [state, action] = useActionState(updatePostsMetaAction, null);
  if (posts.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum post sincronizado ainda.</p>;
  }
  return (
    <form action={action} className="space-y-3">
      <datalist id="pillar-suggestions">
        {PILLAR_SUGGESTIONS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Post</th>
              <th className="py-2 pr-3 font-medium">Duração (s)</th>
              <th className="py-2 pr-3 font-medium">Pilar / série</th>
              <th className="py-2 pr-3 font-medium">CTA</th>
              <th className="py-2 font-medium">Teste?</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="max-w-[280px] py-2 pr-3">
                  <p className="line-clamp-1 font-medium">{p.caption}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.dateLabel} · {p.type}
                  </p>
                </td>
                <td className="py-2 pr-3">
                  {p.type === "reel" ? (
                    <input
                      type="number"
                      name={`duration_${p.id}`}
                      min="1"
                      step="1"
                      defaultValue={p.durationSec ?? ""}
                      placeholder="s"
                      className={cn(inputCls, "w-20")}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <input
                    type="text"
                    name={`pillar_${p.id}`}
                    list="pillar-suggestions"
                    defaultValue={p.pillar ?? ""}
                    placeholder="ex.: Mito ou verdade"
                    className={cn(inputCls, "w-44")}
                  />
                </td>
                <td className="py-2 pr-3">
                  <select
                    name={`cta_${p.id}`}
                    defaultValue={p.ctaType ?? ""}
                    className={cn(inputCls, "w-36")}
                  >
                    <option value="">
                      Auto{p.detectedCta ? ` (${p.detectedCta})` : " (nenhum)"}
                    </option>
                    {CTA_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2">
                  {/* select (não checkbox): ausente do form = não mexe; "" = não; "1" = sim */}
                  <select
                    name={`test_${p.id}`}
                    defaultValue={p.isTest ? "1" : ""}
                    className={cn(inputCls, "w-20")}
                  >
                    <option value="">Não</option>
                    <option value="1">Sim</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SubmitButton>Salvar conteúdo</SubmitButton>
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
            <option value="cliente">Cliente</option>
            <option value="perdido">Perdido</option>
          </select>
        </Field>
        <Field label="Data da reunião (opcional)">
          <input type="date" name="meetingAt" className={inputCls} />
        </Field>
        <Field label="Valor da carta (R$, se cliente)">
          <input type="number" name="value" min="0" step="0.01" placeholder="0,00" className={inputCls} />
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
    { metric: "retencao_reels", label: "Retenção de reels (%)" },
    { metric: "alcance_base", label: "Alcance sobre a base (%)" },
    { metric: "saves_1k", label: "Salvos por 1k views" },
    { metric: "comentarios_post", label: "Comentários por post" },
    { metric: "posts_semana", label: "Posts por semana" },
    { metric: "conversas_dm", label: "Conversas de DM (período)" },
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

// ---- separação de marcas (campanha → marca) ------------------------

export function BrandMatchForm({ current }: { current: Record<string, string> }) {
  const [state, action] = useActionState(setBrandMatchAction, null);
  const extra = BRANDS.filter((b) => b.slug !== DEFAULT_BRAND);
  return (
    <form action={action} className="space-y-3">
      {extra.map((b) => (
        <Field
          key={b.slug}
          label={`Campanhas de ${b.label} — fragmentos do nome ou IDs (separados por vírgula)`}
        >
          <input
            type="text"
            name={`match_${b.slug}`}
            defaultValue={current[b.slug] ?? ""}
            placeholder="KRONE —"
            className={inputCls}
          />
        </Field>
      ))}
      <p className="text-xs text-muted-foreground">
        Tudo que não casar com nenhuma marca fica com a {DEFAULT_BRAND} (padrão).
        Dica: prefixe as campanhas da krone no Ads Manager (ex.: <code className="font-mono">KRONE — …</code>) e use o prefixo aqui.
      </p>
      <SubmitButton>Salvar regra</SubmitButton>
      <Message state={state} />
    </form>
  );
}

export function ReclassifyAdsButton() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState | null>(null);
  const router = useRouter();
  return (
    <div className="space-y-1.5 border-t pt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          startTransition(async () => {
            const result = await reclassifyAdsAction();
            setState(result);
            router.refresh();
          });
        }}
        className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <RefreshCw className={cn("size-4", pending && "animate-spin")} />
        {pending ? "Reclassificando…" : "Reclassificar anúncios por marca"}
      </button>
      <p className="text-xs text-muted-foreground">
        Re-etiqueta os anúncios já coletados pela campanha (aplica a regra acima aos
        dados atuais) e remove linhas duplicadas. Não precisa da API.
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
