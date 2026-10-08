"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { addAcaoEstado } from "@/lib/data/store";
import { can } from "@/lib/auth/guard";
import { currentActor } from "@/lib/auth/actor";
import { activeBrandSlug } from "@/lib/active-brand";
import { hojeEmBrasilia } from "@/lib/range";
import { semanaDaAcao } from "@/lib/motor";
import type { AcaoEstadoValor } from "@/lib/types";

export interface ActionState {
  ok: boolean;
  message: string;
}

const ESTADOS: AcaoEstadoValor[] = ["feita", "ignorada", "reaberta"];

/**
 * "Feito" / "Ignorar (motivo)" / "Reabrir" numa ação da semana. Só INSERE: a
 * última decisão de (marca, semana, ação) é o estado atual; as anteriores ficam
 * como histórico. Na segunda seguinte a ação volta a ser avaliada do zero.
 *
 * Qualquer papel decide — a ação de comercial é do comercial, a de mídia é do
 * marketing — mas sempre alguém logado (ou o modo aberto).
 */
export async function marcarAcaoAction(input: {
  acao: string;
  estado: AcaoEstadoValor;
  motivo?: string;
  titulo: string;
}): Promise<ActionState> {
  if (!((await can("leads:write")) || (await can("data:write")))) {
    return { ok: false, message: "Você não tem permissão para esta ação." };
  }
  const acao = String(input.acao ?? "").trim().slice(0, 120);
  const titulo = String(input.titulo ?? "").trim().slice(0, 200);
  const motivo = String(input.motivo ?? "").trim().slice(0, 300);
  if (!acao || !ESTADOS.includes(input.estado)) return { ok: false, message: "Ação inválida." };
  if (input.estado === "ignorada" && !motivo) return { ok: false, message: "Diga por que está ignorando — o motivo fica no histórico." };

  const brand = await activeBrandSlug();
  const hoje = hojeEmBrasilia();
  await addAcaoEstado({
    id: `ACAO-${randomUUID()}`,
    brand,
    semana: semanaDaAcao(hoje),
    acao,
    estado: input.estado,
    motivo: input.estado === "ignorada" ? motivo : undefined,
    titulo,
    por: await currentActor(),
    em: new Date().toISOString(),
  });
  revalidatePath("/");
  return {
    ok: true,
    message:
      input.estado === "feita" ? "Marcada como feita." : input.estado === "ignorada" ? "Ignorada nesta semana." : "Reaberta.",
  };
}
