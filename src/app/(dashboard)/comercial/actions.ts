"use server";

import { revalidatePath } from "next/cache";
import { updateComercial, type ComercialPatch } from "@/lib/robo/client";
import { changeLeadStatus } from "@/app/(dashboard)/funil/actions";
import { getData, setLeadStatus } from "@/lib/data/store";
import { mesmoTelefone } from "@/lib/phone";
import { can } from "@/lib/auth/guard";
import { isBookedStatus, isLostStatus, statusRank } from "@/lib/lead-status";
import type { Lead, LeadStatus } from "@/lib/types";

export interface ComercialResult {
  ok: boolean;
  message: string;
}

export type CampoComercial =
  | "abordado"
  | "reuniao_marcada"
  | "reuniao_realizada"
  | "negocio_fechado"
  | "obs_comercial";

/** Campos cuja edição move o status do lead no painel (os outros são só registro). */
const DECIDE_STATUS = new Set<CampoComercial>([
  "reuniao_marcada",
  "reuniao_realizada",
  "negocio_fechado",
]);

// ---------------------------------------------------------------- pareamento

/**
 * Acha o lead do painel que corresponde ao lead do robô.
 *
 * Os dois vivem em bancos diferentes — o do painel vem do rastreio da landing
 * page (com fbc/fbp/GA), o do robô vem do WhatsApp. O telefone é o único campo
 * em comum, então é por ele que casamos. Sem esse pareamento, marcar uma reunião
 * aqui não chegaria à Meta nem ao funil.
 */
async function acharLead(telefone: string | null, sessionId?: string): Promise<Lead | null> {
  const data = await getData();
  // Par já gravado num pareamento anterior: não depende de o telefone continuar
  // batendo (o comercial corrige número, o robô recebe de outro aparelho).
  if (sessionId) {
    const salvo = data.leads.find((l) => l.roboSessionId === sessionId);
    if (salvo) return salvo;
  }
  if (!telefone) return null;
  return data.leads.find((l) => mesmoTelefone(l.phone, telefone)) ?? null;
}

/**
 * Qual status do painel cada decisão comercial representa.
 *
 * O robô guarda reunião marcada / realizada / negócio fechado em três colunas
 * INDEPENDENTES; o painel tem um único status. Esta função é a tradução — e é
 * onde a informação se perde, então ela é o mínimo possível.
 *
 * "Negócio fechado: não" só vira `desistencia` (perda por decisão) para quem
 * chegou a agendar; quem nunca agendou e foi descartado é `sem_interesse`.
 * Os dois são perda por `decisao` — a diferença é o que a quebra de perdas
 * mostra ao marketing.
 */
function statusDaDecisao(
  campo: CampoComercial,
  valor: string,
  atual: LeadStatus,
): LeadStatus | null {
  if (valor === "sim") {
    if (campo === "reuniao_marcada") return "agendado";
    if (campo === "reuniao_realizada") return "reuniao_realizada";
    if (campo === "negocio_fechado") return "cliente";
  }
  if (valor === "nao" && campo === "negocio_fechado") {
    return isBookedStatus(atual) ? "desistencia" : "sem_interesse";
  }
  return null;
}

// ---------------------------------------------------------------- ação

/**
 * Grava o acompanhamento comercial e propaga a decisão para o resto do painel.
 *
 * "Abordado" não é booleano no banco: guardamos o INSTANTE do primeiro contato,
 * que é o que permite medir o tempo desde a transferência.
 */
export async function salvarComercial(
  sessionId: string,
  campo: CampoComercial,
  valor: string,
  telefone?: string | null,
  valorNegocio?: number,
): Promise<ComercialResult> {
  if (!(await can("leads:write"))) {
    return { ok: false, message: "Você não tem permissão para alterar leads." };
  }

  const patch: ComercialPatch = {};
  if (campo === "abordado") {
    patch.abordado_em = valor === "sim" ? new Date().toISOString() : null;
  } else if (campo === "obs_comercial") {
    patch.obs_comercial = valor.trim() || null;
  } else {
    patch[campo] = valor === "" ? null : valor;
  }

  try {
    await updateComercial(sessionId, patch);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Falha ao salvar." };
  }

  // Reunião e venda alimentam o funil, as metas e o aprendizado da campanha.
  if (!DECIDE_STATUS.has(campo)) {
    revalidatePath("/comercial");
    return { ok: true, message: "Salvo." };
  }

  const lead = await acharLead(telefone ?? null, sessionId);
  if (!lead) {
    revalidatePath("/comercial");
    revalidatePath("/fila");
    return {
      ok: true,
      message:
        "Salvo aqui, mas não achei esse telefone entre os leads da campanha — a reunião não entra no funil enquanto o par não existir.",
    };
  }

  // Achou pelo telefone e ainda não tinha par gravado: carimba agora, para o
  // casamento não precisar ser refeito (nem depender do número continuar batendo).
  if (!lead.roboSessionId) {
    await setLeadStatus(lead.id, lead.status, { roboSessionId: sessionId });
  }

  const novoStatus = statusDaDecisao(campo, valor, lead.status);
  if (!novoStatus) {
    revalidatePath("/comercial");
    revalidatePath("/fila");
    return { ok: true, message: "Salvo." };
  }

  // Nunca rebaixa no caminho feliz: marcar "reunião realizada" em quem já é
  // cliente não desfaz a venda. Perda é exceção — o comercial precisa poder
  // registrar que o lead morreu, mesmo depois de ele ter avançado, e desde a
  // migração de marcos isso não apaga mais a reunião do CPR: `booked_at` fica
  // gravado e `isBooked` lê o fato, não o status atual.
  if (!isLostStatus(novoStatus) && statusRank(novoStatus) <= statusRank(lead.status)) {
    revalidatePath("/comercial");
    revalidatePath("/fila");
    return { ok: true, message: "Salvo." };
  }

  const r = await changeLeadStatus(lead.id, novoStatus, valorNegocio);
  revalidatePath("/comercial");
  revalidatePath("/fila");
  return { ok: true, message: r.message };
}
