/**
 * Fase 2 (nov/26), item 2.8 — o dia do lead em Brasília, o "último post" e o dia
 * futuro. Fixture sintética (nenhum dado real). Instantes sempre em Z ou pelo
 * helper `brt()` (Brasília = UTC−3), nunca texto sem fuso — o resultado não pode
 * depender do fuso da máquina que roda o teste.
 */
import { describe, expect, it } from "vitest";
import { diaDoLead } from "../horario-util";
import {
  aggregatePostPerformance,
  cohortWeekly,
  dailySeries,
  dataDoAgendamento,
  filterLeads,
  fimDoPeriodo,
  postPerformance,
  postingCadence,
  reunioesNoPeriodo,
  ultimoPostDaGrade,
} from "../metrics";
import { kpisDoPeriodo, periodoDaRegua, reguaDoPeriodo } from "../kpis";
import { resumoDaMidia } from "../midia";
import { pageRange } from "../page-range";
import { coortesDoFunil, confiancaDoRegistro } from "../funil";
import { motorDeAcoes } from "../motor";
import { taxasObservadas } from "../metas";
import { buildRecommendations } from "../recommendations";
import { instanteDoCsv, parseLeadsCsv } from "../leads-csv";
import { hojeEmBrasilia } from "../range";
import type { AdDaily, Creative, DashboardData, IgPost, Lead, LeadEvent, Meta } from "../types";

// ---------------------------------------------------------------- fixtures

const brt = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();

const ad = (date: string, spend: number, extra: Partial<AdDaily> = {}): AdDaily => ({
  brand: "consorcio",
  date,
  campaign: "Campanha",
  adset: "Conjunto",
  adId: "100001",
  objective: "OUTCOME_LEADS",
  spend,
  impressions: 1000,
  reach: 800,
  frequency: 1.25,
  clicks: 10,
  leads: 1,
  ...extra,
});

let seq = 0;
const lead = (createdAt: string, extra: Partial<Lead> = {}): Lead => ({
  id: `L${++seq}`,
  brand: "consorcio",
  createdAt,
  name: "Pessoa Teste",
  status: "lead",
  utmSource: "meta",
  utmContent: "Anúncio A|100001",
  ...extra,
});

let evSeq = 0;
const evento = (leadId: string, createdAt: string, extra: Partial<LeadEvent> = {}): LeadEvent => ({
  id: `E${++evSeq}`,
  leadId,
  brand: "consorcio",
  leadName: "Pessoa Teste",
  actor: "ana",
  action: "status_changed",
  fromStatus: "lead",
  toStatus: "sem_interesse",
  createdAt,
  ...extra,
});

const criativo = (adId: string, over: Partial<Creative> = {}): Creative => ({
  adId,
  brand: "consorcio",
  name: "Anúncio A",
  format: "imagem",
  ...over,
});

const post = (id: string, publishedAt: string, over: Partial<IgPost> = {}): IgPost => ({
  id,
  brand: "consorcio",
  publishedAt,
  type: "reel",
  caption: `Post ${id}`,
  permalink: `https://www.instagram.com/reel/${id}/`,
  reach: 100,
  views: 200,
  likes: 1,
  comments: 0,
  saved: 0,
  shares: 0,
  ...over,
});

function base(over: Partial<DashboardData> = {}): DashboardData {
  return {
    campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-08-01", budgetTotal: 0 },
    igAccountDaily: [],
    igPosts: [],
    adDaily: [],
    creatives: [criativo("100001")],
    lpDaily: [],
    leads: [],
    goals: [],
    metas: [],
    updatedAt: "2026-10-08T15:00:00.000Z",
    ...over,
  };
}

const DIA_08 = { from: "2026-10-08", to: "2026-10-08" };
const DIA_09 = { from: "2026-10-09", to: "2026-10-09" };
/** Sexta 09/10, 12:00 em Brasília: tudo do dia 08 já passou. */
const AGORA = "2026-10-09T15:00:00.000Z";
const HOJE = "2026-10-09";

// ---------------------------------------------------------------- diaDoLead

describe("diaDoLead: o dia de Brasília de um instante, sem lançar", () => {
  it("22h de Brasília é do mesmo dia (o ISO já é do dia seguinte em UTC)", () => {
    const iso = brt("2026-10-08", "22:00");
    expect(iso.startsWith("2026-10-09")).toBe(true);
    expect(diaDoLead(iso)).toBe("2026-10-08");
  });

  it("dia puro passa intacto; vazio e indefinido viram vazio; lixo não lança", () => {
    expect(diaDoLead("2026-10-08")).toBe("2026-10-08");
    expect(diaDoLead("")).toBe("");
    expect(diaDoLead(undefined)).toBe("");
    expect(() => diaDoLead("lixo")).not.toThrow();
    expect(diaDoLead("lixo")).toBe("lixo");
  });

  it("texto sem fuso é o relógio de Brasília (seed, datetime-local, CSV antigo)", () => {
    expect(diaDoLead("2026-10-08T23:30:00")).toBe("2026-10-08");
    expect(diaDoLead("2026-10-08T23:30")).toBe("2026-10-08");
    expect(diaDoLead("2026-10-08T23:30:00.123")).toBe("2026-10-08");
    expect(diaDoLead("2026-10-08 23:30")).toBe("2026-10-08");
  });

  it("com fuso, o dia em Brasília — SEM exceção de meia-noite (00:00Z = 21:00 do dia anterior)", () => {
    const vinteUma = brt("2026-10-07", "21:00");
    expect(vinteUma).toBe("2026-10-08T00:00:00.000Z");
    expect(diaDoLead(vinteUma)).toBe("2026-10-07");
    expect(diaDoLead("2026-10-08T00:00:00.000Z")).toBe("2026-10-07");
    expect(diaDoLead("2026-10-08T01:30:00+00:00")).toBe("2026-10-07"); // Supabase devolve "+00:00"
    // Fuso só em horas ("+00", como o Postgres imprime): o mesmo dia com "T" ou com espaço.
    expect(diaDoLead("2026-10-08T01:30:00+00")).toBe("2026-10-07");
    expect(diaDoLead("2026-10-08 01:30:00+00")).toBe("2026-10-07");
    expect(diaDoLead("2026-10-08T01:30:00.123+00")).toBe("2026-10-07");
    expect(diaDoLead("2026-10-07T23:30:00-03")).toBe("2026-10-07");
    expect(diaDoLead("2026-10-08T23:30:00+0000")).toBe("2026-10-08"); // timestamp do Instagram
    expect(diaDoLead("2026-10-08T12:00:00-03:00")).toBe("2026-10-08");
    expect(diaDoLead("2026-10-09T02:59:59.999Z")).toBe("2026-10-08");
    expect(diaDoLead("2026-10-09T03:00:00.000Z")).toBe("2026-10-09");
  });

  it("a mesma string devolve o mesmo dia de novo (cache)", () => {
    const iso = brt("2026-10-08", "23:59");
    expect(diaDoLead(iso)).toBe(diaDoLead(iso));
    expect(diaDoLead(iso)).toBe("2026-10-08");
  });
});

// ---------------------------------------------------------------- leads e reuniões do período

describe("filterLeads e kpisDoPeriodo: o lead das 22h é do dia dele", () => {
  const l22 = lead(brt("2026-10-08", "22:00"));
  const l10 = lead(brt("2026-10-08", "10:00"));
  const madrugada = lead(brt("2026-10-09", "00:30"));
  const data = base({
    adDaily: [ad("2026-10-08", 100), ad("2026-10-09", 60)],
    leads: [l10, l22, madrugada],
  });

  it("o lead das 22h do dia 08 está em {08..08} e não em {09..09}; o das 00h30 do dia 09 está no 09", () => {
    expect(filterLeads(data.leads, DIA_08).map((l) => l.id)).toEqual([l10.id, l22.id]);
    expect(filterLeads(data.leads, DIA_09).map((l) => l.id)).toEqual([madrugada.id]);
  });

  it("período de 1 dia: leads contam o das 22h e o CPL = gasto do dia ÷ leads de conversão do dia", () => {
    const k = kpisDoPeriodo(data, DIA_08, { hoje: HOJE, agora: AGORA });
    expect(k.leads.valor).toBe(2);
    expect(k.leadsConversao.valor).toBe(2);
    expect(k.cpl.valor).toBeCloseTo(100 / 2, 9);
    const k9 = kpisDoPeriodo(data, DIA_09, { hoje: HOJE, agora: AGORA });
    expect(k9.leads.valor).toBe(1);
    expect(k9.cpl.valor).toBeCloseTo(60, 9);
  });

  it("'campanha inteira' começa no dia de Brasília do 1º lead", () => {
    const so = base({ campaign: { ...base().campaign, startDate: "" }, leads: [lead(brt("2026-10-07", "22:30"))] });
    expect(periodoDaRegua(so, undefined, HOJE).from).toBe("2026-10-07");
  });

  it("barras de hoje: com agora = 09T01:00Z (22h do dia 08), o lead das 22h é de HOJE (08)", () => {
    const agora = new Date("2026-10-09T01:00:00.000Z");
    const hoje = hojeEmBrasilia(agora);
    expect(hoje).toBe("2026-10-08");
    expect(diaDoLead(l22.createdAt)).toBe(hoje);
    expect(filterLeads(data.leads, { from: hoje, to: hoje })).toContain(l22);
  });
});

describe("reuniões pela data do agendamento em Brasília", () => {
  const agendou = lead(brt("2026-10-05", "10:00"), { status: "agendado", bookedAt: brt("2026-10-08", "22:30") });
  const data = base({ adDaily: [ad("2026-10-08", 300)], leads: [agendou] });

  it("bookedAt às 22h30 de Brasília é reunião do dia 08", () => {
    expect(dataDoAgendamento(agendou)).toBe("2026-10-08");
    expect(reunioesNoPeriodo(data.leads, DIA_08)).toHaveLength(1);
    expect(reunioesNoPeriodo(data.leads, DIA_09)).toHaveLength(0);
    expect(kpisDoPeriodo(data, DIA_08, { hoje: HOJE, agora: AGORA }).reunioesAgendadas.valor).toBe(1);
    expect(kpisDoPeriodo(data, DIA_09, { hoje: HOJE, agora: AGORA }).reunioesAgendadas.valor).toBe(0);
  });

  it("comparecimento: a reunião marcada para 21h30 de Brasília é do dia 08", () => {
    const foi = lead(brt("2026-10-01", "10:00"), {
      status: "reuniao_realizada",
      bookedAt: brt("2026-10-02", "10:00"),
      meetingFor: brt("2026-10-08", "21:30"),
      attendedAt: brt("2026-10-08", "22:00"),
    });
    const d = base({ leads: [foi] });
    expect(kpisDoPeriodo(d, DIA_08, { hoje: HOJE, agora: AGORA }).comparecimento).toMatchObject({ valor: 1, n: 1 });
    expect(kpisDoPeriodo(d, DIA_09, { hoje: HOJE, agora: AGORA }).comparecimento.n).toBe(0);
  });

  // A regra das 22 h no Funil (o funil do processo, por coorte) mora em `fase3-processo.test.ts` (K19).
});

// ---------------------------------------------------------------- coortes

describe("coortes: a semana do lead é a de Brasília", () => {
  it("lead de domingo 22h cai na semana de segunda 05/10, e com agora = domingo 22h não há semana futura", () => {
    const domingo = brt("2026-10-11", "22:00"); // 12/10 01:00 em UTC — já segunda
    const data = base({ adDaily: [ad("2026-10-06", 100)], leads: [lead(brt("2026-10-06", "10:00")), lead(domingo)] });
    const c = cohortWeekly(data, undefined, domingo);
    expect(c.map((x) => x.week)).toEqual(["2026-10-05"]);
    expect(c[0].leads).toBe(2);
    const f = coortesDoFunil(data, undefined, { agora: domingo, hoje: "2026-10-11" });
    expect(f.map((x) => x.semana)).toEqual(["2026-10-05"]);
    expect(f[0].leads).toBe(2);
  });
});

// ---------------------------------------------------------------- registro em lote

describe("selo do registro (Funil) e C5 (motor) concordam num registro às 22h", () => {
  const leads = Array.from({ length: 10 }, () => lead(brt("2026-10-08", "10:00"), { status: "sem_interesse", lostAt: brt("2026-10-08", "22:30") }));
  // 10 status pelo mesmo usuário entre 22:00 e 22:09 de Brasília (01:00–01:09 do dia 09 em UTC).
  const eventos = leads.map((l, i) => evento(l.id, brt("2026-10-08", `22:0${i}`)));
  const data = base({ leads });
  const c5 = (range: { from: string; to: string }) =>
    motorDeAcoes({ data, range, kpis: kpisDoPeriodo(data, range, { hoje: HOJE, agora: AGORA }), eventos, agora: AGORA, hoje: HOJE }).find(
      (a) => a.regra === "C5",
    );

  it("no dia 08 os dois veem o lote; no dia 09, nenhum", () => {
    const selo08 = confiancaDoRegistro(data, DIA_08, eventos);
    expect(selo08.total).toBe(10);
    expect(selo08.emLote).toBe(10);
    expect(c5(DIA_08)).toBeDefined();
    expect(confiancaDoRegistro(data, DIA_09, eventos).total).toBe(0);
    expect(c5(DIA_09)).toBeUndefined();
  });
});

// ---------------------------------------------------------------- metas

describe("taxasObservadas: a janela de 8 semanas em dias de Brasília", () => {
  it("lead às 22h da véspera da janela fica fora; o das 22h de hoje fica dentro", () => {
    // hoje = 08/10 → a janela começa em 14/08 (56 dias).
    const vespera = lead(brt("2026-08-13", "22:00")); // 14/08 01:00 em UTC
    const primeiro = lead(brt("2026-08-14", "10:00"));
    const deHoje = lead(brt("2026-10-08", "22:00")); // 09/10 01:00 em UTC
    const agora = "2026-10-09T01:30:00.000Z";
    const o = taxasObservadas(base({ leads: [vespera, primeiro, deHoje] }), "2026-10-08", agora);
    expect(o.amostra.leads).toBe(2);
    // Cada borda sozinha — o total 2 sairia também com o dia UTC (a véspera dentro, o de hoje fora).
    expect(taxasObservadas(base({ leads: [vespera] }), "2026-10-08", agora).amostra.leads).toBe(0);
    expect(taxasObservadas(base({ leads: [deHoje] }), "2026-10-08", agora).amostra.leads).toBe(1);
  });
});

// ---------------------------------------------------------------- último post

describe("último post: o da grade, no histórico inteiro, em dias de Brasília", () => {
  const agora = "2026-10-07T15:00:00.000Z"; // 12:00 de quarta em Brasília

  it("semana sem post não é 'há 0 dias': conta desde o último post do histórico", () => {
    const posts = [post("P1", "2026-09-28T15:00:00.000Z")];
    const semana = { from: "2026-10-01", to: "2026-10-07" };
    const c = postingCadence(posts, semana, agora);
    expect(c.count).toBe(0);
    expect(c.daysSinceLast).toBe(9);
    expect(c.daysSinceLast).toBe(ultimoPostDaGrade(posts, undefined, agora));
  });

  it("nunca houve post da grade = null (teste e impulsionado não contam)", () => {
    expect(ultimoPostDaGrade([], undefined, agora)).toBeNull();
    expect(postingCadence([], undefined, agora).daysSinceLast).toBeNull();
    const fora = [post("T1", "2026-10-06T15:00:00.000Z", { isTest: true }), post("I1", "2026-10-06T16:00:00.000Z")];
    const creatives = [criativo("AD-1", { instagramMediaId: "I1" })];
    expect(ultimoPostDaGrade(fora, creatives, agora)).toBeNull();
    expect(postingCadence(fora, undefined, agora, creatives).daysSinceLast).toBeNull();
  });

  it("post às 22h de Brasília é do dia em que foi publicado", () => {
    const posts = [post("P1", brt("2026-10-06", "22:00"))]; // 07/10 01:00 em UTC
    expect(ultimoPostDaGrade(posts, undefined, brt("2026-10-07", "10:00"))).toBe(1);
    expect(ultimoPostDaGrade(posts, undefined, brt("2026-10-06", "23:00"))).toBe(0);
    // O maior intervalo também em Brasília: 01/10 22h → 03/10 10h são 2 dias.
    const dois = [post("A", brt("2026-10-01", "22:00")), post("B", brt("2026-10-03", "10:00"))];
    expect(postingCadence(dois, undefined, agora).maxGapDays).toBe(2);
  });

  it("a cadência conta os MESMOS posts do card 'Posts' (um post às 22h na borda do período)", () => {
    // 29/10 22h em Brasília = 30/10 01:00 em UTC: o período dos posts é o da tabela (`dayOf`).
    const posts = [post("borda", brt("2026-10-29", "22:00")), post("meio", brt("2026-11-02", "10:00"))];
    const periodo = { from: "2026-10-30", to: "2026-11-05" };
    const agora = brt("2026-11-05", "15:00");
    const cur = aggregatePostPerformance(postPerformance(posts, periodo, [], []));
    const cad = postingCadence(posts, periodo, agora, []);
    expect(cur.count).toBe(2);
    expect(cad.count).toBe(cur.count);
    // E a borda do outro lado: 05/11 22h (06/11 01:00 UTC) fica fora dos dois.
    const fora = [...posts, post("depois", brt("2026-11-05", "22:00"))];
    expect(postingCadence(fora, periodo, agora, []).count).toBe(aggregatePostPerformance(postPerformance(fora, periodo, [], [])).count);
    // Dentro da janela, o dia continua o de Brasília: a borda (29/10) → 02/11 são 4 dias.
    expect(cad.maxGapDays).toBe(4);
  });

  it("recomendação 'a grade parou': nunca houve post não dispara; 5 dias sem post dispara alta", () => {
    const semPost = buildRecommendations(base(), undefined, agora);
    expect(semPost.find((r) => r.id === "no-recent-post")).toBeUndefined();
    const parado = buildRecommendations(base({ igPosts: [post("P1", "2026-10-02T15:00:00.000Z")] }), undefined, agora);
    expect(parado.find((r) => r.id === "no-recent-post")?.severity).toBe("alta");
  });
});

// ---------------------------------------------------------------- dia futuro

describe("dia depois de hoje é FUTURO: nem 'sem dados' nem 'sem veiculação'", () => {
  const hoje = "2026-11-05";
  const cobertura = [{ from: "2026-10-01", to: "2026-11-03" }];

  it("dailySeries de um período que ainda não começou não marca nada", () => {
    const s = dailySeries(base(), { from: "2026-11-16", to: "2026-11-16" }, cobertura, hoje);
    expect(s).toEqual([expect.objectContaining({ date: "2026-11-16", spend: 0, semDado: false, semVeiculacao: false })]);
  });

  it("dailySeries que passa de hoje: o passado sem cobertura é 'sem dados', o futuro não", () => {
    const s = dailySeries(base({ adDaily: [ad("2026-11-02", 50)] }), { from: "2026-11-02", to: "2026-11-07" }, cobertura, hoje);
    expect(s.map((p) => [p.date, p.semDado, p.semVeiculacao])).toEqual([
      ["2026-11-02", false, false],
      ["2026-11-03", false, true], // coberto, sem linha: pausado
      ["2026-11-04", true, false], // passado sem cobertura: sem dados
      ["2026-11-05", true, false], // hoje ainda é dia que aconteceu
      ["2026-11-06", false, false],
      ["2026-11-07", false, false],
    ]);
  });

  it("coortes: semana que não começou não tem marca; a semana em curso não vira 'sem dados' pelos dias que não chegaram", () => {
    const futuro = coortesDoFunil(base(), { from: "2026-11-16", to: "2026-11-16" }, { agora: "2026-11-05T15:00:00.000Z", hoje, cobertura });
    expect(futuro).toHaveLength(1);
    expect(futuro[0]).toMatchObject({ semana: "2026-11-16", leads: 0, semVeiculacao: false, veiculacao: "ok" });

    const emCurso = coortesDoFunil(
      base(),
      { from: "2026-11-02", to: "2026-11-08" },
      { agora: "2026-11-05T15:00:00.000Z", hoje, cobertura: [{ from: "2026-10-01", to: "2026-11-05" }] },
    );
    expect(emCurso[0]).toMatchObject({ semana: "2026-11-02", semVeiculacao: true, veiculacao: "pausada" });
  });

  it("cohortWeekly: semana que começa depois de hoje não é 'sem veiculação'", () => {
    const data = base({ adDaily: [ad("2026-10-06", 100)], leads: [lead(brt("2026-10-06", "10:00"))] });
    const c = cohortWeekly(data, { from: "2026-10-05", to: "2026-10-25" }, "2026-10-08T15:00:00.000Z");
    expect(c.map((x) => [x.week, x.semVeiculacao])).toEqual([
      ["2026-10-05", false],
      ["2026-10-12", false],
      ["2026-10-19", false],
    ]);
  });

  it("Mídia e motor: o fim da janela é min(fim do período, hoje)", () => {
    expect(fimDoPeriodo({ from: "2026-11-16", to: "2026-11-16" }, hoje)).toBe(hoje);
    expect(fimDoPeriodo({ from: "2026-10-01", to: "2026-10-31" }, hoje)).toBe("2026-10-31");
    expect(fimDoPeriodo(undefined, hoje)).toBe(hoje);
  });

  it("régua de um período que ainda não começou: o alvo fica, o status não (Mídia e Configurações)", () => {
    const meta = (metrica: Meta["metrica"], alvo: number): Meta => ({
      id: `${metrica}-2026-10-01`,
      brand: "consorcio",
      metrica,
      periodo: "semana",
      alvo,
      vigenteDesde: "2026-10-01",
      provisoria: false,
      origem: "manual",
      criadaEm: "2026-10-01T12:00:00.000Z",
      criadaPor: "teste",
    });
    const agora = "2026-11-05T15:00:00.000Z";
    const data = base({
      adDaily: [ad("2026-11-02", 50)],
      metas: [meta("investimento_conversao", 700), meta("leads", 70), meta("reunioes_agendadas", 7)],
    });
    const { range, naoComecou } = pageRange(data, "2026-11-16..2026-12-15", hoje);
    expect(range).toEqual({ from: "2026-11-16", to: "2026-11-16" });
    expect(naoComecou).toBe(true);
    const k = kpisDoPeriodo(data, range, { hoje, agora, cobertura });
    const regua = reguaDoPeriodo(k, data, range, hoje);
    for (const m of ["investimento_conversao", "leads", "reunioes_agendadas"] as const) {
      const l = regua.find((x) => x.metrica === m)!;
      expect(l.alvo, m).toBeGreaterThan(0);
      expect(l.avaliacao, m).toBeUndefined();
    }
    // Mídia: o ritmo mostra o previsto, sem "Abaixo do ritmo (0%)".
    expect(resumoDaMidia(k, regua).ritmo).toMatchObject({ gasto: 0, alvo: 100, avaliacao: undefined });
    // O Funil não leva meta (Fase 3, F3-D11): nada a conferir lá.
    // Um período que já passou, com as mesmas metas, continua julgado (a meta casa).
    const passado = { from: "2026-10-26", to: "2026-11-01" };
    const kp = kpisDoPeriodo(data, passado, { hoje, agora, cobertura });
    expect(reguaDoPeriodo(kp, data, passado, hoje).find((l) => l.metrica === "leads")?.avaliacao?.status).toBe("vermelho");
  });

  it("período futuro não gera a trava 'cobertura-de-dias' (assessTrust não muda)", () => {
    const data = base({ adDaily: [ad("2026-11-02", 50)] });
    const k = kpisDoPeriodo(data, { from: "2026-11-16", to: "2026-11-16" }, { hoje, agora: "2026-11-05T15:00:00.000Z", cobertura });
    expect(k.trust.travas.map((t) => t.id)).not.toContain("cobertura-de-dias");
  });
});

// ---------------------------------------------------------------- importação por CSV

describe("CSV de leads: o instante é gravado com o fuso de Brasília", () => {
  it("data sem hora vira meio-dia de Brasília; hora sem fuso ganha -03:00; com fuso fica como veio", () => {
    expect(instanteDoCsv("2026-10-08")).toBe("2026-10-08T12:00:00-03:00");
    expect(instanteDoCsv("2026-10-08 23:30")).toBe("2026-10-08T23:30:00-03:00");
    expect(instanteDoCsv("2026-10-08T23:30:15.250")).toBe("2026-10-08T23:30:15.250-03:00");
    expect(instanteDoCsv("2026-10-08T23:30:00Z")).toBe("2026-10-08T23:30:00Z");
    expect(instanteDoCsv("2026-10-08T10:00:00-03:00")).toBe("2026-10-08T10:00:00-03:00");
    for (const v of ["2026-10-08", "2026-10-08 23:30", "2026-10-08T00:10"]) expect(diaDoLead(instanteDoCsv(v))).toBe("2026-10-08");
  });

  it("o importador grava o instante com fuso e o id continua saindo da data", () => {
    const csv = ["created_at,nome,whatsapp", "2026-10-08,Pessoa Um,5511999990001", "2026-10-08 23:30,Pessoa Dois,5511999990002"].join("\n");
    const { leads } = parseLeadsCsv(csv);
    expect(leads.map((l) => l.createdAt)).toEqual(["2026-10-08T12:00:00-03:00", "2026-10-08T23:30:00-03:00"]);
    expect(leads.map((l) => l.id)).toEqual(["LEAD-IMP-20261008-0", "LEAD-IMP-20261008-1"]);
    expect(leads.map((l) => diaDoLead(l.createdAt))).toEqual(["2026-10-08", "2026-10-08"]);
  });
});
