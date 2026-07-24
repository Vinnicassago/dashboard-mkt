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
import type { Role } from "../auth/roles";

/**
 * The contract every storage backend implements. The app only ever talks to
 * this shape (via `store.ts`), so swapping JSON ⇄ Supabase changes nothing else.
 */
export interface DataBackend {
  readonly name: "local" | "supabase" | "postgres";

  getData(): Promise<DashboardData>;
  resetToSeed(): Promise<DashboardData>;

  upsertAdDaily(rows: AdDaily[]): Promise<number>;
  upsertCreatives(rows: Creative[]): Promise<number>;
  upsertIgAccountDaily(rows: IgAccountDaily[]): Promise<number>;
  upsertIgPosts(rows: IgPost[]): Promise<number>;

  addLead(lead: Lead): Promise<void>;
  setLeadStatus(id: string, status: LeadStatus, meetingAt?: string): Promise<void>;
  upsertGoal(goal: Goal): Promise<void>;

  // ---- lead audit log ----
  addLeadEvent(event: LeadEvent): Promise<void>;
  listLeadEvents(opts?: { leadId?: string; limit?: number }): Promise<LeadEvent[]>;

  /** Accumulate landing-page counters for a day (read-modify-write). */
  bumpLpDaily(date: string, delta: LpDelta): Promise<void>;

  /** Small key/value bag: last sync timestamps, refreshed tokens, flags. */
  getState<T>(key: string): Promise<T | null>;
  setState(key: string, value: unknown): Promise<void>;

  // ---- auth users ----
  countUsers(): Promise<number>;
  getUser(username: string): Promise<StoredUser | null>;
  listUsers(): Promise<PublicUser[]>;
  createUser(user: StoredUser): Promise<void>;
  deleteUser(username: string): Promise<void>;
  setUserRole(username: string, role: Role): Promise<void>;
}

/** A user with its (hashed) credentials — never sent to the client. */
export interface StoredUser {
  username: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
}

/** Safe-to-display user info (no hash). */
export interface PublicUser {
  username: string;
  role: Role;
  createdAt: string;
}

/** Deltas applied to a day's landing-page counters. */
export interface LpDelta {
  visits?: number;
  clicks?: number;
  formSubmits?: number;
}

/** Keys used in the state bag. */
export const STATE_KEYS = {
  lastSyncAds: "last_sync_ads",
  lastSyncInstagram: "last_sync_instagram",
  igToken: "ig_token",
} as const;

export interface StoredToken {
  token: string;
  /** ISO timestamp when the long-lived token expires. */
  expiresAt: string;
}
