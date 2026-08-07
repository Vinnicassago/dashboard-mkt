/**
 * Pure row mappers: DB snake_case  <->  domain camelCase.
 * Shared by the Supabase and the direct-Postgres backends. No I/O here.
 *
 * Both backends hand rows in with string timestamps and (possibly) string
 * numerics — the Postgres backend configures type parsers so timestamps arrive
 * as ISO strings — so `s()`/`n()`/`day()` work unchanged for either source.
 */

import { toRole } from "../auth/roles";
import type {
  AdDaily,
  Campaign,
  CampaignStatus,
  Creative,
  CreativeFormat,
  Goal,
  GoalMetric,
  IgAccountDaily,
  IgMediaType,
  IgPost,
  Lead,
  LeadEvent,
  LeadEventAction,
  LeadStatus,
  LpDaily,
} from "../types";
import type { PublicUser, StoredUser } from "./backend";

export type Row = Record<string, unknown>;

export const n = (v: unknown) => Number(v ?? 0);
export const s = (v: unknown) => String(v ?? "");
export const day = (v: unknown) => s(v).slice(0, 10);

/**
 * Normalise a datetime to an ISO string. Supabase hands us ISO strings; the
 * Postgres driver hands us a Date object — both end up as clean ISO here.
 */
export const iso = (v: unknown): string => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v);
};

export const FALLBACK_CAMPAIGN: Campaign = {
  id: "campanha",
  name: "Campanha",
  objective: "Cadastros (leads)",
  status: "ativa",
  startDate: "",
  budgetTotal: 0,
};

export const toCampaign = (r: Row): Campaign => ({
  id: s(r.id),
  name: s(r.name),
  objective: s(r.objective),
  status: s(r.status) as CampaignStatus,
  startDate: day(r.start_date),
  endDate: r.end_date ? day(r.end_date) : undefined,
  budgetTotal: n(r.budget_total),
  dailyBudget: r.daily_budget == null ? undefined : n(r.daily_budget),
});

export const fromCampaign = (c: Campaign): Row => ({
  id: c.id,
  name: c.name,
  objective: c.objective,
  status: c.status,
  start_date: c.startDate,
  end_date: c.endDate ?? null,
  budget_total: c.budgetTotal,
  daily_budget: c.dailyBudget ?? null,
});

export const toIgDaily = (r: Row): IgAccountDaily => ({
  date: day(r.date),
  followers: n(r.followers),
  reach: n(r.reach),
  views: n(r.views),
  profileLinkTaps: n(r.profile_link_taps),
  accountsEngaged: n(r.accounts_engaged),
  totalInteractions: n(r.total_interactions),
  profileViews: n(r.profile_views),
  reachFollowers: r.reach_followers == null ? undefined : n(r.reach_followers),
  reachNonFollowers: r.reach_non_followers == null ? undefined : n(r.reach_non_followers),
});

export const fromIgDaily = (r: IgAccountDaily): Row => ({
  date: r.date,
  followers: r.followers,
  reach: r.reach,
  views: r.views,
  profile_link_taps: r.profileLinkTaps,
  accounts_engaged: r.accountsEngaged,
  total_interactions: r.totalInteractions,
  profile_views: r.profileViews,
  reach_followers: r.reachFollowers ?? null,
  reach_non_followers: r.reachNonFollowers ?? null,
});

export const toPost = (r: Row): IgPost => ({
  id: s(r.id),
  publishedAt: iso(r.published_at),
  type: s(r.type) as IgMediaType,
  caption: s(r.caption),
  permalink: s(r.permalink),
  reach: n(r.reach),
  views: n(r.views),
  likes: n(r.likes),
  comments: n(r.comments),
  saved: n(r.saved),
  shares: n(r.shares),
  avgWatchTime: r.avg_watch_time == null ? undefined : n(r.avg_watch_time),
  totalWatchTime: r.total_watch_time == null ? undefined : n(r.total_watch_time),
});

export const fromPost = (p: IgPost): Row => ({
  id: p.id,
  published_at: p.publishedAt,
  type: p.type,
  caption: p.caption,
  permalink: p.permalink,
  reach: p.reach,
  views: p.views,
  likes: p.likes,
  comments: p.comments,
  saved: p.saved,
  shares: p.shares,
  avg_watch_time: p.avgWatchTime ?? null,
  total_watch_time: p.totalWatchTime ?? null,
});

export const toCreative = (r: Row): Creative => ({
  adId: s(r.ad_id),
  name: s(r.name),
  format: s(r.format) as CreativeFormat,
  thumbnailUrl: r.thumbnail_url ? s(r.thumbnail_url) : undefined,
  videoPlays: r.video_plays == null ? undefined : n(r.video_plays),
  thruPlays: r.thru_plays == null ? undefined : n(r.thru_plays),
});

export const fromCreative = (c: Creative): Row => ({
  ad_id: c.adId,
  name: c.name,
  format: c.format,
  thumbnail_url: c.thumbnailUrl ?? null,
  video_plays: c.videoPlays ?? null,
  thru_plays: c.thruPlays ?? null,
});

export const toAd = (r: Row): AdDaily => ({
  date: day(r.date),
  campaign: s(r.campaign),
  adset: s(r.adset),
  adId: s(r.ad_id),
  objective: r.objective ? s(r.objective) : undefined,
  spend: n(r.spend),
  impressions: n(r.impressions),
  reach: n(r.reach),
  frequency: n(r.frequency),
  clicks: n(r.clicks),
  leads: n(r.leads),
});

export const fromAd = (a: AdDaily): Row => ({
  date: a.date,
  ad_id: a.adId,
  campaign: a.campaign,
  adset: a.adset,
  objective: a.objective ?? null,
  spend: a.spend,
  impressions: a.impressions,
  reach: a.reach,
  frequency: a.frequency,
  clicks: a.clicks,
  leads: a.leads,
});

export const toLp = (r: Row): LpDaily => ({
  date: day(r.date),
  visits: n(r.visits),
  clicks: n(r.clicks),
  formSubmits: n(r.form_submits),
});

export const fromLp = (l: LpDaily): Row => ({
  date: l.date,
  visits: l.visits,
  clicks: l.clicks,
  form_submits: l.formSubmits,
});

export const toLead = (r: Row): Lead => ({
  id: s(r.id),
  createdAt: iso(r.created_at),
  name: s(r.name),
  email: r.email ? s(r.email) : undefined,
  phone: r.phone ? s(r.phone) : undefined,
  utmSource: r.utm_source ? s(r.utm_source) : undefined,
  utmCampaign: r.utm_campaign ? s(r.utm_campaign) : undefined,
  utmContent: r.utm_content ? s(r.utm_content) : undefined,
  status: s(r.status) as LeadStatus,
  meetingAt: r.meeting_at ? iso(r.meeting_at) : undefined,
  value: r.value == null ? undefined : n(r.value),
  fbc: r.fbc ? s(r.fbc) : undefined,
  fbp: r.fbp ? s(r.fbp) : undefined,
  gaClientId: r.ga_client_id ? s(r.ga_client_id) : undefined,
  gaSessionId: r.ga_session_id ? s(r.ga_session_id) : undefined,
});

export const fromLead = (l: Lead): Row => ({
  id: l.id,
  created_at: l.createdAt,
  name: l.name,
  email: l.email ?? null,
  phone: l.phone ?? null,
  utm_source: l.utmSource ?? null,
  utm_campaign: l.utmCampaign ?? null,
  utm_content: l.utmContent ?? null,
  status: l.status,
  meeting_at: l.meetingAt ?? null,
  value: l.value ?? null,
  fbc: l.fbc ?? null,
  fbp: l.fbp ?? null,
  ga_client_id: l.gaClientId ?? null,
  ga_session_id: l.gaSessionId ?? null,
});

export const toGoal = (r: Row): Goal => ({
  metric: s(r.metric) as GoalMetric,
  period: s(r.period) as Goal["period"],
  target: n(r.target),
  lowerIsBetter: Boolean(r.lower_is_better),
});

export const fromGoal = (g: Goal): Row => ({
  metric: g.metric,
  period: g.period,
  target: g.target,
  lower_is_better: g.lowerIsBetter ?? false,
});

export const toStoredUser = (r: Row): StoredUser => ({
  username: s(r.username),
  passwordHash: s(r.password_hash),
  role: toRole(r.role),
  createdAt: iso(r.created_at),
});

export const toPublicUser = (r: Row): PublicUser => ({
  username: s(r.username),
  role: toRole(r.role),
  createdAt: iso(r.created_at),
});

export const fromStoredUser = (u: StoredUser): Row => ({
  username: u.username,
  password_hash: u.passwordHash,
  role: u.role,
  created_at: u.createdAt,
});

export const toEvent = (r: Row): LeadEvent => ({
  id: s(r.id),
  leadId: s(r.lead_id),
  leadName: s(r.lead_name),
  actor: s(r.actor),
  action: s(r.action) as LeadEventAction,
  fromStatus: r.from_status ? (s(r.from_status) as LeadStatus) : undefined,
  toStatus: r.to_status ? (s(r.to_status) as LeadStatus) : undefined,
  createdAt: iso(r.created_at),
});

export const fromEvent = (e: LeadEvent): Row => ({
  id: e.id,
  lead_id: e.leadId,
  lead_name: e.leadName,
  actor: e.actor,
  action: e.action,
  from_status: e.fromStatus ?? null,
  to_status: e.toStatus ?? null,
  created_at: e.createdAt,
});
