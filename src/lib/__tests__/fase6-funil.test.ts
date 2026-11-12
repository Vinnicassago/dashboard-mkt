/**
 * Fase 6.2 — o Funil (revisto na Fase 3, nov/26): o topo só de conversão
 * (`montarCascata`: impressões → visitas → Leads, com o CPL do Início),
 * "Agendaram" (coorte) nunca é "Reuniões agendadas" (período), a tendência das
 * taxas, as coortes com todas as semanas, as perdas confiáveis e a confiança do
 * registro. O funil do processo, "onde trava" e a tela têm testes próprios
 * (`fase3-processo`, `fase3-onde-trava`, `fase3-perdas`, `fase3-funil-tela`).
 * Fixture sintética (nenhum dado real). Datas em UTC; Brasília = UTC−3.
 */
import { describe, expect, it } from "vitest";
import { kpisDoPeriodo, mostrar } from "../kpis";
import { AMOSTRA_MIN, ATRASO_REGISTRO_SHARE, LOTE_MIN } from "../motor";
import { TENTATIVAS_PARA_SEM_RESPOSTA } from "../lead-status";
import { lpKpis } from "../metrics";
import { AMOSTRA_MINIMA, montarCascata } from "../cascata";
import { dica } from "../dicionario";
import { formatInt } from "../format";
import { funilDoProcesso } from "../funil-processo";
import {
  SLA_PRIMEIRO_CONTATO_HORAS,
  confiancaDoRegistro,
  coortesDoFunil,
  montarFunilDaTela,
  ondeAtacar,
  ondeAtacarSemResposta,
  perdasConfiaveis,
  tendenciaDasTaxas,
} from "../funil";
import type { AdDaily, DashboardData, Lead, LeadEvent, LpDaily } from "../types";

// ---------------------------------------------------------------- fixtures

const HOJE = "2026-10-08"; // quinta
const AGORA = "2026-10-08T15:00:00.000Z"; // 12:00 em Brasília
const SEMANA = { from: "2026-10-02", to: "2026-10-08" };
const TRES_SEMANAS = { from: "2026-09-21", to: "2026-10-08" };

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
  name: `Pessoa ${seq}`,
  phone: `+55119${String(seq).padStart(8, "0")}`,
  status: "lead",
  utmSource: "meta",
  utmContent: "Anúncio A|100001",
  ...extra,
});

const lp = (date: string, visits: number, formSubmits: number): LpDaily => ({ brand: "consorcio", date, visits, clicks: Math.round(visits / 2), formSubmits });

let evSeq = 0;
const evento = (leadId: string, createdAt: string, extra: Partial<LeadEvent> = {}): LeadEvent => ({
  id: `E${++evSeq}`,
  leadId,
  brand: "consorcio",
  leadName: "Pessoa",
  actor: "ana",
  action: "status_changed",
  fromStatus: "lead",
  toStatus: "sem_resposta",
  createdAt,
  ...extra,
});

const tentativa = (leadId: string, occurredAt: string): LeadEvent =>
  evento(leadId, occurredAt, { action: "tentativa", fromStatus: undefined, toStatus: undefined, occurredAt, payload: { canal: "whatsapp", falou: "nao" } });

function base(over: Partial<DashboardData> = {}): DashboardData {
  return {
    campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-08-01", budgetTotal: 5000 },
    igAccountDaily: [],
    igPosts: [],
    adDaily: [],
    creatives: [{ adId: "100001", brand: "consorcio", name: "Anúncio A", format: "imagem" }],
    lpDaily: [],
    leads: [],
    goals: [],
    metas: [],
    updatedAt: AGORA,
    ...over,
  };
}

const kpisDe = (data: DashboardData, range = SEMANA as { from: string; to: string } | undefined) =>
  kpisDoPeriodo(data, range, { hoje: HOJE, agora: AGORA, comparar: true });

/** A entrada da tela do Funil (robô desligado), sobre a semana. */
const entradaDe = (data: DashboardData) => ({
  data,
  range: SEMANA,
  rangeKey: `${SEMANA.from}..${SEMANA.to}`,
  kpis: kpisDe(data),
  eventos: [] as LeadEvent[],
  agora: AGORA,
  hoje: HOJE,
});

// ---------------------------------------------------------------- o topo: só conversão

describe("o topo do funil (`montarCascata`): só campanhas de conversão", () => {
  const data = base({
    adDaily: [
      ad("2026-10-05", "100001", 300, { impressions: 4000 }),
      ad("2026-10-06", "100001", 300, { impressions: 6000 }),
      // Descoberta: fora do funil de conversão (S16).
      ad("2026-10-05", "200001", 100, { impressions: 50_000, objective: "OUTCOME_ENGAGEMENT", leads: 0 }),
    ],
    lpDaily: [lp("2026-10-05", 500, 30)],
    leads: Array.from({ length: 20 }, () => lead("2026-10-05")),
  });

  it("as impressões são as de conversão; as de descoberta ficam de fora (e o ⓘ diz quantas)", () => {
    const c = montarCascata({ data, range: SEMANA, kpis: kpisDe(data) });
    expect(c.degraus[0]).toMatchObject({ key: "impressoes", valor: 10_000, fonte: "meta" });
    expect(c.impressoesDescoberta).toBe(50_000);
    // A verba de conversão é a de `kpisDoPeriodo` (R$ 600, com a ressalva dela), no ⓘ da linha Leads.
    const k = kpisDe(data);
    expect(k.investimentoConversao.valor).toBe(600);
    expect(montarFunilDaTela(entradaDe(data)).funil!.linhas.find((l) => l.id === "leads")!.dica).toContain(
      `Verba de conversão no período: ${mostrar(k.investimentoConversao, "moeda0")}.`,
    );
    const impressoes = montarFunilDaTela(entradaDe(data)).funil!.linhas.find((l) => l.id === "impressoes")!;
    expect(impressoes.texto).toBe("10.000");
    expect(impressoes.dica).toContain("50.000 de descoberta ficam fora");
  });

  it("cliques e envios de formulário não são degraus; visita → lead = 20/500; o custo da linha Leads é o CPL (R$ 30)", () => {
    const k = kpisDe(data);
    const c = montarCascata({ data, range: SEMANA, kpis: k });
    expect(c.degraus.map((d) => d.key)).toEqual(["impressoes", "visitas", "leads"]);
    expect((c.degraus.map((d) => d.key) as string[]).some((key) => key === "envios" || key === "cliques")).toBe(false);
    expect(c.degraus.map((d) => d.fonte)).toEqual(["meta", "lp", "crm"]);
    const leads = c.degraus.find((d) => d.key === "leads")!;
    expect(leads.valor).toBe(k.leads.valor);
    expect(leads.daAnterior).toBeCloseTo(20 / 500, 6);
    // Custo por lead = o CPL de `kpisDoPeriodo` (R$ 600 ÷ 20 leads de conversão), a régua do Início.
    expect(k.cpl.valor).toBe(30);
    const linhaLeads = montarFunilDaTela(entradaDe(data)).funil!.linhas.find((l) => l.id === "leads")!;
    expect(linhaLeads.extra).toBe(`CPL ${mostrar(k.cpl, "moeda")}`);
    // O ⓘ diz sobre o quê é o % da linha (a base da cascata: as visitas).
    expect(linhaLeads.taxa).toBe("4,0%");
    expect(linhaLeads.dica).toContain("O % é sobre as visitas na LP.");
    expect(AMOSTRA_MINIMA).toBe(3);
  });
});

// ---------------------------------------------------------------- Agendaram × Reuniões agendadas

/** Quatro reuniões agendadas NA semana (três de leads de setembro), uma na coorte. */
const agendamentos = () =>
  base({
    adDaily: [ad("2026-10-05", "100001", 900)],
    leads: [
      lead("2026-09-10", { status: "agendado", bookedAt: "2026-10-05T12:00:00.000Z", meetingFor: "2026-10-20T12:00:00.000Z", firstContactAt: "2026-10-05T11:00:00.000Z" }),
      lead("2026-09-11", { status: "reuniao_realizada", bookedAt: "2026-10-05T12:00:00.000Z", attendedAt: "2026-10-06T12:00:00.000Z" }),
      lead("2026-09-12", { status: "cliente", bookedAt: "2026-10-05T12:00:00.000Z", attendedAt: "2026-10-06T12:00:00.000Z", closedAt: "2026-10-07T12:00:00.000Z", value: 50_000 }),
      ...Array.from({ length: 5 }, () => lead("2026-10-05", { firstContactAt: "2026-10-05T13:30:00.000Z" })),
      lead("2026-10-06", { status: "agendado", bookedAt: "2026-10-06T12:00:00.000Z", meetingFor: "2026-10-21T12:00:00.000Z" }),
    ],
  });

describe("'Agendaram' (coorte) nunca é 'Reuniões agendadas' (período), nem leva custo por reunião", () => {
  it("nenhuma linha do funil diz 'Reuniões agendadas' nem 'por reunião'; Agendaram é o dos kpis, com a `dica` 'agendaram'", () => {
    const data = agendamentos();
    const e = entradaDe(data);
    const k = e.kpis;
    // O período tem 4 reuniões agendadas; a coorte, 1 agendou: são números diferentes, com nomes diferentes.
    expect(k.reunioesAgendadas.valor).toBe(4);
    expect(k.agendaram.valor).toBe(1);
    const f = montarFunilDaTela(e);
    for (const l of f.funil!.linhas) {
      const visivel = [l.rotulo, l.texto, l.taxa ?? "", l.extra ?? ""].join(" ");
      expect(visivel, l.id).not.toMatch(/Reuniões agendadas|por reunião/);
    }
    const ag = f.funil!.linhas.find((l) => l.id === "agendaram")!;
    expect(ag).toMatchObject({ rotulo: "Agendaram", texto: formatInt(k.agendaram.valor) });
    expect(ag.dica.startsWith(dica("agendaram"))).toBe(true);
    expect(funilDoProcesso(e).degraus.find((d) => d.id === "agendaram")?.dica).toBe("agendaram");
  });
});

// ---------------------------------------------------------------- tendência

describe("tendência semanal: os mesmos KPIs, semana a semana", () => {
  const data = base({
    lpDaily: [lp("2026-09-22", 200, 20), lp("2026-10-06", 100, 10)],
    leads: [
      ...Array.from({ length: 10 }, () => lead("2026-09-22", { firstContactAt: "2026-09-22T13:20:00.000Z" })),
      lead("2026-09-22", { status: "agendado", bookedAt: "2026-09-23T12:00:00.000Z", meetingFor: "2026-10-20T12:00:00.000Z", firstContactAt: "2026-09-22T13:10:00.000Z" }),
      lead("2026-10-06"),
    ],
  });
  it("cada ponto bate com kpisDoPeriodo + lpKpis daquela semana; sem denominador, sem ponto", () => {
    const t = tendenciaDasTaxas(data, HOJE, 12, AGORA);
    expect(t).toHaveLength(12);
    expect(t.at(-1)).toMatchObject({ semana: "2026-10-05", incompleta: true, leads: 1 });
    const s = t.find((p) => p.semana === "2026-09-21")!;
    const r = { from: "2026-09-21", to: "2026-09-27" };
    const k = kpisDoPeriodo(data, r, { hoje: HOJE, agora: AGORA });
    expect(s.visitaLead).toBeCloseTo(k.leads.valor / lpKpis(data, r).visits, 9);
    expect(s.leadAgendada).toBeCloseTo(k.taxaLeadAgendada.valor, 9);
    expect(s.n).toEqual({ leads: 11, visitas: 200 });
    // O "1º contato no prazo" saiu da tendência (F3-D14).
    expect(Object.keys(s)).not.toContain("leadContatoNoPrazo");
    // Semana vazia: nenhuma taxa inventada.
    const vazia = t.find((p) => p.semana === "2026-09-28")!;
    expect(vazia).toMatchObject({ leads: 0, visitas: 0, visitaLead: undefined, leadAgendada: undefined });
  });

  it("mais leads que visitas na semana (gente que não passou pela LP): sem ponto visita → lead, como a linha Leads do funil", () => {
    const comMais = base({ lpDaily: [lp("2026-09-22", 3, 3)], leads: Array.from({ length: 5 }, () => lead("2026-09-22")) });
    const s = tendenciaDasTaxas(comMais, HOJE, 12, AGORA).find((p) => p.semana === "2026-09-21")!;
    expect(s).toMatchObject({ leads: 5, visitas: 3 });
    expect(s.visitaLead).toBeUndefined();
    // Com as visitas cobrindo os leads, a taxa sai.
    const cobre = base({ lpDaily: [lp("2026-09-22", 5, 5)], leads: Array.from({ length: 5 }, () => lead("2026-09-22")) });
    expect(tendenciaDasTaxas(cobre, HOJE, 12, AGORA).find((p) => p.semana === "2026-09-21")!.visitaLead).toBe(1);
  });

  it("a régua da amostra é a do funil (K17): 1 lead na semana não vira taxa lead → agendada", () => {
    const t = tendenciaDasTaxas(data, HOJE, 12, AGORA);
    const ultima = t.at(-1)!;
    expect(ultima.n.leads).toBeLessThan(AMOSTRA_MINIMA);
    expect(ultima.leadAgendada).toBeUndefined();
    // Visitas com amostra (100 ≥ 3): a taxa visita → lead sai.
    expect(ultima.visitaLead).toBeCloseTo(1 / 100, 9);
  });
});

// ---------------------------------------------------------------- coortes

describe("coortes: todas as semanas, com a partição perdas + abertos + ganhos = leads", () => {
  const data = base({
    // Anúncio só na primeira e na última semana: a do meio ficou parada.
    adDaily: [ad("2026-09-22", "100001", 100), ad("2026-10-06", "100001", 100)],
    leads: [
      lead("2026-09-22", { status: "sem_resposta", lostAt: "2026-09-25T12:00:00.000Z" }),
      lead("2026-09-22", { status: "em_contato", firstContactAt: "2026-09-22T13:30:00.000Z" }),
      lead("2026-09-23", { status: "agendado", bookedAt: "2026-09-24T12:00:00.000Z", meetingFor: "2026-09-30T12:00:00.000Z", attendedAt: "2026-09-30T12:00:00.000Z" }),
      // Agendou e depois se perdeu: é GANHO da coorte (chegou a reunião), não perda sem reunião.
      lead("2026-09-23", { status: "sem_interesse", bookedAt: "2026-09-24T12:00:00.000Z", lostAt: "2026-10-01T12:00:00.000Z" }),
      // Desistência: agendou (fato) — ganho na partição, fora de "agendadas" (política).
      lead("2026-09-24", { status: "desistencia", bookedAt: "2026-09-25T12:00:00.000Z", lostAt: "2026-10-01T12:00:00.000Z" }),
      lead("2026-10-06"),
    ],
  });
  const cobertura = [{ from: "2026-09-21", to: "2026-10-08" }];
  const coortes = coortesDoFunil(data, TRES_SEMANAS, { agora: AGORA, hoje: HOJE, cobertura });

  it("a semana sem lead aparece com 0 e o motivo (campanha pausada); a semana corrente está maturando", () => {
    expect(coortes.map((c) => c.semana)).toEqual(["2026-09-21", "2026-09-28", "2026-10-05"]);
    expect(coortes[1]).toMatchObject({ leads: 0, agendadas: 0, perdas: 0, abertos: 0, ganhos: 0, leadAgendada: null, veiculacao: "pausada", semVeiculacao: true });
    expect(coortes[2]).toMatchObject({ leads: 1, immature: true, veiculacao: "ok" });
    // Sem cobertura do sync, a mesma semana é "sem dados", não "pausada".
    expect(coortesDoFunil(data, TRES_SEMANAS, { agora: AGORA, hoje: HOJE, cobertura: [{ from: "2026-10-05", to: "2026-10-08" }] })[1].veiculacao).toBe("sem_dados");
  });

  it("perdas + abertos + ganhos = leads, e 'agendadas' é o mesmo 'Agendaram' dos KPIs", () => {
    for (const c of coortes) {
      expect(c.perdas + c.abertos + c.ganhos).toBe(c.leads);
      const r = { from: c.semana < TRES_SEMANAS.from ? TRES_SEMANAS.from : c.semana, to: c.semana === "2026-10-05" ? TRES_SEMANAS.to : `${c.semana.slice(0, 8)}${String(Number(c.semana.slice(8)) + 6).padStart(2, "0")}` };
      expect(c.agendadas).toBe(kpisDoPeriodo(data, r, { hoje: HOJE, agora: AGORA }).agendaram.valor);
    }
    expect(coortes[0]).toMatchObject({ leads: 5, perdas: 1, abertos: 1, ganhos: 3, agendadas: 2, realizadas: 1, vendas: 0 });
    // O "1º contato no prazo" saiu da coorte (F3-D14).
    expect(Object.keys(coortes[0])).not.toContain("primeiroContatoNoPrazo");
  });

  it("na campanha inteira, sem lead nenhum, não há coorte", () => {
    expect(coortesDoFunil(base(), undefined, { agora: AGORA, hoje: HOJE })).toEqual([]);
  });
});

// ---------------------------------------------------------------- perdas confiáveis

describe("onde atacar: regra explícita, com as réguas do painel", () => {
  it("'Sem resposta' → comercial com menos de 3 tentativas ou 1ª tentativa fora do prazo; mídia só com 3+ no prazo", () => {
    expect(TENTATIVAS_PARA_SEM_RESPOSTA).toBe(3);
    expect(SLA_PRIMEIRO_CONTATO_HORAS).toBe(1);
    expect(ondeAtacarSemResposta(0, null)).toBe("comercial");
    expect(ondeAtacarSemResposta(2, true)).toBe("comercial");
    expect(ondeAtacarSemResposta(3, false)).toBe("comercial");
    expect(ondeAtacarSemResposta(3, true)).toBe("midia_formulario");
    expect(ondeAtacarSemResposta(5, true)).toBe("midia_formulario");
  });
  it("os outros motivos têm alvo fixo", () => {
    expect(ondeAtacar("contato_invalido", { tentativas: 0, primeiraNoPrazo: null })).toBe("midia_formulario");
    expect(ondeAtacar("sem_interesse", { tentativas: 3, primeiraNoPrazo: true })).toBe("oferta");
    expect(ondeAtacar("desistencia", { tentativas: 0, primeiraNoPrazo: null })).toBe("oferta");
  });
});

describe("perdas confiáveis: sem testes, sem duplicados, sem quem chegou a agendar", () => {
  const perdido = (dia: string, extra: Partial<Lead> = {}) => lead(dia, { status: "sem_resposta", lostAt: `${dia}T20:00:00.000Z`, ...extra });
  const teste = perdido("2026-10-05", { name: "teste", phone: "+5511999999999" });
  const principal = lead("2026-10-05", { status: "em_contato", phone: "+5511988887777", firstContactAt: "2026-10-05T13:30:00.000Z" });
  const duplicado = perdido("2026-10-06", { phone: "+5511988887777" });
  const comReuniao = lead("2026-10-05", { status: "sem_interesse", bookedAt: "2026-10-06T12:00:00.000Z", lostAt: "2026-10-07T12:00:00.000Z" });
  // Sem resposta com 3 tentativas, a 1ª dentro de 1 hora útil (entrou 10:00 BRT, tentou 10:30).
  const insistido = perdido("2026-10-05", { firstContactAt: "2026-10-05T13:30:00.000Z" });
  // Sem resposta com 3 tentativas, mas a 1ª só no dia seguinte.
  const tardio = perdido("2026-10-05", { firstContactAt: "2026-10-06T13:30:00.000Z" });
  // Sem resposta sem nenhuma tentativa.
  const ignorado = perdido("2026-10-05");
  const invalido1 = lead("2026-10-05", { status: "contato_invalido", lostReasonDetail: "numero_inexistente", lostAt: "2026-10-05T14:00:00.000Z" });
  const invalido2 = lead("2026-10-05", { status: "contato_invalido", lostReasonDetail: "sem_whatsapp", lostAt: "2026-10-09T14:00:00.000Z" });
  const desinteressado = lead("2026-10-05", { status: "sem_interesse", lostAt: "2026-10-05T16:00:00.000Z" });
  const data = base({ leads: [teste, principal, duplicado, comReuniao, insistido, tardio, ignorado, invalido1, invalido2, desinteressado] });
  const eventos: LeadEvent[] = [
    tentativa(insistido.id, "2026-10-05T13:30:00.000Z"),
    tentativa(insistido.id, "2026-10-06T13:30:00.000Z"),
    tentativa(insistido.id, "2026-10-07T13:30:00.000Z"),
    // Registrado 4 dias depois da entrada: com atraso.
    evento(insistido.id, "2026-10-09T13:00:00.000Z"),
    tentativa(tardio.id, "2026-10-06T13:30:00.000Z"),
    tentativa(tardio.id, "2026-10-06T18:30:00.000Z"),
    tentativa(tardio.id, "2026-10-07T13:30:00.000Z"),
    evento(tardio.id, "2026-10-07T14:00:00.000Z"),
  ];
  const p = perdasConfiaveis(data, SEMANA, eventos);
  const porMotivo = Object.fromEntries(p.linhas.map((l) => [l.motivo, l]));

  it("a tabela não contém teste, duplicado nem lead que chegou a 'Agendado'", () => {
    expect(p.total).toBe(6);
    expect(p.base).toBe(8); // 10 − teste − duplicado
    expect(p.excluidos).toEqual({ testes: 1, duplicados: 1, comReuniao: 1 });
    expect(p.linhas.reduce((s, l) => s + l.n, 0)).toBe(6);
    expect(porMotivo.sem_resposta.n).toBe(3);
    expect(porMotivo.contato_invalido.n).toBe(2);
    expect(porMotivo.sem_interesse.n).toBe(1);
    // As linhas do comercial levam o status (o mesmo da chave) e quem encerrou.
    for (const l of p.linhas) expect([l.status, l.quem]).toEqual([l.motivo, "comercial"]);
  });

  it("'Onde atacar' é aplicado lead a lead; 'Contato inválido' abre pelo motivo", () => {
    expect(porMotivo.sem_resposta.ondeAtacar).toEqual({ comercial: 2, midia_formulario: 1 });
    expect(p.semTentativa).toBe(1);
    expect(porMotivo.contato_invalido.ondeAtacar).toEqual({ midia_formulario: 2 });
    expect(porMotivo.contato_invalido.detalhes).toEqual([
      { motivo: "numero_inexistente", label: "Número não existe", n: 1 },
      { motivo: "sem_whatsapp", label: "Sem WhatsApp", n: 1 },
    ]);
    expect(porMotivo.sem_interesse.ondeAtacar).toEqual({ oferta: 1 });
  });

  it("quem o robô recebeu: '1ª tentativa fora do prazo' não se aplica — só '< 3 tentativas' vai ao comercial (11.7)", () => {
    // O mesmo "tardio" (3 tentativas, a 1ª no dia seguinte), agora visto pelo robô.
    const viuRobo = { ...tardio, id: `${tardio.id}-robo`, roboVistoEm: "2026-10-05T13:05:00.000Z" };
    // E um visto pelo robô com só 2 tentativas: continua com o comercial.
    const poucas = perdido("2026-10-05", { roboVistoEm: "2026-10-05T13:05:00.000Z" });
    const dados = base({ leads: [viuRobo, poucas] });
    const evs: LeadEvent[] = [
      tentativa(viuRobo.id, "2026-10-06T13:30:00.000Z"),
      tentativa(viuRobo.id, "2026-10-06T18:30:00.000Z"),
      tentativa(viuRobo.id, "2026-10-07T13:30:00.000Z"),
      tentativa(poucas.id, "2026-10-06T13:30:00.000Z"),
      tentativa(poucas.id, "2026-10-07T13:30:00.000Z"),
    ];
    const r = perdasConfiaveis(dados, SEMANA, evs);
    expect(r.linhas.find((l) => l.motivo === "sem_resposta")!.ondeAtacar).toEqual({ comercial: 1, midia_formulario: 1 });
    // Sem o robô, o mesmo lead tardio aponta para o comercial (o caso de cima, intacto).
    expect(porMotivo.sem_resposta.ondeAtacar.comercial).toBe(2);
  });

  it("% registrado com atraso (> 72 h) e média de tentativas, por motivo", () => {
    // sem_resposta: insistido (evento 4 dias depois) atrasado; tardio (2 dias) não; ignorado (lostAt no dia) não.
    expect(porMotivo.sem_resposta.atrasoN).toBe(3);
    expect(porMotivo.sem_resposta.registradoComAtraso).toBeCloseTo(1 / 3, 6);
    expect(porMotivo.sem_resposta.mediaTentativas).toBeCloseTo(2, 6);
    // contato_invalido: invalido2 pelo marco (4 dias) atrasado.
    expect(porMotivo.contato_invalido.registradoComAtraso).toBeCloseTo(0.5, 6);
    expect(porMotivo.sem_resposta.share).toBeCloseTo(0.5, 6);
  });

  it("sem o robô nada muda: sem o trecho (ou com `opts` vazio), as linhas de hoje — só status, sem linha do robô", () => {
    expect(perdasConfiaveis(data, SEMANA, eventos, {})).toEqual(p);
    expect(perdasConfiaveis(data, SEMANA, eventos, { trechoDoRobo: new Set() }).linhas).toEqual(p.linhas);
    expect(p.linhas.map((l) => l.motivo)).toEqual(["sem_resposta", "contato_invalido", "sem_interesse"]);
  });
});

// ---------------------------------------------------------------- confiança do registro

describe("confiança do registro: lote ou atraso acima de 30%, com amostra", () => {
  const leads = Array.from({ length: 12 }, () => lead("2026-10-05"));
  const data = base({ leads });

  // Entrada 05/10 13:00Z; registro 08/10 14:30Z = 73,5 h depois (ainda dentro do período).
  const TARDE = "2026-10-08T14:30:00.000Z";

  it("4 de 10 registros com mais de 72 h de atraso derrubam a confiança", () => {
    const eventos = leads.slice(0, 10).map((l, i) => evento(l.id, i < 4 ? TARDE : `2026-10-05T1${i}:00:00.000Z`, { actor: `ator${i}` }));
    const c = confiancaDoRegistro(data, SEMANA, eventos);
    expect(c).toMatchObject({ total: 10, atrasados: 4, emLote: 0, suspeitos: 4, baixa: true });
    expect(c.share).toBeCloseTo(0.4, 6);
    expect(c.share).toBeGreaterThan(ATRASO_REGISTRO_SHARE);
  });

  it("2 de 10 não derrubam; abaixo da amostra mínima a confiança não cai (sem o alerta `registro-suspeito`)", () => {
    const eventos = leads.slice(0, 10).map((l, i) => evento(l.id, i < 2 ? TARDE : `2026-10-05T1${i}:00:00.000Z`, { actor: `ator${i}` }));
    expect(confiancaDoRegistro(data, SEMANA, eventos)).toMatchObject({ suspeitos: 2, baixa: false });
    const poucos = leads.slice(0, 4).map((l) => evento(l.id, TARDE, { actor: "ana" }));
    const c = confiancaDoRegistro(data, SEMANA, poucos);
    expect(c.total).toBeLessThan(AMOSTRA_MIN.C5);
    expect(c).toMatchObject({ share: 1, baixa: false });
  });

  it("10 registros do mesmo usuário em 15 minutos são lote — mesmo no dia da entrada", () => {
    const eventos = leads.slice(0, 10).map((l, i) => evento(l.id, `2026-10-05T14:${String(i).padStart(2, "0")}:00.000Z`, { actor: "ana" }));
    const c = confiancaDoRegistro(data, SEMANA, eventos);
    expect(c).toMatchObject({ total: 10, atrasados: 0, emLote: LOTE_MIN, suspeitos: 10, baixa: true });
    // Dois usuários com 5 cada: não é lote.
    const divididos = eventos.map((e, i) => ({ ...e, actor: i % 2 ? "ana" : "bia" }));
    expect(confiancaDoRegistro(data, SEMANA, divididos)).toMatchObject({ emLote: 0, baixa: false });
    expect(confiancaDoRegistro(data, SEMANA, []).texto).toContain("nenhuma mudança de status");
  });

  it("registro em lote vira o alerta `registro-suspeito` do Funil (F3-D15), com o texto da confiança", () => {
    const eventos = leads.slice(0, 10).map((l, i) => evento(l.id, `2026-10-05T14:${String(i).padStart(2, "0")}:00.000Z`, { actor: "ana" }));
    const e = { ...entradaDe(data), eventos };
    const alerta = montarFunilDaTela(e).alertas.find((a) => a.id === "registro-suspeito");
    const c = confiancaDoRegistro(data, SEMANA, eventos);
    expect(alerta).toMatchObject({ nivel: "aviso", titulo: "Registro de status suspeito no período", detalhe: `${c.texto}: as taxas e as perdas do período podem estar distorcidas.` });
    expect(montarFunilDaTela(entradaDe(data)).alertas.some((a) => a.id === "registro-suspeito")).toBe(false);
  });
});
