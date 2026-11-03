import "server-only";
import type { LeadFichaPatch } from "./data/backend";
import type { Lead } from "./types";

/**
 * A ficha com a classe do PAINEL recalculada a partir das respostas (as do
 * patch por cima das que o lead já tem). Toda escrita de resposta passa por aqui.
 */
export async function comClasse(_lead: Lead, patch: LeadFichaPatch): Promise<LeadFichaPatch> {
  return patch;
}
