/**
 * Data-access facade (server-only).
 *
 * Picks the backend at runtime:
 *   • Supabase  — when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set
 *   • JSON local — otherwise (dev / no credentials)
 *
 * Everything in the app reads and writes through these functions, so the
 * switch is invisible to pages, actions and sync jobs.
 */

import "server-only";
import { isSupabaseConfigured } from "../supabase/client";
import { isPostgresConfigured } from "../db/pg";
import { localBackend } from "./local-store";
import { supabaseBackend } from "./supabase-store";
import { postgresBackend } from "./postgres-store";
import type { DataBackend, LpDelta, StoredUser } from "./backend";
import type { Role } from "../auth/roles";
import type {
  AdDaily,
  Creative,
  Goal,
  IgAccountDaily,
  IgPost,
  Lead,
  LeadEvent,
  LeadStatus,
} from "../types";
import { DEFAULT_BRAND } from "../types";

function backend(): DataBackend {
  if (isPostgresConfigured()) return postgresBackend; // DATABASE_URL (EasyPanel/Postgres)
  if (isSupabaseConfigured()) return supabaseBackend;
  return localBackend;
}

/** Which backend is serving data right now (shown in the Config screen). */
export function activeBackend(): DataBackend["name"] {
  return backend().name;
}

// ---- reads ----------------------------------------------------------

/** Dataset de UMA marca. Sem argumento, a marca padrão (consorcio.brunno). */
export const getData = (brand: string = DEFAULT_BRAND) => backend().getData(brand);

// ---- writes ---------------------------------------------------------

export const resetToSeed = () => backend().resetToSeed();

export const upsertAdDaily = (rows: AdDaily[]) => backend().upsertAdDaily(rows);

export const upsertCreatives = (rows: Creative[]) => backend().upsertCreatives(rows);

/** Remove all ad rows (ad_daily + creatives) before a clean re-sync from the Meta API. */
export const clearAdData = () => backend().clearAdData();

export const upsertIgAccountDaily = (rows: IgAccountDaily[]) =>
  backend().upsertIgAccountDaily(rows);

export const upsertIgPosts = (rows: IgPost[]) => backend().upsertIgPosts(rows);

export const addLead = (lead: Lead) => backend().addLead(lead);

export const setLeadStatus = (id: string, status: LeadStatus, meetingAt?: string, value?: number) =>
  backend().setLeadStatus(id, status, meetingAt, value);

export const deleteLead = (id: string) => backend().deleteLead(id);

export const upsertGoal = (goal: Goal) => backend().upsertGoal(goal);

export const bumpLpDaily = (date: string, delta: LpDelta, brand: string = DEFAULT_BRAND) =>
  backend().bumpLpDaily(brand, date, delta);

export const addLeadEvent = (event: LeadEvent) => backend().addLeadEvent(event);
export const listLeadEvents = (opts?: { leadId?: string; limit?: number }) =>
  backend().listLeadEvents(opts);

// ---- state bag (last sync, tokens) ---------------------------------

export const getState = <T,>(key: string) => backend().getState<T>(key);

export const setState = (key: string, value: unknown) => backend().setState(key, value);

// ---- auth users -----------------------------------------------------

export const countUsers = () => backend().countUsers();
export const getUser = (username: string) => backend().getUser(username);
export const listUsers = () => backend().listUsers();
export const createUser = (user: StoredUser) => backend().createUser(user);
export const deleteUser = (username: string) => backend().deleteUser(username);
export const setUserRole = (username: string, role: Role) =>
  backend().setUserRole(username, role);
