"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/lib/auth/guard";
import { currentActor } from "@/lib/auth/actor";
import { registrarAuditoria } from "@/lib/auditoria";
import { getState, setState } from "@/lib/data/store";
import { STATE_KEYS } from "@/lib/data/backend";
import { mensagemHumana } from "@/lib/erros";
import { formatCurrency0 } from "@/lib/format";
import { lerCampanhaDaLive, type CampanhaDaLive } from "@/lib/live";

export interface ResultadoLive {
  ok: boolean;
  message: string;
}

const DENIED: ResultadoLive = { ok: false, message: "Você não tem permissão para esta ação." };

/**
 * Salva a régua da live (períodos, verba por linha, metas, tokens das campanhas).
 * Os números manuais (presentes, vendas) não passam por aqui — têm o botão deles
 * na aba Live — e ficam como estavam.
 */
export async function salvarCampanhaDaLive(entrada: CampanhaDaLive): Promise<ResultadoLive> {
  if (!(await can("data:write"))) return DENIED;
  try {
    const atual = lerCampanhaDaLive(await getState<unknown>(STATE_KEYS.campanhaDaLive));
    const actor = await currentActor();
    const nova = lerCampanhaDaLive({ ...entrada, manuais: atual.manuais, atualizadoEm: new Date().toISOString(), atualizadoPor: actor });
    await setState(STATE_KEYS.campanhaDaLive, nova);
    await registrarAuditoria(
      "Campanha da live salva",
      `${nova.periodo.de}→${nova.periodo.ate} · verba ${nova.linhas.map((l) => `${l.rotulo} ${formatCurrency0(l.verba)}`).join(", ")} · metas ${nova.metas.inscricoes} inscrições, ${nova.metas.qualificados} qualificados, ${nova.metas.agendadas} agendadas`,
    );
    revalidatePath("/", "layout");
    return { ok: true, message: "Campanha da live salva — a aba Live já usa os números novos." };
  } catch (e) {
    console.error("[live] salvar campanha:", e);
    return { ok: false, message: mensagemHumana("banco de dados", e) };
  }
}

/**
 * O que o sistema não sabe: presentes na live (pico e total) e vendas (quantidade
 * e valor de carta). Marketing e comercial registram; vazio limpa.
 */
export async function salvarManuaisDaLive(m: {
  presentesPico?: number | null;
  presentesTotal?: number | null;
  vendasQtd?: number | null;
  vendasValor?: number | null;
}): Promise<ResultadoLive> {
  if (!(await can("data:write")) && !(await can("leads:write"))) return DENIED;
  const ok = (v: unknown) => v == null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
  if (![m.presentesPico, m.presentesTotal, m.vendasQtd, m.vendasValor].every(ok)) {
    return { ok: false, message: "Use números a partir de zero (ou deixe em branco)." };
  }
  try {
    const atual = lerCampanhaDaLive(await getState<unknown>(STATE_KEYS.campanhaDaLive));
    const actor = await currentActor();
    const manuais = {
      presentesPico: m.presentesPico ?? undefined,
      presentesTotal: m.presentesTotal ?? undefined,
      vendasQtd: m.vendasQtd ?? undefined,
      vendasValor: m.vendasValor ?? undefined,
      atualizadoEm: new Date().toISOString(),
      atualizadoPor: actor,
    };
    await setState(STATE_KEYS.campanhaDaLive, { ...atual, manuais });
    await registrarAuditoria(
      "Números manuais da live",
      `presentes pico ${manuais.presentesPico ?? "—"}, total ${manuais.presentesTotal ?? "—"} · vendas ${manuais.vendasQtd ?? "—"} (${manuais.vendasValor != null ? formatCurrency0(manuais.vendasValor) : "—"})`,
    );
    revalidatePath("/", "layout");
    return { ok: true, message: "Números da live salvos." };
  } catch (e) {
    console.error("[live] salvar manuais:", e);
    return { ok: false, message: mensagemHumana("banco de dados", e) };
  }
}
