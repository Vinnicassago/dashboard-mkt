import "server-only";
import { Pool, types } from "pg";
import { SCHEMA_SQL } from "./schema";

/**
 * Direct PostgreSQL connection (used when DATABASE_URL is set — e.g. the
 * Postgres service on EasyPanel/Hostinger). This is the alternative to Supabase.
 *
 * Only `date` (OID 1082) is overridden — keep the raw 'YYYY-MM-DD' text, since
 * the default would return a Date at local midnight (timezone-shifty). For
 * timestamptz we LET the driver return a proper Date (its parser is correct);
 * the mappers turn that into ISO with `iso()`. numeric stays a string (mappers
 * call Number()); jsonb is parsed to an object.
 */
types.setTypeParser(1082, (v) => v);

export function isPostgresConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

let pool: Pool | null = null;

export function pg(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definido.");
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 5,
      // set DATABASE_SSL=require for managed Postgres that needs TLS
      ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

/**
 * Create the tables on first use (idempotent), so a fresh Postgres sets itself
 * up with no manual SQL. Runs once per process; retries if it failed.
 */
let schemaReady: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = pg()
      .query(SCHEMA_SQL)
      .then(() => undefined)
      .catch((e) => {
        schemaReady = null;
        throw e;
      });
  }
  return schemaReady;
}

