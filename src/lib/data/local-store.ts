import "server-only";
import fs from "node:fs";
import path from "node:path";
import { buildSeedData, buildSeedLeadEvents } from "./seed";
import type { DataBackend, LpDelta, PublicUser, StoredUser } from "./backend";
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

  async getData() {
    return file().data;
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
      const key = (r: AdDaily) => `${r.date}::${r.adId}`;
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
      const index = new Map(data.igAccountDaily.map((r) => [r.date, r]));
      for (const row of rows) index.set(row.date, row);
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
      data.leads = [lead, ...data.leads];
      data.isSeed = false;
    });
  },

  async setLeadStatus(id: string, status: LeadStatus, meetingAt?: string) {
    commit((data) => {
      const lead = data.leads.find((l) => l.id === id);
      if (lead) {
        lead.status = status;
        if (meetingAt !== undefined) lead.meetingAt = meetingAt;
      }
    });
  },

  async upsertGoal(goal: Goal) {
    commit((data) => {
      const others = data.goals.filter(
        (g) => !(g.metric === goal.metric && g.period === goal.period),
      );
      data.goals = [...others, goal];
    });
  },

  async bumpLpDaily(date: string, delta: LpDelta) {
    commit((data) => {
      const row = data.lpDaily.find((r) => r.date === date);
      if (row) {
        row.visits += delta.visits ?? 0;
        row.clicks += delta.clicks ?? 0;
        row.formSubmits += delta.formSubmits ?? 0;
      } else {
        data.lpDaily = [
          ...data.lpDaily,
          {
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
