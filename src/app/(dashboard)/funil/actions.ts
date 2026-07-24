"use server";

import { revalidatePath } from "next/cache";
import { addLeadEvent, getData, setLeadStatus } from "@/lib/data/store";
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
 * Change a lead's status and, on the transition into "booked", report the
 * meeting back to Meta and GA4.
 *
 * Sending this signal is the point of the whole loop: it teaches the campaign
 * to optimise for leads that actually schedule, not just cheap form fills.
 */
export async function changeLeadStatus(
  leadId: string,
  status: LeadStatus,
): Promise<StatusResult> {
  if (!(await can("leads:write"))) {
    return { ok: false, message: "Você não tem permissão para alterar leads." };
  }

  const data = await getData();
  const lead = data.leads.find((l) => l.id === leadId);
  if (!lead) return { ok: false, message: "Lead não encontrado." };

  const prevStatus = lead.status;
  const wasBooked = isBooked(lead);
  const becomesBooked = status === "agendou" || status === "compareceu";
  const meetingAt = becomesBooked && !lead.meetingAt ? new Date().toISOString() : undefined;

  await setLeadStatus(leadId, status, meetingAt);

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

  if (wasBooked || !becomesBooked) {
    return { ok: true, message: "Status atualizado." };
  }

  // Stable event_id: re-marking the same lead within 48h is deduplicated by
  // Meta instead of counting a second meeting.
  const eventId = `schedule-${leadId}`;

  const [capi, ga4] = await Promise.all([
    sendCapiEvent({
      eventName: "Schedule",
      eventId,
      // raised by our back office, not by the visitor's browser
      actionSource: "system_generated",
      eventSourceUrl: process.env.LP_BASE_URL,
      user: {
        firstName: lead.name.split(/\s+/)[0],
        fbc: lead.fbc,
        fbp: lead.fbp,
        externalId: lead.id,
      },
      customData: { content_name: "Reunião agendada", currency: "BRL" },
    }),
    // GA4 has no standard "schedule" event; qualify_lead is the recommended
    // lead-gen event and shows up in the built-in Lead Generation reports.
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

  const notes: string[] = [];
  if (capi.sent) notes.push("Schedule enviado à Meta");
  else if (capi.detail !== "CAPI não configurado") notes.push(`CAPI: ${capi.detail}`);
  if (ga4.sent) notes.push("GA4 notificado");

  return {
    ok: true,
    message: notes.length ? `Reunião marcada · ${notes.join(" · ")}` : "Reunião marcada.",
  };
}
