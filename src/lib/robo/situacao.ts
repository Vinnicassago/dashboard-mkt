/**
 * Onde a pessoa está com o robô de WhatsApp AGORA — PURO, sem I/O. Fonte ÚNICA:
 * Fila, Leads, ficha, motor (C1, B1), alerta, Integrações e o aviso de resgate
 * leem daqui (nenhuma tela refaz a data de 29/10 nem a régua dos 15 min).
 *
 * Só lê as colunas `robo_*` que o sync gravou no lead (`lib/robo/sync.ts`): o
 * painel nunca consulta o banco do robô para desenhar. O robô NÃO é tentativa —
 * nada daqui entra em `resumoContato`, na cadência ou no `firstContactAt`. O
 * status nunca muda por causa disto.
 *
 * Referência de tempo (11.1): `ref` = fim da última leitura ok QUANDO confiável
 * (o que o robô fez depois disso o painel ainda não sabe); com a leitura ausente
 * ou parada, `ref` = agora — e ninguém fica sem dono (o resgate pega quem o robô
 * não atendeu). Quem decide é `refDoRobo`.
 *
 * Reaberto (11.3): o corte "antes do robô" usa max(createdAt, reabertoEm) e os
 * fatos UMA VEZ anteriores ao reaberto (saudação, respondeu, convite, aceitou,
 * visto, recebido) são da conversa antiga — ignorados aqui. O opt-out vale sempre.
 */
import { ATOR_LP } from "../diagnostico-leads";
import { diaBrt } from "../horario-util";
import { ATOR_N8N } from "../n8n/entrada";
import { chaveTelefoneValida } from "../phone";
import { classeDoLead } from "../qualificacao";
import type { Lead, LeadEvent } from "../types";
import { ROBO_INICIO, type RoboEtapa } from "./etapa";

export { ROBO_INICIO };

// ---------------------------------------------------------------- réguas

/** B1, alerta e filtro "sem a 1ª mensagem": sem 1ª mensagem do robô há mais disso. */
export const ROBO_SEM_MSG_MIN = 15;
/** Resgate "sem resposta": horas CORRIDAS desde a 1ª mensagem do robô sem resposta. */
export const RESGATE_SEM_RESPOSTA_H = 24;
/** Resgate "o robô não falou": sem registro ou sem 1ª mensagem há mais disso. */
export const RESGATE_ROBO_NAO_FALOU_H = 2;
/** "Sem a 1ª mensagem" só conta quem entrou há menos disso (contra agora): falha antiga não vira alerta eterno. */
export const SEM_1A_MSG_JANELA_H = 48;
/** Leitura do robô parada há mais disso = B1 "leitura parada" e C1 com confiança média. */
export const LEITURA_PARADA_MIN = 45;

const MIN_MS = 60_000;
const H_MS = 3_600_000;

/**
 * Por que a pessoa está no Resgate — lista FECHADA (11.2). Os quatro primeiros
 * saem de `situacaoDoRobo` (o robô não conseguiu a conversa) e são os únicos que
 * avisam o n8n; `nao-compareceu` e `retorno` precisam das tentativas humanas e
 * saem de `etapaDoLead` (`lib/fila.ts`).
 */
export type ResgateMotivo =
  | "sem-resposta-24h"
  | "sem-whatsapp"
  | "sem-telefone"
  | "robo-nao-falou"
  | "nao-compareceu"
  | "retorno";

/**
 * O motivo em poucas palavras — sem número: "há 24 h" era a régua, não a medida
 * (quem foi saudado há 3 dias lia "há 24 h"). O tempo vem da espera ao lado, ou do
 * "1ª msg há X" que a Fila monta da saudação.
 */
export const RESGATE_MOTIVO_LABEL: Record<ResgateMotivo, string> = {
  "sem-resposta-24h": "não respondeu ao robô",
  "sem-whatsapp": "sem WhatsApp",
  "sem-telefone": "sem telefone",
  "robo-nao-falou": "o robô não falou",
  "nao-compareceu": "não compareceu",
  retorno: "retorno",
};

/** Os motivos que geram aviso ao n8n (11.2). */
export const MOTIVOS_AVISAVEIS: readonly ResgateMotivo[] = ["sem-resposta-24h", "sem-whatsapp", "sem-telefone", "robo-nao-falou"];

/** O balde da barra "Com o robô agora". */
export type BaldeRobo = "em-conversa" | "esperando" | "encerrado";

/** O que a Fila e o motor precisam saber do robô (sai de `estadoDoRoboAgora`). */
export interface RoboNaFila {
  ligado: boolean;
  /** Fim da última leitura ok (ISO) — nunca "agora". */
  lidoAte: string | null;
  /** Há leitura ok recente (≤ 2 h): só então as regras medem contra `lidoAte`. */
  confiavel: boolean;
}

/** `RoboNaFila` + o estado do sync — a MESMA forma de `estadoDoRoboAgora` (motor, B1). */
export interface RoboAgora extends RoboNaFila {
  sync: { ultimoOk: string | null; falha: { desde: string; erro: string } | null };
}

/** A referência das regras de tempo (11.1): a leitura quando confiável, senão agora. */
export function refDoRobo(robo: Pick<RoboNaFila, "lidoAte" | "confiavel"> | undefined, agora: string): string {
  return robo?.confiavel && robo.lidoAte ? robo.lidoAte : agora;
}

/**
 * A leitura está falhando, nunca rodou ou parou há mais de `LEITURA_PARADA_MIN`?
 * Régua ÚNICA da B1 "leitura parada", da confiança da C1 e do alerta "sem a 1ª
 * mensagem" (que só sai com a leitura em dia).
 */
export function leituraDoRoboParada(robo: Pick<RoboAgora, "sync">, agora: string): boolean {
  if (robo.sync.falha) return true;
  const ok = robo.sync.ultimoOk ? Date.parse(robo.sync.ultimoOk) : NaN;
  if (!Number.isFinite(ok)) return true;
  return Date.parse(agora) - ok > LEITURA_PARADA_MIN * MIN_MS;
}

// ---------------------------------------------------------------- reaberto

/**
 * O último evento `reaberto` entre os eventos de UM lead (ISO de `createdAt`), ou
 * `undefined`. A MESMA leitura da Fila (o relógio recomeça ali) e de `situacaoDoRobo`.
 */
export function reabertoDe(eventos: readonly Pick<LeadEvent, "action" | "createdAt">[]): string | undefined {
  let ultimo: string | undefined;
  for (const e of eventos) if (e.action === "reaberto" && (!ultimo || e.createdAt > ultimo)) ultimo = e.createdAt;
  return ultimo;
}

/** leadId → o último `reaberto` (só quem foi reaberto), sobre os eventos de vários leads. */
export function reabertosPorLead(
  eventos: readonly Pick<LeadEvent, "leadId" | "action" | "createdAt">[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of eventos) {
    if (e.action !== "reaberto") continue;
    const atual = out.get(e.leadId);
    if (!atual || e.createdAt > atual) out.set(e.leadId, e.createdAt);
  }
  return out;
}

/** Quem reabre por uma inscrição NOVA — a página e a API do n8n: essa chega ao robô. */
const ATORES_DA_INSCRICAO: readonly string[] = [ATOR_LP, ATOR_N8N];

type EventoDeReaberto = Pick<LeadEvent, "leadId" | "action" | "createdAt" | "actor">;

/**
 * Os leads cujo ÚLTIMO `reaberto` foi feito no PAINEL (o administrador,
 * `reabrirLead`), não por uma inscrição nova. O robô só recebe inscrições: essa
 * reabertura nunca chega a ele, e "não recebeu" / "sem a 1ª mensagem" não são falha
 * dele (`ContextoSituacao.reabertoNoPainel`).
 */
export function reabertosNoPainel(eventos: readonly EventoDeReaberto[]): Set<string> {
  const ultimo = new Map<string, EventoDeReaberto>();
  for (const e of eventos) {
    if (e.action !== "reaberto") continue;
    const atual = ultimo.get(e.leadId);
    if (!atual || e.createdAt > atual.createdAt) ultimo.set(e.leadId, e);
  }
  const out = new Set<string>();
  for (const [id, e] of ultimo) if (!ATORES_DA_INSCRICAO.includes(e.actor)) out.add(id);
  return out;
}

/** O último `reaberto` de UM lead foi feito no painel (`reabertosNoPainel`)? */
export function reabertoNoPainelDe(eventos: readonly EventoDeReaberto[]): boolean {
  return reabertosNoPainel(eventos).size > 0;
}

// ---------------------------------------------------------------- situação

export interface SituacaoRobo {
  /** O robô vale para este lead (ligado e na marca do robô). Desligado: o resto é vazio. */
  ligado: boolean;
  /**
   * No recorte do robô (11.6): não excluído, aberto (lead | em contato), sem
   * classe (a live está congelada) e com o robô ligado. Fora dele, `balde`,
   * `resgate`, `naoRecebido` e `semPrimeiraMsg` ficam vazios.
   */
  noRecorte: boolean;
  /** Entrou antes de 29/10 (dia em Brasília, max(createdAt, reaberto)) e o robô nunca o viu. */
  antesDoRobo: boolean;
  /**
   * Depois do corte, com telefone, sem registro no robô há ≥ 15 min (contra `ref`).
   * Quem o robô já saudou num episódio anterior ao reaberto, ou foi reaberto no
   * painel (o robô nunca recebe essa reabertura), não conta (não é falha dele).
   */
  naoRecebido: boolean;
  /** O robô recebeu e não mandou a 1ª mensagem há ≥ 15 min (contra `ref`) — idem. */
  semPrimeiraMsg: boolean;
  /** A etapa no robô, ou null (sem registro, ou da conversa de antes do reaberto). */
  etapa: RoboEtapa | null;
  /**
   * A fala do robô NESTE episódio (ISO): a saudação do episódio ou, num lead
   * reaberto cuja conversa o robô seguiu sem regravar a saudação, o reaberto (uma
   * interação ou cobrança dele depois dele). `null` = o robô ainda não falou. A
   * MESMA régua do resgate, da barra, do alerta "sem a 1ª mensagem" e do funil do
   * Início ("1ª mensagem").
   */
  falouEm: string | null;
  /** A pessoa mandou mensagem ao robô (neste episódio). */
  respondeu: boolean;
  /** A data que a etapa conta (11.16). */
  desde: string | null;
  /** Barra "Com o robô agora" — vazio quando a pessoa está no resgate (está com o comercial). */
  balde: BaldeRobo | null;
  /** O robô não conseguiu a conversa: entrou no resgate do comercial (só os motivos do robô). */
  resgate: { motivo: ResgateMotivo; desde: string } | null;
  /** Aceitou o convite (recebeu o link do Calendly) neste episódio. */
  aceitouEm: string | null;
}

export interface ContextoSituacao {
  /** ISO. */
  agora: string;
  /** A referência das regras de tempo (`refDoRobo`). */
  ref: string;
  ligado: boolean;
  /** O último `reaberto` do lead (`reabertoDe`). */
  reabertoEm?: string;
  /** Esse `reaberto` foi feito no painel (`reabertoNoPainelDe`), não por uma inscrição nova. */
  reabertoNoPainel?: boolean;
}

const DESLIGADA: SituacaoRobo = {
  ligado: false,
  noRecorte: false,
  antesDoRobo: false,
  naoRecebido: false,
  semPrimeiraMsg: false,
  etapa: null,
  falouEm: null,
  respondeu: false,
  desde: null,
  balde: null,
  resgate: null,
  aceitouEm: null,
};

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

/** O maior dos instantes (ISO), ignorando vazios. */
function maxIso(...isos: (string | null | undefined)[]): string | undefined {
  let melhor: string | undefined;
  let t = -Infinity;
  for (const i of isos) {
    const v = ms(i);
    if (Number.isFinite(v) && v > t) {
      t = v;
      melhor = i!;
    }
  }
  return melhor;
}

const mais = (iso: string, msAdd: number) => new Date(Date.parse(iso) + msAdd).toISOString();

/** Lead aberto: ainda há contato a fazer (as reuniões e os encerrados têm regra própria). */
export const leadAberto = (l: Pick<Lead, "status">) => l.status === "lead" || l.status === "em_contato";

/**
 * O convite aceito já virou reunião? Só o agendamento DEPOIS do aceite conta: o
 * `bookedAt` (marco, nunca apagado) de um episódio anterior ao reaberto não responde
 * pelo aceite novo (11.3) — com `everBooked`, quem agendou, foi perdido, voltou e
 * aceitou de novo ficava fora do grupo, do resgate e da barra: sem dono. Para lead
 * aberto sem reaberto é o mesmo que `everBooked` (agendar tira do aberto; só o
 * reaberto, ou a mescla que traz o marco de outro cadastro, devolve um aberto com
 * `bookedAt`). A MESMA régua da Fila, do filtro de Leads e da ficha.
 */
export function agendouDepoisDoAceite(l: Pick<Lead, "bookedAt">, aceitouEm: string): boolean {
  return Boolean(l.bookedAt) && Date.parse(l.bookedAt!) >= Date.parse(aceitouEm);
}

/**
 * O fato UMA VEZ vale para o episódio atual? Não, se é anterior ao último
 * `reaberto` (é da conversa antiga). A MESMA régua de `situacaoDoRobo` — a ficha
 * lê as linhas do card do robô por aqui.
 */
export function fatoDoEpisodio(iso: string | null | undefined, reabertoEm?: string): string | undefined {
  if (!iso) return undefined;
  const reab = ms(reabertoEm);
  return !Number.isFinite(reab) || ms(iso) >= reab ? iso : undefined;
}

/**
 * A pessoa mandou mensagem ao robô NESTE episódio: o `respondeu_em` do episódio, ou
 * a última mensagem dela posterior ao reaberto ("respondeu depois do reaberto").
 * Regra ÚNICA de `situacaoDoRobo` e de `encerramentoDoRobo` (K15).
 */
function respondeuNoEpisodio(
  l: Pick<Lead, "roboRespondeuEm" | "roboUltimaMsgClienteEm">,
  reabertoEm?: string,
): boolean {
  const reab = ms(reabertoEm);
  const ultimaMsgCliente = l.roboUltimaMsgClienteEm;
  return Boolean(
    fatoDoEpisodio(l.roboRespondeuEm, reabertoEm) ||
      (ultimaMsgCliente && (!Number.isFinite(reab) || ms(ultimaMsgCliente) > reab)),
  );
}

/**
 * A etapa do robô que vale NESTE episódio. A etapa é SOBRESCREVE: num lead
 * reaberto, ela só vale se o robô mexeu na conversa depois do reaberto (senão é a
 * da conversa antiga). Sem WhatsApp e opt-out valem sempre. Regra ÚNICA de
 * `situacaoDoRobo` e de `encerramentoDoRobo`.
 */
function etapaDoEpisodio(l: Lead, reabertoEm?: string): RoboEtapa | null {
  const reab = ms(reabertoEm);
  const visto = fatoDoEpisodio(l.roboVistoEm, reabertoEm);
  const convite = fatoDoEpisodio(l.roboConviteEm, reabertoEm);
  const aceitou = fatoDoEpisodio(l.roboAceitouEm, reabertoEm);
  const optOut = Boolean(l.roboOptOutEm) || l.roboEtapa === "opt_out";
  let etapa: RoboEtapa | null = l.roboEtapa ?? null;
  if (
    etapa &&
    etapa !== "sem_whatsapp" &&
    etapa !== "opt_out" &&
    Number.isFinite(reab) &&
    !(ms(l.roboUltimaInteracaoEm) > reab)
  ) {
    etapa = visto ? "sem_mensagem" : null;
  }
  // "Transferido" sem o aceite NESTE episódio: o `transferido_em` é da conversa de
  // antes do reaberto (o robô não o limpa) e a pessoa voltou a falar com o robô —
  // é uma conversa nova, não um aceite (senão ficava sem grupo, sem balde e sem dono).
  if (etapa === "transferido" && !aceitou) etapa = convite ? "convite_pendente" : "em_conversa";
  if (optOut) etapa = "opt_out";
  return etapa;
}

/** Por que o ROBÔ encerrou a conversa (fim registrado por ele; o status no painel não muda). */
export type MotivoDoRobo = "pos-convite" | "esfriou" | "opt-out";

/**
 * O fim da conversa pelo robô (F3-D3, Fase 3) — predicado ÚNICO de "Por que
 * perdemos" (as linhas do robô) e de "encerrado" nas três juntas do robô do funil
 * do processo. PURO.
 *
 *  0. Aceite NESTE episódio → nunca é fim pelo robô, nem com opt-out depois: o convite
 *     virou Calendly, a pessoa está no "Aceitou o convite" da Fila (do comercial, que
 *     liga quando não há WhatsApp) e a barra também não a põe em "encerrados"
 *     (`situacaoDoRobo` exige `!aceitou` no balde). Assim "Por que perdemos" e a junta
 *     `agendou-apos-aceite` contam a mesma pessoa do mesmo jeito.
 *  1. Opt-out (vale sempre, como em `situacaoDoRobo`), com ou sem resposta.
 *  2. Os outros só com resposta da pessoa NESTE episódio: quem o robô encerrou sem
 *     resposta continua no Resgate do comercial (não é linha do robô).
 *  3. Pela etapa do episódio: "declinou" (o robô grava frio com o convite enviado —
 *     não é uma recusa registrada, K24) → `pos-convite`; "frio" ou `encerrado_em` do
 *     episódio → `esfriou`.
 *  4. Pausado sozinho NÃO é fim: alguém assumiu (D4).
 *
 * `em` é do episódio (K15): o `encerrado_em` do episódio, senão a última interação
 * do robô quando posterior ao reaberto; uma data de conversa antiga nunca ganha o
 * "vale o primeiro" contra o registro do comercial de agora.
 */
export function encerramentoDoRobo(l: Lead, reabertoEm?: string): { motivo: MotivoDoRobo; em: string | null } | null {
  if (fatoDoEpisodio(l.roboAceitouEm, reabertoEm)) return null;
  if (l.roboOptOutEm || l.roboEtapa === "opt_out") return { motivo: "opt-out", em: l.roboOptOutEm ?? null };
  if (!respondeuNoEpisodio(l, reabertoEm)) return null;
  const etapa = etapaDoEpisodio(l, reabertoEm);
  const encerradoEm = fatoDoEpisodio(l.roboEncerradoEm, reabertoEm);
  let motivo: MotivoDoRobo | null = null;
  if (etapa === "declinou") motivo = "pos-convite";
  else if (etapa === "frio" || encerradoEm) motivo = "esfriou";
  if (!motivo) return null;
  const reab = ms(reabertoEm);
  const ultima =
    l.roboUltimaInteracaoEm && (!Number.isFinite(reab) || ms(l.roboUltimaInteracaoEm) > reab)
      ? l.roboUltimaInteracaoEm
      : undefined;
  return { motivo, em: encerradoEm ?? ultima ?? null };
}

export function situacaoDoRobo(l: Lead, ctx: ContextoSituacao): SituacaoRobo {
  if (!ctx.ligado) return { ...DESLIGADA };
  const reab = ms(ctx.reabertoEm);
  // Fato do episódio atual: não é anterior ao reaberto (os UMA VEZ de antes são da conversa antiga).
  const doEpisodio = (iso: string | undefined): string | undefined => fatoDoEpisodio(iso, ctx.reabertoEm);

  const visto = doEpisodio(l.roboVistoEm);
  const recebido = doEpisodio(l.roboRecebidoEm);
  const saudacao = doEpisodio(l.roboSaudacaoEm);
  const convite = doEpisodio(l.roboConviteEm);
  const aceitou = doEpisodio(l.roboAceitouEm);
  const encerradoEm = doEpisodio(l.roboEncerradoEm);
  const ultimaInteracao = l.roboUltimaInteracaoEm;
  // "Respondeu depois do reaberto" = a última mensagem da pessoa é posterior a ele.
  const respondeu = respondeuNoEpisodio(l, ctx.reabertoEm);
  const optOut = Boolean(l.roboOptOutEm) || l.roboEtapa === "opt_out";

  // A etapa do episódio (SOBRESCREVE só vale se o robô mexeu depois do reaberto).
  const etapa = etapaDoEpisodio(l, ctx.reabertoEm);

  const base = maxIso(l.createdAt, ctx.reabertoEm) ?? l.createdAt;
  const antesDoRobo = diaBrt(base) < ROBO_INICIO && !l.roboVistoEm;
  const noRecorte = !l.deletedAt && leadAberto(l) && !classeDoLead(l);
  const temTelefone = chaveTelefoneValida(l.phone) != null;
  const refMs = Date.parse(ctx.ref);
  const venceu = (iso: string | undefined, depoisMs: number) => {
    const t = ms(iso);
    return Number.isFinite(t) && t + depoisMs <= refMs;
  };

  /*
   * A fala do robô NESTE episódio. Num lead reaberto, o robô pode seguir a MESMA
   * conversa sem regravar `saudacao_em` (o sync só renova a saudação quando o robô
   * a regrava): uma interação ou cobrança dele depois do reaberto, sem mensagem da
   * pessoa, é a fala do episódio. O relógio das 24 h conta do reaberto — estável:
   * a `ultimaInteracao` anda a cada cobrança e reiniciaria o prazo (e o aviso).
   */
  const interagiuNoEpisodio =
    Number.isFinite(reab) && (ms(ultimaInteracao) > reab || ms(l.roboUltimaCobrancaEm) > reab);
  const falou = saudacao ?? (interagiuNoEpisodio ? ctx.reabertoEm : undefined);
  // O robô já falou com esta pessoa num episódio anterior (reaberto pelo admin, pelo
  // n8n ou pelo formulário): sem fala nova não é FALHA do robô — fica fora da B1 e do
  // alerta "sem a 1ª mensagem"; o resgate das 2 h continua (ninguém fica sem dono).
  const falouAntes = Number.isFinite(reab) && Boolean(l.roboSaudacaoEm) && ms(l.roboSaudacaoEm) < reab;
  // Idem para quem foi reaberto no PAINEL (o administrador): o robô só recebe
  // inscrições (a página, o n8n), nunca essa reabertura — o lead de antes do robô que
  // o admin reabriu não é "não chegou ao robô". Fora da B1, do alerta e de Integrações;
  // o resgate das 2 h continua.
  const naoEFalhaDoRobo = falouAntes || (Number.isFinite(reab) && ctx.reabertoNoPainel === true);

  const semRegistro = temTelefone && !visto;
  const semSaudacao = Boolean(visto) && !falou && !respondeu && etapa !== "sem_whatsapp" && etapa !== "opt_out";
  // O registro no robô só adia o relógio das 2 h enquanto ele ainda corria: quem já
  // entrou no resgate por falta de registro NÃO volta para "dentro do prazo" porque
  // o robô registrou tarde (sairia da Fila sem dono e voltaria com outro `desde` —
  // um 2º aviso ao n8n).
  const recebidoNoPrazo = recebido && ms(recebido) <= ms(base) + RESGATE_ROBO_NAO_FALOU_H * H_MS ? recebido : undefined;
  const baseFala = maxIso(base, recebidoNoPrazo) ?? base;
  const dentro = noRecorte && !antesDoRobo;
  const naoRecebido = dentro && semRegistro && !naoEFalhaDoRobo && venceu(base, ROBO_SEM_MSG_MIN * MIN_MS);
  const semPrimeiraMsg = dentro && semSaudacao && !naoEFalhaDoRobo && venceu(baseFala, ROBO_SEM_MSG_MIN * MIN_MS);

  // ---- resgate: só os motivos do robô, só no recorte e depois do corte ----
  let resgate: SituacaoRobo["resgate"] = null;
  if (dentro && !optOut && !respondeu && !aceitou) {
    if (etapa === "sem_whatsapp") {
      resgate = { motivo: "sem-whatsapp", desde: maxIso(l.roboSemWhatsappEm ?? visto ?? base, ctx.reabertoEm) ?? base };
    } else if (!temTelefone) {
      resgate = { motivo: "sem-telefone", desde: base };
    } else if (falou && venceu(falou, RESGATE_SEM_RESPOSTA_H * H_MS)) {
      // Encerrado/pausado pelo robô NÃO tira daqui quem nunca respondeu.
      resgate = { motivo: "sem-resposta-24h", desde: mais(falou, RESGATE_SEM_RESPOSTA_H * H_MS) };
    } else if ((semRegistro || semSaudacao) && venceu(baseFala, RESGATE_ROBO_NAO_FALOU_H * H_MS)) {
      resgate = { motivo: "robo-nao-falou", desde: mais(baseFala, RESGATE_ROBO_NAO_FALOU_H * H_MS) };
    }
  }

  // ---- balde da barra (quem está COM o robô; o resgate está com o comercial) ----
  let balde: BaldeRobo | null = null;
  if (dentro && !resgate && !aceitou && etapa) {
    const encerrado =
      optOut || etapa === "frio" || etapa === "declinou" || Boolean(encerradoEm) || l.roboPausado === true;
    if (encerrado) balde = "encerrado";
    else if (respondeu && (etapa === "em_conversa" || etapa === "convite_pendente")) balde = "em-conversa";
    else if (falou && !respondeu && !venceu(falou, RESGATE_SEM_RESPOSTA_H * H_MS)) balde = "esperando";
  }

  // ---- a data que a etapa conta (11.16) ----
  let desde: string | null = null;
  if (balde === "encerrado" && etapa !== "opt_out") desde = encerradoEm ?? ultimaInteracao ?? null;
  else if (balde === "esperando") desde = falou ?? null;
  else {
    switch (etapa) {
      case "em_conversa":
        desde = ultimaInteracao ?? null;
        break;
      case "nao_respondeu":
        desde = falou ?? null;
        break;
      case "convite_pendente":
        desde = convite ?? ultimaInteracao ?? null;
        break;
      case "transferido":
        desde = aceitou ?? null;
        break;
      case "frio":
      case "declinou":
        desde = encerradoEm ?? ultimaInteracao ?? null;
        break;
      case "sem_whatsapp":
        desde = l.roboSemWhatsappEm ?? null;
        break;
      case "sem_mensagem":
        desde = recebido ?? visto ?? null;
        break;
      case "opt_out":
        desde = l.roboOptOutEm ?? null;
        break;
      default:
        desde = null;
    }
  }

  return {
    ligado: true,
    noRecorte,
    antesDoRobo,
    naoRecebido,
    semPrimeiraMsg,
    etapa,
    falouEm: falou ?? null,
    respondeu,
    desde,
    balde,
    resgate,
    aceitouEm: aceitou ?? null,
  };
}

// ---------------------------------------------------------------- filtros

/**
 * As chaves do filtro `robo` de Leads (com hífen) — as mesmas dos links da barra
 * da Fila, da B1, do alerta e de Integrações (11.6).
 */
export const FILTROS_DO_ROBO = [
  "em-conversa",
  "esperando",
  "encerrado",
  "resgate",
  "convite-aceito",
  "sem-whatsapp",
  "sem-1a-msg",
  "antes",
] as const;
export type FiltroRobo = (typeof FILTROS_DO_ROBO)[number];

export const FILTRO_ROBO_LABEL: Record<FiltroRobo, string> = {
  "em-conversa": "Em conversa com o robô",
  esperando: "Esperando resposta",
  encerrado: "Encerrado pelo robô",
  // NÃO é o grupo "Resgate" da Fila (que tem também "não compareceu" e "retorno",
  // e esconde quem já tentou pela cadência): são só os quatro motivos do robô.
  // Nenhum número do grupo linka para este filtro.
  resgate: "Sem conversa com o robô",
  // Idem: NÃO é o grupo "Aceitou o convite" da Fila (que esconde quem já tentou
  // pela cadência e junta os cadastros da mesma pessoa) — é o fato, por cadastro.
  "convite-aceito": "Aceitou o convite pelo robô (sem reunião)",
  "sem-whatsapp": "Sem WhatsApp",
  "sem-1a-msg": "Sem a 1ª mensagem do robô",
  antes: "Antes do robô",
};

/**
 * O predicado ÚNICO de cada chave do filtro do robô (11.6). Recorte de todas:
 * robô ligado, lead não excluído, aberto e sem classe (`situacao.noRecorte`) —
 * exceto `convite-aceito`, que vale para todo lead (com ou sem classe) que ainda
 * não agendou depois do aceite (`agendouDepoisDoAceite`) e não foi encerrado: é
 * conferir o Calendly, não contato.
 *
 * `resgate` = os motivos do robô (`situacao.resgate`), inclusive quem a cadência
 * humana escondeu do grupo agora; "não compareceu" e "retorno" dependem das
 * tentativas e ficam só na Fila — por isso o rótulo é "Sem conversa com o robô", e
 * não o nome do grupo. `sem-1a-msg` = sem
 * registro no robô OU visto sem saudação, há mais de 15 min (contra `ref`) e
 * entrado há MENOS de 48 h (contra agora) — quem passou de 2 h está também no
 * resgate.
 */
export function casaFiltroRobo(
  l: Lead,
  chave: FiltroRobo,
  s: SituacaoRobo,
  ctx: { agora: string; reabertoEm?: string },
): boolean {
  if (!s.ligado || l.deletedAt) return false;
  if (chave === "convite-aceito") return Boolean(s.aceitouEm) && leadAberto(l) && !agendouDepoisDoAceite(l, s.aceitouEm!);
  if (!s.noRecorte) return false;
  switch (chave) {
    case "em-conversa":
      return s.balde === "em-conversa";
    case "esperando":
      return s.balde === "esperando";
    case "encerrado":
      return s.balde === "encerrado";
    case "resgate":
      return s.resgate != null;
    case "sem-whatsapp":
      return s.etapa === "sem_whatsapp";
    case "antes":
      return s.antesDoRobo;
    case "sem-1a-msg": {
      if (!s.naoRecebido && !s.semPrimeiraMsg) return false;
      const base = maxIso(l.createdAt, ctx.reabertoEm) ?? l.createdAt;
      return Date.parse(ctx.agora) - Date.parse(base) < SEM_1A_MSG_JANELA_H * H_MS;
    }
  }
}

// ---------------------------------------------------------------- contagens

/**
 * A situação de cada lead com o MESMO contexto (Fila, barra, B1, alerta e Integrações).
 * `noPainel` = `reabertosNoPainel` dos mesmos eventos (quem o administrador reabriu).
 */
export function situacoesDosLeads(
  leads: readonly Lead[],
  reabertos: ReadonlyMap<string, string>,
  robo: RoboNaFila | undefined,
  agora: string,
  noPainel: ReadonlySet<string> = new Set(),
): { lead: Lead; situacao: SituacaoRobo; reabertoEm?: string }[] {
  const ligado = Boolean(robo?.ligado);
  const ref = refDoRobo(robo, agora);
  return leads.map((lead) => {
    const reabertoEm = reabertos.get(lead.id);
    const reabertoNoPainel = noPainel.has(lead.id);
    return { lead, reabertoEm, situacao: situacaoDoRobo(lead, { agora, ref, ligado, reabertoEm, reabertoNoPainel }) };
  });
}

export interface SemMensagemDoRobo {
  /** Leads sem a 1ª mensagem do robô (`sem-1a-msg`). */
  total: number;
  /** Desses, os que nem chegaram ao robô (sem registro). */
  naoChegaram: number;
  /** Os ids (a identidade da B1 por pessoas). */
  ids: string[];
}

/**
 * A contagem ÚNICA de "sem a 1ª mensagem do robô" (11.6): a frase do Início, o
 * alerta `robo-sem-1a-msg`, Integrações e a B1 (b) do motor (dormente) usam ESTE
 * número. Robô desligado = zero.
 */
export function semMensagemDoRobo(
  leads: readonly Lead[],
  reabertos: ReadonlyMap<string, string>,
  robo: RoboNaFila | undefined,
  agora: string,
  /** `reabertosNoPainel` dos mesmos eventos: quem o administrador reabriu não é falha do robô. */
  noPainel: ReadonlySet<string> = new Set(),
): SemMensagemDoRobo {
  const out: SemMensagemDoRobo = { total: 0, naoChegaram: 0, ids: [] };
  if (!robo?.ligado) return out;
  for (const { lead, situacao, reabertoEm } of situacoesDosLeads(leads, reabertos, robo, agora, noPainel)) {
    if (!casaFiltroRobo(lead, "sem-1a-msg", situacao, { agora, reabertoEm })) continue;
    out.total += 1;
    if (situacao.naoRecebido) out.naoChegaram += 1;
    out.ids.push(lead.id);
  }
  return out;
}

/** O primeiro nome que um aviso pode levar ("Lead sem nome" não é nome de ninguém). */
export function primeiroNome(nome: string | undefined | null): string | null {
  const t = (nome ?? "").trim();
  if (!t || t.toLowerCase() === "lead sem nome") return null;
  return t.split(/\s+/)[0] ?? null;
}
