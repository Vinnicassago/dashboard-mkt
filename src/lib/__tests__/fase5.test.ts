/**
 * Fase 5 — a Bússola: motor de ações v2, gargalo, placar e semanas. Fixture
 * sintética (nenhum dado real). Datas em UTC; Brasília = UTC−3.
 */
import { describe, expect, it } from "vitest";
import { kpisDoPeriodo, serieSemanal, type KpisDoPeriodo } from "../kpis";
import { montarBussola } from "../bussola";
import { motorDeAcoes, resumoDasAcoes, semanaDaAcao, type Acao } from "../motor";
import { gargalo, impactoEstimado, textoDoImpacto, transicoesDoFunil, type Transicao } from "../gargalo";
import { montarPlacar } from "../placar";
import { diasDoPeriodo, janelaAnterior, segundaDaSemana, semanaAnteriorFechada, ultimasSemanas } from "../semana";
import { buildBriefing } from "../ai/briefing";
import { formatCurrency, formatCurrency0 } from "../format";
import type { AcaoEstado, AdDaily, Creative, DashboardData, Lead, LeadEvent, LpDaily, Meta } from "../types";

// ---------------------------------------------------------------- fixtures

const HOJE = "2026-10-08"; // quinta
const AGORA = "2026-10-08T15:00:00.000Z"; // 12:00 em Brasília
const SEMANA = { from: "2026-10-02", to: "2026-10-08" };
/** Todo dia de setembro e outubro coberto por sync: nenhum dia vira "sem dados". */
const COBERTURA = [{ from: "2026-08-01", to: "2026-10-08" }];

const brt = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();

const ad = (date: string, adId: string, spend: number, extra: Partial<AdDaily> = {}): AdDaily => ({
  brand: "consorcio",
  date,
  campaign: "Campanha",
  adset: "Conjunto A",
  adId,
  objective: "OUTCOME_LEADS",
  spend,
  impressions: 1000,
  reach: 800,
  frequency: 1.2,
  clicks: 50,
  leads: 1,
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
  utmContent: "Anúncio A|100001",
  ...extra,
});

/** N leads encerrados (fora da Fila), num dia. */
const leadsEncerrados = (n: number, dia: string, extra: Partial<Lead> = {}): Lead[] =>
  Array.from({ length: n }, () => lead(dia, { status: "sem_interesse", lostAt: `${dia}T18:00:00.000Z`, ...extra }));

const criativo = (adId: string, name: string): Creative => ({ adId, brand: "consorcio", name, format: "imagem" });

const lp = (date: string, visits: number, formSubmits: number): LpDaily => ({ brand: "consorcio", date, visits, clicks: Math.round(visits / 2), formSubmits });

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

function base(over: Partial<DashboardData> = {}): DashboardData {
  return {
    campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-08-01", budgetTotal: 5000 },
    igAccountDaily: [],
    igPosts: [],
    adDaily: [],
    creatives: [criativo("100001", "Anúncio A")],
    lpDaily: [],
    leads: [],
    goals: [],
    metas: [],
    updatedAt: AGORA,
    ...over,
  };
}

const kpisDe = (data: DashboardData, range = SEMANA as { from: string; to: string } | undefined, extra = {}) =>
  kpisDoPeriodo(data, range, { hoje: HOJE, agora: AGORA, cobertura: COBERTURA, comparar: true, ...extra });

const rodar = (data: DashboardData, opts: Partial<Parameters<typeof motorDeAcoes>[0]> = {}, range = SEMANA as { from: string; to: string } | undefined) =>
  motorDeAcoes({ data, range, kpis: kpisDe(data, range), eventos: [], agora: AGORA, hoje: HOJE, ...opts });

const regra = (acoes: Acao[], id: string) => acoes.find((a) => a.regra === id);

// ---------------------------------------------------------------- semanas

describe("semanas da Bússola (segunda a domingo, Brasília)", () => {
  it("segunda-feira da semana de qualquer dia", () => {
    expect(segundaDaSemana("2026-10-08")).toBe("2026-10-05"); // quinta
    expect(segundaDaSemana("2026-10-11")).toBe("2026-10-05"); // domingo
    expect(segundaDaSemana("2026-10-05")).toBe("2026-10-05"); // a própria segunda
    expect(semanaDaAcao("2026-10-08")).toBe("2026-10-05");
  });
  it("a semana fechada anterior é segunda a domingo — também numa segunda de manhã", () => {
    expect(semanaAnteriorFechada("2026-10-08")).toEqual({ semana: "2026-09-28", from: "2026-09-28", to: "2026-10-04" });
    expect(semanaAnteriorFechada("2026-10-05")).toEqual({ semana: "2026-09-28", from: "2026-09-28", to: "2026-10-04" });
  });
  it("últimas N semanas terminam na semana de hoje", () => {
    expect(ultimasSemanas("2026-10-08", 3).map((s) => s.semana)).toEqual(["2026-09-21", "2026-09-28", "2026-10-05"]);
    expect(diasDoPeriodo(SEMANA)).toBe(7);
    expect(janelaAnterior(SEMANA, 28)).toEqual({ from: "2026-09-04", to: "2026-10-01" });
  });
});

describe("tendência semanal: os mesmos números do placar, semana a semana", () => {
  const data = base({
    leads: [
      lead("2026-09-22", { status: "agendado", bookedAt: "2026-09-23T12:00:00.000Z" }),
      lead("2026-10-01", { status: "agendado", bookedAt: "2026-10-06T12:00:00.000Z" }),
      lead("2026-10-06"),
    ],
  });
  it("10 pontos, a semana corrente marcada como incompleta, reuniões pela data do agendamento", () => {
    const s = serieSemanal(data, HOJE, 10);
    expect(s).toHaveLength(10);
    expect(s.at(-1)).toMatchObject({ semana: "2026-10-05", reunioesAgendadas: 1, leads: 1, incompleta: true });
    expect(s.find((p) => p.semana === "2026-09-21")?.reunioesAgendadas).toBe(1);
    expect(s.find((p) => p.semana === "2026-09-28")?.reunioesAgendadas).toBe(0);
    for (const p of s) expect(p.reunioesAgendadas).toBe(kpisDoPeriodo(data, { from: p.semana, to: ultimasSemanas(HOJE, 10).find((x) => x.semana === p.semana)!.to }).reunioesAgendadas.valor);
  });
});

// ---------------------------------------------------------------- gargalo

describe("onde trava: transições com dono e o gargalo", () => {
  // 50 leads na semana, 1 agendou; 20 com 1º contato no prazo; LP com 1.000 visitas.
  const leads = [
    ...Array.from({ length: 20 }, () => lead("2026-10-05", { status: "em_contato", firstContactAt: "2026-10-05T13:20:00.000Z" })),
    ...leadsEncerrados(29, "2026-10-05"),
    lead("2026-10-05", { status: "agendado", bookedAt: "2026-10-06T12:00:00.000Z", meetingFor: "2026-10-20T12:00:00.000Z", firstContactAt: "2026-10-05T13:10:00.000Z" }),
  ];
  const data = base({
    // Em setembro (a janela da média): 2.000 visitas e 200 leads = 10%.
    leads: [...leads, ...leadsEncerrados(200, "2026-09-10")],
    lpDaily: [lp("2026-10-05", 1000, 60), lp("2026-09-10", 2000, 200)],
    adDaily: [ad("2026-10-05", "100001", 500)],
    metas: [meta("taxa_lead_agendada", 0.1), meta("primeiro_contato_no_prazo", 0.9)],
  });
  const k = kpisDe(data);
  const t = transicoesDoFunil(data, SEMANA, k, { agora: AGORA, hoje: HOJE });
  const porId = Object.fromEntries(t.map((x) => [x.id, x])) as Record<Transicao["id"], Transicao>;

  it("cada transição tem dono, entradas, saídas e a régua certa (meta ou média de 8 semanas)", () => {
    expect(t.map((x) => x.id)).toEqual(["impressao_visita", "visita_lead", "lead_contato", "lead_agendada", "agendada_realizada"]);
    expect(porId.lead_agendada).toMatchObject({ dono: "COM", entradas: 50, saidas: 1, metrica: "taxa_lead_agendada" });
    expect(porId.lead_agendada.referencia).toMatchObject({ taxa: 0.1, origem: "meta" });
    expect(porId.lead_agendada.razao).toBeCloseTo(0.2, 6);
    expect(porId.lead_contato.referencia).toMatchObject({ taxa: 0.9, origem: "meta" });
    expect(porId.lead_contato.taxa).toBeCloseTo(1, 6);
    // Visita → lead não tem meta: a média das 8 semanas anteriores vira a régua, e o rótulo diz isso.
    expect(porId.visita_lead.referencia).toMatchObject({ origem: "media8s", taxa: 0.1 });
    expect(porId.agendada_realizada.taxa).toBeNull(); // nenhuma reunião com data passada: sem amostra
  });

  it("o gargalo é a menor razão taxa ÷ régua, com o impacto inteiro em reuniões por semana", () => {
    const g = gargalo(t, SEMANA)!;
    expect(g.transicao.id).toBe("lead_agendada");
    // 50 leads × (10% − 2%) = 4 reuniões a mais na semana.
    expect(g.impacto).toMatchObject({ porSemana: 4, noPeriodo: 4, unidade: "reunioes_agendadas" });
  });

  it("abaixo de 10 entradas a taxa não aparece nem concorre a gargalo", () => {
    const pouco = base({ leads: leadsEncerrados(9, "2026-10-05"), metas: [meta("taxa_lead_agendada", 0.1)] });
    const tt = transicoesDoFunil(pouco, SEMANA, kpisDe(pouco), { agora: AGORA, hoje: HOJE });
    expect(tt.find((x) => x.id === "lead_agendada")?.taxa).toBeNull();
    expect(gargalo(tt, SEMANA)).toBeNull();
  });

  it("reproduz o exemplo do relatório: 113 leads em 72 dias a 0,9% contra 10% ≈ 11 reuniões, 1 por semana", () => {
    const relatorio: Transicao = {
      id: "lead_agendada",
      rotulo: "Lead → Agendada",
      dono: "COM",
      entradas: 113,
      saidas: 1,
      taxa: 1 / 113,
      referencia: { taxa: 0.1, origem: "meta" },
      razao: 1 / 113 / 0.1,
      href: "/jornada",
    };
    const { impacto } = impactoEstimado([relatorio], relatorio, { from: "2026-07-27", to: "2026-10-06" });
    expect(impacto?.noPeriodo).toBe(10);
    expect(impacto?.porSemana).toBe(1);
  });

  it("o impacto compõe as taxas seguintes até 'agendada' (meta quando a real é 0)", () => {
    const visita: Transicao = { id: "visita_lead", rotulo: "Visita → Lead", dono: "LP", entradas: 700, saidas: 14, taxa: 0.02, referencia: { taxa: 0.05, origem: "media8s" }, razao: 0.4, href: "/jornada" };
    const agendada: Transicao = { id: "lead_agendada", rotulo: "Lead → Agendada", dono: "COM", entradas: 14, saidas: 0, taxa: 0, referencia: { taxa: 0.1, origem: "meta" }, razao: 0, href: "/jornada" };
    // 700 × 0,03 × 0,10 (a meta, porque a real é 0) = 2,1 reuniões na semana.
    expect(impactoEstimado([visita, agendada], visita, SEMANA).impacto).toMatchObject({ porSemana: 2 });
    expect(impactoEstimado([visita, agendada], visita, SEMANA).impacto?.unidade).toBe("reunioes_agendadas");
  });

  it("LP com histórico mas sem linha no período: as duas transições saem (não viram 0%) e não há gargalo inventado", () => {
    const parou = base({
      leads: [...leadsEncerrados(49, "2026-10-05"), lead("2026-10-05", { status: "agendado", bookedAt: "2026-10-06T12:00:00.000Z", meetingFor: "2026-11-01T12:00:00.000Z" })],
      lpDaily: [lp("2026-09-10", 2000, 200)],
      adDaily: [ad("2026-10-05", "100001", 500)],
      metas: [meta("taxa_lead_agendada", 0.1)],
    });
    const tt = transicoesDoFunil(parou, SEMANA, kpisDe(parou), { agora: AGORA, hoje: HOJE });
    expect(tt.map((x) => x.id)).toEqual(["lead_contato", "lead_agendada", "agendada_realizada"]);
    expect(gargalo(tt, SEMANA)?.transicao.id).toBe("lead_agendada");
  });

  it("o texto do impacto respeita a unidade (reuniões realizadas no comparecimento)", () => {
    const t: Transicao = { id: "agendada_realizada", rotulo: "Agendada → Realizada", dono: "ESP", entradas: 20, saidas: 8, taxa: 0.4, referencia: { taxa: 0.7, origem: "meta" }, razao: 0.4 / 0.7, href: "/fila" };
    const g = gargalo([t], SEMANA)!;
    expect(g.impacto).toMatchObject({ porSemana: 6, unidade: "reunioes_realizadas" });
    expect(textoDoImpacto(g)).toBe("+6 reuniões realizadas por semana se batesse a meta");
  });

  it("campanha inteira: só metas servem de régua (não há 'antes' para a média)", () => {
    const tt = transicoesDoFunil(data, undefined, kpisDe(data, undefined), { agora: AGORA, hoje: HOJE });
    expect(tt.find((x) => x.id === "visita_lead")?.referencia).toBeUndefined();
    expect(tt.find((x) => x.id === "lead_agendada")?.referencia?.origem).toBe("meta");
  });
});

// ---------------------------------------------------------------- motor v2

describe("motor v2 — cada regra dispara pelo seu gatilho, com dono e amostra", () => {
  it("C1: lead Novo além de 1 hora útil é a ação nº 1, com a Fila certa e as reuniões recuperáveis", () => {
    const data = base({
      leads: [lead(brt("2026-10-08", "09:00")), lead(brt("2026-10-08", "10:30")), lead(brt("2026-10-08", "11:30"))],
      metas: [meta("taxa_lead_agendada", 0.5)],
    });
    const acoes = rodar(data);
    const c1 = acoes[0];
    expect(c1.regra).toBe("C1");
    expect(c1.amostra.n).toBe(2); // o das 11h30 ainda está no prazo
    expect(c1.href).toBe("/fila?etapa=novo");
    expect(c1.severidade).toBe("agora");
    expect(c1.impacto).toMatchObject({ valor: 1, unidade: "reunioes" });
    // Com o robô ligado e gente transferida sem abordagem, a Fila abre inteira.
    const comRobo = rodar(data, {
      robo: {
        convites: [],
        comercial: [{ session_id: "s1", nome: "X", telefone: "5511999990000", email: null, score: 8, transferido_em: brt("2026-10-07", "09:00"), abordado_em: null, briefing: null }],
      },
    });
    expect(comRobo[0]).toMatchObject({ regra: "C1", href: "/fila" });
    expect(comRobo[0].amostra.n).toBe(3);
  });

  it("C1 não dispara sem ninguém além do prazo", () => {
    const data = base({ leads: [lead(brt("2026-10-08", "11:30"))] });
    expect(regra(rodar(data), "C1")).toBeUndefined();
  });

  it("C2: 1º contato no prazo abaixo da meta, com a mediana e a severidade pelo tamanho do buraco", () => {
    const leads = Array.from({ length: 10 }, (_, i) =>
      lead("2026-10-05", { status: "em_contato", firstContactAt: i < 2 ? "2026-10-05T13:30:00.000Z" : "2026-10-06T14:00:00.000Z" }),
    );
    const data = base({ leads, metas: [meta("primeiro_contato_no_prazo", 0.9)] });
    const c2 = regra(rodar(data), "C2")!;
    expect(c2.titulo).toMatch(/Só 20% dos leads tiveram 1º contato em até 1 h útil \(meta 90%\)/);
    expect(c2.severidade).toBe("alta");
    expect(c2.dono).toBe("COM");
    expect(c2.semImpacto).toBeDefined();
    // Sem meta não há régua — a regra não dispara (G1 cobra a meta).
    expect(regra(rodar(base({ leads })), "C2")).toBeUndefined();
  });

  it("C3: lead → agendada das 8 semanas abaixo de 80% da meta, com ≥ 20 leads e o impacto inteiro", () => {
    // 160 leads em setembro, 4 agendaram (2,5%) contra meta de 10%: 20 leads/semana × 7,5% = 1,5 → "2 reuniões".
    const leads = [
      ...leadsEncerrados(156, "2026-09-15"),
      ...Array.from({ length: 4 }, () => lead("2026-09-15", { status: "agendado", bookedAt: "2026-09-16T12:00:00.000Z", meetingFor: "2026-11-01T12:00:00.000Z" })),
    ];
    const data = base({ leads, metas: [meta("taxa_lead_agendada", 0.1)] });
    const c3 = regra(rodar(data), "C3")!;
    expect(c3.titulo).toMatch(/Lead → agendada em 2,5% contra meta de 10%: cerca de 2 reuniões a menos por semana/);
    expect(c3.impacto).toMatchObject({ valor: 2, unidade: "reunioes_semana" });
    expect(c3.amostra).toEqual({ n: 160, minimo: 20 });
    // Com 19 leads não há amostra.
    const pouco = base({ leads: leadsEncerrados(19, "2026-09-15"), metas: [meta("taxa_lead_agendada", 0.1)] });
    expect(regra(rodar(pouco), "C3")).toBeUndefined();
  });

  it("C4: reunião com data passada sem desfecho, com a data", () => {
    const data = base({ leads: [lead("2026-09-30", { status: "agendado", bookedAt: "2026-10-01T12:00:00.000Z", meetingFor: "2026-10-06T15:00:00.000Z" })] });
    const c4 = regra(rodar(data), "C4")!;
    expect(c4.titulo).toMatch(/1 reunião com data passada sem registro de comparecimento \(06\/10\)/);
    expect(c4.href).toBe("/fila?etapa=sem-desfecho");
  });

  it("C5: registro em lote (10 status em 15 min pelo mesmo usuário) — e rebaixa a confiança das taxas do comercial", () => {
    const leads = leadsEncerrados(12, "2026-10-02");
    const eventos = leads.map((l, i) => evento(l.id, `2026-10-07T14:${String(i).padStart(2, "0")}:00.000Z`));
    const comContato = Array.from({ length: 10 }, () => lead("2026-10-05", { status: "em_contato", firstContactAt: "2026-10-06T14:00:00.000Z" }));
    const data = base({ leads: [...leads, ...comContato], metas: [meta("primeiro_contato_no_prazo", 0.9)] });
    const acoes = rodar(data, { eventos });
    const c5 = regra(acoes, "C5")!;
    expect(c5.titulo).toMatch(/subnotificado: 12 status registrados em lote/);
    expect(c5.dono).toBe("GESTAO");
    expect(regra(acoes, "C2")?.confianca).toBe("media");
    // Sem o lote, a confiança de C2 volta a ser alta.
    expect(regra(rodar(data), "C2")?.confianca).toBe("alta");
  });

  it("C5: ≥ 30% dos status registrados mais de 72 h depois da entrada", () => {
    const leads = leadsEncerrados(10, "2026-09-20");
    const eventos = leads.map((l, i) => evento(l.id, `2026-10-0${(i % 5) + 2}T1${i}:00:00.000Z`, { actor: `u${i}` }));
    const c5 = regra(rodar(base({ leads }), { eventos }), "C5")!;
    expect(c5.titulo).toMatch(/100% dos status do período foram registrados mais de 72 h depois da entrada/);
  });

  it("M1: CPL acima do alvo (com impacto em R$/semana) ou acima de 120% da média de 4 semanas", () => {
    const leadsSemana = leadsEncerrados(10, "2026-10-05");
    const comAlvo = base({ adDaily: [ad("2026-10-05", "100001", 900)], leads: leadsSemana, metas: [meta("cpl", 50)] });
    const m1 = regra(rodar(comAlvo), "M1")!;
    expect(m1.titulo).toMatch(/CPL de R\$\s90,00 contra alvo de R\$\s50,00 \(\+80%\)/);
    expect(m1.severidade).toBe("alta");
    expect(m1.impacto).toMatchObject({ valor: 400, unidade: "reais_semana" });
    expect(m1.confianca).toBe("alta");
    // Sem alvo: a média das 4 semanas anteriores (R$ 28) é a régua.
    const semAlvo = base({
      adDaily: [ad("2026-10-05", "100001", 900), ...Array.from({ length: 28 }, (_, i) => ad(`2026-09-${String(i + 4).padStart(2, "0")}`.slice(0, 10), "100001", 100))].filter((r) => r.date <= "2026-10-01" || r.date === "2026-10-05"),
      leads: [...leadsSemana, ...leadsEncerrados(100, "2026-09-10")],
    });
    const m1b = regra(rodar(semAlvo), "M1")!;
    expect(m1b.titulo).toMatch(/contra a média de 4 semanas/);
    // Dentro do alvo não dispara.
    expect(regra(rodar(base({ adDaily: [ad("2026-10-05", "100001", 400)], leads: leadsSemana, metas: [meta("cpl", 50)] })), "M1")).toBeUndefined();
    // Média de 4 semanas com gasto zero (sync que começou depois) não é régua: nada de "+∞%".
    const mediaZero = base({ adDaily: [ad("2026-10-05", "100001", 900)], leads: [...leadsSemana, ...leadsEncerrados(100, "2026-09-10")] });
    expect(regra(rodar(mediaZero), "M1")).toBeUndefined();
  });

  it("D1 (dias sem gasto): sync cobriu, campanha ativa e nenhuma linha em 2+ dias → verba parada", () => {
    const data = base({ adDaily: [ad("2026-10-02", "100001", 100), ad("2026-10-03", "100001", 100)] });
    const acoes = motorDeAcoes({ data, range: SEMANA, kpis: kpisDe(data), eventos: [], agora: AGORA, hoje: HOJE, cobertura: COBERTURA });
    expect(regra(acoes, "D1")?.titulo).toMatch(/4 dias do período sem nenhum gasto, com a campanha ativa/);
    // Campanha pausada: não é anomalia.
    const pausada = base({ ...data, campaign: { ...data.campaign, status: "pausada" } });
    expect(regra(motorDeAcoes({ data: pausada, range: SEMANA, kpis: kpisDe(pausada), eventos: [], agora: AGORA, hoje: HOJE, cobertura: COBERTURA }), "D1")).toBeUndefined();
  });

  it("M2: custo por reunião acima do alvo só com 3 reuniões ou mais — abaixo disso a tela esconde e o motor não decide", () => {
    const tres = Array.from({ length: 3 }, () => lead("2026-10-05", { status: "agendado", bookedAt: "2026-10-06T12:00:00.000Z", meetingFor: "2026-11-01T12:00:00.000Z" }));
    const data = base({ adDaily: [ad("2026-10-05", "100001", 900)], leads: tres, metas: [meta("custo_por_reuniao", 168)] });
    const m2 = regra(rodar(data), "M2")!;
    expect(m2.titulo).toMatch(/Custo por reunião de R\$\s300,00 contra alvo de R\$\s168,00/);
    expect(m2.detalhe).toMatch(/Conjunto A/);
    const duas = base({ ...data, leads: tres.slice(0, 2) });
    expect(regra(rodar(duas), "M2")).toBeUndefined();
  });

  it("M3: criativo fadigado (CTR caindo + CPL subindo) — renove ou pause", () => {
    const dias = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"];
    const rows = dias.map((d, i) => ad(d, "100001", 100, i < 3 ? { clicks: 100, leads: 10 } : { clicks: 50, leads: 4 }));
    const data = base({ adDaily: rows });
    const m3 = regra(rodar(data), "M3")!;
    expect(m3.id).toBe("M3:100001");
    expect(m3.titulo).toMatch(/Renove a arte de “Anúncio A”/);
    expect(m3.detalhe).toMatch(/CTR caindo · CPL subindo/);
  });

  it("M4: conjunto com mais de 25% de contatos inválidos em 10 leads ou mais", () => {
    const leads = [
      ...Array.from({ length: 4 }, () => lead("2026-10-05", { status: "contato_invalido", lostAt: "2026-10-05T18:00:00.000Z" })),
      ...leadsEncerrados(8, "2026-10-05"),
    ];
    const data = base({ adDaily: [ad("2026-10-05", "100001", 100)], leads });
    const m4 = regra(rodar(data), "M4")!;
    expect(m4.titulo).toMatch(/Conjunto “Conjunto A”: 33% de contatos inválidos — revisar formulário e segmentação/);
    expect(m4.amostra).toEqual({ n: 12, minimo: 10 });
  });

  it("M5: mais de 30% da verba em descoberta sem meta de seguidores ou alcance", () => {
    const data = base({
      adDaily: [ad("2026-10-05", "100001", 500), ad("2026-10-05", "200002", 500, { objective: "OUTCOME_ENGAGEMENT", adset: "Descoberta" })],
      creatives: [criativo("100001", "Anúncio A"), criativo("200002", "Reel")],
    });
    expect(regra(rodar(data), "M5")?.titulo).toMatch(/50% da verba \(R\$\s500\) em descoberta, sem meta/);
    const comMeta = base({ ...data, goals: [{ brand: "consorcio", metric: "followers", period: "campanha", target: 1000 }] });
    expect(regra(rodar(comMeta), "M5")).toBeUndefined();
  });

  it("M6 (além do relatório): escalar o vencedor só com 3 reuniões e sem fadiga; M7: verba fora do ritmo", () => {
    const tres = Array.from({ length: 3 }, () => lead("2026-10-05", { status: "agendado", bookedAt: "2026-10-06T12:00:00.000Z", meetingFor: "2026-11-01T12:00:00.000Z" }));
    const data = base({ adDaily: [ad("2026-10-05", "100001", 2000)], leads: tres, metas: [meta("investimento_conversao", 1000)] });
    const acoes = rodar(data);
    expect(regra(acoes, "M6")).toMatchObject({ severidade: "baixa", id: "M6:100001" });
    expect(regra(acoes, "M7")?.titulo).toMatch(/Verba de conversão acima do ritmo: R\$\s2\.000 contra R\$\s1\.000 previstos \(200%\)/);
  });

  it("L1: visita → lead abaixo de 80% da média de 4 semanas, com 100 visitas de amostra", () => {
    const data = base({
      lpDaily: [lp("2026-10-05", 500, 5), lp("2026-09-15", 2000, 100)],
      leads: leadsEncerrados(5, "2026-10-05"),
      metas: [meta("taxa_lead_agendada", 0.5)],
    });
    const l1 = regra(rodar(data), "L1")!;
    expect(l1.titulo).toMatch(/Visita → lead caiu para 1,0% \(média de 4 semanas: 5,0%\)/);
    expect(l1.dono).toBe("LP");
    // 500 visitas × (5% − 1%) × 50% = 10 reuniões a mais por semana.
    expect(l1.impacto).toMatchObject({ valor: 10, unidade: "reunioes_semana" });
  });

  it("L2: envios da LP e leads do painel divergindo mais de 15%", () => {
    const data = base({ lpDaily: [lp("2026-10-05", 500, 40)], leads: leadsEncerrados(30, "2026-10-05") });
    const l2 = regra(rodar(data), "L2")!;
    expect(l2.titulo).toMatch(/registrou 40 envios e o painel 30 leads \(−25%\)/);
    expect(l2.dono).toBe("DADOS");
    expect(regra(rodar(base({ lpDaily: [lp("2026-10-05", 500, 32)], leads: leadsEncerrados(30, "2026-10-05") })), "L2")).toBeUndefined();
  });

  it("D1: sync falhando (alta) ou dias sem dados (média); D2: gasto sem marca", () => {
    const d1 = regra(rodar(base(), { fontes: { adsFalha: { desde: "2026-10-06T09:00:00.000Z", erro: "A Meta recusou o token." } } }), "D1")!;
    expect(d1.titulo).toMatch(/falhando desde 06\/10/);
    expect(d1.severidade).toBe("alta");
    // Sem cobertura de sync, os dias sem linha do período viram "sem dados" (piso): D1 média.
    const buraco = base({ adDaily: [ad("2026-10-02", "100001", 100)] });
    const semCobertura = motorDeAcoes({ data: buraco, range: SEMANA, kpis: kpisDoPeriodo(buraco, SEMANA, { hoje: HOJE, agora: AGORA }), eventos: [], agora: AGORA, hoje: HOJE });
    expect(regra(semCobertura, "D1")).toMatchObject({ severidade: "media", dono: "DADOS" });
    expect(regra(rodar(base(), { fontes: { gastoSemMarca: 735 } }), "D2")?.titulo).toMatch(/R\$\s735 de gasto sem marca classificada/);
  });

  it("G1: sem metas (alta) ou sem orçamento de conversão (média)", () => {
    expect(regra(rodar(base()), "G1")).toMatchObject({ severidade: "alta", href: "/config#metas", dono: "GESTAO" });
    const comMeta = base({ metas: [meta("reunioes_agendadas", 7)], campaign: { ...base().campaign, budgetTotal: 0 } });
    expect(regra(rodar(comMeta), "G1")?.severidade).toBe("media");
    const completo = base({ metas: [meta("reunioes_agendadas", 7), meta("investimento_conversao", 1000)] });
    expect(regra(rodar(completo), "G1")).toBeUndefined();
  });
});

describe("motor v2 — ordem, impacto e estado por semana", () => {
  // C1 (gente parada) + M1 (alta, com impacto) + M4 (alta, sem impacto) + M5 (média).
  const data = base({
    adDaily: [ad("2026-10-05", "100001", 1200), ad("2026-10-05", "200002", 600, { objective: "OUTCOME_ENGAGEMENT", adset: "Descoberta" })],
    creatives: [criativo("100001", "Anúncio A"), criativo("200002", "Reel")],
    leads: [
      lead(brt("2026-10-08", "09:00")),
      ...Array.from({ length: 4 }, () => lead("2026-10-05", { status: "contato_invalido", lostAt: "2026-10-05T18:00:00.000Z" })),
      ...leadsEncerrados(8, "2026-10-05"),
    ],
    // O alvo de custo por reunião converte o impacto em R$ de M1 para reuniões (a ordenação compara).
    metas: [meta("cpl", 50), meta("custo_por_reuniao", 168)],
  });

  it("C1 vem primeiro sempre; depois severidade × impacto × confiança", () => {
    const acoes = rodar(data);
    expect(acoes[0].regra).toBe("C1");
    const resto = acoes.slice(1);
    for (let i = 1; i < resto.length; i++) expect(resto[i - 1].prioridade).toBeGreaterThanOrEqual(resto[i].prioridade);
    // M1 (alta, com impacto) à frente de M4 (alta, sem impacto) e de M5 (média).
    const ordem = resto.map((a) => a.regra);
    expect(ordem.indexOf("M1")).toBeGreaterThanOrEqual(0);
    expect(ordem.indexOf("M1")).toBeLessThan(ordem.indexOf("M4"));
    expect(ordem.indexOf("M4")).toBeLessThan(ordem.indexOf("M5"));
  });

  it("todo impacto é inteiro, e sem amostra o rótulo diz 'estimativa indisponível'", () => {
    for (const a of rodar(data)) {
      if (a.impacto) expect(Number.isInteger(a.impacto.valor)).toBe(true);
      else expect(a.semImpacto).toMatch(/estimativa indisponível|já está/);
    }
  });

  it("feita/ignorada vale a semana (a última decisão por ação), vai para o fim da lista e 'reaberta' volta", () => {
    const estado = (acao: string, estado: AcaoEstado["estado"], em: string, motivo?: string): AcaoEstado => ({
      id: `${acao}-${em}`,
      brand: "consorcio",
      semana: "2026-10-05",
      acao,
      estado,
      motivo,
      titulo: "x",
      por: "ana",
      em,
    });
    // O id da C1 carrega QUEM está esperando: "feita" vale para estas pessoas.
    const c1Id = rodar(data)[0].id;
    expect(c1Id).toMatch(/^C1:/);
    const acoes = rodar(data, {
      estados: [estado(c1Id, "feita", "2026-10-06T10:00:00.000Z"), estado("M1", "ignorada", "2026-10-06T11:00:00.000Z", "verba já cortada"), estado("M1", "reaberta", "2026-10-07T09:00:00.000Z")],
    });
    expect(acoes[0].regra).not.toBe("C1");
    expect(acoes.at(-1)).toMatchObject({ regra: "C1", estado: { estado: "feita", por: "ana" } });
    expect(regra(acoes, "M1")?.estado).toBeUndefined(); // reaberta depois de ignorada
    expect(acoes.filter((a) => !a.estado).length).toBe(acoes.length - 1);
  });

  it("C1 'feita' na segunda não esconde quem passou do prazo na terça: pessoas novas = ação nova, de volta ao topo", () => {
    const c1Id = rodar(data)[0].id;
    const feita: AcaoEstado = { id: "x", brand: "consorcio", semana: "2026-10-05", acao: c1Id, estado: "feita", titulo: "x", por: "ana", em: "2026-10-06T10:00:00.000Z" };
    const maisGente = base({ ...data, leads: [...data.leads, lead(brt("2026-10-08", "09:30"))] });
    const acoes = rodar(maisGente, { estados: [feita] });
    expect(acoes[0].regra).toBe("C1");
    expect(acoes[0].estado).toBeUndefined();
    expect(acoes[0].id).not.toBe(c1Id);
    expect(acoes[0].amostra.n).toBe(2);
    expect(acoes[0].detalhe).toMatch(/A Fila mostra 2 esperando o 1º contato; 2 já passaram do prazo/);
  });

  it("confiança cai com piso de gasto (mídia) e com sync falhando", () => {
    const buraco = base({ ...data, adDaily: data.adDaily });
    const semCobertura = motorDeAcoes({ data: buraco, range: SEMANA, kpis: kpisDoPeriodo(buraco, SEMANA, { hoje: HOJE, agora: AGORA }), eventos: [], agora: AGORA, hoje: HOJE });
    expect(regra(semCobertura, "M1")?.confianca).toBe("media");
    const falhando = rodar(data, { fontes: { adsFalha: { desde: AGORA, erro: "x" } } });
    expect(regra(falhando, "M1")?.confianca).toBe("baixa");
  });

  it("campanha inteira também roda (sem 'antes' para as médias)", () => {
    const acoes = rodar(data, {}, undefined);
    expect(acoes[0].regra).toBe("C1");
    expect(regra(acoes, "L1")).toBeUndefined();
  });

  it("resumo para a IA: regra, dono, severidade, título e estado", () => {
    const r = resumoDasAcoes(rodar(data));
    expect(r[0]).toMatchObject({ regra: "C1", dono: "COM", severidade: "agora" });
    expect(r.every((x) => typeof x.titulo === "string" && x.titulo.length > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------- placar

describe("placar — o veredito contra a meta, e o custo como fato", () => {
  const placarDe = (data: DashboardData, range = SEMANA as { from: string; to: string } | undefined, extra: Partial<Parameters<typeof kpisDe>[2]> = {}) => {
    const k = kpisDe(data, range, extra);
    return montarBussola({ data, range, kpis: k, eventos: [], agora: AGORA, hoje: HOJE }).placar;
  };

  it("FORA DO RITMO: 0 de 7 reuniões agendadas na semana, com o fato no lugar do custo", () => {
    const p = placarDe(base({ adDaily: [ad("2026-10-05", "100001", 160)], metas: [meta("reunioes_agendadas", 7)] }));
    expect(p).toMatchObject({ estado: "fora", verbo: "FORA DO RITMO", frase: "0 de 7 reuniões agendadas na semana" });
    expect(p.custo).toBe(`${formatCurrency0(160)} investidos em conversão · 0 reuniões de conversão`);
    expect(p.campanha).toMatch(/^Campanha: R\$\s160 investidos · 0 reuniões de conversão · 0 agendadas$/);
    expect(p.comparecimento).toMatchObject({ texto: "—", motivo: "nenhuma reunião com data passada no período" });
  });

  it("NO RITMO e PERTO DO RITMO seguem a régua (verde ≥ 100%, âmbar 80–99%)", () => {
    const sete = Array.from({ length: 7 }, () => lead("2026-10-05", { status: "agendado", bookedAt: "2026-10-06T12:00:00.000Z", meetingFor: "2026-11-01T12:00:00.000Z" }));
    expect(placarDe(base({ leads: sete, metas: [meta("reunioes_agendadas", 7)] })).verbo).toBe("NO RITMO");
    expect(placarDe(base({ leads: sete.slice(0, 6), metas: [meta("reunioes_agendadas", 7)] })).verbo).toBe("PERTO DO RITMO");
  });

  it("sem meta: SEM META com o link para cadastrar; meta que começa no meio do período não julga", () => {
    const semMeta = placarDe(base());
    expect(semMeta).toMatchObject({ estado: "sem-meta", verbo: "SEM META", acao: { href: "/config#metas" } });
    expect(semMeta.frase).toMatch(/sem meta para comparar/);
    const parcial = placarDe(base({ metas: [meta("reunioes_agendadas", 7, "2026-10-05")] }));
    expect(parcial.estado).toBe("sem-meta");
    expect(parcial.motivo).toMatch(/a meta vale só a partir de 05\/10/);
  });

  it("SEM LEITURA quando as fontes discordam — nunca 'no ritmo' por silêncio", () => {
    const data = base({ adDaily: [ad("2026-10-05", "100001", 160)], metas: [meta("reunioes_agendadas", 7)] });
    const p = placarDe(data, undefined, { roboReunioes: 3 });
    expect(p).toMatchObject({ estado: "sem-dado", verbo: "SEM LEITURA" });
    expect(p.motivo).toBeDefined();
  });

  it("com 3 reuniões de conversão o custo por reunião aparece, com o n", () => {
    const tres = Array.from({ length: 3 }, () => lead("2026-10-05", { status: "agendado", bookedAt: "2026-10-06T12:00:00.000Z", meetingFor: "2026-11-01T12:00:00.000Z" }));
    const p = placarDe(base({ adDaily: [ad("2026-10-05", "100001", 900)], leads: tres, metas: [meta("reunioes_agendadas", 3)] }));
    expect(p.custo).toBe(`${formatCurrency(300)} por reunião (n = 3)`);
    expect(p.verbo).toBe("NO RITMO");
  });

  it("o gargalo e o impacto entram no placar com o dono e a origem da régua", () => {
    const leads = [...leadsEncerrados(49, "2026-10-05"), lead("2026-10-05", { status: "agendado", bookedAt: "2026-10-06T12:00:00.000Z", meetingFor: "2026-11-01T12:00:00.000Z" })];
    const p = placarDe(base({ leads, metas: [meta("taxa_lead_agendada", 0.1), meta("reunioes_agendadas", 7)] }));
    expect(p.gargalo).toMatchObject({ rotulo: "Lead → Agendada", dono: "COM", origem: "meta", href: "/jornada" });
    expect(p.gargalo?.impactoTexto).toBe("+4 reuniões por semana se batesse a meta");
  });

  it("a linha do minigráfico é a meta SEMANAL, mesmo com 30 dias selecionados (o alvo da frase soma o período)", () => {
    const data = base({ metas: [meta("reunioes_agendadas", 7)] });
    const trinta = { from: "2026-09-09", to: "2026-10-08" };
    const p = placarDe(data, trinta);
    expect(p.alvo).toBeCloseTo(30, 6);
    expect(p.alvoSemanal).toBe(7);
    const mensal = base({ metas: [{ ...meta("reunioes_agendadas", 30), periodo: "mes" }] });
    expect(placarDe(mensal).alvoSemanal).toBeCloseTo(30 / 4.33, 6);
  });

  it("montarPlacar é pura: a mesma entrada dá a mesma saída", () => {
    const data = base({ metas: [meta("reunioes_agendadas", 7)] });
    const k: KpisDoPeriodo = kpisDe(data);
    const b = montarBussola({ data, range: SEMANA, kpis: k, eventos: [], agora: AGORA, hoje: HOJE });
    const de = montarPlacar({ kpis: k, campanha: b.campanha, regua: b.regua, gargalo: b.gargalo, range: SEMANA, alvoSemanal: 7 });
    expect(de).toEqual(b.placar);
  });
});

// ---------------------------------------------------------------- briefing

describe("o briefing da IA recebe as ações do motor e o veredito da Bússola", () => {
  it("alertasJaDetectados traz regra, dono e estado; o veredito vai inteiro", () => {
    const data = base({ leads: [lead(brt("2026-10-08", "09:00"))], metas: [meta("reunioes_agendadas", 7)] });
    const b = montarBussola({ data, range: SEMANA, kpis: kpisDe(data), eventos: [], agora: AGORA, hoje: HOJE });
    const briefing = buildBriefing(data, SEMANA, {
      nowIso: AGORA,
      warnings: [],
      acoes: resumoDasAcoes(b.acoes),
      bussola: { veredito: `${b.placar.verbo} — ${b.placar.frase}`, gargalo: b.placar.gargalo?.rotulo },
    });
    expect(briefing.alertasJaDetectados[0]).toMatchObject({ regra: "C1", dono: "COM", severidade: "agora" });
    expect(briefing.bussola).toEqual({ veredito: "FORA DO RITMO — 0 de 7 reuniões agendadas na semana", gargalo: undefined });
  });
});
