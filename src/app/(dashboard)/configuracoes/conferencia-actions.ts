"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { activeBrandSlug } from "@/lib/active-brand";
import { can } from "@/lib/auth/guard";
import { currentActor } from "@/lib/auth/actor";
import { addConferencia, getData } from "@/lib/data/store";
import { conferenciaBate, diferencaDoGasto, textoDaDiferenca } from "@/lib/conferencia";
import { gastoDoPeriodoParaConferir } from "@/lib/conferencia-periodo";
import { mensagemHumana } from "@/lib/erros";
import { formatCurrency0 } from "@/lib/format";
import { hojeEmBrasilia } from "@/lib/range";
import { estadoDaFonte } from "@/lib/sincronizacao";

export interface ResultadoConferencia {
  ok: boolean;
  message: string;
  bate?: boolean;
}

/**
 * Registra a conferência do período com o valor que o Gerenciador mostra
 * (Configurações → Integrações `#conferir-gasto`). O gasto do painel é RECALCULADO
 * aqui — o gasto TOTAL do período (`gastoDoPeriodoParaConferir`, o "Investimento
 * total" do ⓘ do resumo da Mídia) —, nunca o que o navegador diz que viu. A
 * permissão é conferida no servidor, antes de tudo.
 */
export async function registrarConferencia(rangeKey: string | undefined, gastoGerenciador: number): Promise<ResultadoConferencia> {
  if (!(await can("data:write"))) return { ok: false, message: "Você não tem permissão para esta ação." };
  if (!Number.isFinite(gastoGerenciador) || gastoGerenciador < 0) {
    return { ok: false, message: "Digite o gasto do Gerenciador (R$, a partir de zero)." };
  }
  try {
    const brand = await activeBrandSlug();
    const data = await getData(brand);
    const c = gastoDoPeriodoParaConferir(data, rangeKey, hojeEmBrasilia());
    const gastoPainel = c.gasto;
    const diferenca = diferencaDoGasto(gastoPainel, gastoGerenciador);
    const sync = await estadoDaFonte("ads", brand);
    await addConferencia({
      id: `CONF-${randomUUID()}`,
      brand,
      periodoDe: c.de,
      periodoAte: c.ate,
      gastoPainel,
      gastoGerenciador,
      diferenca,
      ultimoSync: sync.ultimoOk ?? undefined,
      criadaEm: new Date().toISOString(),
      criadaPor: await currentActor(),
    });
    revalidatePath("/configuracoes/integracoes");
    const bate = conferenciaBate(diferenca);
    return {
      ok: true,
      bate,
      message: `Painel ${formatCurrency0(gastoPainel)} × Gerenciador ${formatCurrency0(gastoGerenciador)}: ${textoDaDiferenca(diferenca)} — ${bate ? "dentro de 5%" : "acima de 5%, vale conferir o sync e as marcas"}.`,
    };
  } catch (e) {
    console.error("[configuracoes] conferência:", e);
    return { ok: false, message: mensagemHumana("banco de dados", e) };
  }
}
