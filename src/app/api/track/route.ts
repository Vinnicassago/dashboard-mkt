import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { addLead, addLeadEvent, bumpLpDaily, getLead, listLeads, setLeadStatus } from "@/lib/data/store";
import { DEFAULT_BRAND, type Lead } from "@/lib/types";
import { candidatosIdLead, resolverIdLead } from "@/lib/lead-id";
import { mesmoTelefone } from "@/lib/phone";
import { acharMesmaPessoa } from "@/lib/identidade";
import { isLostStatus } from "@/lib/lead-status";
import { newEventId } from "@/lib/auth/actor";
import { avisarLeadNovo } from "@/lib/avisos";
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
  // LP_ALLOWED_ORIGIN accepts a comma-separated list (we have two landing pages).
  const raw = process.env.LP_ALLOWED_ORIGIN?.trim();
  const allowList =
    raw && raw !== "*" ? raw.split(",").map((o) => o.trim()).filter(Boolean) : [];

  let value: string;
  if (allowList.length === 0) {
    value = origin ?? "*"; // not restricted
  } else if (origin && allowList.includes(origin)) {
    value = origin; // echo back the matching allowed origin
  } else {
    value = allowList[0]; // unknown origin → don't grant it
  }

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

let avisouSemChave = false;

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
  // Sem chave o endpoint aceita lead de qualquer origem. Não recusamos (a LP em
  // produção quebraria e leads reais se perderiam); Ajustes mostra o alerta.
  if (!expectedKey && process.env.NODE_ENV === "production" && !avisouSemChave) {
    avisouSemChave = true;
    console.warn("[track] TRACK_INGEST_KEY não definida: /api/track aceita envios de qualquer origem.");
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
  const name = (body.name ?? "").trim() || "Lead sem nome";
  const email = (body.email ?? "").trim() || undefined;
  const phone = (body.phone ?? "").trim() || undefined;

  // O id sai do event_id: a mesma pessoa reenviando o formulário cai no MESMO
  // lead (reenvio), nunca num lead novo nem num lead zerado. Ver lib/lead-id.ts.
  const candidatos = new Map<string, Lead | null>();
  for (const id of candidatosIdLead(eventId)) candidatos.set(id, await getLead(id));
  const resolucao = resolverIdLead(
    eventId,
    { name, email, phone },
    (id) => candidatos.get(id),
    () => randomUUID().slice(0, 8),
  );
  let leadId = resolucao.id;

  // A mesma pessoa com OUTRO event_id (outro dia, outra LP, outro anúncio): o
  // contato identifica. Vira reenvio no lead que já existe — dois leads da mesma
  // pessoa contavam em dobro no custo por lead e caíam duas vezes na fila (D2).
  let jaCadastrado: Lead | undefined;
  if (resolucao.tipo !== "reenvio") {
    jaCadastrado = acharMesmaPessoa({ phone, email }, await listLeads(DEFAULT_BRAND), DEFAULT_BRAND);
    if (jaCadastrado) leadId = jaCadastrado.id;
  }

  // Envio de formulário é EVENTO (conta reenvios); lead é PESSOA.
  await bumpLpDaily(date, { formSubmits: 1 });
  const { created } = await addLead({
    id: leadId,
    brand: DEFAULT_BRAND,
    createdAt: new Date().toISOString(),
    name,
    email,
    phone,
    utmSource: attr.utm_source,
    utmCampaign: attr.utm_campaign,
    // utm_content carries the ad id — this is what ties the lead to a creative
    utmContent: attr.utm_content,
    // Antes descartados: o meio diz se é mídia paga (o gerador emitia
    // source=instagram + medium=paid_social) e o fbclid prova o clique.
    utmMedium: attr.utm_medium,
    utmTerm: attr.utm_term,
    fbclid: attr.fbclid,
    status: "lead",
    // kept so the later Schedule event can still be matched to this person
    fbc: body.fbc || attr.fbc,
    fbp: body.fbp,
    gaClientId: body.gaClientId,
    gaSessionId: body.gaSessionId,
  });

  // No reenvio, o contato que chegou diferente do gravado fica no histórico
  // (o lead não é sobrescrito — quem atende decide qual vale).
  const anterior = jaCadastrado ?? candidatos.get(leadId);
  const payload: Record<string, string> = {};
  if (!created && anterior) {
    if (phone && anterior.phone && !mesmoTelefone(phone, anterior.phone)) payload.telefoneNovo = phone;
    if (email && anterior.email && email.toLowerCase() !== anterior.email.toLowerCase()) payload.emailNovo = email;
  }
  if (jaCadastrado) {
    payload.pelo = phone && jaCadastrado.phone && mesmoTelefone(phone, jaCadastrado.phone) ? "telefone" : "e-mail";
    // O anúncio que trouxe a pessoa DE VOLTA (a origem gravada é a da 1ª entrada).
    if (attr.utm_content && attr.utm_content !== jaCadastrado.utmContent) payload.origemNova = attr.utm_content;
  } else if (resolucao.tipo === "colisao") {
    payload.idOcupado = resolucao.idOcupado;
  }

  await addLeadEvent({
    id: newEventId(),
    leadId,
    brand: DEFAULT_BRAND,
    leadName: name,
    actor: "Landing page",
    action: created ? "created" : "reenvio",
    toStatus: created ? "lead" : undefined,
    payload: Object.keys(payload).length ? payload : undefined,
    createdAt: new Date().toISOString(),
  });

  // Quem foi dado como perdido e preencheu o formulário DE NOVO (envio novo, não
  // o mesmo reenviado) quer conversa: volta para a fila como novo, com aviso.
  // O mesmo event_id reenviado (retentativa, relay) nunca reabre nada.
  if (!created && jaCadastrado && isLostStatus(jaCadastrado.status)) {
    await setLeadStatus(leadId, "lead", { lostAt: null, lostReasonDetail: null });
    await addLeadEvent({
      id: newEventId(),
      leadId,
      brand: DEFAULT_BRAND,
      leadName: jaCadastrado.name,
      actor: "Landing page",
      action: "reaberto",
      fromStatus: jaCadastrado.status,
      toStatus: "lead",
      payload: { motivo: "Preencheu o formulário de novo" },
      createdAt: new Date().toISOString(),
    });
    const voltou = await getLead(leadId);
    if (voltou) await avisarLeadNovo(voltou, "lead_voltou");
  }

  // Reenvio não é conversão nova: a Meta deduplicaria pelo event_id, mas o GA4
  // contaria duas vezes. Nada sai.
  if (!created) return NextResponse.json({ ok: true, leadId }, { headers });

  // Lead novo: avisa quem atende (n8n). Velocidade de contato é a alavanca nº 1.
  const novo = await getLead(leadId);
  if (novo) await avisarLeadNovo(novo);

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

  // O detalhe de CAPI/GA4 fica no log do servidor: a resposta vai para uma
  // página pública e não deve expor erro interno.
  if (!capi.sent || !ga4.sent) {
    console.info(`[track] lead ${leadId} · CAPI: ${capi.detail} · GA4: ${ga4.detail}`);
  }
  return NextResponse.json({ ok: true, leadId }, { headers });
}
