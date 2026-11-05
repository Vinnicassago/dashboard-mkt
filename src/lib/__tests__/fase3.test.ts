/**
 * Fase 3 — um número por métrica. Fixture sintética (nenhum dado real). O portão
 * confere também o Início (Fase 2, nov/26): cartões, funil curto e frases leem os
 * MESMOS números; o Funil (`transicoesDoFunil`) e o motor (dormente até a Mídia)
 * continuam conferidos direto. Instantes em Z ou pelo `brt(dia, "HH:MM")`.
 */
import { describe, expect, it } from "vitest";
import { buildSeedData, buildSeedLeadEvents } from "../data/seed";
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
import { custoExibivel, fatoDoCustoPorReuniao, kpisDoPeriodo, mostrar } from "../kpis";
import { AMOSTRA_MINIMA, montarCascata } from "../cascata";
import { montarBussola } from "../bussola";
import { transicoesDoFunil } from "../gargalo";
import { motorDeAcoes } from "../motor";
import { montarFila } from "../fila";
import { montarFilaDaLive } from "../fila-live";
import type { EntradaInicio, Inicio } from "../inicio";
import { pageRange } from "../page-range";
import { reabertosNoPainel, reabertosPorLead, semMensagemDoRobo, type RoboAgora } from "../robo/situacao";
import { EXPEDIENTE_PADRAO } from "../turno";
import { buildBriefing } from "../ai/briefing";
import { buildRecommendations } from "../recommendations";
import { assessTrust } from "../trust";
import { janelasCobertas } from "../cobertura";
import { atribuidor, isPaidSource } from "../atribuicao";
import { alertasDeAtribuicao } from "../alertas";
import { brandForCampaign, CURINGA, NAO_CLASSIFICADO, type BrandMeta } from "../meta/config";
import { DICIONARIO } from "../dicionario";
import { formatCurrency, formatInt } from "../format";
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

  it("o cartão de Reuniões do Início não imprime o custo por reunião e diz o fato (verba e reuniões de conversão)", () => {
    const { inicio } = montarBussola({
      data,
      range: OUT,
      rangeKey: "2026-10-01..2026-10-07",
      kpis: k,
      eventos: [],
      filaLive: [],
      agora: "2026-10-08T12:00:00.000Z",
      hoje: "2026-10-08",
    });
    expect(inicio.cartoes.custoReuniao).not.toMatch(/por reunião/);
    // O cartão encurta o fato (o "em conversão" do investimento está no cartão ao lado); o fato inteiro é o da Mídia.
    expect(inicio.cartoes.custoReuniao).toMatch(/investidos · 2 reuniões de conversão$/);
    expect(inicio.cartoes.custo.fato).toMatch(/investidos em conversão · 2 reuniões de conversão$/);
    expect(inicio.cartoes.custo).toEqual(fatoDoCustoPorReuniao(k));
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

const brt = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();

/**
 * Os invariantes do Início que são de NÚMERO (§6, 1, 2, 3, 4 e 6): os cartões são
 * os kpis; o funil curto aninha (Leads e Agendaram = kpis, nenhuma taxa > 1, taxa
 * só com base ≥ AMOSTRA_MINIMA); cada frase é o número da página que ela abre (o
 * grupo da MESMA `montarFila` da /fila, a Fila da live, o `semMensagemDoRobo` do
 * alerta); o custo por reunião nunca sai como razão abaixo da régua.
 */
function conferirInicio(e: EntradaInicio): Inicio {
  const { inicio } = montarBussola(e);
  const k = e.kpis;
  // Cartões.
  expect(inicio.cartoes.investimento.texto).toBe(mostrar(k.investimentoConversao, "moeda0"));
  expect(inicio.cartoes.cpl.texto).toBe(mostrar(k.cpl, "moeda"));
  expect(inicio.cartoes.leads.valor).toBe(k.leads.valor);
  expect(inicio.cartoes.reunioes.valor).toBe(k.reunioesAgendadas.valor);
  if (custoExibivel(k.custoPorReuniao)) expect(inicio.cartoes.custoReuniao).toContain(formatCurrency(k.custoPorReuniao.valor));
  else {
    expect(inicio.cartoes.custoReuniao).not.toMatch(/por reunião/);
    const n = k.reunioesConversao.valor;
    expect(inicio.cartoes.custoReuniao).toContain(`· ${formatInt(n)} ${n === 1 ? "reunião" : "reuniões"} de conversão`);
  }
  // Barras: Σ = o cartão de Leads.
  expect(inicio.leadsChegando.dias.reduce((s, d) => s + d.leads, 0)).toBe(k.leads.valor);

  // 3. O funil curto.
  const f = inicio.atendimento.funil;
  const degrau = (id: string) => f.find((d) => d.id === id);
  expect(degrau("leads")?.valor).toBe(k.leads.valor);
  expect(degrau("agendaram")?.valor).toBe(k.agendaram.valor);
  if (degrau("agendaram")?.taxa != null) expect(k.leads.valor).toBeGreaterThanOrEqual(AMOSTRA_MINIMA);
  for (const d of f) if (d.taxa != null) expect(d.taxa).toBeLessThanOrEqual(1);
  const doRobo = f.filter((d) => d.doRobo);
  if (doRobo.length) expect(doRobo[0].valor).toBeLessThanOrEqual(k.leads.valor);
  for (let i = 1; i < doRobo.length; i++) {
    expect(doRobo[i].valor).toBeLessThanOrEqual(doRobo[i - 1].valor);
    if (doRobo[i].taxa != null) expect(doRobo[i - 1].valor).toBeGreaterThanOrEqual(AMOSTRA_MINIMA);
  }
  const realizadas = degrau("realizadas");
  if (realizadas) {
    expect(realizadas.valor).toBe(k.overview.attended);
    if (realizadas.taxa != null) expect(k.agendaram.valor).toBeGreaterThanOrEqual(AMOSTRA_MINIMA);
  }

  // 4. As frases: o número do texto é o do grupo da Fila (a mesma entrada da /fila).
  const ligado = Boolean(e.robo?.ligado);
  const fila = montarFila({ nowIso: e.agora, leads: e.data.leads, eventos: e.eventos, robo: ligado ? e.robo : undefined });
  expect(inicio.atendimento.frases.length).toBeLessThanOrEqual(3);
  for (const fr of inicio.atendimento.frases) {
    if (fr.id === "live") expect(fr.total).toBe(e.filaLive.length);
    else if (fr.id === "sem-1a-msg") {
      expect(ligado).toBe(true);
      expect(fr.total).toBe(semMensagemDoRobo(e.data.leads, reabertosPorLead(e.eventos), e.robo, e.agora, reabertosNoPainel(e.eventos)).total);
    } else {
      const g = fila.grupos.find((x) => x.etapa === fr.id)!;
      expect(fr.total).toBe(g.total);
      expect(fr.texto).toContain(`· ${formatInt(g.total)}`);
    }
  }
  return inicio;
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

        const AGORA = "2026-10-08T12:00:00.000Z";
        const HOJE = "2026-10-08";
        // O Funil (`transicoesDoFunil`, que continua no /funil) lê ESTES números.
        const leadAgendada = transicoesDoFunil(data, range, k, { agora: AGORA, hoje: HOJE }).find((t) => t.id === "lead_agendada")!;
        expect(leadAgendada.entradas).toBe(k.leads.valor);
        expect(leadAgendada.saidas).toBe(k.agendaram.valor);

        // O Início (só a marca de conversão: a awareness tem a home dela) lê ESTES números.
        let inicio: Inicio | undefined;
        if (brand === "consorcio") {
          const eventos = buildSeedLeadEvents(data.leads);
          inicio = conferirInicio({
            data,
            range,
            rangeKey: range ? `${range.from}..${range.to}` : "all",
            kpis: k,
            eventos,
            expediente: EXPEDIENTE_PADRAO,
            filaLive: montarFilaDaLive(data.leads, eventos, AGORA, EXPEDIENTE_PADRAO),
            agora: AGORA,
            hoje: HOJE,
          });
          // Robô desligado: o funil do painel.
          expect(inicio.atendimento.funil.map((d) => d.id)).toEqual(["leads", "agendaram", "realizadas"]);
        }

        // A IA recebe os mesmos números (ou null, onde a tela mostra "—").
        const b = buildBriefing(data, range, { nowIso: AGORA, warnings: [] });
        if ("pago" in b && b.pago && "reunioesAgendadasNoPeriodo" in b.pago) {
          expect(b.pago.leads).toBe(k.leads.valor);
          expect(b.pago.reunioesAgendadasNoPeriodo).toBe(k.reunioesAgendadas.valor);
          expect(b.pago.cpr === null).toBe(!custoExibivel(k.custoPorReuniao));
          expect(b.pago.cpl === null).toBe(!custoExibivel(k.cpl));
        }
        // Com os kpis e o Início do carregador: o cartão e o `pago` saem do MESMO objeto.
        if (inicio) {
          const bi = buildBriefing(data, range, { nowIso: AGORA, warnings: [], kpis: k, inicio });
          expect(bi.inicio?.cartoes.cpl).toBe(mostrar(k.cpl, "moeda"));
          expect(bi.inicio?.cartoes.reunioesAgendadas).toBe(mostrar(k.reunioesAgendadas, "int"));
          if ("pago" in bi && bi.pago && "reunioesAgendadasNoPeriodo" in bi.pago) {
            expect(bi.pago.cpl === null).toBe(!custoExibivel(k.cpl));
            expect(bi.pago.cpr === null).toBe(!custoExibivel(k.custoPorReuniao));
          }
        }

        // Tabelas por anúncio/conjunto: os leads do painel atribuídos nunca passam do total.
        const perf = creativePerformance(data, range);
        expect(perf.reduce((s, x) => s + x.leadsPainel, 0)).toBeLessThanOrEqual(k.leads.valor);
        const adsets = adsetPerformance(data, range);
        expect(adsets.reduce((s, x) => s + x.meetings, 0)).toBeLessThanOrEqual(k.reunioesAgendadas.valor);

        // O motor de ações (dormente até a Mídia) não decide por custo por reunião abaixo da régua.
        if (!custoExibivel(k.custoPorReuniao)) {
          const acoes = motorDeAcoes({ data, range, kpis: k, eventos: [], agora: AGORA, hoje: HOJE });
          expect(acoes.some((a) => a.regra === "M2" || a.regra === "M6")).toBe(false);
        }
        // E as regras de conteúdo continuam fora do funil pago.
        const recs = buildRecommendations(data, range, "2026-10-08T12:00:00.000Z");
        expect(recs.every((r) => !["cpr-over", "cpl-over", "realloc", "pace-over", "pace-sub"].includes(r.id) && !r.id.startsWith("scale-") && !r.id.startsWith("fatigue-"))).toBe(true);
      });
    }
  }
});

// ---------------------------------------------------------------- Início com o robô de fixture

describe("portão da Fase 3 · Início com um robô de fixture (colunas robo_*), 3 períodos", () => {
  const HOJE = "2026-11-04";
  const AGORA = brt(HOJE, "15:00");
  const LIDO = brt(HOJE, "14:55");
  const ROBO: RoboAgora = { ligado: true, lidoAte: LIDO, confiavel: true, sync: { ultimoOk: LIDO, falha: null } };
  let n = 0;
  const doRobo = (dia: string, over: Partial<Lead> = {}): Lead => ({
    id: `ROBO-${++n}`,
    brand: "consorcio",
    createdAt: brt(dia, "10:00"),
    name: `Pessoa Robô ${n}`,
    phone: `55119777${String(n).padStart(5, "0")}`,
    status: "lead",
    utmSource: "meta",
    utmContent: "Anúncio A|100001",
    ...over,
  });
  const saudado = (dia: string): Partial<Lead> => ({
    roboVistoEm: brt(dia, "10:05"),
    roboRecebidoEm: brt(dia, "10:00"),
    roboSaudacaoEm: brt(dia, "10:01"),
    roboEtapa: "nao_respondeu",
  });
  const respondeu = (dia: string): Partial<Lead> => ({
    ...saudado(dia),
    roboRespondeuEm: brt(dia, "10:20"),
    roboUltimaMsgClienteEm: brt(dia, "10:20"),
    roboUltimaInteracaoEm: brt(dia, "10:20"),
    roboEtapa: "em_conversa",
  });
  const aceitou = (dia: string): Partial<Lead> => ({
    ...respondeu(dia),
    roboConviteEm: brt(dia, "11:00"),
    roboAceitouEm: brt(dia, "11:10"),
    roboEtapa: "transferido",
  });
  const seed = porMarca(buildSeedData(), "consorcio");
  const leads: Lead[] = [
    ...seed.leads,
    doRobo("2026-10-30", saudado("2026-10-30")),
    doRobo("2026-10-31", respondeu("2026-10-31")),
    doRobo("2026-11-01", respondeu("2026-11-01")),
    doRobo("2026-11-02", aceitou("2026-11-02")),
    doRobo("2026-11-03", { ...aceitou("2026-11-03"), status: "agendado", bookedAt: brt("2026-11-03", "15:00"), meetingFor: brt("2026-11-06", "10:00") }),
    doRobo("2026-11-03", aceitou("2026-11-03")),
    doRobo(HOJE, { createdAt: brt(HOJE, "11:00") }), // 4 h sem registro no robô: resgate
    doRobo(HOJE, { createdAt: brt(HOJE, "14:30") }), // 30 min: sem a 1ª mensagem
    doRobo(HOJE, { classe: "A" }), // inscrito da live: fora do robô
  ];
  const data: DashboardData = { ...seed, leads, adDaily: [...seed.adDaily, ad("2026-11-02", "100001", 300), ad("2026-11-03", "100001", 300)] };
  const eventos = buildSeedLeadEvents(seed.leads);

  for (const chave of ["7d", "30d", "all"]) {
    it(`consorcio · ${chave}`, () => {
      const { range, rangeKey } = pageRange(data, chave, HOJE);
      const kpis = kpisDoPeriodo(data, range, { hoje: HOJE, agora: AGORA, comparar: true });
      const filaLive = montarFilaDaLive(data.leads, eventos, AGORA, EXPEDIENTE_PADRAO);
      const ini = conferirInicio({ data, range, rangeKey, kpis, eventos, robo: ROBO, expediente: EXPEDIENTE_PADRAO, filaLive, agora: AGORA, hoje: HOJE });
      expect(ini.atendimento.roboLigado).toBe(true);
      expect(ini.atendimento.funilComRobo).toBe(true);
      // Quem passou pelo robô tem amostra: as taxas do robô aparecem (≤ 1, aninhadas).
      const funil = Object.fromEntries(ini.atendimento.funil.map((d) => [d.id, d]));
      expect(funil["com-robo"].valor).toBe(8); // os 6 saudados + os de 11h e 14h30 (mais de 15 min); a live fica fora
      expect(funil["primeira-msg"].valor).toBe(6);
      expect(funil["responderam"].valor).toBe(5);
      expect(funil["aceitaram"].valor).toBe(3);
      expect(funil["primeira-msg"].taxa).toBeCloseTo(6 / 8, 6);
      // As frases do robô ligado: live, Resgate, sem a 1ª mensagem — nessa ordem.
      expect(ini.atendimento.frases.map((f) => f.id)).toEqual(["live", "resgate", "sem-1a-msg"]);
    });
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
