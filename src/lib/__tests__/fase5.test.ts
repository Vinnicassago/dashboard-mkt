/**
 * Fase 5 — motor de ações v2 (dormente), a landing page no
 * período (o gargalo saiu na Fase 3 de nov/26: a resposta do Funil é `ondeTrava`) e
 * semanas; o placar e a série semanal saíram com o Início (Fase 2, nov/26). Desde a
 * Fase 4 (Mídia), M3, M4 (criativo), M6, M8 e M9 leem o MESMO `criativosComSinal` do
 * cartão da Mídia, montado uma vez por rodada. Fixture sintética (nenhum dado real).
 * Datas em UTC; Brasília = UTC−3.
 */
import { describe, expect, it, vi } from "vitest";
import { kpisDoPeriodo } from "../kpis";
import { alertasDoInicio, montarBussola } from "../bussola";
import { AMOSTRA_MIN, CONTATO_INVALIDO_MAX, motorDeAcoes, resumoDasAcoes, semanaDaAcao, type Acao, type EntradaMotor } from "../motor";
import { ancoraDoConjunto, ancoraDoCriativo, criativosComSinal, conjuntosPorId } from "../midia";
import type { LinhaCriativo } from "../midia-tela";
import { AMOSTRA_DE_PESSOAS, REGUA_DO_SINAL } from "../sinal-do-criativo";
import { alertaLpSemDado } from "../alertas";
import { lpParouNoPeriodo, temLpNoPeriodo } from "../metrics";
import { diasDoPeriodo, janelaAnterior, segundaDaSemana, semanaAnteriorFechada, ultimasSemanas } from "../semana";
import { buildBriefing } from "../ai/briefing";
import type { RoboAgora } from "../robo/situacao";
import type { AcaoEstado, AdDaily, Creative, DashboardData, Lead, LeadEvent, LpDaily, Meta } from "../types";
import { IDS, comLive, pessoa, producaoSemana, type SemanaDaMidia } from "@/test/fixtures-midia";
import { entradaDosSinaisDa, midiaDa } from "@/test/entrada-midia";

// O motor monta os criativos com sinal UMA vez por rodada (K29): o espião conta as chamadas
// sem mudar o que a função faz.
vi.mock("../midia", async (orig) => {
  const m = await orig<typeof import("../midia")>();
  return { ...m, criativosComSinal: vi.fn(m.criativosComSinal) };
});

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

/** A linha de criativo COM o sinal, montada como o motor a monta (a MESMA `criativosComSinal`, a do cartão da Mídia). */
function linhaDoSinal(data: DashboardData, chave: string, o: Partial<EntradaMotor> = {}, range: { from: string; to: string } | undefined = SEMANA): LinhaCriativo {
  const e: EntradaMotor = { data, range, kpis: kpisDe(data, range), eventos: [], agora: AGORA, hoje: HOJE, ...o };
  const { bloco } = criativosComSinal({
    data: e.data,
    range: e.range,
    kpis: e.kpis,
    eventos: e.eventos,
    robo: e.robo,
    cobertura: e.cobertura ?? [],
    ultimoSyncAds: e.ultimoSyncAds ?? null,
    ...(e.cfgLive ? { cfgLive: e.cfgLive } : {}),
    hoje: e.hoje,
    agora: e.agora,
  });
  const linha = bloco.conversao.find((l) => l.chave === chave);
  if (!linha) throw new Error(`sem a linha de criativo ${chave}`);
  return linha;
}

// ---------------------------------------------------------------- semanas

describe("semanas (segunda a domingo, Brasília)", () => {
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

// ---------------------------------------------------------------- a landing page no período (o gargalo saiu na Fase 3)

describe("landing page: só conta com linha NO período (`temLpNoPeriodo`, `lpParouNoPeriodo`, K13)", () => {
  const leads = [...leadsEncerrados(5, "2026-10-05")];
  const parou = base({ leads, lpDaily: [lp("2026-09-10", 2000, 200)] });
  const comLinha = base({ leads, lpDaily: [lp("2026-09-10", 2000, 200), lp("2026-10-05", 1000, 60)] });
  const semLp = base({ leads });

  it("histórico sem linha no período = rastreio que parou (não '0%'); com linha, rastreio vivo; sem LP nenhuma, nada parou", () => {
    expect(temLpNoPeriodo(parou, SEMANA)).toBe(false);
    expect(lpParouNoPeriodo(parou, SEMANA)).toBe(true);
    expect(temLpNoPeriodo(comLinha, SEMANA)).toBe(true);
    expect(lpParouNoPeriodo(comLinha, SEMANA)).toBe(false);
    expect(temLpNoPeriodo(semLp, SEMANA)).toBe(false);
    expect(lpParouNoPeriodo(semLp, SEMANA)).toBe(false);
  });

  it("período antes da 1ª linha da LP, ou a campanha inteira: não é rastreio parado", () => {
    expect(lpParouNoPeriodo(parou, { from: "2026-08-01", to: "2026-08-31" })).toBe(false);
    expect(temLpNoPeriodo(parou, undefined)).toBe(true);
    expect(lpParouNoPeriodo(parou, undefined)).toBe(false);
  });

  it("`alertaLpSemDado` é o MESMO alerta que o Início registrava (id, texto, cta) — e o Início o registra por ela", () => {
    const esperado = [
      {
        id: "lp-sem-dado",
        nivel: "aviso",
        titulo: "O rastreio da landing page parou: sem visitas registradas no período",
        detalhe:
          "Há histórico da landing page, mas nenhuma linha neste período: o rastreio (/api/track) pode ter parado — chave trocada, script fora da página. Visitas e envios ficam fora do funil até voltar.",
        cta: { label: "Ver integrações", href: "/configuracoes/integracoes" },
      },
    ];
    expect(alertaLpSemDado(parou, SEMANA, HOJE)).toEqual(esperado);
    expect(alertasDoInicio({ data: parou, range: SEMANA, kpis: kpisDe(parou), hoje: HOJE }).filter((a) => a.id === "lp-sem-dado")).toEqual(esperado);
    // Com linha no período, sem LP nenhuma, na campanha inteira ou num período que ainda não começou: nada.
    expect(alertaLpSemDado(comLinha, SEMANA, HOJE)).toEqual([]);
    expect(alertaLpSemDado(semLp, SEMANA, HOJE)).toEqual([]);
    expect(alertaLpSemDado(parou, undefined, HOJE)).toEqual([]);
    expect(alertaLpSemDado(parou, { from: "2026-10-20", to: "2026-10-20" }, HOJE)).toEqual([]);
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
    // Com o robô ligado (nov/26) o 1º contato é dele: a C1 conta quem o comercial
    // tem de atender — aqui, quem aceitou o convite e não teve a reunião registrada
    // (2 horas úteis desde o aceite). Os "Novos" de antes do robô não entram.
    const AGORA_ROBO = brt("2026-11-04", "15:00");
    const comAceite = base({
      leads: [
        ...data.leads,
        lead(brt("2026-11-04", "09:00"), {
          phone: "5511987650001",
          roboVistoEm: brt("2026-11-04", "09:05"),
          roboSaudacaoEm: brt("2026-11-04", "09:02"),
          roboRespondeuEm: brt("2026-11-04", "09:20"),
          roboEtapa: "transferido",
          roboAceitouEm: brt("2026-11-04", "10:00"),
        }),
      ],
      metas: [meta("taxa_lead_agendada", 0.5)],
    });
    const comRobo = motorDeAcoes({
      data: comAceite,
      range: undefined,
      kpis: kpisDoPeriodo(comAceite, undefined, { hoje: "2026-11-04", agora: AGORA_ROBO }),
      eventos: [],
      agora: AGORA_ROBO,
      hoje: "2026-11-04",
      robo: { ligado: true, lidoAte: brt("2026-11-04", "14:55"), confiavel: true, sync: { ultimoOk: brt("2026-11-04", "14:55"), falha: null } },
    });
    expect(comRobo[0]).toMatchObject({ regra: "C1", href: "/fila?etapa=convite-aceito#convite-aceito", titulo: "1 aceitou o convite sem reunião registrada" });
    expect(comRobo[0].amostra.n).toBe(1);
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
    // Sem meta não há régua — a regra não dispara.
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

  it("M3: Trocar arte por fadiga (CTR caindo + CPL subindo) — o MESMO sinal do cartão da Mídia", () => {
    // Regra da Fase 6.3 (S13/B17): duas janelas de 7 dias terminando no fim do
    // período — CTR 10% → 5% (≤ 75%) e CPL R$ 10 → R$ 25 (≥ 120%), ≥ 1.000
    // impressões em cada janela.
    const rows: AdDaily[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date("2026-10-08T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - i);
      rows.push(ad(d.toISOString().slice(0, 10), "100001", 100, i >= 7 ? { clicks: 100, leads: 10 } : { clicks: 50, leads: 4 }));
    }
    const data = base({ adDaily: rows });
    const m3 = regra(rodar(data), "M3")!;
    // Sem `creativeId` na fixture, a chave do criativo é o `adId`.
    expect(m3.id).toBe("M3:100001");
    const linha = linhaDoSinal(data, "100001");
    expect(linha.sinal).toMatchObject({ sinal: "trocar-arte", causa: "fadiga" });
    expect(m3.titulo).toBe(`Renove a arte de “Anúncio A”: ${linha.sinal!.motivo}`);
    expect(m3.detalhe).toBe(linha.sinal!.dica);
    expect(m3.amostra).toEqual(linha.sinal!.amostra);
    expect(m3.amostra).toEqual({ n: 7000, minimo: 1000 });
    expect(m3.href).toBe("/midia#criativos");
    // O motivo cita a queda do CTR e o CPL do Pixel (nunca "CPL 7 d" cru).
    expect(linha.sinal!.motivo).toBe("CTR 5,0% contra 10,0%; CPL Meta (Pixel) subiu");
  });

  it("M4: conjunto com mais de 25% de contatos inválidos em 10 leads ou mais", () => {
    const leads = [
      ...Array.from({ length: 4 }, () => lead("2026-10-05", { status: "contato_invalido", lostAt: "2026-10-05T18:00:00.000Z" })),
      ...leadsEncerrados(8, "2026-10-05"),
    ];
    const data = base({ adDaily: [ad("2026-10-05", "100001", 100)], leads });
    const acoes = rodar(data);
    const m4 = regra(acoes, "M4")!;
    // A linha é a de /midia#conjuntos: "campanha › conjunto" (por id, S20).
    expect(m4.titulo).toMatch(/Conjunto “Campanha › Conjunto A”: 33% de contatos inválidos — revisar formulário e segmentação/);
    expect(m4.amostra).toEqual({ n: 12, minimo: 10 });
    // O criativo único roda só neste conjunto, que já disparou: a M4 por criativo não repete.
    const linha = conjuntosPorId(data, SEMANA).conversao.flatMap((c) => c.conjuntos ?? [])[0];
    expect(acoes.filter((a) => a.regra === "M4").map((a) => a.id)).toEqual([`M4:${linha.chave}`]);
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

  it("M6 (além do relatório): Escalar = 3 reuniões por id a custo ≤ o da conta e sem fadiga — o sinal do cartão; M7: verba fora do ritmo", () => {
    const tres = Array.from({ length: 3 }, () => lead("2026-10-05", { status: "agendado", bookedAt: "2026-10-06T12:00:00.000Z", meetingFor: "2026-11-01T12:00:00.000Z" }));
    const data = base({ adDaily: [ad("2026-10-05", "100001", 2000)], leads: tres, metas: [meta("investimento_conversao", 1000)] });
    const acoes = rodar(data);
    expect(regra(acoes, "M6")).toMatchObject({ severidade: "baixa", id: "M6:100001" });
    const linha = linhaDoSinal(data, "100001");
    expect(linha.sinal).toMatchObject({ sinal: "escalar", causa: "reunioes" });
    expect(regra(acoes, "M6")!.titulo).toBe(`Escale “Anúncio A”: ${linha.sinal!.motivo}`);
    expect(regra(acoes, "M6")!.detalhe).toContain("Aumente o orçamento 10–20% e observe 48–72 h.");
    expect(regra(acoes, "M6")!.amostra).toEqual({ n: 3, minimo: 3 });
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

  it("G1 retirada (nov/26): sem metas ou sem orçamento, nenhuma ação manda cadastrar meta — isso é de Configurações (Pendências)", () => {
    const semNada = base({ campaign: { ...base().campaign, budgetTotal: 0 } });
    for (const acoes of [rodar(base()), rodar(semNada)]) {
      expect(regra(acoes, "G1")).toBeUndefined();
      expect(acoes.some((a) => a.href === "/configuracoes#metas")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------- Fase 4: o motor lê o sinal do cartão

/**
 * Dois criativos de conversão no MESMO conjunto, em 05/10: A (R$ 400, 20 leads) e B
 * (`gastoB`, `leadsB`). A média dos criativos = (400 + gastoB) ÷ (20 + leadsB).
 */
let seqFone = 0;
/** Os leads com telefone utilizável (sem ele, a trava "sem telefone ou WhatsApp" do candidato pega, K4). */
const comFone = (leads: Lead[]) => leads.map((l) => ({ ...l, phone: `5511986${String(++seqFone).padStart(6, "0")}` }));

function doisCriativos(gastoB: number, leadsB: number, extra: Partial<DashboardData> = {}): DashboardData {
  return base({
    adDaily: [ad("2026-10-05", "100001", 400), ad("2026-10-05", "100002", gastoB)],
    creatives: [criativo("100001", "Anúncio A"), criativo("100002", "Anúncio B")],
    leads: [...comFone(leadsEncerrados(20, "2026-10-05")), ...comFone(leadsEncerrados(leadsB, "2026-10-05", { utmContent: "Anúncio B|100002" }))],
    ...extra,
  });
}

describe("Fase 4: M8 (pausar) e M9 (candidato) — o MESMO sinal do cartão da Mídia", () => {
  it("M8 sem resultado: 0 lead com gasto que rendia 3+ leads na média → Pause, com o motivo e a régua do sinal", () => {
    const data = doisCriativos(300, 0);
    const acoes = rodar(data);
    const m8 = acoes.find((a) => a.id === "M8:100002");
    expect(m8, "M8 do Anúncio B").toBeDefined();
    const linha = linhaDoSinal(data, "100002");
    expect(linha.sinal).toMatchObject({ sinal: "pausar", causa: "sem-resultado" });
    expect(m8).toMatchObject({ regra: "M8", dono: "MKT", severidade: "alta", href: "/midia#criativos", semImpacto: "estimativa indisponível" });
    expect(m8!.titulo).toBe(`Pause “Anúncio B”: ${linha.sinal!.motivo}`);
    expect(m8!.detalhe.startsWith(linha.sinal!.dica.replace(/\.$/, ""))).toBe(true);
    expect(m8!.detalhe.endsWith("Pause no Ads Manager e suba uma variação.")).toBe(true);
    expect(m8!.amostra).toEqual(linha.sinal!.amostra);
  });

  it("M8 caro com 1 lead só acima de λ 4,75 (a chance de Poisson, K1); com 3+ leads, o CPL ≥ 2× a média", () => {
    // λ = 200 ÷ (600 ÷ 21) = 7: pausa. λ = 100 ÷ (500 ÷ 21) = 4,2: não.
    expect(rodar(doisCriativos(200, 1)).some((a) => a.id === "M8:100002")).toBe(true);
    expect(linhaDoSinal(doisCriativos(200, 1), "100002").sinal).toMatchObject({ sinal: "pausar", causa: "caro" });
    expect(rodar(doisCriativos(100, 1)).some((a) => a.regra === "M8")).toBe(false);
    // 3 leads a R$ 200 contra a média de R$ 43,48.
    const tres = doisCriativos(600, 3);
    const m8 = rodar(tres).find((a) => a.id === "M8:100002")!;
    expect(m8).toBeDefined();
    expect(m8.titulo).toBe(`Pause “Anúncio B”: ${linhaDoSinal(tres, "100002").sinal!.motivo}`);
    expect(m8.titulo).toMatch(/: CPL R\$\s200 · 4,6× a média$/);
  });

  it("um criativo que PAROU nunca gera M8 (fora do ar não recebe sinal)", () => {
    // B gastou R$ 300 sem lead em 02/10 e parou; A segue até 08/10 (o "no ar" é 06–08/10, com o sync cobrindo).
    const data = base({
      adDaily: [ad("2026-10-02", "100002", 300), ad("2026-10-05", "100001", 200), ad("2026-10-08", "100001", 200)],
      creatives: [criativo("100001", "Anúncio A"), criativo("100002", "Anúncio B")],
      leads: leadsEncerrados(20, "2026-10-05"),
    });
    const linha = linhaDoSinal(data, "100002", { cobertura: COBERTURA });
    expect(linha.veiculacao.estado).toBe("parou");
    expect(linha.sinal).toBeNull();
    expect(rodar(data, { cobertura: COBERTURA }).some((a) => a.regra === "M8")).toBe(false);
  });

  it("M9: o candidato da D9 — só 1 (a menor razão), com a ressalva literal, confiança média", () => {
    const data = doisCriativos(300, 0);
    const linha = linhaDoSinal(data, "100001");
    expect(linha.sinal).toMatchObject({ sinal: "candidato", causa: "cpl-d9", ressalva: "sinal de topo de funil, ainda sem reunião" });
    const m9 = rodar(data).filter((a) => a.regra === "M9");
    expect(m9).toHaveLength(1);
    expect(m9[0]).toMatchObject({
      id: "M9:100001",
      severidade: "baixa",
      confianca: "media",
      confiancaMotivo: "sinal de topo de funil, ainda sem reunião",
      href: "/midia#criativos",
      titulo: "Candidato a escalar: “Anúncio A” (sinal de topo de funil, ainda sem reunião)",
    });
    expect(m9[0].detalhe).toContain("Suba 10–20% e observe 48–72 h; decide com 3 reuniões.");
    expect(m9[0].detalhe.startsWith(linha.sinal!.motivo)).toBe(true);
    expect(m9[0].amostra).toEqual({ n: 20, minimo: 10 });
  });

  it("M4 por criativo (K9): `M4:cr:<chave>` com os números da linha; nunca M9 e M4:cr para a mesma chave", () => {
    // A e B no MESMO conjunto: A com 4 de 12 contatos inválidos (33%); B com 30 leads limpos.
    // O conjunto (4 de 42 = 10%) não dispara: a M4 aparece pelo criativo.
    const invalidos = Array.from({ length: 4 }, () => lead("2026-10-05", { status: "contato_invalido", lostAt: "2026-10-05T18:00:00.000Z" }));
    const data = base({
      adDaily: [ad("2026-10-05", "100001", 300), ad("2026-10-05", "100002", 600)],
      creatives: [criativo("100001", "Anúncio A"), criativo("100002", "Anúncio B")],
      leads: [...invalidos, ...leadsEncerrados(8, "2026-10-05"), ...leadsEncerrados(30, "2026-10-05", { utmContent: "Anúncio B|100002" })],
    });
    const acoes = rodar(data);
    const m4 = acoes.filter((a) => a.regra === "M4");
    expect(m4.map((a) => a.id)).toEqual(["M4:cr:100001"]);
    const linha = linhaDoSinal(data, "100001");
    expect(linha.leadsPainel).toBe(12);
    expect(linha.contatoInvalido).toBe(4);
    expect(linha.pctContatoInvalido).toBeCloseTo(1 / 3, 6);
    expect(m4[0].titulo).toBe("Criativo “Anúncio A”: 33% de contatos inválidos — revisar formulário e segmentação");
    expect(m4[0]).toMatchObject({ href: "/midia#criativos-tabela", amostra: { n: 12, minimo: AMOSTRA_MIN.M4 } });
    // A trava de contato do cartão é o MESMO corte: A não é candidato (nem M9).
    expect(linha.sinal?.sinal).not.toBe("candidato");
    const m9 = new Set(acoes.filter((a) => a.regra === "M9").map((a) => a.id.slice(3)));
    for (const a of m4) expect(m9.has(a.id.replace(/^M4:cr:/, ""))).toBe(false);
  });

  it("uma régua só (K9): o corte e a amostra da M4 são os da trava do cartão", () => {
    expect(CONTATO_INVALIDO_MAX).toBe(REGUA_DO_SINAL.contatoInvalidoMax);
    expect(AMOSTRA_MIN.M4).toBe(AMOSTRA_DE_PESSOAS);
  });

  it("`criativosComSinal` é montado UMA vez por rodada (K29)", () => {
    const data = doisCriativos(300, 0);
    const espiao = vi.mocked(criativosComSinal);
    espiao.mockClear();
    rodar(data);
    expect(espiao).toHaveBeenCalledTimes(1);
    espiao.mockClear();
    rodar(base());
    expect(espiao.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe("Fase 4: M3 e M8 pela resposta ao robô; M9 pelo robô (nov/26)", () => {
  const HOJE_R = "2026-11-10";
  const AGORA_R = brt(HOJE_R, "15:00");
  const SEMANA_R = { from: "2026-11-04", to: HOJE_R };
  const LIDO_R = brt(HOJE_R, "14:55");
  const ROBO_R: RoboAgora = { ligado: true, lidoAte: LIDO_R, confiavel: true, sync: { ultimoOk: LIDO_R, falha: null } };
  let tel = 0;
  /** Um lead de 05/11 do anúncio `adId` que o robô saudou (e que respondeu, ou não). */
  const doRobo = (adId: string, nome: string, respondeu: boolean): Lead =>
    lead(brt("2026-11-05", "10:00"), {
      utmContent: `${nome}|${adId}`,
      phone: `5511987${String(++tel).padStart(6, "0")}`,
      status: "sem_interesse",
      lostAt: brt("2026-11-06", "10:00"),
      roboVistoEm: brt("2026-11-05", "10:03"),
      roboRecebidoEm: brt("2026-11-05", "10:01"),
      roboSaudacaoEm: brt("2026-11-05", "10:02"),
      roboEtapa: respondeu ? "em_conversa" : "nao_respondeu",
      ...(respondeu
        ? { roboRespondeuEm: brt("2026-11-05", "10:20"), roboUltimaMsgClienteEm: brt("2026-11-05", "10:40"), roboUltimaInteracaoEm: brt("2026-11-05", "10:41") }
        : {}),
    });
  /** A (sem telefone: fora do robô) e B (com o robô), os dois em 09/11. */
  const semana = (a: { gasto: number; leads: Lead[] }, b: { gasto: number; leads: Lead[] }) =>
    base({
      adDaily: [ad("2026-11-09", "100001", a.gasto), ad("2026-11-09", "100002", b.gasto)],
      creatives: [criativo("100001", "Anúncio A"), criativo("100002", "Anúncio B")],
      leads: [...a.leads, ...b.leads],
    });
  const semFone = (n: number) => Array.from({ length: n }, () => lead(brt("2026-11-05", "11:00"), { status: "sem_interesse", lostAt: brt("2026-11-06", "10:00") }));
  /** O sync cobriu o período (nenhum dia "sem dados": sem piso, o candidato pode existir). */
  const COB_R = [{ from: "2026-10-01", to: HOJE_R }];
  const kpisR = (data: DashboardData) => kpisDoPeriodo(data, SEMANA_R, { hoje: HOJE_R, agora: AGORA_R, cobertura: COB_R });
  const motorR = (data: DashboardData) =>
    motorDeAcoes({ data, range: SEMANA_R, kpis: kpisR(data), eventos: [], agora: AGORA_R, hoje: HOJE_R, robo: ROBO_R, cobertura: COB_R });
  const sinalR = (data: DashboardData, chave: string) =>
    criativosComSinal({
      data,
      range: SEMANA_R,
      kpis: kpisR(data),
      eventos: [],
      robo: ROBO_R,
      cobertura: COB_R,
      ultimoSyncAds: null,
      hoje: HOJE_R,
      agora: AGORA_R,
    }).bloco.conversao.find((l) => l.chave === chave)!.sinal!;

  it("M8 caro + não responde: CPL acima da média e 0 de 12 maduros responderam → Pause (amostra = os maduros)", () => {
    // Média = R$ 1.000 ÷ 32 = R$ 31,25; B: R$ 600 e 12 leads (CPL R$ 50, 1,6×), ninguém respondeu.
    const data = semana({ gasto: 400, leads: semFone(20) }, { gasto: 600, leads: Array.from({ length: 12 }, () => doRobo("100002", "Anúncio B", false)) });
    const s = sinalR(data, "100002");
    expect(s).toMatchObject({ sinal: "pausar", causa: "qualidade", motivo: "caro e 0 de 12 responderam ao robô" });
    const m8 = motorR(data).find((a) => a.id === "M8:100002")!;
    expect(m8).toBeDefined();
    expect(m8.titulo).toBe(`Pause “Anúncio B”: ${s.motivo}`);
    expect(m8.amostra).toEqual({ n: 12, minimo: 10 });
  });

  it("M3 pela qualidade: barato e não responde → Renove a arte (não pause)", () => {
    // Média = R$ 1.000 ÷ 32; B: R$ 300 e 12 leads (CPL R$ 25, 0,8×), ninguém respondeu.
    const data = semana({ gasto: 700, leads: semFone(20) }, { gasto: 300, leads: Array.from({ length: 12 }, () => doRobo("100002", "Anúncio B", false)) });
    const s = sinalR(data, "100002");
    expect(s).toMatchObject({ sinal: "trocar-arte", causa: "qualidade", motivo: "barato, mas 0 de 12 responderam ao robô" });
    const acoes = motorR(data);
    const m3 = acoes.find((a) => a.id === "M3:100002")!;
    expect(m3).toBeDefined();
    expect(m3.titulo).toBe(`Renove a arte de “Anúncio B”: ${s.motivo}`);
    expect(m3.amostra).toEqual({ n: 12, minimo: 10 });
    expect(acoes.some((a) => a.id === "M8:100002")).toBe(false);
  });

  it("M9 pelo robô: metade ou mais responde e CPL até a média → 'responde ao robô, ainda sem reunião'", () => {
    // Média = R$ 1.000 ÷ 32; A: R$ 300 e 12 leads (CPL R$ 25, 0,8×), 8 de 12 responderam.
    const leadsA = Array.from({ length: 12 }, (_, i) => doRobo("100001", "Anúncio A", i < 8));
    const data = semana({ gasto: 300, leads: leadsA }, { gasto: 700, leads: semFone(20).map((l) => ({ ...l, utmContent: "Anúncio B|100002" })) });
    const s = sinalR(data, "100001");
    expect(s).toMatchObject({ sinal: "candidato", causa: "cpl-robo", ressalva: "responde ao robô, ainda sem reunião" });
    const m9 = motorR(data).filter((a) => a.regra === "M9");
    expect(m9.map((a) => a.id)).toEqual(["M9:100001"]);
    expect(m9[0].titulo).toBe("Candidato a escalar: “Anúncio A” (responde ao robô, ainda sem reunião)");
    expect(m9[0].confiancaMotivo).toBe("responde ao robô, ainda sem reunião");
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

// ---------------------------------------------------------------- briefing

describe("o briefing da IA: o Início no lugar do placar, sem as ações do motor", () => {
  it("sem 'bussola', nenhuma regra do motor em alertasJaDetectados (só conteúdo) e o bloco 'inicio' presente", () => {
    // O cenário que acendia a C1 (gente esperando o comercial fora do prazo) e o "FORA DO RITMO".
    const data = base({ leads: [lead(brt("2026-10-08", "09:00"))], metas: [meta("reunioes_agendadas", 7)] });
    const kpis = kpisDe(data);
    const { inicio } = montarBussola({ data, range: SEMANA, rangeKey: "2026-10-02..2026-10-08", kpis, eventos: [], filaLive: [], agora: AGORA, hoje: HOJE });
    const briefing = buildBriefing(data, SEMANA, { nowIso: AGORA, warnings: [], kpis, inicio });
    expect("bussola" in briefing).toBe(false);
    expect(briefing.alertasJaDetectados.every((a) => a.regra === "conteudo")).toBe(true);
    expect(JSON.stringify(briefing)).not.toMatch(/FORA DO RITMO|SEM META/);
    expect(briefing.inicio).not.toBeNull();
    // A frase do atendimento é a da tela (o mesmo grupo da Fila): o lead das 09:00 espera o 1º contato.
    expect(briefing.inicio?.atendimento.frases).toEqual(inicio.atendimento.frases.map((f) => f.texto));
    expect(briefing.inicio?.atendimento.frases[0]).toMatch(/^Novos — ligar agora · 1/);
  });
});

// ---------------------------------------------------------------- o link da ação vai aonde a linha MORA (corretor final)

describe("Fase 4: o href das ações de mídia é a âncora onde a linha está na página (Detalhes, Pausados, a live, os cartões)", () => {
  /** A entrada do motor sobre uma semana das fixtures da Mídia (a MESMA conta da página). */
  const entradaDoMotor = (p: SemanaDaMidia): EntradaMotor => {
    const e = entradaDosSinaisDa(p);
    return { data: e.data, range: e.range, kpis: e.kpis, eventos: [...e.eventos], robo: e.robo, cobertura: e.cobertura, ultimoSyncAds: e.ultimoSyncAds, cfgLive: e.cfgLive, agora: e.agora, hoje: e.hoje };
  };
  /** `n` leads do anúncio `adId` no dia `dia`, os `invalidos` primeiros com "Contato inválido". */
  const leadsDoAnuncio = (adId: string, dia: string, n: number, invalidos: number, nn0: number): Lead[] =>
    Array.from({ length: n }, (_, i) =>
      pessoa(nn0 + i, brt(dia, "10:00"), {
        utmSource: "meta",
        utmMedium: "paid_social",
        adId,
        utmContent: adId,
        ...(i < invalidos ? { status: "contato_invalido" as const, lostAt: brt(dia, "18:00") } : {}),
      }),
    );

  it("M4 de um conjunto que PAROU leva a /midia#pausados (é lá que a página o mostra), não a #conjuntos", () => {
    const p = producaoSemana();
    // O conjunto Delta (parou em 08/11): 10 leads de 07/11, 4 com contato inválido (40%).
    p.data.leads = [...p.data.leads, ...leadsDoAnuncio(IDS.anuncio.post6, "2026-11-07", 10, 4, 81)];
    const acoes = motorDeAcoes(entradaDoMotor(p));
    const m4 = acoes.filter((a) => a.regra === "M4");
    const delta = m4.find((a) => a.id.endsWith(`|${IDS.conjunto.delta}`))!;
    expect(delta).toBeDefined();
    expect(delta.href).toBe("/midia#pausados");
    // A página põe a MESMA linha em Pausados (e não em Detalhes).
    const m = midiaDa(p);
    const chave = delta.id.replace(/^M4:/, "");
    expect(m.pausados!.conjuntos.flatMap((c) => c.conjuntos ?? []).some((l) => l.chave === chave)).toBe(true);
    expect(m.detalhes.conjuntos.conversao.flatMap((c) => c.conjuntos ?? []).some((l) => l.chave === chave)).toBe(false);
    // O criativo do Delta (os conjuntos dele todos dispararam) não repete a ação.
    expect(m4.some((a) => a.id === `M4:cr:${IDS.criativo.post6}`)).toBe(false);
  });

  it("M4 de um criativo da LIVE leva a /midia#criativos-live (a linha `live|…` não está em Detalhes)", () => {
    const p = comLive();
    // 10 leads a mais no C4A (a live): o criativo fica com 4 de 15 inválidos (27%); o conjunto, 4 de 18 (22%).
    p.data.leads = [...p.data.leads, ...leadsDoAnuncio(IDS.anuncio.c4a, "2026-11-18", 10, 4, 91)];
    const acoes = motorDeAcoes(entradaDoMotor(p));
    const live = acoes.find((a) => a.id === `M4:cr:live|${IDS.criativo.c4a}`)!;
    expect(live).toBeDefined();
    expect(live.href).toBe("/midia#criativos-live");
    expect(midiaDa(p).detalhes.criativos.conversao.some((l) => l.chave === `live|${IDS.criativo.c4a}`)).toBe(false);
  });

  it("ancoraDoConjunto e ancoraDoCriativo: no ar → Detalhes (ou o cartão, entre os 5), fora do ar → Pausados, a live → o bloco dela, descoberta → Detalhes", () => {
    const v = (estado: "no-ar" | "parou" | "sem-leitura") => ({ estado, ultimoDia: "2026-11-08", rotulo: "" });
    expect(ancoraDoConjunto({ bucket: "conversao", veiculacao: v("no-ar") })).toBe("#conjuntos");
    expect(ancoraDoConjunto({ bucket: "conversao", veiculacao: v("parou") })).toBe("#pausados");
    expect(ancoraDoConjunto({ bucket: "conversao", veiculacao: v("sem-leitura") })).toBe("#pausados");
    expect(ancoraDoConjunto({ bucket: "descoberta", veiculacao: v("no-ar") })).toBe("#detalhes");
    // Cinco "Pausar" na frente: o candidato fica fora dos cartões (só em "Ver todos").
    const linha = (chave: string, sinal: "pausar" | "candidato", spend: number) =>
      ({ chave, daLive: false, veiculacao: v("no-ar"), spend, sinal: { sinal } }) as unknown as LinhaCriativo;
    const conversao = [...Array.from({ length: 5 }, (_, i) => linha(`p${i}`, "pausar", 100 + i)), linha("cand", "candidato", 500)];
    expect(ancoraDoCriativo(conversao[5], conversao, { cartao: true })).toBe("#criativos-tabela");
    expect(ancoraDoCriativo(conversao[0], conversao, { cartao: true })).toBe("#criativos");
    expect(ancoraDoCriativo(conversao[0], conversao)).toBe("#criativos-tabela");
    expect(ancoraDoCriativo({ chave: "x", daLive: false, veiculacao: v("parou") }, conversao, { cartao: true })).toBe("#pausados");
    expect(ancoraDoCriativo({ chave: "live|x", daLive: true, veiculacao: v("no-ar") }, conversao, { cartao: true })).toBe("#criativos-live");
  });
});
