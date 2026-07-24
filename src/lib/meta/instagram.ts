import "server-only";
import { GRAPH_IG, igUserId } from "./config";
import { graphUrl, metaGet } from "./http";
import { getIgToken } from "./token";
import { getData, upsertIgAccountDaily, upsertIgPosts } from "../data/store";
import type { IgAccountDaily, IgMediaType, IgPost } from "../types";

/**
 * Instagram organic — "Instagram API with Instagram Login" (graph.instagram.com).
 *
 * Two API facts drive this design:
 *
 *  1. `since`/`until` are UNIX timestamps in SECONDS (not yyyy-mm-dd).
 *  2. Only `reach` supports `metric_type=time_series`. Every other interaction
 *     metric exists ONLY as `total_value`, i.e. one aggregate number for the
 *     whole interval — so a daily series needs one request per day.
 *
 * Because small/new accounts have a low rate-limit ceiling, we sync a short
 * retroactive window (default 7 days) rather than months at a time. Insights
 * can lag up to 48h, so re-syncing recent days and upserting is intentional.
 *
 * Expect Instagram numbers NOT to match Meta Ads: media insights count only
 * organic engagement and exclude what the promoted/boosted version of the same
 * post generated. That is by design, not a bug.
 */

const ACCOUNT_METRICS = [
  "reach",
  "views",
  "accounts_engaged",
  "total_interactions",
  "profile_links_taps",
].join(",");

interface InsightEntry {
  name: string;
  period?: string;
  total_value?: { value?: number };
  values?: Array<{ value?: number; end_time?: string }>;
}

interface InsightsResponse {
  data?: InsightEntry[];
}

interface ProfileResponse {
  user_id?: string;
  id?: string;
  username?: string;
  followers_count?: number;
  media_count?: number;
}

/** Read a metric value. We request total_value, but tolerate the series shape. */
function readMetric(data: InsightEntry[] | undefined, name: string): number {
  const entry = data?.find((d) => d.name === name);
  if (!entry) return 0; // absent metric => API returned no data, not zero
  if (entry.total_value && typeof entry.total_value.value === "number") {
    return entry.total_value.value;
  }
  const v = entry.values?.[0]?.value;
  return typeof v === "number" ? v : 0;
}

function dayBounds(isoDate: string): { since: number; until: number } {
  const start = Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 1000);
  return { since: start, until: start + 86_400 };
}

function lastNDays(days: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Enum reality check (they are NOT interchangeable):
 *   media_type          = CAROUSEL_ALBUM | IMAGE | VIDEO
 *   media_product_type  = AD | FEED | STORY | REELS
 * A reel is media_type=VIDEO **and** media_product_type=REELS.
 *
 * The docs also flag `media_product_type` and `caption` as "Facebook Login
 * only", so on this host they may come back missing — hence the permalink /
 * is_shared_to_feed fallbacks.
 */
function mediaType(
  productType?: string,
  type?: string,
  permalink?: string,
  isSharedToFeed?: boolean,
): IgMediaType {
  if (type === "CAROUSEL_ALBUM") return "carrossel";
  if (productType === "REELS") return "reel";
  if (productType === "STORY") return "story";
  if (!productType) {
    // fallbacks when the discriminator field is absent
    if (permalink?.includes("/reel/")) return "reel";
    if (isSharedToFeed !== undefined) return "reel";
  }
  return "feed";
}

interface MediaRow {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  is_shared_to_feed?: boolean;
}

export interface InstagramSyncResult {
  days: number;
  posts: number;
  followers: number;
  note: string;
}

/** Pull account insights + recent posts and store them. */
export async function syncInstagram({
  days = 7,
  postLimit = 25,
}: { days?: number; postLimit?: number } = {}): Promise<InstagramSyncResult> {
  const userId = igUserId();
  const token = await getIgToken();
  if (!userId || !token) {
    throw new Error(
      "Instagram não configurado: defina IG_USER_ID e IG_ACCESS_TOKEN.",
    );
  }

  // ---- profile snapshot (followers_count is "now", not a time series) ----
  const profile = await metaGet<ProfileResponse>(
    graphUrl(GRAPH_IG, `/${userId}`, {
      fields: "user_id,username,followers_count,media_count",
      access_token: token,
    }),
  );
  const followersNow = Number(profile.followers_count ?? 0);

  // ---- daily account metrics: one request per day (total_value only) ----
  const existing = new Map(
    (await getData()).igAccountDaily.map((r) => [r.date, r]),
  );
  const today = new Date().toISOString().slice(0, 10);
  const rows: IgAccountDaily[] = [];

  for (const date of lastNDays(days)) {
    const { since, until } = dayBounds(date);
    const res = await metaGet<InsightsResponse>(
      graphUrl(GRAPH_IG, `/${userId}/insights`, {
        metric: ACCOUNT_METRICS,
        period: "day",
        metric_type: "total_value",
        since,
        until,
        access_token: token,
      }),
    ).catch(() => ({ data: [] }) as InsightsResponse);

    const prev = existing.get(date);
    rows.push({
      date,
      // Follower history can only be built going forward: we know today's count,
      // and keep whatever we already recorded for past days.
      followers: date === today ? followersNow : (prev?.followers ?? 0),
      reach: readMetric(res.data, "reach"),
      views: readMetric(res.data, "views"),
      accountsEngaged: readMetric(res.data, "accounts_engaged"),
      totalInteractions: readMetric(res.data, "total_interactions"),
      profileLinkTaps: readMetric(res.data, "profile_links_taps"),
    });
  }

  await upsertIgAccountDaily(rows);

  // ---- recent media + per-media insights ----
  // NOTE: /media never returns Stories (they live on /stories and vanish in 24h).
  const media = await metaGet<{ data?: MediaRow[] }>(
    graphUrl(GRAPH_IG, `/${userId}/media`, {
      fields:
        "id,caption,media_type,media_product_type,permalink,timestamp,is_shared_to_feed",
      limit: postLimit,
      access_token: token,
    }),
  ).catch(() => ({ data: [] }));

  const posts: IgPost[] = [];
  for (const m of media.data ?? []) {
    const type = mediaType(
      m.media_product_type,
      m.media_type,
      m.permalink,
      m.is_shared_to_feed,
    );
    const metrics = ["reach", "likes", "comments", "saved", "shares", "views"];
    if (type === "reel") metrics.push("ig_reels_avg_watch_time");

    const ins = await metaGet<InsightsResponse>(
      graphUrl(GRAPH_IG, `/${m.id}/insights`, {
        metric: metrics.join(","),
        access_token: token,
      }),
    ).catch(() => ({ data: [] }) as InsightsResponse);

    const avgWatch = readMetric(ins.data, "ig_reels_avg_watch_time");
    posts.push({
      id: m.id,
      publishedAt: m.timestamp ?? new Date().toISOString(),
      type,
      caption: (m.caption ?? "").slice(0, 300) || "(sem legenda)",
      permalink: m.permalink ?? "",
      reach: readMetric(ins.data, "reach"),
      views: readMetric(ins.data, "views"),
      likes: readMetric(ins.data, "likes"),
      comments: readMetric(ins.data, "comments"),
      saved: readMetric(ins.data, "saved"),
      shares: readMetric(ins.data, "shares"),
      // API reports milliseconds; the dashboard shows seconds
      avgWatchTime: type === "reel" && avgWatch ? Math.round(avgWatch / 100) / 10 : undefined,
    });
  }

  await upsertIgPosts(posts);

  return {
    days: rows.length,
    posts: posts.length,
    followers: followersNow,
    note: `${rows.length} dia(s) e ${posts.length} post(s) sincronizados`,
  };
}
