/**
 * Fase 1 — números que mentiam. Fixture sintética (nenhum dado real).
 */
import { describe, expect, it } from "vitest";
import {
  awarenessKpis,
  cohortWeekly,
  countLostAfterMeeting,
  dailySeries,
  lossBreakdown,
  overviewKpis,
  trechosSemDado,
} from "../metrics";
import { assessTrust } from "../trust";
import { resumirCascata, type Degrau } from "../cascata";
import { resolveRange } from "../range";
import { frescorDaFonte } from "../frescor";
import { mensagemHumana } from "../erros";
import { formatIntComSinal } from "../format";
import type { AdDaily, DashboardData, Lead } from "../types";

const ad = (date: string, campaign: string, spend: number, extra: Partial<AdDaily> = {}): AdDaily => ({
  brand: "consorcio",
  date,
  campaign,
  adset: "Conjunto",
  adId: extra.adId ?? "111111",
  objective: "OUTCOME_LEADS",
  spend,
  impressions: 1000,
  reach: 800,
  frequency: 1.25,
  clicks: 10,
  leads: 1,
  ...extra,
});

const lead = (id: string, createdAt: string, extra: Partial<Lead> = {}): Lead => ({
  id,
  brand: "consorcio",
  createdAt,
  name: "Pessoa Teste",
  status: "lead",
  utmSource: "meta",
  ...extra,
});

function dataset(parts: Partial<DashboardData>): DashboardData {
  return {
    campaign: {
      id: "c",
      brand: "consorcio",
      name: "Campanha",
      objective: "Leads",
      status: "ativa",
      startDate: "2026-07-27",
      budgetTotal: 0,
    },
    igAccountDaily: [],
    igPosts: [],
    adDaily: [],
    creatives: [],
    lpDaily: [],
    leads: [],
    goals: [],
    updatedAt: "2026-10-07T12:00:00.000Z",
    ...parts,
  };
}

describe("B2 — alerta de outra marca usa só o período", () => {
  it("R$ 735 de [KRN] fora dos 7 dias não vira '359% do investimento'", () => {
    const data = dataset({
      adDaily: [
        ad("2026-08-10", "[KRN] Seguidores", 735, { adId: "999" }),
        ad("2026-10-02", "[BRN] Leads", 100),
        ad("2026-10-03", "[BRN] Leads", 104),
      ],
    });
    const range = { from: "2026-10-01", to: "2026-10-07" };
    const k = overviewKpis(data, range);
    const t = assessTrust({
      data,
      range,
      hoje: "2026-10-07",
      brandRules: [{ slug: "krone", campaignMatch: ["krn -"] }],
      kpis: { meetings: k.meetings, leads: k.leads, spendConversao: k.spendConversao, spendTotal: k.spend },
    });
    expect(t.travas.some((x) => x.id.startsWith("marca-prefixo"))).toBe(false);
    for (const x of t.travas) expect(x.detalhe).not.toMatch(/\d{3,}% do investimento/);
  });
});

describe("S11 — quarentena do custo por reunião olha as reuniões de CONVERSÃO", () => {
  it("3 reuniões no total, só 1 paga: o CPR (gasto ÷ 1) fica em quarentena", () => {
    const data = dataset({
      adDaily: [ad("2026-10-01", "[BRN] Leads", 300)],
      leads: [
        lead("pago", "2026-10-01T10:00:00Z", { status: "agendado", bookedAt: "2026-10-02T10:00:00Z", utmContent: "x|111111" }),
        lead("org1", "2026-10-01T11:00:00Z", { status: "agendado", bookedAt: "2026-10-02T10:00:00Z", utmSource: "ig" }),
        lead("org2", "2026-10-01T12:00:00Z", { status: "agendado", bookedAt: "2026-10-02T10:00:00Z", utmSource: "ig" }),
      ],
    });
    const k = overviewKpis(data);
    expect(k.meetings).toBe(3);
    expect(k.meetingsConversao).toBe(1);
    const t = assessTrust({
      data,
      hoje: "2026-10-07",
      brandRules: [],
      kpis: {
        meetings: k.meetings,
        leads: k.leads,
        spendConversao: k.spendConversao,
        spendTotal: k.spend,
        meetingsConversao: k.meetingsConversao,
        leadsConversao: k.leadsConversao,
      },
    });
    expect(t.porMetrica.cpr?.nivel).toBe("quarentena");
  });
});

describe("B20 — 'perdas sem reunião' não conta quem teve reunião", () => {
  it("o lead que agendou e depois sumiu sai da quebra e é contado à parte", () => {
    const leads = [
      lead("a", "2026-09-01T10:00:00Z", { status: "sem_resposta" }),
      lead("b", "2026-09-01T10:00:00Z", { status: "sem_resposta", bookedAt: "2026-09-02T10:00:00Z" }),
    ];
    const semResposta = lossBreakdown(leads).find((r) => r.status === "sem_resposta");
    expect(semResposta?.count).toBe(1);
    expect(countLostAfterMeeting(leads)).toBe(1);
  });
});

describe("B21 — coorte mostra a semana sem lead", () => {
  it("semana de 28/09 sem lead e sem anúncio aparece com 0 e 'sem veiculação'", () => {
    const data = dataset({
      adDaily: [ad("2026-09-22", "[BRN] Leads", 50), ad("2026-10-06", "[BRN] Leads", 50)],
      leads: [lead("a", "2026-09-22T10:00:00Z"), lead("b", "2026-10-06T10:00:00Z")],
    });
    const c = cohortWeekly(data, undefined, "2026-10-07T12:00:00Z");
    expect(c.map((x) => [x.week, x.leads, x.semVeiculacao])).toEqual([
      ["2026-09-21", 1, false],
      ["2026-09-28", 0, true],
      ["2026-10-05", 1, false],
    ]);
  });
});

describe("B22 — o resumo da cascata não pula as reuniões", () => {
  it("mantém 'Reuniões agendadas' entre Leads e Clientes", () => {
    const d = (key: string, valor: number, extra: Partial<Degrau> = {}): Degrau =>
      ({ key, label: key, valor, fonte: "painel", ...extra }) as Degrau;
    const resumo = resumirCascata([
      d("impressoes", 100000, { ehAncora: true }),
      d("leads", 113, { ehAncora: true }),
      d("reunioes", 1),
      d("compareceu", 0),
      d("clientes", 0),
    ]);
    expect(resumo.map((x) => x.key)).toContain("reunioes");
  });
});

describe("B12 — série diária contínua", () => {
  it("preenche os dias sem linha e marca o trecho", () => {
    const data = dataset({ adDaily: [ad("2026-09-01", "c", 10), ad("2026-09-04", "c", 20)] });
    const s = dailySeries(data);
    expect(s.map((p) => [p.date, p.spend, p.semDado])).toEqual([
      ["2026-09-01", 10, false],
      ["2026-09-02", 0, true],
      ["2026-09-03", 0, true],
      ["2026-09-04", 20, false],
    ]);
    expect(trechosSemDado(s)).toEqual([{ from: "2026-09-02", to: "2026-09-03" }]);
  });
});

describe("S8 — '7 dias' conta a partir de hoje, não do último anúncio", () => {
  it("com o sync parado em 22/09, '7 dias' em 07/10 é 01/10–07/10", () => {
    expect(resolveRange("7d", { from: "2026-07-27", to: "2026-09-22" }, "2026-10-07")).toEqual({
      from: "2026-10-01",
      to: "2026-10-07",
    });
  });
  it("marca sem anúncio ainda tem período (antes virava 'tudo')", () => {
    expect(resolveRange("7d", { from: "", to: "" }, "2026-10-07")).toEqual({ from: "2026-10-01", to: "2026-10-07" });
  });
  it("hoje (ainda incompleto) não conta como dia sem dado", () => {
    const data = dataset({
      adDaily: ["01", "02", "03", "04", "05", "06"].map((d) => ad(`2026-10-${d}`, "c", 10)),
    });
    const k = overviewKpis(data, { from: "2026-10-01", to: "2026-10-07" });
    const t = assessTrust({
      data,
      range: { from: "2026-10-01", to: "2026-10-07" },
      hoje: "2026-10-07",
      brandRules: [],
      kpis: { meetings: k.meetings, leads: k.leads, spendConversao: k.spendConversao, spendTotal: k.spend },
    });
    expect(t.travas.some((x) => x.id === "cobertura-de-dias")).toBe(false);
  });
});

describe("B16 — marca sem verba não tem custo 'R$ 0,00'", () => {
  it("custo por seguidor é desconhecido (null), não zero", () => {
    const data = dataset({
      campaign: { id: "k", brand: "krone", name: "K", objective: "Seguidores", status: "ativa", startDate: "2026-08-01", budgetTotal: 0 },
      igAccountDaily: [
        { brand: "krone", date: "2026-10-01", followers: 90, reach: 100, views: 200, profileLinkTaps: 0, accountsEngaged: 1, totalInteractions: 1, profileViews: 0 },
        { brand: "krone", date: "2026-10-07", followers: 95, reach: 100, views: 200, profileLinkTaps: 0, accountsEngaged: 1, totalInteractions: 1, profileViews: 0 },
      ],
    });
    const a = awarenessKpis(data);
    expect(a.spend).toBe(0);
    expect(a.costPerFollower).toBeNull();
    expect(a.costPerReach).toBeNull();
  });
});

describe("B3 / D4 — frescor por fonte", () => {
  const agora = new Date("2026-10-07T15:00:00Z");
  it("sync de hoje cedo está ok; de ontem cedo, velho; de 3 dias, muito velho", () => {
    expect(frescorDaFonte("Meta", "2026-10-07T09:00:00Z", agora).nivel).toBe("ok");
    expect(frescorDaFonte("Meta", "2026-10-06T09:00:00Z", agora).nivel).toBe("velho");
    expect(frescorDaFonte("Meta", "2026-10-04T09:00:00Z", agora).nivel).toBe("muito-velho");
  });
  it("mostra a hora de Brasília, não a do servidor", () => {
    expect(frescorDaFonte("Meta", "2026-10-07T12:00:00Z", agora).quando).toBe("07/10 09:00");
  });
  it("nunca sincronizou é dito, não escondido", () => {
    expect(frescorDaFonte("Instagram", null, agora)).toMatchObject({ quando: "nunca", nivel: "muito-velho" });
  });
});

describe("B14 — erro técnico vira frase", () => {
  it("TypeError: fetch failed", () => {
    const m = mensagemHumana("robô", new TypeError("fetch failed"));
    expect(m).toMatch(/conexão falhou/);
    expect(m).not.toMatch(/TypeError/);
  });
  it("token vencido da Meta", () => {
    expect(mensagemHumana("Meta", new Error("Error validating access token: Session has expired"))).toMatch(
      /credencial de acesso venceu/,
    );
  });
  it("desconhecido não vaza o texto cru", () => {
    expect(mensagemHumana("IA", new Error("xyz interno 0x1f"))).not.toMatch(/0x1f/);
  });
});

describe("B10 — sinal", () => {
  it("negativo não vira '+-'", () => {
    expect(formatIntComSinal(-12)).toBe("−12");
    expect(formatIntComSinal(878)).toBe("+878");
    expect(formatIntComSinal(0)).toBe("0");
  });
});
