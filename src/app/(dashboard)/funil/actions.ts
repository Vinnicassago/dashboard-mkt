"use server";

import { revalidatePath } from "next/cache";
import { addLeadEvent, deleteLead, getData, setLeadStatus } from "@/lib/data/store";
import { isBooked } from "@/lib/metrics";
import { can } from "@/lib/auth/guard";
import { currentActor, newEventId } from "@/lib/auth/actor";
import { sendCapiEvent } from "@/lib/meta/capi";
import { sendGa4Event } from "@/lib/ga4/measurement-protocol";
import type { LeadStatus } from "@/lib/types";

export interface StatusResult {
  ok: boolean;
  message: string;
}

/**
 * Exclui um lead permanentemente (ex.: entradas de teste que não devem ser
 * contabilizadas). Remove o lead e seus eventos de auditoria. Não notifica
 * Meta/GA4 — exclusão é interna.
 */
export async function deleteLeadAction(leadId: string): Promise<StatusResult> {
  if (!(await can("leads:write"))) {
    return { ok: false, message: "Você não tem permissão para excluir leads." };
  }
  const data = await getData();
  const lead = data.leads.find((l) => l.id === leadId);
  if (!lead) return { ok: false, message: "Lead não encontrado." };
  await deleteLead(leadId);
  revalidatePath("/", "layout");
  return { ok: true, message: `Lead "${lead.name}" excluído.` };
}

/**
 * Change a lead's status and, on the transition into "booked", report the
 * meeting back to Meta and GA4.
 *
 * Sending this signal is the point of the whole loop: it teaches the campaign
 * to optimise for leads that actually schedule, not just cheap form fills.
 */
export async function changeLeadStatus(
  leadId: string,
  status: LeadStatus,
  value?: number,
): Promise<StatusResult> {
  if (!(await can("leads:write"))) {
    return { ok: false, message: "Você não tem permissão para alterar leads." };
  }

  const data = await getData();
  const lead = data.leads.find((l) => l.id === leadId);
  if (!lead) return { ok: false, message: "Lead não encontrado." };

  const prevStatus = lead.status;
  const wasBooked = isBooked(lead);
  const becomesBooked = status === "agendou" || status === "compareceu" || status === "cliente";
  const meetingAt = becomesBooked && !lead.meetingAt ? new Date().toISOString() : undefined;

  await setLeadStatus(leadId, status, meetingAt, value);

  // Audit trail: record who changed the status, and from/to what.
  if (prevStatus !== status) {
    await addLeadEvent({
      id: newEventId(),
      leadId,
      leadName: lead.name,
      actor: await currentActor(),
      action: "status_changed",
      fromStatus: prevStatus,
      toStatus: status,
      createdAt: new Date().toISOString(),
    });
  }
  revalidatePath("/", "layout");

  const shouldSchedule = becomesBooked && !wasBooked;
  const becameClient = status === "cliente" && prevStatus !== "cliente";
  if (!shouldSchedule && !becameClient) {
    return { ok: true, message: "Status atualizado." };
  }

  const firstName = lead.name.split(/\s+/)[0];
  const notes: string[] = [];

  // Reunião agendada → Schedule (event_id estável deduplica reenvios em 48h).
  if (shouldSchedule) {
    const [capi, ga4] = await Promise.all([
      sendCapiEvent({
        eventName: "Schedule",
        eventId: `schedule-${leadId}`,
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
    else if (capi.detail !== "CAPI não configurado") notes.push(`CAPI: ${capi.detail}`);
    if (ga4.sent) notes.push("GA4 notificado");
  }

  // Virou cliente → Purchase de alto valor (ensina a Meta a otimizar por venda).
  if (becameClient) {
    const amount = value ?? lead.value ?? 0;
    const [capi, ga4] = await Promise.all([
      sendCapiEvent({
        eventName: "Purchase",
        eventId: `purchase-${leadId}`,
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
    else if (capi.detail !== "CAPI não configurado") notes.push(`CAPI: ${capi.detail}`);
    if (ga4.sent) notes.push("GA4 notificado (compra)");
  }

  const headline = becameClient ? "Cliente registrado" : "Reunião marcada";
  return {
    ok: true,
    message: notes.length ? `${headline} · ${notes.join(" · ")}` : `${headline}.`,
  };
}
