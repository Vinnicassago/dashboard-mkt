"use server";

import { revalidatePath } from "next/cache";
import { updateComercial, type ComercialPatch } from "@/lib/robo/client";
import { changeLeadStatus } from "@/app/(dashboard)/funil/actions";
import { getData } from "@/lib/data/store";
import { can } from "@/lib/auth/guard";
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

// ---------------------------------------------------------------- pareamento

/** Só dígitos, com DDI 55 quando o número vier sem ele. */
function normalizar(phone: string): string {
  let d = phone.replace(/\D/g, "").replace(/^0+/, "");
  if (d.length >= 10 && d.length <= 11) d = `55${d}`;
  return d;
}

/** 5511955008549 e 551155008549 são a mesma pessoa (nono dígito). */
function variantes(d: string): string[] {
  const set = new Set([d]);
  if (d.startsWith("55") && d.length >= 12) {
    const ddd = d.slice(2, 4);
    const resto = d.slice(4);
    if (resto.length === 9 && resto.startsWith("9")) set.add(`55${ddd}${resto.slice(1)}`);
    if (resto.length === 8) set.add(`55${ddd}9${resto}`);
  }
  return [...set];
}

/**
 * Acha o lead do painel que corresponde ao lead do robô.
 *
 * Os dois vivem em bancos diferentes — o do painel vem do rastreio da landing
 * page (com fbc/fbp/GA), o do robô vem do WhatsApp. O telefone é o único campo
 * em comum, então é por ele que casamos. Sem esse pareamento, marcar uma reunião
 * aqui não chegaria à Meta nem ao funil.
 */
async function acharLead(telefone: string | null): Promise<Lead | null> {
  if (!telefone) return null;
  const alvos = new Set(variantes(normalizar(telefone)));
  const data = await getData();
  return (
    data.leads.find((l) => {
      if (!l.phone) return false;
      return variantes(normalizar(l.phone)).some((v) => alvos.has(v));
    }) ?? null
  );
}

const ORDEM: Record<LeadStatus, number> = {
  perdido: 0,
  lead: 1,
  agendou: 2,
  compareceu: 3,
  cliente: 4,
};

/** Qual status do painel cada decisão comercial representa. */
function statusDaDecisao(campo: CampoComercial, valor: string): LeadStatus | null {
  if (valor === "sim") {
    if (campo === "reuniao_marcada") return "agendou";
    if (campo === "reuniao_realizada") return "compareceu";
    if (campo === "negocio_fechado") return "cliente";
  }
  if (valor === "nao" && campo === "negocio_fechado") return "perdido";
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
  const novoStatus = statusDaDecisao(campo, valor);
  if (!novoStatus) {
    revalidatePath("/comercial");
    return { ok: true, message: "Salvo." };
  }

  const lead = await acharLead(telefone ?? null);
  if (!lead) {
    revalidatePath("/comercial");
    return {
      ok: true,
      message: "Salvo aqui, mas não achei esse telefone entre os leads da campanha.",
    };
  }

  // Nunca rebaixa: marcar "reunião realizada" em quem já é cliente não desfaz a venda.
  if (novoStatus !== "perdido" && ORDEM[novoStatus] <= ORDEM[lead.status]) {
    revalidatePath("/comercial");
    return { ok: true, message: "Salvo." };
  }

  const r = await changeLeadStatus(lead.id, novoStatus, valorNegocio);
  revalidatePath("/comercial");
  return { ok: true, message: r.message };
}
