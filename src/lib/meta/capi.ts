import "server-only";
import { createHash } from "node:crypto";
import { GRAPH_FB, capiToken, capiTestEventCode, datasetId } from "./config";
import type { CapiEventName } from "../types";

export type { CapiEventName } from "../types";

/**
 * Meta Conversions API (eventos pelo servidor).
 *
 * Por que existe: o Pixel do navegador perde parte das conversões para
 * bloqueador e iOS (ATT). O mesmo evento enviado pelo servidor recupera esse
 * sinal — e, como os dois levam o MESMO `event_id` (e o mesmo `event_name`), a
 * Meta deduplica em vez de contar duas vezes (janela de 48 h).
 *
 * Duas partes, de propósito: `montarEventoCapi` (pura: hash e formato) e
 * `postarEventoCapi` (a chamada). Quem envia de verdade é a caixa de saída
 * (`capi-envios.ts`): grava o evento montado ANTES de postar, para a nova
 * tentativa reenviar exatamente o mesmo evento — mesmo `event_time`, mesmo id.
 *
 * Regras (CLAUDE.md): PII em SHA-256 depois de normalizar (sem remover
 * acentos); `fbc`, `fbp`, IP e navegador vão CRUS — o hash quebra o pareamento;
 * o token vai na QUERY; `test_event_code` no nível de cima, ao lado de `data`.
 */

export interface CapiUser {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  /** Cookie de clique do Facebook (_fbc) — nunca em hash. */
  fbc?: string;
  /** Cookie de navegador do Facebook (_fbp) — nunca em hash. */
  fbp?: string;
  ip?: string;
  userAgent?: string;
  externalId?: string;
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** A Meta pede minúsculas e sem espaço nas pontas antes do hash. */
export function hashTexto(v?: string): string | undefined {
  const clean = (v ?? "").trim().toLowerCase();
  return clean ? sha256(clean) : undefined;
}

/**
 * Telefone: só dígitos, COM o código do país, sem "+", separadores nem zeros à
 * esquerda. Número brasileiro digitado sem o 55 (10 ou 11 dígitos) ganha o 55.
 */
export function hashTelefone(v?: string): string | undefined {
  let digits = (v ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return undefined;
  if (digits.length >= 10 && digits.length <= 11) digits = `55${digits}`;
  return sha256(digits);
}

/** "website" para o que sai da landing page; "system_generated" para o que o painel registra. */
export type CapiActionSource = "website" | "system_generated" | "phone_call" | "chat" | "other";

/** O evento como a Meta o recebe dentro de `data` — já com a PII em hash. */
export type EventoCapi = Record<string, unknown>;

/**
 * Monta UM evento. Pura (sem rede): o mesmo pedido dá o mesmo evento, e é ele
 * que fica guardado na caixa de saída até sair.
 */
export function montarEventoCapi({
  eventName,
  eventId,
  eventTime,
  eventSourceUrl,
  user,
  customData,
  actionSource = "website",
}: {
  eventName: CapiEventName;
  /** TEM de ser o `eventID` do navegador (e o mesmo `event_name`) para deduplicar. */
  eventId: string;
  /** Quando o fato aconteceu (ISO). Vai em segundos — a Meta recusa mais de 7 dias. */
  eventTime: string;
  /** Obrigatório em evento "website" — sem ele a Meta pode descartar. */
  eventSourceUrl?: string;
  user: CapiUser;
  customData?: Record<string, unknown>;
  actionSource?: CapiActionSource;
}): EventoCapi {
  const userData: Record<string, unknown> = {};
  const em = hashTexto(user.email);
  const ph = hashTelefone(user.phone);
  const fn = hashTexto(user.firstName);
  const ln = hashTexto(user.lastName);
  const externalId = hashTexto(user.externalId);
  if (em) userData.em = [em];
  if (ph) userData.ph = [ph];
  if (fn) userData.fn = [fn];
  if (ln) userData.ln = [ln];
  if (externalId) userData.external_id = [externalId];
  // crus de propósito — em hash, a Meta não pareia
  if (user.fbc) userData.fbc = user.fbc;
  if (user.fbp) userData.fbp = user.fbp;
  if (user.ip) userData.client_ip_address = user.ip;
  if (user.userAgent) userData.client_user_agent = user.userAgent;

  return {
    event_name: eventName,
    // segundos, não milissegundos
    event_time: Math.floor(Date.parse(eventTime) / 1000),
    event_id: eventId,
    action_source: actionSource, // enum fechado; obrigatório em todo evento
    ...(eventSourceUrl ? { event_source_url: eventSourceUrl } : {}),
    user_data: userData,
    ...(customData ? { custom_data: customData } : {}),
  };
}

/** A CAPI tem dataset e token? Sem os dois, nada é enfileirado. */
export function capiConfigurada(): boolean {
  return Boolean(datasetId() && capiToken());
}

/** Há `META_CAPI_TEST_EVENT_CODE`: tudo que sai é evento de TESTE para a Meta. */
export function capiEmModoTeste(): boolean {
  return Boolean(capiTestEventCode());
}

/** Tempo máximo de uma chamada à Meta. */
const TEMPO_LIMITE_MS = 20_000;

export interface RespostaCapi {
  ok: boolean;
  /** O erro técnico (para o log) — a tela recebe `mensagemDoErroCapi`. */
  detalhe: string;
  recebidos?: number;
  fbtraceId?: string;
  /** Saiu com `test_event_code`. */
  teste: boolean;
  /** Resposta HTTP, quando houve (0 = sem resposta: rede). */
  http: number;
  /** Código de erro da Meta (190 = token, 100 = parâmetro…), quando veio. */
  codigo?: number;
  /** Subcódigo (33 = objeto inexistente ou sem permissão; 2804xxx = validação do evento). */
  subcodigo?: number;
}

interface CorpoDaMeta {
  events_received?: number;
  messages?: string[];
  fbtrace_id?: string;
  error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
}

/**
 * Posta UM evento já montado. Não grava nada — quem grava é a caixa de saída.
 * `modoTeste` é o modo em que o evento ENTROU na fila: um evento real nunca sai
 * com `test_event_code` (mesmo que a variável tenha sido ligada depois), e um de
 * teste nunca sai sem ele. Ausente = o modo atual.
 */
export async function postarEventoCapi(
  evento: EventoCapi,
  { buscar = fetch, modoTeste = capiEmModoTeste() }: { buscar?: typeof fetch; modoTeste?: boolean } = {},
): Promise<RespostaCapi> {
  const dataset = datasetId();
  const token = capiToken();
  const testCode = modoTeste ? capiTestEventCode() : undefined;
  const teste = Boolean(testCode);
  if (!dataset || !token) return { ok: false, detalhe: "CAPI não configurado", teste, http: 0 };
  if (modoTeste && !testCode) {
    return { ok: false, detalhe: "Evento de teste sem META_CAPI_TEST_EVENT_CODE", teste: true, http: 0 };
  }

  const body: Record<string, unknown> = { data: [evento] };
  // test_event_code mora no NÍVEL DE CIMA, ao lado de `data` — não dentro dele.
  if (testCode) body.test_event_code = testCode;

  try {
    // O token vai na query string, não no corpo JSON.
    const url = `${GRAPH_FB}/${dataset}/events?access_token=${encodeURIComponent(token)}`;
    const res = await buscar(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      // Bem abaixo da reserva da linha (2 min): uma chamada pendurada não deixa
      // a reserva vencer com o POST ainda no ar.
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    const json = (await res.json().catch(() => ({}))) as CorpoDaMeta;
    if (!res.ok || json.error) {
      return {
        ok: false,
        detalhe: json.error?.message ?? `HTTP ${res.status}`,
        fbtraceId: json.error?.fbtrace_id ?? json.fbtrace_id,
        teste,
        http: res.status,
        codigo: json.error?.code,
        subcodigo: json.error?.error_subcode,
      };
    }
    return {
      ok: true,
      detalhe: `${json.events_received ?? 1} evento(s) recebido(s) pela Meta`,
      recebidos: json.events_received,
      fbtraceId: json.fbtrace_id,
      teste,
      http: res.status,
    };
  } catch (e) {
    return { ok: false, detalhe: e instanceof Error ? e.message : String(e), teste, http: 0 };
  }
}
