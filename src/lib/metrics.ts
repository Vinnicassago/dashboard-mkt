/**
 * Pure KPI functions. No I/O — everything takes data in and returns numbers,
 * so it's trivial to reason about and test.
 *
 * Cost vocabulary:
 *   CPM = custo por mil impressões · CPC = custo por clique
 *   CPL = custo por lead · CPR = custo por reunião agendada (North Star)
 */

import type {
  AdDaily,
  Creative,
  DashboardData,
  Goal,
  IgAccountDaily,
  IgPost,
  Lead,
} from "./types";

// ---- date helpers ---------------------------------------------------

export interface DateRange {
  from: string; // yyyy-mm-dd (inclusive)
  to: string; // yyyy-mm-dd (inclusive)
}

const div = (a: number, b: number) => (b > 0 ? a / b : 0);

/** Extract the yyyy-mm-dd part of an ISO string. */
export function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

export function inRange(day: string, range?: DateRange): boolean {
  if (!range) return true;
  return day >= range.from && day <= range.to;
}

export function filterAds(rows: AdDaily[], range?: DateRange): AdDaily[] {
  return range ? rows.filter((r) => inRange(r.date, range)) : rows;
}

export function filterLeads(leads: Lead[], range?: DateRange): Lead[] {
  return range ? leads.filter((l) => inRange(dayOf(l.createdAt), range)) : leads;
}

/** The equal-length window immediately before `range` (for period-over-period). */
export function previousRange(range: DateRange): DateRange {
  const from = new Date(range.from + "T00:00:00Z");
  const to = new Date(range.to + "T00:00:00Z");
  const days = Math.round((+to - +from) / 86400000) + 1;
  const prevTo = new Date(from);
  prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (days - 1));
  return {
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
  };
}

// ---- ad aggregation -------------------------------------------------

export interface AdKpis {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  ctr: number; // clicks / impressions
  cpc: number; // spend / clicks
  cpm: number; // spend / impressions * 1000
  cpl: number; // spend / leads
  frequency: number; // impressions / reach
}

export function adKpis(rows: AdDaily[]): AdKpis {
  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const reach = rows.reduce((s, r) => s + r.reach, 0);
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const leads = rows.reduce((s, r) => s + r.leads, 0);
  return {
    spend,
    impressions,
    reach,
    clicks,
    leads,
    ctr: div(clicks, impressions),
    cpc: div(spend, clicks),
    cpm: div(spend, impressions) * 1000,
    cpl: div(spend, leads),
    frequency: div(impressions, reach),
  };
}

// ---- objective classification (conversão vs descoberta) ------------

/**
 * Two budget buckets, by ad objective:
 *   `conversao`  — ads meant to generate leads/meetings (feed CPL/CPR).
 *   `descoberta` — ads meant for reach/engagement/followers (profile growth).
 * Everything here is pure: the raw Meta `objective` string lives on AdDaily and
 * is classified on the fly, so retuning the taxonomy never needs a re-migration.
 */
export type ObjectiveBucket = "conversao" | "descoberta";

export const OBJECTIVE_LABEL: Record<ObjectiveBucket, string> = {
  conversao: "Conversão",
  descoberta: "Descoberta",
};

// Raw Meta objectives (ODAX + legacy) that are about reach/engagement/followers.
const DISCOVERY_OBJECTIVES = new Set([
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_AWARENESS",
  "POST_ENGAGEMENT",
  "PAGE_LIKES",
  "PROFILE_VISITS",
  "REACH",
  "BRAND_AWARENESS",
  "VIDEO_VIEWS",
  "EVENT_RESPONSES",
]);

// Raw Meta objectives that drive an action down-funnel (lead/sale/site visit).
const CONVERSION_OBJECTIVES = new Set([
  "OUTCOME_LEADS",
  "OUTCOME_SALES",
  "OUTCOME_TRAFFIC", // envia para a LP no nosso funil → conversão (mude aqui se usar tráfego p/ perfil)
  "OUTCOME_APP_PROMOTION",
  "LEAD_GENERATION",
  "CONVERSIONS",
  "MESSAGES",
  "LINK_CLICKS",
  "TRAFFIC",
  "PRODUCT_CATALOG_SALES",
  "STORE_VISITS",
]);

/**
 * Classify a raw Meta objective into a budget bucket. Missing objective (legacy
 * rows, CSV sem a coluna) cai em "conversao" para preservar o CPL/CPR histórico
 * até um re-sync popular o campo — anúncios de descoberta só saem do denominador
 * depois de reconhecidos.
 */
export function objectiveBucket(raw?: string | null): ObjectiveBucket {
  if (!raw) return "conversao";
  const key = raw.trim().toUpperCase();
  if (DISCOVERY_OBJECTIVES.has(key)) return "descoberta";
  if (CONVERSION_OBJECTIVES.has(key)) return "conversao";
  // Fallback por palavra-chave para objetivos ainda não catalogados.
  if (/ENGAGEMENT|AWARENESS|REACH|VIDEO|PROFILE|LIKE|FOLLOW/.test(key)) return "descoberta";
  return "conversao";
}

export const bucketOfAd = (row: AdDaily): ObjectiveBucket => objectiveBucket(row.objective);

export interface ObjectiveKpis {
  bucket: ObjectiveBucket;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number; // leads atribuídos (via utmContent) a anúncios deste balde
  meetings: number; // reuniões atribuídas a este balde
  ctr: number;
  cpm: number; // spend / impressions * 1000
  costPerReach: number; // spend / reach * 1000 (custo por mil alcançados)
  cpl: number; // spend / leads
  cpr: number; // spend / meetings
}

function emptyObjectiveKpis(bucket: ObjectiveBucket): ObjectiveKpis {
  return {
    bucket,
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    leads: 0,
    meetings: 0,
    ctr: 0,
    cpm: 0,
    costPerReach: 0,
    cpl: 0,
    cpr: 0,
  };
}

export interface ObjectiveBreakdown {
  conversao: ObjectiveKpis;
  descoberta: ObjectiveKpis;
  totalSpend: number;
  conversaoShare: number; // 0–1 do gasto
  descobertaShare: number; // 0–1 do gasto
  hasDiscovery: boolean; // há gasto de descoberta no período?
  /** seguidores líquidos ganhos no período (conta inteira: orgânico + pago) */
  netNewFollowers: number;
  /** custo por seguidor ESTIMADO = gasto em descoberta ÷ seguidores líquidos.
   *  Estimativa: a Meta não atribui seguidores por anúncio; o crescimento é da
   *  conta (orgânico + pago). Serve como eficiência de topo, não atribuição exata. */
  costPerFollowerEst: number;
}

/**
 * Split ad spend + attributed leads/meetings by objective bucket, and pair the
 * discovery bucket with the account-level follower gain for an estimated
 * cost-per-follower. This is the faithful budget view: conversion CPL/CPR no
 * longer carry the discovery budget.
 */
export function objectiveBreakdown(data: DashboardData, range?: DateRange): ObjectiveBreakdown {
  const ads = filterAds(data.adDaily, range);
  const leads = filterLeads(data.leads, range);

  // ad → bucket (o objetivo de um anúncio é estável; usa a primeira linha vista)
  const adBucket = new Map<string, ObjectiveBucket>();
  for (const r of ads) {
    if (!adBucket.has(r.adId)) adBucket.set(r.adId, bucketOfAd(r));
  }

  const acc: Record<ObjectiveBucket, ObjectiveKpis> = {
    conversao: emptyObjectiveKpis("conversao"),
    descoberta: emptyObjectiveKpis("descoberta"),
  };
  for (const r of ads) {
    const a = acc[bucketOfAd(r)];
    a.spend += r.spend;
    a.impressions += r.impressions;
    a.reach += r.reach;
    a.clicks += r.clicks;
  }
  for (const l of leads) {
    const b = (l.utmContent && adBucket.get(l.utmContent)) || "conversao";
    acc[b].leads += 1;
    if (isBooked(l)) acc[b].meetings += 1;
  }
  for (const b of ["conversao", "descoberta"] as ObjectiveBucket[]) {
    const a = acc[b];
    a.ctr = div(a.clicks, a.impressions);
    a.cpm = div(a.spend, a.impressions) * 1000;
    a.costPerReach = div(a.spend, a.reach) * 1000;
    a.cpl = div(a.spend, a.leads);
    a.cpr = div(a.spend, a.meetings);
  }

  const totalSpend = acc.conversao.spend + acc.descoberta.spend;
  const netNewFollowers = igAccountTotals(data.igAccountDaily, range).netNew;
  return {
    conversao: acc.conversao,
    descoberta: acc.descoberta,
    totalSpend,
    conversaoShare: div(acc.conversao.spend, totalSpend),
    descobertaShare: div(acc.descoberta.spend, totalSpend),
    hasDiscovery: acc.descoberta.spend > 0,
    netNewFollowers,
    costPerFollowerEst: div(acc.descoberta.spend, netNewFollowers),
  };
}

// ---- meetings (from the leads list) --------------------------------

export function isBooked(l: Lead): boolean {
  return l.status === "agendou" || l.status === "compareceu";
}

export function countMeetings(leads: Lead[]): number {
  return leads.filter(isBooked).length;
}

export function countAttended(leads: Lead[]): number {
  return leads.filter((l) => l.status === "compareceu").length;
}

/** custo por reunião agendada (North Star) */
export function cpr(spend: number, meetings: number): number {
  return div(spend, meetings);
}

// ---- funnel ---------------------------------------------------------

export interface FunnelStage {
  key: "impressoes" | "cliques" | "leads" | "reunioes";
  label: string;
  value: number;
  /** conversion from the previous stage (ratio), undefined for the first. */
  fromPrev?: number;
}

export function buildFunnel(data: DashboardData, range?: DateRange): FunnelStage[] {
  const ads = filterAds(data.adDaily, range);
  const leads = filterLeads(data.leads, range);
  const impressions = ads.reduce((s, r) => s + r.impressions, 0);
  const clicks = ads.reduce((s, r) => s + r.clicks, 0);
  const leadCount = leads.length;
  const meetings = countMeetings(leads);

  const stages: FunnelStage[] = [
    { key: "impressoes", label: "Impressões", value: impressions },
    { key: "cliques", label: "Cliques", value: clicks, fromPrev: div(clicks, impressions) },
    { key: "leads", label: "Leads", value: leadCount, fromPrev: div(leadCount, clicks) },
    { key: "reunioes", label: "Reuniões", value: meetings, fromPrev: div(meetings, leadCount) },
  ];
  return stages;
}

// ---- headline KPI bundle for the overview --------------------------

export interface OverviewKpis {
  spend: number; // investimento total (blended) — todos os objetivos
  spendConversao: number; // parcela de conversão
  spendDescoberta: number; // parcela de descoberta
  leads: number;
  cpl: number; // FIEL: gasto de conversão ÷ leads de conversão
  cplBlended: number; // gasto total ÷ leads (legado, para referência)
  meetings: number;
  attended: number;
  cpr: number; // FIEL (North Star): gasto de conversão ÷ reuniões de conversão
  cprBlended: number; // gasto total ÷ reuniões (legado, para referência)
  ctr: number;
  clicks: number;
  impressions: number;
  leadToMeeting: number; // ratio
  showRate: number; // compareceu / booked
  hasDiscovery: boolean; // há orçamento de descoberta no período?
}

export function overviewKpis(data: DashboardData, range?: DateRange): OverviewKpis {
  const ads = filterAds(data.adDaily, range);
  const leads = filterLeads(data.leads, range);
  const k = adKpis(ads);
  const meetings = countMeetings(leads);
  const attended = countAttended(leads);
  const obj = objectiveBreakdown(data, range);
  return {
    spend: k.spend,
    spendConversao: obj.conversao.spend,
    spendDescoberta: obj.descoberta.spend,
    leads: leads.length,
    cpl: obj.conversao.cpl,
    cplBlended: div(k.spend, leads.length),
    meetings,
    attended,
    cpr: obj.conversao.cpr,
    cprBlended: cpr(k.spend, meetings),
    ctr: k.ctr,
    clicks: k.clicks,
    impressions: k.impressions,
    leadToMeeting: div(meetings, leads.length),
    showRate: div(attended, meetings),
    hasDiscovery: obj.hasDiscovery,
  };
}

// ---- time series ----------------------------------------------------

export interface DailyPoint {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl: number;
}

export function dailySeries(data: DashboardData, range?: DateRange): DailyPoint[] {
  const ads = filterAds(data.adDaily, range);
  const byDate = new Map<string, DailyPoint>();
  for (const r of ads) {
    const p =
      byDate.get(r.date) ??
      { date: r.date, spend: 0, impressions: 0, clicks: 0, leads: 0, cpl: 0 };
    p.spend += r.spend;
    p.impressions += r.impressions;
    p.clicks += r.clicks;
    p.leads += r.leads;
    byDate.set(r.date, p);
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({ ...p, cpl: div(p.spend, p.leads) }));
}

export interface FollowerPoint {
  date: string;
  followers: number;
  gain: number;
  reach: number;
  views: number;
}

export function followerSeries(rows: IgAccountDaily[], range?: DateRange): FollowerPoint[] {
  const sorted = [...rows]
    .filter((r) => inRange(r.date, range))
    .sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((r, i) => ({
    date: r.date,
    followers: r.followers,
    gain: i === 0 ? 0 : r.followers - sorted[i - 1].followers,
    reach: r.reach,
    views: r.views,
  }));
}

// ---- per-creative ---------------------------------------------------

export interface CreativePerf {
  adId: string;
  name: string;
  format: Creative["format"];
  adset: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  meetings: number;
  ctr: number;
  cpc: number;
  cpl: number;
  cpr: number;
  hookRate?: number; // 3s plays / impressions
  thruPlayRate?: number; // thruplays / impressions
}

export function creativePerformance(
  data: DashboardData,
  range?: DateRange,
): CreativePerf[] {
  const ads = filterAds(data.adDaily, range);
  const leads = filterLeads(data.leads, range);
  const byAd = new Map<string, AdDaily[]>();
  for (const r of ads) {
    const list = byAd.get(r.adId) ?? [];
    list.push(r);
    byAd.set(r.adId, list);
  }

  const meetingsByAd = new Map<string, number>();
  for (const l of leads) {
    if (isBooked(l) && l.utmContent) {
      meetingsByAd.set(l.utmContent, (meetingsByAd.get(l.utmContent) ?? 0) + 1);
    }
  }

  const result: CreativePerf[] = [];
  for (const creative of data.creatives) {
    const rows = byAd.get(creative.adId) ?? [];
    if (rows.length === 0 && !range) {
      // keep creatives with no rows out of the table entirely
    }
    const k = adKpis(rows);
    const meetings = meetingsByAd.get(creative.adId) ?? 0;
    const adset = rows[0]?.adset ?? "—";
    result.push({
      adId: creative.adId,
      name: creative.name,
      format: creative.format,
      adset,
      spend: k.spend,
      impressions: k.impressions,
      clicks: k.clicks,
      leads: k.leads,
      meetings,
      ctr: k.ctr,
      cpc: k.cpc,
      cpl: k.cpl,
      cpr: div(k.spend, meetings),
      hookRate: creative.videoPlays ? div(creative.videoPlays, k.impressions) : undefined,
      thruPlayRate: creative.thruPlays ? div(creative.thruPlays, k.impressions) : undefined,
    });
  }
  return result
    .filter((c) => c.spend > 0)
    .sort((a, b) => b.spend - a.spend);
}

// ---- per-adset / per-campaign --------------------------------------

export interface GroupPerf {
  key: string;
  bucket: ObjectiveBucket; // balde dominante (por gasto) do grupo
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  ctr: number;
  cpl: number;
}

/** Balde de objetivo dominante (por gasto) de um conjunto de linhas. */
function dominantBucket(rows: AdDaily[]): ObjectiveBucket {
  let conv = 0;
  let disc = 0;
  for (const r of rows) {
    if (bucketOfAd(r) === "descoberta") disc += r.spend;
    else conv += r.spend;
  }
  return disc > conv ? "descoberta" : "conversao";
}

export function groupBy(
  rows: AdDaily[],
  pick: (r: AdDaily) => string,
): GroupPerf[] {
  const map = new Map<string, AdDaily[]>();
  for (const r of rows) {
    const key = pick(r);
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([key, list]) => {
      const k = adKpis(list);
      return {
        key,
        bucket: dominantBucket(list),
        spend: k.spend,
        impressions: k.impressions,
        clicks: k.clicks,
        leads: k.leads,
        ctr: k.ctr,
        cpl: k.cpl,
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

// ---- posts ----------------------------------------------------------

export function postEngagementRate(p: IgPost): number {
  return div(p.likes + p.comments + p.saved + p.shares, p.reach);
}

export interface PostPerf extends IgPost {
  interactions: number;
  engagementRate: number;
}

export function postPerformance(posts: IgPost[], range?: DateRange): PostPerf[] {
  return posts
    .filter((p) => inRange(dayOf(p.publishedAt), range))
    .map((p) => ({
      ...p,
      interactions: p.likes + p.comments + p.saved + p.shares,
      engagementRate: postEngagementRate(p),
    }))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

// ---- instagram: account totals (period-over-period ready) ----------

export interface IgAccountTotals {
  followersEnd: number;
  followersStart: number;
  netNew: number;
  reach: number;
  views: number;
  interactions: number;
  profileLinkTaps: number;
  profileViews: number;
  accountsEngaged: number;
  engagementRate: number; // interactions / reach
  linkTapRate: number; // profile link taps / profile views
  reachFollowers: number;
  reachNonFollowers: number;
  discoveryRate: number; // non-follower reach / total split reach
  hasReachSplit: boolean; // whether the follow_type breakdown was available
}

/** Sum an Instagram account window, reusable for the current and previous period. */
export function igAccountTotals(rows: IgAccountDaily[], range?: DateRange): IgAccountTotals {
  const sorted = [...rows]
    .filter((r) => inRange(r.date, range))
    .sort((a, b) => a.date.localeCompare(b.date));
  const sum = (pick: (r: IgAccountDaily) => number) => sorted.reduce((s, r) => s + pick(r), 0);
  const reach = sum((r) => r.reach);
  const interactions = sum((r) => r.totalInteractions);
  const profileLinkTaps = sum((r) => r.profileLinkTaps);
  const profileViews = sum((r) => r.profileViews ?? 0);
  const reachFollowers = sum((r) => r.reachFollowers ?? 0);
  const reachNonFollowers = sum((r) => r.reachNonFollowers ?? 0);
  const hasReachSplit = sorted.some(
    (r) => r.reachFollowers != null || r.reachNonFollowers != null,
  );
  const followersEnd = sorted.at(-1)?.followers ?? 0;
  const followersStart = sorted[0]?.followers ?? 0;
  return {
    followersEnd,
    followersStart,
    netNew: followersEnd - followersStart,
    reach,
    views: sum((r) => r.views),
    interactions,
    profileLinkTaps,
    profileViews,
    accountsEngaged: sum((r) => r.accountsEngaged),
    engagementRate: div(interactions, reach),
    linkTapRate: div(profileLinkTaps, profileViews),
    reachFollowers,
    reachNonFollowers,
    discoveryRate: div(reachNonFollowers, reachFollowers + reachNonFollowers),
    hasReachSplit,
  };
}

// ---- instagram: performance by post format -------------------------

const IG_TYPE_LABEL: Record<IgPost["type"], string> = {
  feed: "Feed",
  carrossel: "Carrossel",
  reel: "Reel",
  story: "Story",
};

export interface FormatPerf {
  type: IgPost["type"];
  label: string;
  count: number;
  avgReach: number;
  avgEngagement: number; // mean of per-post engagement rate
  saveRate: number; // total saved / total reach
  shareRate: number; // total shares / total reach
  avgWatchTime?: number; // reels only (seconds)
  totalWatchTime?: number; // reels only (sum of seconds watched)
}

/** Group posts by format so the planner can compare reel vs carousel vs feed. */
export function formatPerformance(posts: IgPost[], range?: DateRange): FormatPerf[] {
  const byType = new Map<IgPost["type"], IgPost[]>();
  for (const p of posts.filter((p) => inRange(dayOf(p.publishedAt), range))) {
    const list = byType.get(p.type) ?? [];
    list.push(p);
    byType.set(p.type, list);
  }
  const out: FormatPerf[] = [];
  for (const [type, list] of byType) {
    const n = list.length;
    const totReach = list.reduce((s, p) => s + p.reach, 0);
    const totSaved = list.reduce((s, p) => s + p.saved, 0);
    const totShares = list.reduce((s, p) => s + p.shares, 0);
    const watch = list.filter((p) => typeof p.avgWatchTime === "number");
    const totWatch = list.reduce((s, p) => s + (p.totalWatchTime ?? 0), 0);
    out.push({
      type,
      label: IG_TYPE_LABEL[type],
      count: n,
      avgReach: div(totReach, n),
      avgEngagement: div(
        list.reduce((s, p) => s + postEngagementRate(p), 0),
        n,
      ),
      saveRate: div(totSaved, totReach),
      shareRate: div(totShares, totReach),
      avgWatchTime: watch.length
        ? div(
            watch.reduce((s, p) => s + (p.avgWatchTime ?? 0), 0),
            watch.length,
          )
        : undefined,
      totalWatchTime: totWatch > 0 ? totWatch : undefined,
    });
  }
  // best-engaging format first (the "champion" to double down on)
  return out.sort((a, b) => b.avgEngagement - a.avgEngagement);
}

// ---- instagram: best weekday to post -------------------------------

const WEEKDAY_LABEL = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export interface WeekdayPerf {
  weekday: number; // 0=Sun … 6=Sat
  label: string;
  count: number;
  avgReach: number;
  avgEngagement: number;
}

/** Average engagement/reach per weekday, to hint the best publishing days. */
export function weekdayPerformance(posts: IgPost[], range?: DateRange): WeekdayPerf[] {
  const byDay = new Map<number, IgPost[]>();
  for (const p of posts.filter((p) => inRange(dayOf(p.publishedAt), range))) {
    const wd = new Date(p.publishedAt).getUTCDay();
    const list = byDay.get(wd) ?? [];
    list.push(p);
    byDay.set(wd, list);
  }
  const out: WeekdayPerf[] = [];
  for (let wd = 0; wd < 7; wd++) {
    const list = byDay.get(wd);
    if (!list?.length) continue;
    out.push({
      weekday: wd,
      label: WEEKDAY_LABEL[wd],
      count: list.length,
      avgReach: div(
        list.reduce((s, p) => s + p.reach, 0),
        list.length,
      ),
      avgEngagement: div(
        list.reduce((s, p) => s + postEngagementRate(p), 0),
        list.length,
      ),
    });
  }
  return out;
}

// ---- landing page ---------------------------------------------------

export interface LpKpis {
  visits: number;
  clicks: number;
  formSubmits: number;
  visitToLead: number; // formSubmits / visits
  ctaRate: number; // clicks / visits
}

export function lpKpis(data: DashboardData, range?: DateRange): LpKpis {
  const rows = range
    ? data.lpDaily.filter((r) => inRange(r.date, range))
    : data.lpDaily;
  const visits = rows.reduce((s, r) => s + r.visits, 0);
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const formSubmits = rows.reduce((s, r) => s + r.formSubmits, 0);
  return {
    visits,
    clicks,
    formSubmits,
    visitToLead: div(formSubmits, visits),
    ctaRate: div(clicks, visits),
  };
}

// ---- deltas (period over period) -----------------------------------

export interface Delta {
  abs: number;
  pct: number; // ratio vs previous
  direction: "up" | "down" | "flat";
}

export function delta(current: number, previous: number): Delta {
  const abs = current - previous;
  const pct = previous !== 0 ? abs / previous : 0;
  const direction = abs > 0 ? "up" : abs < 0 ? "down" : "flat";
  return { abs, pct, direction };
}

// ---- goals ----------------------------------------------------------

export interface GoalProgress {
  metric: Goal["metric"];
  target: number;
  actual: number;
  pct: number; // 0–1+ progress toward the target
  onTrack: boolean;
  lowerIsBetter: boolean;
}

export function goalProgress(goal: Goal, actual: number): GoalProgress {
  const lower = goal.lowerIsBetter ?? false;
  // For "lower is better" (cost) goals, progress = target/actual.
  const pct = lower ? div(goal.target, actual) : div(actual, goal.target);
  const onTrack = lower ? actual <= goal.target : actual >= goal.target;
  return { metric: goal.metric, target: goal.target, actual, pct, onTrack, lowerIsBetter: lower };
}

/** Resolve the actual value for a goal metric from the current dataset. */
export function actualForGoal(goal: Goal, data: DashboardData, range?: DateRange): number {
  const k = overviewKpis(data, range);
  switch (goal.metric) {
    case "leads":
      return k.leads;
    case "meetings":
      return k.meetings;
    case "cpl":
      return k.cpl;
    case "cpr":
      return k.cpr;
    case "spend":
      return k.spend;
    case "followers": {
      const last = [...data.igAccountDaily].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
      return last?.followers ?? 0;
    }
    default:
      return 0;
  }
}

// ---- convenience: full date span of the dataset --------------------

export function dataDateRange(data: DashboardData): DateRange {
  const dates = data.adDaily.map((r) => r.date).sort();
  return { from: dates[0] ?? "", to: dates.at(-1) ?? "" };
}
