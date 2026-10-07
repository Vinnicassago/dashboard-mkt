import "server-only";
import { fetchAdsAccount, syncAdsAccount, type AdsPull } from "./ads";
import { isoDaysAgo, isoToday } from "./http";
import { syncInstagram } from "./instagram";
import { refreshIgTokenIfNeeded, getIgToken } from "./token";
import { resolveMetaBrands, type BrandMeta } from "./config";
import { getData, getState, replaceAdData, setState } from "../data/store";
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

/** A Meta guarda insights por até 37 meses; mais que isso a busca falha. */
const LIMITE_HISTORICO_DIAS = 37 * 30;

/**
 * Refaz o histórico de anúncios a partir da Meta — conserto de gasto dobrado
 * (linhas de CSV somadas às da API). A ordem é o que protege o dado:
 *   1. busca TODAS as contas, do primeiro dia guardado até hoje;
 *   2. só se todas as buscas derem certo, troca o período de cada conta numa
 *      operação (`replaceAdData`).
 * Meta não configurada ou busca com erro = nada apagado.
 */
export async function resyncAdsHistory(): Promise<SourceOutcome> {
  const all = await resolveMetaBrands();
  const accounts = new Map<string, BrandMeta[]>();
  for (const b of all) {
    if (!b.adAccountId || !b.adsToken) continue;
    accounts.set(b.adAccountId, all.filter((x) => x.adAccountId === b.adAccountId && x.adsToken));
  }
  if (accounts.size === 0) {
    return {
      ok: false,
      detail: "A Meta não está configurada: defina META_AD_ACCOUNT_ID e META_ADS_ACCESS_TOKEN.",
    };
  }

  const until = isoToday();
  const limite = isoDaysAgo(LIMITE_HISTORICO_DIAS);
  const pulls: { brands: BrandMeta[]; pull: AdsPull }[] = [];
  for (const [account, brands] of accounts) {
    // Do primeiro dia guardado de qualquer marca da conta (no mínimo 30 dias).
    let since = isoDaysAgo(30);
    for (const b of brands) {
      const first = (await getData(b.slug)).adDaily[0]?.date;
      if (first && first < since) since = first;
    }
    if (since < limite) since = limite;
    const pull = await fetchAdsAccount({ account, token: brands[0].adsToken!, brands, since, until });
    pulls.push({ brands, pull });
  }

  const notes: string[] = [];
  for (const { brands, pull } of pulls) {
    await replaceAdData(pull.adRows, pull.creatives, {
      brands: brands.map((b) => b.slug),
      since: pull.since,
      until: pull.until,
    });
    const dist = Object.entries(pull.byBrand).map(([s, n]) => `${s}: ${n}`).join(", ") || "0 linhas";
    notes.push(`${pull.since}→${pull.until} → ${dist}`);
  }
  await setState(STATE_KEYS.lastSyncAds, new Date().toISOString());
  return { ok: true, detail: notes.join(" · ") };
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
