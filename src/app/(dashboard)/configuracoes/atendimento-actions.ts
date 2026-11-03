"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/lib/auth/guard";
import { currentActor } from "@/lib/auth/actor";
import { registrarAuditoria } from "@/lib/auditoria";
import { GRUPO_LABEL, FAIXAS_VALOR_ORDEM, celulaValida, type GrupoDoBem, type TabelaDeParcela } from "@/lib/classe";
import { salvarTabelaEReclassificar } from "@/lib/classe-server";
import { mensagemHumana } from "@/lib/erros";

export interface ResultadoAtendimento {
  ok: boolean;
  message: string;
}

const DENIED: ResultadoAtendimento = { ok: false, message: "Você não tem permissão para esta ação." };

/**
 * Salva a tabela de parcela (a régua da classe C) e recalcula a classe de todos
 * os leads com respostas. Célula que não é do vocabulário recusa o envio inteiro
 * — meia tabela salva mudaria classes que ninguém pediu para mudar.
 */
export async function salvarTabelaDeParcela(celulas: Record<string, Record<string, string>>): Promise<ResultadoAtendimento> {
  if (!(await can("data:write"))) return DENIED;
  const tabela: TabelaDeParcela = { celulas: {} as TabelaDeParcela["celulas"] };
  for (const g of Object.keys(GRUPO_LABEL) as GrupoDoBem[]) {
    tabela.celulas[g] = {} as TabelaDeParcela["celulas"][GrupoDoBem];
    for (const f of FAIXAS_VALOR_ORDEM) {
      const c = celulas?.[g]?.[f];
      if (!celulaValida(c)) return { ok: false, message: "A tabela veio incompleta — nada foi salvo." };
      tabela.celulas[g][f] = c;
    }
  }
  try {
    const actor = await currentActor();
    const r = await salvarTabelaEReclassificar(tabela, actor);
    await registrarAuditoria(
      "Tabela de parcela da classe salva",
      `${r.avaliados} lead(s) com respostas avaliados, ${r.mudaram} mudaram de classe`,
    );
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: r.mudaram
        ? `Tabela salva. ${r.mudaram} de ${r.avaliados} lead(s) mudaram de classe (cada um ganhou a linha no histórico).`
        : `Tabela salva. Nenhum dos ${r.avaliados} lead(s) com respostas mudou de classe.`,
    };
  } catch (e) {
    console.error("[atendimento] tabela de parcela:", e);
    return { ok: false, message: mensagemHumana("banco de dados", e) };
  }
}
