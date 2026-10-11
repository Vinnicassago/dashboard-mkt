"use client";

import { useActionState } from "react";
import {
  addManualIgDay,
  setDmConversationsAction,
  setPresenceRoutineAction,
  updatePostsMetaAction,
} from "@/app/(dashboard)/configuracoes/actions";
import { cn } from "@/lib/utils";
import { Field, Message, SubmitButton, hojeLocal, inputCls } from "./form-primitives";

/**
 * Registros manuais do Instagram (snapshot do dia, DMs, rotina de presença e
 * marcação de posts). Saíram de Configurações e moram em Conteúdo → Registros
 * (relatório §7.6); as ações continuam em `configuracoes/actions.ts`.
 */

// ---- snapshot diário do Instagram -----------------------------------

export function ManualIgForm() {
  const [state, action] = useActionState(addManualIgDay, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Data">
          <input type="date" name="date" defaultValue={hojeLocal()} className={inputCls} required />
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
          <input type="date" name="date" defaultValue={hojeLocal()} className={inputCls} required />
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
          <input type="date" name="date" defaultValue={hojeLocal()} className={inputCls} required />
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

const PILLAR_SUGGESTIONS = ["Simulação da semana", "Mito ou verdade", "Bastidor", "Prova social", "Card de frase"];

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
                  <select name={`cta_${p.id}`} defaultValue={p.ctaType ?? ""} className={cn(inputCls, "w-36")}>
                    <option value="">Auto{p.detectedCta ? ` (${p.detectedCta})` : " (nenhum)"}</option>
                    {CTA_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2">
                  {/* select (não checkbox): ausente do form = não mexe; "" = não; "1" = sim */}
                  <select name={`test_${p.id}`} defaultValue={p.isTest ? "1" : ""} className={cn(inputCls, "w-20")}>
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
