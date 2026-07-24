import "server-only";

/** Shape of a Graph API error payload. */
interface GraphError {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET a Graph API URL with exponential backoff.
 *
 * Retries on 429 (rate limit — Instagram allows ~200 calls/hour per user) and
 * on 5xx. Meta also signals throttling with error codes 4, 17 and 32, so those
 * are treated as retryable even when the HTTP status is 200/400.
 */
export async function metaGet<T>(
  url: string,
  { retries = 3, timeoutMs = 30_000 }: { retries?: number; timeoutMs?: number } = {},
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(2 ** attempt * 1000, 15_000));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const text = await res.text();
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = {};
      }
      const err = (body as GraphError).error;

      if (res.ok && !err) return body as T;

      const code = err?.code;
      const message = err?.message ?? `HTTP ${res.status}`;
      // Meta signals throttling through error codes as well as HTTP 429:
      // 4 / 17 / 32 (app + user rate limits), 613 (calls per second),
      // 80000 (ads_insights business use case).
      const throttled =
        res.status === 429 || [4, 17, 32, 613, 80000].includes(code ?? -1);
      const retryable = throttled || res.status >= 500;

      lastError = new MetaApiError(message, res.status, code);
      if (!retryable) throw lastError;
    } catch (e) {
      if (e instanceof MetaApiError && ![429, 500, 502, 503, 504].includes(e.status)) {
        // non-retryable API error — surface immediately
        if (![4, 17, 32, 613, 80000].includes(e.code ?? -1)) throw e;
      }
      lastError = e instanceof Error ? e : new Error(String(e));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error("Falha desconhecida ao chamar a API da Meta.");
}

/** Build a Graph URL with query params (undefined values are dropped). */
export function graphUrl(
  base: string,
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/** yyyy-mm-dd for a date N days before `end` (defaults to today, UTC). */
export function isoDaysAgo(days: number, end = new Date()): string {
  const d = new Date(end);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
