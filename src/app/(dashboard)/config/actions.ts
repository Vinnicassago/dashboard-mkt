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
import { DEFAULT_BRAND, type AdDaily, type Creative, type GoalMetric, type LeadStatus } from "@/lib/types";

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
