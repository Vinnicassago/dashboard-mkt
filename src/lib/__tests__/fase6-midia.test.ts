/**
 * Fase 6.3 — Mídia (relatório §7.3; S13, S20, B9, B12, B13, B17). Fixture
 * sintética (nenhum dado real). Datas em UTC; Brasília = UTC−3.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { adsetPerformance, computeFatigue, creativePerformance, REGRA_FADIGA } from "../metrics";
import { custoExibivel, kpisDoPeriodo, mostrar, reguaDoPeriodo } from "../kpis";
import {
  COLUNAS_CONJUNTOS_CONVERSAO,
  COLUNAS_CRIATIVOS_CONVERSAO,
  COLUNAS_CRIATIVOS_DESCOBERTA,
  TODAS_AS_COLUNAS,
  conjuntosPorId,
  cplAlvoDaMidia,
  criativosAgregados,
  faixaDeSaude,
  rankingsDeCriativos,
  resumoDaMidia,
  rotuloConjunto,
  tendenciaSemanalMidia,
  textoRegraSaude,
  tituloDoCabecalho,
} from "../midia";
import { motorDeAcoes } from "../motor";
import { dica } from "../dicionario";
import { formatCurrency } from "../format";
import { MIN_REUNIOES } from "../trust";
import { CreativesTable } from "@/components/tables/creatives-table";
import { ConjuntosTable } from "@/components/midia/conjuntos-table";
import { buildSeedData } from "../data/seed";
import type { AdDaily, Creative, DashboardData, Lead, Meta } from "../types";

// ---------------------------------------------------------------- fixtures

const HOJE = "2026-10-08";
const AGORA = "2026-10-08T15:00:00.000Z";
const PERIODO = { from: "2026-09-25", to: "2026-10-08" };
const COBERTURA = [{ from: "2026-08-01", to: "2026-10-08" }];

const ad = (date: string, adId: string, extra: Partial<AdDaily> = {}): AdDaily => ({
  brand: "consorcio",
  date,
  campaign: "Consórcio Leads",
  campaignId: "900",
  adset: "Interesses 25-45",
  adsetId: "800",
  adId,
  objective: "OUTCOME_LEADS",
  spend: 50,
  impressions: 1000,
  reach: 800,
  frequency: 1.25,
  clicks: 20,
  leads: 2,
  ...extra,
});

const criativo = (adId: string, name: string, extra: Partial<Creative> = {}): Creative => ({
  adId,
  brand: "consorcio",
  name,
  format: "imagem",
  ...extra,
});

let seq = 0;
const lead = (createdAt: string, extra: Partial<Lead> = {}): Lead => ({
  id: `L${++seq}`,
  brand: "consorcio",
  createdAt: createdAt.length === 10 ? `${createdAt}T13:00:00.000Z` : createdAt,
  name: "Pessoa Teste",
  status: "lead",
  utmSource: "meta",
  utmMedium: "paid_social",
  ...extra,
});

const meta = (metrica: Meta["metrica"], alvo: number, vigenteDesde = "2026-01-01"): Meta => ({
  id: `${metrica}-${vigenteDesde}`,
  brand: "consorcio",
  metrica,
  periodo: "semana",
  alvo,
  vigenteDesde,
  provisoria: false,
  origem: "manual",
  criadaEm: `${vigenteDesde}T12:00:00.000Z`,
  criadaPor: "teste",
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
    updatedAt: AGORA,
    ...over,
  };
}

/** `n` dias de linhas de um anúncio, terminando em `fim`. */
function dias(fim: string, n: number, adId: string, extra: Partial<AdDaily> = {}): AdDaily[] {
  const out: AdDaily[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(`${fim}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(ad(d.toISOString().slice(0, 10), adId, extra));
  }
  return out;
}

const kpisDe = (data: DashboardData, range = PERIODO as { from: string; to: string } | undefined) =>
  kpisDoPeriodo(data, range, { hoje: HOJE, agora: AGORA, cobertura: COBERTURA });

/** Uma campanha de conversão com dois conjuntos e um criativo em cada, e leads do painel. */
function cenario(): DashboardData {
  const leads: Lead[] = [];
  // 12 leads do anúncio 100001 (pelo id gravado na entrada), 3 agendaram no período.
  for (let i = 0; i < 12; i++) {
    leads.push(
      lead("2026-10-01", {
        adId: "100001",
        adsetId: "800",
        campaignId: "900",
        ...(i < 3 ? { status: "agendado", bookedAt: "2026-10-03T12:00:00.000Z", meetingFor: "2026-10-10T12:00:00.000Z" } : {}),
        ...(i === 11 ? { status: "contato_invalido", lostAt: "2026-10-02T12:00:00.000Z" } : {}),
      }),
    );
  }
  // 4 leads do anúncio 100002 pelo utm_content "nome|id".
  for (let i = 0; i < 4; i++) leads.push(lead("2026-10-02", { utmContent: "Anúncio B|100002" }));
  return base({
    creatives: [criativo("100001", "Anúncio A", { creativeId: "cr-1" }), criativo("100002", "Anúncio B", { creativeId: "cr-2" })],
    adDaily: [
      ...dias("2026-10-08", 14, "100001", { spend: 60, impressions: 2000, clicks: 50 }),
      ...dias("2026-10-08", 14, "100002", { adset: "Lookalike", adsetId: "801", spend: 30, impressions: 1500, clicks: 20 }),
    ],
    leads,
  });
}

// ---------------------------------------------------------------- resumo (ADR-03)

describe("resumo da Mídia", () => {
  it("o CPL do resumo é o mesmo kpisDoPeriodo da Bússola, e o custo por reunião vira fato abaixo da régua", () => {
    const data = cenario();
    const kp = kpisDe(data);
    const resumo = resumoDaMidia(kp, reguaDoPeriodo(kp, data, PERIODO, HOJE));
    expect(resumo.cpl.medida.valor).toBe(kp.cpl.valor);
    expect(resumo.cpl.texto).toBe(mostrar(kp.cpl, "moeda"));
    expect(resumo.investimento.medida.valor).toBe(kp.investimento.valor);
    expect(resumo.conversao + resumo.descoberta).toBeCloseTo(kp.investimento.valor, 6);
    // 3 reuniões de conversão = exatamente a régua: o custo aparece.
    expect(kp.reunioesConversao.valor).toBe(MIN_REUNIOES);
    expect(resumo.custoPorReuniao.exibivel).toBe(custoExibivel(kp.custoPorReuniao));

    // Com 1 reunião só, o resumo mostra o FATO, nunca a razão (decisão 4.2).
    const pouca = cenario();
    pouca.leads = pouca.leads.map((l, i) => (i === 0 ? l : { ...l, status: "lead", bookedAt: undefined, meetingFor: undefined }));
    const kp1 = kpisDe(pouca);
    const r1 = resumoDaMidia(kp1, reguaDoPeriodo(kp1, pouca, PERIODO, HOJE));
    expect(kp1.reunioesConversao.valor).toBe(1);
    expect(r1.custoPorReuniao.exibivel).toBe(false);
    expect(r1.custoPorReuniao.texto).toMatch(/investidos em conversão · 1 reunião$/);
    expect(r1.custoPorReuniao.texto).not.toMatch(/por reunião/);
  });

  it("B9: sem orçamento cadastrado o ritmo é null (convite), com meta vem o alvo e o status", () => {
    const data = cenario();
    const kp = kpisDe(data);
    expect(resumoDaMidia(kp, reguaDoPeriodo(kp, data, PERIODO, HOJE)).ritmo).toBeNull();

    const comMeta = base({ ...data, metas: [meta("investimento_conversao", 630)] }); // R$ 90/dia × 7
    const kp2 = kpisDe(comMeta);
    const r = resumoDaMidia(kp2, reguaDoPeriodo(kp2, comMeta, PERIODO, HOJE));
    expect(r.ritmo).not.toBeNull();
    expect(r.ritmo!.alvo).toBeCloseTo(1260, 6); // 14 dias
    expect(r.ritmo!.gasto).toBe(kp2.investimentoConversao.valor);
    expect(r.ritmo!.avaliacao?.rotulo).toBe("No ritmo");
  });
});

// ---------------------------------------------------------------- tendência semanal

describe("tendência semanal", () => {
  it("cada ponto é o kpisDoPeriodo da semana (segunda a domingo), e o CPL some quando não se sustenta", () => {
    const data = cenario();
    const pontos = tendenciaSemanalMidia(data, { fim: HOJE, hoje: HOJE, semanas: 3, kpis: { cobertura: COBERTURA } });
    expect(pontos.map((p) => p.semana)).toEqual(["2026-09-21", "2026-09-28", "2026-10-05"]);
    for (const p of pontos) {
      const k = kpisDoPeriodo(data, { from: p.from, to: p.to }, { hoje: HOJE, cobertura: COBERTURA });
      expect(p.gasto).toBe(k.investimento.valor);
      expect(p.leads).toBe(k.leads.valor);
      expect(p.cpl).toBe(custoExibivel(k.cpl) ? k.cpl.valor : null);
    }
    expect(pontos[0].cpl).toBeNull(); // semana sem lead: sem CPL, não "R$ 0"
    expect(pontos[2].incompleta).toBe(true);
  });
});

// ---------------------------------------------------------------- conjuntos por id (S20)

describe("campanhas → conjuntos por id", () => {
  it("conjuntos homônimos em campanhas diferentes são linhas separadas", () => {
    const data = base({
      creatives: [criativo("100001", "A"), criativo("100002", "B")],
      adDaily: [
        ...dias("2026-10-08", 3, "100001", { campaign: "Campanha 1", campaignId: "901", adset: "Interesses", adsetId: "801" }),
        ...dias("2026-10-08", 3, "100002", { campaign: "Campanha 2", campaignId: "902", adset: "Interesses", adsetId: "802", spend: 10 }),
      ],
    });
    const bloco = conjuntosPorId(data, PERIODO);
    expect(bloco.conversao).toHaveLength(2);
    const conjuntos = bloco.conversao.flatMap((c) => c.conjuntos ?? []);
    expect(conjuntos.map((c) => `${c.campanha} › ${c.nome}`).sort()).toEqual(["Campanha 1 › Interesses", "Campanha 2 › Interesses"]);
    expect(conjuntos.map((c) => c.spend).sort((a, b) => a - b)).toEqual([30, 150]);
  });

  it("sem ids (CSV) cai no nome, e uma linha velha sem id junta-se à nova com id", () => {
    const data = base({
      creatives: [criativo("100001", "A")],
      adDaily: [
        ad("2026-10-01", "100001", { campaignId: undefined, adsetId: undefined }),
        ad("2026-10-02", "100001"),
      ],
    });
    const bloco = conjuntosPorId(data, PERIODO);
    expect(bloco.conversao).toHaveLength(1);
    expect(bloco.conversao[0].conjuntos).toHaveLength(1);
    expect(bloco.conversao[0].conjuntos![0].spend).toBe(100);
    expect(bloco.conversao[0].conjuntos![0].adsetId).toBe("800");
  });

  it("leads e reuniões pelo adsetId do lead ou pelo anúncio; nome ambíguo não entra em ninguém", () => {
    const data = cenario();
    // Dois anúncios com o MESMO nome: o lead que chega só com o nome é ambíguo.
    data.creatives.push(criativo("100003", "Anúncio A"));
    data.adDaily.push(ad("2026-10-05", "100003", { adset: "Lookalike", adsetId: "801", spend: 5 }));
    data.leads.push(lead("2026-10-04", { utmContent: "Anúncio A", status: "agendado", bookedAt: "2026-10-05T12:00:00.000Z", meetingFor: "2026-10-12T12:00:00.000Z" }));
    const bloco = conjuntosPorId(data, PERIODO, { custoPorReuniaoExibivel: true });
    const conjuntos = bloco.conversao[0].conjuntos!;
    const interesses = conjuntos.find((c) => c.adsetId === "800")!;
    const lookalike = conjuntos.find((c) => c.adsetId === "801")!;
    expect(interesses.leadsPainel).toBe(12);
    expect(interesses.agendadas).toBe(3);
    expect(interesses.contatoInvalido).toBe(1);
    expect(interesses.pctContatoInvalido).toBeCloseTo(1 / 12, 6);
    expect(interesses.custoPorAgendada).toBeCloseTo(interesses.spend / 3, 6);
    expect(lookalike.leadsPainel).toBe(4); // pelo "nome|id" → anúncio → conjunto
    expect(lookalike.agendadas).toBe(0);
    expect(lookalike.custoPorAgendada).toBeNull(); // sem reunião: "—", nunca R$ 0
    expect(lookalike.cplPainel).toBeCloseTo(lookalike.spend / 4, 6);
    expect(bloco.naoAtribuidos.ambigua).toBe(1);
    expect(conjuntos.reduce((s, c) => s + c.agendadas, 0)).toBe(3); // a reunião do ambíguo não entrou
    // Totais da campanha = soma dos conjuntos.
    expect(bloco.conversao[0].leadsPainel).toBe(16);
    expect(bloco.conversao[0].spend).toBeCloseTo(interesses.spend + lookalike.spend, 6);
  });

  it("em quarentena da conta nenhuma linha imprime custo por agendada", () => {
    const data = cenario();
    const bloco = conjuntosPorId(data, PERIODO, { custoPorReuniaoExibivel: false });
    for (const c of bloco.conversao.flatMap((l) => [l, ...(l.conjuntos ?? [])])) expect(c.custoPorAgendada).toBeNull();
  });
});

// ---------------------------------------------------------------- colunas (rótulos)

describe("rótulos das colunas", () => {
  it("nenhuma coluna chamada só “Leads”, e toda coluna do Pixel diz “Pixel” no nome", () => {
    for (const colunas of TODAS_AS_COLUNAS) {
      for (const c of colunas) {
        expect(c.header).not.toBe("Leads");
        if (c.fonte === "pixel") expect(c.header).toMatch(/Pixel/);
        if (/^Leads/.test(c.header)) expect(c.fonte).toBe("painel");
      }
    }
    const conv = COLUNAS_CONJUNTOS_CONVERSAO.map((c) => c.header);
    expect(conv).toEqual([
      "Campanha › conjunto",
      "Gasto",
      "Leads (painel)",
      "Conversões Meta (Pixel)",
      "CPL (painel)",
      "Agendadas",
      "Custo por agendada",
      "% contato inválido",
    ]);
    // B13: as secundárias dos criativos vão para a linha expandida.
    expect(COLUNAS_CRIATIVOS_CONVERSAO.filter((c) => !c.secundaria).map((c) => c.key)).toEqual(["nome", "spend", "leadsPainel", "cplPainel", "agendadas", "custoPorAgendada", "saude"]);
    expect(COLUNAS_CRIATIVOS_CONVERSAO.filter((c) => c.secundaria).map((c) => c.key)).toContain("ctr");
  });
});

// ---------------------------------------------------------------- saúde do criativo (S13/B17)

describe("computeFatigue — regra explícita no período", () => {
  const janela = (fim: string, n: number, adId: string, extra: Partial<AdDaily>) => dias(fim, n, adId, extra);

  it("só julga com ≥ 1.000 impressões em cada janela de 7 dias, e diz o motivo", () => {
    const poucas = [...janela("2026-10-01", 7, "x", { impressions: 100 }), ...janela("2026-10-08", 7, "x", { impressions: 100 })];
    const f = computeFatigue(poucas, { fim: "2026-10-08" });
    expect(f.level).toBe("novo");
    expect(f.reason).toMatch(/amostra insuficiente: 700 impressões nos últimos 7 dias e 700 nos 7 anteriores \(mínimo 1\.000 em cada janela\)/);
    // A janela anterior sozinha fraca também não dá leitura.
    const anteriorFraca = [...janela("2026-10-01", 7, "x", { impressions: 100 }), ...janela("2026-10-08", 7, "x", { impressions: 1000 })];
    expect(computeFatigue(anteriorFraca, { fim: "2026-10-08" }).level).toBe("novo");
  });

  it("fadigando = CTR ≤ 75% do anterior E (frequência ≥ 2 OU CPL 7 d ≥ 120%)", () => {
    const anterior = janela("2026-10-01", 7, "x", { impressions: 1000, clicks: 20, reach: 800, spend: 50, leads: 2 });
    // CTR caiu de 2% para 1% com frequência 2,5.
    const freq = [...anterior, ...janela("2026-10-08", 7, "x", { impressions: 1000, clicks: 10, reach: 400, spend: 50, leads: 2 })];
    const f1 = computeFatigue(freq, { fim: "2026-10-08" });
    expect(f1.level).toBe("fadigado");
    expect(f1.reason).toMatch(/CTR 1,0% vs 2,0%/);
    expect(f1.reason).toMatch(/frequência 2,5/);
    expect(f1.frequency).toBeCloseTo(2.5, 6);

    // CTR caiu e o CPL subiu (gasto igual, metade das conversões) com frequência baixa.
    const cpl = [...anterior, ...janela("2026-10-08", 7, "x", { impressions: 1000, clicks: 10, reach: 800, spend: 50, leads: 1 })];
    const f2 = computeFatigue(cpl, { fim: "2026-10-08" });
    expect(f2.level).toBe("fadigado");
    // O CPL da janela é o do Pixel e o motivo diz isso — nunca "CPL 7 d" cru,
    // que o leitor compararia com o "CPL (painel)" da coluna ao lado.
    expect(f2.reason).toMatch(/CPL Meta \(Pixel\) 7 d R\$ 50,00 vs R\$ 25,00/);
    expect(f2.reason.replace(/CPL Meta \(Pixel\) 7 d/g, "")).not.toMatch(/CPL 7 d/);

    // S13: gasto sem NENHUMA conversão na janela recente é CPL sem teto — a regra dispara.
    const zero = [...anterior, ...janela("2026-10-08", 7, "x", { impressions: 1000, clicks: 10, reach: 800, spend: 50, leads: 0 })];
    expect(computeFatigue(zero, { fim: "2026-10-08" }).level).toBe("fadigado");
    expect(computeFatigue(zero, { fim: "2026-10-08" }).reason).toMatch(/sem conversão/);

    // CTR caiu sem confirmação = atenção; CTR estável com frequência alta = atenção; nada = saudável.
    const soCtr = [...anterior, ...janela("2026-10-08", 7, "x", { impressions: 1000, clicks: 10, reach: 800, spend: 50, leads: 2 })];
    expect(computeFatigue(soCtr, { fim: "2026-10-08" }).level).toBe("atencao");
    const soFreq = [...anterior, ...janela("2026-10-08", 7, "x", { impressions: 1000, clicks: 20, reach: 400, spend: 50, leads: 2 })];
    expect(computeFatigue(soFreq, { fim: "2026-10-08" }).level).toBe("atencao");
    const ok = [...anterior, ...janela("2026-10-08", 7, "x", { impressions: 1000, clicks: 20, reach: 800, spend: 50, leads: 2 })];
    const f3 = computeFatigue(ok, { fim: "2026-10-08" });
    expect(f3.level).toBe("saudavel");
    expect(f3.janelas?.recente).toMatchObject({ from: "2026-10-02", to: "2026-10-08", impressions: 7000 });
    expect(f3.janelas?.anterior).toMatchObject({ from: "2026-09-25", to: "2026-10-01", impressions: 7000 });
  });

  it("as janelas terminam no fim do PERÍODO, não no último dia do anúncio", () => {
    const rows = [...janela("2026-09-24", 7, "x", { impressions: 1000, clicks: 20 }), ...janela("2026-10-01", 7, "x", { impressions: 1000, clicks: 10, reach: 400 })];
    // Olhando até 01/10 o anúncio está fadigando; olhando até 08/10 a janela
    // recente está vazia — e isso é "parado" (pausado), não "novo".
    expect(computeFatigue(rows, { fim: "2026-10-01" }).level).toBe("fadigado");
    expect(computeFatigue(rows, { fim: "2026-10-08" }).level).toBe("parado");
    // Sem `fim`, vale a última data das linhas (compatível com o chamador antigo).
    expect(computeFatigue(rows).level).toBe("fadigado");
  });

  it("parado = nenhuma impressão na janela recente com veiculação antes dela, com o motivo e a data; sem histórico continua novo", () => {
    const rows = janela("2026-08-15", 14, "x", { impressions: 1000, clicks: 20 });
    const f = computeFatigue(rows, { fim: "2026-10-08" });
    expect(f.level).toBe("parado");
    expect(f.reason).toBe("sem veiculação nos últimos 7 dias (02/10–08/10); última impressão em 15/08");
    expect(f.janelas?.recente.impressions).toBe(0);
    // Linhas só DEPOIS do fim (período no passado) não são "parado": não há o que julgar.
    expect(computeFatigue(rows, { fim: "2026-08-01" }).level).toBe("novo");
    // Linha sem impressão antes da janela (gasto zero, pausado desde sempre) também não.
    expect(computeFatigue(janela("2026-08-15", 3, "x", { impressions: 0 }), { fim: "2026-10-08" }).level).toBe("novo");
    // "Sem resultado" vem antes: gastou no período e não trouxe lead, parado ou não.
    expect(computeFatigue(rows, { fim: "2026-10-08", semResultado: { gastoPeriodo: 120, leadsPainel: 0, cplAlvo: 50 } }).level).toBe("sem-resultado");
  });

  it("sem resultado = gasto ≥ 2 × CPL alvo com 0 leads do painel (só com alvo)", () => {
    const rows = janela("2026-10-08", 3, "x", { spend: 40 }); // R$ 120, sem janela para fadiga
    expect(computeFatigue(rows, { fim: "2026-10-08", semResultado: { gastoPeriodo: 120, leadsPainel: 0, cplAlvo: 50 } })).toMatchObject({
      level: "sem-resultado",
      reason: "R$ 120,00 gastos no período sem nenhum lead do painel (≥ 2 × o CPL alvo de R$ 50,00)",
    });
    expect(computeFatigue(rows, { fim: "2026-10-08", semResultado: { gastoPeriodo: 99, leadsPainel: 0, cplAlvo: 50 } }).level).toBe("novo");
    expect(computeFatigue(rows, { fim: "2026-10-08", semResultado: { gastoPeriodo: 120, leadsPainel: 1, cplAlvo: 50 } }).level).toBe("novo");
    expect(computeFatigue(rows, { fim: "2026-10-08", semResultado: { gastoPeriodo: 120, leadsPainel: 0, cplAlvo: null } }).level).toBe("novo");
    expect(REGRA_FADIGA.multiploSemResultado).toBe(2);
  });
});

// ---------------------------------------------------------------- criativos agregados

describe("criativos agregados por creativeId", () => {
  it("o mesmo criativo em dois conjuntos vira uma linha com o detalhe por anúncio; nome ambíguo não entra", () => {
    const data = cenario();
    // O criativo cr-1 roda também no Lookalike, com outro anúncio de mesmo nome.
    data.creatives.push(criativo("100003", "Anúncio A", { creativeId: "cr-1" }));
    data.adDaily.push(...dias("2026-10-08", 5, "100003", { adset: "Lookalike", adsetId: "801", spend: 10, impressions: 500, clicks: 5 }));
    data.leads.push(lead("2026-10-04", { utmContent: "Anúncio A" })); // ambíguo: "Anúncio A" existe em 2 anúncios
    const kp = kpisDe(data);
    const alvo = cplAlvoDaMidia(data, kp, HOJE);
    const bloco = criativosAgregados(data, PERIODO, { fim: PERIODO.to, cplAlvo: alvo.alvo, custoPorReuniaoExibivel: custoExibivel(kp.custoPorReuniao) });
    expect(bloco.descoberta).toHaveLength(0);
    expect(bloco.conversao.map((c) => c.chave)).toEqual(["cr-1", "cr-2"]);
    const cr1 = bloco.conversao[0];
    expect(cr1.anuncios).toBe(2);
    expect(cr1.anunciosDetalhe?.map((a) => a.conjunto)).toEqual(["Interesses 25-45", "Lookalike"]);
    expect(cr1.spend).toBeCloseTo(14 * 60 + 5 * 10, 6);
    expect(cr1.leadsPainel).toBe(12);
    expect(cr1.agendadas).toBe(3);
    expect(cr1.ambiguos).toBe(1);
    expect(cr1.cplPainel).toBeCloseTo(cr1.spend / 12, 6);
    // A reunião do lead ambíguo não foi para ninguém.
    expect(bloco.conversao.reduce((s, c) => s + c.leadsPainel, 0)).toBe(16);
    // Sem creativeId cai no adId.
    const cr2 = bloco.conversao[1];
    expect(cr2.anuncios).toBe(1);
    expect(cr2.agendadas).toBe(0);
    expect(cr2.custoPorAgendada).toBeNull();
    // A regra em palavras cita o alvo e a origem dele.
    expect(alvo.origem).toBe("periodo");
    expect(textoRegraSaude(alvo)).toMatch(/CPL do período, sem meta cadastrada/);
    expect(textoRegraSaude(alvo)).toMatch(/≤ 75%/);
  });

  it("sem resultado só para conversão; descoberta é julgada sem leads", () => {
    const data = base({
      metas: [meta("cpl", 30)],
      creatives: [criativo("200001", "Sem lead", { creativeId: "cr-x" }), criativo("300001", "Reel", { creativeId: "cr-d", format: "video" })],
      adDaily: [
        ...dias("2026-10-08", 3, "200001", { spend: 25, leads: 0 }), // R$ 75 ≥ 2 × 30, 0 leads do painel
        ...dias("2026-10-08", 3, "300001", { objective: "OUTCOME_ENGAGEMENT", adset: "Descoberta", adsetId: "850", spend: 100, leads: 0 }),
      ],
    });
    const kp = kpisDe(data);
    const alvo = cplAlvoDaMidia(data, kp, HOJE);
    expect(alvo).toEqual({ alvo: 30, origem: "meta" });
    const bloco = criativosAgregados(data, PERIODO, { fim: PERIODO.to, cplAlvo: alvo.alvo });
    expect(bloco.conversao[0].saude.level).toBe("sem-resultado");
    expect(bloco.descoberta[0].saude.level).toBe("novo"); // gastou R$ 300 sem lead e NÃO é "sem resultado"
  });

  it("rankings só com volume mínimo (≥ 10 leads ou ≥ R$ 100), com o n visível", () => {
    const data = cenario();
    const bloco = criativosAgregados(data, PERIODO, { fim: PERIODO.to, cplAlvo: null });
    const r = rankingsDeCriativos(bloco.conversao);
    expect(r.melhorCpl?.chave).toBe("cr-1");
    expect(r.maiorCtr?.chave).toBe("cr-1");
    expect(r.descartados).toBe(0);
    // Um criativo com 1 lead a R$ 10 não vence só por ter CPL menor.
    data.creatives.push(criativo("100009", "Barato", { creativeId: "cr-9" }));
    data.adDaily.push(ad("2026-10-07", "100009", { spend: 10, impressions: 50, clicks: 25 }));
    data.leads.push(lead("2026-10-07", { adId: "100009" }));
    const r2 = rankingsDeCriativos(criativosAgregados(data, PERIODO, { fim: PERIODO.to, cplAlvo: null }).conversao);
    expect(r2.melhorCpl?.chave).toBe("cr-1");
    expect(r2.maiorCtr?.chave).toBe("cr-1");
    expect(r2.descartados).toBe(1);
  });
});

// ---------------------------------------------------------------- dataset de exemplo (fumaça)

describe("a página inteira sobre o dataset de exemplo", () => {
  it("roda sem estourar e nenhuma linha passa dos totais de kpisDoPeriodo", () => {
    const tudo = buildSeedData();
    const data: DashboardData = {
      ...tudo,
      adDaily: tudo.adDaily.filter((r) => r.brand === "consorcio"),
      creatives: tudo.creatives.filter((r) => r.brand === "consorcio"),
      leads: tudo.leads.filter((r) => r.brand === "consorcio"),
      igAccountDaily: tudo.igAccountDaily.filter((r) => r.brand === "consorcio"),
      metas: (tudo.metas ?? []).filter((m) => m.brand === "consorcio"),
    };
    const hoje = "2026-07-23";
    const cobertura = [{ from: "2026-07-01", to: hoje }];
    for (const range of [undefined, { from: "2026-07-17", to: hoje }]) {
      const kp = kpisDoPeriodo(data, range, { hoje, cobertura });
      const regua = reguaDoPeriodo(kp, data, range, hoje);
      const resumo = resumoDaMidia(kp, regua);
      expect(resumo.cpl.medida.valor).toBe(kp.cpl.valor);
      const exibivel = custoExibivel(kp.custoPorReuniao);
      const conjuntos = conjuntosPorId(data, range, { custoPorReuniaoExibivel: exibivel });
      const linhas = [...conjuntos.conversao, ...conjuntos.descoberta];
      expect(linhas.length).toBeGreaterThan(0);
      expect(linhas.reduce((s, c) => s + c.leadsPainel, 0)).toBeLessThanOrEqual(kp.leads.valor);
      expect(linhas.reduce((s, c) => s + c.agendadas, 0)).toBeLessThanOrEqual(kp.reunioesAgendadas.valor);
      expect(Math.abs(linhas.reduce((s, c) => s + c.spend, 0) - kp.investimento.valor)).toBeLessThan(0.01);
      for (const c of linhas.flatMap((l) => [l, ...(l.conjuntos ?? [])])) {
        if (c.custoPorAgendada != null) expect(c.agendadas).toBeGreaterThanOrEqual(MIN_REUNIOES);
        if (c.leadsPainel === 0) expect(c.cplPainel).toBeNull();
      }
      const alvo = cplAlvoDaMidia(data, kp, hoje);
      const cri = criativosAgregados(data, range, { fim: range?.to, cplAlvo: alvo.alvo, custoPorReuniaoExibivel: exibivel });
      const todos = [...cri.conversao, ...cri.descoberta];
      expect(todos.length).toBeGreaterThan(0);
      expect(todos.reduce((s, c) => s + c.leadsPainel, 0)).toBeLessThanOrEqual(kp.leads.valor);
      for (const c of todos) {
        expect(c.saude.reason.length).toBeGreaterThan(0);
        if (c.bucket === "descoberta") expect(c.saude.level).not.toBe("sem-resultado");
      }
      const r = rankingsDeCriativos(cri.conversao);
      if (r.melhorCpl) expect(r.melhorCpl.leadsPainel >= 10 || r.melhorCpl.spend >= 100).toBe(true);
      expect(tendenciaSemanalMidia(data, { fim: range?.to ?? hoje, hoje, kpis: { cobertura } })).toHaveLength(12);
      expect(textoRegraSaude(alvo)).toMatch(/Fadigando/);
    }
  });
});

// ---------------------------------------------------------------- revisão da Fase 6 (6.3)

const rodarMotor = (data: DashboardData) =>
  motorDeAcoes({ data, range: PERIODO, kpis: kpisDe(data), eventos: [], agora: AGORA, hoje: HOJE, cobertura: COBERTURA });

/** Reunião agendada no período (pela data do agendamento). */
const agendou = { status: "agendado" as const, bookedAt: "2026-10-05T12:00:00.000Z", meetingFor: "2026-10-12T12:00:00.000Z" };

/** Conjuntos (por id) e criativos da mesma tela, para comparar o mesmo fato. */
function asDuasTabelas(data: DashboardData) {
  const conjuntos = conjuntosPorId(data, PERIODO, { custoPorReuniaoExibivel: true }).conversao.flatMap((c) => c.conjuntos ?? []);
  const criativos = criativosAgregados(data, PERIODO, { fim: PERIODO.to, cplAlvo: null, custoPorReuniaoExibivel: true }).conversao;
  return { conjuntos, criativos };
}

describe("uma regra só para atribuir REUNIÃO: só com id (conjuntos, criativos e motor)", () => {
  it("reunião de lead que chegou só com o NOME único do anúncio não entra no conjunto nem no criativo; o lead entra nos dois", () => {
    const data = cenario();
    // Três leads antigos (antes do {{ad.id}} no link): só o nome "Anúncio B", que é único.
    for (let i = 0; i < 3; i++) data.leads.push(lead("2026-10-03", { utmContent: "Anúncio B", ...agendou }));
    const { conjuntos, criativos } = asDuasTabelas(data);
    const lookalike = conjuntos.find((c) => c.adsetId === "801")!;
    const cr2 = criativos.find((c) => c.chave === "cr-2")!;
    // O lead vale por nome único — nas duas tabelas.
    expect(lookalike.leadsPainel).toBe(7);
    expect(cr2.leadsPainel).toBe(7);
    // A reunião NÃO: "3 e R$ 233" no conjunto contra "0 e —" no criativo era o furo.
    expect(lookalike.agendadas).toBe(0);
    expect(lookalike.custoPorAgendada).toBeNull();
    expect(cr2.agendadas).toBe(0);
    expect(cr2.custoPorAgendada).toBeNull();
    // creativePerformance (o que o motor lê) e adsetPerformance seguem a mesma regra.
    const perf = creativePerformance(data, PERIODO).find((c) => c.adId === "100002")!;
    expect(perf.leadsPainel).toBe(7);
    expect(perf.meetings).toBe(0);
    expect(adsetPerformance(data, PERIODO).find((a) => a.adset === "Lookalike")!.meetings).toBe(0);

    // Com o id do anúncio, a reunião entra — e é o mesmo número nas duas tabelas.
    data.leads.push(lead("2026-10-03", { adId: "100002", ...agendou }));
    const depois = asDuasTabelas(data);
    expect(depois.conjuntos.find((c) => c.adsetId === "801")!.agendadas).toBe(1);
    expect(depois.criativos.find((c) => c.chave === "cr-2")!.agendadas).toBe(1);
    expect(creativePerformance(data, PERIODO).find((c) => c.adId === "100002")!.meetings).toBe(1);
    // Cada criativo roda num conjunto só: a soma das agendadas bate.
    expect(depois.conjuntos.reduce((s, c) => s + c.agendadas, 0)).toBe(depois.criativos.reduce((s, c) => s + c.agendadas, 0));
  });

  it("M6 só escala com 3 reuniões POR ID — a reunião por nome não completa a amostra que a tabela não mostra", () => {
    const data = cenario();
    const m6 = rodarMotor(data).find((a) => a.regra === "M6");
    expect(m6).toMatchObject({ id: "M6:100001" });
    expect(m6!.detalhe).toMatch(/^3 reuniões/);

    // Uma das três reuniões chega só com o nome (único) do anúncio A.
    const porNome = cenario();
    const idx = porNome.leads.findIndex((l) => l.status === "agendado");
    porNome.leads[idx] = { ...porNome.leads[idx], adId: undefined, adsetId: undefined, campaignId: undefined, utmContent: "Anúncio A" };
    const kp = kpisDe(porNome);
    // A conta continua com 3 reuniões e custo exibível: quem cala o M6 é a regra da linha.
    expect(kp.reunioesConversao.valor).toBe(3);
    expect(custoExibivel(kp.custoPorReuniao)).toBe(true);
    expect(creativePerformance(porNome, PERIODO).find((c) => c.adId === "100001")!.meetings).toBe(2);
    const { conjuntos, criativos } = asDuasTabelas(porNome);
    expect(criativos.find((c) => c.chave === "cr-1")!.agendadas).toBe(2);
    expect(conjuntos.find((c) => c.adsetId === "800")!.agendadas).toBe(2);
    expect(rodarMotor(porNome).find((a) => a.regra === "M6")).toBeUndefined();
  });
});

describe("motor M2/M4 leem as linhas de /midia#conjuntos (por id, S20)", () => {
  /** "Interesses" em duas campanhas: 801 (R$ 300) e 802 (R$ 900). */
  const homonimos = (leads: Lead[], metas: Meta[] = []) =>
    base({
      creatives: [criativo("100001", "Anúncio A"), criativo("100002", "Anúncio B")],
      adDaily: [
        ad("2026-10-05", "100001", { campaign: "Campanha 1", campaignId: "901", adset: "Interesses", adsetId: "801", spend: 300 }),
        ad("2026-10-05", "100002", { campaign: "Campanha 2", campaignId: "902", adset: "Interesses", adsetId: "802", spend: 900 }),
      ],
      leads,
      metas,
    });

  it("M2 cita a linha mais cara da tabela, com o número que ela imprime — nunca a soma dos homônimos", () => {
    const leads = [
      ...Array.from({ length: 3 }, () => lead("2026-10-05", { adId: "100001", adsetId: "801", campaignId: "901", ...agendou })),
      lead("2026-10-05", { adId: "100002", adsetId: "802", campaignId: "902", ...agendou }),
    ];
    const data = homonimos(leads, [meta("custo_por_reuniao", 168)]);
    const m2 = rodarMotor(data).find((a) => a.regra === "M2")!;
    expect(m2).toBeDefined();
    // A linha que /midia#conjuntos mostra para a Campanha 1.
    const linha = conjuntosPorId(data, PERIODO).conversao.flatMap((c) => c.conjuntos ?? []).find((c) => c.adsetId === "801")!;
    expect(linha.custoPorAgendada).toBeCloseTo(100, 6);
    expect(m2.id).toBe(`M2:${linha.chave}`);
    expect(m2.detalhe).toContain(`“${rotuloConjunto(linha)}” (${formatCurrency(100)} por reunião, 3 reuniões)`);
    expect(m2.detalhe).toContain("Campanha 1 › Interesses");
    // Agrupado por NOME seria "Interesses" a R$ 300 com 4 reuniões — número que a tela não tem.
    expect(m2.detalhe).not.toContain(`${formatCurrency(300)} por reunião`);
    expect(m2.detalhe).not.toMatch(/4 reuniões\)/);
    expect(m2.href).toBe("/midia#conjuntos");
  });

  it("M4 calcula a taxa de contato inválido por linha de conjunto: 40% numa, 0% na homônima (a união daria 20% e calaria)", () => {
    const encerrado = { status: "sem_interesse" as const, lostAt: "2026-10-05T18:00:00.000Z" };
    const leads = [
      ...Array.from({ length: 10 }, (_, i) =>
        lead("2026-10-05", {
          adId: "100001",
          adsetId: "801",
          ...(i < 4 ? { status: "contato_invalido" as const, lostAt: "2026-10-05T18:00:00.000Z" } : encerrado),
        }),
      ),
      ...Array.from({ length: 10 }, () => lead("2026-10-05", { adId: "100002", adsetId: "802", ...encerrado })),
    ];
    const data = homonimos(leads);
    const m4 = rodarMotor(data).filter((a) => a.regra === "M4");
    expect(m4).toHaveLength(1);
    const linha = conjuntosPorId(data, PERIODO).conversao.flatMap((c) => c.conjuntos ?? []).find((c) => c.adsetId === "801")!;
    expect(linha.pctContatoInvalido).toBeCloseTo(0.4, 6);
    expect(m4[0].id).toBe(`M4:${linha.chave}`);
    expect(m4[0].titulo).toMatch(/Conjunto “Campanha 1 › Interesses”: 40% de contatos inválidos/);
    expect(m4[0].amostra).toEqual({ n: 10, minimo: 10 });
  });
});

describe("a regra da Saúde no ⓘ do cabeçalho; o selo com o motivo", () => {
  /** O que o React escreve num atributo. */
  const attr = (t: string) => t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cabecalhos = (html: string) => html.match(/<th\b[^>]*>[\s\S]*?<\/th>/g) ?? [];

  it("tituloDoCabecalho: Saúde = a régua; coluna com verbete = o dicionário; as demais, nada", () => {
    const regra = textoRegraSaude({ alvo: 30, origem: "meta" });
    const col = (key: string) => COLUNAS_CRIATIVOS_CONVERSAO.find((c) => c.key === key)!;
    expect(tituloDoCabecalho(col("saude"), regra)).toBe(regra);
    expect(tituloDoCabecalho(COLUNAS_CRIATIVOS_DESCOBERTA.find((c) => c.key === "saude")!, regra)).toBe(regra);
    expect(tituloDoCabecalho(col("leadsPainel"), regra)).toBe(dica("leads"));
    expect(tituloDoCabecalho(col("nome"), regra)).toBeUndefined();
  });

  it("a tabela de criativos põe a régua no <th> “Saúde” (uma vez) e o motivo no selo", () => {
    const data = cenario();
    const bloco = criativosAgregados(data, PERIODO, { fim: PERIODO.to, cplAlvo: 30 });
    const regra = textoRegraSaude({ alvo: 30, origem: "meta" });
    const html = renderToStaticMarkup(createElement(CreativesTable, { linhas: bloco.conversao, bucket: "conversao", regraSaude: regra }));
    const saude = cabecalhos(html).find((th) => th.includes("Saúde"));
    expect(saude).toContain(`title="${attr(regra)}"`);
    // A régua aparece SÓ no cabeçalho (nenhum span por fora do selo a engolir).
    expect(html.split(attr(regra)).length - 1).toBe(1);
    // O selo de cada linha carrega o motivo dela.
    for (const c of bloco.conversao) expect(html).toContain(`title="${attr(c.saude.reason)}"`);
    // Cabeçalho com verbete do dicionário também ganha o ⓘ.
    expect(cabecalhos(html).find((th) => th.includes("Leads (painel)"))).toContain(`title="${attr(dica("leads"))}"`);
  });

  it("a tabela de conjuntos põe o verbete do dicionário no <th>, não na célula", () => {
    const html = renderToStaticMarkup(createElement(ConjuntosTable, { linhas: conjuntosPorId(cenario(), PERIODO).conversao, bucket: "conversao" }));
    const leads = cabecalhos(html).find((th) => th.includes("Leads (painel)"));
    expect(leads).toContain(`title="${attr(dica("leads"))}"`);
    expect(html.split(`title="${attr(dica("leads"))}"`).length - 1).toBe(1);
  });
});

describe("CPL da regra de fadiga = CPL Meta (Pixel) 7 d, com o rótulo", () => {
  it("a dica diz que o CPL da janela é do Pixel, e nunca imprime “CPL 7 d” sem o rótulo", () => {
    const regra = textoRegraSaude({ alvo: 30, origem: "meta" });
    expect(regra).toContain("CPL Meta (Pixel) 7 d ≥ 120% do anterior");
    expect(regra).toMatch(/gasto ÷ conversões do Pixel na janela — não é o CPL \(painel\)/);
    expect(regra.replace(/CPL Meta \(Pixel\) 7 d/g, "")).not.toMatch(/CPL 7 d/);
    // "Sem resultado" continua com leads do PAINEL, e diz isso.
    expect(regra).toMatch(/0 leads do painel/);
  });
});

describe("criativos homônimos: o rótulo diz QUAL (faixa, rankings e coluna Nome)", () => {
  /** CTR 2% → 1% com frequência 2,5: fadigando. */
  const fadigando = (adId: string, extra: Partial<AdDaily>) => [
    ...dias("2026-10-01", 7, adId, { clicks: 20, ...extra }),
    ...dias("2026-10-08", 7, adId, { clicks: 10, reach: 400, ...extra }),
  ];

  it("dois “Carrossel -” com criativos diferentes saem com o conjunto no nome, na faixa e no ranking", () => {
    const data = base({
      creatives: [criativo("100011", "Carrossel -", { creativeId: "880001" }), criativo("100012", "Carrossel -", { creativeId: "880002" })],
      adDaily: [...fadigando("100011", {}), ...fadigando("100012", { adset: "Lookalike", adsetId: "801" })],
      leads: [lead("2026-10-03", { adId: "100011" }), lead("2026-10-03", { adId: "100011" }), lead("2026-10-03", { adId: "100012" })],
    });
    const bloco = criativosAgregados(data, PERIODO, { fim: PERIODO.to, cplAlvo: null });
    const nomes = bloco.conversao.map((c) => c.nome).sort();
    expect(nomes).toEqual(["Carrossel - · Interesses 25-45", "Carrossel - · Lookalike"]);
    const faixa = faixaDeSaude(bloco);
    expect(faixa.fadigando?.rotulo).toBe("2 criativos fadigando:");
    expect(faixa.fadigando?.texto).toContain("Carrossel - · Interesses 25-45");
    expect(faixa.fadigando?.texto).toContain("Carrossel - · Lookalike");
    expect(faixa.fadigando?.texto).not.toContain("Carrossel -, Carrossel -");
    const r = rankingsDeCriativos(bloco.conversao);
    expect(r.melhorCpl?.nome).toBe("Carrossel - · Interesses 25-45");
    expect(r.maiorCtr?.nome).toMatch(/^Carrossel - · /);
    // A coluna Nome imprime o mesmo rótulo.
    const html = renderToStaticMarkup(createElement(CreativesTable, { linhas: bloco.conversao, bucket: "conversao", regraSaude: "regra" }));
    expect(html).toContain(">Carrossel - · Interesses 25-45<");
    expect(html).toContain(">Carrossel - · Lookalike<");
  });

  it("homônimos que rodam nos MESMOS conjuntos ganham o fim do creativeId; nome sem homônimo fica como está", () => {
    const data = base({
      creatives: [
        criativo("100011", "Carrossel -", { creativeId: "880001" }),
        criativo("100013", "Carrossel -", { creativeId: "880001" }),
        criativo("100012", "Carrossel -", { creativeId: "880002" }),
        criativo("100014", "Carrossel -", { creativeId: "880002" }),
        criativo("100015", "Reel único", { creativeId: "880003" }),
      ],
      adDaily: [
        ...dias("2026-10-08", 3, "100011"),
        ...dias("2026-10-08", 3, "100013", { adset: "Lookalike", adsetId: "801" }),
        ...dias("2026-10-08", 3, "100012", { spend: 40 }),
        ...dias("2026-10-08", 3, "100014", { adset: "Lookalike", adsetId: "801", spend: 40 }),
        ...dias("2026-10-08", 3, "100015", { spend: 10 }),
      ],
    });
    const nomes = criativosAgregados(data, PERIODO, { fim: PERIODO.to, cplAlvo: null }).conversao.map((c) => c.nome);
    expect(nomes).toEqual([
      "Carrossel - · Interesses 25-45, Lookalike · 0001",
      "Carrossel - · Interesses 25-45, Lookalike · 0002",
      "Reel único",
    ]);
  });
});

describe("saúde na vista padrão (sem ?range=): as janelas terminam no fim do período, e pausado é “Parado”", () => {
  it("com fim = hoje, o anúncio pausado há dois meses sai Parado (e fora da faixa), não julgado pelos últimos dias dele", () => {
    const data = cenario();
    // O anúncio B parou em agosto — e os últimos 14 dias DELE parecem fadiga.
    data.adDaily = [
      ...data.adDaily.filter((r) => r.adId !== "100002"),
      ...dias("2026-08-07", 7, "100002", { adset: "Lookalike", adsetId: "801", clicks: 20 }),
      ...dias("2026-08-14", 7, "100002", { adset: "Lookalike", adsetId: "801", clicks: 10, reach: 400 }),
    ];
    // Sem `fim` (o que a página passava com range = undefined): julgado pelos próprios dias.
    const semFim = criativosAgregados(data, undefined, { cplAlvo: null });
    expect(semFim.conversao.find((c) => c.chave === "cr-2")!.saude.level).toBe("fadigado");
    expect(faixaDeSaude(semFim).fadigando?.texto).toContain("Anúncio B");

    // Com o fim do período (hoje, na vista padrão): parado, com o motivo e a data.
    const comFim = criativosAgregados(data, undefined, { fim: HOJE, cplAlvo: null });
    const b = comFim.conversao.find((c) => c.chave === "cr-2")!;
    expect(b.saude.level).toBe("parado");
    expect(b.saude.reason).toBe("sem veiculação nos últimos 7 dias (02/10–08/10); última impressão em 14/08");
    expect(faixaDeSaude(comFim).fadigando).toBeNull();
    // O ativo continua julgado pela regra (frequência 2,5 com CTR estável = atenção).
    const a = comFim.conversao.find((c) => c.chave === "cr-1")!;
    expect(a.saude.level).toBe("atencao");
    expect(a.saude.reason).toMatch(/com CTR estável/);
    // O selo diz "Parado (sem veiculação)", não "Novo (amostra insuficiente)".
    const html = renderToStaticMarkup(createElement(CreativesTable, { linhas: comFim.conversao, bucket: "conversao", regraSaude: "regra" }));
    expect(html).toContain("Parado");
    expect(html).toContain("(sem veiculação)");
    expect(textoRegraSaude({ alvo: null, origem: null })).toMatch(/Parado = nenhuma impressão nos últimos 7 dias do período/);
  });
});
