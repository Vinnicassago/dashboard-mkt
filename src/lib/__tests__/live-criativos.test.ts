/**
 * Live 01/12 — etapa 7 (E3-02): criativos da live na Mídia, com o sinal como
 * sugestão e as comparações lado a lado. Fixture sintética.
 */
import { describe, expect, it } from "vitest";
import { criativosDaLive } from "../criativos-live";
import { LIVE_PADRAO } from "../live";
import type { AdDaily, Creative, DashboardData, Lead } from "../types";

const cfg = LIVE_PADRAO;
const RANGE = { de: "2026-11-16", ate: "2026-11-30" };

const dias = (de: string, n: number) =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(`${de}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
const rows = (adId: string, adset: string, de: string, n: number, total: number): AdDaily[] =>
  dias(de, n).map((date) => ({
    brand: "consorcio",
    date,
    campaign: "[LIVE] Captação",
    adset,
    adId,
    spend: total / n,
    impressions: 1000,
    reach: 800,
    frequency: 1.2,
    clicks: 10,
    leads: 1,
  }));
const criativo = (adId: string, name: string): Creative => ({ adId, brand: "consorcio", name, format: "imagem", creativeId: `cr-${adId}` });

let n = 0;
const inscrito = (adId: string, classe: Lead["classe"], extra: Partial<Lead> = {}): Lead => {
  n += 1;
  return { id: `L${n}`, brand: "consorcio", createdAt: "2026-11-20T22:00:00.000Z", name: `P${n}`, status: "lead", classe, adId, finalidade: "morar", ...extra };
};

function base(adDaily: AdDaily[], creatives: Creative[], leads: Lead[]): DashboardData {
  return {
    campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-11-16", budgetTotal: 5000 },
    igAccountDaily: [],
    igPosts: [],
    adDaily,
    creatives,
    lpDaily: [],
    leads,
    goals: [],
    metas: [],
    updatedAt: "2026-11-24T12:00:00.000Z",
  };
}

const creatives = [
  criativo("101", "C1 Imóvel planta"),
  criativo("102", "C2 Imóvel família"),
  criativo("103", "C3 Imóvel novo"),
  criativo("104", "C4A Imóvel gancho"),
  criativo("105", "C4B Imóvel gancho"),
  criativo("109", "C9 Carro"),
];
const ads = [
  ...rows("101", "Persona", "2026-11-16", 6, 120),
  ...rows("102", "Persona", "2026-11-16", 6, 200),
  ...rows("103", "Aberto", "2026-11-20", 3, 90), // 3 dias: cedo demais
  ...rows("104", "Aberto", "2026-11-16", 6, 300), // nenhum qualificado: pausar
  ...rows("105", "Aberto", "2026-11-16", 6, 100),
  ...rows("109", "Carro", "2026-11-23", 6, 240),
  { ...rows("999", "Outra", "2026-11-16", 1, 999)[0], campaign: "[BRN] Leads" }, // não é da live
];
const leads = [
  inscrito("101", "A"),
  inscrito("101", "B"),
  inscrito("102", "A"),
  inscrito("104", "C"),
  inscrito("104", "X", { finalidade: "quitar_dividas" }),
  inscrito("105", "A"),
  inscrito("109", "A", { bem: "carro" }),
  inscrito("", "A", { adId: undefined, utmContent: "{{ad.id}}" }), // sem anúncio identificado
];

describe("criativos da live — tabela e sinal", () => {
  const r = criativosDaLive(base(ads, creatives, leads), cfg, RANGE, "2026-11-24");
  const por = Object.fromEntries(r.criativos.map((c) => [c.nome.split(" ")[0], c]));

  it("um criativo por id do criativo; só anúncios da live; inscritos pela junção única", () => {
    expect(Object.keys(por).sort()).toEqual(["C1", "C2", "C3", "C4A", "C4B", "C9"]);
    expect(por.C1).toMatchObject({ gasto: 120, inscritos: 2, qualificados: 2, custoPorQualificado: 60, diasNoAr: 6 });
    expect(por.C4A).toMatchObject({ qualificados: 0, custoPorQualificado: null, quitarDividas: 0.5 });
    expect(r.naoAtribuidos).toBe(1);
  });

  it("média dos julgáveis sem o carro: (60 + 200 + 100) ÷ 3 = 120 → pausar acima de 240", () => {
    expect(r.media).toBe(120);
    expect(por.C1.sinal).toBe("ok");
    expect(por.C2.sinal).toBe("ok"); // 200 < 240
    expect(por.C3.sinal).toBe("cedo"); // 3 dias
    expect(por.C3.porque).toContain("3 de 5 dias no ar");
    expect(por.C4A.sinal).toBe("pausar"); // R$ 300 sem qualificado
    expect(por.C4A.porque).toContain("R$ 300 sem nenhum qualificado");
  });

  it("o carro só é julgado a partir de 28/11", () => {
    expect(por.C9).toMatchObject({ carro: true, sinal: "cedo" });
    expect(por.C9.porque).toContain("28/11");
    const depois = criativosDaLive(base(ads, creatives, leads), cfg, { de: "2026-11-16", ate: "2026-11-28" }, "2026-11-28");
    const c9 = depois.criativos.find((c) => c.nome.startsWith("C9"))!;
    expect(c9.sinal).not.toBe("cedo");
  });

  it("comparações lado a lado: 4A × 4B pelo anúncio, Persona × Aberto pelo conjunto", () => {
    const ab = r.comparacoes.find((c) => c.titulo === "Teste A × B")!;
    expect(ab.lados.map((l) => [l.rotulo, Math.round(l.gasto), l.qualificados])).toEqual([
      ["A", 300, 0],
      ["B", 100, 1],
    ]);
    const pa = r.comparacoes.find((c) => c.titulo === "Persona × Público aberto")!;
    expect(pa.lados[0]).toMatchObject({ inscritos: 3, qualificados: 3 });
    expect(pa.lados[0].gasto).toBeCloseTo(320);
    expect(pa.lados[1]).toMatchObject({ anuncios: 3 });
    expect(pa.lados[1].gasto).toBeCloseTo(490);
  });
});
