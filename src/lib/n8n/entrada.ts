/**
 * O que o n8n manda, lido e conferido — puro. Nada é gravado sem passar por
 * aqui: campo com valor fora do vocabulário vira erro com o nome do campo (o
 * n8n vê o que mandou errado), nunca lixo no banco nem silêncio.
 *
 * As chaves do JSON são as do briefing, em snake_case (whatsapp, bem, valor,
 * finalidade, parcela, prazo, classe, aceite_mensagens, msg1_enviada_em…). Ver
 * docs/api-n8n.md. As respostas do formulário chegam com as MESMAS chaves quando
 * a página de inscrição manda direto ao painel (/api/track).
 */
import type { LeadFichaPatch } from "../data/backend";
import type { CanalContato } from "../contato";
import { normalizarTelefone } from "../phone";
import {
  BENS,
  CLASSES,
  FAIXAS_PARCELA,
  FAIXAS_VALOR,
  FINALIDADES,
  HORARIOS,
  PRAZOS_COMPRA,
  RESULTADOS_CONTATO,
  STATUS_REUNIAO,
  lerOpcao,
  lerSimNao,
  type Diagnostico,
  type ResultadoContato,
  type StatusReuniao,
} from "../qualificacao";

export type Lido<T> = { ok: true; valor: T } | { ok: false; erros: string[] };

type Corpo = Record<string, unknown>;

/** O WhatsApp como chave: só dígitos, com 55 e DDD (12 ou 13 dígitos). */
export function chaveWhatsapp(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = normalizarTelefone(String(v));
  return /^55\d{10,11}$/.test(d) ? d : null;
}

const texto = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

/** Instante ISO; `true` = agora (o n8n marca "aconteceu" sem relógio). */
function instante(v: unknown, campo: string, erros: string[], agora: string): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (v === true) return agora;
  if (typeof v !== "string") {
    erros.push(`${campo}: data inválida (use ISO 8601, ex. 2026-11-16T19:05:00-03:00).`);
    return undefined;
  }
  const t = Date.parse(v);
  if (!Number.isFinite(t)) {
    erros.push(`${campo}: data inválida (use ISO 8601, ex. 2026-11-16T19:05:00-03:00).`);
    return undefined;
  }
  // Um relógio adiantado no n8n não pode criar fato no futuro.
  if (t > Date.parse(agora) + 5 * 60_000 && !campo.startsWith("reuniao")) {
    erros.push(`${campo}: data no futuro.`);
    return undefined;
  }
  return new Date(t).toISOString();
}

/** Campo de vocabulário: ausente = não mexe; null/"" = limpa; fora do vocabulário = erro. */
function opcao<K extends string>(
  vocab: Record<K, string>,
  body: Corpo,
  chave: string,
  erros: string[],
): K | null | undefined {
  if (!(chave in body)) return undefined;
  const v = body[chave];
  if (v === null || v === "") return null;
  const k = lerOpcao(vocab, v);
  if (!k) erros.push(`${chave}: "${String(v).slice(0, 60)}" não é uma opção (${Object.values(vocab).join(" · ")}).`);
  return k ?? undefined;
}

/**
 * As respostas do formulário (as 5 perguntas, o aceite e o horário), que a página
 * e o n8n mandam igual. A classe NÃO está aqui: só o n8n manda a dele.
 */
export function lerRespostasDoFormulario(body: Corpo, erros: string[]): LeadFichaPatch {
  const p: LeadFichaPatch = {};
  const set = <K extends keyof LeadFichaPatch>(k: K, v: LeadFichaPatch[K] | undefined) => {
    if (v !== undefined) p[k] = v;
  };
  set("bem", opcao(BENS, body, "bem", erros));
  set("faixaValor", opcao(FAIXAS_VALOR, body, "valor", erros));
  set("finalidade", opcao(FINALIDADES, body, "finalidade", erros));
  set("faixaParcela", opcao(FAIXAS_PARCELA, body, "parcela", erros));
  set("prazoCompra", opcao(PRAZOS_COMPRA, body, "prazo", erros));
  set("horarioPreferido", opcao(HORARIOS, body, "horario_preferido", erros));
  if ("aceite_mensagens" in body) {
    const v = body.aceite_mensagens;
    const b = v === null || v === "" ? null : lerSimNao(v);
    if (b === undefined) erros.push("aceite_mensagens: use true/false (ou sim/não).");
    else p.aceiteMensagens = b;
  }
  return p;
}

/** Respostas do formulário e classe do n8n — comuns à inscrição e à atualização. */
function lerRespostas(body: Corpo, erros: string[]): LeadFichaPatch {
  const p = lerRespostasDoFormulario(body, erros);
  const classe = opcao(CLASSES, body, "classe", erros);
  if (classe !== undefined) p.classeN8n = classe;
  return p;
}

// ---------------------------------------------------------------- inscrição (POST)

export interface Inscricao {
  whatsapp: string;
  nome?: string;
  email?: string;
  /** O event_id da LP, quando o n8n repassa — o mesmo id do Pixel e do /api/track. */
  eventId?: string;
  /** Quando a pessoa se inscreveu; padrão: agora. Só vale para lead novo. */
  inscritoEm?: string;
  ficha: LeadFichaPatch;
  utm: { utmSource?: string; utmMedium?: string; utmCampaign?: string; utmTerm?: string; utmContent?: string };
}

export function lerInscricao(entrada: unknown, agora: string): Lido<Inscricao> {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) {
    return { ok: false, erros: ["O corpo precisa ser um objeto JSON."] };
  }
  const body = entrada as Corpo;
  const erros: string[] = [];
  const whatsapp = chaveWhatsapp(body.whatsapp);
  if (!whatsapp) erros.push("whatsapp: obrigatório, com DDD (ex. 11 99999-0000 ou 5511999990000).");
  const email = texto(body.email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) erros.push("email: formato inválido.");
  const ficha = lerRespostas(body, erros);
  const inscritoEm = instante(body.inscrito_em, "inscrito_em", erros, agora);
  const eventId = texto(body.event_id, 200);
  if (erros.length) return { ok: false, erros };
  return {
    ok: true,
    valor: {
      whatsapp: whatsapp!,
      nome: texto(body.nome, 200),
      email,
      eventId,
      inscritoEm,
      ficha,
      utm: {
        utmSource: texto(body.utm_source, 300),
        utmMedium: texto(body.utm_medium, 300),
        utmCampaign: texto(body.utm_campaign, 300),
        utmTerm: texto(body.utm_term, 300),
        utmContent: texto(body.utm_content, 300),
      },
    },
  };
}

// ---------------------------------------------------------------- atualização (PATCH)

export interface TentativaDoN8n {
  em?: string;
  canal: CanalContato;
  resultado: ResultadoContato;
  nota?: string;
}

export interface Atualizacao {
  ficha: LeadFichaPatch;
  tentativa?: TentativaDoN8n;
  reuniao?: { status?: StatusReuniao; em?: string };
  /** O único status que o n8n grava direto: "Sem resposta" (48 h sem contato válido). */
  semResposta?: boolean;
}

const CANAIS: Record<string, CanalContato> = {
  ligacao: "ligacao",
  telefone: "ligacao",
  whatsapp: "whatsapp",
  audio: "whatsapp",
  mensagem: "whatsapp",
  email: "email",
};

function lerDiagnostico(v: unknown, agora: string, erros: string[]): Diagnostico | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "object") {
    erros.push("diagnostico: envie { respostas: [...], perfil: \"...\" }.");
    return undefined;
  }
  const d = v as Record<string, unknown>;
  const bruto = Array.isArray(d.respostas)
    ? d.respostas
    : d.respostas && typeof d.respostas === "object"
      ? Object.entries(d.respostas as Record<string, unknown>).map(([pergunta, resposta]) => ({ pergunta, resposta }))
      : null;
  if (!bruto) {
    erros.push("diagnostico.respostas: envie a lista das respostas (texto ou { pergunta, resposta }).");
    return undefined;
  }
  const respostas = bruto
    .slice(0, 20)
    .map((r) => {
      if (typeof r === "string" || typeof r === "number") return { resposta: String(r).trim().slice(0, 1000) };
      if (r && typeof r === "object") {
        const o = r as Record<string, unknown>;
        return { pergunta: texto(o.pergunta, 300), resposta: String(o.resposta ?? "").trim().slice(0, 1000) };
      }
      return { resposta: "" };
    })
    .filter((r) => r.resposta);
  const feitoEm = instante(d.feito_em, "diagnostico.feito_em", erros, agora) ?? agora;
  // Os alertas do resultado: lista de textos ou um texto só (separado por vírgula).
  const brutos = Array.isArray(d.alertas) ? d.alertas : typeof d.alertas === "string" ? d.alertas.split(",") : [];
  const alertas = brutos
    .map((a) => (typeof a === "string" ? a.trim().slice(0, 200) : ""))
    .filter(Boolean)
    .slice(0, 10);
  return { respostas, perfil: texto(d.perfil, 500), ...(alertas.length ? { alertas } : {}), feitoEm };
}

export function lerAtualizacao(entrada: unknown, agora: string): Lido<Atualizacao> {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) {
    return { ok: false, erros: ["O corpo precisa ser um objeto JSON."] };
  }
  const body = entrada as Corpo;
  const erros: string[] = [];
  const ficha = lerRespostas(body, erros);

  const msg1 = instante(body.msg1_enviada_em, "msg1_enviada_em", erros, agora);
  if (msg1) ficha.msg1EnviadaEm = msg1;
  if ("msg1_status" in body) ficha.msg1Status = body.msg1_status === null ? null : texto(body.msg1_status, 40)?.toLowerCase();
  const aviso = instante(body.eduardo_avisado_em ?? body.atendimento_avisado_em, "eduardo_avisado_em", erros, agora);
  if (aviso) ficha.atendimentoAvisadoEm = aviso;
  const escalado = instante(body.escalado_em, "escalado_em", erros, agora);
  if (escalado) ficha.escaladoEm = escalado;
  if ("clicou_comunidade" in body || "comunidade_em" in body) {
    const clicou = "clicou_comunidade" in body ? lerSimNao(body.clicou_comunidade) : true;
    if (clicou === undefined) erros.push("clicou_comunidade: use true/false.");
    else if (clicou) ficha.comunidadeEm = instante(body.comunidade_em, "comunidade_em", erros, agora) ?? agora;
  }
  const diag = lerDiagnostico(body.diagnostico, agora, erros);
  if (diag !== undefined) ficha.diagnostico = diag;

  const out: Atualizacao = { ficha };

  if (body.tentativa !== undefined) {
    const t = (body.tentativa && typeof body.tentativa === "object" ? body.tentativa : {}) as Corpo;
    const resultado = lerOpcao(RESULTADOS_CONTATO, t.resultado);
    if (!resultado) erros.push(`tentativa.resultado: use ${Object.values(RESULTADOS_CONTATO).join(" · ")}.`);
    const canalChave = String(t.canal ?? "ligacao")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();
    const canal = CANAIS[canalChave];
    if (!canal) erros.push("tentativa.canal: use ligacao, whatsapp (ou audio) ou email.");
    const em = instante(t.em, "tentativa.em", erros, agora);
    if (resultado && canal) out.tentativa = { em, canal, resultado, nota: texto(t.notas ?? t.nota, 2000) };
  }

  if (body.reuniao_status !== undefined || body.reuniao_em !== undefined) {
    const status = body.reuniao_status === undefined ? undefined : lerOpcao(STATUS_REUNIAO, body.reuniao_status);
    if (body.reuniao_status !== undefined && !status) {
      erros.push(`reuniao_status: use ${Object.values(STATUS_REUNIAO).join(" · ")}.`);
    }
    const em = instante(body.reuniao_em, "reuniao_em", erros, agora);
    out.reuniao = { status: status ?? (em ? "agendada" : undefined), em };
    if (out.reuniao.status === "agendada" && !em) erros.push("reuniao_em: obrigatória para agendar.");
  }

  if (body.status !== undefined) {
    const s = String(body.status)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[\s_-]+/g, " ")
      .trim();
    if (s === "sem resposta") out.semResposta = true;
    else erros.push('status: pela API só se grava "Sem resposta"; os outros saem da tentativa e da reunião.');
  }

  if (erros.length) return { ok: false, erros };
  return { ok: true, valor: out };
}
