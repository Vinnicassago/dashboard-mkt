import "server-only";
import { syncAds } from "./ads";
import { syncInstagram } from "./instagram";
import { refreshIgTokenIfNeeded } from "./token";
import { integrationStatus } from "./config";
import { getState, setState } from "../data/store";
import { STATE_KEYS } from "../data/backend";

/**
 * Orchestrates the daily collection. One broken integration must never stop
 * the other, so every source is captured independently.
 */

export interface SourceOutcome {
  ok: boolean;
  detail: string;
}

export interface SyncReport {
  ranAt: string;
  ads?: SourceOutcome;
  instagram?: SourceOutcome;
  token?: string;
  skipped: string[];
}

export type SyncSource = "all" | "ads" | "instagram";

export async function runSync({
  source = "all",
  days,
}: { source?: SyncSource; days?: number } = {}): Promise<SyncReport> {
  const status = integrationStatus();
  const ranAt = new Date().toISOString();
  const report: SyncReport = { ranAt, skipped: [] };

  // ---- ads ----
  if (source === "all" || source === "ads") {
    if (!status.ads) {
      report.skipped.push("tráfego pago (credenciais ausentes)");
    } else {
      try {
        const r = await syncAds({ days: days ?? 30 });
        report.ads = {
          ok: true,
          detail: `${r.rows} linha(s) e ${r.creatives} criativo(s) de ${r.since} a ${r.until}`,
        };
        await setState(STATE_KEYS.lastSyncAds, ranAt);
      } catch (e) {
        report.ads = { ok: false, detail: e instanceof Error ? e.message : String(e) };
      }
    }
  }

  // ---- instagram ----
  if (source === "all" || source === "instagram") {
    if (!status.instagram) {
      report.skipped.push("Instagram (credenciais ausentes)");
    } else {
      try {
        report.token = await refreshIgTokenIfNeeded();
      } catch (e) {
        report.token = `falha ao renovar token: ${e instanceof Error ? e.message : String(e)}`;
      }
      try {
        const r = await syncInstagram({ days: days ?? 7 });
        report.instagram = { ok: true, detail: r.note };
        await setState(STATE_KEYS.lastSyncInstagram, ranAt);
      } catch (e) {
        report.instagram = {
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
        };
      }
    }
  }

  return report;
}

export interface LastSyncInfo {
  ads: string | null;
  instagram: string | null;
}

export async function getLastSync(): Promise<LastSyncInfo> {
  const [ads, instagram] = await Promise.all([
    getState<string>(STATE_KEYS.lastSyncAds),
    getState<string>(STATE_KEYS.lastSyncInstagram),
  ]);
  return { ads, instagram };
}
