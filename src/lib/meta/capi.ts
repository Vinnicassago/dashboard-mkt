import "server-only";
import { createHash } from "node:crypto";
import { GRAPH_FB, capiToken, capiTestEventCode, datasetId } from "./config";

/**
 * Meta Conversions API (server-side events).
 *
 * Why it exists: the browser Pixel alone loses a large share of conversions to
 * ad blockers and iOS ATT. Sending the same event from the server recovers that
 * signal — and because both carry the SAME `event_id`, Meta deduplicates them
 * instead of double counting.
 *
 * PII must be SHA-256 hashed after normalisation. Click identifiers (fbc/fbp),
 * the IP and the user agent are sent RAW — hashing those breaks matching.
 */

export type CapiEventName = "Lead" | "Schedule" | "Purchase";

export interface CapiUser {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  /** Facebook click id cookie (_fbc) — never hashed. */
  fbc?: string;
  /** Facebook browser id cookie (_fbp) — never hashed. */
  fbp?: string;
  ip?: string;
  userAgent?: string;
  externalId?: string;
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** Meta expects lowercase + trimmed before hashing. */
function hashText(v?: string): string | undefined {
  const clean = (v ?? "").trim().toLowerCase();
  return clean ? sha256(clean) : undefined;
}

/**
 * Phone: digits only, WITH country code, no "+", separators or leading zeros.
 * Brazilian numbers typed without the country code get 55 prepended.
 * (Meta: "remove symbols, letters, and any leading zeros".)
 */
function hashPhone(v?: string): string | undefined {
  let digits = (v ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return undefined;
  if (digits.length >= 10 && digits.length <= 11) digits = `55${digits}`;
  return sha256(digits);
}

interface CapiResponse {
  events_received?: number;
  messages?: string[];
  fbtrace_id?: string;
}

export interface CapiResult {
  sent: boolean;
  detail: string;
}

export async function sendCapiEvent({
  eventName,
  eventId,
  eventSourceUrl,
  user,
  customData,
  eventTime,
  actionSource = "website",
}: {
  eventName: CapiEventName;
  /** MUST match the browser event's eventID (and event_name) to deduplicate. */
  eventId: string;
  /** Required for website events — Meta may discard the event without it. */
  eventSourceUrl?: string;
  user: CapiUser;
  customData?: Record<string, unknown>;
  eventTime?: number;
  /**
   * Closed enum. "website" for events fired from the landing page;
   * "system_generated" for events our own back office raises (e.g. someone
   * marking a meeting as booked), which have no visitor browser behind them.
   */
  actionSource?: "website" | "system_generated" | "phone_call" | "chat" | "other";
}): Promise<CapiResult> {
  const dataset = datasetId();
  const token = capiToken();
  if (!dataset || !token) {
    return { sent: false, detail: "CAPI não configurado" };
  }

  const userData: Record<string, unknown> = {};
  const em = hashText(user.email);
  const ph = hashPhone(user.phone);
  const fn = hashText(user.firstName);
  const ln = hashText(user.lastName);
  const externalId = hashText(user.externalId);

  if (em) userData.em = [em];
  if (ph) userData.ph = [ph];
  if (fn) userData.fn = [fn];
  if (ln) userData.ln = [ln];
  if (externalId) userData.external_id = [externalId];
  // raw on purpose — hashing these breaks matching
  if (user.fbc) userData.fbc = user.fbc;
  if (user.fbp) userData.fbp = user.fbp;
  if (user.ip) userData.client_ip_address = user.ip;
  if (user.userAgent) userData.client_user_agent = user.userAgent;

  const body: Record<string, unknown> = {
    data: [
      {
        event_name: eventName,
        // seconds, not milliseconds — and Meta rejects anything older than 7 days
        event_time: eventTime ?? Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: actionSource, // closed enum; required on every event
        ...(eventSourceUrl ? { event_source_url: eventSourceUrl } : {}),
        user_data: userData,
        ...(customData ? { custom_data: customData } : {}),
      },
    ],
  };

  // test_event_code belongs at the TOP LEVEL, next to `data` — not inside it.
  const testCode = capiTestEventCode();
  if (testCode) body.test_event_code = testCode;

  try {
    // The access token goes in the query string, not in the JSON body.
    const url = `${GRAPH_FB}/${dataset}/events?access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as CapiResponse & {
      error?: { message?: string };
    };
    if (!res.ok || json.error) {
      return { sent: false, detail: json.error?.message ?? `HTTP ${res.status}` };
    }
    return {
      sent: true,
      detail: `${json.events_received ?? 1} evento(s) recebido(s) pela Meta`,
    };
  } catch (e) {
    return { sent: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
