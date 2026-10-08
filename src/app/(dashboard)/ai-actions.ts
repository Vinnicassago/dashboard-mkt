"use server";

import { revalidatePath } from "next/cache";
import { getData, listDrafts, setState } from "@/lib/data/store";
import { aiAnalysisKey } from "@/lib/data/backend";
import { can } from "@/lib/auth/guard";
import { activeBrandSlug } from "@/lib/active-brand";
import { pageRange } from "@/lib/page-range";
import { dataQualityChecks, type DataWarning } from "@/lib/metrics";
import { estadoDaFonte } from "@/lib/sincronizacao";
import { isAiConfigured } from "@/lib/ai/config";
import { aiErrorMessage } from "@/lib/ai/client";
import { buildBriefing } from "@/lib/ai/briefing";
import { analyzeBriefing } from "@/lib/ai/analyst";

export interface ActionState {
  ok: boolean;
  message: string;
}

/**
 * Roda o analista sobre o período selecionado e guarda o resultado.
 *
 * Só por clique e só com `data:write` — a chamada custa dinheiro, então é
 * mutação. NUNCA rodar no render de um Server Component: cada refresh de página
 * viraria uma cobrança.
 */
export async function runAnalysisAction(rangeKey?: string): Promise<ActionState> {
  if (!(await can("data:write"))) {
    return { ok: false, message: "Você não tem permissão para esta ação." };
  }
  if (!isAiConfigured()) {
    return { ok: false, message: "IA desligada — falta ANTHROPIC_API_KEY no .env.local." };
  }

  const brand = await activeBrandSlug();
  const data = await getData(brand);
  const { range } = pageRange(data, rangeKey);

  if (data.igAccountDaily.length === 0 && data.adDaily.length === 0) {
    return { ok: false, message: "Sem dados no período para analisar." };
  }

  try {
    const nowIso = new Date().toISOString();
    // A IA precisa saber se o dado está velho — na tela isso é o cabeçalho.
    const ads = await estadoDaFonte("ads", brand);
    const horas = ads.ultimoOk ? (Date.parse(nowIso) - Date.parse(ads.ultimoOk)) / 3_600_000 : null;
    const avisosDeSync: DataWarning[] = [
      ...(ads.falha ? [{ level: "warn" as const, message: `A sincronização da Meta está falhando: ${ads.falha.erro}` }] : []),
      ...(horas != null && horas > 36
        ? [{ level: "warn" as const, message: `Anúncios sincronizados há ${Math.round(horas)}h — os números podem estar defasados.` }]
        : []),
    ];
    const briefing = buildBriefing(data, range, {
      nowIso,
      drafts: await listDrafts(brand),
      warnings: [...avisosDeSync, ...dataQualityChecks(data)],
    });
    const analysis = await analyzeBriefing(briefing, brand);
    await setState(aiAnalysisKey(brand), analysis);
    revalidatePath("/", "layout");
    return { ok: true, message: "Leitura do período atualizada." };
  } catch (e) {
    return { ok: false, message: aiErrorMessage(e) };
  }
}
