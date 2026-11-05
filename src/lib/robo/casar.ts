/**
 * Casamento das linhas do robô com os leads do painel — PURO, sem I/O.
 *
 * A chave é o telefone (`chaveTelefone`, `lib/phone.ts`, nos dois lados: cobre
 * com e sem DDI e com e sem o nono dígito). A sessão do robô NÃO entra: o índice
 * único de `robo_session_id` derrubaria o lote, e o telefone é refeito a cada
 * leitura. Nada de telefone sai daqui — só ids de lead, patches e contagens.
 *
 * Regras (especificação 11.4):
 *  - várias linhas do robô com a mesma chave → a de `ultima_interacao` mais
 *    recente (depois `criado_em`, depois `Session_id`), com o opt-out de TODAS
 *    (o opt-out vale sempre — `juntarLinhas`);
 *  - vários leads ATIVOS da marca com a mesma chave → o MESMO estado vai para
 *    TODOS (é a mesma pessoa; Revisar cuida do duplicado) — nenhum fica "não
 *    recebido" por ter perdido um desempate;
 *  - linha sem lead → `semLeadNoPainel` (só contagem); sem chave → `semTelefone`;
 *  - só o que MUDOU vira patch (datas comparadas pelo instante). Limitação
 *    conhecida: a linha que some do robô depois de casada não gera patch, e o
 *    estado fica no último valor lido;
 *  - lead REABERTO (11.3): os fatos UMA VEZ de antes do último `reaberto`
 *    recomeçam com o 1º fato do episódio novo (`ROBO_RECOMECA_NO_REABERTO`).
 */
import { chaveTelefoneValida } from "../phone";
import { ROBO_SOBRESCREVE, ROBO_UMA_VEZ, recomecaNoReaberto, type LeadRoboPatch } from "../data/backend";
import type { Lead } from "../types";
import { aceitouConvite, etapaDoRobo, recebeuConvite, semWhatsapp, type LinhaRobo } from "./etapa";

/**
 * O resumo da última leitura que deu certo (`STATE_KEYS.roboUltimaLeitura`): só
 * contagens, nunca telefone. `em` = fim da leitura (ISO).
 */
export interface ResumoLeituraRobo {
  em: string;
  /** Linhas lidas de "Leads WhatsApp". */
  lidos: number;
  /** Conversas do robô (uma por telefone) que casaram com ao menos um lead ativo. */
  casaram: number;
  /** Conversas do robô sem nenhum lead ativo da marca com aquele telefone. */
  semLeadNoPainel: number;
  /** Linhas do robô sem telefone utilizável. */
  semTelefone: number;
  /** Das sem lead no painel: as que aceitaram o convite (ninguém confere o Calendly delas). */
  transferidosSemLead: number;
}

export interface ResultadoCasamento extends Omit<ResumoLeituraRobo, "em"> {
  /** Um patch por lead, só com o que mudou. */
  itens: { id: string; patch: LeadRoboPatch }[];
}

/** A mais recente primeiro: `ultima_interacao`, depois `criado_em`, depois `Session_id`. */
function maisRecente(a: LinhaRobo, b: LinhaRobo): LinhaRobo {
  const ord = (x: string | null, y: string | null) => (x ?? "").localeCompare(y ?? "");
  const c =
    ord(a.ultimaInteracao, b.ultimaInteracao) || ord(a.criadoEm, b.criadoEm) || a.sessionId.localeCompare(b.sessionId);
  return c >= 0 ? a : b;
}

/**
 * Duas linhas do robô com a mesma chave: vale a mais recente (`maisRecente`), MAS
 * com o opt-out de TODAS (11.3: o opt-out vale sempre; LGPD, 11.12). A pessoa que
 * pediu para não receber mensagens numa sessão antiga não volta a recebê-las porque
 * outra sessão dela (12 × 13 dígitos, um cadastro novo) é mais recente. A data é a
 * mais antiga que o robô deu; com a flag sem data em todas, a leitura (`estadoDaLinha`).
 */
function juntarLinhas(a: LinhaRobo, b: LinhaRobo): LinhaRobo {
  const vale = maisRecente(a, b);
  const pediu = (x: LinhaRobo) => x.optOut === true || Boolean(x.optOutEm);
  if (!pediu(a) && !pediu(b)) return vale;
  const datas = [a.optOutEm, b.optOutEm].filter((d): d is string => Boolean(d)).sort();
  return { ...vale, optOut: true, optOutEm: datas[0] ?? null };
}

type CampoRobo = (typeof ROBO_UMA_VEZ)[number] | (typeof ROBO_SOBRESCREVE)[number];

/** Todos os campos do patch, com `null` para "a linha não diz". */
export type EstadoRoboDaLinha = { [K in CampoRobo]-?: NonNullable<LeadRoboPatch[K]> | null };

/** Os campos de data: comparados pelo INSTANTE, nunca pelo texto ("…+00:00" = "….000Z"). */
const CAMPOS_DE_DATA: ReadonlySet<CampoRobo> = new Set<CampoRobo>([
  ...ROBO_UMA_VEZ,
  "roboUltimaMsgClienteEm",
  "roboUltimaInteracaoEm",
  "roboUltimaCobrancaEm",
  "roboEncerradoEm",
]);

function instante(v: unknown): number {
  return typeof v === "string" ? Date.parse(v) : NaN;
}

/** O valor gravado é o mesmo da leitura? Datas pelo instante; o resto, igualdade estrita. */
function mesmoValor(f: CampoRobo, a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null || !CAMPOS_DE_DATA.has(f)) return false;
  const ta = instante(a);
  const tb = instante(b);
  return Number.isFinite(ta) && ta === tb;
}

/** O que a linha do robô diz, no formato do lead (antes de comparar com o gravado). */
export function estadoDaLinha(l: LinhaRobo, agora: string): EstadoRoboDaLinha {
  return {
    // UMA VEZ
    roboVistoEm: agora,
    roboRecebidoEm: l.criadoEm,
    roboSaudacaoEm: l.saudacaoEm,
    // Aproximação documentada: o robô não guarda a 1ª resposta, só a última.
    roboRespondeuEm: l.ultimaMsgClienteEm,
    // Os MESMOS predicados da etapa: sem a data no robô, a leitura (como sem WhatsApp e opt-out).
    roboConviteEm: l.conviteEnviadoEm ?? (recebeuConvite(l) ? agora : null),
    roboAceitouEm: l.transferidoEm ?? (aceitouConvite(l) ? agora : null),
    roboSemWhatsappEm: semWhatsapp(l) ? (l.criadoEm ?? agora) : null,
    roboOptOutEm: l.optOutEm ?? (l.optOut === true ? agora : null),
    // SOBRESCREVE
    roboUltimaMsgClienteEm: l.ultimaMsgClienteEm,
    roboUltimaInteracaoEm: l.ultimaInteracao,
    roboEtapa: etapaDoRobo(l),
    roboCobrancas: l.followupsEnviados,
    roboUltimaCobrancaEm: l.ultimoFollowupEm,
    roboEncerradoEm: l.roboEncerradoEm,
    roboPausado: l.botPausado,
  };
}

/**
 * Só o que mudou entre o lead gravado e a linha do robô.
 *
 * `reabertoEm` = o último evento `reaberto` do lead (11.3). Um fato de
 * `ROBO_RECOMECA_NO_REABERTO` gravado ANTES dele é de um episódio anterior (a
 * leitura o ignora): o 1º fato do episódio novo (≥ reabertoEm) o substitui, e o
 * patch leva `reabertoEm` para o backend fazer o mesmo (`case` no Postgres).
 * Sem isso, quem voltou ficaria para sempre "sem registro no robô" enquanto
 * conversa com ele. Opt-out e "sem WhatsApp" nunca recomeçam.
 *
 * Convite e aceite SEM a data no robô (só a flag ou o status) levam a hora da
 * leitura (`estadoDaLinha`), que é sempre ≥ reaberto: só recomeçam se o robô mexeu
 * na conversa depois do reaberto (a MESMA régua da etapa em `situacaoDoRobo`) —
 * senão o "transferido" da conversa antiga virava um aceite novo a cada reabertura.
 */
export function patchDoLead(
  lead: Lead,
  l: LinhaRobo,
  agora: string,
  reabertoEm?: string | null,
): LeadRoboPatch | null {
  const quer = estadoDaLinha(l, agora);
  const atual = lead as unknown as Record<string, unknown>;
  const patch: LeadRoboPatch = {};
  const campos = patch as Record<string, unknown>;
  const reaberto = instante(reabertoEm);
  const comReaberto: LeadRoboPatch = reabertoEm ? { reabertoEm } : {};
  // Sem a data no robô, o fato é a hora da leitura: do episódio novo só se o robô
  // interagiu depois do reaberto.
  const semDataNoRobo = (f: CampoRobo) =>
    (f === "roboConviteEm" && !l.conviteEnviadoEm) || (f === "roboAceitouEm" && !l.transferidoEm);
  const doEpisodioNovo = (f: CampoRobo, v: unknown) =>
    semDataNoRobo(f) ? instante(l.ultimaInteracao) > reaberto : instante(v) >= reaberto;
  for (const f of ROBO_UMA_VEZ) {
    const v = quer[f];
    if (v == null) continue;
    const gravado = atual[f];
    if (gravado == null) campos[f] = v;
    else if (
      recomecaNoReaberto(comReaberto, f) &&
      instante(gravado) < reaberto &&
      doEpisodioNovo(f, v) &&
      !mesmoValor(f, gravado, v)
    ) {
      campos[f] = v;
      patch.reabertoEm = reabertoEm!;
    }
  }
  for (const f of ROBO_SOBRESCREVE) {
    const v = quer[f] ?? null;
    const gravado = atual[f] ?? null;
    if (!mesmoValor(f, gravado, v)) campos[f] = v;
  }
  return Object.keys(patch).length ? patch : null;
}

/**
 * Casa as linhas lidas com os leads ATIVOS da marca (`listLeads`, sem excluídos)
 * e devolve os patches do que mudou, mais as contagens da leitura.
 * `reabertos` = leadId → o último `reaberto` (ISO), para os fatos recomeçarem.
 */
export function casarLeadsDoRobo(
  linhas: LinhaRobo[],
  leads: Lead[],
  agora: string,
  reabertos: ReadonlyMap<string, string> = new Map(),
): ResultadoCasamento {
  let semTelefone = 0;
  const porChave = new Map<string, LinhaRobo>();
  for (const l of linhas) {
    const k = chaveTelefoneValida(l.telefone);
    if (!k) {
      semTelefone++;
      continue;
    }
    const atual = porChave.get(k);
    porChave.set(k, atual ? juntarLinhas(atual, l) : l);
  }

  const leadsPorChave = new Map<string, Lead[]>();
  for (const lead of leads) {
    if (lead.deletedAt) continue;
    const k = chaveTelefoneValida(lead.phone);
    if (!k) continue;
    const lista = leadsPorChave.get(k);
    if (lista) lista.push(lead);
    else leadsPorChave.set(k, [lead]);
  }

  const itens: ResultadoCasamento["itens"] = [];
  let casaram = 0;
  let semLeadNoPainel = 0;
  let transferidosSemLead = 0;
  for (const [k, linha] of porChave) {
    const donos = leadsPorChave.get(k);
    if (!donos?.length) {
      semLeadNoPainel++;
      if (aceitouConvite(linha)) transferidosSemLead++;
      continue;
    }
    casaram++;
    for (const lead of donos) {
      const patch = patchDoLead(lead, linha, agora, reabertos.get(lead.id));
      if (patch) itens.push({ id: lead.id, patch });
    }
  }

  return { itens, lidos: linhas.length, casaram, semLeadNoPainel, semTelefone, transferidosSemLead };
}
