"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { activeBrandSlug } from "@/lib/active-brand";
import { can } from "@/lib/auth/guard";
import { currentActor } from "@/lib/auth/actor";
import { addConferencia, getData } from "@/lib/data/store";
import { conferenciaBate, diferencaDoGasto, textoDaDiferenca } from "@/lib/conferencia";
import { mensagemHumana } from "@/lib/erros";
import { formatCurrency0 } from "@/lib/format";
import { kpisDoPeriodo } from "@/lib/kpis";
import { pageRange } from "@/lib/page-range";
import { hojeEmBrasilia, isRangeKey } from "@/lib/range";
import { estadoDaFonte } from "@/lib/sincronizacao";

export interface ResultadoConferencia {
  ok: boolean;
  message: string;
  bate?: boolean;
}

/**
 * Registra a conferência do período com o valor que o Gerenciador mostra. O
 * gasto do painel é RECALCULADO aqui — o mesmo número do card de Investimento da
 * Mídia para esse período —, nunca o que o navegador diz que viu.
 */
export async function registrarConferencia(rangeKey: string | undefined, gastoGerenciador: number): Promise<ResultadoConferencia> {
  if (!(await can("data:write"))) return { ok: false, message: "Você não tem permissão para esta ação." };
  if (!Number.isFinite(gastoGerenciador) || gastoGerenciador < 0) {
    return { ok: false, message: "Digite o gasto do Gerenciador (R$, a partir de zero)." };
  }
  try {
    const brand = await activeBrandSlug();
    const data = await getData(brand);
    const { range } = pageRange(data, rangeKey && isRangeKey(rangeKey) ? rangeKey : undefined);
    const hoje = hojeEmBrasilia();
    const de = range?.from ?? data.adDaily[0]?.date ?? data.campaign.startDate ?? hoje;
    const ate = range?.to ?? hoje;
    const gastoPainel = kpisDoPeriodo(data, range).investimento.valor;
    const diferenca = diferencaDoGasto(gastoPainel, gastoGerenciador);
    const sync = await estadoDaFonte("ads", brand);
    await addConferencia({
      id: `CONF-${randomUUID()}`,
      brand,
      periodoDe: de,
      periodoAte: ate,
      gastoPainel,
      gastoGerenciador,
      diferenca,
      ultimoSync: sync.ultimoOk ?? undefined,
      criadaEm: new Date().toISOString(),
      criadaPor: await currentActor(),
    });
    revalidatePath("/midia");
    const bate = conferenciaBate(diferenca);
    return {
      ok: true,
      bate,
      message: `Painel ${formatCurrency0(gastoPainel)} × Gerenciador ${formatCurrency0(gastoGerenciador)}: ${textoDaDiferenca(diferenca)} — ${bate ? "dentro de 5%" : "acima de 5%, vale conferir o sync e as marcas"}.`,
    };
  } catch (e) {
    console.error("[midia] conferência:", e);
    return { ok: false, message: mensagemHumana("banco de dados", e) };
  }
}
