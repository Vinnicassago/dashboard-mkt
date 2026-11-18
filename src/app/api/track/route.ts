import { NextResponse, after } from "next/server";
import { randomUUID } from "node:crypto";
import {
  addLead,
  addLeadEvent,
  bumpLpDaily,
  comTravaDaPessoa,
  getLead,
  listDiagnosticos,
  listLeadEvents,
  listLeads,
  registrarCliqueComunidade,
  registrarDiagnostico,
  setLeadStatus,
} from "@/lib/data/store";
import { DEFAULT_BRAND, type Lead } from "@/lib/types";
import { candidatosIdLead, resolverIdLead } from "@/lib/lead-id";
import {
  ATOR_DIAGNOSTICO,
  ATOR_OBRIGADO,
  CORPO_MAX_BYTES,
  diagnosticoParaAFicha,
  fichaAceitaDiagnosticoDaPagina,
  indiceDeEventIds,
  leadDoEventId,
  leadDoTelefone,
  lerEventoComunidade,
  lerEventoDiagnostico,
  maisAvancada,
} from "@/lib/diagnostico-live";
import { campanhaDaLive } from "@/lib/live-server";
import { mesmoTelefone, normalizarTelefone } from "@/lib/phone";
import { MESMA_INSCRICAO_MIN, pessoaDoWhatsapp } from "@/lib/n8n/servico";
import { lerRespostasDoFormulario } from "@/lib/n8n/entrada";
import { comClasse } from "@/lib/classe-server";
import { gravarFicha } from "@/lib/leads/gravar-ficha";
import { payloadDaReinscricao, registrarInscricaoNaLive } from "@/lib/leads/inscricao-live";
import { tocadoHaPouco, ultimaEntrada } from "@/lib/live";
import type { LeadFichaPatch } from "@/lib/data/backend";
import { acharMesmaPessoa } from "@/lib/identidade";
import { idsDoUtm } from "@/lib/atribuicao";
import { isLostStatus } from "@/lib/lead-status";
import { newEventId } from "@/lib/auth/actor";
import { avisarLeadNovo } from "@/lib/avisos";
import { estadoDoRoboAgora } from "@/lib/robo/estado";
import { enviarParaMeta, reenviarPendentes } from "@/lib/meta/capi-envios";
import { sendGa4Event } from "@/lib/ga4/measurement-protocol";
import { hojeEmBrasilia } from "@/lib/range";

/**
 * O robô está ligado para a marca do lead (`estadoDoRoboAgora`, a função única)?
 * Vai no aviso de lead novo (11.13). Nunca derruba a entrada: na dúvida, desligado.
 */
async function roboNoAviso(brand: string): Promise<boolean> {
  if (!process.env.N8N_LEAD_WEBHOOK_URL?.trim()) return false; // sem aviso, nada a perguntar
  try {
    return (await estadoDoRoboAgora(brand)).ligado;
  } catch (e) {
    console.warn("[track] não consegui ler o estado do robô para o aviso:", e instanceof Error ? e.message : e);
    return false;
  }
}

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

/**
 * `comunidade` (página de obrigado, pelo eventId do lead) e `diagnostico` (a
 * página do diagnóstico, por tentativa) entraram em nov/26 — ver
 * `lib/diagnostico-live.ts` e o README. Os três de antes não mudaram.
 */
type EventType = "page_view" | "cta_click" | "lead" | "comunidade" | "diagnostico";

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
  // As respostas do formulário da live (as mesmas chaves da API do n8n).
  bem?: unknown;
  valor?: unknown;
  finalidade?: unknown;
  parcela?: unknown;
  prazo?: unknown;
  aceite_mensagens?: unknown;
  horario_preferido?: unknown;
}

/**
 * As respostas que a página mandou. Da página, vazio é "não respondeu", nunca
 * "apague" (no n8n, null limpa). Resposta fora do vocabulário é ignorada: o lead
 * nunca se perde por causa dela, e o log leva só o nome do campo.
 */
function respostasDaPagina(body: TrackBody): LeadFichaPatch {
  const erros: string[] = [];
  const lidas = lerRespostasDoFormulario(body as unknown as Record<string, unknown>, erros);
  if (erros.length) console.warn("[track] respostas ignoradas:", erros.map((e) => e.split(":")[0]).join(", "));
  return Object.fromEntries(Object.entries(lidas).filter(([, v]) => v !== null)) as LeadFichaPatch;
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

/**
 * O erro de uma gravação que não derruba a resposta, no log SEM dado da pessoa:
 * só o código (pg) ou o tipo do erro — a mensagem do banco pode citar valores.
 */
const semDado = (e: unknown) => (e as { code?: string })?.code ?? (e instanceof Error ? e.name : "erro");

/**
 * O lead de um clique em "Entrar na comunidade": o da entrada pela página com
 * esse eventId (o `payload.eventId` do `created`/`reenvio` — quem já era lead
 * cai no cadastro antigo), senão o id que o eventId gera. Nunca lança.
 */
async function leadDoClique(eventId: string): Promise<Lead | undefined> {
  try {
    const [leads, ...eventos] = await Promise.all([
      listLeads(DEFAULT_BRAND),
      listLeadEvents({ brand: DEFAULT_BRAND, action: "created", limit: 0 }),
      listLeadEvents({ brand: DEFAULT_BRAND, action: "reenvio", limit: 0 }),
      listLeadEvents({ brand: DEFAULT_BRAND, action: "mesclado", limit: 0 }),
    ]);
    return leadDoEventId(eventId, new Map(leads.map((l) => [l.id, l])), indiceDeEventIds(eventos.flat()));
  } catch (e) {
    console.warn("[track] comunidade: não consegui procurar o lead:", semDado(e));
    return undefined;
  }
}

/**
 * Ao concluir, a tentativa mais avançada do número vai para a ficha do lead
 * (`lead.diagnostico`, o formato que o n8n mandava): o painel da live conta os
 * diagnósticos, a linha da véspera lê o perfil e o n8n recebe no GET da ficha. O
 * que o n8n gravou não é apagado (`fichaAceitaDiagnosticoDaPagina`). Nunca lança:
 * a tentativa já está gravada e a tela de Leads a liga ao lead na leitura.
 */
async function diagnosticoNaFicha(telefone: string, chave: string | null): Promise<void> {
  if (!chave) return;
  try {
    const [leads, cfg, doNumero] = await Promise.all([
      listLeads(DEFAULT_BRAND),
      campanhaDaLive(),
      listDiagnosticos({ chaveTelefone: chave }),
    ]);
    const lead = leadDoTelefone(telefone, leads, cfg);
    const melhor = maisAvancada(doNumero);
    if (!lead || !melhor?.concluidoEm || !fichaAceitaDiagnosticoDaPagina(lead.diagnostico)) return;
    await gravarFicha(lead, { diagnostico: diagnosticoParaAFicha(melhor) }, ATOR_DIAGNOSTICO);
  } catch (e) {
    console.warn("[track] diagnóstico: não gravei na ficha:", semDado(e));
  }
}

/**
 * O dia do `lp_daily` (visitas, cliques, envios): o de Brasília, o mesmo
 * calendário do lead (`diaDoLead`) — senão o envio das 22h caía num dia e o lead
 * no outro, e "envios → leads" divergia nas bordas. Vale a partir de 05/11/2026;
 * o histórico anterior ficou no dia UTC (contador não se redistribui).
 */
function today(): string {
  return hojeEmBrasilia();
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
  const texto = await request.text();
  try {
    body = JSON.parse(texto) as TrackBody;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("não é objeto");
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400, headers });
  }

  const expectedKey = process.env.TRACK_INGEST_KEY?.trim();
  if (expectedKey && body.ingestKey !== expectedKey) {
    return NextResponse.json({ error: "Chave inválida." }, { status: 401, headers });
  }
  // Sem chave o endpoint aceita lead de qualquer origem. Não recusamos (a LP em
  // produção quebraria e leads reais se perderiam); Configurações mostra o alerta.
  if (!expectedKey && process.env.NODE_ENV === "production" && !avisouSemChave) {
    avisouSemChave = true;
    console.warn("[track] TRACK_INGEST_KEY não definida: /api/track aceita envios de qualquer origem.");
  }

  const type = body.type;
  if (
    type !== "page_view" &&
    type !== "cta_click" &&
    type !== "lead" &&
    type !== "comunidade" &&
    type !== "diagnostico"
  ) {
    return NextResponse.json({ error: "Tipo de evento inválido." }, { status: 400, headers });
  }

  // ---- os tipos novos (nov/26): conferidos inteiros antes de gravar qualquer coisa ----
  if (type === "comunidade" || type === "diagnostico") {
    if (texto.length > CORPO_MAX_BYTES) {
      return NextResponse.json({ error: "Evento grande demais." }, { status: 413, headers });
    }
    const corpo = body as unknown as Record<string, unknown>;
    // A hora que vale é a que o evento CHEGOU ao servidor (nunca um relógio da página).
    const em = new Date().toISOString();

    if (type === "comunidade") {
      const lido = lerEventoComunidade(corpo);
      if (!lido.ok) return NextResponse.json({ error: "Evento inválido.", erros: lido.erros }, { status: 400, headers });
      const lead = await leadDoClique(lido.valor.eventId);
      await registrarCliqueComunidade({ ...lido.valor, leadId: lead?.id, em });
      // O 1º clique é o fato da ficha (o mesmo `clicou_comunidade` do n8n): o painel da
      // live conta "Na comunidade" e a Meta recebe `EntrouNaComunidade` (CAPI).
      if (lead && !lead.comunidadeEm) {
        await gravarFicha(lead, { comunidadeEm: em }, ATOR_OBRIGADO).catch((e) =>
          console.warn("[track] comunidade: não gravei na ficha:", semDado(e)),
        );
      }
      return new NextResponse(null, { status: 204, headers });
    }

    const lido = lerEventoDiagnostico(corpo);
    if (!lido.ok) return NextResponse.json({ error: "Evento inválido.", erros: lido.erros }, { status: 400, headers });
    const tentativa = await registrarDiagnostico(lido.valor, em);
    if (lido.valor.etapa === "resultado") await diagnosticoNaFicha(tentativa.telefone, tentativa.chaveTelefone);
    return new NextResponse(null, { status: 204, headers });
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
  const respostas = respostasDaPagina(body);
  // Com as respostas, é a página da live: uma inscrição na live (o cadastro novo
  // nasce com ela; quem já era lead ganha a data desta, sem mexer na entrada).
  const inscricaoNaLive = Object.keys(respostas).length > 0;

  // A identificação e a gravação rodam na TRAVA DA PESSOA (telefone, senão
  // e-mail): a página manda o mesmo cadastro ao painel e ao n8n ao mesmo tempo, e
  // o n8n grava a ficha pela API — sem a trava, os dois criavam dois leads.
  const chaveDaPessoa = (phone && normalizarTelefone(phone)) || email?.toLowerCase() || eventId;
  const { leadId, created } = await comTravaDaPessoa(chaveDaPessoa, async () => {
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
      const todos = await listLeads(DEFAULT_BRAND);
      jaCadastrado = acharMesmaPessoa({ phone, email }, todos, DEFAULT_BRAND);
      // A inscrição na live com dois cadastros do número: o que o n8n acabou de inscrever (a
      // mesma inscrição), senão a MESMA escolha do n8n (`pessoaDoWhatsapp`: o inscrito na live,
      // senão o principal da mesclagem) — cada caminho marcando um contaria a pessoa duas vezes.
      if (jaCadastrado && inscricaoNaLive && phone) {
        const doNumero = todos.filter((l) => !l.deletedAt && l.phone && mesmoTelefone(l.phone, phone));
        jaCadastrado =
          tocadoHaPouco(doNumero, Date.now(), MESMA_INSCRICAO_MIN * 60_000) ?? pessoaDoWhatsapp(phone, todos) ?? jaCadastrado;
      }
      if (jaCadastrado) leadId = jaCadastrado.id;
    }

    // Envio de formulário é EVENTO (conta reenvios); lead é PESSOA.
    await bumpLpDaily(date, { formSubmits: 1 });
    const agora = new Date().toISOString();
    const { created } = await addLead({
      id: leadId,
      brand: DEFAULT_BRAND,
      createdAt: agora,
      inscritoLiveEm: inscricaoNaLive ? agora : undefined,
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
      // Os ids que o UTM padrão traz ({{campaign.id}}, {{adset.id}}, {{ad.id}}):
      // guardados resolvidos, para a atribuição não depender de nome (D6).
      ...idsDoUtm(attr),
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
    // Quem já era lead e se inscreveu na live: a data desta inscrição (a 1ª do período vale).
    // Só com o WhatsApp do cadastro: achado pelo e-mail com OUTRO número, a pessoa da live é
    // a desse número (o n8n cria por ele) — marcar os dois contaria a pessoa duas vezes.
    const mesmoWhatsapp = !phone || !anterior?.phone || mesmoTelefone(phone, anterior.phone);
    const live = !created && inscricaoNaLive && mesmoWhatsapp ? await registrarInscricaoNaLive(leadId, agora) : null;
    // O eventId da entrada: é por ele que o clique na comunidade (página de obrigado) acha
    // a pessoa — também quando o reenvio caiu num cadastro antigo, de outro id.
    const payload: Record<string, string> = { eventId };
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
    // O mesmo cadastro que o n8n (ou um clique duplo) gravou há pouco: não é um reenvio do formulário.
    const mesmaInscricao =
      !created && anterior && Date.now() - Date.parse(ultimaEntrada(anterior)) < MESMA_INSCRICAO_MIN * 60_000;
    if (mesmaInscricao) payload.mesmaInscricao = "sim";
    else if (live?.marcou && anterior) Object.assign(payload, payloadDaReinscricao(live.cfg, anterior.createdAt));

    await addLeadEvent({
      id: newEventId(),
      leadId,
      brand: DEFAULT_BRAND,
      leadName: name,
      actor: "Landing page",
      action: created ? "created" : "reenvio",
      toStatus: created ? "lead" : undefined,
      payload,
      createdAt: new Date().toISOString(),
    });

    // Quem foi dado como perdido e preencheu o formulário DE NOVO (envio novo, não
    // o mesmo reenviado) quer conversa: volta para a fila como novo, com aviso.
    // O mesmo event_id reenviado (retentativa, relay) nunca reabre nada.
    if (!created && !mesmaInscricao && jaCadastrado && isLostStatus(jaCadastrado.status)) {
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
      if (voltou) await avisarLeadNovo(voltou, "lead_voltou", { robo: await roboNoAviso(voltou.brand) });
    }

    // A página da live manda as 5 respostas: o painel classifica na entrada, sem
    // esperar o n8n (o mesmo caminho da ficha: histórico e classe do painel).
    if (Object.keys(respostas).length) {
      const atual = await getLead(leadId);
      if (atual) await gravarFicha(atual, await comClasse(atual, respostas), "Landing page");
    }
    return { leadId, created };
  });

  // Reenvio não é conversão nova: a Meta deduplicaria pelo event_id, mas o GA4
  // contaria duas vezes. Nada sai.
  if (!created) return NextResponse.json({ ok: true, leadId }, { headers });

  // Lead novo: avisa quem atende (n8n). Velocidade de contato é a alavanca nº 1.
  const novo = await getLead(leadId);
  if (novo) await avisarLeadNovo(novo, "lead_novo", { robo: await roboNoAviso(novo.brand) });

  // The user agent of THIS request is the visitor's browser (the landing page
  // posts directly), which is exactly what CAPI requires.
  const userAgent = request.headers.get("user-agent") ?? undefined;

  const [capi, ga4] = await Promise.all([
    // Pela caixa de saída: gravado antes de postar, com nova tentativa automática.
    enviarParaMeta({
      brand: DEFAULT_BRAND,
      leadId,
      eventName: "Lead",
      eventId,
      eventTime: new Date().toISOString(),
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
  if (capi.estado !== "enviado" || !ga4.sent) {
    console.info(`[track] lead ${leadId} · CAPI: ${capi.estado} · GA4: ${ga4.detail}`);
  }
  // De carona, depois da resposta: o que ficou pendente na fila da CAPI tenta de
  // novo (o cron de /api/capi/retentar é a garantia; isto só adianta).
  after(() =>
    reenviarPendentes({ limit: 10 }).catch((e) => console.warn("[track] reenvio da CAPI falhou:", e)),
  );
  return NextResponse.json({ ok: true, leadId }, { headers });
}
