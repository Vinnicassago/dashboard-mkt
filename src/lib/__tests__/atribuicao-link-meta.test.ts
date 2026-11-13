/**
 * O link da Meta de nov/26: `utm_content={{ad.name}}__ad_{{ad.id}}` e
 * `utm_campaign={{campaign.name}}__cid_{{campaign.id}}` (o `utm_term` é o
 * posicionamento). Antes desta leitura, o lead com esse link ficava "desconhecido":
 * fora do conjunto, do criativo e das reuniões por id. Fixture sintética.
 */
import { describe, expect, it } from "vitest";
import { adIdFromUtmContent, atribuidor, idsDoUtm, nomeDoUtmContent } from "../atribuicao";
import { atribuirAoConjunto } from "../midia";
import { origemDoLead } from "../origem";
import type { AdDaily, Creative, DashboardData, Lead } from "../types";

const criativo = (adId: string, name: string): Creative => ({ adId, brand: "consorcio", name, format: "imagem" });
const ad = (adId: string, adset: string, adsetId: string): AdDaily => ({
  brand: "consorcio",
  date: "2026-11-10",
  campaign: "Consórcio Leads",
  campaignId: "900001",
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
    updatedAt: "2026-11-13T12:00:00.000Z",
    ...over,
  };
}
const lead = (over: Partial<Lead>): Lead => ({ id: "l1", brand: "consorcio", createdAt: "2026-11-10T13:00:00.000Z", status: "novo", ...over }) as Lead;

describe("utm_content com o id depois de __ad_", () => {
  it("lê o id no fim, nos três formatos, e nada além deles", () => {
    expect(adIdFromUtmContent("Carrossel -__ad_120000000000000101")).toBe("120000000000000101");
    expect(adIdFromUtmContent("Post Exemplo__AD_120000000000000102 ")).toBe("120000000000000102");
    expect(adIdFromUtmContent("Anúncio A|100001")).toBe("100001");
    expect(adIdFromUtmContent("Anúncio A| 100001")).toBe("100001");
    expect(adIdFromUtmContent("a|b|100001")).toBe("100001");
    expect(adIdFromUtmContent("100001")).toBe("100001");
    // Número colado ao nome não é id; macro sem resolver também não.
    expect(adIdFromUtmContent("Post 12345")).toBeUndefined();
    expect(adIdFromUtmContent("nome|abc12345")).toBeUndefined();
    expect(adIdFromUtmContent("nome__ad_{{ad.id}}")).toBeUndefined();
    expect(adIdFromUtmContent("nome__ad_1234")).toBeUndefined();
    expect(adIdFromUtmContent("nome|")).toBeUndefined();
    expect(adIdFromUtmContent("")).toBeUndefined();
    expect(adIdFromUtmContent(undefined)).toBeUndefined();
  });

  it("o nome sai sem o id colado", () => {
    expect(nomeDoUtmContent("Carrossel -__ad_120000000000000101")).toBe("Carrossel -");
    expect(nomeDoUtmContent("Anúncio A|100001")).toBe("Anúncio A");
    expect(nomeDoUtmContent("  Só o nome ")).toBe("Só o nome");
    expect(nomeDoUtmContent(undefined)).toBe("");
  });

  it("a entrada grava o anúncio e a campanha; o posicionamento no utm_term não vira conjunto", () => {
    expect(
      idsDoUtm({
        utm_campaign: "[XYZ] CP2 - Leads__cid_120000000000000001",
        utm_term: "Instagram_Stories",
        utm_content: "Carrossel -__ad_120000000000000101",
      }),
    ).toEqual({ adId: "120000000000000101", adsetId: undefined, campaignId: "120000000000000001" });
    // O formato antigo (nome|id, campanha pelo nome) continua igual.
    expect(idsDoUtm({ utm_campaign: "[XYZ] CP2 - Leads", utm_term: "Instagram_Feed", utm_content: "Carrossel -|120000000000000103" })).toEqual({
      adId: "120000000000000103",
      adsetId: undefined,
      campaignId: undefined,
    });
    expect(idsDoUtm({ utm_campaign: "nome__cid_{{campaign.id}}" }).campaignId).toBeUndefined();
  });

  it("o id desempata o nome repetido: com __ad_ não é ambíguo", () => {
    const atribuir = atribuidor([criativo("100001", "Carrossel -"), criativo("100002", "Carrossel -")]);
    expect(atribuir({ utmContent: "Carrossel -__ad_100002" })).toEqual({ adId: "100002", tipo: "id" });
    expect(atribuir({ utmContent: "Carrossel -" }).tipo).toBe("ambigua");
    expect(atribuir({ utmContent: "{{ad.name}}__ad_{{ad.id}}" }).tipo).toBe("macro");
    // Sem id, casa pelo nome limpo (único).
    const unico = atribuidor([criativo("100003", "Post A")]);
    expect(unico({ utmContent: "Post A" })).toEqual({ adId: "100003", tipo: "nome" });
  });

  it("a origem vira a trilha, e anúncio fora das linhas aparece pelo nome limpo", () => {
    const data = base({
      creatives: [criativo("100001", "Anúncio A"), criativo("100002", "Anúncio B")],
      adDaily: [ad("100001", "cj1", "800001"), ad("100002", "cj2", "800002")],
    });
    const origem = origemDoLead(data);
    expect(origem({ utmContent: "Anúncio B__ad_100002" })).toMatchObject({
      anuncio: "Anúncio B",
      conjunto: "cj2",
      trilha: "Consórcio Leads › cj2 › Anúncio B",
      tipo: "id",
    });
    expect(origem({ utmContent: "Anúncio novo__ad_100009" })).toMatchObject({ anuncio: "Anúncio novo", trilha: "Anúncio novo", tipo: "id" });
  });

  it("na Mídia, o lead entra no conjunto do anúncio — também os que já estão gravados", () => {
    const data = base({
      creatives: [criativo("100001", "Carrossel -"), criativo("100002", "Carrossel -")],
      adDaily: [ad("100001", "cj1", "800001"), ad("100002", "cj2", "800002")],
    });
    const range = { from: "2026-11-07", to: "2026-11-13" };
    const noConjunto = atribuirAoConjunto(data, range);
    const r = noConjunto(lead({ utmContent: "Carrossel -__ad_100002", utmCampaign: "Consórcio Leads__cid_900001", utmTerm: "Instagram_Stories" }));
    expect("chave" in r).toBe(true);
    const r1 = noConjunto(lead({ utmContent: "Carrossel -__ad_100001" }));
    expect(r1).not.toEqual(r);
    expect("chave" in r1).toBe(true);
    // Sem o id, o mesmo nome em dois anúncios continua fora (ambíguo).
    expect(noConjunto(lead({ utmContent: "Carrossel -" }))).toEqual({ motivo: "ambigua" });
  });
});
