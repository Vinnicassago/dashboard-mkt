/**
 * Fase 6.3 — Mídia (relatório §7.3; S13, S20, B9, B12, B13, B17). Fixture
 * sintética (nenhum dado real). Datas em UTC; Brasília = UTC−3.
 *
 * Fase 4 (nov/26): saíram os rankings, a faixa de saúde, o Gancho, a Retenção e o
 * "sem resultado" da fadiga; a coluna Saúde (conversão) virou Sinal — a MESMA régua do
 * cartão e do motor (`criativosComSinal`); quem não está no ar não tem sinal.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { adsetPerformance, computeFatigue, creativePerformance } from "../metrics";
import { custoExibivel, fatoDoCustoPorReuniao, kpisDoPeriodo, mostrar, reguaDoPeriodo } from "../kpis";
import {
  COLUNAS_CONJUNTOS_CONVERSAO,
  COLUNAS_CONJUNTOS_DESCOBERTA,
  COLUNAS_CRIATIVOS_CONVERSAO,
  COLUNAS_CRIATIVOS_DESCOBERTA,
  TODAS_AS_COLUNAS,
  conjuntosPorId,
  criativosAgregados,
  criativosComSinal,
  foraDasLinhasDeConversao,
  midiaParaIA,
  montarMidiaDaTela,
  REGRA_ATRIBUICAO_REUNIAO,
  resumoDaMidia,
  rotuloConjunto,
  tendenciaSemanalMidia,
  textoDaReguaDaFadiga,
  textoDosForaDasLinhas,
  tituloDoCabecalho,
} from "../midia";
import type { EntradaDosSinais } from "../midia-tela";
import { textoDaReguaDoSinal } from "../sinal-do-criativo";
import { motorDeAcoes } from "../motor";
import { buildBriefing } from "../ai/briefing";
import { dica } from "../dicionario";
import { formatCurrency } from "../format";
import { LIVE_PADRAO } from "../live";
import { MIN_REUNIOES } from "../trust";
import { CreativesTable } from "@/components/tables/creatives-table";
import { ConjuntosTable } from "@/components/midia/conjuntos-table";
import { buildSeedData } from "../data/seed";
import type { AdDaily, Creative, DashboardData, Lead, Meta } from "../types";

// O ⓘ só existe aberto no navegador: aqui ele deixa o texto e o rótulo no HTML, para o
// teste ver QUAL explicação mora em cada célula (K40) e em cada cabeçalho.
vi.mock("@/components/ui/info", async () => {
  const { createElement: el } = await import("react");
  return {
    Info: function Info({ texto, rotulo }: { texto?: string; rotulo?: string }) {
      return el("button", { type: "button", "aria-label": rotulo, "data-texto": texto });
    },
  };
});

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

/** Os criativos COM o sinal (a montagem única da tela, do motor e da IA), sem sync registrado: o "no ar" ancora no último dia com linha. */
const sinaisDe = (data: DashboardData, periodo: { from: string; to: string } | "campanha" = PERIODO, o: Partial<EntradaDosSinais> = {}) => {
  // "campanha" = sem ?range= (range undefined): um parâmetro `undefined` cairia no padrão.
  const range = periodo === "campanha" ? undefined : periodo;
  return criativosComSinal({ data, range, kpis: kpisDe(data, range), eventos: [], cobertura: COBERTURA, ultimoSyncAds: null, hoje: HOJE, agora: AGORA, ...o });
};

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
  it("o CPL do resumo é o mesmo kpisDoPeriodo do Início, e o custo por reunião vira fato abaixo da régua", () => {
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
    expect(r1.custoPorReuniao.texto).toMatch(/investidos em conversão · 1 reunião de conversão$/);
    // O MESMO fato do cartão de Reuniões do Início (`fatoDoCustoPorReuniao`), e o n é o denominador.
    expect(r1.custoPorReuniao.texto).toBe(fatoDoCustoPorReuniao(kp1).fato);
    expect(r1.custoPorReuniao.n).toBe(fatoDoCustoPorReuniao(kp1).n);
    expect(resumo.custoPorReuniao.texto).toBe(fatoDoCustoPorReuniao(kp).valor);
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
  it("nenhuma coluna chamada só “Leads”, toda coluna do Pixel diz “Pixel” e toda do robô diz “(robô)”", () => {
    for (const colunas of TODAS_AS_COLUNAS) {
      for (const c of colunas) {
        expect(c.header).not.toBe("Leads");
        if (c.fonte === "pixel") expect(c.header).toMatch(/Pixel/);
        if (/^Leads/.test(c.header)) expect(c.fonte).toBe("painel");
        if (c.fonte === "robo") expect(c.header).toMatch(/\(robô\)$/);
        // Gancho e Retenção saíram (F4-D14): a janela era a do sync, não a do período.
        expect(c.key).not.toMatch(/^(hookRate|holdRate|thruPlayRate)$/);
        expect(c.header).not.toMatch(/Gancho|Retenção/);
      }
    }
    const conv = COLUNAS_CONJUNTOS_CONVERSAO.map((c) => c.header);
    expect(conv).toEqual([
      "Campanha › conjunto",
      "Veiculação",
      "Gasto",
      "Leads (painel)",
      "Conversões Meta (Pixel)",
      "CPL (painel)",
      "Agendadas",
      "Custo por agendada",
      "% contato inválido",
      "Responderam (robô)",
      "Aceitaram (robô)",
      "Sem WhatsApp (robô)",
    ]);
    expect(COLUNAS_CONJUNTOS_CONVERSAO.filter((c) => c.fonte === "robo").map((c) => [c.key, c.dica])).toEqual([
      ["roboResponderam", "responderam"],
      ["roboAceitaram", "convite_aceito"],
      ["roboSemWhatsapp", "sem_whatsapp"],
    ]);
    // B13: as secundárias dos criativos vão para a linha expandida. A Saúde (conversão) virou Sinal.
    const principais = COLUNAS_CRIATIVOS_CONVERSAO.filter((c) => !c.secundaria).map((c) => c.key);
    for (const k of ["nome", "spend", "leadsPainel", "cplPainel", "agendadas", "custoPorAgendada", "sinal", "roboResponderam", "roboAceitaram", "roboSemWhatsapp"]) {
      expect(principais, k).toContain(k);
    }
    expect(principais).not.toContain("saude");
    expect(COLUNAS_CRIATIVOS_CONVERSAO.map((c) => c.key)).toContain("veiculacao");
    expect(COLUNAS_CRIATIVOS_CONVERSAO.find((c) => c.key === "sinal")).toMatchObject({ header: "Sinal", fonte: "misto", dica: "sinal_do_criativo" });
    expect(COLUNAS_CRIATIVOS_CONVERSAO.filter((c) => c.secundaria).map((c) => c.key)).toContain("ctr");
    // A descoberta: Saúde (fadiga) e Veiculação; nunca Sinal.
    expect(COLUNAS_CRIATIVOS_DESCOBERTA.map((c) => c.key)).toEqual(expect.arrayContaining(["saude", "veiculacao"]));
    expect(COLUNAS_CRIATIVOS_DESCOBERTA.map((c) => c.key)).not.toContain("sinal");
    expect(COLUNAS_CONJUNTOS_DESCOBERTA.map((c) => c.key)).toContain("veiculacao");
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
    // recente está vazia — e, com o sync confirmando os dias, isso é "parado"
    // (pausado), não "novo".
    expect(computeFatigue(rows, { fim: "2026-10-01" }).level).toBe("fadigado");
    expect(computeFatigue(rows, { fim: "2026-10-08", cobertura: COBERTURA }).level).toBe("parado");
    // Sem `fim`, vale a última data das linhas (compatível com o chamador antigo).
    expect(computeFatigue(rows).level).toBe("fadigado");
  });

  it("parado = nenhuma impressão na janela recente com veiculação antes dela, com o motivo e a data; sem histórico continua novo", () => {
    const rows = janela("2026-08-15", 14, "x", { impressions: 1000, clicks: 20 });
    const f = computeFatigue(rows, { fim: "2026-10-08", cobertura: COBERTURA });
    expect(f.level).toBe("parado");
    expect(f.reason).toBe("sem veiculação nos últimos 7 dias (02/10–08/10); última impressão em 15/08");
    expect(f.janelas?.recente.impressions).toBe(0);
    // Linhas só DEPOIS do fim (período no passado) não são "parado": não há o que julgar.
    expect(computeFatigue(rows, { fim: "2026-08-01" }).level).toBe("novo");
    // Linha sem impressão antes da janela (gasto zero, pausado desde sempre) também não.
    expect(computeFatigue(janela("2026-08-15", 3, "x", { impressions: 0 }), { fim: "2026-10-08" }).level).toBe("novo");
  });

  it("anúncio que parou no período com gasto e 0 lead não recebe sinal e não é vermelho (F4-D3)", () => {
    // O cenário + C (cr-x): R$ 240 em 25–27/09, nenhum lead, e nada depois — com o sync cobrindo.
    const data = cenario();
    data.creatives.push(criativo("100009", "Parado sem lead", { creativeId: "cr-x" }));
    data.adDaily.push(...dias("2026-09-27", 3, "100009", { spend: 80 }));
    const { bloco } = sinaisDe(data);
    const c = bloco.conversao.find((l) => l.chave === "cr-x")!;
    expect(c.spend).toBe(240);
    expect(c.leadsPainel).toBe(0);
    expect(c.veiculacao.estado).toBe("parou");
    expect(c.veiculacao.rotulo).toBe("Último gasto em 27/09");
    expect(c.sinal).toBeNull();
    // A fadiga não tem mais "sem resultado" (nem a opção antiga).
    expect(c.saude.level).not.toBe("sem-resultado");
    expect(computeFatigue(janela("2026-09-27", 3, "x", { spend: 80 }), { fim: "2026-10-08", cobertura: COBERTURA, semResultado: { gastoPeriodo: 240, leadsPainel: 0, cplAlvo: 50 } } as never).level).not.toBe("sem-resultado");
  });

  it("o Pausar/sem-resultado do sinal: 0 lead com gasto que rendia 3+ leads na média — só no ar", () => {
    // A média dos criativos (no ar e fora): (R$ 840 + R$ 420 + o gasto de C) ÷ 16 leads.
    const comC = (gasto: number, ate = "2026-10-08") => {
      const data = cenario();
      data.creatives.push(criativo("100009", "Sem lead", { creativeId: "cr-x" }));
      data.adDaily.push(...dias(ate, 3, "100009", { spend: gasto / 3 }));
      return sinaisDe(data).bloco.conversao.find((l) => l.chave === "cr-x")!;
    };
    // R$ 300 (média R$ 97,50 → λ 3,1, chance de 0 lead < 5%): Pausar, sem resultado.
    const pausa = comC(300);
    expect(pausa.veiculacao.estado).toBe("no-ar");
    expect(pausa.sinal).toMatchObject({ sinal: "pausar", causa: "sem-resultado", tom: "fora" });
    expect(pausa.sinal!.motivo).toMatch(/^R\$\s300 sem lead; a média renderia 3,1$/);
    // R$ 200 (média R$ 91,25 → λ 2,2): cedo para julgar.
    expect(comC(200).sinal).toMatchObject({ sinal: "cedo", causa: "amostra" });
    // O mesmo gasto, parado: nenhum sinal.
    expect(comC(300, "2026-09-30").sinal).toBeNull();
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
    const bloco = criativosAgregados(data, PERIODO, { fim: PERIODO.to, custoPorReuniaoExibivel: custoExibivel(kp.custoPorReuniao) });
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
    // A régua da fadiga em palavras: sem o "sem resultado" e sem CPL alvo (F4-D3).
    expect(textoDaReguaDaFadiga()).toMatch(/≤ 75%/);
    expect(textoDaReguaDaFadiga()).not.toMatch(/Sem resultado|CPL alvo/);
  });

  it("descoberta nunca recebe sinal (é julgada sem leads); a conversão sem média é 'Cedo', nunca vermelha", () => {
    const data = base({
      metas: [meta("cpl", 30)],
      creatives: [criativo("200001", "Sem lead", { creativeId: "cr-x" }), criativo("300001", "Reel", { creativeId: "cr-d", format: "video" })],
      adDaily: [
        ...dias("2026-10-08", 3, "200001", { spend: 25, leads: 0 }), // R$ 75, 0 leads do painel
        ...dias("2026-10-08", 3, "300001", { objective: "OUTCOME_ENGAGEMENT", adset: "Descoberta", adsetId: "850", spend: 100, leads: 0 }),
      ],
    });
    const { bloco } = sinaisDe(data);
    expect(bloco.descoberta[0].sinal).toBeNull();
    expect(bloco.descoberta[0].saude.level).toBe("novo"); // gastou R$ 300 sem lead e NÃO é "sem resultado"
    // Um criativo de conversão só: sem média para comparar (nunca "Pausar" sem base).
    expect(bloco.conversao[0].sinal).toMatchObject({ sinal: "cedo", causa: "sem-base", motivo: "um criativo só: sem média para comparar" });
    expect(bloco.conversao[0].saude.level).not.toBe("sem-resultado");
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
      const cri = criativosAgregados(data, range, { fim: range?.to, custoPorReuniaoExibivel: exibivel });
      const todos = [...cri.conversao, ...cri.descoberta];
      expect(todos.length).toBeGreaterThan(0);
      expect(todos.reduce((s, c) => s + c.leadsPainel, 0)).toBeLessThanOrEqual(kp.leads.valor);
      for (const c of todos) {
        expect(c.saude.reason.length).toBeGreaterThan(0);
        expect(c.saude.level).not.toBe("sem-resultado");
      }
      // Com o sinal (a montagem da tela): só conversão, só no ar, fora a live.
      const { bloco } = criativosComSinal({ data, range, kpis: kp, eventos: [], cobertura, ultimoSyncAds: null, cfgLive: LIVE_PADRAO, hoje, agora: `${hoje}T18:00:00.000Z` });
      for (const c of bloco.descoberta) expect(c.sinal).toBeNull();
      for (const c of bloco.conversao) expect(c.sinal != null, c.nome).toBe(c.veiculacao.estado === "no-ar" && !c.daLive);
      expect(tendenciaSemanalMidia(data, { fim: range?.to ?? hoje, hoje, kpis: { cobertura } })).toHaveLength(12);
      expect(textoDaReguaDaFadiga()).toMatch(/Fadigando/);
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
  const criativos = criativosAgregados(data, PERIODO, { fim: PERIODO.to, custoPorReuniaoExibivel: true }).conversao;
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
    // O id é a chave do CRIATIVO (`creativeId ?? adId`), não mais o anúncio.
    expect(m6).toMatchObject({ id: "M6:cr-1" });
    expect(m6!.detalhe).toMatch(/^3 reuniões/);
    // A ação tem o MESMO nome e o MESMO motivo do sinal da linha (o cartão da Mídia).
    const linha = sinaisDe(data).bloco.conversao.find((l) => l.chave === "cr-1")!;
    expect(linha.sinal).toMatchObject({ sinal: "escalar", causa: "reunioes" });
    expect(m6!.titulo).toBe(`Escale “${linha.nome}”: ${linha.sinal!.motivo}`);

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

describe("a régua do Sinal (conversão) e da Saúde (descoberta) no cabeçalho; o motivo no ⓘ da célula (K40)", () => {
  /** O que o React escreve num atributo. */
  const attr = (t: string) => t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cabecalhos = (html: string) => html.match(/<th\b[^>]*>[\s\S]*?<\/th>/g) ?? [];
  const REGRAS = { sinal: textoDaReguaDoSinal(), fadiga: textoDaReguaDaFadiga() };

  it("tituloDoCabecalho: Sinal = a régua do sinal; Saúde (descoberta) = a da fadiga; verbete = o dicionário; as demais, nada", () => {
    const col = (key: string) => COLUNAS_CRIATIVOS_CONVERSAO.find((c) => c.key === key)!;
    expect(tituloDoCabecalho(col("sinal"), REGRAS)).toBe(REGRAS.sinal);
    expect(tituloDoCabecalho(COLUNAS_CRIATIVOS_DESCOBERTA.find((c) => c.key === "saude")!, REGRAS)).toBe(REGRAS.fadiga);
    expect(tituloDoCabecalho(col("leadsPainel"), REGRAS)).toBe(dica("leads"));
    expect(tituloDoCabecalho(col("nome"), REGRAS)).toBeUndefined();
    // A régua da fadiga não tem mais o "sem resultado".
    expect(REGRAS.fadiga).not.toMatch(/Sem resultado/);
  });

  it("a tabela de criativos põe a régua do sinal no <th> “Sinal” (uma vez) e o motivo no ⓘ de cada célula", () => {
    const { bloco } = sinaisDe(cenario());
    const html = renderToStaticMarkup(createElement(CreativesTable, { linhas: bloco.conversao, bucket: "conversao", colunasDoRobo: false, regras: REGRAS }));
    const sinal = cabecalhos(html).find((th) => th.includes("Sinal"));
    expect(sinal).toContain(`title="${attr(REGRAS.sinal)}"`);
    // A régua aparece SÓ no cabeçalho.
    expect(html.split(attr(REGRAS.sinal)).length - 1).toBe(1);
    expect(cabecalhos(html).some((th) => th.includes("Saúde"))).toBe(false);
    // Cada linha no ar tem o ⓘ com o motivo e a regra do sinal dela (o `title` não abre no toque).
    for (const c of bloco.conversao) {
      expect(c.sinal, c.nome).not.toBeNull();
      expect(html).toContain(`aria-label="${attr(`Sobre o sinal de ${c.nome}`)}"`);
      expect(html).toContain(`data-texto="${attr(c.sinal!.dica)}"`);
      expect(html).toContain(c.sinal!.rotulo);
    }
    // Cabeçalho com verbete do dicionário também ganha o ⓘ.
    expect(cabecalhos(html).find((th) => th.includes("Leads (painel)"))).toContain(`title="${attr(dica("leads"))}"`);
  });

  it("a tabela de criativos de descoberta põe a régua da fadiga no <th> “Saúde”, sem 'Sem resultado'", () => {
    const data = base({
      creatives: [criativo("300001", "Reel", { creativeId: "cr-d", format: "video" })],
      adDaily: dias("2026-10-08", 14, "300001", { objective: "OUTCOME_ENGAGEMENT", adset: "Descoberta", adsetId: "850" }),
    });
    const { bloco } = sinaisDe(data);
    const html = renderToStaticMarkup(createElement(CreativesTable, { linhas: bloco.descoberta, bucket: "descoberta", colunasDoRobo: false, regras: REGRAS }));
    const saude = cabecalhos(html).find((th) => th.includes("Saúde"));
    expect(saude).toContain(`title="${attr(REGRAS.fadiga)}"`);
    expect(html).not.toContain("Sem resultado");
    expect(cabecalhos(html).some((th) => th.includes("Sinal"))).toBe(false);
  });

  it("a tabela de conjuntos põe o verbete do dicionário no <th>, não na célula", () => {
    const html = renderToStaticMarkup(createElement(ConjuntosTable, { linhas: conjuntosPorId(cenario(), PERIODO).conversao, bucket: "conversao", colunasDoRobo: false }));
    const leads = cabecalhos(html).find((th) => th.includes("Leads (painel)"));
    expect(leads).toContain(`title="${attr(dica("leads"))}"`);
    expect(html.split(`title="${attr(dica("leads"))}"`).length - 1).toBe(1);
  });
});

describe("CPL da regra de fadiga = CPL Meta (Pixel) 7 d, com o rótulo", () => {
  it("a dica diz que o CPL da janela é do Pixel, e nunca imprime “CPL 7 d” sem o rótulo", () => {
    const regra = textoDaReguaDaFadiga();
    expect(regra).toContain("CPL Meta (Pixel) 7 d ≥ 120% do anterior");
    expect(regra).toMatch(/gasto ÷ conversões do Pixel na janela — não é o CPL \(painel\)/);
    expect(regra.replace(/CPL Meta \(Pixel\) 7 d/g, "")).not.toMatch(/CPL 7 d/);
    // O "sem resultado" saiu da fadiga (é o Pausar do sinal, só no ar) e o CPL alvo junto.
    expect(regra).not.toMatch(/Sem resultado|CPL alvo/);
  });
});

describe("criativos homônimos: o rótulo diz QUAL (o sinal, o motor e a coluna Nome)", () => {
  /** CTR 2% → 1% com frequência 2,5: fadigando. */
  const fadigando = (adId: string, extra: Partial<AdDaily>) => [
    ...dias("2026-10-01", 7, adId, { clicks: 20, ...extra }),
    ...dias("2026-10-08", 7, adId, { clicks: 10, reach: 400, ...extra }),
  ];

  it("dois “Carrossel -” com criativos diferentes saem com o conjunto no nome — na linha, no ⓘ do sinal e na ação do motor", () => {
    const data = base({
      creatives: [criativo("100011", "Carrossel -", { creativeId: "880001" }), criativo("100012", "Carrossel -", { creativeId: "880002" })],
      adDaily: [...fadigando("100011", {}), ...fadigando("100012", { adset: "Lookalike", adsetId: "801" })],
      leads: [lead("2026-10-03", { adId: "100011" }), lead("2026-10-03", { adId: "100011" }), lead("2026-10-03", { adId: "100012" })],
    });
    const bloco = criativosAgregados(data, PERIODO, { fim: PERIODO.to });
    const nomes = bloco.conversao.map((c) => c.nome).sort();
    expect(nomes).toEqual(["Carrossel - · Interesses 25-45", "Carrossel - · Lookalike"]);
    // Os dois fadigando: Trocar arte, e cada ação do motor cita o rótulo desambiguado.
    const comSinal = sinaisDe(data).bloco.conversao;
    for (const c of comSinal) expect(c.sinal, c.nome).toMatchObject({ sinal: "trocar-arte", causa: "fadiga" });
    const m3 = rodarMotor(data).filter((a) => a.regra === "M3");
    expect(m3.map((a) => a.id).sort()).toEqual(["M3:880001", "M3:880002"]);
    for (const a of m3) {
      const linha = comSinal.find((c) => `M3:${c.chave}` === a.id)!;
      expect(a.titulo).toBe(`Renove a arte de “${linha.nome}”: ${linha.sinal!.motivo}`);
    }
    expect(m3.map((a) => a.titulo).join(" ")).not.toContain("“Carrossel -”");
    // A coluna Nome imprime o mesmo rótulo.
    const html = renderToStaticMarkup(createElement(CreativesTable, { linhas: comSinal, bucket: "conversao", colunasDoRobo: false, regras: { sinal: "regra", fadiga: "regra" } }));
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
    const nomes = criativosAgregados(data, PERIODO, { fim: PERIODO.to }).conversao.map((c) => c.nome);
    expect(nomes).toEqual([
      "Carrossel - · Interesses 25-45, Lookalike · 0001",
      "Carrossel - · Interesses 25-45, Lookalike · 0002",
      "Reel único",
    ]);
  });
});

describe("saúde na vista padrão (sem ?range=): as janelas terminam no fim do período, e pausado é “Parado”", () => {
  it("com fim = hoje, o anúncio pausado há dois meses sai Parado (e sem sinal), não julgado pelos últimos dias dele", () => {
    const data = cenario();
    // O anúncio B parou em agosto — e os últimos 14 dias DELE parecem fadiga.
    data.adDaily = [
      ...data.adDaily.filter((r) => r.adId !== "100002"),
      ...dias("2026-08-07", 7, "100002", { adset: "Lookalike", adsetId: "801", clicks: 20 }),
      ...dias("2026-08-14", 7, "100002", { adset: "Lookalike", adsetId: "801", clicks: 10, reach: 400 }),
    ];
    // Julgado pelos próprios últimos dias (o que a página fazia com range =
    // undefined e sem `fim`), o anúncio pausado "fadigava".
    const doAnuncio = data.adDaily.filter((r) => r.adId === "100002");
    expect(computeFatigue(doAnuncio).level).toBe("fadigado");
    // Sem `fim`, criativosAgregados usa o último dia da CONTA (não o do anúncio);
    // sem cobertura do sync, a janela vazia é "Sem dados" — nunca "Fadigando".
    const semFim = criativosAgregados(data, undefined, {});
    expect(semFim.conversao.find((c) => c.chave === "cr-2")!.saude.level).toBe("sem-dados");
    expect(semFim.conversao.find((c) => c.chave === "cr-2")!.saude.level).not.toBe("fadigado");

    // Com o fim do período (hoje, na vista padrão) e o sync cobrindo: parado, com o motivo e a data.
    const comFim = criativosAgregados(data, undefined, { fim: HOJE, cobertura: COBERTURA, ref: HOJE });
    const b = comFim.conversao.find((c) => c.chave === "cr-2")!;
    expect(b.saude.level).toBe("parado");
    expect(b.saude.reason).toBe("sem veiculação nos últimos 7 dias (02/10–08/10); última impressão em 14/08");
    // Na Mídia (F4-D29) quem não está no ar mostra a veiculação, não a fadiga — e não tem sinal.
    expect(b.veiculacao).toEqual({ estado: "parou", ultimoDia: "2026-08-14", rotulo: "Último gasto em 14/08" });
    // O ativo continua julgado pela regra (frequência 2,5 com CTR estável = atenção).
    const a = comFim.conversao.find((c) => c.chave === "cr-1")!;
    expect(a.saude.level).toBe("atencao");
    expect(a.saude.reason).toMatch(/com CTR estável/);
    expect(a.veiculacao.estado).toBe("no-ar");
    // Com o sinal (a tela): o pausado sem sinal (e sem selo de status), o ativo com.
    const { bloco } = sinaisDe(data, "campanha");
    const pausado = bloco.conversao.find((c) => c.chave === "cr-2")!;
    const ativo = bloco.conversao.find((c) => c.chave === "cr-1")!;
    expect(pausado.sinal).toBeNull();
    expect(ativo.sinal).not.toBeNull();
    const html = renderToStaticMarkup(
      createElement(CreativesTable, { linhas: [ativo], bucket: "conversao", colunasDoRobo: false, regras: { sinal: textoDaReguaDoSinal(), fadiga: textoDaReguaDaFadiga() } }),
    );
    expect(html).toContain(ativo.sinal!.rotulo);
    expect(textoDaReguaDaFadiga()).toMatch(/Parado = nenhuma impressão nos últimos 7 dias do período/);
  });
});

// ---------------------------------------------------------------- verificação da 6.3 (lacunas)

describe("sem ?range=: motor e briefing julgam a saúde com o MESMO fim (hoje) e a mesma cobertura da página", () => {
  /** O anúncio B parou em agosto — e os últimos 14 dias DELE parecem fadiga (CTR 2% → 1%, frequência 2,5). */
  function comPausado(): DashboardData {
    const data = cenario();
    data.adDaily = [
      ...data.adDaily.filter((r) => r.adId !== "100002"),
      ...dias("2026-08-07", 7, "100002", { adset: "Lookalike", adsetId: "801", clicks: 20 }),
      ...dias("2026-08-14", 7, "100002", { adset: "Lookalike", adsetId: "801", clicks: 10, reach: 400 }),
    ];
    return data;
  }

  it("creativePerformance com fim = hoje dá o selo da tabela, e o M3 não manda renovar a arte do pausado", () => {
    const data = comPausado();
    // A página (vista padrão, range undefined): fim = hoje, com a cobertura do sync.
    const pagina = criativosAgregados(data, undefined, { fim: HOJE, cobertura: COBERTURA });
    const cr2 = pagina.conversao.find((c) => c.chave === "cr-2")!;
    expect(cr2.saude.level).toBe("parado");
    // O que o motor e o briefing leem: o MESMO nível e o mesmo motivo.
    const perf = creativePerformance(data, undefined, { fim: HOJE, cobertura: COBERTURA }).find((c) => c.adId === "100002")!;
    expect(perf.fatigue.level).toBe("parado");
    expect(perf.fatigue.reason).toBe(cr2.saude.reason);
    // Sem `fim`, o último dia da CONTA (08/10), nunca o do anúncio (14/08): não "fadiga".
    expect(creativePerformance(data, undefined).find((c) => c.adId === "100002")!.fatigue.level).not.toBe("fadigado");

    // O motor em ?range=all (range undefined): era "Renove a arte de “Anúncio B” (fadigando)".
    const acoes = motorDeAcoes({ data, range: undefined, kpis: kpisDe(data, undefined), eventos: [], agora: AGORA, hoje: HOJE, cobertura: COBERTURA });
    expect(acoes.filter((a) => a.regra === "M3").map((a) => a.id)).not.toContain("M3:cr-2");
    expect(acoes.some((a) => /Anúncio B/.test(a.titulo) && /fadig/i.test(a.titulo))).toBe(false);
  });

  it("o motor passa HOJE (não o último dia com dado): sync parado em 01/10 não vira “fadigando” no motor e “Sem dados” na Mídia", () => {
    const data = cenario();
    // Toda a conta tem linhas só até 01/10 — e nos últimos 14 dias DELAS o anúncio A parece fadigar.
    data.adDaily = [
      ...dias("2026-09-24", 7, "100001", { clicks: 20 }),
      ...dias("2026-10-01", 7, "100001", { clicks: 10, reach: 400 }),
    ];
    const syncParou = [{ from: "2026-08-01", to: "2026-10-01" }];
    // Sem o dia de hoje, as janelas terminam no último dia com dado (01/10): "fadigado".
    expect(creativePerformance(data, undefined).find((c) => c.adId === "100001")!.fatigue.level).toBe("fadigado");
    // A página (fim = hoje): "Sem dados" — e o motor, que agora passa hoje, concorda.
    const pagina = criativosAgregados(data, undefined, { fim: HOJE, cobertura: syncParou });
    expect(pagina.conversao.find((c) => c.chave === "cr-1")!.saude.level).toBe("sem-dados");
    const acoes = motorDeAcoes({ data, range: undefined, kpis: kpisDe(data, undefined), eventos: [], agora: AGORA, hoje: HOJE, cobertura: syncParou });
    expect(acoes.find((a) => a.id === "M3:cr-1")).toBeUndefined();
    // Com um período que termina em 01/10, os dois leem "fadigando" — e o M3 aparece.
    const ate01 = { from: "2026-09-18", to: "2026-10-01" };
    expect(criativosAgregados(data, ate01, { fim: ate01.to, cobertura: syncParou }).conversao.find((c) => c.chave === "cr-1")!.saude.level).toBe("fadigado");
    const noPeriodo = motorDeAcoes({ data, range: ate01, kpis: kpisDe(data, ate01), eventos: [], agora: AGORA, hoje: HOJE, cobertura: syncParou });
    expect(noPeriodo.find((a) => a.id === "M3:cr-1")).toBeDefined();
  });

  it("M6 não manda escalar o anúncio que a tabela mostra Parado (o vencedor tem de estar no ar)", () => {
    const data = comPausado();
    // B (pausado em agosto) trouxe 3 reuniões por id a R$ 700 — mais barato que A (R$ 840 / 3).
    for (let i = 0; i < 3; i++) data.leads.push(lead("2026-08-10", { adId: "100002", adsetId: "801", campaignId: "900", status: "agendado", bookedAt: "2026-08-12T12:00:00.000Z", meetingFor: "2026-08-15T12:00:00.000Z" }));
    // Fase 4: Escalar pede custo por reunião ATÉ o da conta (F4-D24). As reuniões baratas
    // de B puxariam o custo da conta para baixo do de A (R$ 1.540 ÷ 6 < R$ 280); um 3º
    // criativo no ar, sem reunião (R$ 1.000), põe a conta acima de A (R$ 2.540 ÷ 6) e
    // mantém o caso: B mais barato que A, mas parado.
    data.creatives.push(criativo("100003", "Anúncio C", { creativeId: "cr-3" }));
    data.adDaily.push(...dias("2026-10-08", 10, "100003", { adset: "Lookalike", adsetId: "801", spend: 100 }));
    const perf = creativePerformance(data, undefined, { fim: HOJE, cobertura: COBERTURA });
    const b = perf.find((c) => c.adId === "100002")!;
    expect(b.meetings).toBe(3);
    expect(b.fatigue.level).toBe("parado");
    expect(b.cpr).toBeLessThan(perf.find((c) => c.adId === "100001")!.cpr);
    const kp = kpisDe(data, undefined);
    expect(custoExibivel(kp.custoPorReuniao)).toBe(true);
    expect(kp.custoPorReuniao.valor).toBeGreaterThan(280);
    // O pausado não tem sinal; o ativo é o Escalar.
    const { bloco } = sinaisDe(data, "campanha");
    expect(bloco.conversao.find((c) => c.chave === "cr-2")!.sinal).toBeNull();
    expect(bloco.conversao.find((c) => c.chave === "cr-1")!.sinal).toMatchObject({ sinal: "escalar" });
    const m6 = motorDeAcoes({ data, range: undefined, kpis: kp, eventos: [], agora: AGORA, hoje: HOJE, cobertura: COBERTURA }).find((a) => a.regra === "M6");
    // O vencedor no ar é A; B só venceria por estar pausado com o custo antigo.
    expect(m6?.id).toBe("M6:cr-1");
  });

  it("o briefing da IA lê os criativos como a tela os escreve (`pago.midia`) — nunca um parado no ar", () => {
    /** A Mídia da tela, para a IA (`midiaParaIA(montarMidiaDaTela(…))`). */
    const midiaDaTela = (data: DashboardData, range: { from: string; to: string } | undefined) =>
      midiaParaIA(
        montarMidiaDaTela({
          data,
          range,
          rangeKey: range ? `${range.from}..${range.to}` : "all",
          naoComecou: false,
          kpis: kpisDe(data, range),
          opcoesKpis: { cobertura: COBERTURA },
          eventos: [],
          cobertura: COBERTURA,
          ultimoSyncAds: null,
          cfgLive: LIVE_PADRAO,
          marca: "consorcio",
          hoje: HOJE,
          agora: AGORA,
        }),
      );
    const noArDe = (data: DashboardData, range: { from: string; to: string } | undefined) => {
      const midia = midiaDaTela(data, range);
      const b = buildBriefing(data, range, { nowIso: AGORA, warnings: [], kpis: kpisDe(data, range), midia });
      if (!("pago" in b) || !b.pago || !("midia" in b.pago)) throw new Error("briefing de conversão sem pago.midia");
      expect("criativos" in b.pago).toBe(false);
      return b.pago.midia!.criativos?.noAr ?? [];
    };
    const data = comPausado();
    const noAr = noArDe(data, undefined);
    expect(noAr.map((c) => c.criativo)).toContain("Anúncio A");
    expect(noAr.map((c) => c.criativo)).not.toContain("Anúncio B");
    for (const c of noAr) expect(typeof c.sinal).toBe("string");

    // Conta inteira com dado só até 01/10: a tela julga a fadiga até HOJE (08/10) — sem
    // "Trocar arte" para A; num período que termina em 01/10, A fadiga e o sinal diz isso.
    const ate01 = cenario();
    ate01.adDaily = [...dias("2026-09-24", 7, "100001", { clicks: 20 }), ...dias("2026-10-01", 7, "100001", { clicks: 10, reach: 400 })];
    const sinalDeA = (range: { from: string; to: string } | undefined) => noArDe(ate01, range).find((c) => c.criativo === "Anúncio A")?.sinal;
    expect(sinalDeA(undefined)).not.toBe("Trocar arte");
    expect(sinalDeA({ from: "2026-09-18", to: "2026-10-01" })).toBe("Trocar arte");
  });
});

describe("Parado só com o sync confirmando a falta de veiculação; sem cobertura é “Sem dados” (ADR-06)", () => {
  /** Veiculou até 30/09 (14 dias, 1.000 impressões por dia); a janela recente vai de 02/10 a 08/10. */
  const ate30 = dias("2026-09-30", 14, "x", { impressions: 1000, clicks: 20 });

  it("sync parado depois de 30/09: “sem dados”, nunca “sem veiculação” — com ou sem cobertura informada", () => {
    const syncParou = [{ from: "2026-08-01", to: "2026-09-30" }];
    const f = computeFatigue(ate30, { fim: HOJE, cobertura: syncParou });
    expect(f.level).toBe("sem-dados");
    expect(f.reason).toBe(
      "sem dados nos últimos 7 dias (02/10–08/10): nenhuma sincronização bem-sucedida cobriu esses dias — pode ter havido veiculação que o painel não viu; última impressão em 30/09",
    );
    expect(f.reason).not.toMatch(/sem veiculação/);
    // Sem registro de sync nenhum, nenhum dia está confirmado (como em dailySeries).
    expect(computeFatigue(ate30, { fim: HOJE }).level).toBe("sem-dados");
    expect(computeFatigue(ate30, { fim: HOJE, cobertura: [] }).level).toBe("sem-dados");
  });

  it("com o sync em dia (cobre até 2 dias atrás) é “parado”, e o motivo diz quais dias o confirmam", () => {
    const emDia = computeFatigue(ate30, { fim: HOJE, cobertura: [{ from: "2026-08-01", to: "2026-10-06" }] });
    expect(emDia.level).toBe("parado");
    expect(emDia.reason).toBe(
      "sem veiculação de 02/10 a 06/10 (os dias dos últimos 7 até 08/10 que a sincronização confirmou); última impressão em 30/09",
    );
    const tudo = computeFatigue(ate30, { fim: HOJE, cobertura: COBERTURA });
    expect(tudo.reason).toBe("sem veiculação nos últimos 7 dias (02/10–08/10); última impressão em 30/09");
    // Um dia só coberto também sustenta, e o motivo diz que foi só ele.
    const umDia = computeFatigue(ate30, { fim: HOJE, cobertura: [{ from: "2026-08-01", to: "2026-10-02" }] });
    expect(umDia.level).toBe("parado");
    expect(umDia.reason).toMatch(/^sem veiculação em 02\/10 \(o único dia dos últimos 7 até 08\/10 que a sincronização confirmou\)/);
    // A linha do anúncio com zero impressões também é dado do sync: confirma o dia.
    const zerada = computeFatigue([...ate30, ad("2026-10-04", "x", { impressions: 0, spend: 0, clicks: 0, reach: 0, leads: 0 })], { fim: HOJE });
    expect(zerada.level).toBe("parado");
    expect(zerada.reason).toMatch(/^sem veiculação em 04\/10/);
  });

  it("na coluna Veiculação: 'Último gasto em' só com o sync cobrindo os dias depois; sem cobertura, 'Sem leitura' (ADR-06)", () => {
    const data = cenario();
    // Os dois anúncios veicularam até 30/09 (14 dias) e o sync parou ali.
    data.adDaily = [
      ...dias("2026-09-30", 14, "100001", { spend: 60, impressions: 2000, clicks: 50 }),
      ...dias("2026-09-30", 14, "100002", { adset: "Lookalike", adsetId: "801", spend: 30, impressions: 1500, clicks: 20 }),
    ];
    const syncParou = [{ from: "2026-08-01", to: "2026-09-30" }];
    // O "no ar" ancorado em hoje (08/10): nenhum dos dois veiculou de 06/10 a 08/10.
    const bloco = criativosAgregados(data, undefined, { fim: HOJE, cobertura: syncParou, ref: HOJE });
    expect(bloco.conversao).toHaveLength(2);
    for (const c of bloco.conversao) {
      expect(c.saude.level).toBe("sem-dados");
      expect(c.veiculacao).toEqual({ estado: "sem-leitura", ultimoDia: "2026-09-30", rotulo: "Sem leitura depois de 30/09" });
      expect(c.veiculacao.rotulo).not.toMatch(/Último gasto/);
    }
    // Com a cobertura em dia, os mesmos criativos "pararam" (o sync confirmou os dias depois).
    const emDia = criativosAgregados(data, undefined, { fim: HOJE, cobertura: COBERTURA, ref: HOJE });
    for (const c of emDia.conversao) {
      expect(c.saude.level).toBe("parado");
      expect(c.veiculacao).toEqual({ estado: "parou", ultimoDia: "2026-09-30", rotulo: "Último gasto em 30/09" });
    }
    // Nos dois casos: fora do ar não tem sinal.
    for (const c of [...bloco.conversao, ...emDia.conversao]) expect(c.sinal ?? null).toBeNull();
    // A régua da fadiga (a Saúde da descoberta) explica os dois.
    const regra = textoDaReguaDaFadiga();
    expect(regra).toMatch(/Parado = .*sincronização bem-sucedida confirmou/);
    expect(regra).toMatch(/Sem dados = .*nenhum dia coberto por sincronização bem-sucedida/);
  });

  it("na TELA (F4-D29): a coluna Veiculação imprime o rótulo — 'Sem leitura' sem cobertura, 'Último gasto' com ela — e a Saúde da descoberta fora do ar é '—', nunca 'Parado' nem 'Sem dados'", () => {
    const REGRAS = { sinal: textoDaReguaDoSinal(), fadiga: textoDaReguaDaFadiga() };
    /** O corpo da tabela (o cabeçalho leva a régua da fadiga, que cita "Parado" e "Sem dados"). */
    const corpo = (html: string) => html.slice(html.indexOf("<tbody"));
    const conv = cenario();
    conv.adDaily = [
      ...dias("2026-09-30", 14, "100001", { spend: 60, impressions: 2000, clicks: 50 }),
      ...dias("2026-09-30", 14, "100002", { adset: "Lookalike", adsetId: "801", spend: 30, impressions: 1500, clicks: 20 }),
    ];
    const desc = base({
      creatives: [criativo("300001", "Reel", { creativeId: "cr-d", format: "video" })],
      adDaily: dias("2026-09-30", 14, "300001", { objective: "OUTCOME_ENGAGEMENT", adset: "Descoberta", adsetId: "850" }),
    });
    const casos = [
      { cobertura: [{ from: "2026-08-01", to: "2026-09-30" }], rotulo: "Sem leitura depois de 30/09", outro: "Último gasto em" },
      { cobertura: COBERTURA, rotulo: "Último gasto em 30/09", outro: "Sem leitura" },
    ];
    for (const { cobertura, rotulo, outro } of casos) {
      const cri = criativosAgregados(conv, undefined, { fim: HOJE, cobertura, ref: HOJE });
      const htmlCri = corpo(renderToStaticMarkup(createElement(CreativesTable, { linhas: cri.conversao, bucket: "conversao", colunasDoRobo: false, regras: REGRAS })));
      expect(htmlCri).toContain(rotulo);
      expect(htmlCri).not.toContain(outro);
      const conj = conjuntosPorId(conv, undefined, { ref: HOJE, cobertura });
      const htmlConj = corpo(renderToStaticMarkup(createElement(ConjuntosTable, { linhas: conj.conversao, bucket: "conversao", colunasDoRobo: false })));
      expect(htmlConj).toContain(rotulo);
      expect(htmlConj).not.toContain(outro);
      // A descoberta: a Veiculação diz o estado UMA vez; a Saúde de quem não está no ar é "—".
      const blocoD = criativosAgregados(desc, undefined, { fim: HOJE, cobertura, ref: HOJE });
      expect(blocoD.descoberta).toHaveLength(1);
      const htmlD = corpo(renderToStaticMarkup(createElement(CreativesTable, { linhas: blocoD.descoberta, bucket: "descoberta", colunasDoRobo: false, regras: REGRAS })));
      expect(htmlD.split(rotulo).length - 1, rotulo).toBe(1);
      expect(htmlD).toContain("—");
      for (const t of ["Parado", "Sem dados", "(sem veiculação)", "(sincronização sem cobertura)", "Saudável", "Fadigando"]) expect(htmlD, t).not.toContain(t);
    }
  });
});

describe("reuniões que chegam só com o nome: fora das linhas de conjunto, COM o porquê no ⓘ (K33) e o alerta (K41)", () => {
  /** A Mídia da tela sobre os dados do teste, no PERIODO. */
  const midiaDe = (data: DashboardData) =>
    montarMidiaDaTela({
      data,
      range: PERIODO,
      rangeKey: `${PERIODO.from}..${PERIODO.to}`,
      naoComecou: false,
      kpis: kpisDe(data),
      opcoesKpis: { cobertura: COBERTURA },
      eventos: [],
      cobertura: COBERTURA,
      ultimoSyncAds: null,
      cfgLive: LIVE_PADRAO,
      marca: "consorcio",
      hoje: HOJE,
      agora: AGORA,
    });

  it("o ⓘ dos conjuntos conta as reuniões só por nome, e linhas + elas fecham com as reuniões de conversão da conta", () => {
    const data = cenario();
    for (let i = 0; i < 3; i++) data.leads.push(lead("2026-10-03", { utmContent: "Anúncio B", ...agendou }));
    const bloco = conjuntosPorId(data, PERIODO, { custoPorReuniaoExibivel: true });
    const linhas = bloco.conversao.flatMap((c) => c.conjuntos ?? []);
    expect(linhas.reduce((s, c) => s + c.agendadas, 0)).toBe(3);
    expect(bloco.naoAtribuidos.reunioesSoPorNome).toBe(3);
    // A diferença para o resumo é explicada, sem sobra.
    expect(linhas.reduce((s, c) => s + c.agendadas, 0) + bloco.naoAtribuidos.reunioesSoPorNome).toBe(kpisDe(data).reunioesConversao.valor);

    const m = midiaDe(data);
    expect(m.detalhes.conjuntos.dica).toContain("3 reuniões do período chegaram só com o nome do anúncio, sem id.");
    expect(m.detalhes.conjuntos.dica).toContain("Contam nas reuniões da conta, mas em nenhum conjunto.");
    // Os leads por nome único ENTRAM na linha: nada "fora das linhas".
    expect(m.detalhes.conjuntos.dica).not.toContain("Fora das linhas:");
    // O atalho do link com {{ad.id}} não some (K41).
    const alerta = m.alertas.find((a) => a.id === "midia-reunioes-so-por-nome");
    expect(alerta?.cta).toEqual({ label: "Gerar o link certo", href: "/configuracoes/ferramentas#utm" });
    // A regra também está no ⓘ dos conjuntos (agora em duas frases, K36).
    expect(REGRA_ATRIBUICAO_REUNIAO).toMatch(/Reunião entra na linha só com o id do anúncio ou do conjunto/);
    expect(m.detalhes.conjuntos.dica).toContain("Reunião entra na linha só com o id do anúncio ou do conjunto (o link padrão traz {{ad.id}}).");
    expect(m.detalhes.conjuntos.dica).toContain("Lead entra também pelo nome único do anúncio.");
  });

  it("singular; reunião com o adsetId da UTM padrão entra na linha; sem nada a dizer, nenhuma frase", () => {
    const data = cenario();
    data.leads.push(lead("2026-10-03", { utmContent: "Anúncio B", ...agendou }));
    // Só o adsetId da UTM padrão: entra na linha do conjunto.
    data.leads.push(lead("2026-10-03", { adsetId: "801", utmContent: "Anúncio B", ...agendou }));
    const bloco = conjuntosPorId(data, PERIODO, { custoPorReuniaoExibivel: true });
    expect(bloco.conversao.flatMap((c) => c.conjuntos ?? []).find((c) => c.adsetId === "801")!.agendadas).toBe(1);
    expect(bloco.naoAtribuidos.reunioesSoPorNome).toBe(1);
    const dica1 = midiaDe(data).detalhes.conjuntos.dica;
    expect(dica1).toContain("1 reunião do período chegou só com o nome do anúncio, sem id.");
    expect(dica1).toContain("Conta nas reuniões da conta, mas em nenhum conjunto.");

    const limpo = midiaDe(cenario());
    expect(limpo.detalhes.conjuntos.dica).not.toMatch(/só com o nome do anúncio/);
    expect(limpo.alertas.map((a) => a.id)).not.toContain("midia-reunioes-so-por-nome");
  });

  it("o 'fora das linhas' é UM texto, só de leads de CONVERSÃO, com o motivo — no ⓘ da verba e no dos conjuntos", () => {
    const data = cenario();
    // Um ambíguo ("Anúncio A" em dois anúncios), um de anúncio que não está nas linhas da marca e um orgânico.
    data.creatives.push(criativo("100003", "Anúncio A"));
    data.adDaily.push(ad("2026-10-05", "100003", { adset: "Lookalike", adsetId: "801", spend: 5 }));
    data.leads.push(lead("2026-10-04", { utmContent: "Anúncio A" }));
    data.leads.push(lead("2026-10-04", { adId: "999999", utmContent: "999999" }));
    data.leads.push(lead("2026-10-04", { utmSource: undefined, utmMedium: undefined }));
    const kp = kpisDe(data);
    const fora = foraDasLinhasDeConversao(data, PERIODO, kp, conjuntosPorId(data, PERIODO, { custoPorReuniaoExibivel: custoExibivel(kp.custoPorReuniao) }));
    expect(fora.porMotivo.ambigua).toBe(1);
    expect(fora.porMotivo["anuncio-de-fora"]).toBe(1);
    expect(fora.organicos).toBe(1);
    const texto = textoDosForaDasLinhas(fora);
    expect(texto.startsWith(`Fora das linhas: 2 de ${kp.leadsConversao.valor} leads de conversão.`)).toBe(true);
    expect(texto).toContain("1 de anúncio fora das linhas desta marca.");
    expect(texto).toContain("1 com nome ambíguo.");
    // O orgânico não é de conversão: fica fora do texto (e tem outro nome no ⓘ dos conjuntos).
    expect(texto).not.toMatch(/orgânic/);
    const m = midiaDe(data);
    expect(m.verba!.dica).toContain(texto);
    expect(m.detalhes.conjuntos.dica).toContain(texto);
    expect(m.detalhes.conjuntos.dica).toMatch(/\b1 leads? sem anúncio pago \(orgânicos? ou diretos?\) fica/);
  });
});
