import "server-only";
import { addLeadEvent, setLeadStatus } from "../data/store";
import { isBooked } from "../metrics";
import {
  MOTIVOS_CONTATO_INVALIDO,
  isBookedStatus,
  isLostStatus,
  type DadosDaTransicao,
} from "../lead-status";
import { currentActor, newEventId } from "../auth/actor";
import { sendCapiEvent } from "../meta/capi";
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

/**
 * Aplica uma mudança de status JÁ AUTORIZADA E VALIDADA: grava status, marcos e
 * a data da reunião, registra no histórico e, ao virar reunião ou cliente, avisa
 * Meta e GA4. Quem chama decide as regras — a tela usa `podeTransitar`; a ponte
 * do robô usa as dela (o robô não sabe a data da reunião).
 */
export async function aplicarStatus(
  lead: Lead,
  status: LeadStatus,
  dados: DadosDaTransicao = {},
): Promise<StatusResult> {
  const prevStatus = lead.status;
  const wasBooked = isBooked(lead);
  const becomesBooked = isBookedStatus(status);
  const now = new Date().toISOString();
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

  // Audit trail: record who changed the status, and from/to what.
  if (prevStatus !== status) {
    await addLeadEvent({
      id: newEventId(),
      leadId: lead.id,
      brand: lead.brand,
      leadName: lead.name,
      actor: await currentActor(),
      action: "status_changed",
      fromStatus: prevStatus,
      toStatus: status,
      payload: payloadDaMudanca(dados, motivo),
      createdAt: now,
    });
  }

  const shouldSchedule = becomesBooked && !wasBooked;
  const becameClient = status === "cliente" && prevStatus !== "cliente";
  if (!shouldSchedule && !becameClient) {
    return { ok: true, message: "Status atualizado." };
  }

  const firstName = lead.name.split(/\s+/)[0];
  const notes: string[] = [];
  /** Erro técnico vai para o log; a tela recebe uma frase. */
  const falhou = (onde: string, detalhe: string) => {
    console.warn(`[status] ${onde} não recebeu o evento do lead ${lead.id}: ${detalhe}`);
    notes.push(`${onde} não recebeu o aviso (detalhe no log do servidor)`);
  };

  // Reunião agendada → Schedule (event_id estável deduplica reenvios em 48h).
  if (shouldSchedule) {
    const [capi, ga4] = await Promise.all([
      sendCapiEvent({
        eventName: "Schedule",
        eventId: `schedule-${lead.id}`,
        actionSource: "system_generated",
        eventSourceUrl: process.env.LP_BASE_URL,
        user: { firstName, fbc: lead.fbc, fbp: lead.fbp, externalId: lead.id },
        customData: { content_name: "Reunião agendada", currency: "BRL" },
      }),
      sendGa4Event({
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
      }),
    ]);
    if (capi.sent) notes.push("Schedule enviado à Meta");
    else if (capi.detail !== "CAPI não configurado") falhou("A Meta", capi.detail);
    if (ga4.sent) notes.push("GA4 notificado");
  }

  // Virou cliente → Purchase de alto valor (ensina a Meta a otimizar por venda).
  if (becameClient) {
    const amount = dados.value ?? lead.value ?? 0;
    const [capi, ga4] = await Promise.all([
      sendCapiEvent({
        eventName: "Purchase",
        eventId: `purchase-${lead.id}`,
        actionSource: "system_generated",
        eventSourceUrl: process.env.LP_BASE_URL,
        user: { firstName, fbc: lead.fbc, fbp: lead.fbp, externalId: lead.id },
        customData: { content_name: "Cliente (carta de crédito)", currency: "BRL", value: amount },
      }),
      sendGa4Event({
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
      }),
    ]);
    if (capi.sent) notes.push("Purchase enviado à Meta");
    else if (capi.detail !== "CAPI não configurado") falhou("A Meta", capi.detail);
    if (ga4.sent) notes.push("GA4 notificado (compra)");
  }

  const headline = becameClient ? "Cliente registrado" : "Reunião marcada";
  return {
    ok: true,
    message: notes.length ? `${headline} · ${notes.join(" · ")}` : `${headline}.`,
  };
}
