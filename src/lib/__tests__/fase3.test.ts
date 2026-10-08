/**
 * Fase 3 — um número por métrica. Fixture sintética (nenhum dado real).
 */
import { describe, expect, it } from "vitest";
import { buildSeedData } from "../data/seed";
import {
  adsetPerformance,
  creativePerformance,
  dailySeries,
  dataDateRange,
  objectiveBreakdown,
  overviewKpis,
  perdasDoPeriodo,
  trechosSemDado,
  trechosSemVeiculacao,
  type DateRange,
} from "../metrics";
import { custoExibivel, kpisDoPeriodo, mostrar } from "../kpis";
import { montarCascata } from "../cascata";
import { contarParados, montarFarol } from "../farol";
import { buildBriefing } from "../ai/briefing";
import { buildRecommendations } from "../recommendations";
import { assessTrust } from "../trust";
import { janelasCobertas } from "../cobertura";
import { atribuidor, isPaidSource } from "../atribuicao";
import { alertasDeAtribuicao } from "../alertas";
import { brandForCampaign, CURINGA, NAO_CLASSIFICADO, type BrandMeta } from "../meta/config";
import { DICIONARIO } from "../dicionario";
import type { AdDaily, Creative, DashboardData, Lead, SyncRun } from "../types";

// ---------------------------------------------------------------- fixtures

const ad = (date: string, adId: string, spend: number, extra: Partial<AdDaily> = {}): AdDaily => ({
  brand: "consorcio",
  date,
  campaign: "Campanha",
  adset: "Conjunto",
  adId,
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
  createdAt: `${createdAt}T12:00:00.000Z`,
  name: "Pessoa Teste",
  status: "lead",
  utmSource: "meta",
  utmContent: "Anúncio A|100001",
  ...extra,
});

const criativo = (adId: string, name: string): Creative => ({ adId, brand: "consorcio", name, format: "imagem" });

function base(over: Partial<DashboardData>): DashboardData {
  return {
    campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-09-01", budgetTotal: 0 },
    igAccountDaily: [],
    igPosts: [],
    adDaily: [],
    creatives: [],
    lpDaily: [],
    leads: [],
    goals: [],
    updatedAt: "2026-10-08T12:00:00.000Z",
    ...over,
  };
}

const OUT: DateRange = { from: "2026-10-01", to: "2026-10-07" };

// ---------------------------------------------------------------- reuniões

describe("reuniões agendadas contam pela data do agendamento (período)", () => {
  const data = base({
    adDaily: [ad("2026-09-10", "100001", 300), ad("2026-10-03", "100001", 600)],
    creatives: [criativo("100001", "Anúncio A")],
    leads: [
      // entrou em setembro, agendou em outubro: reunião de OUTUBRO
      lead("set", "2026-09-10", { status: "agendado", bookedAt: "2026-10-02T15:00:00.000Z" }),
      // entrou em outubro, agendou em outubro
      lead("out1", "2026-10-02", { status: "reuniao_realizada", bookedAt: "2026-10-03T15:00:00.000Z" }),
      // entrou em outubro, ainda não agendou
      lead("out2", "2026-10-04"),
      // desistiu: sai da conta da mídia
      lead("desist", "2026-10-02", { status: "desistencia", bookedAt: "2026-10-03T15:00:00.000Z" }),
    ],
  });

  it("o lead de setembro que marcou em outubro é reunião de outubro", () => {
    const k = kpisDoPeriodo(data, OUT);
    expect(k.reunioesAgendadas.valor).toBe(2);
    expect(kpisDoPeriodo(data, { from: "2026-09-01", to: "2026-09-30" }).reunioesAgendadas.valor).toBe(0);
  });

  it("a taxa lead → reunião é da COORTE (quem entrou no período), com outro nome", () => {
    const k = kpisDoPeriodo(data, OUT);
    expect(k.leads.valor).toBe(3);
    expect(k.agendaram.valor).toBe(1); // só out1 (a desistência não conta)
    expect(k.taxaLeadAgendada.valor).toBeCloseTo(1 / 3, 6);
    expect(DICIONARIO.agendaram.nome).not.toBe(DICIONARIO.reunioes_agendadas.nome);
  });

  it("a reunião de um lead cujo anúncio parou antes do período continua sendo de conversão", () => {
    const k = kpisDoPeriodo(data, OUT);
    expect(k.reunioesConversao.valor).toBe(2);
  });
});

// ---------------------------------------------------------------- a régua única

describe("custo por reunião: uma régua só (MIN_REUNIOES) em toda a parte", () => {
  const data = base({
    adDaily: [ad("2026-10-02", "100001", 900)],
    creatives: [criativo("100001", "Anúncio A")],
    leads: [
      lead("a", "2026-10-02", { status: "agendado", bookedAt: "2026-10-03T12:00:00.000Z" }),
      lead("b", "2026-10-02", { status: "agendado", bookedAt: "2026-10-03T12:00:00.000Z" }),
      lead("c", "2026-10-02"),
    ],
  });
  const k = kpisDoPeriodo(data, OUT);

  it("com 2 reuniões o custo não é exibido em lugar nenhum", () => {
    expect(custoExibivel(k.custoPorReuniao)).toBe(false);
    expect(mostrar(k.custoPorReuniao, "moeda")).toBe("—");
    const b = buildBriefing(data, OUT, { nowIso: "2026-10-08T12:00:00.000Z", warnings: [] });
    expect("pago" in b && b.pago && "cpr" in b.pago ? b.pago.cpr : "x").toBeNull();
  });

  it("o farol não imprime o custo por reunião e diz o fato (verba e reuniões)", () => {
    const c = montarCascata({ data, range: OUT, robo: null, comercial: null, kpis: k });
    const f = montarFarol({ degraus: c.degraus, trust: k.trust, kpis: k, parados: 0, midiaParada: 0, fontesOk: true });
    expect(f.rotulo).not.toBe("custo por reunião");
    expect(f.porQueEsteNumero).toMatch(/investidos em conversão para 2 reuniões/);
  });

  it("sem lead não há CPL: '—', nunca R$ 0,00", () => {
    const vazio = kpisDoPeriodo(base({ adDaily: [ad("2026-10-02", "100001", 100)] }), OUT);
    expect(mostrar(vazio.cpl, "moeda")).toBe("—");
  });
});

// ---------------------------------------------------------------- consistência (portão)

function porMarca(d: DashboardData, brand: string): DashboardData {
  return {
    ...d,
    campaign: { ...d.campaign, brand },
    igAccountDaily: d.igAccountDaily.filter((r) => r.brand === brand),
    igPosts: d.igPosts.filter((r) => r.brand === brand),
    adDaily: d.adDaily.filter((r) => r.brand === brand),
    creatives: d.creatives.filter((r) => r.brand === brand),
    lpDaily: d.lpDaily.filter((r) => r.brand === brand),
    leads: d.leads.filter((r) => r.brand === brand && !r.deletedAt),
    goals: d.goals.filter((r) => r.brand === brand),
  };
}

describe("portão da Fase 3: mesmo nome, mesmo número (3 períodos × 2 marcas)", () => {
  const seed = buildSeedData();
  for (const brand of ["consorcio", "krone"]) {
    const data = porMarca(seed, brand);
    const span = dataDateRange(data);
    const ultimo = span.to || "2026-10-07";
    const menos = (n: number) => {
      const d = new Date(`${ultimo}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - n);
      return d.toISOString().slice(0, 10);
    };
    const periodos: [string, DateRange | undefined][] = [
      ["7 dias", { from: menos(6), to: ultimo }],
      ["30 dias", { from: menos(29), to: ultimo }],
      ["campanha", undefined],
    ];
    for (const [nome, range] of periodos) {
      it(`${brand} · ${nome}`, () => {
        const k = kpisDoPeriodo(data, range);
        const ov = overviewKpis(data, range);
        const obj = objectiveBreakdown(data, range);

        // O pacote legado e a divisão por objetivo são a MESMA conta.
        expect(ov.leads).toBe(k.leads.valor);
        expect(ov.cpl).toBe(k.cpl.valor);
        expect(ov.meetings).toBe(k.reunioesAgendadas.valor);
        expect(ov.cpr).toBe(k.custoPorReuniao.valor);
        expect(obj.conversao.leads).toBe(k.leadsConversao.valor);
        expect(obj.conversao.cpl).toBe(k.cpl.valor);
        expect(obj.conversao.meetings).toBe(k.reunioesConversao.valor);
        expect(obj.conversao.cpr).toBe(k.custoPorReuniao.valor);

        // A cascata lê os mesmos leads e, no degrau Leads, o mesmo CPL.
        const c = montarCascata({ data, range, robo: null, comercial: null, kpis: k });
        const leadsDegrau = c.degraus.find((d) => d.key === "leads")!;
        expect(leadsDegrau.valor).toBe(k.leads.valor);
        if (leadsDegrau.custoUnitario !== undefined) expect(leadsDegrau.custoUnitario).toBe(k.cpl.valor);
        // E não imprime um segundo custo por reunião.
        expect(c.degraus.find((d) => d.key === "reunioes")?.custoUnitario).toBeUndefined();

        // O farol, quando mostra custo por reunião, mostra ESTE.
        const p = contarParados(c.degraus);
        const f = montarFarol({ degraus: c.degraus, trust: k.trust, kpis: k, parados: 0, midiaParada: p.midiaParada, fontesOk: true });
        if (f.rotulo === "custo por reunião" && f.valor !== null) {
          expect(f.valor).toBe(k.custoPorReuniao.valor);
          expect(custoExibivel(k.custoPorReuniao)).toBe(true);
        }
        if (f.rotulo.startsWith("CPL")) expect(f.valor).toBe(k.cpl.valor);

        // A IA recebe os mesmos números (ou null, onde a tela mostra "—").
        const b = buildBriefing(data, range, { nowIso: "2026-10-08T12:00:00.000Z", warnings: [] });
        if ("pago" in b && b.pago && "reunioesAgendadasNoPeriodo" in b.pago) {
          expect(b.pago.leads).toBe(k.leads.valor);
          expect(b.pago.reunioesAgendadasNoPeriodo).toBe(k.reunioesAgendadas.valor);
          expect(b.pago.cpr === null).toBe(!custoExibivel(k.custoPorReuniao));
          expect(b.pago.cpl === null).toBe(!custoExibivel(k.cpl));
        }

        // Tabelas por anúncio/conjunto: os leads do painel atribuídos nunca passam do total.
        const perf = creativePerformance(data, range);
        expect(perf.reduce((s, x) => s + x.leadsPainel, 0)).toBeLessThanOrEqual(k.leads.valor);
        const adsets = adsetPerformance(data, range);
        expect(adsets.reduce((s, x) => s + x.meetings, 0)).toBeLessThanOrEqual(k.reunioesAgendadas.valor);

        // O motor de ações não decide por custo por reunião abaixo da régua.
        const recs = buildRecommendations(data, range, "2026-10-08T12:00:00.000Z");
        if (!custoExibivel(k.custoPorReuniao)) {
          expect(recs.some((r) => r.id === "cpr-over" || r.id === "realloc" || r.id.startsWith("scale-"))).toBe(false);
        }
      });
    }
  }
});

// ---------------------------------------------------------------- cobertura (ADR-06)

describe("pausa × falha pela cobertura do sync", () => {
  const run = (from: string, to: string, fim: string, ok = true): SyncRun => ({
    id: `${from}-${fim}`,
    source: "ads",
    brand: "consorcio",
    startedAt: `${fim}T09:00:00.000Z`,
    finishedAt: `${fim}T09:01:00.000Z`,
    ok,
    dateFrom: from,
    dateTo: to,
  });

  it("um sync só cobre até 2 dias antes de terminar (a Meta atrasa) e as janelas se fundem", () => {
    expect(janelasCobertas([run("2026-09-01", "2026-09-10", "2026-09-10"), run("2026-09-09", "2026-09-20", "2026-09-20")])).toEqual([
      { from: "2026-09-01", to: "2026-09-18" },
    ]);
  });

  it("sync que falhou não cobre nada", () => {
    expect(janelasCobertas([run("2026-09-01", "2026-09-30", "2026-10-05", false)])).toEqual([]);
  });

  it("dia coberto sem linha é 'sem veiculação'; descoberto é 'sem dados'", () => {
    const data = base({ adDaily: [ad("2026-10-01", "1", 10), ad("2026-10-05", "1", 10)] });
    const cobertura = janelasCobertas([run("2026-09-25", "2026-10-03", "2026-10-06")]); // cobre até 04/10
    const s = dailySeries(data, { from: "2026-10-01", to: "2026-10-05" }, cobertura);
    expect(trechosSemVeiculacao(s)).toEqual([{ from: "2026-10-02", to: "2026-10-03" }]);
    expect(trechosSemDado(s)).toEqual([{ from: "2026-10-04", to: "2026-10-04" }]);
  });

  it("dias de campanha parada confirmados pelo sync não viram piso", () => {
    const data = base({ adDaily: [ad("2026-10-01", "1", 10), ad("2026-10-07", "1", 10)] });
    const range = { from: "2026-10-01", to: "2026-10-07" };
    const kpis = { meetings: 0, leads: 0, spendConversao: 20, spendTotal: 20 };
    const sem = assessTrust({ data, range, brandRules: [], kpis, hoje: "2026-10-20" });
    expect(sem.porMetrica.spend?.nivel).toBe("piso");
    const com = assessTrust({
      data,
      range,
      brandRules: [],
      kpis,
      hoje: "2026-10-20",
      cobertura: [{ from: "2026-09-01", to: "2026-10-10" }],
    });
    expect(com.porMetrica.spend).toBeUndefined();
  });
});

// ---------------------------------------------------------------- atribuição

describe("atribuição do lead ao anúncio (3.5)", () => {
  const atribuir = atribuidor([criativo("100001", "Vídeo A"), criativo("100002", "Carrossel -"), criativo("100003", "Carrossel -")]);

  it("id embutido decide", () => {
    expect(atribuir({ utmContent: "qualquer|100002" })).toEqual({ adId: "100002", tipo: "id" });
  });
  it("só o nome: vale se for único", () => {
    expect(atribuir({ utmContent: "Vídeo A" })).toEqual({ adId: "100001", tipo: "nome" });
  });
  it("nome repetido em dois anúncios é ambíguo — não atribui a nenhum", () => {
    expect(atribuir({ utmContent: "Carrossel -" })).toEqual({ tipo: "ambigua", candidatos: 2 });
  });
  it("macro literal é origem desconhecida", () => {
    expect(atribuir({ utmContent: "{{ad.name}}" })).toEqual({ tipo: "macro" });
  });
  it("utm_medium pago conta como mídia paga mesmo com utm_source=instagram", () => {
    expect(isPaidSource("instagram", "paid_social")).toBe(true);
    expect(isPaidSource("instagram", undefined)).toBe(false);
  });
  it("vira alerta, com a contagem do período", () => {
    const data = base({
      creatives: [criativo("100002", "Carrossel -"), criativo("100003", "Carrossel -")],
      leads: [lead("m", "2026-10-02", { utmContent: "{{ad.name}}" }), lead("a", "2026-10-03", { utmContent: "Carrossel -" })],
    });
    const al = alertasDeAtribuicao(data, OUT);
    expect(al.map((a) => a.id)).toEqual(["atribuicao-macro", "atribuicao-ambigua"]);
  });
});

// ---------------------------------------------------------------- marca

describe("marca: 'não classificado' em vez de cair calado na padrão (3.4)", () => {
  const m = (slug: string, campaignMatch: string[]): BrandMeta =>
    ({ slug, campaignMatch, adAccountId: "act_1" }) as unknown as BrandMeta;

  it("conta de uma marca só: tudo é dela", () => {
    expect(brandForCampaign("Qualquer", undefined, [m("consorcio", ["[BRN]"])])).toBe("consorcio");
  });
  it("ninguém configurou regra: tudo continua na marca padrão (a conta não esvazia no deploy)", () => {
    expect(brandForCampaign("Qualquer", undefined, [m("krone", []), m("consorcio", [])])).toBe("consorcio");
  });
  it("compatibilidade: a única marca sem regra continua sendo o resto", () => {
    expect(brandForCampaign("Sem token", undefined, [m("consorcio", []), m("krone", ["[KRN]"])])).toBe("consorcio");
  });
  it("com regra em todas, o que não casa fica não classificado", () => {
    expect(brandForCampaign("Sem token", undefined, [m("consorcio", ["[BRN]"]), m("krone", ["[KRN]"])])).toBe(NAO_CLASSIFICADO);
    expect(brandForCampaign("[KRN] Alcance", undefined, [m("consorcio", ["[BRN]"]), m("krone", ["[KRN]"])])).toBe("krone");
  });
  it("o curinga declara o resto", () => {
    expect(brandForCampaign("Sem token", undefined, [m("consorcio", [CURINGA]), m("krone", ["[KRN]"])])).toBe("consorcio");
  });
  it("regra por id de campanha", () => {
    expect(brandForCampaign("Nome qualquer", "12345", [m("consorcio", ["[BRN]"]), m("krone", ["12345"])])).toBe("krone");
  });
});

// ---------------------------------------------------------------- perdas

describe("'Sem resposta' sem tentativa sai da conta da mídia (2.4)", () => {
  it("separa quem nunca foi contatado", () => {
    const data = base({
      leads: [
        lead("tentado", "2026-10-02", { status: "sem_resposta", lostAt: "2026-10-05T12:00:00.000Z" }),
        lead("nunca", "2026-10-02", { status: "sem_resposta", lostAt: "2026-10-05T12:00:00.000Z" }),
        lead("invalido", "2026-10-02", { status: "contato_invalido", lostAt: "2026-10-05T12:00:00.000Z" }),
      ],
    });
    const p = perdasDoPeriodo(data, OUT, new Set(["tentado"]));
    expect(p.semTentativa).toBe(1);
    expect(p.porTipo.qualidade).toBe(2);
    expect(p.total).toBe(2);
  });
});
