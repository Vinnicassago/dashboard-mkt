"use server";

import { revalidatePath } from "next/cache";
import {
  addLead,
  addLeadEvent,
  getLead,
  listLeadEvents,
  listLeads,
  restoreLead,
  setLeadStatus,
  softDeleteLead,
} from "@/lib/data/store";
import { everBooked } from "@/lib/metrics";
import { gruposDuplicados } from "@/lib/identidade";
import { encerrado, podeTransitar, statusLabel, type DadosDaTransicao } from "@/lib/lead-status";
import { proximaPelaCadencia, resumoContato, type CanalContato } from "@/lib/contato";
import { formatDateTime } from "@/lib/format";
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

  const resumo = resumoContato(await listLeadEvents({ leadId, limit: 0 }));
  const bloqueio = podeTransitar(
    {
      status: lead.status,
      jaAgendou: everBooked(lead),
      tentativas: resumo.tentativas,
      diasComTentativa: resumo.diasComTentativa,
    },
    status,
    dados,
  );
  if (bloqueio) return { ok: false, message: bloqueio };

  const r = await aplicarStatus(lead, status, dados);
  revalidatePath("/", "layout");
  return r;
}

// ---------------------------------------------------------------- tentativas

export interface TentativaResult extends StatusResult {
  /** Id do evento — o que "Desfazer" desfaz. */
  eventoId?: string;
}

/** Tentativa só vale como desfeita dentro desta janela (o botão some antes). */
const JANELA_DESFAZER_MS = 10 * 60_000;

/**
 * Registra uma tentativa de contato — o gesto que faltava (2.4 do relatório:
 * "não existe tentativa"). Grava o evento com canal, resultado e a próxima
 * tentativa pela cadência; na 1ª, carimba o marco `firstContactAt` e o lead sai
 * de "Novo" para "Em contato". `ocorreuEm` permite registrar depois (até 7 dias).
 */
export async function registrarTentativa(
  leadId: string,
  canal: CanalContato,
  falou: boolean,
  ocorreuEm?: string,
): Promise<TentativaResult> {
  if (!(await can("leads:write"))) {
    return { ok: false, message: "Você não tem permissão para alterar leads." };
  }
  const lead = await getLead(leadId);
  if (!lead || lead.deletedAt) return { ok: false, message: "Lead não encontrado." };
  if (encerrado(lead.status)) {
    return { ok: false, message: `O lead está encerrado como “${statusLabel(lead.status)}”.` };
  }

  const agora = Date.now();
  let quando = new Date(agora).toISOString();
  if (ocorreuEm) {
    const t = Date.parse(ocorreuEm);
    if (!Number.isFinite(t) || t > agora + 60_000 || t < agora - 7 * 86_400_000) {
      return { ok: false, message: "A tentativa precisa ser de agora ou dos últimos 7 dias." };
    }
    quando = new Date(t).toISOString();
  }

  const antes = resumoContato(await listLeadEvents({ leadId, limit: 0 }));
  const n = antes.tentativas + 1;
  const proxima = falou ? undefined : proximaPelaCadencia(quando, n);
  const actor = await currentActor();
  const eventoId = newEventId();

  await addLeadEvent({
    id: eventoId,
    leadId,
    brand: lead.brand,
    leadName: lead.name,
    actor,
    action: "tentativa",
    payload: { canal, falou: falou ? "sim" : "nao", ...(proxima ? { proxima } : {}) },
    occurredAt: quando,
    createdAt: new Date().toISOString(),
  });

  // 1ª tentativa: marco gravado uma vez, e "Novo" vira "Em contato".
  const statusAntes = lead.status;
  const novoStatus = statusAntes === "lead" ? "em_contato" : statusAntes;
  await setLeadStatus(leadId, novoStatus, { firstContactAt: quando });
  if (novoStatus !== statusAntes) {
    await addLeadEvent({
      id: newEventId(),
      leadId,
      brand: lead.brand,
      leadName: lead.name,
      actor,
      action: "status_changed",
      fromStatus: statusAntes,
      toStatus: novoStatus,
      occurredAt: quando,
      createdAt: new Date().toISOString(),
    });
  }
  revalidatePath("/", "layout");

  if (falou) {
    return { ok: true, eventoId, message: "Contato registrado. Agora registre o desfecho: agendar, sem interesse…" };
  }
  return {
    ok: true,
    eventoId,
    message: proxima
      ? `Tentativa ${n} sem resposta registrada. Próxima: ${formatDateTime(proxima)}.`
      : `Tentativa ${n} sem resposta registrada — a cadência terminou; já dá para encerrar como “Sem resposta”.`,
  };
}

/**
 * Desfaz uma tentativa registrada por engano (clique errado). Não apaga nada: o
 * histórico ganha um evento "desfeito" e o resumo deixa de contá-la. Se era a
 * única, o lead volta a "Novo" e o marco do 1º contato é limpo — o fato não
 * aconteceu.
 */
export async function desfazerTentativa(leadId: string, eventoId: string): Promise<StatusResult> {
  if (!(await can("leads:write"))) {
    return { ok: false, message: "Você não tem permissão para alterar leads." };
  }
  const lead = await getLead(leadId);
  if (!lead) return { ok: false, message: "Lead não encontrado." };
  const eventos = await listLeadEvents({ leadId, limit: 0 });
  const alvo = eventos.find((e) => e.id === eventoId && e.action === "tentativa");
  if (!alvo) return { ok: false, message: "Tentativa não encontrada." };
  if (Date.now() - Date.parse(alvo.createdAt) > JANELA_DESFAZER_MS) {
    return { ok: false, message: "Passou o tempo para desfazer esta tentativa." };
  }
  if (eventos.some((e) => e.action === "desfeito" && e.payload?.evento === eventoId)) {
    return { ok: true, message: "Já estava desfeita." };
  }

  const actor = await currentActor();
  await addLeadEvent({
    id: newEventId(),
    leadId,
    brand: lead.brand,
    leadName: lead.name,
    actor,
    action: "desfeito",
    payload: { evento: eventoId },
    createdAt: new Date().toISOString(),
  });

  const depois = resumoContato([
    ...eventos,
    { ...alvo, id: "x", action: "desfeito", payload: { evento: eventoId } },
  ]);
  if (depois.tentativas === 0 && lead.status === "em_contato") {
    await setLeadStatus(leadId, "lead", { firstContactAt: null });
    await addLeadEvent({
      id: newEventId(),
      leadId,
      brand: lead.brand,
      leadName: lead.name,
      actor,
      action: "status_changed",
      fromStatus: "em_contato",
      toStatus: "lead",
      payload: { motivo: "tentativa desfeita" },
      createdAt: new Date().toISOString(),
    });
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Tentativa desfeita." };
}

/**
 * Reabre um lead encerrado (perda ou cliente) — só administrador, com motivo.
 * Os marcos ficam (a reunião que aconteceu continua contando); o status volta a
 * "Em contato" se já houve tentativa, senão a "Novo".
 */
export async function reabrirLead(leadId: string, motivo: string): Promise<StatusResult> {
  if (!(await can("leads:delete"))) {
    return { ok: false, message: "Só um administrador pode reabrir um lead encerrado." };
  }
  const m = motivo.trim();
  if (!m) return { ok: false, message: "Diga por que o lead está sendo reaberto." };
  const lead = await getLead(leadId);
  if (!lead || lead.deletedAt) return { ok: false, message: "Lead não encontrado." };
  if (!encerrado(lead.status)) return { ok: false, message: "Este lead não está encerrado." };

  const resumo = resumoContato(await listLeadEvents({ leadId, limit: 0 }));
  const novo = resumo.tentativas > 0 ? "em_contato" : "lead";
  await setLeadStatus(leadId, novo, { lostAt: null, lostReasonDetail: null });
  await addLeadEvent({
    id: newEventId(),
    leadId,
    brand: lead.brand,
    leadName: lead.name,
    actor: await currentActor(),
    action: "reaberto",
    fromStatus: lead.status,
    toStatus: novo,
    payload: { motivo: m.slice(0, 200) },
    createdAt: new Date().toISOString(),
  });
  revalidatePath("/", "layout");
  return { ok: true, message: `Lead reaberto como “${statusLabel(novo)}”.` };
}

// ---------------------------------------------------------------- ficha e higiene

/** Anotação livre na ficha (o que a pessoa disse, o combinado). Vira evento. */
export async function anotarLead(leadId: string, texto: string): Promise<StatusResult> {
  if (!(await can("leads:write"))) {
    return { ok: false, message: "Você não tem permissão para alterar leads." };
  }
  const t = texto.trim();
  if (!t) return { ok: false, message: "Escreva a anotação." };
  const lead = await getLead(leadId);
  if (!lead) return { ok: false, message: "Lead não encontrado." };
  await addLeadEvent({
    id: newEventId(),
    leadId,
    brand: lead.brand,
    leadName: lead.name,
    actor: await currentActor(),
    action: "nota",
    payload: { texto: t.slice(0, 2000) },
    createdAt: new Date().toISOString(),
  });
  revalidatePath("/", "layout");
  return { ok: true, message: "Anotação salva." };
}

/**
 * Junta cadastros da mesma pessoa (D2). O principal fica; cada duplicado lhe
 * empresta o contato que faltava e os marcos que ele não tinha (gravados uma vez,
 * como sempre) e é EXCLUÍDO de forma reversível, com o motivo apontando para o
 * principal. Nada é apagado: o histórico do duplicado continua no id dele e a
 * ficha do principal o mostra. Só administrador, e só para cadastros que o
 * servidor também reconhece como a mesma pessoa (telefone ou e-mail).
 */
export async function mesclarLeads(principalId: string, duplicadoIds: string[]): Promise<StatusResult> {
  if (!(await can("leads:delete"))) {
    return { ok: false, message: "Só um administrador pode mesclar leads." };
  }
  const principal = await getLead(principalId);
  if (!principal || principal.deletedAt) return { ok: false, message: "Lead principal não encontrado." };
  const ids = [...new Set(duplicadoIds)].filter((id) => id !== principalId);
  if (!ids.length) return { ok: false, message: "Nada para mesclar." };

  const grupo = gruposDuplicados(await listLeads(principal.brand)).find((g) =>
    [g.principal, ...g.duplicados].some((l) => l.id === principalId),
  );
  const doGrupo = new Set(grupo ? [grupo.principal, ...grupo.duplicados].map((l) => l.id) : []);
  if (ids.some((id) => !doGrupo.has(id))) {
    return { ok: false, message: "Esses cadastros não têm telefone nem e-mail em comum — não são a mesma pessoa." };
  }

  const actor = await currentActor();
  for (const id of ids) {
    const dup = await getLead(id);
    if (!dup || dup.deletedAt) continue;
    const at = new Date().toISOString();
    // Contato que faltava no principal (addLead num id existente só PREENCHE).
    await addLead({ ...dup, id: principal.id, brand: principal.brand });
    // Marcos que o principal não tinha: a reunião que aconteceu no outro cadastro
    // aconteceu com esta pessoa. Gravados uma vez — nada é sobrescrito.
    const atual = (await getLead(principal.id)) ?? principal;
    const marcos = {
      ...(dup.firstContactAt ? { firstContactAt: dup.firstContactAt } : {}),
      ...(dup.bookedAt ? { bookedAt: dup.bookedAt } : {}),
      ...(dup.attendedAt ? { attendedAt: dup.attendedAt } : {}),
      ...(dup.closedAt ? { closedAt: dup.closedAt } : {}),
    };
    if (Object.keys(marcos).length) await setLeadStatus(principal.id, atual.status, marcos);

    const motivo = `duplicado de ${principal.name} (${principal.id})`;
    await softDeleteLead(dup.id, { at, by: actor, reason: motivo.slice(0, 200) });
    await addLeadEvent({
      id: newEventId(),
      leadId: dup.id,
      brand: dup.brand,
      leadName: dup.name,
      actor,
      action: "excluido",
      payload: { motivo: motivo.slice(0, 200), mescladoEm: principal.id },
      createdAt: at,
    });
    await addLeadEvent({
      id: newEventId(),
      leadId: principal.id,
      brand: principal.brand,
      leadName: principal.name,
      actor,
      action: "mesclado",
      payload: {
        duplicado: dup.id,
        nome: dup.name,
        status: statusLabel(dup.status),
        entrada: dup.createdAt,
        ...(dup.utmContent ? { origem: dup.utmContent } : {}),
      },
      createdAt: at,
    });
  }
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: `${ids.length === 1 ? "1 cadastro mesclado" : `${ids.length} cadastros mesclados`} em “${principal.name}”. Dá para restaurar em "Excluídos".`,
  };
}

/** Destinos aceitos para corrigir uma "Desistência" de quem nunca agendou. */
const CORRECOES_DESISTENCIA: LeadStatus[] = ["sem_interesse", "sem_resposta"];

/**
 * Corrige o legado de "Desistência" sem reunião (B19): antes da Fase 1 a tela
 * deixava escolher desistência para quem nunca agendou, e isso contava como
 * perda por DECISÃO (oferta) quando era de QUALIDADE (mídia). Só administrador;
 * a data da perda fica, o histórico registra a correção.
 */
export async function corrigirDesistenciaSemReuniao(leadId: string, para: LeadStatus): Promise<StatusResult> {
  if (!(await can("leads:delete"))) {
    return { ok: false, message: "Só um administrador pode corrigir o status de um lead encerrado." };
  }
  if (!CORRECOES_DESISTENCIA.includes(para)) return { ok: false, message: "Correção inválida." };
  const lead = await getLead(leadId);
  if (!lead || lead.deletedAt) return { ok: false, message: "Lead não encontrado." };
  if (lead.status !== "desistencia" || everBooked(lead)) {
    return { ok: false, message: "Só se corrige assim a desistência de quem nunca agendou." };
  }
  await setLeadStatus(leadId, para, { lostReasonDetail: null });
  await addLeadEvent({
    id: newEventId(),
    leadId,
    brand: lead.brand,
    leadName: lead.name,
    actor: await currentActor(),
    action: "status_changed",
    fromStatus: lead.status,
    toStatus: para,
    payload: { correcao: "desistência de quem nunca agendou" },
    createdAt: new Date().toISOString(),
  });
  revalidatePath("/", "layout");
  return { ok: true, message: `“${lead.name}” corrigido para “${statusLabel(para)}”.` };
}
