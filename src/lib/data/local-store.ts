import "server-only";
import fs from "node:fs";
import path from "node:path";
import { buildSeedData, buildSeedLeadEvents } from "./seed";
import { FALLBACK_CAMPAIGN } from "./mappers";
import type { DataBackend, LpDelta, PublicUser, StoredUser } from "./backend";
import { toRole } from "../auth/roles";
import { DEFAULT_BRAND } from "../types";
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

/**
 * Development / no-credentials backend: one JSON file on disk.
 * Good enough to run the whole dashboard locally; not for production
 * (serverless filesystems are ephemeral and not shared) — use Supabase there.
 */

const DATA_DIR = path.join(process.cwd(), ".localdata");
const DATA_FILE = path.join(DATA_DIR, "store.json");

interface LocalFile {
  data: DashboardData;
  state: Record<string, unknown>;
  users: StoredUser[];
  leadEvents: LeadEvent[];
}

let cache: LocalFile | null = null;

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

function persist(file: LocalFile) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(file, null, 2), "utf8");
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
        migrateBrand(parsed.data);
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
  };
  persist(fresh);
  return fresh;
}

function file(): LocalFile {
  if (!cache) cache = load();
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
      leads: d.leads.filter((r) => r.brand === brand),
      goals: d.goals.filter((r) => r.brand === brand),
    };
  },

  async resetToSeed() {
    // keep users and the state bag — only the dashboard data goes back to seed
    const data = buildSeedData();
    cache = {
      data,
      state: file().state,
      users: file().users,
      leadEvents: buildSeedLeadEvents(data.leads),
    };
    persist(cache);
    return cache.data;
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

  async clearAdData() {
    commit((data) => {
      data.adDaily = [];
      data.creatives = [];
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
    commit((data) => {
      // upsert por id: reimportar/recadastrar o mesmo lead atualiza, não duplica
      data.leads = [lead, ...data.leads.filter((l) => l.id !== lead.id)];
      data.isSeed = false;
    });
  },

  async setLeadStatus(id: string, status: LeadStatus, meetingAt?: string, value?: number) {
    commit((data) => {
      const lead = data.leads.find((l) => l.id === id);
      if (lead) {
        lead.status = status;
        if (meetingAt !== undefined) lead.meetingAt = meetingAt;
        if (value !== undefined) lead.value = value;
      }
    });
  },

  async deleteLead(id: string) {
    const f = file();
    f.data.leads = f.data.leads.filter((l) => l.id !== id);
    f.leadEvents = f.leadEvents.filter((e) => e.leadId !== id);
    f.data.updatedAt = new Date().toISOString();
    persist(f);
    cache = f;
  },

  async upsertGoal(goal: Goal) {
    commit((data) => {
      const others = data.goals.filter(
        (g) => !(g.brand === goal.brand && g.metric === goal.metric && g.period === goal.period),
      );
      data.goals = [...others, goal];
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

  async listLeadEvents(opts?: { leadId?: string; limit?: number }): Promise<LeadEvent[]> {
    let list = file().leadEvents;
    if (opts?.leadId) list = list.filter((e) => e.leadId === opts.leadId);
    const sorted = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return opts?.limit ? sorted.slice(0, opts.limit) : sorted;
  },
};
