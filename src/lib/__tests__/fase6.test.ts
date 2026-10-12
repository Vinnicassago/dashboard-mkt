/**
 * Fase 6 — telas de diagnóstico e navegação. Fixture sintética (nenhum dado real).
 */
import { describe, expect, it } from "vitest";
import { atribuidor, idsDoUtm } from "../atribuicao";
import { origemDoLead, rotuladorDeOrigem } from "../origem";
import { UTM_PADRAO, urlComUtm } from "../utm";
import type { AdDaily, Creative, DashboardData } from "../types";

const criativo = (adId: string, name: string, creativeId?: string): Creative => ({ adId, brand: "consorcio", name, format: "imagem", creativeId });
const ad = (adId: string, campaign: string, campaignId: string, adset: string, adsetId: string): AdDaily => ({
  brand: "consorcio",
  date: "2026-10-05",
  campaign,
  campaignId,
  adset,
  adsetId,
  adId,
  objective: "OUTCOME_LEADS",
  spend: 100,
  impressions: 1000,
  reach: 800,
  frequency: 1.2,
  clicks: 50,
  leads: 1,
});
function base(over: Partial<DashboardData> = {}): DashboardData {
  return {
    campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-08-01", budgetTotal: 0 },
    igAccountDaily: [],
    igPosts: [],
    adDaily: [],
    creatives: [],
    lpDaily: [],
    leads: [],
    goals: [],
    metas: [],
    updatedAt: "2026-10-08T12:00:00.000Z",
    ...over,
  };
}

describe("6.7 — UTM com ids (D6)", () => {
  it("o padrão é um link só, com as macros da Meta sem codificar", () => {
    const url = urlComUtm("https://lp.exemplo.com.br/consorcio?x=1", UTM_PADRAO);
    expect(url).toBe(
      "https://lp.exemplo.com.br/consorcio?x=1&utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}",
    );
    expect(urlComUtm("", UTM_PADRAO)).toBe("");
    // Âncora na base: a query vem antes do "#".
    expect(urlComUtm("https://lp.exemplo.com.br/consorcio#form", { utm_source: "meta" })).toBe("https://lp.exemplo.com.br/consorcio?utm_source=meta#form");
    expect(urlComUtm("isto não é url", UTM_PADRAO)).toBe("URL base inválida");
    // Valor comum continua codificado.
    expect(urlComUtm("https://a.b/c", { utm_content: "Anúncio A|100001" })).toBe("https://a.b/c?utm_content=An%C3%BAncio%20A%7C100001");
  });

  it("a ingestão guarda só o que é id numérico: macro literal e nome ficam de fora", () => {
    expect(idsDoUtm({ utm_campaign: "120001", utm_term: "120002", utm_content: "120003" })).toEqual({ adId: "120003", adsetId: "120002", campaignId: "120001" });
    expect(idsDoUtm({ utm_campaign: "{{campaign.id}}", utm_term: "{{adset.id}}", utm_content: "{{ad.id}}" })).toEqual({ adId: undefined, adsetId: undefined, campaignId: undefined });
    expect(idsDoUtm({ utm_campaign: "campanha-verao", utm_content: "Anúncio A|100001" })).toEqual({ adId: "100001", adsetId: undefined, campaignId: undefined });
  });

  it("o id gravado na entrada vence o utm_content na atribuição", () => {
    const atribuir = atribuidor([criativo("100001", "Carrossel"), criativo("100002", "Carrossel")]);
    expect(atribuir({ utmContent: "Carrossel" }).tipo).toBe("ambigua");
    expect(atribuir({ utmContent: "Carrossel", adId: "100002" })).toEqual({ adId: "100002", tipo: "id" });
  });

  it("a origem vira a trilha campanha › conjunto › anúncio", () => {
    const data = base({
      creatives: [criativo("100001", "Anúncio A"), criativo("100002", "Anúncio B")],
      adDaily: [ad("100001", "Consórcio Leads", "900", "Interesses 25-45", "800"), ad("100002", "Consórcio Leads", "900", "Lookalike", "801")],
    });
    const origem = origemDoLead(data);
    expect(origem({ adId: "100002", adsetId: "801", campaignId: "900" })).toMatchObject({
      anuncio: "Anúncio B",
      campanha: "Consórcio Leads",
      conjunto: "Lookalike",
      trilha: "Consórcio Leads › Lookalike › Anúncio B",
      tipo: "id",
    });
    // Sem ids do UTM, a trilha sai da linha de anúncio do criativo atribuído pelo nome.
    expect(origem({ utmContent: "Anúncio A" }).trilha).toBe("Consórcio Leads › Interesses 25-45 › Anúncio A");
    expect(origem({ utmContent: "{{ad.name}}" })).toMatchObject({ anuncio: "Desconhecida (macro não resolvida)", trilha: "Desconhecida (macro não resolvida)" });
    // O rotulador antigo (string) continua valendo.
    expect(rotuladorDeOrigem(data)("Anúncio A")).toBe("Anúncio A");
    expect(rotuladorDeOrigem(data)(undefined)).toBe("—");
  });
});
