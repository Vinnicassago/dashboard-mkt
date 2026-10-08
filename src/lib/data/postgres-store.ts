import "server-only";
import type { Pool, PoolClient, QueryResult } from "pg";
import { ensureSchema, pg } from "../db/pg";
import { buildSeedData, buildSeedLeadEvents } from "./seed";
import {
  LEAD_CONTACT_FIELDS,
  type AdScope,
  type CampaignBudget,
  type DataBackend,
  type LeadStatusPatch,
  type ListEventsOpts,
  type LpDelta,
  type PublicUser,
  type StoredUser,
} from "./backend";
import type {
  AdDaily,
  AuditEntry,
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
import {
  FALLBACK_CAMPAIGN,
  type Row,
  s,
  toAd,
  toAudit,
  toCampaign,
  toCreative,
  toDraft,
  toEvent,
  toGoal,
  toIgDaily,
  toLead,
  toLp,
  toPost,
  toPublicUser,
  toStoredUser,
  fromAd,
  fromAudit,
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

/**
 * Direct-Postgres backend. Same contract as the Supabase one, but talks to a
 * plain PostgreSQL database over the `pg` driver (EasyPanel/Hostinger, or any
 * managed Postgres). Every access goes through `run()`, which creates the
 * tables on first use — so a fresh database needs no manual SQL.
 */

// Column lists (order matches the from* mapper output keys).
const CAMPAIGN_COLS = ["id", "brand", "name", "objective", "status", "start_date", "end_date", "budget_total", "daily_budget"];
const IG_DAILY_COLS = ["brand", "date", "followers", "reach", "views", "profile_link_taps", "accounts_engaged", "total_interactions", "profile_views", "reach_followers", "reach_non_followers", "dm_conversations", "follows_day", "unfollows_day", "link_taps_website", "link_taps_whatsapp", "stories_posted", "stories_interactive", "niche_comments", "accounts_followed", "replied_all"];
const POST_COLS = ["id", "brand", "published_at", "type", "caption", "permalink", "reach", "views", "likes", "comments", "saved", "shares", "avg_watch_time", "total_watch_time", "duration_sec", "pillar", "cta_type", "profile_visits", "follows", "media_url", "thumbnail_url", "is_test"];
const CREATIVE_COLS = ["ad_id", "brand", "name", "format", "thumbnail_url", "video_plays", "thru_plays", "instagram_media_id", "instagram_permalink"];
const AD_COLS = ["brand", "date", "ad_id", "campaign", "adset", "objective", "spend", "impressions", "reach", "frequency", "clicks", "leads"];
const LP_COLS = ["brand", "date", "visits", "clicks", "form_submits"];
const LEAD_COLS = ["id", "brand", "created_at", "name", "email", "phone", "utm_source", "utm_campaign", "utm_content", "status", "meeting_at", "meeting_for", "value", "booked_at", "attended_at", "closed_at", "lost_at", "robo_session_id", "fbc", "fbp", "ga_client_id", "ga_session_id", "deleted_at", "deleted_by", "deleted_reason"];
const GOAL_COLS = ["brand", "metric", "period", "target", "lower_is_better"];
const EVENT_COLS = ["id", "lead_id", "brand", "lead_name", "actor", "action", "from_status", "to_status", "payload", "created_at"];
const AUDIT_COLS = ["id", "at", "actor", "action", "detail"];
const DRAFT_COLS = ["id", "brand", "status", "created_at", "updated_at", "planned_for", "type", "pillar", "hook_text", "hook_spoken", "promise", "script", "caption", "cta_type", "cta_keyword", "duration_sec", "has_burned_captions", "score", "validated_at", "playbook_version", "published_post_id", "notes", "ai_review", "validation_failed"];

const withoutPk = (cols: string[], pk: string[]) => cols.filter((c) => !pk.includes(c));

const snake = (camel: string) => camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/**
 * Lead que já existe: um reenvio só PREENCHE contato vazio. O nome só é trocado
 * se o gravado for o genérico. Nenhuma outra coluna aparece aqui — é isso que
 * impede um reenvio do formulário de zerar status, entrada e marcos.
 */
const LEAD_FILL_ON_CONFLICT = [
  "name = case when leads.name in ('', 'Lead sem nome') then excluded.name else leads.name end",
  ...LEAD_CONTACT_FIELDS.map((f) => `${snake(f)} = coalesce(leads.${snake(f)}, excluded.${snake(f)})`),
].join(", ");

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

/**
 * Multi-row insert, chunked to stay under the parameter limit. `ignoreConflicts`
 * pula linhas cuja chave já existe (ex.: eventos do exemplo num reset repetido).
 */
async function insertMany(
  table: string,
  cols: string[],
  rows: Row[],
  runner?: Runner,
  ignoreConflicts = false,
) {
  if (rows.length === 0) return;
  const exec = runner ?? pg();
  if (!runner) await ensureSchema();
  const chunk = 500;
  const tail = ignoreConflicts ? " on conflict do nothing" : "";
  for (let i = 0; i < rows.length; i += chunk) {
    const { values, tuples } = buildTuples(cols, rows.slice(i, i + chunk));
    await exec.query(`insert into ${table} (${cols.join(",")}) values ${tuples}${tail}`, values);
  }
}

/** Multi-row insert with ON CONFLICT … DO UPDATE. */
async function upsertMany(
  table: string,
  cols: string[],
  rows: Row[],
  conflict: string[],
  update: string[],
  runner?: Runner,
) {
  if (rows.length === 0) return;
  const exec = runner ?? pg();
  if (!runner) await ensureSchema();
  const setClause = update.map((c) => `${c} = excluded.${c}`).join(", ");
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    const { values, tuples } = buildTuples(cols, rows.slice(i, i + chunk));
    await exec.query(
      `insert into ${table} (${cols.join(",")}) values ${tuples} ` +
        `on conflict (${conflict.join(",")}) do update set ${setClause}`,
      values,
    );
  }
}

/** Roda `fn` numa transação de um cliente do pool. */
async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureSchema();
  const client = await pg().connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
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

  async getData(brand: string): Promise<DashboardData> {
    const [campaign, ig, posts, ads, creatives, lp, leads, goals, state] = await Promise.all([
      q("select * from campaign where brand = $1 limit 1", [brand]),
      q("select * from ig_account_daily where brand = $1 order by date", [brand]),
      q("select * from ig_posts where brand = $1 order by published_at desc", [brand]),
      q("select * from ad_daily where brand = $1 order by date", [brand]),
      q("select * from creatives where brand = $1", [brand]),
      q("select * from lp_daily where brand = $1 order by date", [brand]),
      q("select * from leads where brand = $1 and deleted_at is null order by created_at desc", [brand]),
      q("select * from goals where brand = $1", [brand]),
      q("select * from app_state"),
    ]);

    const stateMap = new Map(state.map((r) => [s(r.key), r.value as unknown]));
    return {
      campaign: campaign[0] ? toCampaign(campaign[0]) : { ...FALLBACK_CAMPAIGN, brand },
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
    await inTransaction(async (client) => {
      // lead_events e audit_log ficam de fora de propósito: o reset apaga os
      // leads, mas a trilha do que existia continua consultável.
      for (const t of ["ad_daily", "creatives", "ig_account_daily", "ig_posts", "lp_daily", "leads", "goals", "campaign"]) {
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
      await insertMany("lead_events", EVENT_COLS, events.map(fromEvent), client, true);
    });
    await touch(true);
    return seed;
  },

  async upsertAdDaily(rows: AdDaily[]) {
    await upsertMany("ad_daily", AD_COLS, rows.map(fromAd), ["brand", "date", "ad_id"], withoutPk(AD_COLS, ["brand", "date", "ad_id"]));
    await touch(false);
    return rows.length;
  },

  async upsertCreatives(rows: Creative[]) {
    await upsertMany("creatives", CREATIVE_COLS, rows.map(fromCreative), ["ad_id"], withoutPk(CREATIVE_COLS, ["ad_id"]));
    return rows.length;
  },

  async replaceAdData(rows: AdDaily[], creatives: Creative[], scope?: AdScope) {
    await inTransaction(async (client) => {
      if (scope) {
        await client.query(
          "delete from ad_daily where brand = any($1) and date between $2 and $3",
          [scope.brands, scope.since, scope.until],
        );
      } else {
        await client.query("delete from ad_daily");
      }
      const adPk = ["brand", "date", "ad_id"];
      await upsertMany("ad_daily", AD_COLS, rows.map(fromAd), adPk, withoutPk(AD_COLS, adPk), client);
      await upsertMany(
        "creatives",
        CREATIVE_COLS,
        creatives.map(fromCreative),
        ["ad_id"],
        withoutPk(CREATIVE_COLS, ["ad_id"]),
        client,
      );
      await client.query(
        "delete from creatives c where not exists (select 1 from ad_daily a where a.ad_id = c.ad_id)",
      );
    });
    await touch(false);
  },

  async upsertIgAccountDaily(rows: IgAccountDaily[]) {
    await upsertMany("ig_account_daily", IG_DAILY_COLS, rows.map(fromIgDaily), ["brand", "date"], withoutPk(IG_DAILY_COLS, ["brand", "date"]));
    await touch(false);
    return rows.length;
  },

  async upsertIgPosts(rows: IgPost[]) {
    await upsertMany("ig_posts", POST_COLS, rows.map(fromPost), ["id"], withoutPk(POST_COLS, ["id"]));
    await touch(false);
    return rows.length;
  },

  async listDrafts(brand: string): Promise<PostDraft[]> {
    const rows = await q(
      "select * from post_drafts where brand = $1 order by updated_at desc",
      [brand],
    );
    return rows.map(toDraft);
  },

  async getDraft(id: string): Promise<PostDraft | null> {
    const rows = await q("select * from post_drafts where id = $1", [id]);
    return rows[0] ? toDraft(rows[0]) : null;
  },

  async upsertDraft(draft: PostDraft) {
    await upsertMany("post_drafts", DRAFT_COLS, [fromDraft(draft)], ["id"], withoutPk(DRAFT_COLS, ["id", "created_at"]));
  },

  async deleteDraft(id: string) {
    await run("delete from post_drafts where id = $1", [id]);
  },

  async addLead(lead: Lead) {
    const { values, tuples } = buildTuples(LEAD_COLS, [fromLead(lead)]);
    const res = await run(
      `insert into leads (${LEAD_COLS.join(",")}) values ${tuples} ` +
        `on conflict (id) do update set ${LEAD_FILL_ON_CONFLICT} ` +
        `returning (xmax = 0) as inserted`,
      values,
    );
    await touch(false);
    return { created: res.rows[0]?.inserted === true };
  },

  async getLead(id: string): Promise<Lead | null> {
    const rows = await q("select * from leads where id = $1", [id]);
    return rows[0] ? toLead(rows[0]) : null;
  },

  async setLeadCreatedAt(id: string, createdAt: string) {
    await run("update leads set created_at = $2 where id = $1", [id, createdAt]);
    await touch();
  },

  async setLeadStatus(id: string, status: LeadStatus, patch?: LeadStatusPatch) {
    const sets = ["status = $1"];
    const params: unknown[] = [status];

    const set = (col: string, v: unknown) => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    /**
     * Marco: só grava se ainda estiver vazio. O `coalesce` faz isso no próprio
     * UPDATE, então o fato sobrevive a qualquer transição posterior (inclusive
     * uma perda) sem precisar de leitura antes da escrita.
     */
    const stamp = (col: string, v?: string) => {
      if (v === undefined) return;
      params.push(v);
      sets.push(`${col} = coalesce(${col}, $${params.length})`);
    };

    if (patch?.meetingAt !== undefined) set("meeting_at", patch.meetingAt);
    if (patch?.meetingFor !== undefined) set("meeting_for", patch.meetingFor);
    if (patch?.value !== undefined) set("value", patch.value);
    if (patch?.roboSessionId !== undefined) set("robo_session_id", patch.roboSessionId);
    stamp("booked_at", patch?.bookedAt);
    stamp("attended_at", patch?.attendedAt);
    stamp("closed_at", patch?.closedAt);
    if (patch?.lostAt !== undefined) set("lost_at", patch.lostAt);

    params.push(id);
    await run(`update leads set ${sets.join(", ")} where id = $${params.length}`, params);
    await touch();
  },

  async softDeleteLead(id: string, info: { at: string; by: string; reason: string }) {
    await run(
      "update leads set deleted_at = $2, deleted_by = $3, deleted_reason = $4 where id = $1",
      [id, info.at, info.by, info.reason],
    );
    await touch(false);
  },

  async restoreLead(id: string) {
    await run(
      "update leads set deleted_at = null, deleted_by = null, deleted_reason = null where id = $1",
      [id],
    );
    await touch(false);
  },

  async listDeletedLeads(brand: string): Promise<Lead[]> {
    const rows = await q(
      "select * from leads where brand = $1 and deleted_at is not null order by deleted_at desc",
      [brand],
    );
    return rows.map(toLead);
  },

  async upsertGoal(goal: Goal) {
    await upsertMany("goals", GOAL_COLS, [fromGoal(goal)], ["brand", "metric", "period"], ["target", "lower_is_better"]);
  },

  async setCampaignBudget(brand: string, budget: CampaignBudget) {
    const res = await run(
      `update campaign set
         budget_total = $2,
         daily_budget = coalesce($3::numeric, daily_budget),
         end_date = coalesce($4::date, end_date)
       where brand = $1`,
      [brand, budget.budgetTotal, budget.dailyBudget ?? null, budget.endDate ?? null],
    );
    // Banco que nunca rodou o seed não tem linha de campanha — o painel lia o
    // fallback em memória. Cria a linha; start_date é NOT NULL, então vem do
    // primeiro dia com gasto da marca.
    if (!res.rowCount) {
      await run(
        `insert into campaign (id, brand, name, objective, status, start_date, end_date, budget_total, daily_budget)
         values ($1, $2, $3, $4, 'ativa',
                 (select coalesce(min(date), current_date) from ad_daily where brand = $2),
                 $5::date, $6, $7)`,
        [
          `campanha-${brand}`,
          brand,
          FALLBACK_CAMPAIGN.name,
          FALLBACK_CAMPAIGN.objective,
          budget.endDate ?? null,
          budget.budgetTotal,
          budget.dailyBudget ?? null,
        ],
      );
    }
    await touch();
  },

  async bumpLpDaily(brand: string, date: string, delta: LpDelta) {
    await run(
      `insert into lp_daily (brand, date, visits, clicks, form_submits) values ($1, $2, $3, $4, $5)
       on conflict (brand, date) do update set
         visits = lp_daily.visits + excluded.visits,
         clicks = lp_daily.clicks + excluded.clicks,
         form_submits = lp_daily.form_submits + excluded.form_submits`,
      [brand, date, delta.visits ?? 0, delta.clicks ?? 0, delta.formSubmits ?? 0],
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

  async listLeadEvents(opts?: ListEventsOpts): Promise<LeadEvent[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts?.leadId) {
      params.push(opts.leadId);
      where.push(`lead_id = $${params.length}`);
    }
    if (opts?.brand) {
      params.push(opts.brand);
      where.push(`(brand = $${params.length} or brand is null)`);
    }
    const limit = opts?.limit ?? 200;
    let sql = "select * from lead_events";
    if (where.length) sql += ` where ${where.join(" and ")}`;
    sql += " order by created_at desc";
    if (limit > 0) {
      params.push(limit);
      sql += ` limit $${params.length}`;
    }
    const rows = await q(sql, params);
    return rows.map(toEvent);
  },

  async addAuditEntry(entry: AuditEntry) {
    await insertMany("audit_log", AUDIT_COLS, [fromAudit(entry)]);
  },

  async listAuditEntries(limit: number): Promise<AuditEntry[]> {
    const rows = await q("select * from audit_log order by at desc limit $1", [limit]);
    return rows.map(toAudit);
  },
};
