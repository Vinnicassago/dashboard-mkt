import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** True when both env vars are present — used to pick the store backend. */
export function isSupabaseConfigured(): boolean {
  return Boolean(url && serviceKey);
}

let cached: SupabaseClient | null = null;

/**
 * Server-side Supabase client using the service role key.
 * NEVER import this from a Client Component — it would leak the key.
 */
export function supabase(): SupabaseClient {
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase não configurado: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  if (!cached) {
    cached = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
