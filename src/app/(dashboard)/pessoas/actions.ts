"use server";

import { revalidatePath } from "next/cache";
import { addLeadEvent, getLead, restoreLead, softDeleteLead } from "@/lib/data/store";
import { everBooked } from "@/lib/metrics";
import { podeTransitar, type DadosDaTransicao } from "@/lib/lead-status";
import { can } from "@/lib/auth/guard";
import { currentActor, newEventId } from "@/lib/auth/actor";
import { aplicarStatus, type StatusResult } from "@/lib/leads/mudar-status";
import type { LeadStatus } from "@/lib/types";

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
 * Muda o status de um lead pela tela (Pessoas, Fila). Confere a permissão e a
 * transição AQUI, no servidor — a lista de opções da tela é só conveniência —
 * e aplica com `aplicarStatus` (marcos, histórico, Meta/GA4).
 */
export async function changeLeadStatus(
  leadId: string,
  status: LeadStatus,
  dados: DadosDaTransicao = {},
): Promise<StatusResult> {
  if (!(await can("leads:write"))) {
    return { ok: false, message: "Você não tem permissão para alterar leads." };
  }

  // Pelo id, não pela marca padrão: lead de qualquer marca pode mudar de status.
  const lead = await getLead(leadId);
  if (!lead || lead.deletedAt) return { ok: false, message: "Lead não encontrado." };

  const bloqueio = podeTransitar({ status: lead.status, jaAgendou: everBooked(lead) }, status, dados);
  if (bloqueio) return { ok: false, message: bloqueio };

  const r = await aplicarStatus(lead, status, dados);
  revalidatePath("/", "layout");
  return r;
}
