"use server";

import { revalidatePath } from "next/cache";
import { addLeadEvent, getLead, restoreLead, setLeadStatus, softDeleteLead } from "@/lib/data/store";
import { isBooked } from "@/lib/metrics";
import { isBookedStatus, isLostStatus } from "@/lib/lead-status";
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
 * Exclui um lead (ex.: teste, duplicado, spam) de forma REVERSÍVEL: ele sai de
 * todas as listas e métricas, mas a linha e o histórico ficam, com quem excluiu
 * e por quê — e dá para restaurar. Só administrador. Não notifica Meta/GA4.
 */
export async function deleteLeadAction(leadId: string, reason: string): Promise<StatusResult> {
  if (!(await can("leads:delete"))) {
    return { ok: false, message: "Só um administrador pode excluir leads." };
  }
  const motivo = reason.trim();
  if (!motivo) return { ok: false, message: "Diga o motivo da exclusão." };
  const lead = await getLead(leadId);
  if (!lead || lead.deletedAt) return { ok: false, message: "Lead não encontrado." };

  const actor = await currentActor();
  const at = new Date().toISOString();
  await softDeleteLead(leadId, { at, by: actor, reason: motivo.slice(0, 200) });
  await addLeadEvent({
    id: newEventId(),
    leadId,
    brand: lead.brand,
    leadName: lead.name,
    actor,
    action: "excluido",
    payload: { motivo: motivo.slice(0, 200) },
    createdAt: at,
  });
  revalidatePath("/", "layout");
  return { ok: true, message: `Lead "${lead.name}" excluído. Dá para restaurar em "Excluídos".` };
}

/** Desfaz uma exclusão: o lead volta às listas e métricas como estava. */
export async function restoreLeadAction(leadId: string): Promise<StatusResult> {
  if (!(await can("leads:delete"))) {
    return { ok: false, message: "Só um administrador pode restaurar leads." };
  }
  const lead = await getLead(leadId);
  if (!lead?.deletedAt) return { ok: false, message: "Este lead não está excluído." };
  await restoreLead(leadId);
  await addLeadEvent({
    id: newEventId(),
    leadId,
    brand: lead.brand,
    leadName: lead.name,
    actor: await currentActor(),
    action: "restaurado",
    createdAt: new Date().toISOString(),
  });
  revalidatePath("/", "layout");
  return { ok: true, message: `Lead "${lead.name}" restaurado.` };
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

  // Pelo id, não pela marca padrão: lead de qualquer marca pode mudar de status.
  const lead = await getLead(leadId);
  if (!lead || lead.deletedAt) return { ok: false, message: "Lead não encontrado." };

  const prevStatus = lead.status;
  const wasBooked = isBooked(lead);
  const becomesBooked = isBookedStatus(status);
  const now = new Date().toISOString();
  const meetingAt = becomesBooked && !lead.meetingAt ? now : undefined;

  /**
   * Carimba os marcos desta transição. O store só grava o que ainda estiver
   * vazio, então avançar e depois perder o lead preserva o fato — é isso que
   * mantém a reunião no CPR mesmo quando o comercial registra o desfecho.
   */
  await setLeadStatus(leadId, status, {
    meetingAt,
    value,
    bookedAt: becomesBooked ? now : undefined,
    attendedAt: status === "reuniao_realizada" || status === "cliente" ? now : undefined,
    closedAt: status === "cliente" ? now : undefined,
    lostAt: isLostStatus(status) ? now : null,
  });

  // Audit trail: record who changed the status, and from/to what.
  if (prevStatus !== status) {
    await addLeadEvent({
      id: newEventId(),
      leadId,
      brand: lead.brand,
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
