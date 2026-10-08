/**
 * De onde veio o lead, em palavras — puro.
 *
 * Usa a junção ÚNICA lead → anúncio (atribuicao.ts). O mesmo nome pode estar em
 * dois anúncios ("Carrossel -"), então o rótulo resolve pelo id do anúncio e usa
 * `rotuloCriativo` (com o conjunto) quando o nome se repete — como as ações e a
 * Mídia. Macro não resolvida e nome ambíguo dizem o que são, em vez de
 * aparecer como se fossem um criativo.
 *
 * Com os ids do UTM padrão (D6) o rótulo vira a trilha inteira: campanha ›
 * conjunto › anúncio — resolvida pelas linhas de anúncio da marca.
 */

import { creativePerformance, rotuloCriativo } from "./metrics";
import { atribuidor } from "./atribuicao";
import type { DashboardData, Lead } from "./types";

export type LeadParaOrigem = Pick<Lead, "utmContent" | "adId" | "adsetId" | "campaignId">;

export interface Origem {
  /** O rótulo curto (o anúncio, ou o que impede de nomeá-lo). */
  anuncio: string;
  campanha?: string;
  conjunto?: string;
  /** "Campanha › Conjunto › Anúncio" quando dá; senão só o anúncio. */
  trilha: string;
  tipo: ReturnType<ReturnType<typeof atribuidor>>["tipo"];
}

export function rotuladorDeOrigem(data: DashboardData): (lead: LeadParaOrigem | string | undefined) => string {
  const origem = origemDoLead(data);
  return (lead) => origem(typeof lead === "string" || lead === undefined ? { utmContent: lead } : lead).anuncio;
}

/** A origem completa (campanha › conjunto › anúncio) de um lead. */
export function origemDoLead(data: DashboardData): (lead: LeadParaOrigem) => Origem {
  const perf = creativePerformance(data);
  const nameById = new Map<string, string>(data.creatives.map((c) => [c.adId, c.name]));
  for (const c of perf) nameById.set(c.adId, rotuloCriativo(c, perf));
  // Nomes de campanha e conjunto por id, e por anúncio (a linha mais recente vence).
  const campanhaPorId = new Map<string, string>();
  const conjuntoPorId = new Map<string, string>();
  const porAnuncio = new Map<string, { campanha: string; conjunto: string }>();
  for (const r of data.adDaily) {
    if (r.campaignId && r.campaign) campanhaPorId.set(r.campaignId, r.campaign);
    if (r.adsetId && r.adset) conjuntoPorId.set(r.adsetId, r.adset);
    porAnuncio.set(r.adId, { campanha: r.campaign, conjunto: r.adset });
  }
  const atribuir = atribuidor(data.creatives);
  return (lead) => {
    const a = atribuir(lead);
    const uc = lead.utmContent ?? "";
    let anuncio: string;
    switch (a.tipo) {
      case "sem-origem":
        anuncio = "—";
        break;
      case "macro":
        anuncio = "Desconhecida (macro não resolvida)";
        break;
      case "ambigua":
        anuncio = `Atribuição ambígua (“${uc.split("|")[0].trim()}” em ${a.candidatos} anúncios)`;
        break;
      case "id":
      case "nome":
        anuncio = nameById.get(a.adId!) ?? (uc ? uc.split("|")[0] : a.adId!);
        break;
      default:
        anuncio = uc.split("|")[0];
    }
    const doAnuncio = a.adId ? porAnuncio.get(a.adId) : undefined;
    const campanha = (lead.campaignId && campanhaPorId.get(lead.campaignId)) || doAnuncio?.campanha || undefined;
    const conjunto = (lead.adsetId && conjuntoPorId.get(lead.adsetId)) || doAnuncio?.conjunto || undefined;
    const trilha = [campanha, conjunto, anuncio].filter((x): x is string => Boolean(x) && x !== "—").join(" › ") || anuncio;
    return { anuncio, campanha, conjunto, trilha, tipo: a.tipo };
  };
}
