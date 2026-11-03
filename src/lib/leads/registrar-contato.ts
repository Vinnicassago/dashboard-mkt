import "server-only";
import { addLeadEvent, getLead, listLeadEvents, setLeadStatus } from "../data/store";
import { newEventId } from "../auth/actor";
import { proximaPelaCadencia, resumoContato, type CanalContato } from "../contato";
import { formatDateTime } from "../format";
import { encerrado, podeTransitar, statusLabel } from "../lead-status";
import { everBooked } from "../metrics";
import { RESULTADOS_CONTATO, type ResultadoContato } from "../qualificacao";
import type { Lead, LeadStatus } from "../types";
import { aplicarStatus, type StatusResult } from "./mudar-status";

/**
 * Uma tentativa de contato COM o resultado — o gesto da Fila, da ficha e da API
 * do n8n. Um lugar só, para as três gravarem igual: o evento `tentativa` (canal,
 * resultado, nota, próxima pela cadência), o marco do 1º contato, "Novo" → "Em
 * contato" e, quando o resultado encerra ou agenda, o status pela régua de
 * sempre (`podeTransitar` + `aplicarStatus`).
 */
export interface RegistroDeContato {
  canal: CanalContato;
  resultado: ResultadoContato;
  /** As notas da ligação (texto livre). */
  nota?: string;
  /** Quando aconteceu (ISO). Padrão: agora. */
  ocorreuEm?: string;
  /** Data e hora da reunião — obrigatória quando o resultado é "Agendou". */
  reuniaoEm?: string;
  /** Quem registra. A tela passa o usuário logado; a API, "n8n". */
  actor: string;
  /**
   * Quando tentar de novo depois de uma tentativa sem conversa (a cadência).
   * Padrão: `proximaPelaCadencia`.
   */
  proxima?: (ocorreuEm: string, n: number) => string | undefined;
}

export interface ContatoRegistrado extends StatusResult {
  /** Id do evento da tentativa — o que "Desfazer" desfaz. */
  eventoId?: string;
  /** Status depois do registro. */
  status?: LeadStatus;
}

/** Resultados em que a pessoa atendeu (a cadência para). */
const FALOU: ResultadoContato[] = ["falou", "agendou", "sem_interesse"];
const TETO_NOTA = 2000;
/** Tentativa registrada depois do fato: até 7 dias (como a tela sempre aceitou). */
const ATRASO_MAXIMO_MS = 7 * 86_400_000;

export async function registrarContato(leadId: string, r: RegistroDeContato): Promise<ContatoRegistrado> {
  const lead = await getLead(leadId);
  if (!lead || lead.deletedAt) return { ok: false, message: "Lead não encontrado." };
  if (encerrado(lead.status)) {
    return { ok: false, message: `O lead está encerrado como “${statusLabel(lead.status)}”.` };
  }
  if (!Object.hasOwn(RESULTADOS_CONTATO, r.resultado)) {
    return { ok: false, message: "Resultado de contato desconhecido." };
  }

  const agora = Date.now();
  let quando = new Date(agora).toISOString();
  if (r.ocorreuEm) {
    const t = Date.parse(r.ocorreuEm);
    if (!Number.isFinite(t) || t > agora + 60_000 || t < agora - ATRASO_MAXIMO_MS) {
      return { ok: false, message: "A tentativa precisa ser de agora ou dos últimos 7 dias." };
    }
    quando = new Date(t).toISOString();
  }

  const antes = resumoContato(await listLeadEvents({ leadId, limit: 0 }));

  // O desfecho que o resultado pede, conferido ANTES de gravar qualquer coisa:
  // "Agendou" sem data não vira meia escrita (tentativa gravada, status não).
  const destino: LeadStatus | undefined =
    r.resultado === "agendou"
      ? "agendado"
      : r.resultado === "numero_invalido"
        ? "contato_invalido"
        : r.resultado === "sem_interesse"
          ? "sem_interesse"
          : undefined;
  const dadosDoDestino =
    destino === "agendado"
      ? { meetingFor: r.reuniaoEm }
      : destino === "contato_invalido"
        ? { motivo: "numero_inexistente" }
        : {};
  if (destino) {
    // O status de onde a transição parte é o de DEPOIS da tentativa ("Novo" já terá virado "Em contato").
    const bloqueio = podeTransitar(
      {
        status: lead.status === "lead" ? "em_contato" : lead.status,
        jaAgendou: everBooked(lead),
        tentativas: antes.tentativas + 1,
        diasComTentativa: antes.diasComTentativa,
      },
      destino,
      dadosDoDestino,
    );
    if (bloqueio) return { ok: false, message: bloqueio };
  }

  const falou = FALOU.includes(r.resultado);
  const n = antes.tentativas + 1;
  const proxima = falou ? undefined : (r.proxima ?? proximaPelaCadencia)(quando, n);
  const nota = r.nota?.trim().slice(0, TETO_NOTA) || undefined;
  const eventoId = newEventId();

  await addLeadEvent({
    id: eventoId,
    leadId,
    brand: lead.brand,
    leadName: lead.name,
    actor: r.actor,
    action: "tentativa",
    payload: {
      canal: r.canal,
      falou: falou ? "sim" : "nao",
      resultado: r.resultado,
      ...(nota ? { nota } : {}),
      ...(proxima ? { proxima } : {}),
    },
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
      actor: r.actor,
      action: "status_changed",
      fromStatus: statusAntes,
      toStatus: novoStatus,
      occurredAt: quando,
      createdAt: new Date().toISOString(),
    });
  }

  if (destino) {
    const atual: Lead = { ...lead, status: novoStatus, firstContactAt: lead.firstContactAt ?? quando };
    const s = await aplicarStatus(atual, destino, dadosDoDestino, { actor: r.actor });
    return { ...s, eventoId, status: destino };
  }

  return {
    ok: true,
    eventoId,
    status: novoStatus,
    message: falou
      ? "Contato registrado. Agora registre o desfecho: agendar, sem interesse…"
      : proxima
        ? `Tentativa ${n} sem resposta registrada. Próxima: ${formatDateTime(proxima)}.`
        : `Tentativa ${n} sem resposta registrada — a cadência terminou; já dá para encerrar como “Sem resposta”.`,
  };
}
