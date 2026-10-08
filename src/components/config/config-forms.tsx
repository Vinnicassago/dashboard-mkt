"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Download, RefreshCw, RotateCcw, Stethoscope, Upload } from "lucide-react";
import {
  addLeadAction,
  addManualIgDay,
  diagnosticoLeadsAction,
  importAdsCsv,
  importLeadsCsv,
  reclassifyAdsAction,
  repararLeadsAction,
  resetSeedAction,
  resyncAdsCleanAction,
  setBrandMatchAction,
  setDmConversationsAction,
  setMensagemWhatsappAction,
  setRoboAtivoAction,
  setPresenceRoutineAction,
  setBudgetAction,
  setGoalsAction,
  syncNowAction,
  updatePostsMetaAction,
  type ActionState,
} from "@/app/(dashboard)/config/actions";
import { LEAD_STATUS_META, LOST_STATUSES, OPEN_STATUSES, statusLabel } from "@/lib/lead-status";
import type { DiagnosticoLeads } from "@/lib/diagnostico-leads";
import { CONFIRMACAO_PERIGO } from "@/lib/perigo";
import { formatDateTime } from "@/lib/format";
import { BRANDS } from "@/lib/brands";
import { DEFAULT_BRAND } from "@/lib/types";
import { cn } from "@/lib/utils";

export const inputCls =
  "h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40";
const labelCls = "text-xs font-medium text-muted-foreground";

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

// ---- rotina diária de presença -------------------------------------

/**
 * O trabalho manual que o guia cobra todo dia útil e que nenhuma API expõe:
 * stories, comentários no nicho, contas seguidas e "respondi tudo". Faz merge no
 * snapshot do dia — campo em branco preserva o que já estava lá.
 */
export function RoutineForm() {
  const [state, action] = useActionState(setPresenceRoutineAction, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Data">
          <input type="date" name="date" defaultValue={today()} className={inputCls} required />
        </Field>
        <Field label="Stories (meta 3–5)">
          <input type="number" name="storiesPosted" min="0" className={inputCls} />
        </Field>
        <Field label="Destes, interativos (≥1)">
          <input type="number" name="storiesInteractive" min="0" className={inputCls} />
        </Field>
        <Field label="Comentários no nicho (20)">
          <input type="number" name="nicheComments" min="0" className={inputCls} />
        </Field>
        <Field label="Contas seguidas (10–15)">
          <input type="number" name="accountsFollowed" min="0" className={inputCls} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="repliedAll" className="size-4 rounded border" />
        Respondi 100% dos comentários e DMs do dia
      </label>
      <SubmitButton>Registrar rotina</SubmitButton>
      <Message state={state} />
      <p className="text-xs text-muted-foreground">
        Campo em branco mantém o valor anterior. Precisa existir o snapshot do dia (vem da
        sincronização do Instagram ou do registro manual acima).
      </p>
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
            <optgroup label="Em andamento">
              {OPEN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STATUS_META[s].label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Perdido — por quê">
              {LOST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STATUS_META[s].label}
                </option>
              ))}
            </optgroup>
          </select>
        </Field>
        <Field label="Data e hora da reunião (obrigatória se agendado)">
          <input type="datetime-local" name="meetingFor" className={inputCls} />
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

// ---- budget ---------------------------------------------------------

export function BudgetForm({
  current,
}: {
  current: { budgetTotal?: number; dailyBudget?: number; endDate?: string };
}) {
  const [state, action] = useActionState(setBudgetAction, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Orçamento total (R$)">
          <input
            type="number"
            name="budgetTotal"
            min="0"
            step="any"
            required
            defaultValue={current.budgetTotal ?? ""}
            className={inputCls}
          />
        </Field>
        <Field label="Budget diário (R$, opcional)">
          <input
            type="number"
            name="dailyBudget"
            min="0"
            step="any"
            defaultValue={current.dailyBudget ?? ""}
            className={inputCls}
          />
        </Field>
        <Field label="Fim da campanha (opcional)">
          <input
            type="date"
            name="endDate"
            defaultValue={current.endDate ?? ""}
            className={inputCls}
          />
        </Field>
      </div>
      <SubmitButton>Salvar orçamento</SubmitButton>
      <Message state={state} />
    </form>
  );
}

// ---- goals ----------------------------------------------------------

export function GoalsForm({ current }: { current: Partial<Record<string, number>> }) {
  const [state, action] = useActionState(setGoalsAction, null);
  // As metas do funil (leads, reuniões, CPL, custo por reunião…) moraram aqui
  // até a Fase 4; agora têm vigência e calculadora — card "Metas".
  const fields: { metric: string; label: string }[] = [
    { metric: "followers", label: "Seguidores (meta)" },
    { metric: "retencao_reels", label: "Retenção de reels (%)" },
    { metric: "alcance_base", label: "Alcance sobre a base (%)" },
    { metric: "saves_1k", label: "Salvos por 1k views" },
    { metric: "comentarios_post", label: "Comentários por post" },
    { metric: "compartilhamentos_post", label: "Compartilhamentos por post" },
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
    </div>
  );
}

/**
 * Conserto de gasto dobrado (CSV somado à API): baixa da Meta todo o histórico
 * guardado e só então troca as linhas. Se a busca falhar, nada é apagado.
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
          if (
            !window.confirm(
              "Isso baixa da Meta todo o histórico de anúncios guardado e, se a busca der certo, troca as linhas atuais pelas novas.\n\nSe a Meta falhar, nada é apagado. Leads e o restante não são afetados. Continuar?",
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
        {pending ? "Baixando da Meta…" : "Refazer o histórico de anúncios a partir da Meta"}
      </button>
      <p className="text-xs text-muted-foreground">
        Use se os números de tráfego pago estiverem dobrados (dados de CSV somados com os da
        Meta). Busca primeiro, troca depois: com a Meta fora do ar, nada é apagado.
      </p>
      <Message state={state} />
    </div>
  );
}

// ---- separação de marcas (campanha → marca) ------------------------

export function BrandMatchForm({ current }: { current: Record<string, string> }) {
  const [state, action] = useActionState(setBrandMatchAction, null);
  return (
    <form action={action} className="space-y-3">
      {BRANDS.map((b) => (
        <Field
          key={b.slug}
          label={`Campanhas de ${b.label} — fragmentos do nome ou IDs (separados por vírgula)`}
        >
          <input
            type="text"
            name={`match_${b.slug}`}
            defaultValue={current[b.slug] ?? ""}
            placeholder={b.slug === DEFAULT_BRAND ? "[BRN]  ou  *  (o resto da conta)" : "[KRN]"}
            className={inputCls}
          />
        </Field>
      ))}
      <p className="text-xs text-muted-foreground">
        Com regra em todas as marcas, a campanha que não casar com nenhuma fica{" "}
        <strong>não classificada</strong>: fora de todos os números, com alerta, até você dizer
        de quem é. Para uma marca receber &ldquo;o resto&rdquo;, use{" "}
        <code className="font-mono">*</code>. Enquanto só uma marca estiver sem regra, ela
        continua recebendo o resto — confira a prévia acima antes de reclassificar.
      </p>
      <p className="text-xs text-muted-foreground">
        O token é uma <strong>substring</strong> do nome da campanha, não um prefixo. Se as
        campanhas são marcadas com <code className="font-mono">[KRN]</code>, use{" "}
        <code className="font-mono">[KRN]</code>: escrever <code className="font-mono">krone</code>{" "}
        deixaria passar todos os posts impulsionados que só têm a sigla.
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
          if (
            !window.confirm(
              "Reetiquetar todos os anúncios guardados pela regra de marca acima? Os números de cada marca mudam na hora.",
            )
          ) {
            return;
          }
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
            `Isso APAGA anúncios, Instagram e metas e grava o exemplo no lugar. Os leads reais não são apagados: ficam excluídos (dá para restaurar em Pessoas), com o histórico.\n\nPara confirmar, digite ${CONFIRMACAO_PERIGO}:`,
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

// ---- diagnóstico dos leads (D8) ------------------------------------

function Numero({ label, valor, hint }: { label: string; valor: number; hint?: string }) {
  return (
    <div className="rounded-lg border px-3 py-2" title={hint}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{valor}</p>
    </div>
  );
}

/**
 * Um id em que várias pessoas caíram: cada cadastro sobrescreveu o anterior e
 * só o último ficou no banco. O histórico guardou nome e data de quem sumiu —
 * telefone e e-mail não. O CSV serve para cruzar com o outro destino da LP
 * (planilha / n8n) e reimportar quem faltar.
 */
function ColisaoCard({ colisao }: { colisao: DiagnosticoLeads["colisoes"][number] }) {
  const exportar = () => {
    const linhas = [
      ["Nome", "Primeiro envio", "Envios", "Id compartilhado"].join(";"),
      ...colisao.sobrescritos.map((p) =>
        [p.nome.replace(/;/g, ","), formatDateTime(p.primeiraVez), String(p.envios), colisao.leadId].join(";"),
      ),
    ];
    const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads-sobrescritos.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-2 rounded-lg border border-[var(--danger-text)]/30 p-3">
      <p className="text-sm">
        <strong>{colisao.sobrescritos.length} pessoa(s) sumiram</strong> num único id (
        <code className="font-mono text-xs">{colisao.leadId}</code>): {colisao.criacoes} cadastros
        caíram nele, cada um apagando o anterior. Hoje só existe{" "}
        <strong>{colisao.nomeAtual}</strong>. Nomes e datas estão abaixo; telefone e e-mail se
        perderam aqui — procure-os no outro destino da landing page (planilha / n8n) e reimporte
        pelo CSV de leads. A causa foi corrigida: cadastros novos não se sobrescrevem mais.
      </p>
      <div className="max-h-60 overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card text-left text-muted-foreground">
            <tr>
              <th className="p-2">Nome</th>
              <th className="p-2">Primeiro envio</th>
              <th className="p-2 text-right">Envios</th>
            </tr>
          </thead>
          <tbody>
            {colisao.sobrescritos.map((p) => (
              <tr key={`${p.nome}-${p.primeiraVez}`} className="border-t">
                <td className="p-2">{p.nome}</td>
                <td className="p-2">{formatDateTime(p.primeiraVez)}</td>
                <td className="p-2 text-right tabular-nums">{p.envios}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={exportar}
        className="inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <Download className="size-3.5" />
        Exportar lista (CSV)
      </button>
    </div>
  );
}

/**
 * Lê o histórico e mostra o que os reenvios da LP fizeram com os leads. Nada é
 * alterado até alguém marcar os leads e clicar em "Aplicar".
 */
export function DiagnosticoLeadsPanel() {
  const [pending, startTransition] = useTransition();
  const [diag, setDiag] = useState<DiagnosticoLeads | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [state, setState] = useState<ActionState | null>(null);
  const router = useRouter();

  const rodar = () =>
    startTransition(async () => {
      const r = await diagnosticoLeadsAction();
      if (!r.ok) {
        setErro(r.message);
        return;
      }
      setErro(null);
      setDiag(r.diagnostico);
      setMarcados(new Set(r.diagnostico.reparos.map((x) => x.leadId)));
    });

  return (
    <div className="space-y-4">
      <button
        type="button"
        disabled={pending}
        onClick={rodar}
        className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <Stethoscope className="size-4" />
        {pending ? "Lendo o histórico…" : diag ? "Rodar de novo" : "Rodar diagnóstico"}
      </button>
      {erro ? <p className="text-sm text-[var(--danger-text)]">{erro}</p> : null}

      {diag ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Numero label="Criações pela LP" valor={diag.criacoesLp} hint="Eventos de criação vindos da landing page" />
            <Numero label="Leads da LP" valor={diag.leadsLp} hint="Leads que entraram pela landing page (pelo histórico), inclusive excluídos" />
            <Numero label="Leads com reenvio" valor={diag.reenvios.length} hint="Mesmo id, mais de uma criação, mesmo nome" />
            <Numero label="Colisões de id" valor={diag.colisoes.length} hint="Mesmo id, nomes diferentes: duas pessoas" />
            <Numero label="Criações sem lead" valor={diag.orfaos} hint="Lead apagado fora do painel" />
            <Numero label="Em outra marca" valor={diag.foraDaMarcaPadrao} hint="Leads da LP fora da marca padrão" />
            <Numero label="Excluídos" valor={diag.excluidos} />
            <Numero label="Registros em lote" valor={diag.rajadas.length} hint="10+ mudanças de status do mesmo usuário em 15 min" />
          </div>

          {diag.rajadas.length ? (
            <p className="text-xs text-muted-foreground">
              Registros em lote:{" "}
              {diag.rajadas
                .slice(0, 5)
                .map((r) => `${r.actor} · ${r.eventos} em ${formatDateTime(r.inicio)}`)
                .join(" · ")}
              . Status registrado em lote, dias depois, não mede velocidade de contato.
            </p>
          ) : null}

          {diag.colisoes.map((c) => (
            <ColisaoCard key={c.leadId} colisao={c} />
          ))}

          {diag.reparos.length === 0 ? (
            <p className="text-sm text-[var(--success-text)]">
              Nenhum lead com status ou data de entrada para reparar.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm">
                <strong>{diag.reparos.length}</strong> lead(s) com algo que o histórico permite
                consertar. Confira e desmarque o que não quiser aplicar.
              </p>
              <div className="max-h-80 overflow-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card text-left text-muted-foreground">
                    <tr>
                      <th className="p-2"></th>
                      <th className="p-2">Lead</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Entrada</th>
                      <th className="p-2">Marcos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diag.reparos.map((r) => (
                      <tr key={r.leadId} className="border-t">
                        <td className="p-2">
                          <input
                            type="checkbox"
                            aria-label={`Reparar ${r.nome}`}
                            checked={marcados.has(r.leadId)}
                            onChange={(e) => {
                              const next = new Set(marcados);
                              if (e.target.checked) next.add(r.leadId);
                              else next.delete(r.leadId);
                              setMarcados(next);
                            }}
                          />
                        </td>
                        <td className="p-2 font-medium">{r.nome}</td>
                        <td className="p-2">
                          {r.statusProposto
                            ? `${statusLabel(r.statusAtual)} → ${statusLabel(r.statusProposto)}`
                            : "—"}
                        </td>
                        <td className="p-2">
                          {r.entradaProposta
                            ? `${formatDateTime(r.entradaAtual)} → ${formatDateTime(r.entradaProposta)}`
                            : "—"}
                        </td>
                        <td className="p-2 text-muted-foreground">
                          {[r.bookedAt && "agendou", r.attendedAt && "compareceu", r.closedAt && "fechou"]
                            .filter(Boolean)
                            .join(", ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                disabled={pending || marcados.size === 0}
                onClick={() => {
                  if (!window.confirm(`Aplicar o reparo em ${marcados.size} lead(s)? Cada mudança de status entra no histórico.`)) return;
                  startTransition(async () => {
                    const r = await repararLeadsAction([...marcados]);
                    setState(r);
                    router.refresh();
                    if (r.ok) setDiag(null);
                  });
                }}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                Aplicar reparo ({marcados.size})
              </button>
            </div>
          )}
        </>
      ) : null}
      <Message state={state} />
    </div>
  );
}

// ---- integrações operacionais ---------------------------------------

/** Chave liga/desliga do robô de WhatsApp + atendimento do especialista. */
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

/** Texto que o botão de WhatsApp da Fila já deixa escrito. */
export function MensagemWhatsappForm({ atual, padrao }: { atual: string; padrao: string }) {
  const [state, action] = useActionState(setMensagemWhatsappAction, null);
  return (
    <form action={action} className="space-y-2">
      <textarea
        name="mensagem"
        defaultValue={atual === padrao ? "" : atual}
        placeholder={padrao}
        rows={3}
        maxLength={600}
        className="w-full rounded-lg border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
      />
      <p className="text-xs text-muted-foreground">
        Use <code className="font-mono">{"{nome}"}</code> para o primeiro nome. Em branco = a mensagem
        padrão (mostrada acima, apagada).
      </p>
      <SubmitButton>Salvar mensagem</SubmitButton>
      <Message state={state} />
    </form>
  );
}
