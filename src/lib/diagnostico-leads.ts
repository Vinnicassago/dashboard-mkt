/**
 * Diagnóstico dos cadastros (D8 do relatório de out/2026) — puro, sem I/O.
 *
 * Até a correção da ingestão, cada reenvio do formulário da LP (mesmo event_id)
 * regravava o lead inteiro: status voltava a "Novo", a data de entrada virava a
 * do reenvio e os marcos de reunião eram apagados — e um evento "created" a
 * mais entrava no histórico. O histórico (`lead_events`) nunca foi apagado por
 * isso, então ele permite (1) medir o estrago e (2) propor o reparo de cada lead.
 *
 * Nada aqui altera dado: o reparo só é aplicado depois de alguém ler a lista.
 */

import { BOOKED_STATUSES, isLostStatus } from "./lead-status";
import type { Lead, LeadEvent, LeadStatus } from "./types";
import { DEFAULT_BRAND } from "./types";

export const ATOR_LP = "Landing page";

/** Proposta de reparo de um lead zerado por reenvio. */
export interface ReparoLead {
  leadId: string;
  nome: string;
  statusAtual: LeadStatus;
  /** Status que o histórico indica (ausente = o status atual está certo). */
  statusProposto?: LeadStatus;
  entradaAtual: string;
  /** Data de entrada original (ausente = a atual está certa). */
  entradaProposta?: string;
  /** Marcos reconstruídos do histórico (o store só grava o que estiver vazio). */
  bookedAt?: string;
  attendedAt?: string;
  closedAt?: string;
  lostAt?: string;
}

export interface RajadaRegistro {
  actor: string;
  inicio: string;
  fim: string;
  eventos: number;
}

export interface DiagnosticoLeads {
  /** Eventos "created" vindos da LP. */
  criacoesLp: number;
  /** Leads da LP (inclui excluídos) — compare com `criacoesLp`. */
  leadsLp: number;
  /** Mesmo id com mais de um "created" da LP e um nome só: reenvio. */
  reenvios: { leadId: string; criacoes: number }[];
  /** Mesmo id com nomes diferentes na criação: duas pessoas no mesmo id. */
  colisoes: { leadId: string; nomes: number }[];
  /** Criações cujo lead não existe mais (apagado fora do app). */
  orfaos: number;
  /** Leads da LP em outra marca que não a padrão. */
  foraDaMarcaPadrao: number;
  excluidos: number;
  reparos: ReparoLead[];
  /** ≥ 10 mudanças de status do mesmo usuário em 15 minutos. */
  rajadas: RajadaRegistro[];
}

const UM_MINUTO = 60_000;

/** Datas do histórico chegam com fusos diferentes (CSV traz "-03:00"): compara pelo instante. */
const ms = (iso: string) => Date.parse(iso);
const JANELA_RAJADA = 15 * UM_MINUTO;
const MIN_RAJADA = 10;

function porLead(events: LeadEvent[]): Map<string, LeadEvent[]> {
  const map = new Map<string, LeadEvent[]>();
  for (const e of events) {
    const list = map.get(e.leadId) ?? [];
    list.push(e);
    map.set(e.leadId, list);
  }
  for (const list of map.values()) list.sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  return map;
}

const primeiro = (list: LeadEvent[], pred: (e: LeadEvent) => boolean) => list.find(pred)?.createdAt;

/** Reparo de UM lead a partir do histórico dele; `null` = nada a reparar. */
export function propostaDeReparo(lead: Lead, historico: LeadEvent[]): ReparoLead | null {
  const eventos = [...historico].sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  const criacoesLp = eventos.filter((e) => e.action === "created" && e.actor === ATOR_LP);
  const mudancas = eventos.filter((e) => e.action === "status_changed" && e.toStatus);
  const ultimaMudanca = mudancas.at(-1);
  const ultimaCriacao = criacoesLp.at(-1)?.createdAt;

  const reparo: ReparoLead = {
    leadId: lead.id,
    nome: lead.name,
    statusAtual: lead.status,
    entradaAtual: lead.createdAt,
  };

  // Status zerado: o último registro é uma "criação" (reenvio) DEPOIS de uma
  // mudança de status, e o lead está de volta em "Novo".
  if (
    ultimaMudanca?.toStatus &&
    ultimaMudanca.toStatus !== "lead" &&
    lead.status === "lead" &&
    ultimaCriacao &&
    ms(ultimaCriacao) > ms(ultimaMudanca.createdAt)
  ) {
    reparo.statusProposto = ultimaMudanca.toStatus;
  }

  // Entrada regravada: a 1ª criação pela LP é anterior à entrada atual.
  const primeiraCriacao = criacoesLp[0]?.createdAt;
  if (
    primeiraCriacao &&
    ms(lead.createdAt) - ms(primeiraCriacao) > UM_MINUTO
  ) {
    reparo.entradaProposta = primeiraCriacao;
  }

  // Marcos: o 1º registro de cada etapa no histórico (o store não sobrescreve).
  const final = reparo.statusProposto ?? lead.status;
  if (!lead.bookedAt) reparo.bookedAt = primeiro(mudancas, (e) => BOOKED_STATUSES.includes(e.toStatus!));
  if (!lead.attendedAt)
    reparo.attendedAt = primeiro(mudancas, (e) => e.toStatus === "reuniao_realizada" || e.toStatus === "cliente");
  if (!lead.closedAt) reparo.closedAt = primeiro(mudancas, (e) => e.toStatus === "cliente");
  if (reparo.statusProposto && isLostStatus(final)) reparo.lostAt = ultimaMudanca!.createdAt;

  const algo =
    reparo.statusProposto ||
    reparo.entradaProposta ||
    reparo.bookedAt ||
    reparo.attendedAt ||
    reparo.closedAt;
  return algo ? reparo : null;
}

/** Rajadas de registro: o mesmo usuário mudando ≥ 10 status em 15 minutos. */
export function rajadasDeRegistro(events: LeadEvent[]): RajadaRegistro[] {
  const porAtor = new Map<string, number[]>();
  for (const e of events) {
    if (e.action !== "status_changed") continue;
    const list = porAtor.get(e.actor) ?? [];
    list.push(ms(e.createdAt));
    porAtor.set(e.actor, list);
  }
  const out: RajadaRegistro[] = [];
  for (const [actor, tempos] of porAtor) {
    tempos.sort((a, b) => a - b);
    let i = 0;
    while (i < tempos.length) {
      // maior janela de 15 min que começa em i
      let j = i;
      while (j + 1 < tempos.length && tempos[j + 1] - tempos[i] <= JANELA_RAJADA) j++;
      if (j - i + 1 >= MIN_RAJADA) {
        // estende enquanto os eventos seguintes continuarem colados (≤ 15 min do anterior)
        while (j + 1 < tempos.length && tempos[j + 1] - tempos[j] <= JANELA_RAJADA) j++;
        out.push({
          actor,
          inicio: new Date(tempos[i]).toISOString(),
          fim: new Date(tempos[j]).toISOString(),
          eventos: j - i + 1,
        });
        i = j + 1;
      } else {
        i++;
      }
    }
  }
  return out.sort((a, b) => b.inicio.localeCompare(a.inicio));
}

/**
 * `leads` = TODOS os leads de todas as marcas, inclusive excluídos; `events` =
 * o histórico inteiro. Com recorte, órfãos e outra marca dariam falso positivo.
 */
export function diagnosticarLeads(leads: Lead[], events: LeadEvent[]): DiagnosticoLeads {
  const byId = new Map(leads.map((l) => [l.id, l]));
  const eventos = porLead(events);

  const criacoes = events.filter((e) => e.action === "created" && e.actor === ATOR_LP);
  const reenvios: DiagnosticoLeads["reenvios"] = [];
  const colisoes: DiagnosticoLeads["colisoes"] = [];
  const criacoesPorLead = new Map<string, LeadEvent[]>();
  for (const e of criacoes) {
    const list = criacoesPorLead.get(e.leadId) ?? [];
    list.push(e);
    criacoesPorLead.set(e.leadId, list);
  }
  for (const [leadId, list] of criacoesPorLead) {
    if (list.length < 2) continue;
    const nomes = new Set(list.map((e) => e.leadName.trim().toLowerCase())).size;
    if (nomes > 1) colisoes.push({ leadId, nomes });
    else reenvios.push({ leadId, criacoes: list.length });
  }

  const reparos: ReparoLead[] = [];
  for (const lead of leads) {
    if (lead.deletedAt) continue;
    const r = propostaDeReparo(lead, eventos.get(lead.id) ?? []);
    if (r) reparos.push(r);
  }

  // "Da LP" pelo histórico (quem foi criado pela landing page), não pelo formato do id.
  const leadsLp = leads.filter((l) => criacoesPorLead.has(l.id));
  return {
    criacoesLp: criacoes.length,
    leadsLp: leadsLp.length,
    reenvios: reenvios.sort((a, b) => b.criacoes - a.criacoes),
    colisoes,
    orfaos: [...criacoesPorLead.keys()].filter((id) => !byId.has(id)).length,
    foraDaMarcaPadrao: leadsLp.filter((l) => l.brand !== DEFAULT_BRAND).length,
    excluidos: leads.filter((l) => l.deletedAt).length,
    reparos,
    rajadas: rajadasDeRegistro(events),
  };
}
