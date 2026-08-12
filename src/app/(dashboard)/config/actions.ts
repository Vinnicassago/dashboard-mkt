"use server";

import { revalidatePath } from "next/cache";
import {
  addLead,
  addLeadEvent,
  clearAdData,
  getData,
  getState,
  resetToSeed,
  setState,
  upsertAdDaily,
  upsertCreatives,
  upsertGoal,
  upsertIgAccountDaily,
  upsertIgPosts,
} from "@/lib/data/store";
import { STATE_KEYS } from "@/lib/data/backend";
import { parseAdsCsv } from "@/lib/csv";
import { parseLeadsCsv } from "@/lib/leads-csv";
import { runSync, type SyncSource } from "@/lib/meta/sync";
import { resolveMetaBrands, brandForCampaign } from "@/lib/meta/config";
import { BRANDS } from "@/lib/brands";
import { can } from "@/lib/auth/guard";
import { currentActor, newEventId } from "@/lib/auth/actor";
import { activeBrandSlug } from "@/lib/active-brand";
import {
  DEFAULT_BRAND,
  type AdDaily,
  type Creative,
  type CtaType,
  type GoalMetric,
  type IgPost,
  type LeadStatus,
} from "@/lib/types";

const DENIED: ActionState = { ok: false, message: "Você não tem permissão para esta ação." };

export interface ActionState {
  ok: boolean;
  message: string;
}

function num(formData: FormData, key: string): number {
  const v = Number(formData.get(key));
  return Number.isFinite(v) ? v : 0;
}

function revalidateAll() {
  revalidatePath("/", "layout");
}

export async function importAdsCsv(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Selecione um arquivo CSV." };
  }
  try {
    const text = await file.text();
    const { rows, skipped } = parseAdsCsv(text);
    // Separa por campanha (mesma regra do sync da API): o CSV do ad account
    // compartilhado traz campanhas das duas marcas.
    const brands = await resolveMetaBrands();
    await upsertAdDaily(rows.map((r) => ({ ...r, brand: brandForCampaign(r.campaign, undefined, brands) })));
    revalidateAll();
    const extra = skipped > 0 ? ` (${skipped} linha(s) ignorada(s))` : "";
    return { ok: true, message: `${rows.length} linha(s) importada(s) com sucesso${extra}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Falha ao importar o CSV." };
  }
}

export async function importLeadsCsv(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("leads:write"))) return DENIED;
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Selecione um arquivo CSV de leads." };
  }
  try {
    const text = await file.text();
    const { leads, skipped } = parseLeadsCsv(text);
    const brand = await activeBrandSlug();
    const actor = await currentActor();
    for (const lead of leads) {
      await addLead({ ...lead, brand });
      await addLeadEvent({
        id: newEventId(),
        leadId: lead.id,
        leadName: lead.name,
        actor,
        action: "created",
        toStatus: lead.status,
        createdAt: lead.createdAt,
      });
    }
    revalidateAll();
    const extra = skipped > 0 ? ` (${skipped} linha(s) ignorada(s))` : "";
    return {
      ok: true,
      message: `${leads.length} lead(s) importado(s)${extra}. Reimportar atualiza pelo mesmo id, sem duplicar.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Falha ao importar os leads." };
  }
}

export async function addManualIgDay(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const date = String(formData.get("date") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: "Informe uma data válida." };
  }
  await upsertIgAccountDaily([
    {
      brand: await activeBrandSlug(),
      date,
      followers: num(formData, "followers"),
      reach: num(formData, "reach"),
      views: num(formData, "views"),
      profileLinkTaps: num(formData, "profileLinkTaps"),
      accountsEngaged: num(formData, "accountsEngaged"),
      totalInteractions: num(formData, "totalInteractions"),
      profileViews: num(formData, "profileViews"),
    },
  ]);
  revalidateAll();
  return { ok: true, message: `Snapshot de ${date} salvo.` };
}

/**
 * Registra as conversas de DM iniciadas num dia (métrica de negócio — a API do
 * Instagram não expõe DMs). Faz MERGE no snapshot existente do dia; sem
 * snapshot, orienta a criar um primeiro (uma linha só com DMs zeraria
 * seguidores/alcance do dia e sujaria as séries).
 */
export async function setDmConversationsAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const date = String(formData.get("date") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: "Informe uma data válida." };
  }
  const count = num(formData, "dmConversations");
  const brand = await activeBrandSlug();
  const data = await getData(brand);
  const row = data.igAccountDaily.find((r) => r.date === date);
  if (!row) {
    return {
      ok: false,
      message: `Sem snapshot do Instagram em ${date}. Registre o snapshot do dia (ou rode a sincronização) e tente de novo.`,
    };
  }
  await upsertIgAccountDaily([{ ...row, dmConversations: count }]);
  revalidateAll();
  return { ok: true, message: `${count} conversa(s) registrada(s) em ${date}.` };
}

/**
 * Registra a rotina diária de presença do guia (stories, comentários no nicho,
 * contas seguidas, "respondi tudo"). Nada disso vem da API — é o trabalho manual
 * de aquecer a base, e sem registro não há como cobrar aderência.
 *
 * Faz MERGE no snapshot do dia, como o registro de DMs: uma linha só com a
 * rotina zeraria seguidores/alcance e sujaria todas as séries.
 */
export async function setPresenceRoutineAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const date = String(formData.get("date") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: "Informe uma data válida." };
  }
  const brand = await activeBrandSlug();
  const data = await getData(brand);
  const row = data.igAccountDaily.find((r) => r.date === date);
  if (!row) {
    return {
      ok: false,
      message: `Sem snapshot do Instagram em ${date}. Registre o snapshot do dia (ou rode a sincronização) e tente de novo.`,
    };
  }
  // Campo em branco fica como estava; "0" é um registro legítimo de zero.
  const opt = (key: string) => {
    const raw = formData.get(key);
    if (raw == null || String(raw).trim() === "") return undefined;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? v : undefined;
  };
  await upsertIgAccountDaily([
    {
      ...row,
      storiesPosted: opt("storiesPosted") ?? row.storiesPosted,
      storiesInteractive: opt("storiesInteractive") ?? row.storiesInteractive,
      nicheComments: opt("nicheComments") ?? row.nicheComments,
      accountsFollowed: opt("accountsFollowed") ?? row.accountsFollowed,
      repliedAll: formData.get("repliedAll") === "on",
    },
  ]);
  revalidateAll();
  return { ok: true, message: `Rotina de ${date} registrada.` };
}

const CTA_VALUES: CtaType[] = ["dm", "comentario", "salvamento", "marcacao", "outro"];

/**
 * Salva os metadados manuais de conteúdo (duração do reel, pilar/série e CTA)
 * de todos os posts do formulário de uma vez. Só faz upsert dos que mudaram.
 */
export async function updatePostsMetaAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const brand = await activeBrandSlug();
  const data = await getData(brand);
  const changed: IgPost[] = [];
  for (const post of data.igPosts) {
    const durRaw = formData.get(`duration_${post.id}`);
    const pillarRaw = formData.get(`pillar_${post.id}`);
    const ctaRaw = formData.get(`cta_${post.id}`);
    const testRaw = formData.get(`test_${post.id}`);
    // Campos ausentes do form (post fora da lista) não tocam o post.
    if (durRaw == null && pillarRaw == null && ctaRaw == null && testRaw == null) continue;

    const durNum = Number(durRaw);
    const durationSec =
      durRaw != null && String(durRaw).trim() !== "" && Number.isFinite(durNum) && durNum > 0
        ? durNum
        : undefined;
    const pillar = pillarRaw != null ? String(pillarRaw).trim() || undefined : post.pillar;
    const ctaStr = ctaRaw != null ? String(ctaRaw).trim() : "";
    const ctaType =
      ctaRaw != null
        ? CTA_VALUES.includes(ctaStr as CtaType)
          ? (ctaStr as CtaType)
          : undefined
        : post.ctaType;

    const nextDuration = durRaw != null ? durationSec : post.durationSec;
    // "1" = teste; "" = não; ausente = mantém. Guardado como true|undefined.
    const isTest = testRaw != null ? (String(testRaw) === "1" ? true : undefined) : post.isTest;
    if (
      nextDuration !== post.durationSec ||
      pillar !== post.pillar ||
      ctaType !== post.ctaType ||
      isTest !== post.isTest
    ) {
      changed.push({ ...post, durationSec: nextDuration, pillar, ctaType, isTest });
    }
  }
  if (changed.length === 0) return { ok: true, message: "Nada para atualizar." };
  await upsertIgPosts(changed);
  revalidateAll();
  return { ok: true, message: `${changed.length} post(s) atualizado(s).` };
}

export async function addLeadAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("leads:write"))) return DENIED;
  const name = String(formData.get("name") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  const status = (String(formData.get("status") ?? "lead") as LeadStatus) || "lead";
  const utmContent = String(formData.get("utmContent") ?? "").trim() || undefined;
  const meetingDate = String(formData.get("meetingAt") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || undefined;
  const email = String(formData.get("email") ?? "").trim() || undefined;
  const valueRaw = Number(formData.get("value"));
  const value = Number.isFinite(valueRaw) && valueRaw > 0 ? valueRaw : undefined;
  if (!name) return { ok: false, message: "Informe o nome do lead." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: "Informe a data do lead." };

  const leadId = `LEAD-M-${Date.now()}`;
  await addLead({
    id: leadId,
    brand: await activeBrandSlug(),
    createdAt: `${date}T12:00:00`,
    name,
    email,
    phone,
    utmSource: "manual",
    utmContent,
    status,
    meetingAt: /^\d{4}-\d{2}-\d{2}$/.test(meetingDate) ? `${meetingDate}T10:00:00` : undefined,
    value,
  });
  await addLeadEvent({
    id: newEventId(),
    leadId,
    leadName: name,
    actor: await currentActor(),
    action: "created",
    toStatus: status,
    createdAt: new Date().toISOString(),
  });
  revalidateAll();
  return { ok: true, message: `Lead "${name}" adicionado.` };
}

export async function setGoalsAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const brand = await activeBrandSlug();
  const specs: { metric: GoalMetric; lowerIsBetter?: boolean }[] = [
    { metric: "leads" },
    { metric: "meetings" },
    { metric: "cpl", lowerIsBetter: true },
    { metric: "cpr", lowerIsBetter: true },
    { metric: "followers" },
    // metas orgânicas do plano de 90 dias
    { metric: "retencao_reels" },
    { metric: "alcance_base" },
    { metric: "saves_1k" },
    { metric: "comentarios_post" },
    { metric: "compartilhamentos_post" },
    { metric: "posts_semana" },
    { metric: "conversas_dm" },
  ];
  for (const s of specs) {
    const raw = formData.get(`target_${s.metric}`);
    if (raw == null || String(raw).trim() === "") continue;
    const target = Number(raw);
    if (!Number.isFinite(target) || target <= 0) continue;
    await upsertGoal({ brand, metric: s.metric, period: "campanha", target, lowerIsBetter: s.lowerIsBetter });
  }
  revalidateAll();
  return { ok: true, message: "Metas atualizadas." };
}

export async function resetSeedAction(): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  await resetToSeed();
  revalidateAll();
  return { ok: true, message: "Dados de exemplo restaurados." };
}

/**
 * Fix double-counting: wipe the ad tables (ad_daily + creatives) — where
 * CSV-imported rows and API rows live under different keys and get summed —
 * then re-pull cleanly from the Meta API so only the real numbers remain.
 * Leads and everything else are untouched.
 */
export async function resyncAdsCleanAction(): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  try {
    await clearAdData();
    const report = await runSync({ source: "ads" });
    revalidateAll();
    if (!report.ads) {
      return {
        ok: false,
        message:
          "Dados de anúncios apagados, mas a Meta não está configurada — defina META_AD_ACCOUNT_ID e META_ADS_ACCESS_TOKEN e clique em Sincronizar agora.",
      };
    }
    if (!report.ads.ok) {
      return {
        ok: false,
        message: `Dados apagados, mas a sincronização falhou: ${report.ads.detail}. Corrija e clique em Sincronizar agora.`,
      };
    }
    return {
      ok: true,
      message: `Anúncios zerados e ressincronizados da Meta · ${report.ads.detail}`,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Falha ao zerar e ressincronizar.",
    };
  }
}

/**
 * Salva as regras de "quais campanhas são de cada marca" (por marca não-padrão),
 * guardadas no banco e usadas pelo sync/CSV/reclassificação. A marca padrão
 * (consorcio) é sempre a catch-all: recebe tudo que não casa com outra marca.
 */
export async function setBrandMatchAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const cur = (await getState<Record<string, string[]>>(STATE_KEYS.brandCampaignMatch)) ?? {};
  const next: Record<string, string[]> = { ...cur };
  for (const b of BRANDS) {
    if (b.slug === DEFAULT_BRAND) continue;
    const raw = formData.get(`match_${b.slug}`);
    if (raw == null) continue;
    next[b.slug] = String(raw).split(",").map((s) => s.trim()).filter(Boolean);
  }
  await setState(STATE_KEYS.brandCampaignMatch, next);
  revalidateAll();
  return {
    ok: true,
    message:
      'Regra de separação salva. Clique em "Reclassificar anúncios por marca" (ou "Zerar e ressincronizar") para aplicar aos dados já coletados.',
  };
}

/**
 * Re-etiqueta os anúncios JÁ armazenados pela campanha (mesma regra do sync), sem
 * precisar da API. Resolve dados antigos (coletados/importados antes de configurar
 * a separação) e limpa as linhas duplicadas que um "Sincronizar agora" deixa
 * quando um anúncio muda de marca (a marca faz parte da chave da linha).
 */
export async function reclassifyAdsAction(): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  try {
    const brands = await resolveMetaBrands();
    const ads: AdDaily[] = [];
    const creatives: Creative[] = [];
    for (const b of BRANDS) {
      const d = await getData(b.slug);
      ads.push(...d.adDaily);
      creatives.push(...d.creatives);
    }
    const retaggedAds = ads.map((r) => ({
      ...r,
      brand: brandForCampaign(r.campaign, undefined, brands),
    }));
    // O criativo não guarda a campanha — herda a marca do seu anúncio.
    const adBrand = new Map<string, string>();
    for (const r of retaggedAds) if (!adBrand.has(r.adId)) adBrand.set(r.adId, r.brand);
    const retaggedCreatives = creatives.map((c) => ({ ...c, brand: adBrand.get(c.adId) ?? c.brand }));

    await clearAdData();
    await upsertAdDaily(retaggedAds);
    await upsertCreatives(retaggedCreatives);
    revalidateAll();

    const dist: Record<string, number> = {};
    for (const r of retaggedAds) dist[r.brand] = (dist[r.brand] ?? 0) + 1;
    const summary = Object.entries(dist).map(([s, n]) => `${s}: ${n} linha(s)`).join(" · ");
    return { ok: true, message: `Anúncios reclassificados por campanha — ${summary || "nenhuma linha"}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Falha ao reclassificar." };
  }
}

/** Run the Meta collection on demand (same code path as the daily cron). */
export async function syncNowAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const raw = String(formData.get("source") ?? "all");
  const source: SyncSource =
    raw === "ads" || raw === "instagram" ? raw : "all";

  try {
    const report = await runSync({ source });
    const parts: string[] = [];
    if (report.ads) {
      parts.push(`Anúncios: ${report.ads.ok ? report.ads.detail : `erro — ${report.ads.detail}`}`);
    }
    if (report.instagram) {
      parts.push(
        `Instagram: ${report.instagram.ok ? report.instagram.detail : `erro — ${report.instagram.detail}`}`,
      );
    }
    if (report.token) parts.push(`Token: ${report.token}`);
    if (report.skipped.length) parts.push(`Ignorado: ${report.skipped.join(", ")}`);

    const ok =
      (report.ads?.ok ?? true) &&
      (report.instagram?.ok ?? true) &&
      Boolean(report.ads || report.instagram);

    revalidateAll();
    return {
      ok,
      message: parts.join(" · ") || "Nenhuma integração configurada ainda.",
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Falha na sincronização.",
    };
  }
}
