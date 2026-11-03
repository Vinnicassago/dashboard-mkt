/**
 * E1-14 — a separação de marcas com [KRN]. Fixture sintética que imita a
 * produção de out/2026: campanhas [BRN] da Consórcio, posts impulsionados
 * "[KRN] -Post…" da Krone (R$ 735 em agosto) e a regra salva `krn -`.
 */
import { describe, expect, it } from "vitest";
import { overviewKpis } from "../metrics";
import { assessTrust, type TrustInput } from "../trust";
import { casaToken, normalizarCampanha, tokenQueCasa } from "../regra-de-marca";
import { agruparCampanhasDaConta } from "../data/backend";
import { brandForCampaign, CURINGA, NAO_CLASSIFICADO, type BrandMeta } from "../meta/config";
import type { AdDaily, DashboardData } from "../types";

const ad = (brand: string, date: string, campaign: string, spend: number, adId: string): AdDaily => ({
  brand,
  date,
  campaign,
  adset: "Conjunto",
  adId,
  objective: "OUTCOME_LEADS",
  spend,
  impressions: 1000,
  reach: 800,
  frequency: 1.25,
  clicks: 10,
  leads: 1,
});

function dataset(brand: string, adDaily: AdDaily[]): DashboardData {
  return {
    campaign: { id: "c", brand, name: "Campanha", objective: "Leads", status: "ativa", startDate: "2026-07-27", budgetTotal: 0 },
    igAccountDaily: [],
    igPosts: [],
    adDaily,
    creatives: [],
    lpDaily: [],
    leads: [],
    goals: [],
    updatedAt: "2026-11-03T12:00:00.000Z",
  };
}

const m = (slug: string, campaignMatch: string[]): BrandMeta => ({ slug, campaignMatch });

/** A conta inteira, antes de qualquer correção: tudo caiu na Consórcio. */
const CONTA: AdDaily[] = [
  ad("consorcio", "2026-08-10", "[KRN] -Post 10/08", 735, "900"),
  ad("consorcio", "2026-10-02", "[BRN] Leads Outubro", 2763, "100"),
  ad("consorcio", "2026-10-05", "[BRN] Seguidores", 844, "200"),
];

/** O que a página passa ao `assessTrust`: os números do período e o contexto de marcas. */
function travasDe(data: DashboardData, range: TrustInput["range"], brandRules: BrandMeta[], conta?: AdDaily[]) {
  const k = overviewKpis(data, range);
  return assessTrust({
    data,
    range,
    hoje: "2026-11-03",
    // Syncs cobriram tudo: dia sem linha é campanha parada, não buraco (sem "≥" de cobertura).
    cobertura: [{ from: "2026-07-01", to: "2026-11-02" }],
    brandRules,
    campanhasDaConta: conta ? agruparCampanhasDaConta(conta) : undefined,
    kpis: { meetings: k.meetings, leads: k.leads, spendConversao: k.spendConversao, spendTotal: k.spend },
  });
}

/** A reclassificação: reetiqueta cada linha pela regra (a mesma função do sync). */
const reclassificar = (rows: AdDaily[], regras: BrandMeta[]) =>
  rows.map((r) => ({ ...r, brand: brandForCampaign(r.campaign, r.campaignId, regras) }));

const OUTUBRO = { from: "2026-10-01", to: "2026-10-31" };

describe("regra de marca — casamento sem as diferenças que o olho não vê", () => {
  it("maiúsculas, espaço dentro do colchete, espaço repetido ou não separável e colchete de largura cheia", () => {
    for (const nome of ["[KRN] -Post 10/08", "[krn] -post", "[ KRN ] -Post", "［KRN］ Seguidores", "[KRN] -Post", "  [KRN]   Post"]) {
      expect(casaToken(nome, undefined, "[KRN]")).toBe(true);
    }
    expect(normalizarCampanha("  [ KRN ]  -Post ")).toBe("[krn] -post");
  });

  it("`krn -` não casa com '[KRN] -Post' — era por isso que a regra salva não pegava nada", () => {
    expect(casaToken("[KRN] -Post 10/08", undefined, "krn -")).toBe(false);
    expect(casaToken("krn - seguidores agosto", undefined, "krn -")).toBe(true);
  });

  it("id numérico compara com o id da campanha; curinga e token vazio nunca casam", () => {
    expect(casaToken("Qualquer nome", "120001", "120001")).toBe(true);
    expect(casaToken("Campanha 120001", undefined, "120001")).toBe(false);
    expect(casaToken("Tem * no nome", undefined, CURINGA)).toBe(false);
    expect(casaToken("Qualquer", undefined, "  ")).toBe(false);
    expect(tokenQueCasa("[KRN] -Post", undefined, ["krn -", "[KRN]"])).toBe("[KRN]");
  });

  it("brandForCampaign: com [KRN] na Krone, toda campanha que começa com [KRN] vai para ela — e só ela", () => {
    const regras = [m("consorcio", []), m("krone", ["[KRN]", "krn -"])];
    expect(brandForCampaign("[KRN] -Post 10/08", undefined, regras)).toBe("krone");
    expect(brandForCampaign("[ krn ] Seguidores", undefined, regras)).toBe("krone");
    expect(brandForCampaign("krn - seguidores agosto", undefined, regras)).toBe("krone");
    expect(brandForCampaign("[BRN] Leads Outubro", undefined, regras)).toBe("consorcio");
    // regra nas duas marcas: o que não casa com nenhuma fica fora de todos os números
    expect(brandForCampaign("Sem marca", undefined, [m("consorcio", ["[BRN]"]), m("krone", ["[KRN]"])])).toBe(NAO_CLASSIFICADO);
  });
});

describe("E1-14 — o '≤' do investimento sai quando a regra está aplicada", () => {
  const regraVelha = [m("consorcio", []), m("krone", ["krn -"])];
  const regraNova = [m("consorcio", []), m("krone", ["[KRN]", "krn -"])];

  it("ANTES, outubro: a regra salva não casa com campanha nenhuma da conta → aviso e '≤'", () => {
    const data = dataset("consorcio", CONTA);
    const t = travasDe(data, OUTUBRO, regraVelha, CONTA);
    expect(t.travas.map((x) => x.id)).toContain("marca-regra-inerte");
    expect(t.porMetrica.spend?.nivel).toBe("teto");
  });

  it("ANTES, campanha inteira: os R$ 735 de [KRN] aparecem como prefixo sem dono", () => {
    const data = dataset("consorcio", CONTA);
    const t = travasDe(data, undefined, regraVelha, CONTA);
    const orfao = t.travas.find((x) => x.id === "marca-prefixo-[KRN]");
    expect(orfao?.titulo).toBe("R$ 735 em campanhas [KRN] estão nesta marca");
    expect(orfao?.detalhe).toContain('A regra salva hoje ("krn -") não casa com nenhuma campanha.');
  });

  it("DEPOIS: regra [KRN] aplicada ao histórico → nenhum aviso de marca, investimento exato, nos dois períodos", () => {
    const conta = reclassificar(CONTA, regraNova);
    const consorcio = dataset("consorcio", conta.filter((r) => r.brand === "consorcio"));
    for (const range of [OUTUBRO, undefined]) {
      const t = travasDe(consorcio, range, regraNova, conta);
      expect(t.travas.filter((x) => x.id.startsWith("marca-"))).toEqual([]);
      expect(t.porMetrica.spend).toBeUndefined();
      // (o CPL desta fixture fica em quarentena por não ter lead — o que importa é não ser "≤")
      expect(t.porMetrica.cpl?.nivel).not.toBe("teto");
    }
    // e os números que mudaram de lugar
    const soma = (rows: AdDaily[]) => rows.reduce((s, r) => s + r.spend, 0);
    expect(soma(consorcio.adDaily)).toBe(3607);
    expect(soma(conta.filter((r) => r.brand === "krone"))).toBe(735);
  });

  it("DEPOIS, na Krone: a Consórcio sem regra (recebe o resto) não é 'separação nunca configurada'", () => {
    const conta = reclassificar(CONTA, regraNova);
    const krone = dataset("krone", conta.filter((r) => r.brand === "krone"));
    const t = travasDe(krone, undefined, regraNova, conta);
    expect(t.travas.filter((x) => x.id.startsWith("marca-"))).toEqual([]);
    expect(t.porMetrica.spend).toBeUndefined();
  });

  it("sem regra em marca nenhuma, o aviso de separação nunca configurada continua", () => {
    const t = travasDe(dataset("consorcio", CONTA), undefined, [m("consorcio", []), m("krone", [])], CONTA);
    expect(t.travas.map((x) => x.id)).toContain("marca-sem-regra");
  });

  it("o bug de antes: só com as linhas da própria marca, a regra que FUNCIONA parecia não pegar nada", () => {
    const conta = reclassificar(CONTA, regraNova);
    const consorcio = dataset("consorcio", conta.filter((r) => r.brand === "consorcio"));
    // Nenhuma linha daqui casa com [KRN] — porque a regra funcionou. A conta inteira mostra isso.
    const comConta = travasDe(consorcio, OUTUBRO, regraNova, conta);
    expect(comConta.travas.map((x) => x.id)).not.toContain("marca-regra-inerte");
    // Sem a conta, não há como saber: a trava não acusa (antes acusava sempre).
    const semConta = travasDe(consorcio, OUTUBRO, regraNova);
    expect(semConta.travas.map((x) => x.id)).not.toContain("marca-regra-inerte");
  });

  it("regra salva e NÃO aplicada (linhas ainda na Consórcio) vira 'outra marca neste total', não silêncio", () => {
    const data = dataset("consorcio", CONTA);
    const t = travasDe(data, undefined, regraNova, CONTA);
    const cont = t.travas.find((x) => x.id === "marca-contaminada");
    expect(cont?.titulo).toBe("R$ 735 de outra marca neste total");
    expect(t.porMetrica.spend?.nivel).toBe("teto");
  });
});
