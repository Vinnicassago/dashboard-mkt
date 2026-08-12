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
  AiReview,
  DraftStatus,
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
  PostDraft,
} from "../types";
import { DEFAULT_BRAND } from "../types";
import type { PublicUser, StoredUser } from "./backend";

export type Row = Record<string, unknown>;

export const n = (v: unknown) => Number(v ?? 0);
export const s = (v: unknown) => String(v ?? "");
export const day = (v: unknown) => s(v).slice(0, 10);
/** Marca da linha; linhas antigas (sem a coluna) caem na marca padrão. */
export const brandOf = (v: unknown) => (v ? s(v) : DEFAULT_BRAND);

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
  brand: DEFAULT_BRAND,
  name: "Campanha",
  objective: "Cadastros (leads)",
  status: "ativa",
  startDate: "",
  budgetTotal: 0,
};

export const toCampaign = (r: Row): Campaign => ({
  id: s(r.id),
  brand: brandOf(r.brand),
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
  brand: c.brand,
  name: c.name,
  objective: c.objective,
  status: c.status,
  start_date: c.startDate,
  end_date: c.endDate ?? null,
  budget_total: c.budgetTotal,
  daily_budget: c.dailyBudget ?? null,
});

export const toIgDaily = (r: Row): IgAccountDaily => ({
  brand: brandOf(r.brand),
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
  dmConversations: r.dm_conversations == null ? undefined : n(r.dm_conversations),
  followsDay: r.follows_day == null ? undefined : n(r.follows_day),
  unfollowsDay: r.unfollows_day == null ? undefined : n(r.unfollows_day),
  linkTapsWebsite: r.link_taps_website == null ? undefined : n(r.link_taps_website),
  linkTapsWhatsApp: r.link_taps_whatsapp == null ? undefined : n(r.link_taps_whatsapp),
  storiesPosted: r.stories_posted == null ? undefined : n(r.stories_posted),
  storiesInteractive: r.stories_interactive == null ? undefined : n(r.stories_interactive),
  nicheComments: r.niche_comments == null ? undefined : n(r.niche_comments),
  accountsFollowed: r.accounts_followed == null ? undefined : n(r.accounts_followed),
  repliedAll: r.replied_all == null ? undefined : Boolean(r.replied_all),
});

export const fromIgDaily = (r: IgAccountDaily): Row => ({
  brand: r.brand,
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
  dm_conversations: r.dmConversations ?? null,
  follows_day: r.followsDay ?? null,
  unfollows_day: r.unfollowsDay ?? null,
  link_taps_website: r.linkTapsWebsite ?? null,
  link_taps_whatsapp: r.linkTapsWhatsApp ?? null,
  stories_posted: r.storiesPosted ?? null,
  stories_interactive: r.storiesInteractive ?? null,
  niche_comments: r.nicheComments ?? null,
  accounts_followed: r.accountsFollowed ?? null,
  replied_all: r.repliedAll ?? null,
});

export const toPost = (r: Row): IgPost => ({
  id: s(r.id),
  brand: brandOf(r.brand),
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
  durationSec: r.duration_sec == null ? undefined : n(r.duration_sec),
  pillar: r.pillar ? s(r.pillar) : undefined,
  ctaType: r.cta_type ? (s(r.cta_type) as IgPost["ctaType"]) : undefined,
  profileVisits: r.profile_visits == null ? undefined : n(r.profile_visits),
  follows: r.follows == null ? undefined : n(r.follows),
  mediaUrl: r.media_url ? s(r.media_url) : undefined,
  thumbnailUrl: r.thumbnail_url ? s(r.thumbnail_url) : undefined,
  isTest: r.is_test ? true : undefined,
});

export const fromPost = (p: IgPost): Row => ({
  id: p.id,
  brand: p.brand,
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
  duration_sec: p.durationSec ?? null,
  pillar: p.pillar ?? null,
  cta_type: p.ctaType ?? null,
  profile_visits: p.profileVisits ?? null,
  follows: p.follows ?? null,
  media_url: p.mediaUrl ?? null,
  thumbnail_url: p.thumbnailUrl ?? null,
  is_test: p.isTest ?? false,
});

export const toCreative = (r: Row): Creative => ({
  adId: s(r.ad_id),
  brand: brandOf(r.brand),
  name: s(r.name),
  format: s(r.format) as CreativeFormat,
  thumbnailUrl: r.thumbnail_url ? s(r.thumbnail_url) : undefined,
  videoPlays: r.video_plays == null ? undefined : n(r.video_plays),
  thruPlays: r.thru_plays == null ? undefined : n(r.thru_plays),
  instagramMediaId: r.instagram_media_id ? s(r.instagram_media_id) : undefined,
  instagramPermalink: r.instagram_permalink ? s(r.instagram_permalink) : undefined,
});

export const fromCreative = (c: Creative): Row => ({
  ad_id: c.adId,
  brand: c.brand,
  name: c.name,
  format: c.format,
  thumbnail_url: c.thumbnailUrl ?? null,
  video_plays: c.videoPlays ?? null,
  thru_plays: c.thruPlays ?? null,
  instagram_media_id: c.instagramMediaId ?? null,
  instagram_permalink: c.instagramPermalink ?? null,
});

export const toAd = (r: Row): AdDaily => ({
  brand: brandOf(r.brand),
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
  brand: a.brand,
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
  brand: brandOf(r.brand),
  date: day(r.date),
  visits: n(r.visits),
  clicks: n(r.clicks),
  formSubmits: n(r.form_submits),
});

export const fromLp = (l: LpDaily): Row => ({
  brand: l.brand,
  date: l.date,
  visits: l.visits,
  clicks: l.clicks,
  form_submits: l.formSubmits,
});

export const toLead = (r: Row): Lead => ({
  id: s(r.id),
  brand: brandOf(r.brand),
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
  brand: l.brand,
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
  brand: brandOf(r.brand),
  metric: s(r.metric) as GoalMetric,
  period: s(r.period) as Goal["period"],
  target: n(r.target),
  lowerIsBetter: Boolean(r.lower_is_better),
});

export const fromGoal = (g: Goal): Row => ({
  brand: g.brand,
  metric: g.metric,
  period: g.period,
  target: g.target,
  lower_is_better: g.lowerIsBetter ?? false,
});

export const toDraft = (r: Row): PostDraft => ({
  id: s(r.id),
  brand: brandOf(r.brand),
  status: s(r.status) as DraftStatus,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  plannedFor: r.planned_for ? day(r.planned_for) : undefined,
  type: s(r.type) as IgMediaType,
  pillar: r.pillar ? s(r.pillar) : undefined,
  hookText: s(r.hook_text),
  hookSpoken: s(r.hook_spoken),
  promise: r.promise ? s(r.promise) : undefined,
  script: s(r.script),
  caption: s(r.caption),
  ctaType: r.cta_type ? (s(r.cta_type) as PostDraft["ctaType"]) : undefined,
  ctaKeyword: r.cta_keyword ? s(r.cta_keyword) : undefined,
  durationSec: r.duration_sec == null ? undefined : n(r.duration_sec),
  hasBurnedCaptions: r.has_burned_captions ? true : undefined,
  score: r.score == null ? undefined : n(r.score),
  validatedAt: r.validated_at ? iso(r.validated_at) : undefined,
  playbookVersion: r.playbook_version ? s(r.playbook_version) : undefined,
  publishedPostId: r.published_post_id ? s(r.published_post_id) : undefined,
  notes: r.notes ? s(r.notes) : undefined,
  // jsonb: o Postgres devolve objeto já parseado; o Supabase idem. String só
  // aparece se alguém gravou texto na coluna — tolera sem quebrar a leitura.
  aiReview: parseJson<AiReview>(r.ai_review),
  validationFailed: parseJson<string[]>(r.validation_failed),
});

function parseJson<T>(v: unknown): T | undefined {
  if (v == null) return undefined;
  if (typeof v === "object") return v as T;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export const fromDraft = (d: PostDraft): Row => ({
  id: d.id,
  brand: d.brand,
  status: d.status,
  created_at: d.createdAt,
  updated_at: d.updatedAt,
  planned_for: d.plannedFor ?? null,
  type: d.type,
  pillar: d.pillar ?? null,
  hook_text: d.hookText,
  hook_spoken: d.hookSpoken,
  promise: d.promise ?? null,
  script: d.script,
  caption: d.caption,
  cta_type: d.ctaType ?? null,
  cta_keyword: d.ctaKeyword ?? null,
  duration_sec: d.durationSec ?? null,
  has_burned_captions: d.hasBurnedCaptions ?? false,
  score: d.score ?? null,
  validated_at: d.validatedAt ?? null,
  playbook_version: d.playbookVersion ?? null,
  published_post_id: d.publishedPostId ?? null,
  notes: d.notes ?? null,
  // jsonb precisa de string no driver `pg`; o Supabase aceita ambos.
  ai_review: d.aiReview ? JSON.stringify(d.aiReview) : null,
  validation_failed: d.validationFailed ? JSON.stringify(d.validationFailed) : null,
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
