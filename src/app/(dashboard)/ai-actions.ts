"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/lib/auth/guard";
import { activeBrandSlug } from "@/lib/active-brand";
import { isAiConfigured } from "@/lib/ai/config";
import { aiErrorMessage } from "@/lib/ai/client";
import { gerarResumoSemanal } from "@/lib/ai/resumo-semanal";
import { formatDateShort } from "@/lib/format";

export interface ActionState {
  ok: boolean;
  message: string;
}

/**
 * Gera (de novo) o resumo da semana fechada mais recente, à mão.
 *
 * Só por clique e só com `data:write` — a chamada custa dinheiro, então é
 * mutação. NUNCA rodar no render de um Server Component: cada refresh de página
 * viraria uma cobrança. O automático é o cron de segunda (`/api/resumo-semanal`).
 */
export async function gerarResumoSemanalAction(): Promise<ActionState> {
  if (!(await can("data:write"))) {
    return { ok: false, message: "Você não tem permissão para esta ação." };
  }
  if (!isAiConfigured()) {
    return { ok: false, message: "IA desligada — falta ANTHROPIC_API_KEY no .env.local." };
  }
  try {
    const r = await gerarResumoSemanal(await activeBrandSlug(), "manual");
    revalidatePath("/", "layout");
    return { ok: true, message: `Resumo da semana de ${formatDateShort(r.periodo.de)} a ${formatDateShort(r.periodo.ate)} gerado.` };
  } catch (e) {
    return { ok: false, message: aiErrorMessage(e) };
  }
}
