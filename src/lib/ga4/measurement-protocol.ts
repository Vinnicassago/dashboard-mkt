import "server-only";
import { ga4ApiSecret, ga4MeasurementId } from "../meta/config";

/**
 * GA4 Measurement Protocol — server-side events.
 *
 * Three rules from the docs shape this file:
 *
 *  1. `client_id` must be one GA4 already saw from gtag.js in the browser. The
 *     landing page reads it from the `_ga` cookie. Inventing one server-side is
 *     the WORST option — GA4 accepts it and creates a phantom user — so when it
 *     is missing we skip the event instead.
 *  2. Attribution (source/medium/campaign) comes from the `session_id`, not
 *     from UTM params in the payload, so we forward it when the page captured it.
 *  3. The production endpoint answers 2xx even for a malformed payload and never
 *     reports errors. "Accepted" is therefore not "processed" — use the debug
 *     endpoint to actually validate.
 */

const ENDPOINT = "https://www.google-analytics.com/mp/collect";
const DEBUG_ENDPOINT = "https://www.google-analytics.com/debug/mp/collect";

export interface Ga4Result {
  sent: boolean;
  detail: string;
}

export async function sendGa4Event({
  name,
  clientId,
  sessionId,
  params,
  userId,
  debug = false,
}: {
  /** Recommended lead-gen names: generate_lead, qualify_lead, close_convert_lead. */
  name: string;
  clientId?: string;
  sessionId?: string;
  params?: Record<string, unknown>;
  userId?: string;
  debug?: boolean;
}): Promise<Ga4Result> {
  const measurementId = ga4MeasurementId();
  const apiSecret = ga4ApiSecret();
  if (!measurementId || !apiSecret) {
    return { sent: false, detail: "GA4 não configurado" };
  }
  if (!clientId?.trim()) {
    return {
      sent: false,
      detail: "sem client_id do GA4 — evento não enviado (evita usuário fantasma)",
    };
  }

  const url =
    `${debug ? DEBUG_ENDPOINT : ENDPOINT}` +
    `?measurement_id=${encodeURIComponent(measurementId)}` +
    `&api_secret=${encodeURIComponent(apiSecret)}`;

  const body = {
    client_id: clientId.trim(),
    ...(userId ? { user_id: userId } : {}),
    events: [
      {
        name,
        params: {
          ...(sessionId ? { session_id: sessionId } : {}),
          ...params,
        },
      },
    ],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) return { sent: false, detail: `HTTP ${res.status}` };
    const caveat = sessionId ? "" : " (sem session_id — atribuição pode ficar direct)";
    return { sent: true, detail: `evento ${name} aceito pelo GA4${caveat}` };
  } catch (e) {
    return { sent: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
