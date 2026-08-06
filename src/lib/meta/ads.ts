import "server-only";
import { GRAPH_FB, adAccountId, adsToken } from "./config";
import { graphUrl, isoDaysAgo, isoToday, metaGet } from "./http";
import { upsertAdDaily, upsertCreatives } from "../data/store";
import type { AdDaily, Creative, CreativeFormat } from "../types";

/**
 * Meta Marketing API — daily performance per ad.
 *
 * Endpoint: GET /act_<id>/insights with level=ad and time_increment=1, which
 * returns one row per (ad, day).
 */

interface ActionEntry {
  action_type: string;
  value: string;
}

interface InsightRow {
  date_start: string;
  ad_id?: string;
  ad_name?: string;
  adset_name?: string;
  campaign_name?: string;
  objective?: string; // objetivo (efetivo) da campanha, ex. OUTCOME_LEADS
  spend?: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: ActionEntry[];
  video_play_actions?: ActionEntry[];
  video_thruplay_watched_actions?: ActionEntry[];
}

interface Paged<T> {
  data: T[];
  paging?: { next?: string };
}

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Which `action_type` counts as a lead.
 *
 * Our funnel is ad → landing page → form, so the Pixel/CAPI `Lead` event —
 * `offsite_conversion.fb_pixel_lead` — is the correct one.
 *
 * IMPORTANT: `lead` is an AGGREGATE ("all offsite leads plus all On-Facebook
 * leads"), so it must never be summed with the pixel one — that double counts.
 * We therefore take the FIRST match in priority order, never a sum.
 * `onsite_conversion.lead_grouped` / `leadgen_grouped` are On-Facebook and
 * Instant Form leads; they don't apply here and sit last as a safety net.
 */
const LEAD_ACTION_PRIORITY = [
  "offsite_conversion.fb_pixel_lead",
  "lead",
  "onsite_conversion.lead_grouped",
  "leadgen_grouped",
];

function extractLeads(actions?: ActionEntry[]): number {
  if (!actions?.length) return 0;
  const override = process.env.META_LEAD_ACTION_TYPE?.trim();
  const order = override ? [override, ...LEAD_ACTION_PRIORITY] : LEAD_ACTION_PRIORITY;
  for (const type of order) {
    const hit = actions.find((a) => a.action_type === type);
    if (hit) return num(hit.value);
  }
  return 0;
}

function sumActions(actions?: ActionEntry[]): number {
  if (!actions?.length) return 0;
  return actions.reduce((s, a) => s + num(a.value), 0);
}

/** Fetch every page of an insights query. */
async function fetchAllPages(firstUrl: string): Promise<InsightRow[]> {
  const out: InsightRow[] = [];
  let url: string | undefined = firstUrl;
  let guard = 0;
  while (url && guard++ < 50) {
    const page: Paged<InsightRow> = await metaGet<Paged<InsightRow>>(url);
    out.push(...(page.data ?? []));
    url = page.paging?.next;
  }
  return out;
}

interface AdCreativeRow {
  id: string;
  name?: string;
  creative?: { thumbnail_url?: string; object_type?: string };
}

const FORMAT_BY_OBJECT_TYPE: Record<string, CreativeFormat> = {
  VIDEO: "video",
  PHOTO: "imagem",
  SHARE: "imagem",
  STATUS: "imagem",
};

/** Thumbnails + format per ad (one extra call, not per-ad). */
async function fetchAdCreatives(account: string, token: string) {
  const url = graphUrl(GRAPH_FB, `/${account}/ads`, {
    fields: "id,name,creative{thumbnail_url,object_type}",
    limit: 500,
    access_token: token,
  });
  try {
    const page = await metaGet<Paged<AdCreativeRow>>(url);
    return new Map(
      (page.data ?? []).map((r) => [
        r.id,
        {
          name: r.name ?? r.id,
          thumbnailUrl: r.creative?.thumbnail_url,
          format: FORMAT_BY_OBJECT_TYPE[r.creative?.object_type ?? ""] ?? undefined,
        },
      ]),
    );
  } catch {
    // thumbnails are a nice-to-have — never fail the whole sync for them
    return new Map<string, { name: string; thumbnailUrl?: string; format?: CreativeFormat }>();
  }
}

export interface AdsSyncResult {
  rows: number;
  creatives: number;
  since: string;
  until: string;
}

/** Pull the last `days` days of ad performance and store it. */
export async function syncAds({ days = 30 }: { days?: number } = {}): Promise<AdsSyncResult> {
  const account = adAccountId();
  const token = adsToken();
  if (!account || !token) {
    throw new Error(
      "Tráfego pago não configurado: defina META_AD_ACCOUNT_ID e META_ADS_ACCESS_TOKEN.",
    );
  }

  const since = isoDaysAgo(days);
  const until = isoToday();

  const url = graphUrl(GRAPH_FB, `/${account}/insights`, {
    level: "ad",
    time_increment: 1,
    time_range: JSON.stringify({ since, until }),
    fields: [
      "date_start",
      "ad_id",
      "ad_name",
      "adset_name",
      "campaign_name",
      "objective",
      "spend",
      "impressions",
      "reach",
      "frequency",
      "clicks",
      "inline_link_clicks",
      "actions",
      "video_play_actions",
      "video_thruplay_watched_actions",
    ].join(","),
    limit: 500,
    access_token: token,
  });

  const raw = await fetchAllPages(url);
  const meta = await fetchAdCreatives(account, token);

  const adRows: AdDaily[] = [];
  const creativeAcc = new Map<string, Creative>();

  for (const r of raw) {
    const adId = r.ad_id ?? r.ad_name ?? "sem-id";
    const impressions = num(r.impressions);
    const reach = num(r.reach);

    adRows.push({
      date: r.date_start.slice(0, 10),
      campaign: r.campaign_name ?? "",
      adset: r.adset_name ?? "",
      adId,
      objective: r.objective || undefined,
      spend: num(r.spend),
      impressions,
      reach,
      frequency: num(r.frequency) || (reach > 0 ? impressions / reach : 0),
      // link clicks are the meaningful ones for a landing-page funnel
      clicks: num(r.inline_link_clicks) || num(r.clicks),
      leads: extractLeads(r.actions),
    });

    const plays = sumActions(r.video_play_actions);
    const thru = sumActions(r.video_thruplay_watched_actions);
    const info = meta.get(adId);
    const prev = creativeAcc.get(adId);
    creativeAcc.set(adId, {
      adId,
      name: info?.name ?? r.ad_name ?? adId,
      format: info?.format ?? (plays > 0 ? "video" : (prev?.format ?? "imagem")),
      thumbnailUrl: info?.thumbnailUrl ?? prev?.thumbnailUrl,
      videoPlays: (prev?.videoPlays ?? 0) + plays,
      thruPlays: (prev?.thruPlays ?? 0) + thru,
    });
  }

  const creatives = [...creativeAcc.values()];
  await upsertAdDaily(adRows);
  await upsertCreatives(creatives);

  return { rows: adRows.length, creatives: creatives.length, since, until };
}
