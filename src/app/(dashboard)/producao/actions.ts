"use server";

import { revalidatePath } from "next/cache";
import { getData, getDraft, listDrafts, upsertDraft, deleteDraft } from "@/lib/data/store";
import { can } from "@/lib/auth/guard";
import { activeBrandSlug } from "@/lib/active-brand";
import { ctaOf, dayOf } from "@/lib/metrics";
import { buildValidationContext, validateDraft, type ValidationContext } from "@/lib/content/validator";
import { hasPlaybook } from "@/lib/content/playbook";
import { isAiConfigured } from "@/lib/ai/config";
import { aiErrorMessage } from "@/lib/ai/client";
import { reviewDraft } from "@/lib/ai/review-draft";
import type { CtaType, DraftStatus, IgMediaType, PostDraft } from "@/lib/types";

export interface ActionState {
  ok: boolean;
  message: string;
  /** Id do rascunho salvo — a UI usa para manter a seleção após criar. */
  id?: string;
}

const DENIED: ActionState = { ok: false, message: "Você não tem permissão para esta ação." };

const MEDIA_TYPES: IgMediaType[] = ["feed", "carrossel", "reel", "story"];
const CTA_VALUES: CtaType[] = ["dm", "comentario", "salvamento", "marcacao", "outro"];
const STATUSES: DraftStatus[] = ["rascunho", "aprovado", "publicado", "descartado"];

/** Entrada crua do editor. Tudo é re-checado aqui — o cliente não é confiável. */
export interface DraftInput {
  id?: string;
  status?: string;
  plannedFor?: string;
  type?: string;
  pillar?: string;
  hookText?: string;
  hookSpoken?: string;
  promise?: string;
  script?: string;
  caption?: string;
  ctaType?: string;
  ctaKeyword?: string;
  durationSec?: number | null;
  hasBurnedCaptions?: boolean;
  notes?: string;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const optional = (v: unknown) => text(v) || undefined;
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Contexto de validação da marca: peças publicadas (do Instagram) + rascunhos
 * agendados. Um rascunho já vinculado a um post publicado é ignorado — quem
 * ocupa o dia e o CTA nesse caso é o post real, não a peça de produção.
 */
async function contextFor(brand: string, excludeDraftId?: string): Promise<ValidationContext> {
  const [data, drafts] = await Promise.all([getData(brand), listDrafts(brand)]);
  const published = data.igPosts
    .map((p) => ({ day: dayOf(p.publishedAt), cta: ctaOf(p) }))
    .sort((a, b) => b.day.localeCompare(a.day));
  return buildValidationContext({
    published,
    drafts: drafts
      .filter((d) => d.id !== excludeDraftId && !d.publishedPostId)
      .map((d) => ({ day: d.plannedFor, cta: d.ctaType, status: d.status })),
  });
}

export async function saveDraftAction(input: DraftInput): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const brand = await activeBrandSlug();
  if (!hasPlaybook(brand)) {
    return { ok: false, message: "Esta marca ainda não tem guia de produção." };
  }

  const type = MEDIA_TYPES.includes(text(input.type) as IgMediaType)
    ? (text(input.type) as IgMediaType)
    : "reel";
  const ctaRaw = text(input.ctaType);
  const status = STATUSES.includes(text(input.status) as DraftStatus)
    ? (text(input.status) as DraftStatus)
    : "rascunho";
  const plannedFor = text(input.plannedFor);
  if (plannedFor && !isDay(plannedFor)) {
    return { ok: false, message: "Data planejada inválida." };
  }
  const dur = Number(input.durationSec);

  const existing = input.id ? await getDraft(input.id) : null;
  if (input.id && !existing) return { ok: false, message: "Rascunho não encontrado." };
  if (existing && existing.brand !== brand) {
    return { ok: false, message: "Este rascunho é de outra marca." };
  }

  const now = new Date().toISOString();
  const draft: PostDraft = {
    id: existing?.id ?? `PD-${Date.now()}`,
    brand,
    status,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    plannedFor: plannedFor || undefined,
    type,
    pillar: optional(input.pillar),
    hookText: text(input.hookText),
    hookSpoken: text(input.hookSpoken),
    promise: optional(input.promise),
    script: typeof input.script === "string" ? input.script.trim() : "",
    caption: typeof input.caption === "string" ? input.caption.trim() : "",
    ctaType: CTA_VALUES.includes(ctaRaw as CtaType) ? (ctaRaw as CtaType) : undefined,
    ctaKeyword: optional(input.ctaKeyword),
    durationSec: Number.isFinite(dur) && dur > 0 ? dur : undefined,
    hasBurnedCaptions: input.hasBurnedCaptions ? true : undefined,
    notes: optional(input.notes),
    publishedPostId: existing?.publishedPostId,
  };

  // A nota é sempre recalculada NO SERVIDOR: o cliente valida ao vivo só para
  // dar retorno imediato; o que fica gravado é o veredito daqui.
  const result = validateDraft(draft, await contextFor(brand, draft.id));
  draft.score = result.score;
  draft.validatedAt = now;
  draft.playbookVersion = result.playbookVersion;
  // Snapshot das regras violadas: é o que permite perguntar depois se violar
  // cada uma custou alcance (Etapa 4). Revalidar no futuro daria outra resposta,
  // porque "única peça do dia" e "CTA da vez" dependem do contexto da época.
  draft.validationFailed = [...new Set(result.issues.map((i) => i.id))];

  // Aprovar exige checklist limpo — é o portão que o guia descreve.
  if (status === "aprovado" && !result.ready) {
    return {
      ok: false,
      message: `Não dá para aprovar com ${result.issues.filter((i) => i.severity === "bloqueio").length} bloqueio(s) em aberto.`,
      id: draft.id,
    };
  }

  await upsertDraft(draft);
  revalidatePath("/producao");
  return {
    ok: true,
    message: result.ready
      ? `Salvo · nota ${result.score}/100 · pronto para publicar.`
      : `Salvo · nota ${result.score}/100 · ${result.issues.filter((i) => i.severity === "bloqueio").length} bloqueio(s) a resolver.`,
    id: draft.id,
  };
}

export async function setDraftStatusAction(id: string, status: string): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const brand = await activeBrandSlug();
  const draft = await getDraft(id);
  if (!draft || draft.brand !== brand) return { ok: false, message: "Rascunho não encontrado." };
  if (!STATUSES.includes(status as DraftStatus)) {
    return { ok: false, message: "Situação inválida." };
  }

  const next = status as DraftStatus;
  if (next === "aprovado") {
    const result = validateDraft(draft, await contextFor(brand, draft.id));
    if (!result.ready) {
      return { ok: false, message: "Resolva os bloqueios antes de aprovar." };
    }
  }

  await upsertDraft({ ...draft, status: next, updatedAt: new Date().toISOString() });
  revalidatePath("/producao");
  return { ok: true, message: `Peça marcada como ${next}.` };
}

/**
 * Revisão por IA (Etapa 2). Só roda por clique explícito e só para quem tem
 * `data:write` — a chamada custa dinheiro, então é mutação, não leitura.
 * O rascunho precisa estar salvo: revisamos o que está gravado, nunca um texto
 * solto que veio do cliente.
 */
export async function reviewDraftAction(id: string): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  if (!isAiConfigured()) {
    return { ok: false, message: "Revisão por IA desligada — falta ANTHROPIC_API_KEY no .env.local." };
  }
  const brand = await activeBrandSlug();
  const draft = await getDraft(id);
  if (!draft || draft.brand !== brand) return { ok: false, message: "Rascunho não encontrado." };

  try {
    const validation = validateDraft(draft, await contextFor(brand, draft.id));
    const aiReview = await reviewDraft(draft, validation);
    await upsertDraft({ ...draft, aiReview, updatedAt: new Date().toISOString() });
    revalidatePath("/producao");
    const rotulo =
      aiReview.veredito === "aprova"
        ? "aprovou"
        : aiReview.veredito === "ajusta"
          ? "pediu ajustes"
          : "pediu para refazer o gancho";
    return { ok: true, message: `Revisão concluída — a IA ${rotulo}.`, id: draft.id };
  } catch (e) {
    return { ok: false, message: aiErrorMessage(e) };
  }
}

/**
 * Vincula um rascunho ao post que ele virou — o elo que fecha o loop.
 * `postId` vazio desfaz o vínculo (erro de digitação acontece, e vínculo errado
 * contamina todo o aprendizado de previsto×realizado).
 */
export async function linkDraftToPostAction(
  draftId: string,
  postId: string,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const brand = await activeBrandSlug();
  const draft = await getDraft(draftId);
  if (!draft || draft.brand !== brand) return { ok: false, message: "Rascunho não encontrado." };

  const alvo = text(postId);
  if (!alvo) {
    await upsertDraft({
      ...draft,
      publishedPostId: undefined,
      status: draft.status === "publicado" ? "aprovado" : draft.status,
      updatedAt: new Date().toISOString(),
    });
    revalidatePath("/producao");
    return { ok: true, message: "Vínculo desfeito." };
  }

  const data = await getData(brand);
  const post = data.igPosts.find((p) => p.id === alvo);
  if (!post) return { ok: false, message: "Post não encontrado nesta marca." };

  // Um post só pode ter vindo de UM rascunho — senão a análise conta duas vezes.
  const drafts = await listDrafts(brand);
  const jaUsado = drafts.find((d) => d.id !== draftId && d.publishedPostId === alvo);
  if (jaUsado) {
    return { ok: false, message: `Esse post já está vinculado a outra peça ("${jaUsado.hookText || jaUsado.id}").` };
  }

  await upsertDraft({
    ...draft,
    publishedPostId: alvo,
    status: "publicado",
    updatedAt: new Date().toISOString(),
  });
  revalidatePath("/producao");
  return { ok: true, message: "Peça vinculada ao post publicado." };
}

export async function deleteDraftAction(id: string): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const brand = await activeBrandSlug();
  const draft = await getDraft(id);
  if (!draft || draft.brand !== brand) return { ok: false, message: "Rascunho não encontrado." };
  await deleteDraft(id);
  revalidatePath("/producao");
  return { ok: true, message: "Rascunho excluído." };
}
