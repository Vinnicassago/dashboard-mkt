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
import type {
  AdScope,
  CampaignBudget,
  DataBackend,
  LeadStatusPatch,
  ListEventsOpts,
  LpDelta,
  StoredUser,
} from "./backend";
import type { Role } from "../auth/roles";
import type {
  AdDaily,
  AuditEntry,
  Creative,
  Goal,
  IgAccountDaily,
  IgPost,
  Lead,
  LeadEvent,
  LeadStatus,
  PostDraft,
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

/** Troca as linhas de anúncio de um recorte (ou todas) pelas novas, de uma vez. */
export const replaceAdData = (rows: AdDaily[], creatives: Creative[], scope?: AdScope) =>
  backend().replaceAdData(rows, creatives, scope);

export const upsertIgAccountDaily = (rows: IgAccountDaily[]) =>
  backend().upsertIgAccountDaily(rows);

export const upsertIgPosts = (rows: IgPost[]) => backend().upsertIgPosts(rows);

// ---- produção (peças antes de publicar) -----------------------------

export const listDrafts = (brand: string = DEFAULT_BRAND) => backend().listDrafts(brand);
export const getDraft = (id: string) => backend().getDraft(id);
export const upsertDraft = (draft: PostDraft) => backend().upsertDraft(draft);
export const deleteDraft = (id: string) => backend().deleteDraft(id);

/** Lead novo; se o id já existe, só preenche contato vazio (ver DataBackend). */
export const addLead = (lead: Lead) => backend().addLead(lead);
export const getLead = (id: string) => backend().getLead(id);

export const setLeadStatus = (id: string, status: LeadStatus, patch?: LeadStatusPatch) =>
  backend().setLeadStatus(id, status, patch);

export const setLeadCreatedAt = (id: string, createdAt: string) =>
  backend().setLeadCreatedAt(id, createdAt);

export const softDeleteLead = (id: string, info: { at: string; by: string; reason: string }) =>
  backend().softDeleteLead(id, info);
export const restoreLead = (id: string) => backend().restoreLead(id);
export const listDeletedLeads = (brand: string = DEFAULT_BRAND) => backend().listDeletedLeads(brand);

export const upsertGoal = (goal: Goal) => backend().upsertGoal(goal);

export const setCampaignBudget = (brand: string, budget: CampaignBudget) =>
  backend().setCampaignBudget(brand, budget);

export const bumpLpDaily = (date: string, delta: LpDelta, brand: string = DEFAULT_BRAND) =>
  backend().bumpLpDaily(brand, date, delta);

export const addLeadEvent = (event: LeadEvent) => backend().addLeadEvent(event);
export const listLeadEvents = (opts?: ListEventsOpts) => backend().listLeadEvents(opts);

export const addAuditEntry = (entry: AuditEntry) => backend().addAuditEntry(entry);
export const listAuditEntries = (limit = 20) => backend().listAuditEntries(limit);

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
