import "server-only";
import { supabase } from "../supabase/client";
import { buildSeedData, buildSeedLeadEvents } from "./seed";
import type { DataBackend, LpDelta, PublicUser, StoredUser } from "./backend";
import { toRole } from "../auth/roles";
import type {
  AdDaily,
  Campaign,
  CampaignStatus,
  Creative,
  CreativeFormat,
  DashboardData,
  Goal,
  GoalMetric,
  IgAccountDaily,
  IgMediaType,
  IgPost,
  Lead,
  LeadEvent,
  LeadEventAction,
  LeadStatus,
} from "../types";

/* ------------------------------------------------------------------ */
/* row mappers: DB snake_case  <->  domain camelCase                   */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => String(v ?? "");
const day = (v: unknown) => s(v).slice(0, 10);

const toCampaign = (r: Row): Campaign => ({
  id: s(r.id),
  name: s(r.name),
  objective: s(r.objective),
  status: s(r.status) as CampaignStatus,
  startDate: day(r.start_date),
  endDate: r.end_date ? day(r.end_date) : undefined,
  budgetTotal: n(r.budget_total),
  dailyBudget: r.daily_budget == null ? undefined : n(r.daily_budget),
});

const fromCampaign = (c: Campaign): Row => ({
  id: c.id,
  name: c.name,
  objective: c.objective,
  status: c.status,
  start_date: c.startDate,
  end_date: c.endDate ?? null,
  budget_total: c.budgetTotal,
  daily_budget: c.dailyBudget ?? null,
});

const toIgDaily = (r: Row): IgAccountDaily => ({
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

const fromIgDaily = (r: IgAccountDaily): Row => ({
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

const toPost = (r: Row): IgPost => ({
  id: s(r.id),
  publishedAt: s(r.published_at),
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

const fromPost = (p: IgPost): Row => ({
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

const toCreative = (r: Row): Creative => ({
  adId: s(r.ad_id),
  name: s(r.name),
  format: s(r.format) as CreativeFormat,
  thumbnailUrl: r.thumbnail_url ? s(r.thumbnail_url) : undefined,
  videoPlays: r.video_plays == null ? undefined : n(r.video_plays),
  thruPlays: r.thru_plays == null ? undefined : n(r.thru_plays),
});

const fromCreative = (c: Creative): Row => ({
  ad_id: c.adId,
  name: c.name,
  format: c.format,
  thumbnail_url: c.thumbnailUrl ?? null,
  video_plays: c.videoPlays ?? null,
  thru_plays: c.thruPlays ?? null,
});

const toAd = (r: Row): AdDaily => ({
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

const fromAd = (a: AdDaily): Row => ({
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

const toLead = (r: Row): Lead => ({
  id: s(r.id),
  createdAt: s(r.created_at),
  name: s(r.name),
  email: r.email ? s(r.email) : undefined,
  phone: r.phone ? s(r.phone) : undefined,
  utmSource: r.utm_source ? s(r.utm_source) : undefined,
  utmCampaign: r.utm_campaign ? s(r.utm_campaign) : undefined,
  utmContent: r.utm_content ? s(r.utm_content) : undefined,
  status: s(r.status) as LeadStatus,
  meetingAt: r.meeting_at ? s(r.meeting_at) : undefined,
  value: r.value == null ? undefined : n(r.value),
  fbc: r.fbc ? s(r.fbc) : undefined,
  fbp: r.fbp ? s(r.fbp) : undefined,
  gaClientId: r.ga_client_id ? s(r.ga_client_id) : undefined,
  gaSessionId: r.ga_session_id ? s(r.ga_session_id) : undefined,
});

const fromLead = (l: Lead): Row => ({
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

const toGoal = (r: Row): Goal => ({
  metric: s(r.metric) as GoalMetric,
  period: s(r.period) as Goal["period"],
  target: n(r.target),
  lowerIsBetter: Boolean(r.lower_is_better),
});

const fromGoal = (g: Goal): Row => ({
  metric: g.metric,
  period: g.period,
  target: g.target,
  lower_is_better: g.lowerIsBetter ?? false,
});

/* ------------------------------------------------------------------ */

const FALLBACK_CAMPAIGN: Campaign = {
  id: "campanha",
  name: "Campanha",
  objective: "Cadastros (leads)",
  status: "ativa",
  startDate: "",
  budgetTotal: 0,
};

async function touch(isSeed?: boolean) {
  const db = supabase();
  const rows: Row[] = [{ key: "updated_at", value: new Date().toISOString() }];
  if (isSeed !== undefined) rows.push({ key: "is_seed", value: isSeed });
  await db.from("app_state").upsert(rows, { onConflict: "key" });
}

/** Throw with a readable message instead of Supabase's terse error objects. */
function check(error: { message: string } | null, what: string) {
  if (error) throw new Error(`Supabase (${what}): ${error.message}`);
}

export const supabaseBackend: DataBackend = {
  name: "supabase",

  async getData(): Promise<DashboardData> {
    const db = supabase();
    const [campaign, igDaily, posts, ads, creatives, lp, leads, goals, state] =
      await Promise.all([
        db.from("campaign").select("*").limit(1).maybeSingle(),
        db.from("ig_account_daily").select("*").order("date"),
        db.from("ig_posts").select("*").order("published_at", { ascending: false }),
        db.from("ad_daily").select("*").order("date"),
        db.from("creatives").select("*"),
        db.from("lp_daily").select("*").order("date"),
        db.from("leads").select("*").order("created_at", { ascending: false }),
        db.from("goals").select("*"),
        db.from("app_state").select("*"),
      ]);

    check(ads.error, "ad_daily");
    check(igDaily.error, "ig_account_daily");

    const stateMap = new Map(
      (state.data ?? []).map((r: Row) => [s(r.key), r.value as unknown]),
    );

    return {
      campaign: campaign.data ? toCampaign(campaign.data as Row) : FALLBACK_CAMPAIGN,
      igAccountDaily: (igDaily.data ?? []).map(toIgDaily),
      igPosts: (posts.data ?? []).map(toPost),
      adDaily: (ads.data ?? []).map(toAd),
      creatives: (creatives.data ?? []).map(toCreative),
      lpDaily: (lp.data ?? []).map((r: Row) => ({
        date: day(r.date),
        visits: n(r.visits),
        clicks: n(r.clicks),
        formSubmits: n(r.form_submits),
      })),
      leads: (leads.data ?? []).map(toLead),
      goals: (goals.data ?? []).map(toGoal),
      updatedAt: String(stateMap.get("updated_at") ?? new Date().toISOString()),
      isSeed: stateMap.get("is_seed") === true,
    };
  },

  async resetToSeed(): Promise<DashboardData> {
    const db = supabase();
    const seed = buildSeedData();

    // wipe (PostgREST requires a filter, so match "pk is not null")
    await Promise.all([
      db.from("ad_daily").delete().not("ad_id", "is", null),
      db.from("creatives").delete().not("ad_id", "is", null),
      db.from("ig_account_daily").delete().not("date", "is", null),
      db.from("ig_posts").delete().not("id", "is", null),
      db.from("lp_daily").delete().not("date", "is", null),
      db.from("leads").delete().not("id", "is", null),
      db.from("goals").delete().not("metric", "is", null),
      db.from("campaign").delete().not("id", "is", null),
      db.from("lead_events").delete().not("id", "is", null),
    ]);

    await Promise.all([
      db.from("campaign").insert(fromCampaign(seed.campaign)),
      db.from("ig_account_daily").insert(seed.igAccountDaily.map(fromIgDaily)),
      db.from("ig_posts").insert(seed.igPosts.map(fromPost)),
      db.from("creatives").insert(seed.creatives.map(fromCreative)),
      db.from("ad_daily").insert(seed.adDaily.map(fromAd)),
      db.from("lp_daily").insert(
        seed.lpDaily.map((r) => ({
          date: r.date,
          visits: r.visits,
          clicks: r.clicks,
          form_submits: r.formSubmits,
        })),
      ),
      db.from("leads").insert(seed.leads.map(fromLead)),
      db.from("goals").insert(seed.goals.map(fromGoal)),
      db.from("lead_events").insert(
        buildSeedLeadEvents(seed.leads).map((e) => ({
          id: e.id,
          lead_id: e.leadId,
          lead_name: e.leadName,
          actor: e.actor,
          action: e.action,
          from_status: e.fromStatus ?? null,
          to_status: e.toStatus ?? null,
          created_at: e.createdAt,
        })),
      ),
    ]);

    await touch(true);
    return seed;
  },

  async upsertAdDaily(rows: AdDaily[]) {
    if (rows.length === 0) return 0;
    const { error } = await supabase()
      .from("ad_daily")
      .upsert(rows.map(fromAd), { onConflict: "date,ad_id" });
    check(error, "upsert ad_daily");
    await touch(false);
    return rows.length;
  },

  async upsertCreatives(rows: Creative[]) {
    if (rows.length === 0) return 0;
    const { error } = await supabase()
      .from("creatives")
      .upsert(rows.map(fromCreative), { onConflict: "ad_id" });
    check(error, "upsert creatives");
    return rows.length;
  },

  async clearAdData() {
    const db = supabase();
    // PostgREST requires a filter on delete, so match "pk is not null" (all rows).
    const ad = await db.from("ad_daily").delete().not("ad_id", "is", null);
    check(ad.error, "clear ad_daily");
    const cr = await db.from("creatives").delete().not("ad_id", "is", null);
    check(cr.error, "clear creatives");
    await touch(false);
  },

  async upsertIgAccountDaily(rows: IgAccountDaily[]) {
    if (rows.length === 0) return 0;
    const { error } = await supabase()
      .from("ig_account_daily")
      .upsert(rows.map(fromIgDaily), { onConflict: "date" });
    check(error, "upsert ig_account_daily");
    await touch(false);
    return rows.length;
  },

  async upsertIgPosts(rows: IgPost[]) {
    if (rows.length === 0) return 0;
    const { error } = await supabase()
      .from("ig_posts")
      .upsert(rows.map(fromPost), { onConflict: "id" });
    check(error, "upsert ig_posts");
    await touch(false);
    return rows.length;
  },

  async addLead(lead: Lead) {
    const { error } = await supabase().from("leads").upsert(fromLead(lead), {
      onConflict: "id",
    });
    check(error, "insert lead");
    await touch(false);
  },

  async setLeadStatus(id: string, status: LeadStatus, meetingAt?: string, value?: number) {
    const patch: Row = { status };
    if (meetingAt !== undefined) patch.meeting_at = meetingAt;
    if (value !== undefined) patch.value = value;
    const { error } = await supabase().from("leads").update(patch).eq("id", id);
    check(error, "update lead");
    await touch();
  },

  async deleteLead(id: string) {
    const ev = await supabase().from("lead_events").delete().eq("lead_id", id);
    check(ev.error, "delete lead events");
    const { error } = await supabase().from("leads").delete().eq("id", id);
    check(error, "delete lead");
    await touch(false);
  },

  async upsertGoal(goal: Goal) {
    const { error } = await supabase()
      .from("goals")
      .upsert(fromGoal(goal), { onConflict: "metric,period" });
    check(error, "upsert goal");
    await touch();
  },

  async bumpLpDaily(date: string, delta: LpDelta) {
    const db = supabase();
    // Read-modify-write. Fine at this volume; if the landing page ever gets
    // heavy traffic, move this to a Postgres function for atomicity.
    const { data: current } = await db
      .from("lp_daily")
      .select("*")
      .eq("date", date)
      .maybeSingle();

    const row = {
      date,
      visits: n(current?.visits) + (delta.visits ?? 0),
      clicks: n(current?.clicks) + (delta.clicks ?? 0),
      form_submits: n(current?.form_submits) + (delta.formSubmits ?? 0),
    };
    const { error } = await db.from("lp_daily").upsert(row, { onConflict: "date" });
    check(error, "bump lp_daily");
    await touch(false);
  },

  async getState<T>(key: string) {
    const { data } = await supabase()
      .from("app_state")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    return (data?.value as T) ?? null;
  },

  async setState(key: string, value: unknown) {
    const { error } = await supabase()
      .from("app_state")
      .upsert({ key, value }, { onConflict: "key" });
    check(error, "set state");
  },

  async countUsers() {
    const { count, error } = await supabase()
      .from("app_users")
      .select("username", { count: "exact", head: true });
    check(error, "count users");
    return count ?? 0;
  },

  async getUser(username: string) {
    const { data } = await supabase()
      .from("app_users")
      .select("*")
      .eq("username", username)
      .maybeSingle();
    if (!data) return null;
    return {
      username: s(data.username),
      passwordHash: s(data.password_hash),
      role: toRole(data.role),
      createdAt: s(data.created_at),
    };
  },

  async listUsers(): Promise<PublicUser[]> {
    const { data, error } = await supabase()
      .from("app_users")
      .select("username, role, created_at")
      .order("username");
    check(error, "list users");
    return (data ?? []).map((r: Row) => ({
      username: s(r.username),
      role: toRole(r.role),
      createdAt: s(r.created_at),
    }));
  },

  async createUser(user: StoredUser) {
    const { error } = await supabase().from("app_users").upsert(
      {
        username: user.username,
        password_hash: user.passwordHash,
        role: user.role,
        created_at: user.createdAt,
      },
      { onConflict: "username" },
    );
    check(error, "create user");
  },

  async deleteUser(username: string) {
    const { error } = await supabase().from("app_users").delete().eq("username", username);
    check(error, "delete user");
  },

  async setUserRole(username: string, role) {
    const { error } = await supabase()
      .from("app_users")
      .update({ role })
      .eq("username", username);
    check(error, "set user role");
  },

  async addLeadEvent(event: LeadEvent) {
    const { error } = await supabase().from("lead_events").insert({
      id: event.id,
      lead_id: event.leadId,
      lead_name: event.leadName,
      actor: event.actor,
      action: event.action,
      from_status: event.fromStatus ?? null,
      to_status: event.toStatus ?? null,
      created_at: event.createdAt,
    });
    check(error, "add lead event");
  },

  async listLeadEvents(opts?: { leadId?: string; limit?: number }): Promise<LeadEvent[]> {
    let query = supabase()
      .from("lead_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(opts?.limit ?? 200);
    if (opts?.leadId) query = query.eq("lead_id", opts.leadId);
    const { data, error } = await query;
    check(error, "list lead events");
    return (data ?? []).map((r: Row) => ({
      id: s(r.id),
      leadId: s(r.lead_id),
      leadName: s(r.lead_name),
      actor: s(r.actor),
      action: s(r.action) as LeadEventAction,
      fromStatus: r.from_status ? (s(r.from_status) as LeadStatus) : undefined,
      toStatus: r.to_status ? (s(r.to_status) as LeadStatus) : undefined,
      createdAt: s(r.created_at),
    }));
  },
};
