import "server-only";
import { supabase } from "../supabase/client";
import { buildSeedData, buildSeedLeadEvents } from "./seed";
import {
  LEAD_CONTACT_FIELDS,
  MOTIVO_EXCLUSAO_RESET,
  eventoExclusaoReset,
  type AdScope,
  type CampaignBudget,
  type DataBackend,
  type LeadStatusPatch,
  type ListAcoesEstadoOpts,
  type ListEventsOpts,
  type ListResumosOpts,
  type ListSyncRunsOpts,
  type LpDelta,
  type PublicUser,
  type StoredUser,
} from "./backend";
import { toRole } from "../auth/roles";
import type {
  AcaoEstado,
  AdDaily,
  AuditEntry,
  SyncRun,
  Creative,
  DashboardData,
  Goal,
  Meta,
  IgAccountDaily,
  IgPost,
  Lead,
  LeadEvent,
  LeadStatus,
  PostDraft,
  ResumoSemanal,
} from "../types";
// Mappers COMPARTILHADOS (mesmos do backend Postgres): campo novo entra num
// lugar só e vale para os dois backends SQL — nunca duplicar mappers aqui.
import {
  FALLBACK_CAMPAIGN,
  type Row,
  n,
  s,
  toAcaoEstado,
  toAd,
  toAudit,
  toSyncRun,
  toCampaign,
  toCreative,
  toDraft,
  toEvent,
  toGoal,
  toMeta,
  toIgDaily,
  toLead,
  toLp,
  toPost,
  toResumoSemanal,
  fromAcaoEstado,
  fromAd,
  fromAudit,
  fromSyncRun,
  fromCampaign,
  fromCreative,
  fromDraft,
  fromEvent,
  fromGoal,
  fromMeta,
  fromIgDaily,
  fromLead,
  fromLp,
  fromPost,
  fromResumoSemanal,
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
    const [campaign, igDaily, posts, ads, creatives, lp, leads, goals, metas, state] =
      await Promise.all([
        db.from("campaign").select("*").eq("brand", brand).limit(1).maybeSingle(),
        db.from("ig_account_daily").select("*").eq("brand", brand).order("date"),
        db.from("ig_posts").select("*").eq("brand", brand).order("published_at", { ascending: false }),
        db.from("ad_daily").select("*").eq("brand", brand).order("date"),
        db.from("creatives").select("*").eq("brand", brand),
        db.from("lp_daily").select("*").eq("brand", brand).order("date"),
        db
          .from("leads")
          .select("*")
          .eq("brand", brand)
          .is("deleted_at", null)
          .order("created_at", { ascending: false }),
        db.from("goals").select("*").eq("brand", brand),
        db.from("metas").select("*").eq("brand", brand).order("vigente_desde").order("criada_em"),
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
      metas: (metas.data ?? []).map(toMeta),
      updatedAt: String(stateMap.get("updated_at") ?? new Date().toISOString()),
      isSeed: stateMap.get("is_seed") === true,
    };
  },

  async resetToSeed(by = "sistema"): Promise<DashboardData> {
    const db = supabase();
    const seed = buildSeedData();

    // Nada de DELETE em lead: quem não é do exemplo é excluído de forma
    // reversível (quem já estava excluído guarda o motivo original). Ids do
    // exemplo são `LEAD-0001`…, seguros dentro do `in.(…)` sem aspas. Cada
    // excluído ganha o evento `excluido`.
    const at = new Date().toISOString();
    const excluir = await db
      .from("leads")
      .update({ deleted_at: at, deleted_by: by, deleted_reason: MOTIVO_EXCLUSAO_RESET })
      .is("deleted_at", null)
      .not("id", "in", `(${seed.leads.map((l) => l.id).join(",")})`)
      .select();
    check(excluir.error, "reset: excluir leads fora do exemplo");
    const exclusoes = (excluir.data ?? []).map((r: Row) => fromEvent(eventoExclusaoReset(toLead(r), by, at)));
    if (exclusoes.length) {
      const ev = await db.from("lead_events").insert(exclusoes);
      check(ev.error, "reset: histórico dos excluídos");
    }
    // Upsert: os do exemplo voltam ao estado do exemplo (inclusive `deleted_*`
    // nulos, que `fromLead` sempre manda), sem colidir com o que já existia.
    const exemplo = await db.from("leads").upsert(seed.leads.map(fromLead), { onConflict: "id" });
    check(exemplo.error, "reset: leads do exemplo");

    // wipe (PostgREST requires a filter, so match "pk is not null")
    await Promise.all([
      db.from("ad_daily").delete().not("ad_id", "is", null),
      db.from("creatives").delete().not("ad_id", "is", null),
      db.from("ig_account_daily").delete().not("date", "is", null),
      db.from("ig_posts").delete().not("id", "is", null),
      db.from("lp_daily").delete().not("date", "is", null),
      db.from("goals").delete().not("metric", "is", null),
      db.from("campaign").delete().not("id", "is", null),
      // leads, lead_events e audit_log ficam: a trilha do que existia sobrevive ao reset.
    ]);

    await Promise.all([
      db.from("campaign").insert(fromCampaign(seed.campaign)),
      db.from("ig_account_daily").insert(seed.igAccountDaily.map(fromIgDaily)),
      db.from("ig_posts").insert(seed.igPosts.map(fromPost)),
      db.from("creatives").insert(seed.creatives.map(fromCreative)),
      db.from("ad_daily").insert(seed.adDaily.map(fromAd)),
      db.from("lp_daily").insert(seed.lpDaily.map(fromLp)),
      db.from("goals").insert(seed.goals.map(fromGoal)),
      db.from("metas").upsert((seed.metas ?? []).map(fromMeta), { onConflict: "id", ignoreDuplicates: true }),
      db
        .from("lead_events")
        .upsert(buildSeedLeadEvents(seed.leads).map(fromEvent), { onConflict: "id", ignoreDuplicates: true }),
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

  /**
   * O REST do Supabase não tem transação: aqui a troca é apagar o recorte e
   * gravar em seguida. Quem chama já tem as linhas novas em mãos, então a janela
   * de risco é só a da escrita — o backend de produção (Postgres) faz numa
   * transação.
   */
  async replaceAdData(rows: AdDaily[], creatives: Creative[], scope?: AdScope) {
    const db = supabase();
    const del = scope
      ? db.from("ad_daily").delete().in("brand", scope.brands).gte("date", scope.since).lte("date", scope.until)
      : db.from("ad_daily").delete().not("ad_id", "is", null);
    check((await del).error, "replace ad_daily (delete)");
    if (rows.length) {
      const up = await db.from("ad_daily").upsert(rows.map(fromAd), { onConflict: "brand,date,ad_id" });
      check(up.error, "replace ad_daily (upsert)");
    }
    if (creatives.length) {
      const up = await db.from("creatives").upsert(creatives.map(fromCreative), { onConflict: "ad_id" });
      check(up.error, "replace creatives (upsert)");
    }
    // Criativo sem nenhuma linha de anúncio: sobra de import antigo.
    const { data: ads } = await db.from("ad_daily").select("ad_id");
    const comLinha = new Set((ads ?? []).map((r: Row) => s(r.ad_id)));
    const { data: crs } = await db.from("creatives").select("ad_id");
    const orfaos = (crs ?? []).map((r: Row) => s(r.ad_id)).filter((id) => !comLinha.has(id));
    if (orfaos.length) {
      const rm = await db.from("creatives").delete().in("ad_id", orfaos);
      check(rm.error, "replace creatives (prune)");
    }
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
    const db = supabase();
    const cur = await db.from("leads").select("*").eq("id", lead.id).maybeSingle();
    check(cur.error, "read lead");
    if (!cur.data) {
      const { error } = await db.from("leads").insert(fromLead(lead));
      check(error, "insert lead");
      await touch(false);
      return { created: true };
    }
    // Reenvio: só preenche contato vazio. Status, entrada e marcos ficam.
    const atual = toLead(cur.data as Row);
    const novo = fromLead(lead);
    const patch: Row = {};
    if (!atual.name || atual.name === "Lead sem nome") patch.name = lead.name;
    for (const f of LEAD_CONTACT_FIELDS) {
      const col = f.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      if ((atual[f] == null || atual[f] === "") && novo[col] != null) patch[col] = novo[col];
    }
    if (Object.keys(patch).length) {
      const { error } = await db.from("leads").update(patch).eq("id", lead.id);
      check(error, "update lead (reenvio)");
    }
    return { created: false };
  },

  async getLead(id: string) {
    const { data, error } = await supabase().from("leads").select("*").eq("id", id).maybeSingle();
    check(error, "get lead");
    return data ? toLead(data as Row) : null;
  },

  async setLeadCreatedAt(id: string, createdAt: string) {
    const { error } = await supabase().from("leads").update({ created_at: createdAt }).eq("id", id);
    check(error, "set lead created_at");
    await touch();
  },

  async setLeadStatus(id: string, status: LeadStatus, patch?: LeadStatusPatch) {
    const row: Row = { status };
    if (patch?.meetingAt !== undefined) row.meeting_at = patch.meetingAt;
    if (patch?.meetingFor !== undefined) row.meeting_for = patch.meetingFor;
    if (patch?.lostReasonDetail !== undefined) row.lost_reason_detail = patch.lostReasonDetail;
    if (patch?.value !== undefined) row.value = patch.value;
    if (patch?.roboSessionId !== undefined) row.robo_session_id = patch.roboSessionId;
    if (patch?.lostAt !== undefined) row.lost_at = patch.lostAt;

    // Marcos são gravados uma única vez. O REST do Supabase não tem `coalesce`,
    // então lemos o que já existe e só preenchemos o que estiver vazio — assim
    // uma perda registrada depois não apaga a reunião que aconteceu.
    const wantsStamp =
      patch?.firstContactAt !== undefined ||
      patch?.bookedAt !== undefined ||
      patch?.attendedAt !== undefined ||
      patch?.closedAt !== undefined;
    if (wantsStamp) {
      const cur = await supabase()
        .from("leads")
        .select("first_contact_at, booked_at, attended_at, closed_at")
        .eq("id", id)
        .maybeSingle();
      check(cur.error, "read lead milestones");
      const has = (cur.data ?? {}) as Row;
      if (patch?.firstContactAt === null) row.first_contact_at = null;
      else if (patch?.firstContactAt !== undefined && !has.first_contact_at) row.first_contact_at = patch.firstContactAt;
      if (patch?.bookedAt !== undefined && !has.booked_at) row.booked_at = patch.bookedAt;
      if (patch?.attendedAt !== undefined && !has.attended_at) row.attended_at = patch.attendedAt;
      if (patch?.closedAt !== undefined && !has.closed_at) row.closed_at = patch.closedAt;
    }

    const { error } = await supabase().from("leads").update(row).eq("id", id);
    check(error, "update lead");
    await touch();
  },

  async softDeleteLead(id: string, info: { at: string; by: string; reason: string }) {
    const { error } = await supabase()
      .from("leads")
      .update({ deleted_at: info.at, deleted_by: info.by, deleted_reason: info.reason })
      .eq("id", id);
    check(error, "soft delete lead");
    await touch(false);
  },

  async restoreLead(id: string) {
    const { error } = await supabase()
      .from("leads")
      .update({ deleted_at: null, deleted_by: null, deleted_reason: null })
      .eq("id", id);
    check(error, "restore lead");
    await touch(false);
  },

  async listDeletedLeads(brand: string) {
    const { data, error } = await supabase()
      .from("leads")
      .select("*")
      .eq("brand", brand)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    check(error, "list deleted leads");
    return (data ?? []).map(toLead);
  },

  async listLeads(brand: string) {
    const { data, error } = await supabase()
      .from("leads")
      .select("*")
      .eq("brand", brand)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    check(error, "list leads");
    return (data ?? []).map(toLead);
  },

  async addMeta(meta: Meta) {
    const { error } = await supabase().from("metas").insert(fromMeta(meta));
    check(error, "add meta");
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

  async listLeadEvents(opts?: ListEventsOpts): Promise<LeadEvent[]> {
    let query = supabase().from("lead_events").select("*").order("created_at", { ascending: false });
    const limit = opts?.limit ?? 200;
    if (limit > 0) query = query.limit(limit);
    if (opts?.leadId) query = query.eq("lead_id", opts.leadId);
    if (opts?.brand) query = query.or(`brand.eq.${opts.brand},brand.is.null`);
    const { data, error } = await query;
    check(error, "list lead events");
    return (data ?? []).map(toEvent);
  },

  async addAuditEntry(entry: AuditEntry) {
    const { error } = await supabase().from("audit_log").insert(fromAudit(entry));
    check(error, "add audit entry");
  },

  async listAuditEntries(limit: number) {
    const { data, error } = await supabase()
      .from("audit_log")
      .select("*")
      .order("at", { ascending: false })
      .limit(limit);
    check(error, "list audit entries");
    return (data ?? []).map(toAudit);
  },

  async addSyncRun(run: SyncRun) {
    const { error } = await supabase().from("sync_runs").insert(fromSyncRun(run));
    check(error, "add sync run");
  },

  async listSyncRuns(opts?: ListSyncRunsOpts) {
    let query = supabase().from("sync_runs").select("*");
    if (opts?.source) query = query.eq("source", opts.source);
    if (opts?.brand) query = query.eq("brand", opts.brand);
    query = query.order("finished_at", { ascending: false });
    const limit = opts?.limit ?? 50;
    if (limit > 0) query = query.limit(limit);
    const { data, error } = await query;
    check(error, "list sync runs");
    return (data ?? []).map(toSyncRun);
  },

  // ---- Bússola (Fase 5) ----

  async addAcaoEstado(e: AcaoEstado) {
    // Só insere: o histórico fica; quem lê pega a última por (marca, semana, ação).
    const { error } = await supabase().from("acoes_estado").insert(fromAcaoEstado(e));
    check(error, "add acao estado");
  },

  async listAcoesEstado(opts: ListAcoesEstadoOpts) {
    let query = supabase().from("acoes_estado").select("*").eq("brand", opts.brand);
    if (opts.semana) query = query.eq("semana", opts.semana);
    query = query.order("em", { ascending: false });
    const limit = opts.limit ?? 200;
    if (limit > 0) query = query.limit(limit);
    const { data, error } = await query;
    check(error, "list acoes estado");
    return (data ?? []).map(toAcaoEstado);
  },

  async addResumoSemanal(r: ResumoSemanal) {
    const { error } = await supabase().from("resumos_semanais").insert(fromResumoSemanal(r));
    check(error, "add resumo semanal");
  },

  async listResumosSemanais(opts: ListResumosOpts) {
    let query = supabase()
      .from("resumos_semanais")
      .select("*")
      .eq("brand", opts.brand)
      .order("semana", { ascending: false })
      .order("criado_em", { ascending: false });
    const limit = opts.limit ?? 12;
    if (limit > 0) query = query.limit(limit);
    const { data, error } = await query;
    check(error, "list resumos semanais");
    return (data ?? []).map(toResumoSemanal);
  },
};
