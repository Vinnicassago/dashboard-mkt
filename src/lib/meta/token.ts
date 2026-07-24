import "server-only";
import { getState, setState } from "../data/store";
import { STATE_KEYS, type StoredToken } from "../data/backend";
import { igTokenFromEnv } from "./config";
import { metaGet } from "./http";

/**
 * Instagram long-lived tokens last 60 days and do NOT refresh themselves —
 * an expired token is the #1 reason these dashboards silently stop updating.
 *
 * We keep the refreshed token in the state bag (Supabase `app_state`, or the
 * local JSON file in dev) so the sync job can rotate it without anyone having
 * to paste a new value into the environment every two months.
 */

const REFRESH_WHEN_DAYS_LEFT = 10;

interface RefreshResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
}

/** The token currently in force: the rotated one if present, else the env var. */
export async function getIgToken(): Promise<string | undefined> {
  const stored = await getState<StoredToken>(STATE_KEYS.igToken);
  if (stored?.token) return stored.token;
  return igTokenFromEnv();
}

function daysUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 86_400_000;
}

/**
 * Refresh the long-lived token when it is close to expiring.
 * Returns a short human-readable note about what happened.
 */
export async function refreshIgTokenIfNeeded(): Promise<string> {
  const stored = await getState<StoredToken>(STATE_KEYS.igToken);
  const token = stored?.token ?? igTokenFromEnv();
  if (!token) return "sem token do Instagram configurado";

  // With no known expiry yet we still refresh once to learn it.
  const left = stored?.expiresAt ? daysUntil(stored.expiresAt) : -1;
  if (left > REFRESH_WHEN_DAYS_LEFT) {
    return `token ok (expira em ~${Math.floor(left)} dias)`;
  }

  const url =
    "https://graph.instagram.com/refresh_access_token" +
    `?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;

  const res = await metaGet<RefreshResponse>(url, { retries: 2 });
  if (!res?.access_token) return "não foi possível renovar o token";

  const expiresAt = new Date(Date.now() + res.expires_in * 1000).toISOString();
  await setState(STATE_KEYS.igToken, { token: res.access_token, expiresAt });
  return `token renovado (válido até ${expiresAt.slice(0, 10)})`;
}
