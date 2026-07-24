/**
 * Auth is enabled only when AUTH_SECRET is set. With no secret the middleware
 * lets everything through — convenient for local dev, secure once you set it in
 * production. Keep this file free of node-only imports: middleware reads it too.
 */
export const authSecret = () => process.env.AUTH_SECRET?.trim() || undefined;

export const isAuthEnabled = () => Boolean(authSecret());

/** Normalise a username: trimmed + lowercase, so "Victor" == "victor". */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}
