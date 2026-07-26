"use server";

import { revalidatePath } from "next/cache";
import {
  addLead,
  addLeadEvent,
  clearAdData,
  resetToSeed,
  upsertAdDaily,
  upsertGoal,
  upsertIgAccountDaily,
} from "@/lib/data/store";
import { parseAdsCsv } from "@/lib/csv";
import { runSync, type SyncSource } from "@/lib/meta/sync";
import { can } from "@/lib/auth/guard";
import { currentActor, newEventId } from "@/lib/auth/actor";
import type { GoalMetric, LeadStatus } from "@/lib/types";

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
    await upsertAdDaily(rows);
    revalidateAll();
    const extra = skipped > 0 ? ` (${skipped} linha(s) ignorada(s))` : "";
    return { ok: true, message: `${rows.length} linha(s) importada(s) com sucesso${extra}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Falha ao importar o CSV." };
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
      date,
      followers: num(formData, "followers"),
      reach: num(formData, "reach"),
      views: num(formData, "views"),
      profileLinkTaps: num(formData, "profileLinkTaps"),
      accountsEngaged: num(formData, "accountsEngaged"),
      totalInteractions: num(formData, "totalInteractions"),
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
  if (!name) return { ok: false, message: "Informe o nome do lead." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: "Informe a data do lead." };

  const leadId = `LEAD-M-${Date.now()}`;
  await addLead({
    id: leadId,
    createdAt: `${date}T12:00:00`,
    name,
    email,
    phone,
    utmSource: "manual",
    utmContent,
    status,
    meetingAt: /^\d{4}-\d{2}-\d{2}$/.test(meetingDate) ? `${meetingDate}T10:00:00` : undefined,
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
    await upsertGoal({ metric: s.metric, period: "campanha", target, lowerIsBetter: s.lowerIsBetter });
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
