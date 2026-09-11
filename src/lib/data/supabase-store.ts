import "server-only";
import { supabase } from "../supabase/client";
import { buildSeedData, buildSeedLeadEvents } from "./seed";
import type { CampaignBudget, DataBackend, LeadStatusPatch, LpDelta, PublicUser, StoredUser } from "./backend";
import { toRole } from "../auth/roles";
import type {
  AdDaily,
  Creative,
  DashboardData,
  Goal,
  IgAccountDaily,
  IgPost,
  Lead,
  LeadEvent,
  LeadStatus,
  PostDraft,
} from "../types";
// Mappers COMPARTILHADOS (mesmos do backend Postgres): campo novo entra num
// lugar só e vale para os dois backends SQL — nunca duplicar mappers aqui.
import {
  FALLBACK_CAMPAIGN,
  type Row,
  n,
  s,
  toAd,
  toCampaign,
  toCreative,
  toDraft,
  toEvent,
  toGoal,
  toIgDaily,
  toLead,
  toLp,
  toPost,
  fromAd,
  fromCampaign,
  fromCreative,
  fromDraft,
  fromEvent,
  fromGoal,
  fromIgDaily,
  fromLead,
  fromLp,
  fromPost,
} from "./mappers";

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

  async getData(brand: string): Promise<DashboardData> {
    const db = supabase();
    const [campaign, igDaily, posts, ads, creatives, lp, leads, goals, state] =
      await Promise.all([
        db.from("campaign").select("*").eq("brand", brand).limit(1).maybeSingle(),
        db.from("ig_account_daily").select("*").eq("brand", brand).order("date"),
        db.from("ig_posts").select("*").eq("brand", brand).order("published_at", { ascending: false }),
        db.from("ad_daily").select("*").eq("brand", brand).order("date"),
        db.from("creatives").select("*").eq("brand", brand),
        db.from("lp_daily").select("*").eq("brand", brand).order("date"),
        db.from("leads").select("*").eq("brand", brand).order("created_at", { ascending: false }),
        db.from("goals").select("*").eq("brand", brand),
        db.from("app_state").select("*"),
      ]);

    check(ads.error, "ad_daily");
    check(igDaily.error, "ig_account_daily");

    const stateMap = new Map(
      (state.data ?? []).map((r: Row) => [s(r.key), r.value as unknown]),
    );

    return {
      campaign: campaign.data ? toCampaign(campaign.data as Row) : { ...FALLBACK_CAMPAIGN, brand },
      igAccountDaily: (igDaily.data ?? []).map(toIgDaily),
      igPosts: (posts.data ?? []).map(toPost),
      adDaily: (ads.data ?? []).map(toAd),
      creatives: (creatives.data ?? []).map(toCreative),
      lpDaily: (lp.data ?? []).map(toLp),
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
      db.from("lp_daily").insert(seed.lpDaily.map(fromLp)),
      db.from("leads").insert(seed.leads.map(fromLead)),
      db.from("goals").insert(seed.goals.map(fromGoal)),
      db.from("lead_events").insert(buildSeedLeadEvents(seed.leads).map(fromEvent)),
    ]);

    await touch(true);
    return seed;
  },

  async upsertAdDaily(rows: AdDaily[]) {
    if (rows.length === 0) return 0;
    const { error } = await supabase()
      .from("ad_daily")
      .upsert(rows.map(fromAd), { onConflict: "brand,date,ad_id" });
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
      .upsert(rows.map(fromIgDaily), { onConflict: "brand,date" });
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

  async listDrafts(brand: string): Promise<PostDraft[]> {
    const { data, error } = await supabase()
      .from("post_drafts")
      .select("*")
      .eq("brand", brand)
      .order("updated_at", { ascending: false });
    check(error, "list post_drafts");
    return (data ?? []).map(toDraft);
  },

  async getDraft(id: string): Promise<PostDraft | null> {
    const { data } = await supabase().from("post_drafts").select("*").eq("id", id).maybeSingle();
    return data ? toDraft(data as Row) : null;
  },

  async upsertDraft(draft: PostDraft) {
    const { error } = await supabase()
      .from("post_drafts")
      .upsert(fromDraft(draft), { onConflict: "id" });
    check(error, "upsert post_draft");
  },

  async deleteDraft(id: string) {
    const { error } = await supabase().from("post_drafts").delete().eq("id", id);
    check(error, "delete post_draft");
  },

  async addLead(lead: Lead) {
    const { error } = await supabase().from("leads").upsert(fromLead(lead), {
      onConflict: "id",
    });
    check(error, "insert lead");
    await touch(false);
  },

  async setLeadStatus(id: string, status: LeadStatus, patch?: LeadStatusPatch) {
    const row: Row = { status };
    if (patch?.meetingAt !== undefined) row.meeting_at = patch.meetingAt;
    if (patch?.value !== undefined) row.value = patch.value;
    if (patch?.roboSessionId !== undefined) row.robo_session_id = patch.roboSessionId;
    if (patch?.lostAt !== undefined) row.lost_at = patch.lostAt;

    // Marcos são gravados uma única vez. O REST do Supabase não tem `coalesce`,
    // então lemos o que já existe e só preenchemos o que estiver vazio — assim
    // uma perda registrada depois não apaga a reunião que aconteceu.
    const wantsStamp =
      patch?.bookedAt !== undefined ||
      patch?.attendedAt !== undefined ||
      patch?.closedAt !== undefined;
    if (wantsStamp) {
      const cur = await supabase()
        .from("leads")
        .select("booked_at, attended_at, closed_at")
        .eq("id", id)
        .maybeSingle();
      check(cur.error, "read lead milestones");
      const has = (cur.data ?? {}) as Row;
      if (patch?.bookedAt !== undefined && !has.booked_at) row.booked_at = patch.bookedAt;
      if (patch?.attendedAt !== undefined && !has.attended_at) row.attended_at = patch.attendedAt;
      if (patch?.closedAt !== undefined && !has.closed_at) row.closed_at = patch.closedAt;
    }

    const { error } = await supabase().from("leads").update(row).eq("id", id);
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
      .upsert(fromGoal(goal), { onConflict: "brand,metric,period" });
    check(error, "upsert goal");
    await touch();
  },

  async setCampaignBudget(brand: string, budget: CampaignBudget) {
    const db = supabase();
    const { data: atual, error: erroLeitura } = await db
      .from("campaign")
      .select("id")
      .eq("brand", brand)
      .limit(1)
      .maybeSingle();
    check(erroLeitura, "read campaign");
    const patch: Row = { budget_total: budget.budgetTotal };
    if (budget.dailyBudget != null) patch.daily_budget = budget.dailyBudget;
    if (budget.endDate) patch.end_date = budget.endDate;
    if (atual) {
      const { error } = await db.from("campaign").update(patch).eq("brand", brand);
      check(error, "update campaign budget");
    } else {
      // Sem linha de campanha: cria uma, começando no primeiro dia com gasto.
      const { data: primeiro } = await db
        .from("ad_daily")
        .select("date")
        .eq("brand", brand)
        .order("date", { ascending: true })
        .limit(1)
        .maybeSingle();
      const inicio =
        typeof primeiro?.date === "string"
          ? primeiro.date.slice(0, 10)
          : new Date().toISOString().slice(0, 10);
      const { error } = await db.from("campaign").insert(
        fromCampaign({
          ...FALLBACK_CAMPAIGN,
          id: `campanha-${brand}`,
          brand,
          startDate: inicio,
          endDate: budget.endDate,
          budgetTotal: budget.budgetTotal,
          dailyBudget: budget.dailyBudget,
        }),
      );
      check(error, "insert campaign");
    }
    await touch();
  },

  async bumpLpDaily(brand: string, date: string, delta: LpDelta) {
    const db = supabase();
    // Read-modify-write. Fine at this volume; if the landing page ever gets
    // heavy traffic, move this to a Postgres function for atomicity.
    const { data: current } = await db
      .from("lp_daily")
      .select("*")
      .eq("brand", brand)
      .eq("date", date)
      .maybeSingle();

    const row = {
      brand,
      date,
      visits: n(current?.visits) + (delta.visits ?? 0),
      clicks: n(current?.clicks) + (delta.clicks ?? 0),
      form_submits: n(current?.form_submits) + (delta.formSubmits ?? 0),
    };
    const { error } = await db.from("lp_daily").upsert(row, { onConflict: "brand,date" });
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
    const { error } = await supabase().from("lead_events").insert(fromEvent(event));
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
    return (data ?? []).map(toEvent);
  },
};
