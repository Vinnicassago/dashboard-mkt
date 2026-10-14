import "server-only";
import { addLeadEvent, setLeadStatus } from "../data/store";
import { everBooked } from "../metrics";
import { chaveNome } from "../lead-id";
import {
  MOTIVOS_CONTATO_INVALIDO,
  isBookedStatus,
  isLostStatus,
  type DadosDaTransicao,
} from "../lead-status";
import { currentActor, newEventId } from "../auth/actor";
import { enviarParaMeta, notaDoEnvio, type PedidoDeEnvio } from "../meta/capi-envios";
import { sendGa4Event } from "../ga4/measurement-protocol";
import type { Lead, LeadStatus } from "../types";

export interface StatusResult {
  ok: boolean;
  message: string;
}

/** O que a mudança carregou junto, para o histórico (reunião, motivo, confirmação). */
function payloadDaMudanca(dados: DadosDaTransicao, motivo?: string): Record<string, string> | undefined {
  const p: Record<string, string> = {};
  if (dados.meetingFor) p.reuniao = dados.meetingFor;
  if (motivo) p.motivo = motivo;
  if (dados.confirmado) p.abaixoDaRegua = "sim";
  return Object.keys(p).length ? p : undefined;
}

/** Compareceu (o fato), lido ANTES da mudança: o marco ou um status que já o implicava. */
const jaCompareceu = (l: Lead) => Boolean(l.attendedAt) || l.status === "reuniao_realizada" || l.status === "cliente";
/** Fechou (o fato), lido ANTES da mudança. */
const jaFechou = (l: Lead) => Boolean(l.closedAt) || l.status === "cliente";

/**
 * Os eventos que esta mudança dispara na Meta: cada um só na PRIMEIRA vez que o
 * fato acontece — pelo marco, não pelo status. Agendar, desistir e agendar de
 * novo não manda um 2º Schedule (o event_id seria o mesmo e, passadas 48 h, a
 * Meta contaria duas vezes). Pura: a ponte do robô e a tela passam por aqui.
 */
export function eventosDaMudanca(lead: Lead, status: LeadStatus): Array<PedidoDeEnvio["eventName"]> {
  const eventos: Array<PedidoDeEnvio["eventName"]> = [];
  if (isBookedStatus(status) && !everBooked(lead)) eventos.push("Schedule");
  if ((status === "reuniao_realizada" || status === "cliente") && !jaCompareceu(lead)) eventos.push("ReuniaoRealizada");
  if (status === "cliente" && !jaFechou(lead)) eventos.push("Purchase");
  return eventos;
}

/** O nome que a nota da tela usa para cada evento. */
const NOME_NA_NOTA: Record<PedidoDeEnvio["eventName"], string> = {
  Lead: "Lead",
  Schedule: "Schedule",
  ReuniaoRealizada: "Reunião realizada",
  Purchase: "Purchase",
};

/**
 * Aplica uma mudança de status JÁ AUTORIZADA E VALIDADA: grava status, marcos e
 * a data da reunião, registra no histórico e, quando um fato acontece pela 1ª
 * vez (agendou, compareceu, fechou), avisa Meta e GA4. Quem chama decide as
 * regras — a tela usa `podeTransitar`; a ponte do robô usa as dela (o robô não
 * sabe a data da reunião).
 */
export async function aplicarStatus(
  lead: Lead,
  status: LeadStatus,
  dados: DadosDaTransicao = {},
): Promise<StatusResult> {
  const prevStatus = lead.status;
  const becomesBooked = isBookedStatus(status);
  // Lido do lead ANTES de gravar: depois, os marcos já estão carimbados.
  const eventos = eventosDaMudanca(lead, status);
  const now = new Date().toISOString();
  // Antes de qualquer escrita: uma falha aqui não deixa marco gravado sem evento.
  const actor = await currentActor();
  const motivo = dados.motivo ? (MOTIVOS_CONTATO_INVALIDO[dados.motivo] ?? dados.motivo) : undefined;

  /**
   * Carimba os marcos desta transição. O store só grava o que ainda estiver
   * vazio, então avançar e depois perder o lead preserva o fato — é isso que
   * mantém a reunião no CPR mesmo quando o comercial registra o desfecho.
   */
  await setLeadStatus(lead.id, status, {
    meetingFor: dados.meetingFor,
    value: dados.value,
    bookedAt: becomesBooked ? now : undefined,
    attendedAt: status === "reuniao_realizada" || status === "cliente" ? now : undefined,
    closedAt: status === "cliente" ? now : undefined,
    lostAt: isLostStatus(status) ? now : null,
    lostReasonDetail: isLostStatus(status) ? (motivo ?? null) : null,
  });

  // O histórico vem DEPOIS de enfileirar o envio à Meta: se a escrita do
  // histórico falhar, o evento do fato que acabou de ser carimbado já está na fila
  // (senão o marco existiria e `eventosDaMudanca` nunca mais o mandaria).
  const registrarHistorico = async () => {
    if (prevStatus === status) return;
    await addLeadEvent({
      id: newEventId(),
      leadId: lead.id,
      brand: lead.brand,
      leadName: lead.name,
      actor,
      action: "status_changed",
      fromStatus: prevStatus,
      toStatus: status,
      payload: payloadDaMudanca(dados, motivo),
      createdAt: now,
    });
  };

  if (eventos.length === 0) {
    await registrarHistorico();
    return { ok: true, message: "Status atualizado." };
  }

  // "Lead sem nome" (o sentinela da entrada sem nome) não é o primeiro nome de ninguém.
  const nomes = chaveNome(lead.name) ? lead.name.trim().split(/\s+/) : [];
  const notes: string[] = [];
  const amount = dados.value ?? lead.value ?? 0;
  // O mesmo dado de pareamento em todo evento do painel: e-mail e telefone em
  // hash (D9 — antes iam só nome, fbc, fbp e o id), mais os cookies da visita.
  const pessoa = {
    email: lead.email,
    phone: lead.phone,
    firstName: nomes[0] || undefined,
    fbc: lead.fbc,
    fbp: lead.fbp,
    externalId: lead.id,
  };
  const CUSTOM: Record<Exclude<PedidoDeEnvio["eventName"], "Lead">, Record<string, unknown>> = {
    Schedule: { content_name: "Reunião agendada", currency: "BRL" },
    ReuniaoRealizada: { content_name: "Reunião realizada", currency: "BRL" },
    Purchase: { content_name: "Cliente (carta de crédito)", currency: "BRL", value: amount },
  };
  const ID: Record<Exclude<PedidoDeEnvio["eventName"], "Lead">, string> = {
    Schedule: `schedule-${lead.id}`,
    ReuniaoRealizada: `realizada-${lead.id}`,
    Purchase: `purchase-${lead.id}`,
  };

  const resultados = await Promise.all(
    eventos.map(async (ev) => {
      if (ev === "Lead") return null;
      const r = await enviarParaMeta({
        brand: lead.brand,
        leadId: lead.id,
        eventName: ev,
        eventId: ID[ev],
        eventTime: now,
        actionSource: "system_generated",
        eventSourceUrl: process.env.LP_BASE_URL,
        user: pessoa,
        customData: CUSTOM[ev],
      });
      return notaDoEnvio(NOME_NA_NOTA[ev], r);
    }),
  );
  for (const n of resultados) if (n) notes.push(n);
  await registrarHistorico();

  // GA4 segue como estava (qualify_lead ao agendar, purchase ao fechar) — a
  // caixa de saída é só da Meta; GA4 fica para depois (plano, Fase 7).
  const ga4 = await Promise.all([
    eventos.includes("Schedule")
      ? sendGa4Event({
          name: "qualify_lead",
          clientId: lead.gaClientId,
          sessionId: lead.gaSessionId,
          params: {
            campaign: lead.utmCampaign,
            source: lead.utmSource,
            content: lead.utmContent,
            currency: "BRL",
            value: 0,
          },
        })
      : null,
    eventos.includes("Purchase")
      ? sendGa4Event({
          name: "purchase",
          clientId: lead.gaClientId,
          sessionId: lead.gaSessionId,
          params: {
            campaign: lead.utmCampaign,
            source: lead.utmSource,
            content: lead.utmContent,
            currency: "BRL",
            value: amount,
          },
        })
      : null,
  ]);
  if (ga4.some((g) => g?.sent)) notes.push("GA4 notificado");

  const headline =
    status === "cliente"
      ? "Cliente registrado"
      : status === "reuniao_realizada"
        ? "Reunião realizada registrada"
        : becomesBooked
          ? "Reunião marcada"
          : "Status atualizado";
  return {
    ok: true,
    message: notes.length ? `${headline} · ${notes.join(" · ")}` : `${headline}.`,
  };
}
