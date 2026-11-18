/**
 * Avisos de lead novo por Web Push — a parte PURA (sem I/O): o texto do aviso, a
 * leitura da inscrição que o navegador manda e o que fazer com a resposta do
 * serviço de push. O envio mora em `push/enviar.ts`; o navegador, em `public/sw.js`.
 *
 * LGPD: o aviso aparece na tela bloqueada. Leva só o PRIMEIRO nome, a classe e de
 * onde veio — nunca telefone, e-mail ou resposta da ficha. O resto está atrás do
 * login, no link. O conteúdo vai cifrado de ponta a ponta (o serviço de push do
 * Google, da Apple ou da Mozilla não lê).
 */
import { idCarregaTelefone } from "../lead-id";
import { classeDoLead } from "../qualificacao";
import type { Lead } from "../types";

export type EventoDoAviso = "lead_novo" | "lead_voltou";

/** O que o service worker mostra (`public/sw.js` lê exatamente estes campos). */
export interface AvisoPush {
  titulo: string;
  corpo: string;
  /** Caminho NO painel (relativo): a ficha; a Fila quando o id do lead carrega o telefone. */
  url: string;
  /** Um aviso por lead no aparelho: o 2º do mesmo lead troca o 1º em vez de empilhar. */
  tag: string;
}

/** Quanto tempo o serviço de push guarda o aviso de um aparelho desligado: depois, já não é "agora". */
export const VALIDADE_DO_AVISO_S = 2 * 3600;

const NOME_PADRAO = "Lead sem nome";

/** Primeiro nome, até 30 caracteres; `null` sem nome ("Lead sem nome" não é nome). */
export function primeiroNome(nome: string | undefined | null): string | null {
  const limpo = (nome ?? "").trim();
  if (!limpo || limpo === NOME_PADRAO) return null;
  const primeiro = limpo.split(/\s+/)[0];
  return primeiro.length > 30 ? `${primeiro.slice(0, 29)}…` : primeiro;
}

const maiuscula = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/**
 * O aviso de um lead. `robo` = o robô de WhatsApp está ligado para a marca
 * (`estadoDoRoboAgora(...).ligado`, quem chama passa): quem não é da live e não tem
 * classe recebe a 1ª mensagem dele, e o aviso diz isso — senão o comercial liga por
 * cima do robô.
 */
export function avisoDoLead(
  lead: Pick<Lead, "id" | "name" | "phone" | "createdAt" | "classe" | "classeN8n" | "inscritoLiveEm">,
  evento: EventoDoAviso,
  ctx: { robo: boolean },
): AvisoPush {
  const nome = primeiroNome(lead.name);
  const rotulo = evento === "lead_voltou" ? "Lead voltou" : "Lead novo";
  const partes: string[] = [];
  if (evento === "lead_voltou") partes.push("estava perdido e se inscreveu de novo");
  const classe = classeDoLead(lead);
  if (classe) partes.push(`classe ${classe}`);
  if (lead.inscritoLiveEm) partes.push("inscrição na live");
  // O robô só fala com quem tem telefone (sem ele, a pessoa vai direto ao Resgate).
  else if (ctx.robo && !classe && lead.phone) partes.push("o robô faz a 1ª mensagem");
  const comTelefone = idCarregaTelefone(lead.id);
  return {
    titulo: nome ? `${rotulo}: ${nome}` : rotulo,
    corpo: partes.length ? maiuscula(partes.join(" · ")) : "Toque para abrir a ficha",
    // O id do lead criado pelo n8n sem event_id carrega o WhatsApp: esse vai para a
    // Fila (nem na URL nem na tag do aparelho o número aparece).
    url: comTelefone ? "/fila" : `/leads/${encodeURIComponent(lead.id)}`,
    tag: comTelefone ? `lead:${lead.createdAt}` : `lead:${lead.id}`,
  };
}

/** O aviso que confirma, no próprio aparelho, que a inscrição funciona. */
export function avisoDeTeste(): AvisoPush {
  return {
    titulo: "Avisos de lead novo ligados",
    corpo: "Este aparelho vai receber cada lead novo na hora.",
    url: "/fila",
    tag: "teste",
  };
}

// ------------------------------------------------------------- inscrição

export interface InscricaoLida {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Os serviços de push dos navegadores (Chrome/Edge/Opera/Samsung → Google; Firefox →
 * Mozilla; Safari → Apple; Edge no Windows → WNS). O servidor faz POST no endpoint:
 * aceitar qualquer endereço deixaria quem está logado mandar o painel bater num
 * endereço interno (SSRF). Fora desta lista, a inscrição é recusada.
 */
export const SERVICOS_DE_PUSH = [".googleapis.com", ".mozilla.com", ".push.apple.com", ".notify.windows.com"] as const;

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** Do `PushSubscription.toJSON()` que o navegador manda; `erro` em português. */
export function lerInscricao(v: unknown): { ok: true; valor: InscricaoLida } | { ok: false; erro: string } {
  const o = (v && typeof v === "object" ? v : {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = typeof o.endpoint === "string" ? o.endpoint.trim() : "";
  if (!endpoint || endpoint.length > 2048) return { ok: false, erro: "Inscrição sem endereço do serviço de push." };
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, erro: "Endereço do serviço de push inválido." };
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port || !SERVICOS_DE_PUSH.some((s) => host.endsWith(s))) {
    return { ok: false, erro: "Serviço de push desconhecido." };
  }
  const p256dh = typeof o.keys?.p256dh === "string" ? o.keys.p256dh.trim() : "";
  const auth = typeof o.keys?.auth === "string" ? o.keys.auth.trim() : "";
  if (!BASE64URL.test(p256dh) || p256dh.length > 200 || !BASE64URL.test(auth) || auth.length > 100) {
    return { ok: false, erro: "Chaves da inscrição inválidas." };
  }
  return { ok: true, valor: { endpoint, p256dh, auth } };
}

/**
 * "Chrome · Android": só para a pessoa reconhecer o aparelho em Integrações. Nunca
 * o user-agent inteiro (versão e modelo não servem para nada aqui).
 */
export function aparelhoDoUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const navegador = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser\//.test(ua)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS\//.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;
  const sistema = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iPhone/iPad"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null;
  const r = [navegador, sistema].filter(Boolean).join(" · ");
  return r || null;
}

// ------------------------------------------------------------- resposta do serviço

/**
 * O serviço de push respondeu que a inscrição não existe mais (404/410: a pessoa
 * tirou a permissão, limpou o navegador, a inscrição expirou) → a linha sai. Todo o
 * resto (403, 429, 5xx, rede) fica: 403 costuma ser a chave VAPID ou o assunto
 * errados — erro NOSSO, que apagaria todos os aparelhos de uma vez.
 */
export function inscricaoMorta(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

/** O último envio, para Integrações: só contagens (nunca endpoint, usuário ou lead). */
export interface ResumoEnvioPush {
  em: string;
  evento: EventoDoAviso | "teste";
  /** Aparelhos que deviam receber (usuário que existe, com login ligado). */
  aparelhos: number;
  entregues: number;
  /** Inscrições que o serviço disse não existirem mais — apagadas. */
  removidas: number;
  falhas: number;
  /** A 1ª falha que não foi "não existe mais": status e mensagem curta. */
  erro?: string;
}
