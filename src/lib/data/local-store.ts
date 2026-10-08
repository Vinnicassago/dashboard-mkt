import "server-only";
import fs from "node:fs";
import path from "node:path";
import { buildSeedData, buildSeedLeadEvents } from "./seed";
import { FALLBACK_CAMPAIGN } from "./mappers";
import {
  LEAD_CONTACT_FIELDS,
  type AdScope,
  type CampaignBudget,
  type DataBackend,
  type LeadStatusPatch,
  type ListEventsOpts,
  type ListSyncRunsOpts,
  type LpDelta,
  type PublicUser,
  type StoredUser,
} from "./backend";
import { toRole } from "../auth/roles";
import { LOST_STATUSES, normalizeLeadStatus } from "../lead-status";
import { DEFAULT_BRAND } from "../types";
import type {
  AdDaily,
  AuditEntry,
  SyncRun,
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

/**
 * Development / no-credentials backend: one JSON file on disk.
 * Good enough to run the whole dashboard locally; not for production
 * (serverless filesystems are ephemeral and not shared) — use Supabase there.
 */

// LOCAL_DATA_DIR existe para os testes rodarem num diretório próprio, sem
// tocar no arquivo do dev.
const DATA_DIR = process.env.LOCAL_DATA_DIR || path.join(process.cwd(), ".localdata");
const DATA_FILE = path.join(DATA_DIR, "store.json");

interface LocalFile {
  data: DashboardData;
  state: Record<string, unknown>;
  users: StoredUser[];
  leadEvents: LeadEvent[];
  /** Peças em produção — fora de `data` porque não são dados de campanha. */
  drafts: PostDraft[];
  /** Ações administrativas (restaurar exemplo, ressincronizar, reclassificar). */
  audit: AuditEntry[];
  /** Cada sincronização, com a janela que cobriu (ADR-04/06). */
  syncRuns: SyncRun[];
}

let cache: LocalFile | null = null;
/**
 * Quando o arquivo foi lido/gravado por ESTA instância. No `next dev`, a rota da
 * LP e as server actions podem carregar este módulo em grafos diferentes — cada
 * um com o seu cache. Sem conferir o arquivo, uma instância regrava o JSON com a
 * cópia velha e apaga o que a outra acabou de salvar.
 */
let cacheMtime = 0;

function mtimeDoArquivo(): number {
  try {
    return fs.statSync(DATA_FILE).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Backfill de marca para arquivos locais criados antes da coluna `brand`
 * existir (o análogo, no JSON, do `default 'consorcio'` do schema SQL). Sem
 * isto, o recorte por marca em getData esconderia os dados antigos e o upsert
 * duplicaria linhas (chave `undefined::…` vs `consorcio::…`).
 */
function migrateBrand(data: DashboardData) {
  const d = data as unknown as { campaign?: { brand?: string } } & Record<string, unknown>;
  if (d.campaign && !d.campaign.brand) d.campaign.brand = DEFAULT_BRAND;
  const arrays = ["igAccountDaily", "igPosts", "adDaily", "creatives", "lpDaily", "leads", "goals"] as const;
  for (const key of arrays) {
    const rows = (data as unknown as Record<string, Array<{ brand?: string }>>)[key];
    if (Array.isArray(rows)) for (const r of rows) if (!r.brand) r.brand = DEFAULT_BRAND;
  }
}

/**
 * Análogo, no JSON local, da migração de status em `db/schema.ts`: arquivos
 * gravados com a régua antiga ("agendou"/"compareceu"/"perdido") entram com os
 * nomes novos. `normalizeLeadStatus` é a mesma função que os backends de banco
 * usam na leitura, então os dois caminhos concordam.
 */
function migrateLeadStatus(file: LocalFile) {
  for (const l of file.data.leads ?? []) l.status = normalizeLeadStatus(l.status);
  for (const e of file.leadEvents ?? []) {
    if (e.fromStatus) e.fromStatus = normalizeLeadStatus(e.fromStatus);
    if (e.toStatus) e.toStatus = normalizeLeadStatus(e.toStatus);
  }
}

/**
 * Análogo, no JSON local, do backfill de marcos da migração 0012: reconstrói
 * `bookedAt`/`attendedAt`/`closedAt` a partir de `meetingAt`, do histórico de
 * eventos e do estágio atual — nesta ordem de confiança. É o que recupera a
 * reunião de quem foi marcado como perda depois de ter agendado.
 */
function migrateLeadMilestones(file: LocalFile) {
  const earliest = new Map<string, { booked?: string; attended?: string; closed?: string }>();
  for (const e of file.leadEvents ?? []) {
    if (!e.toStatus) continue;
    const acc = earliest.get(e.leadId) ?? {};
    const keep = (cur: string | undefined) => (!cur || e.createdAt < cur ? e.createdAt : cur);
    if (e.toStatus === "agendado" || e.toStatus === "reuniao_realizada" || e.toStatus === "cliente")
      acc.booked = keep(acc.booked);
    if (e.toStatus === "reuniao_realizada" || e.toStatus === "cliente")
      acc.attended = keep(acc.attended);
    if (e.toStatus === "cliente") acc.closed = keep(acc.closed);
    earliest.set(e.leadId, acc);
  }

  for (const l of file.data.leads ?? []) {
    const ev = earliest.get(l.id);
    const advanced =
      l.status === "agendado" || l.status === "no_show" || l.status === "reuniao_realizada" || l.status === "cliente";
    const attended = l.status === "reuniao_realizada" || l.status === "cliente";
    l.bookedAt ??= l.meetingAt ?? ev?.booked ?? (advanced ? l.createdAt : undefined);
    l.attendedAt ??= ev?.attended ?? (attended ? l.createdAt : undefined);
    l.closedAt ??= ev?.closed ?? (l.status === "cliente" ? l.createdAt : undefined);
    l.lostAt = LOST_STATUSES.includes(l.status) ? (l.lostAt ?? l.createdAt) : undefined;
  }
}

function persist(file: LocalFile) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(file, null, 2), "utf8");
    cacheMtime = mtimeDoArquivo();
  } catch {
    // best-effort on read-only filesystems
  }
}

function load(): LocalFile {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as LocalFile;
      if (parsed?.data?.campaign) {
        if (!Array.isArray(parsed.users)) parsed.users = [];
        if (!Array.isArray(parsed.leadEvents)) parsed.leadEvents = [];
        // Arquivos criados antes da Etapa 1 não têm a chave.
        if (!Array.isArray(parsed.drafts)) parsed.drafts = [];
        if (!Array.isArray(parsed.audit)) parsed.audit = [];
        if (!Array.isArray(parsed.syncRuns)) parsed.syncRuns = [];
        migrateBrand(parsed.data);
        migrateLeadStatus(parsed);
        migrateLeadMilestones(parsed);
        return parsed;
      }
    }
  } catch {
    // fall through to seed
  }
  const data = buildSeedData();
  const fresh: LocalFile = {
    data,
    state: {},
    users: [],
    leadEvents: buildSeedLeadEvents(data.leads),
    drafts: [],
    audit: [],
    syncRuns: [],
  };
  persist(fresh);
  return fresh;
}

function file(): LocalFile {
  const m = mtimeDoArquivo();
  if (!cache || m > cacheMtime) {
    cache = load();
    cacheMtime = mtimeDoArquivo();
  }
  return cache;
}

function commit(mutator: (data: DashboardData) => void) {
  const f = file();
  mutator(f.data);
  f.data.updatedAt = new Date().toISOString();
  persist(f);
  cache = f;
}

export const localBackend: DataBackend = {
  name: "local",

  async getData(brand: string) {
    // O arquivo local guarda todas as marcas num só dataset; recorta pela marca
    // pedida (campaign é singular — devolve a da marca, senão um fallback vazio).
    const d = file().data;
    return {
      ...d,
      campaign: d.campaign.brand === brand ? d.campaign : { ...FALLBACK_CAMPAIGN, brand },
      igAccountDaily: d.igAccountDaily.filter((r) => r.brand === brand),
      igPosts: d.igPosts.filter((r) => r.brand === brand),
      adDaily: d.adDaily.filter((r) => r.brand === brand),
      creatives: d.creatives.filter((r) => r.brand === brand),
      lpDaily: d.lpDaily.filter((r) => r.brand === brand),
      leads: d.leads.filter((r) => r.brand === brand && !r.deletedAt),
      goals: d.goals.filter((r) => r.brand === brand),
    };
  },

  async resetToSeed() {
    // keep users, drafts, the state bag, the lead history and the audit log —
    // só os dados de campanha voltam ao seed (rascunho é trabalho de produção;
    // o histórico é a trilha do que existia antes do reset)
    const data = buildSeedData();
    const atuais = file().leadEvents;
    const ids = new Set(atuais.map((e) => e.id));
    cache = {
      data,
      state: file().state,
      users: file().users,
      leadEvents: [...buildSeedLeadEvents(data.leads).filter((e) => !ids.has(e.id)), ...atuais],
      drafts: file().drafts,
      audit: file().audit,
      syncRuns: file().syncRuns,
    };
    persist(cache);
    return cache.data;
  },

  async listDrafts(brand: string) {
    return file()
      .drafts.filter((d) => d.brand === brand)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async getDraft(id: string) {
    return file().drafts.find((d) => d.id === id) ?? null;
  },

  async upsertDraft(draft: PostDraft) {
    const f = file();
    f.drafts = [draft, ...f.drafts.filter((d) => d.id !== draft.id)];
    persist(f);
    cache = f;
  },

  async deleteDraft(id: string) {
    const f = file();
    f.drafts = f.drafts.filter((d) => d.id !== id);
    persist(f);
    cache = f;
  },

  async upsertAdDaily(rows: AdDaily[]) {
    commit((data) => {
      const key = (r: AdDaily) => `${r.brand}::${r.date}::${r.adId}`;
      const index = new Map(data.adDaily.map((r) => [key(r), r]));
      for (const row of rows) index.set(key(row), row);
      data.adDaily = [...index.values()].sort((a, b) =>
        a.date === b.date ? a.adId.localeCompare(b.adId) : a.date.localeCompare(b.date),
      );
      data.isSeed = false;
    });
    return rows.length;
  },

  async upsertCreatives(rows: Creative[]) {
    commit((data) => {
      const index = new Map(data.creatives.map((c) => [c.adId, c]));
      for (const row of rows) index.set(row.adId, { ...index.get(row.adId), ...row });
      data.creatives = [...index.values()];
    });
    return rows.length;
  },

  async replaceAdData(rows: AdDaily[], creatives: Creative[], scope?: AdScope) {
    commit((data) => {
      const fora = (r: AdDaily) =>
        scope ? !(scope.brands.includes(r.brand) && r.date >= scope.since && r.date <= scope.until) : false;
      const key = (r: AdDaily) => `${r.brand}::${r.date}::${r.adId}`;
      const index = new Map(data.adDaily.filter(fora).map((r) => [key(r), r]));
      for (const row of rows) index.set(key(row), row);
      data.adDaily = [...index.values()].sort((a, b) =>
        a.date === b.date ? a.adId.localeCompare(b.adId) : a.date.localeCompare(b.date),
      );
      const comLinha = new Set(data.adDaily.map((r) => r.adId));
      const cr = new Map(data.creatives.map((c) => [c.adId, c]));
      for (const c of creatives) cr.set(c.adId, { ...cr.get(c.adId), ...c });
      data.creatives = [...cr.values()].filter((c) => comLinha.has(c.adId));
      data.isSeed = false;
    });
  },

  async upsertIgAccountDaily(rows: IgAccountDaily[]) {
    commit((data) => {
      const key = (r: IgAccountDaily) => `${r.brand}::${r.date}`;
      const index = new Map(data.igAccountDaily.map((r) => [key(r), r]));
      for (const row of rows) index.set(key(row), row);
      data.igAccountDaily = [...index.values()].sort((a, b) => a.date.localeCompare(b.date));
      data.isSeed = false;
    });
    return rows.length;
  },

  async upsertIgPosts(rows: IgPost[]) {
    commit((data) => {
      const index = new Map(data.igPosts.map((p) => [p.id, p]));
      for (const row of rows) index.set(row.id, row);
      data.igPosts = [...index.values()].sort((a, b) =>
        b.publishedAt.localeCompare(a.publishedAt),
      );
      data.isSeed = false;
    });
    return rows.length;
  },

  async addLead(lead: Lead) {
    let created = false;
    commit((data) => {
      const atual = data.leads.find((l) => l.id === lead.id);
      if (!atual) {
        data.leads = [lead, ...data.leads];
        created = true;
      } else {
        // Reenvio: só preenche contato vazio. Status, entrada e marcos ficam.
        if (!atual.name || atual.name === "Lead sem nome") atual.name = lead.name;
        for (const f of LEAD_CONTACT_FIELDS) {
          if (atual[f] == null || atual[f] === "") atual[f] = lead[f];
        }
      }
      data.isSeed = false;
    });
    return { created };
  },

  async getLead(id: string) {
    // CÓPIA: devolver o objeto do cache fazia quem leu ver a própria escrita
    // seguinte (o "status anterior" mudava junto) — o Postgres nunca faz isso.
    const l = file().data.leads.find((x) => x.id === id);
    return l ? { ...l } : null;
  },

  async setLeadCreatedAt(id: string, createdAt: string) {
    commit((data) => {
      const lead = data.leads.find((l) => l.id === id);
      if (lead) lead.createdAt = createdAt;
    });
  },

  async setLeadStatus(id: string, status: LeadStatus, patch?: LeadStatusPatch) {
    commit((data) => {
      const lead = data.leads.find((l) => l.id === id);
      if (!lead) return;
      lead.status = status;
      if (patch?.meetingAt !== undefined) lead.meetingAt = patch.meetingAt;
      if (patch?.meetingFor !== undefined) lead.meetingFor = patch.meetingFor;
      if (patch?.lostReasonDetail !== undefined) lead.lostReasonDetail = patch.lostReasonDetail ?? undefined;
      if (patch?.value !== undefined) lead.value = patch.value;
      if (patch?.roboSessionId !== undefined) lead.roboSessionId = patch.roboSessionId;
      // Marcos: gravados uma vez, nunca sobrescritos — é o que impede uma perda
      // registrada depois de apagar a reunião que aconteceu.
      if (patch?.firstContactAt === null) delete lead.firstContactAt;
      else lead.firstContactAt ??= patch?.firstContactAt;
      lead.bookedAt ??= patch?.bookedAt;
      lead.attendedAt ??= patch?.attendedAt;
      lead.closedAt ??= patch?.closedAt;
      if (patch?.lostAt !== undefined) lead.lostAt = patch.lostAt ?? undefined;
    });
  },

  async softDeleteLead(id: string, info: { at: string; by: string; reason: string }) {
    commit((data) => {
      const lead = data.leads.find((l) => l.id === id);
      if (!lead) return;
      lead.deletedAt = info.at;
      lead.deletedBy = info.by;
      lead.deletedReason = info.reason;
    });
  },

  async restoreLead(id: string) {
    commit((data) => {
      const lead = data.leads.find((l) => l.id === id);
      if (!lead) return;
      delete lead.deletedAt;
      delete lead.deletedBy;
      delete lead.deletedReason;
    });
  },

  async listDeletedLeads(brand: string) {
    return file()
      .data.leads.filter((l) => l.brand === brand && l.deletedAt)
      .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
  },

  async listLeads(brand: string) {
    return file()
      .data.leads.filter((l) => l.brand === brand && !l.deletedAt)
      .map((l) => ({ ...l }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async upsertGoal(goal: Goal) {
    commit((data) => {
      const others = data.goals.filter(
        (g) => !(g.brand === goal.brand && g.metric === goal.metric && g.period === goal.period),
      );
      data.goals = [...others, goal];
    });
  },

  async setCampaignBudget(brand: string, budget: CampaignBudget) {
    commit((data) => {
      // O arquivo local guarda UMA campanha. Gravar a de outra marca apagaria a
      // existente — melhor falhar alto do que perder dado em silêncio.
      if (data.campaign.brand !== brand) {
        throw new Error(
          "O modo local guarda uma campanha só. Conecte um banco para cadastrar o orçamento desta marca.",
        );
      }
      data.campaign.budgetTotal = budget.budgetTotal;
      if (budget.dailyBudget != null) data.campaign.dailyBudget = budget.dailyBudget;
      if (budget.endDate) data.campaign.endDate = budget.endDate;
    });
  },

  async bumpLpDaily(brand: string, date: string, delta: LpDelta) {
    commit((data) => {
      const row = data.lpDaily.find((r) => r.brand === brand && r.date === date);
      if (row) {
        row.visits += delta.visits ?? 0;
        row.clicks += delta.clicks ?? 0;
        row.formSubmits += delta.formSubmits ?? 0;
      } else {
        data.lpDaily = [
          ...data.lpDaily,
          {
            brand,
            date,
            visits: delta.visits ?? 0,
            clicks: delta.clicks ?? 0,
            formSubmits: delta.formSubmits ?? 0,
          },
        ].sort((a, b) => a.date.localeCompare(b.date));
      }
      data.isSeed = false;
    });
  },

  async getState<T>(key: string) {
    return (file().state[key] as T) ?? null;
  },

  async setState(key: string, value: unknown) {
    const f = file();
    f.state[key] = value;
    persist(f);
    cache = f;
  },

  async countUsers() {
    return file().users.length;
  },

  async getUser(username: string) {
    return file().users.find((u) => u.username === username) ?? null;
  },

  async listUsers(): Promise<PublicUser[]> {
    return file()
      .users.map((u) => ({ username: u.username, role: toRole(u.role), createdAt: u.createdAt }))
      .sort((a, b) => a.username.localeCompare(b.username));
  },

  async createUser(user: StoredUser) {
    const f = file();
    f.users = [...f.users.filter((u) => u.username !== user.username), user];
    persist(f);
    cache = f;
  },

  async deleteUser(username: string) {
    const f = file();
    f.users = f.users.filter((u) => u.username !== username);
    persist(f);
    cache = f;
  },

  async setUserRole(username: string, role) {
    const f = file();
    const user = f.users.find((u) => u.username === username);
    if (user) {
      user.role = role;
      persist(f);
      cache = f;
    }
  },

  async addLeadEvent(event: LeadEvent) {
    const f = file();
    f.leadEvents = [event, ...f.leadEvents];
    persist(f);
    cache = f;
  },

  async listLeadEvents(opts?: ListEventsOpts): Promise<LeadEvent[]> {
    let list = file().leadEvents;
    if (opts?.leadId) list = list.filter((e) => e.leadId === opts.leadId);
    if (opts?.brand) list = list.filter((e) => !e.brand || e.brand === opts.brand);
    const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const limit = opts?.limit ?? 200;
    return limit > 0 ? sorted.slice(0, limit) : sorted;
  },

  async addAuditEntry(entry: AuditEntry) {
    const f = file();
    f.audit = [entry, ...f.audit];
    persist(f);
    cache = f;
  },

  async listAuditEntries(limit: number) {
    return [...file().audit].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  },

  async addSyncRun(run: SyncRun) {
    const f = file();
    f.syncRuns = [run, ...f.syncRuns.filter((r) => r.id !== run.id)];
    persist(f);
    cache = f;
  },

  async listSyncRuns(opts?: ListSyncRunsOpts) {
    let list = file().syncRuns;
    if (opts?.source) list = list.filter((r) => r.source === opts.source);
    if (opts?.brand) list = list.filter((r) => r.brand === opts.brand);
    const sorted = [...list].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).map((r) => ({ ...r }));
    const limit = opts?.limit ?? 50;
    return limit > 0 ? sorted.slice(0, limit) : sorted;
  },
};
