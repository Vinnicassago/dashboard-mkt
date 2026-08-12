import "server-only";
import { GRAPH_IG } from "./config";
import { graphUrl, metaGet, MetaApiError } from "./http";
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
  total_value?: {
    value?: number;
    breakdowns?: Array<{
      dimension_keys?: string[];
      results?: Array<{ dimension_values?: string[]; value?: number }>;
    }>;
  };
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

/** Como readMetric, mas distingue AUSÊNCIA (undefined) de zero real. */
function readMetricOpt(data: InsightEntry[] | undefined, name: string): number | undefined {
  const entry = data?.find((d) => d.name === name);
  if (!entry) return undefined;
  if (entry.total_value && typeof entry.total_value.value === "number") {
    return entry.total_value.value;
  }
  const v = entry.values?.[0]?.value;
  return typeof v === "number" ? v : undefined;
}

/** Read one dimension of a `total_value.breakdowns` insight (e.g. reach by follow_type). */
function readBreakdown(
  data: InsightEntry[] | undefined,
  name: string,
  dimensionValue: string,
): number | undefined {
  const results = data?.find((d) => d.name === name)?.total_value?.breakdowns?.[0]?.results;
  const hit = results?.find(
    (r) => r.dimension_values?.[0]?.toUpperCase() === dimensionValue.toUpperCase(),
  );
  if (hit === undefined && results?.length) {
    // Enum divergente é silencioso demais: loga os valores crus UMA vez por rodada
    // p/ corrigir as strings (ex. contact_button_type pode não usar WEBSITE/WHATSAPP).
    console.warn(
      `[instagram] breakdown ${name}: "${dimensionValue}" não encontrado; recebidos: ${results
        .map((r) => r.dimension_values?.join("/"))
        .join(", ")}`,
    );
  }
  return typeof hit?.value === "number" ? hit.value : undefined;
}

/** Throttle NUNCA é engolido: aborta a rodada antes de gravar lixo por cima de
 *  dado bom; erro de métrica não suportada vira null (o caller usa fallback). */
function isThrottle(e: unknown): boolean {
  return (
    e instanceof MetaApiError &&
    (e.status === 429 || [4, 17, 32, 613, 80000].includes(e.code ?? -1))
  );
}
const nullUnlessThrottled = (e: unknown): null => {
  if (isThrottle(e)) throw e;
  return null;
};

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
  media_url?: string;
  thumbnail_url?: string;
}

export interface InstagramSyncResult {
  days: number;
  posts: number;
  followers: number;
  note: string;
}

/** Pull account insights + recent posts for ONE brand's IG account and store them. */
export async function syncInstagram({
  userId,
  token,
  brand,
  days = 7,
  postLimit = 25,
}: {
  userId: string;
  token: string;
  brand: string;
  days?: number;
  postLimit?: number;
}): Promise<InstagramSyncResult> {
  // ---- profile snapshot (followers_count is "now", not a time series) ----
  const profile = await metaGet<ProfileResponse>(
    graphUrl(GRAPH_IG, `/${userId}`, {
      fields: "user_id,username,followers_count,media_count",
      access_token: token,
    }),
  );
  const followersNow = Number(profile.followers_count ?? 0);

  // Dataset atual da marca: além do fallback de seguidores, preserva os campos
  // MANUAIS (dmConversations; durationSec/pillar/ctaType dos posts) que o sync
  // não conhece — senão cada rodada apagaria o que o usuário preencheu.
  const current = await getData(brand);
  const existing = new Map(current.igAccountDaily.map((r) => [r.date, r]));
  const existingPosts = new Map(current.igPosts.map((p) => [p.id, p]));
  const today = new Date().toISOString().slice(0, 10);
  const dates = lastNDays(days);

  // ---- follower history ----------------------------------------------
  // /me only gives the follower count for "now". To fill the past days we try
  // the `follower_count` insight (daily new followers; needs 100+ followers)
  // and rebuild the cumulative total backwards from today. If it is
  // unavailable (new/small account) we fall back to the snapshots already
  // stored, carrying the nearest known value across gaps — never a stray 0,
  // which is what made the old chart drop to zero on backfilled days.
  const followerByDate = new Map<string, number>();
  const gainByDate = new Map<string, number>();
  try {
    const fc = await metaGet<InsightsResponse>(
      graphUrl(GRAPH_IG, `/${userId}/insights`, {
        metric: "follower_count",
        period: "day",
        since: dayBounds(dates[0]).since,
        until: dayBounds(dates[dates.length - 1]).until,
        access_token: token,
      }),
    );
    const entry = fc.data?.find((d) => d.name === "follower_count");
    for (const v of entry?.values ?? []) {
      if (v.end_time && typeof v.value === "number") {
        gainByDate.set(v.end_time.slice(0, 10), v.value);
      }
    }
  } catch {
    // follower_count unavailable — snapshot fallback below.
  }

  if (gainByDate.size > 0) {
    let running = followersNow;
    for (let i = dates.length - 1; i >= 0; i--) {
      followerByDate.set(dates[i], running);
      running -= gainByDate.get(dates[i]) ?? 0;
    }
  } else {
    const known = dates.map((d) =>
      d === today ? followersNow : existing.get(d)?.followers ?? 0,
    );
    let carry = known.find((v) => v > 0) ?? followersNow;
    for (let i = 0; i < dates.length; i++) {
      if (known[i] > 0) carry = known[i];
      followerByDate.set(dates[i], carry);
    }
  }

  // ---- daily account metrics: one request per day (total_value only) ----
  const rows: IgAccountDaily[] = [];

  for (const date of dates) {
    const { since, until } = dayBounds(date);
    const [res, pv, rb, fu, lt] = await Promise.all([
      metaGet<InsightsResponse>(
        graphUrl(GRAPH_IG, `/${userId}/insights`, {
          metric: ACCOUNT_METRICS,
          period: "day",
          metric_type: "total_value",
          since,
          until,
          access_token: token,
        }),
      ).catch(nullUnlessThrottled),
      // profile_views isolado de proposito: se estiver indisponivel nesta conta
      // ou versao da API, NAO pode derrubar as metricas centrais ja provadas acima.
      metaGet<InsightsResponse>(
        graphUrl(GRAPH_IG, `/${userId}/insights`, {
          metric: "profile_views",
          period: "day",
          metric_type: "total_value",
          since,
          until,
          access_token: token,
        }),
      ).catch(nullUnlessThrottled),
      // alcance dividido em seguidor vs nao-seguidor (descoberta). Tambem isolado:
      // se o breakdown nao existir na conta/versao, nao afeta as metricas acima.
      metaGet<InsightsResponse>(
        graphUrl(GRAPH_IG, `/${userId}/insights`, {
          metric: "reach",
          period: "day",
          metric_type: "total_value",
          breakdown: "follow_type",
          since,
          until,
          access_token: token,
        }),
      ).catch(nullUnlessThrottled),
      // crescimento BRUTO (seguiu vs deixou de seguir) — exige 100+ seguidores;
      // isolado: indisponível => campos ficam undefined sem quebrar o resto.
      metaGet<InsightsResponse>(
        graphUrl(GRAPH_IG, `/${userId}/insights`, {
          metric: "follows_and_unfollows",
          period: "day",
          metric_type: "total_value",
          breakdown: "follow_type",
          since,
          until,
          access_token: token,
        }),
      ).catch(nullUnlessThrottled),
      // cliques na bio por tipo de botão (site vs WhatsApp) — também isolado.
      metaGet<InsightsResponse>(
        graphUrl(GRAPH_IG, `/${userId}/insights`, {
          metric: "profile_links_taps",
          period: "day",
          metric_type: "total_value",
          breakdown: "contact_button_type",
          since,
          until,
          access_token: token,
        }),
      ).catch(nullUnlessThrottled),
    ]);

    // Request FALHOU (null) => preserva o valor já armazenado do dia; request
    // ok mas sem a métrica => semântica anterior (0/undefined). Upsert é de
    // linha inteira nos 3 backends — sem isso, uma falha transitória apagaria
    // dado bom.
    const prev = existing.get(date);
    rows.push({
      brand,
      date,
      followers: followerByDate.get(date) ?? followersNow,
      reach: res ? readMetric(res.data, "reach") : (prev?.reach ?? 0),
      views: res ? readMetric(res.data, "views") : (prev?.views ?? 0),
      accountsEngaged: res ? readMetric(res.data, "accounts_engaged") : (prev?.accountsEngaged ?? 0),
      totalInteractions: res
        ? readMetric(res.data, "total_interactions")
        : (prev?.totalInteractions ?? 0),
      profileLinkTaps: res ? readMetric(res.data, "profile_links_taps") : (prev?.profileLinkTaps ?? 0),
      profileViews: pv ? readMetric(pv.data, "profile_views") : (prev?.profileViews ?? 0),
      reachFollowers: rb ? readBreakdown(rb.data, "reach", "FOLLOWER") : prev?.reachFollowers,
      reachNonFollowers: rb
        ? readBreakdown(rb.data, "reach", "NON_FOLLOWER")
        : prev?.reachNonFollowers,
      // registro manual — carregado do dia existente, nunca da API
      dmConversations: prev?.dmConversations,
      followsDay: fu ? readBreakdown(fu.data, "follows_and_unfollows", "FOLLOWER") : prev?.followsDay,
      unfollowsDay: fu
        ? readBreakdown(fu.data, "follows_and_unfollows", "NON_FOLLOWER")
        : prev?.unfollowsDay,
      linkTapsWebsite: lt
        ? readBreakdown(lt.data, "profile_links_taps", "WEBSITE")
        : prev?.linkTapsWebsite,
      linkTapsWhatsApp: lt
        ? readBreakdown(lt.data, "profile_links_taps", "WHATSAPP")
        : prev?.linkTapsWhatsApp,
    });
  }

  await upsertIgAccountDaily(rows);

  // ---- recent media + per-media insights ----
  // NOTE: /media never returns Stories (they live on /stories and vanish in 24h).
  // Paginação: segue paging.next até juntar `postLimit` mídias (o request traz
  // até 25 por página) — janelas de 30/90 dias precisam de mais que a 1ª página.
  const mediaRows: MediaRow[] = [];
  let mediaUrl: string | undefined = graphUrl(GRAPH_IG, `/${userId}/media`, {
    fields:
      "id,caption,media_type,media_product_type,permalink,timestamp,is_shared_to_feed,media_url,thumbnail_url",
    limit: Math.min(postLimit, 25),
    access_token: token,
  });
  while (mediaUrl && mediaRows.length < postLimit) {
    const page: { data?: MediaRow[]; paging?: { next?: string } } = await metaGet<{
      data?: MediaRow[];
      paging?: { next?: string };
    }>(mediaUrl).catch(() => ({}));
    mediaRows.push(...(page.data ?? []));
    mediaUrl = page.paging?.next;
    if (!page.data?.length) break;
  }

  const posts: IgPost[] = [];
  // Se a lista estendida falhar uma vez, os posts seguintes já vão direto na
  // base — evita DOBRAR os requests justamente nas contas que não a suportam.
  let extendedUnsupported = false;
  for (const m of mediaRows.slice(0, postLimit)) {
    const type = mediaType(
      m.media_product_type,
      m.media_type,
      m.permalink,
      m.is_shared_to_feed,
    );
    const metrics = ["reach", "likes", "comments", "saved", "shares", "views"];
    if (type === "reel") metrics.push("ig_reels_avg_watch_time", "ig_reels_video_view_total_time");

    // Atribuição por post (visitas ao perfil / follows): historicamente instável
    // por tipo de mídia e tamanho da conta — tenta a lista estendida e, se o
    // request inteiro falhar por métrica não suportada, repete com a base.
    const fetchInsights = (list: string[]) =>
      metaGet<InsightsResponse>(
        graphUrl(GRAPH_IG, `/${m.id}/insights`, {
          metric: list.join(","),
          access_token: token,
        }),
      );
    let ins: InsightsResponse | null = null;
    if (!extendedUnsupported) {
      try {
        ins = await fetchInsights([...metrics, "profile_visits", "follows"]);
      } catch (e) {
        if (isThrottle(e)) throw e;
        extendedUnsupported = true;
      }
    }
    if (ins === null) ins = await fetchInsights(metrics).catch(nullUnlessThrottled);
    if (ins === null) {
      // Insights indisponíveis para esta mídia: mantém o que já está armazenado
      // (não reescreve o post com zeros); mídia nova sem insights entra zerada.
      if (existingPosts.has(m.id)) continue;
      ins = { data: [] };
    }

    const avgWatch = readMetric(ins.data, "ig_reels_avg_watch_time");
    const totalWatchMs = readMetric(ins.data, "ig_reels_video_view_total_time");
    posts.push({
      id: m.id,
      brand,
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
      totalWatchTime: type === "reel" && totalWatchMs ? Math.round(totalWatchMs / 1000) : undefined,
      // atribuição por post — readMetricOpt distingue 0 real de "não exposto";
      // ausente (fallback na lista base) preserva o valor já armazenado
      profileVisits:
        readMetricOpt(ins.data, "profile_visits") ?? existingPosts.get(m.id)?.profileVisits,
      follows: readMetricOpt(ins.data, "follows") ?? existingPosts.get(m.id)?.follows,
      mediaUrl: m.media_url,
      thumbnailUrl: m.thumbnail_url,
      // metadados manuais — preservados do post existente (a API não os tem)
      durationSec: existingPosts.get(m.id)?.durationSec,
      pillar: existingPosts.get(m.id)?.pillar,
      ctaType: existingPosts.get(m.id)?.ctaType,
      isTest: existingPosts.get(m.id)?.isTest,
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
