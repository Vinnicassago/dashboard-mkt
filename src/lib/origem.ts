/**
 * De onde veio o lead, em palavras — puro.
 *
 * Usa a junção ÚNICA lead → anúncio (atribuicao.ts). O mesmo nome pode estar em
 * dois anúncios ("Carrossel -"), então o rótulo resolve pelo id do anúncio e usa
 * `rotuloCriativo` (com o conjunto) quando o nome se repete — como as ações e o
 * Dinheiro. Macro não resolvida e nome ambíguo dizem o que são, em vez de
 * aparecer como se fossem um criativo.
 */

import { creativePerformance, rotuloCriativo } from "./metrics";
import { atribuidor } from "./atribuicao";
import type { DashboardData } from "./types";

export function rotuladorDeOrigem(data: DashboardData): (utmContent?: string) => string {
  const perf = creativePerformance(data);
  const nameById = new Map<string, string>(data.creatives.map((c) => [c.adId, c.name]));
  for (const c of perf) nameById.set(c.adId, rotuloCriativo(c, perf));
  const atribuir = atribuidor(data.creatives);
  return (utmContent) => {
    const a = atribuir({ utmContent });
    switch (a.tipo) {
      case "sem-origem":
        return "—";
      case "macro":
        return "Desconhecida (macro não resolvida)";
      case "ambigua":
        return `Atribuição ambígua (“${utmContent!.split("|")[0].trim()}” em ${a.candidatos} anúncios)`;
      case "id":
      case "nome":
        return nameById.get(a.adId!) ?? utmContent!.split("|")[0];
      default:
        return utmContent!.split("|")[0];
    }
  };
}
