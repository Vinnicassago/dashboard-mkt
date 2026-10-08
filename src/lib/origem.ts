/**
 * De onde veio o lead, em palavras — puro.
 *
 * O utm_content carrega "nome|adid". O mesmo nome pode estar em dois anúncios
 * ("Carrossel -"), então o rótulo resolve pelo id do anúncio e usa
 * `rotuloCriativo` (com o conjunto) quando o nome se repete — como as ações e o
 * Dinheiro. Sem id, mostra a parte de nome (antes do "|").
 */

import { adIdFromUtmContent, creativePerformance, rotuloCriativo } from "./metrics";
import type { DashboardData } from "./types";

export function rotuladorDeOrigem(data: DashboardData): (utmContent?: string) => string {
  const perf = creativePerformance(data);
  const nameById = new Map<string, string>(data.creatives.map((c) => [c.adId, c.name]));
  for (const c of perf) nameById.set(c.adId, rotuloCriativo(c, perf));
  return (utmContent) => {
    if (!utmContent) return "—";
    const id = adIdFromUtmContent(utmContent);
    return (id ? nameById.get(id) : nameById.get(utmContent)) ?? utmContent.split("|")[0];
  };
}
