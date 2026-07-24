import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { addLead, addLeadEvent, bumpLpDaily } from "@/lib/data/store";
import { newEventId } from "@/lib/auth/actor";
import { sendCapiEvent } from "@/lib/meta/capi";
import { sendGa4Event } from "@/lib/ga4/measurement-protocol";

export const dynamic = "force-dynamic";

/**
 * Public ingest endpoint called by the landing page (`public/lp-tracking.js`).
 *
 * Bodies arrive as text/plain on purpose: that keeps the request "simple" for
 * CORS, so `navigator.sendBeacon` works cross-origin without a preflight it
 * cannot perform. We parse the JSON ourselves.
 *
 * Privacy: name, e-mail and phone are stored on the lead for the sales team,
 * and also hashed into the CAPI payload for matching. The lead table is behind
 * RLS (service role only) — protect dashboard access, since it now shows PII.
 */

type EventType = "page_view" | "cta_click" | "lead";

interface Attribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  fbclid?: string;
  gclid?: string;
  fbc?: string;
}

interface TrackBody {
  type?: EventType;
  ingestKey?: string;
  pageUrl?: string;
  attribution?: Attribution;
  fbc?: string;
  fbp?: string;
  gaClientId?: string;
  gaSessionId?: string;
  eventId?: string;
  name?: string;
  email?: string;
  phone?: string;
  label?: string;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = process.env.LP_ALLOWED_ORIGIN?.trim();
  const value = !allowed || allowed === "*" ? (origin ?? "*") : allowed;
  return {
    "Access-Control-Allow-Origin": value,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function clientIp(request: Request): string | undefined {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? undefined;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}

export async function POST(request: Request) {
  const headers = corsHeaders(request.headers.get("origin"));

  let body: TrackBody;
  try {
    body = JSON.parse(await request.text()) as TrackBody;
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400, headers });
  }

  const expectedKey = process.env.TRACK_INGEST_KEY?.trim();
  if (expectedKey && body.ingestKey !== expectedKey) {
    return NextResponse.json({ error: "Chave inválida." }, { status: 401, headers });
  }

  const type = body.type;
  if (type !== "page_view" && type !== "cta_click" && type !== "lead") {
    return NextResponse.json({ error: "Tipo de evento inválido." }, { status: 400, headers });
  }

  const date = today();

  if (type === "page_view") {
    await bumpLpDaily(date, { visits: 1 });
    return new NextResponse(null, { status: 204, headers });
  }

  if (type === "cta_click") {
    await bumpLpDaily(date, { clicks: 1 });
    return new NextResponse(null, { status: 204, headers });
  }

  // ---- lead --------------------------------------------------------
  const attr = body.attribution ?? {};
  const eventId = body.eventId?.trim() || randomUUID();
  const leadId = `LEAD-LP-${eventId.slice(0, 8)}`;

  await bumpLpDaily(date, { formSubmits: 1 });
  await addLead({
    id: leadId,
    createdAt: new Date().toISOString(),
    name: (body.name ?? "").trim() || "Lead sem nome",
    email: (body.email ?? "").trim() || undefined,
    phone: (body.phone ?? "").trim() || undefined,
    utmSource: attr.utm_source,
    utmCampaign: attr.utm_campaign,
    // utm_content carries the ad id — this is what ties the lead to a creative
    utmContent: attr.utm_content,
    status: "lead",
    // kept so the later Schedule event can still be matched to this person
    fbc: body.fbc || attr.fbc,
    fbp: body.fbp,
    gaClientId: body.gaClientId,
    gaSessionId: body.gaSessionId,
  });
  await addLeadEvent({
    id: newEventId(),
    leadId,
    leadName: (body.name ?? "").trim() || "Lead sem nome",
    actor: "Landing page",
    action: "created",
    toStatus: "lead",
    createdAt: new Date().toISOString(),
  });

  // The user agent of THIS request is the visitor's browser (the landing page
  // posts directly), which is exactly what CAPI requires.
  const userAgent = request.headers.get("user-agent") ?? undefined;

  const [capi, ga4] = await Promise.all([
    sendCapiEvent({
      eventName: "Lead",
      eventId,
      eventSourceUrl: body.pageUrl,
      user: {
        email: body.email,
        phone: body.phone,
        firstName: (body.name ?? "").trim().split(/\s+/)[0],
        fbc: body.fbc || attr.fbc,
        fbp: body.fbp,
        ip: clientIp(request),
        userAgent,
        externalId: leadId,
      },
      customData: { content_name: "Formulário da landing page", currency: "BRL" },
    }),
    sendGa4Event({
      name: "generate_lead",
      clientId: body.gaClientId,
      sessionId: body.gaSessionId,
      params: {
        campaign: attr.utm_campaign,
        source: attr.utm_source,
        medium: attr.utm_medium,
        content: attr.utm_content,
        currency: "BRL",
        value: 0,
      },
    }),
  ]);

  return NextResponse.json(
    { ok: true, leadId, capi: capi.detail, ga4: ga4.detail },
    { headers },
  );
}
