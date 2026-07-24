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
import { localBackend } from "./local-store";
import { supabaseBackend } from "./supabase-store";
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

function backend(): DataBackend {
  return isSupabaseConfigured() ? supabaseBackend : localBackend;
}

/** Which backend is serving data right now (shown in the Config screen). */
export function activeBackend(): DataBackend["name"] {
  return backend().name;
}

// ---- reads ----------------------------------------------------------

export const getData = () => backend().getData();

// ---- writes ---------------------------------------------------------

export const resetToSeed = () => backend().resetToSeed();

export const upsertAdDaily = (rows: AdDaily[]) => backend().upsertAdDaily(rows);

export const upsertCreatives = (rows: Creative[]) => backend().upsertCreatives(rows);

export const upsertIgAccountDaily = (rows: IgAccountDaily[]) =>
  backend().upsertIgAccountDaily(rows);

export const upsertIgPosts = (rows: IgPost[]) => backend().upsertIgPosts(rows);

export const addLead = (lead: Lead) => backend().addLead(lead);

export const setLeadStatus = (id: string, status: LeadStatus, meetingAt?: string) =>
  backend().setLeadStatus(id, status, meetingAt);

export const upsertGoal = (goal: Goal) => backend().upsertGoal(goal);

export const bumpLpDaily = (date: string, delta: LpDelta) =>
  backend().bumpLpDaily(date, delta);

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
