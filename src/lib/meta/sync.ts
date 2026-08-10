import "server-only";
import { syncAdsAccount } from "./ads";
import { syncInstagram } from "./instagram";
import { refreshIgTokenIfNeeded, getIgToken } from "./token";
import { resolveMetaBrands, type BrandMeta } from "./config";
import { getState, setState } from "../data/store";
import { STATE_KEYS } from "../data/backend";

/**
 * Orchestrates the daily collection, MULTIMARCA. Regras:
 *  - Uma integração/marca que quebra nunca derruba as outras (try/catch isolado).
 *  - Ads: agrupado por AD ACCOUNT. Como brunno e krone dividem a mesma conta, um
 *    único pull é particionado por campanha entre as marcas (por isso a conta usa
 *    SEMPRE todas as marcas que a dividem, mesmo com `brand` alvo único — senão as
 *    linhas da outra marca cairiam no catch-all errado).
 *  - Instagram: uma conta por marca (@krone.capital tem IG_USER_ID próprio).
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
  brand,
}: { source?: SyncSource; days?: number; brand?: string } = {}): Promise<SyncReport> {
  const ranAt = new Date().toISOString();
  const report: SyncReport = { ranAt, skipped: [] };
  const all = await resolveMetaBrands();
  const targets = brand ? all.filter((b) => b.slug === brand) : all;

  // ---- ads (por ad account; conta compartilhada = 1 pull particionado) ----
  if (source === "all" || source === "ads") {
    const accounts = new Map<string, BrandMeta[]>();
    for (const b of targets) {
      if (!b.adAccountId || !b.adsToken) continue;
      accounts.set(b.adAccountId, all.filter((x) => x.adAccountId === b.adAccountId && x.adsToken));
    }
    if (accounts.size === 0) {
      report.skipped.push("tráfego pago (credenciais ausentes)");
    } else {
      const notes: string[] = [];
      let ok = true;
      for (const [account, brandsOnAccount] of accounts) {
        try {
          const r = await syncAdsAccount({
            account,
            token: brandsOnAccount[0].adsToken!,
            brands: brandsOnAccount,
            days: days ?? 30,
          });
          const dist = Object.entries(r.byBrand).map(([s, n]) => `${s}: ${n}`).join(", ") || "0 linhas";
          notes.push(`${account} (${r.since}→${r.until}) → ${dist}`);
        } catch (e) {
          ok = false;
          notes.push(`${account}: erro — ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      report.ads = { ok, detail: notes.join(" · ") };
      if (ok) await setState(STATE_KEYS.lastSyncAds, ranAt);
    }
  }

  // ---- instagram (uma conta por marca) ----
  if (source === "all" || source === "instagram") {
    const igBrands = targets.filter((b) => b.igUserId && b.igToken);
    if (igBrands.length === 0) {
      report.skipped.push("Instagram (credenciais ausentes)");
    } else {
      const notes: string[] = [];
      const tokenNotes: string[] = [];
      let ok = true;
      for (const b of igBrands) {
        try {
          tokenNotes.push(`${b.slug}: ${await refreshIgTokenIfNeeded(b.slug, b.igToken)}`);
        } catch (e) {
          tokenNotes.push(`${b.slug}: falha token — ${e instanceof Error ? e.message : String(e)}`);
        }
        try {
          const token = (await getIgToken(b.slug, b.igToken))!;
          const r = await syncInstagram({ userId: b.igUserId!, token, brand: b.slug, days: days ?? 7 });
          notes.push(`${b.slug}: ${r.note}`);
        } catch (e) {
          ok = false;
          notes.push(`${b.slug}: erro — ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      report.instagram = { ok, detail: notes.join(" · ") };
      report.token = tokenNotes.join(" · ");
      if (ok) await setState(STATE_KEYS.lastSyncInstagram, ranAt);
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
