import "server-only";
import type { Pool, PoolClient, QueryResult } from "pg";
import { ensureSchema, pg } from "../db/pg";
import { buildSeedData, buildSeedLeadEvents } from "./seed";
import type { DataBackend, LpDelta, PublicUser, StoredUser } from "./backend";
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
} from "../types";
import {
  FALLBACK_CAMPAIGN,
  type Row,
  s,
  toAd,
  toCampaign,
  toCreative,
  toEvent,
  toGoal,
  toIgDaily,
  toLead,
  toLp,
  toPost,
  toPublicUser,
  toStoredUser,
  fromAd,
  fromCampaign,
  fromCreative,
  fromEvent,
  fromGoal,
  fromIgDaily,
  fromLead,
  fromLp,
  fromPost,
} from "./mappers";

/**
 * Direct-Postgres backend. Same contract as the Supabase one, but talks to a
 * plain PostgreSQL database over the `pg` driver (EasyPanel/Hostinger, or any
 * managed Postgres). Every access goes through `run()`, which creates the
 * tables on first use — so a fresh database needs no manual SQL.
 */

// Column lists (order matches the from* mapper output keys).
const CAMPAIGN_COLS = ["id", "name", "objective", "status", "start_date", "end_date", "budget_total", "daily_budget"];
const IG_DAILY_COLS = ["date", "followers", "reach", "views", "profile_link_taps", "accounts_engaged", "total_interactions", "profile_views", "reach_followers", "reach_non_followers"];
const POST_COLS = ["id", "published_at", "type", "caption", "permalink", "reach", "views", "likes", "comments", "saved", "shares", "avg_watch_time", "total_watch_time"];
const CREATIVE_COLS = ["ad_id", "name", "format", "thumbnail_url", "video_plays", "thru_plays"];
const AD_COLS = ["date", "ad_id", "campaign", "adset", "objective", "spend", "impressions", "reach", "frequency", "clicks", "leads"];
const LP_COLS = ["date", "visits", "clicks", "form_submits"];
const LEAD_COLS = ["id", "created_at", "name", "email", "phone", "utm_source", "utm_campaign", "utm_content", "status", "meeting_at", "value", "fbc", "fbp", "ga_client_id", "ga_session_id"];
const GOAL_COLS = ["metric", "period", "target", "lower_is_better"];
const EVENT_COLS = ["id", "lead_id", "lead_name", "actor", "action", "from_status", "to_status", "created_at"];

const withoutPk = (cols: string[], pk: string[]) => cols.filter((c) => !pk.includes(c));

/** Ensure the schema exists, then run a query on the pool. */
async function run(text: string, params: unknown[] = []): Promise<QueryResult> {
  await ensureSchema();
  return pg().query(text, params);
}

async function q(text: string, params: unknown[] = []): Promise<Row[]> {
  const res = await run(text, params);
  return res.rows as Row[];
}

type Runner = Pool | PoolClient;

function buildTuples(cols: string[], rows: Row[]) {
  const values: unknown[] = [];
  const tuples = rows.map((row, ri) => {
    const ph = cols.map((_, ci) => `$${ri * cols.length + ci + 1}`);
    cols.forEach((c) => values.push(row[c] ?? null));
    return `(${ph.join(",")})`;
  });
  return { values, tuples: tuples.join(",") };
}

/** Multi-row insert, chunked to stay under the parameter limit. */
async function insertMany(table: string, cols: string[], rows: Row[], runner?: Runner) {
  if (rows.length === 0) return;
  const exec = runner ?? pg();
  if (!runner) await ensureSchema();
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    const { values, tuples } = buildTuples(cols, rows.slice(i, i + chunk));
    await exec.query(`insert into ${table} (${cols.join(",")}) values ${tuples}`, values);
  }
}

/** Multi-row insert with ON CONFLICT … DO UPDATE. */
async function upsertMany(table: string, cols: string[], rows: Row[], conflict: string[], update: string[]) {
  if (rows.length === 0) return;
  await ensureSchema();
  const setClause = update.map((c) => `${c} = excluded.${c}`).join(", ");
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    const { values, tuples } = buildTuples(cols, rows.slice(i, i + chunk));
    await pg().query(
      `insert into ${table} (${cols.join(",")}) values ${tuples} ` +
        `on conflict (${conflict.join(",")}) do update set ${setClause}`,
      values,
    );
  }
}

async function setStateRaw(key: string, value: unknown) {
  await run(
    `insert into app_state (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

async function touch(isSeed?: boolean) {
  await setStateRaw("updated_at", new Date().toISOString());
  if (isSeed !== undefined) await setStateRaw("is_seed", isSeed);
}

export const postgresBackend: DataBackend = {
  name: "postgres",

  async getData(): Promise<DashboardData> {
    const [campaign, ig, posts, ads, creatives, lp, leads, goals, state] = await Promise.all([
      q("select * from campaign limit 1"),
      q("select * from ig_account_daily order by date"),
      q("select * from ig_posts order by published_at desc"),
      q("select * from ad_daily order by date"),
      q("select * from creatives"),
      q("select * from lp_daily order by date"),
      q("select * from leads order by created_at desc"),
      q("select * from goals"),
      q("select * from app_state"),
    ]);

    const stateMap = new Map(state.map((r) => [s(r.key), r.value as unknown]));
    return {
      campaign: campaign[0] ? toCampaign(campaign[0]) : FALLBACK_CAMPAIGN,
      igAccountDaily: ig.map(toIgDaily),
      igPosts: posts.map(toPost),
      adDaily: ads.map(toAd),
      creatives: creatives.map(toCreative),
      lpDaily: lp.map(toLp),
      leads: leads.map(toLead),
      goals: goals.map(toGoal),
      updatedAt: String(stateMap.get("updated_at") ?? new Date().toISOString()),
      isSeed: stateMap.get("is_seed") === true,
    };
  },

  async resetToSeed(): Promise<DashboardData> {
    const seed = buildSeedData();
    const events = buildSeedLeadEvents(seed.leads);
    await ensureSchema();
    const client = await pg().connect();
    try {
      await client.query("begin");
      for (const t of [
        "ad_daily",
        "creatives",
        "ig_account_daily",
        "ig_posts",
        "lp_daily",
        "leads",
        "goals",
        "campaign",
        "lead_events",
      ]) {
        await client.query(`delete from ${t}`);
      }
      await insertMany("campaign", CAMPAIGN_COLS, [fromCampaign(seed.campaign)], client);
      await insertMany("ig_account_daily", IG_DAILY_COLS, seed.igAccountDaily.map(fromIgDaily), client);
      await insertMany("ig_posts", POST_COLS, seed.igPosts.map(fromPost), client);
      await insertMany("creatives", CREATIVE_COLS, seed.creatives.map(fromCreative), client);
      await insertMany("ad_daily", AD_COLS, seed.adDaily.map(fromAd), client);
      await insertMany("lp_daily", LP_COLS, seed.lpDaily.map(fromLp), client);
      await insertMany("leads", LEAD_COLS, seed.leads.map(fromLead), client);
      await insertMany("goals", GOAL_COLS, seed.goals.map(fromGoal), client);
      await insertMany("lead_events", EVENT_COLS, events.map(fromEvent), client);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
    await touch(true);
    return seed;
  },

  async upsertAdDaily(rows: AdDaily[]) {
    await upsertMany("ad_daily", AD_COLS, rows.map(fromAd), ["date", "ad_id"], withoutPk(AD_COLS, ["date", "ad_id"]));
    await touch(false);
    return rows.length;
  },

  async upsertCreatives(rows: Creative[]) {
    await upsertMany("creatives", CREATIVE_COLS, rows.map(fromCreative), ["ad_id"], withoutPk(CREATIVE_COLS, ["ad_id"]));
    return rows.length;
  },

  async clearAdData() {
    await run("delete from ad_daily");
    await run("delete from creatives");
    await touch(false);
  },

  async upsertIgAccountDaily(rows: IgAccountDaily[]) {
    await upsertMany("ig_account_daily", IG_DAILY_COLS, rows.map(fromIgDaily), ["date"], withoutPk(IG_DAILY_COLS, ["date"]));
    await touch(false);
    return rows.length;
  },

  async upsertIgPosts(rows: IgPost[]) {
    await upsertMany("ig_posts", POST_COLS, rows.map(fromPost), ["id"], withoutPk(POST_COLS, ["id"]));
    await touch(false);
    return rows.length;
  },

  async addLead(lead: Lead) {
    await upsertMany("leads", LEAD_COLS, [fromLead(lead)], ["id"], withoutPk(LEAD_COLS, ["id"]));
    await touch(false);
  },

  async setLeadStatus(id: string, status: LeadStatus, meetingAt?: string, value?: number) {
    const sets = ["status = $1"];
    const params: unknown[] = [status];
    if (meetingAt !== undefined) {
      params.push(meetingAt);
      sets.push(`meeting_at = $${params.length}`);
    }
    if (value !== undefined) {
      params.push(value);
      sets.push(`value = $${params.length}`);
    }
    params.push(id);
    await run(`update leads set ${sets.join(", ")} where id = $${params.length}`, params);
    await touch();
  },

  async deleteLead(id: string) {
    await run("delete from lead_events where lead_id = $1", [id]);
    await run("delete from leads where id = $1", [id]);
    await touch(false);
  },

  async upsertGoal(goal: Goal) {
    await upsertMany("goals", GOAL_COLS, [fromGoal(goal)], ["metric", "period"], ["target", "lower_is_better"]);
  },

  async bumpLpDaily(date: string, delta: LpDelta) {
    await run(
      `insert into lp_daily (date, visits, clicks, form_submits) values ($1, $2, $3, $4)
       on conflict (date) do update set
         visits = lp_daily.visits + excluded.visits,
         clicks = lp_daily.clicks + excluded.clicks,
         form_submits = lp_daily.form_submits + excluded.form_submits`,
      [date, delta.visits ?? 0, delta.clicks ?? 0, delta.formSubmits ?? 0],
    );
    await touch(false);
  },

  async getState<T>(key: string) {
    const rows = await q("select value from app_state where key = $1", [key]);
    return (rows[0]?.value as T) ?? null;
  },

  async setState(key: string, value: unknown) {
    await setStateRaw(key, value);
  },

  async countUsers() {
    const rows = await q("select count(*)::int as c from app_users");
    return Number(rows[0]?.c ?? 0);
  },

  async getUser(username: string): Promise<StoredUser | null> {
    const rows = await q("select * from app_users where username = $1", [username]);
    return rows[0] ? toStoredUser(rows[0]) : null;
  },

  async listUsers(): Promise<PublicUser[]> {
    const rows = await q("select * from app_users order by username");
    return rows.map(toPublicUser);
  },

  async createUser(user: StoredUser) {
    await run(
      `insert into app_users (username, password_hash, role, created_at) values ($1, $2, $3, $4)
       on conflict (username) do update set password_hash = excluded.password_hash, role = excluded.role`,
      [user.username, user.passwordHash, user.role, user.createdAt],
    );
  },

  async deleteUser(username: string) {
    await run("delete from app_users where username = $1", [username]);
  },

  async setUserRole(username: string, role) {
    await run("update app_users set role = $1 where username = $2", [role, username]);
  },

  async addLeadEvent(event: LeadEvent) {
    await insertMany("lead_events", EVENT_COLS, [fromEvent(event)]);
  },

  async listLeadEvents(opts?: { leadId?: string; limit?: number }): Promise<LeadEvent[]> {
    const limit = opts?.limit ?? 200;
    const rows = opts?.leadId
      ? await q("select * from lead_events where lead_id = $1 order by created_at desc limit $2", [opts.leadId, limit])
      : await q("select * from lead_events order by created_at desc limit $1", [limit]);
    return rows.map(toEvent);
  },
};
