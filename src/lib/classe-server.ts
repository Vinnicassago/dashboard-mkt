import "server-only";
import { BRANDS } from "./brands";
import { getState, listLeads, setState } from "./data/store";
import { STATE_KEYS, type LeadFichaPatch } from "./data/backend";
import { calcularClasse, lerTabela, type RespostasParaClasse, type TabelaDeParcela } from "./classe";
import { gravarFicha } from "./leads/gravar-ficha";
import type { Lead } from "./types";

/** A tabela de parcela que vale agora (Configurações → Atendimento); sem nada salvo, a provisória. */
export async function tabelaDeParcela(): Promise<TabelaDeParcela> {
  return lerTabela(await getState<unknown>(STATE_KEYS.tabelaDeParcela));
}

const RESPOSTAS = ["bem", "faixaValor", "finalidade", "faixaParcela", "prazoCompra"] as const;

/** As respostas que valem depois do patch (o patch por cima do lead; `null` limpa). */
function respostasDepois(lead: Lead, patch: LeadFichaPatch): RespostasParaClasse {
  const r: Record<string, unknown> = {};
  for (const k of RESPOSTAS) r[k] = patch[k] === undefined ? lead[k] : (patch[k] ?? undefined);
  return r as RespostasParaClasse;
}

/**
 * A ficha com a classe do PAINEL recalculada quando o patch mexe numa resposta.
 * Sem resposta nova, a classe fica como está. Faltando resposta, a classe do
 * painel é limpa — e a Fila usa a do n8n (`classeDoLead`).
 */
export async function comClasse(lead: Lead, patch: LeadFichaPatch): Promise<LeadFichaPatch> {
  if (!RESPOSTAS.some((k) => patch[k] !== undefined)) return patch;
  const { classe } = calcularClasse(respostasDepois(lead, patch), await tabelaDeParcela());
  return { ...patch, classe: classe ?? null };
}

/**
 * Salva a tabela de parcela e recalcula a classe de todo lead com respostas —
 * a classe é sempre a da tabela atual. Cada lead que mudou ganha o evento
 * "classe" no histórico. Devolve quantos mudaram.
 */
export async function salvarTabelaEReclassificar(
  tabela: TabelaDeParcela,
  actor: string,
): Promise<{ avaliados: number; mudaram: number }> {
  await setState(STATE_KEYS.tabelaDeParcela, { ...tabela, atualizadaEm: new Date().toISOString(), atualizadaPor: actor });
  let avaliados = 0;
  let mudaram = 0;
  for (const b of BRANDS) {
    for (const l of await listLeads(b.slug)) {
      if (!RESPOSTAS.some((k) => l[k])) continue;
      avaliados += 1;
      const { classe } = calcularClasse(l, tabela);
      if ((classe ?? undefined) === l.classe) continue;
      await gravarFicha(l, { classe: classe ?? null }, actor);
      mudaram += 1;
    }
  }
  return { avaliados, mudaram };
}
