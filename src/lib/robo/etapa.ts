/**
 * A linha do robô de WhatsApp e a etapa em que a pessoa está — PURO, sem I/O.
 *
 * O sync (`lib/robo/sync.ts`) lê a tabela "Leads WhatsApp" do banco do robô com
 * uma lista EXPLÍCITA de colunas (`lib/robo/client.ts`) e entrega aqui a linha já
 * normalizada: nada de nome, e-mail, briefing, transcrição ou resumo (LGPD). O
 * telefone só serve para casar com o lead do painel e nunca é gravado nem logado.
 *
 * A etapa replica o CASE da view `vw_robo_leads`, com duas correções: quem o robô
 * ainda não saudou (turno 0 sem `saudacao_em`) é "sem mensagem" — a view chamava
 * de "não respondeu", misturando "o robô não mandou" com "a pessoa não respondeu"
 * —, e "Telefone sem WhatsApp" e opt-out vêm antes de tudo (a view os ignora).
 */

/** O robô começou em 29/10/2026 — dia em Brasília (`diaBrt`), não ISO em UTC. */
export const ROBO_INICIO = "2026-10-29";

/** O status com que o robô marca o número que não tem WhatsApp. */
export const STATUS_SEM_WHATSAPP = "Telefone sem WhatsApp";

/** Etapas do robô — união FECHADA (o mapper do lead descarta o que estiver fora). */
export const ROBO_ETAPAS = [
  "sem_mensagem",
  "nao_respondeu",
  "em_conversa",
  "convite_pendente",
  "transferido",
  "declinou",
  "frio",
  "sem_whatsapp",
  "opt_out",
] as const;

export type RoboEtapa = (typeof ROBO_ETAPAS)[number];

/** A etapa em palavras — o título do card do robô na ficha e o texto de Leads. */
export const ROBO_ETAPA_LABEL: Record<RoboEtapa, string> = {
  sem_mensagem: "sem a 1ª mensagem",
  nao_respondeu: "esperando resposta",
  em_conversa: "em conversa",
  convite_pendente: "convite enviado",
  transferido: "aceitou o convite",
  declinou: "recusou o convite",
  frio: "encerrado",
  sem_whatsapp: "sem WhatsApp",
  opt_out: "pediu para não receber mensagens",
};

/** Lê uma etapa gravada (texto do banco); valor fora da lista vira `undefined`. */
export function lerRoboEtapa(v: unknown): RoboEtapa | undefined {
  return typeof v === "string" && (ROBO_ETAPAS as readonly string[]).includes(v) ? (v as RoboEtapa) : undefined;
}

/**
 * Uma linha de "Leads WhatsApp", só com as colunas que o painel lê, já
 * normalizada (datas em ISO de `toISOString`, números e booleanos de verdade).
 */
export interface LinhaRobo {
  sessionId: string;
  /** Só para casar com o lead; nunca gravado, nunca logado. */
  telefone: string | null;
  status: string | null;
  statusAtendimento: string | null;
  turno: number | null;
  conviteEnviado: boolean | null;
  conviteEnviadoEm: string | null;
  transferidoEm: string | null;
  criadoEm: string | null;
  ultimaInteracao: string | null;
  saudacaoEm: string | null;
  ultimaMsgClienteEm: string | null;
  followupsEnviados: number | null;
  ultimoFollowupEm: string | null;
  roboEncerradoEm: string | null;
  optOut: boolean | null;
  optOutEm: string | null;
  botPausado: boolean | null;
}

/** Texto sem acento, minúsculo e sem espaço nas pontas (para comparar status). */
function chave(v: string | null | undefined): string {
  return (v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Valores EXATOS de `status_atendimento`, lidos no banco do robô em 04/11/2026:
 * qualificando · aguardando_autorizacao · transferido · frio. O CASE da view
 * `vw_robo_leads` (pg_get_viewdef, mesma data) compara com igualdade:
 *   turno = 0 → nao_respondeu · status_atendimento = 'transferido' → transferido ·
 *   'frio' AND convite_enviado → declinou · 'frio' → frio · convite_enviado →
 *   convite_pendente · senão em_conversa.
 * `status` só tem "Lead capturado landing page" e "Telefone sem WhatsApp".
 */
const ATENDIMENTO_TRANSFERIDO = "transferido";
const ATENDIMENTO_FRIO = "frio";

function atendimentoE(l: Pick<LinhaRobo, "statusAtendimento">, valor: string): boolean {
  return chave(l.statusAtendimento) === valor;
}

/** O número não tem WhatsApp (o robô não tem como falar). */
export function semWhatsapp(l: Pick<LinhaRobo, "status">): boolean {
  return chave(l.status) === chave(STATUS_SEM_WHATSAPP);
}

/**
 * Aceitou o convite (recebeu o link do Calendly): `transferido_em` ou
 * `status_atendimento = 'transferido'`. Predicado ÚNICO: a etapa ("transferido"),
 * o fato `roboAceitouEm` e a contagem `transferidosSemLead` leem daqui — senão quem
 * tem só o status ficaria "transferido" sem a data e fora da contagem.
 */
export function aceitouConvite(l: Pick<LinhaRobo, "transferidoEm" | "status" | "statusAtendimento">): boolean {
  return Boolean(l.transferidoEm) || atendimentoE(l, ATENDIMENTO_TRANSFERIDO);
}

/** Recebeu o convite: a flag ou a data. Predicado ÚNICO da etapa e do fato `roboConviteEm`. */
export function recebeuConvite(l: Pick<LinhaRobo, "conviteEnviado" | "conviteEnviadoEm">): boolean {
  return l.conviteEnviado === true || Boolean(l.conviteEnviadoEm);
}

/**
 * A etapa da pessoa no robô, nesta ordem:
 *  1. "Telefone sem WhatsApp" → sem_whatsapp;
 *  2. opt-out → opt_out;
 *  3. turno 0: sem `saudacao_em` → sem_mensagem (o robô ainda não mandou), senão
 *     nao_respondeu;
 *  4. aceitou o convite (`aceitouConvite`) → transferido;
 *  5. frio com convite → declinou; frio → frio;
 *  6. convite enviado (`recebeuConvite`) → convite_pendente;
 *  7. senão → em_conversa.
 *
 * Turno nulo conta como 0 só enquanto a pessoa não mandou mensagem nenhuma (o
 * CASE em SQL deixaria `null = 0` cair em "em conversa" — quem nem foi saudado).
 */
export function etapaDoRobo(l: LinhaRobo): RoboEtapa {
  if (semWhatsapp(l)) return "sem_whatsapp";
  if (l.optOut === true || l.optOutEm) return "opt_out";
  const turnoZero = l.turno == null ? !l.ultimaMsgClienteEm : l.turno <= 0;
  if (turnoZero) return l.saudacaoEm ? "nao_respondeu" : "sem_mensagem";
  if (aceitouConvite(l)) return "transferido";
  const convite = recebeuConvite(l);
  if (atendimentoE(l, ATENDIMENTO_FRIO)) return convite ? "declinou" : "frio";
  if (convite) return "convite_pendente";
  return "em_conversa";
}

// ---------------------------------------------------------------- normalização

/** Data e hora SEM fuso ("2026-11-04T09:30:00", "2026-11-04 09:30:00.123"). */
const SEM_FUSO = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;

/**
 * Data do PostgREST ("2026-11-04T12:30:00.123456+00:00") → ISO de `toISOString`, ou null.
 * Determinística: texto sem fuso (coluna `timestamp without time zone`) é lido
 * em UTC — o relógio do Postgres do Supabase —, nunca no fuso do processo (o
 * mesmo dado viraria 12:30Z no Windows em Brasília e 09:30Z no servidor em UTC).
 */
export function isoOuNull(v: unknown): string | null {
  if (v == null || v === "") return null;
  let t: number;
  if (v instanceof Date) t = v.getTime();
  else {
    const txt = String(v).trim();
    const m = SEM_FUSO.exec(txt);
    t = Date.parse(m ? `${m[1]}T${m[2]}Z` : txt);
  }
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Booleano tolerante: true, "true", "sim", "1", 1. */
export function boolOuNull(v: unknown): boolean | null {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const t = chave(String(v));
  if (["true", "t", "sim", "s", "1", "yes"].includes(t)) return true;
  if (["false", "f", "nao", "n", "0", "no"].includes(t)) return false;
  return null;
}

/** Número inteiro tolerante; texto que não é número vira null. */
export function intOuNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function textoOuNull(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t ? t : null;
}

/** A linha crua do PostgREST (nomes das colunas do robô) → `LinhaRobo`. */
export function normalizarLinhaRobo(r: Record<string, unknown>): LinhaRobo {
  return {
    sessionId: String(r.Session_id ?? ""),
    telefone: textoOuNull(r.Telefone),
    status: textoOuNull(r.status),
    statusAtendimento: textoOuNull(r.status_atendimento),
    turno: intOuNull(r.turno),
    conviteEnviado: boolOuNull(r.convite_enviado),
    conviteEnviadoEm: isoOuNull(r.convite_enviado_em),
    transferidoEm: isoOuNull(r.transferido_em),
    criadoEm: isoOuNull(r.criado_em),
    ultimaInteracao: isoOuNull(r.ultima_interacao),
    saudacaoEm: isoOuNull(r.saudacao_em),
    ultimaMsgClienteEm: isoOuNull(r.ultima_msg_cliente_em),
    followupsEnviados: intOuNull(r.followups_enviados),
    ultimoFollowupEm: isoOuNull(r.ultimo_followup_em),
    roboEncerradoEm: isoOuNull(r.robo_encerrado_em),
    optOut: boolOuNull(r.opt_out),
    optOutEm: isoOuNull(r.opt_out_em),
    botPausado: boolOuNull(r.bot_pausado),
  };
}
