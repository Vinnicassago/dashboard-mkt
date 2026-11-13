/**
 * Fase 2 (nov/26) — o Início em quatro blocos (`montarInicio`, puro). Portão no
 * estilo do fase3: para 3 períodos, com o robô DESLIGADO (o seed) e com um robô de
 * fixture (leads com as colunas `robo_*`), cada número do Início é o da tela que
 * ele cita — cartões = `kpisDoPeriodo`, barras = leads do cartão, funil aninhado,
 * frases = grupos da MESMA `montarFila` da /fila, último post = `postingCadence`.
 * E a LGPD: nada de telefone ou e-mail no objeto. Fixtures sintéticas; instantes
 * em Z ou pelo `brt(dia, "HH:MM")` (Brasília, UTC−3), nunca texto sem fuso.
 */
import { describe, expect, it } from "vitest";
import { buildSeedData, buildSeedLeadEvents } from "../data/seed";
import { alertaRoboSem1aMsg } from "../alertas";
import { AMOSTRA_MINIMA } from "../cascata";
import { esperandoOComercial, montarFila, type FilaEtapa, type FilaResult } from "../fila";
import { montarFilaDaLive, type ItemDaFilaLive } from "../fila-live";
import { formatCurrency, formatCurrency0, formatInt } from "../format";
import {
  fatoNoCartao,
  frasesDoAtendimento,
  funilDoAtendimento,
  haQuanto,
  haQuantoNoTitulo,
  leadsPorDia,
  montarInicio,
  sparkDoInvestimento,
  textoDoUltimoPost,
  type EntradaInicio,
  type Inicio,
} from "../inicio";
import { custoExibivel, fatoDoCustoPorReuniao, kpisDoPeriodo, mostrar } from "../kpis";
import { montarLinhasDeLeads } from "../leads-vista";
import { bucketOfAd, dailySeries, postingCadence, type DateRange } from "../metrics";
import { resumoDaMidia } from "../midia";
import { pageRange } from "../page-range";
import { hojeEmBrasilia } from "../range";
import { reabertosNoPainel, reabertosPorLead, refDoRobo, semMensagemDoRobo, situacaoDoRobo, type RoboAgora } from "../robo/situacao";
import { ATOR_LP } from "../diagnostico-leads";
import { EXPEDIENTE_PADRAO } from "../turno";
import type { Intervalo } from "../cobertura";
import type { AdDaily, DashboardData, IgPost, Lead, LeadEvent } from "../types";

const brt = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();

function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function base(over: Partial<DashboardData> = {}): DashboardData {
  return {
    campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-09-01", budgetTotal: 0 },
    igAccountDaily: [],
    igPosts: [],
    adDaily: [],
    creatives: [],
    lpDaily: [],
    leads: [],
    goals: [],
    metas: [],
    updatedAt: "2026-10-08T12:00:00.000Z",
    ...over,
  };
}

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

/** Gasto de CONVERSÃO de um dia (a régua de `objectiveBreakdown`). */
const conversaoDoDia = (data: DashboardData, dia: string) =>
  data.adDaily.filter((r) => r.date === dia && bucketOfAd(r) === "conversao").reduce((s, r) => s + r.spend, 0);

/** O cálculo do "esperando" que a /fila fazia inline até a Fase 2 — a função extraída tem de dar o mesmo. */
function esperandoComoAFilaFazia(fila: FilaResult, filaLive: readonly ItemDaFilaLive[], roboLigado: boolean): number {
  const doGrupo = (e: FilaEtapa) => fila.grupos.find((r) => r.etapa === e);
  return new Set([
    ...filaLive.filter((i) => i.etapa === "primeira").map((i) => i.leadId),
    ...(roboLigado ? ["resgate", "convite-aceito"] : ["novo"]).flatMap((e) =>
      (doGrupo(e as FilaEtapa)?.itens ?? []).map((i) => i.leadId ?? i.id),
    ),
  ]).size;
}

/** Os telefones e e-mails do fixture, crus e só em dígitos — nenhum pode estar no objeto. */
function contatosDe(leads: Lead[]): string[] {
  const out = new Set<string>();
  for (const l of leads) {
    if (l.email) out.add(l.email);
    if (l.phone) {
      out.add(l.phone);
      const d = l.phone.replace(/\D/g, "");
      if (d.length >= 8) out.add(d);
    }
  }
  return [...out];
}

/**
 * Os invariantes do §6 (1–7) e do C14 que são do Início, para UMA entrada. Devolve
 * o objeto para o teste olhar o resto.
 */
function conferir(e: EntradaInicio): Inicio {
  const ini = montarInicio(e);
  const k = e.kpis;
  const ligado = Boolean(e.robo?.ligado);

  // 1. Σ barras = o cartão de Leads (com teste e duplicado: um número por métrica).
  expect(ini.leadsChegando.dias.reduce((s, d) => s + d.leads, 0)).toBe(k.leads.valor);
  // Todo dia do período, em ordem, sem buraco.
  const dias = ini.leadsChegando.dias.map((d) => d.date);
  for (let i = 1; i < dias.length; i++) expect(dias[i]).toBe(somarDias(dias[i - 1], 1));
  if (e.range && dias.length) {
    expect(dias[0]).toBe(e.range.from);
    expect(dias.at(-1)).toBe(e.range.to);
  }
  for (const d of ini.leadsChegando.dias) if (d.pausado) expect(d.date <= e.hoje).toBe(true);

  // 2. Os cartões são `mostrar(kpis…)`; o minigráfico soma o gasto de conversão dos seus dias.
  expect(ini.cartoes.investimento.texto).toBe(mostrar(k.investimentoConversao, "moeda0"));
  expect(ini.cartoes.cpl.texto).toBe(mostrar(k.cpl, "moeda"));
  expect(ini.cartoes.leads.texto).toBe(mostrar(k.leads, "int"));
  expect(ini.cartoes.reunioes.texto).toBe(mostrar(k.reunioesAgendadas, "int"));
  expect(ini.cartoes.reunioes.valor).toBe(k.reunioesAgendadas.valor);
  // Período que ainda não começou: nenhum cartão leva o anterior (a seta compararia o 1º dia futuro com hoje).
  const naoComecou = Boolean(e.range && e.range.from > e.hoje);
  expect(ini.cartoes.leads.anterior).toBe(naoComecou ? undefined : k.leads.anterior);
  expect(ini.cartoes.leadsConversao).toBe(k.leadsConversao.valor);
  expect(ini.cartoes.leadsOrganicos).toBe(k.leadsOrganicos.valor);
  const spark = ini.cartoes.sparkInvestimento;
  if (spark) {
    expect(k.investimentoConversao.confianca).toBeUndefined();
    expect(spark.length).toBeGreaterThanOrEqual(3);
    const inicio = e.range?.from ?? e.data.adDaily.map((r) => r.date).sort()[0];
    spark.forEach((v, i) => expect(v).toBeCloseTo(conversaoDoDia(e.data, somarDias(inicio, i)), 6));
    const fimSpark = somarDias(inicio, spark.length - 1);
    expect(fimSpark < e.hoje).toBe(true); // hoje é parcial: nunca no minigráfico
    // C3: Σ spark + o gasto de conversão de hoje + o dos dias cortados (sem linha) = o cartão.
    const fim = e.range?.to ?? e.data.adDaily.map((r) => r.date).sort().at(-1)!;
    let resto = 0;
    for (let d = somarDias(fimSpark, 1); d <= fim; d = somarDias(d, 1)) {
      if (d !== e.hoje) expect(e.data.adDaily.some((r) => r.date === d)).toBe(false);
      resto += conversaoDoDia(e.data, d);
    }
    expect(spark.reduce((s, v) => s + v, 0) + resto).toBeCloseTo(k.investimentoConversao.valor, 6);
  }

  // 3. Funil: Leads = kpis.leads; Agendaram = kpis.agendaram; aninhado; taxa ≤ 1 e só com amostra.
  const funil = ini.atendimento.funil;
  expect(funil[0]).toMatchObject({ id: "leads", valor: k.leads.valor });
  expect(funil.find((d) => d.id === "agendaram")?.valor).toBe(k.agendaram.valor);
  funil.forEach((d, i) => {
    if (d.taxa !== null) {
      expect(d.taxa).toBeGreaterThanOrEqual(0);
      expect(d.taxa).toBeLessThanOrEqual(1);
      const baseN = d.base === "leads" ? k.leads.valor : funil[i - 1].valor;
      expect(baseN).toBeGreaterThanOrEqual(AMOSTRA_MINIMA);
    }
    if (d.doRobo && i > 0) expect(d.valor).toBeLessThanOrEqual(funil[i - 1].valor);
  });
  const realizadas = funil.find((d) => d.id === "realizadas");
  if (realizadas) expect(realizadas.valor).toBe(k.overview.attended);
  if (ini.atendimento.leituraParada) expect(funil.filter((d) => d.doRobo).every((d) => d.taxa === null)).toBe(true);

  // 4. Cada frase carrega o número da página que ela abre.
  const fila = montarFila({ nowIso: e.agora, leads: e.data.leads, eventos: e.eventos, robo: ligado ? e.robo : undefined });
  expect(ini.atendimento.esperando).toBe(esperandoComoAFilaFazia(fila, e.filaLive as ItemDaFilaLive[], ligado));
  expect(ini.atendimento.esperando).toBe(esperandoOComercial(fila, e.filaLive, ligado));
  expect(ini.atendimento.titulo).toBe(
    ini.atendimento.esperando > 0 ? `Atendimento · ${ini.atendimento.esperando} esperando o comercial` : "Atendimento · ninguém esperando",
  );
  expect(ini.atendimento.frases.length).toBeLessThanOrEqual(3);
  for (const f of ini.atendimento.frases) {
    expect(f.texto.split(/\s+/).filter((p) => /\p{L}|\d/u.test(p)).length).toBeLessThanOrEqual(12);
    if (f.id === "live") {
      expect(f.total).toBe(e.filaLive.length);
      expect(f.texto).toBe(`Live 01/12 · ${e.filaLive.length} na fila → Fila`);
      expect(f.href).toMatch(/^\/fila(\?range=[^#]+)?#live$/);
    } else if (f.id === "sem-1a-msg") {
      const sem = semMensagemDoRobo(e.data.leads, reabertosPorLead(e.eventos), e.robo, e.agora, reabertosNoPainel(e.eventos));
      expect(f.total).toBe(sem.total);
      expect(alertaRoboSem1aMsg(sem)[0].titulo.startsWith(`${sem.total} `)).toBe(true);
      expect(f.href).toBe("/leads?robo=sem-1a-msg&range=all");
    } else {
      const g = fila.grupos.find((x) => x.etapa === f.id)!;
      expect(f.total).toBe(g.total);
      expect(f.texto).toContain(` · ${g.total}`);
      if (f.id !== "confirmar" && g.foraDoPrazo > 0) expect(f.texto).toContain(`· ${g.foraDoPrazo} fora do prazo`);
      else expect(f.texto).not.toContain("fora do prazo");
      expect(f.href).toContain(`/fila?etapa=${f.id}`);
      expect(f.href.endsWith(`#${f.id}`)).toBe(true);
    }
  }
  expect(ini.atendimento.vazio === null).toBe(ini.atendimento.frases.length > 0);

  // 5. A lista: ≤ 8, do mais novo ao mais antigo, sem teste, sem cópia de duplicado, e
  //    o Atendimento de cada um é o de /leads com a MESMA entrada.
  const linhas = montarLinhasDeLeads(e.data, e.eventos, e.agora, { range: e.range, expediente: e.expediente, robo: e.robo });
  const porId = new Map(linhas.map((r) => [r.id, r]));
  const ult = ini.leadsChegando.ultimos;
  expect(ult.length).toBeLessThanOrEqual(8);
  for (let i = 1; i < ult.length; i++) expect(Date.parse(ult[i - 1].criadoEm)).toBeGreaterThanOrEqual(Date.parse(ult[i].criadoEm));
  for (const u of ult) {
    const r = porId.get(u.id)!;
    expect(r).toBeDefined();
    expect(r.sinalizadores.teste).toBeNull();
    expect(r.sinalizadores.duplicadoDe).toBeUndefined();
    expect(u.atendimento?.texto ?? "—").toBe(r.atendimentoAgora.texto);
    expect(Object.keys(u).sort()).toEqual(["atendimento", "criadoEm", "ha", "href", "id", "nome", "origem"]);
  }
  const elegiveis = linhas.filter((r) => !r.sinalizadores.teste && r.sinalizadores.duplicadoDe === undefined);
  expect(ult.length).toBe(Math.min(8, elegiveis.length));
  expect(ini.leadsChegando.ultimoEm).toBe(ult[0]?.criadoEm ?? null);
  // LGPD: nenhum telefone ou e-mail do fixture em lugar nenhum do objeto (o payload também conta).
  const json = JSON.stringify(ini);
  for (const c of contatosDe(e.data.leads)) expect(json.includes(c), c).toBe(false);
  expect(/"(phone|email|telefone)"/.test(json)).toBe(false);

  // 6. Custo por reunião: nunca a razão abaixo da régua; o fato leva o n das reuniões de conversão
  //    — menos com as reuniões em quarentena (o cartão diz "—": o fato não imprime a contagem).
  const n = k.reunioesConversao.valor;
  if (custoExibivel(k.custoPorReuniao)) {
    expect(ini.cartoes.custoReuniao).toBe(`${mostrar(k.custoPorReuniao, "moeda")} por reunião de conversão`);
  } else if (k.reunioesConversao.confianca?.nivel === "quarentena") {
    expect(ini.cartoes.custoReuniao).not.toMatch(/por reunião|\d+ reuni/);
  } else {
    expect(ini.cartoes.custoReuniao).not.toMatch(/por reunião/);
    expect(ini.cartoes.custoReuniao).toContain(`· ${formatInt(n)} ${n === 1 ? "reunião" : "reuniões"} de conversão`);
  }
  expect(ini.cartoes.custo).toEqual(fatoDoCustoPorReuniao(k));

  // 7. O último post do rodapé é o de Posts e da IA.
  expect(ini.rodape.diasDesdeUltimoPost).toBe(postingCadence(e.data.igPosts, undefined, e.agora, e.data.creatives).daysSinceLast);
  expect(ini.rodape.diasDesdeUltimoPost).toBe(postingCadence(e.data.igPosts, e.range, e.agora, e.data.creatives).daysSinceLast);
  return ini;
}

// ---------------------------------------------------------------- seed (robô desligado)

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

describe("portão do Início: o seed (robô desligado), 3 períodos", () => {
  const data = porMarca(buildSeedData(), "consorcio");
  const eventos = buildSeedLeadEvents(data.leads);
  const HOJE = "2026-07-23";
  const AGORA = brt(HOJE, "15:00");
  const cobertura: Intervalo[] = [{ from: "2026-07-09", to: "2026-07-21" }];
  for (const chave of ["7d", "30d", "all"]) {
    it(`consorcio · ${chave}`, () => {
      const { range, rangeKey } = pageRange(data, chave, HOJE);
      const kpis = kpisDoPeriodo(data, range, { cobertura, hoje: HOJE, agora: AGORA, comparar: true });
      const e: EntradaInicio = {
        data,
        range,
        rangeKey,
        kpis,
        eventos,
        cobertura,
        expediente: EXPEDIENTE_PADRAO,
        filaLive: montarFilaDaLive(data.leads, eventos, AGORA, EXPEDIENTE_PADRAO),
        agora: AGORA,
        hoje: HOJE,
      };
      const ini = conferir(e);
      expect(kpis.leads.valor).toBeGreaterThan(0);
      // Sem o robô: o funil do painel e as frases do processo antigo.
      expect(ini.atendimento.roboLigado).toBe(false);
      expect(ini.atendimento.funilComRobo).toBe(false);
      expect(ini.atendimento.funil.map((d) => d.id)).toEqual(["leads", "agendaram", "realizadas"]);
      expect(ini.atendimento.leituraParada).toBeNull();
      for (const f of ini.atendimento.frases) expect(["live", "novo", "retornar", "confirmar", "sem-desfecho"]).toContain(f.id);
      expect(ini.atendimento.dica).toMatch(/Sem o robô/);
      // Os links levam o período (o padrão da página também: o que a tela MOSTRA).
      const comRange = chave === "all" ? "" : `range=${chave}`;
      for (const l of ini.rodape.links) expect(l.href.includes(comRange)).toBe(true);
      for (const u of ini.leadsChegando.ultimos) expect(u.href.startsWith(`/leads/${encodeURIComponent(u.id)}`)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------- robô de fixture

const HOJE = "2026-11-04"; // quarta
const ONTEM = "2026-11-03";
const AGORA = brt(HOJE, "15:00");
const LIDO = brt(HOJE, "14:55");
const ROBO: RoboAgora = { ligado: true, lidoAte: LIDO, confiavel: true, sync: { ultimoOk: LIDO, falha: null } };
const SEMANA: DateRange = { from: "2026-10-29", to: HOJE };
const LARGO: DateRange = { from: "2026-10-15", to: HOJE };

let seq = 0;
const lead = (id: string, over: Partial<Lead> = {}): Lead => ({
  id,
  brand: "consorcio",
  createdAt: brt(HOJE, "09:00"),
  name: `Pessoa ${id}`,
  email: `pessoa.${id}@exemplo.com.br`,
  // Um número por pessoa (a Fila junta quem tem o mesmo telefone).
  phone: `55119888${String(++seq).padStart(5, "0")}`,
  status: "lead",
  utmSource: "meta",
  ...over,
});

/** Visto e saudado pelo robô às 09:00 de `dia`. */
const saudado = (dia: string, over: Partial<Lead> = {}): Partial<Lead> => ({
  createdAt: brt(dia, "09:00"),
  roboVistoEm: brt(dia, "09:05"),
  roboRecebidoEm: brt(dia, "09:00"),
  roboSaudacaoEm: brt(dia, "09:00"),
  roboEtapa: "nao_respondeu",
  ...over,
});

const reaberto = (leadId: string, quando: string, actor: string): LeadEvent => ({
  id: `R-${leadId}`,
  leadId,
  leadName: "x",
  actor,
  action: "reaberto",
  createdAt: quando,
});

const LEADS_DO_ROBO: Lead[] = [
  lead("conversa", {
    ...saudado(HOJE),
    roboRespondeuEm: brt(HOJE, "09:30"),
    roboUltimaMsgClienteEm: brt(HOJE, "12:00"),
    roboUltimaInteracaoEm: brt(HOJE, "12:00"),
    roboEtapa: "em_conversa",
  }),
  lead("esperando", saudado(HOJE)),
  lead("semresposta", saudado(ONTEM)),
  lead("aceitou", {
    ...saudado(ONTEM),
    roboRespondeuEm: brt(ONTEM, "09:10"),
    roboUltimaMsgClienteEm: brt(HOJE, "13:00"),
    roboUltimaInteracaoEm: brt(HOJE, "13:00"),
    roboConviteEm: brt(HOJE, "12:00"),
    roboAceitouEm: brt(HOJE, "13:00"),
    roboEtapa: "transferido",
  }),
  lead("naofalou", { createdAt: brt(HOJE, "11:00") }), // 4 h sem registro no robô: resgate
  lead("naorecebeu", { createdAt: brt(HOJE, "14:30") }), // 25 min: sem a 1ª mensagem
  lead("novinho", { createdAt: brt(HOJE, "14:50") }), // o robô ainda não teve tempo
  lead("semtel", { createdAt: brt(HOJE, "10:00"), phone: undefined }),
  lead("liveA", { createdAt: brt(HOJE, "10:00"), classe: "A" }),
  lead("agendado", {
    ...saudado("2026-11-01"),
    roboRespondeuEm: brt("2026-11-01", "09:10"),
    roboAceitouEm: brt("2026-11-01", "10:00"),
    roboEtapa: "transferido",
    status: "agendado",
    bookedAt: brt("2026-11-02", "10:00"),
    meetingFor: brt("2026-11-05", "10:00"),
  }),
  // Reaberto pelo ADMIN (painel): a reabertura nunca chega ao robô — fora de "Com o robô".
  lead("reabpainel", {
    ...saudado("2026-10-30"),
    roboRespondeuEm: brt("2026-10-30", "09:10"),
    roboAceitouEm: brt("2026-10-30", "10:00"),
    roboUltimaInteracaoEm: brt("2026-10-30", "10:00"),
    roboEtapa: "transferido",
  }),
  // Reaberto por uma inscrição nova (LP): o robô recebe; os fatos de antes são da conversa antiga.
  lead("reablp", {
    ...saudado("2026-10-30"),
    roboRespondeuEm: brt("2026-10-30", "09:10"),
    roboAceitouEm: brt("2026-10-30", "10:00"),
    roboUltimaInteracaoEm: brt("2026-10-30", "10:00"),
    roboEtapa: "transferido",
  }),
  // Antes do robô (20/10): nunca entra na base do robô.
  lead("antes", { createdAt: brt("2026-10-20", "10:00") }),
];
const EVENTOS_DO_ROBO: LeadEvent[] = [
  reaberto("reabpainel", brt(ONTEM, "10:00"), "admin"),
  reaberto("reablp", brt(ONTEM, "09:00"), ATOR_LP),
];

function entradaDoRobo(over: {
  leads?: Lead[];
  eventos?: LeadEvent[];
  range?: DateRange | undefined;
  robo?: RoboAgora | undefined;
  filaLive?: ItemDaFilaLive[];
} = {}): EntradaInicio {
  const data = base({
    leads: over.leads ?? LEADS_DO_ROBO,
    adDaily: [ad("2026-11-01", "100001", 100), ad("2026-11-02", "100001", 100), ad(ONTEM, "100001", 100), ad(HOJE, "100001", 50)],
    igPosts: [post("p1", brt("2026-10-26", "22:00"))],
  });
  const eventos = over.eventos ?? EVENTOS_DO_ROBO;
  const range = "range" in over ? over.range : SEMANA;
  const robo = "robo" in over ? over.robo : ROBO;
  const rangeKey = range ? `${range.from}..${range.to}` : "all";
  return {
    data,
    range,
    rangeKey,
    kpis: kpisDoPeriodo(data, range, { hoje: HOJE, agora: AGORA, comparar: true }),
    eventos,
    robo,
    expediente: EXPEDIENTE_PADRAO,
    filaLive: over.filaLive ?? montarFilaDaLive(data.leads, eventos, AGORA, EXPEDIENTE_PADRAO),
    agora: AGORA,
    hoje: HOJE,
  };
}

describe("portão do Início: o robô de fixture (colunas robo_*), 3 períodos", () => {
  for (const [nome, range] of [
    ["semana", SEMANA],
    ["desde 15/10", LARGO],
    ["campanha", undefined],
  ] as const) {
    it(nome, () => {
      const ini = conferir(entradaDoRobo({ range }));
      expect(ini.atendimento.roboLigado).toBe(true);
      expect(ini.atendimento.funilComRobo).toBe(true);
    });
  }

  it("o funil da semana: quem passa pelo robô, aninhado, com taxa só sobre a base", () => {
    const e = entradaDoRobo();
    const f = funilDoAtendimento(e);
    // 12 leads na semana; com o robô ficam 8 (fora: o que entrou há 10 min, sem
    // telefone, o inscrito da live e o reaberto pelo admin).
    expect(f.leads).toBe(12);
    expect(f.degraus.map((d) => [d.id, d.valor])).toEqual([
      ["leads", 12],
      ["com-robo", 8],
      ["primeira-msg", 5],
      ["responderam", 3],
      ["aceitaram", 2],
      ["agendaram", 1],
    ]);
    const taxa = Object.fromEntries(f.degraus.map((d) => [d.id, d.taxa]));
    expect(taxa["com-robo"]).toBeNull(); // recorte, não passagem (o ⓘ diz "N dos M")
    expect(taxa["primeira-msg"]).toBeCloseTo(5 / 8, 9);
    expect(taxa.responderam).toBeCloseTo(3 / 5, 9);
    expect(taxa.aceitaram).toBeCloseTo(2 / 3, 9);
    expect(taxa.agendaram).toBeCloseTo(1 / 12, 9);
    expect(f.degraus.find((d) => d.id === "agendaram")).toMatchObject({ base: "leads", doRobo: false });
    // Quem ficou fora, por motivo: a soma fecha com os leads do período.
    expect(f.fora).toEqual({ antes: 0, semTelefone: 1, live: 1, recentes: 1, depoisDaLeitura: 0, reabertosNoPainel: 1 });
    expect(f.noRobo + Object.values(f.fora).reduce((s, v) => s + v, 0)).toBe(f.leads);
    const ini = montarInicio(e);
    expect(ini.atendimento.dica).toContain(
      "8 dos 12 leads passam pelo robô; fora: 1 sem telefone, 1 inscrito da live, 1 recém-chegado (o robô ainda não teve tempo), 1 reaberto no painel.",
    );
    expect(ini.atendimento.recorte).toBe("leads de 29/10 a 04/11");
  });

  it("reaberto pela LP com a conversa continuada (o robô não regravou a saudação): 1ª mensagem e Responderam, como na Fila e no alerta", () => {
    // Saudado em 30/10, reaberto pela página em 03/11 09:00; o robô seguiu a MESMA conversa.
    const continuou = lead("continuou", {
      ...saudado("2026-10-30"),
      roboUltimaInteracaoEm: brt(ONTEM, "10:00"),
      roboUltimaMsgClienteEm: brt(ONTEM, "10:05"),
      roboEtapa: "em_conversa",
    });
    const eventos = [reaberto("continuou", brt(ONTEM, "09:00"), ATOR_LP)];
    const e = entradaDoRobo({ leads: [continuou], eventos, filaLive: [] });
    const f = funilDoAtendimento(e);
    expect(f.degraus.map((d) => [d.id, d.valor])).toEqual([
      ["leads", 1],
      ["com-robo", 1],
      ["primeira-msg", 1],
      ["responderam", 1],
      ["aceitaram", 0],
      ["agendaram", 0],
    ]);
    // A MESMA régua da Fila, da barra e do alerta: em conversa, com a 1ª mensagem do episódio.
    const s = situacaoDoRobo(continuou, { agora: AGORA, ref: refDoRobo(ROBO, AGORA), ligado: true, reabertoEm: brt(ONTEM, "09:00") });
    expect(s).toMatchObject({ respondeu: true, semPrimeiraMsg: false, balde: "em-conversa", falouEm: brt(ONTEM, "09:00") });
    expect(semMensagemDoRobo([continuou], reabertosPorLead(eventos), ROBO, AGORA, reabertosNoPainel(eventos)).total).toBe(0);
  });

  it("uma semana só de inscritos da live: o trecho do robô fica (Com o robô 0) e o ⓘ diz o motivo real", () => {
    const inscritos = (["A", "B", "C", "A"] as const).map((classe, i) => lead(`insc${i}`, { createdAt: brt(ONTEM, `1${i}:00`), classe }));
    const ini = montarInicio(entradaDoRobo({ leads: inscritos, eventos: [] }));
    expect(ini.atendimento.funilComRobo).toBe(true);
    expect(ini.atendimento.funil.map((d) => [d.id, d.valor])).toEqual([
      ["leads", 4],
      ["com-robo", 0],
      ["primeira-msg", 0],
      ["responderam", 0],
      ["aceitaram", 0],
      ["agendaram", 0],
    ]);
    expect(ini.atendimento.funil.filter((d) => d.doRobo).every((d) => d.taxa === null)).toBe(true);
    expect(ini.atendimento.dica).toContain("0 dos 4 leads passam pelo robô; fora: 4 inscritos da live.");
    expect(ini.atendimento.dica).not.toMatch(/Nenhum lead do período passou pelo robô/);
  });

  it("lead de antes do robô e lead reaberto não sobem nenhuma taxa do robô", () => {
    const limpos = LEADS_DO_ROBO.filter((l) => !["antes", "reabpainel", "reablp"].includes(l.id));
    const sem = funilDoAtendimento(entradaDoRobo({ leads: limpos, eventos: [], range: LARGO }));
    const com = funilDoAtendimento(entradaDoRobo({ range: LARGO }));
    for (const id of ["primeira-msg", "responderam", "aceitaram"] as const) {
      const a = sem.degraus.find((d) => d.id === id)!.taxa!;
      const b = com.degraus.find((d) => d.id === id)!.taxa!;
      expect(b, id).toBeLessThanOrEqual(a + 1e-12);
    }
    // O reaberto pela LP entra na base (o robô recebe a inscrição nova), mas a saudação
    // de antes do reaberto é da conversa antiga: não vira "1ª mensagem".
    expect(com.degraus.find((d) => d.id === "com-robo")!.valor).toBe(sem.degraus.find((d) => d.id === "com-robo")!.valor + 1);
    expect(com.degraus.find((d) => d.id === "primeira-msg")!.valor).toBe(sem.degraus.find((d) => d.id === "primeira-msg")!.valor);
  });

  it("período todo antes do robô: o funil do painel, mesmo com o robô ligado hoje", () => {
    const antigos = [lead("a1", { createdAt: brt("2026-10-10", "10:00") }), lead("a2", { createdAt: brt("2026-10-11", "10:00"), status: "agendado", bookedAt: brt("2026-10-12", "10:00") })];
    const ini = montarInicio(entradaDoRobo({ leads: antigos, eventos: [], range: { from: "2026-10-05", to: "2026-10-18" } }));
    expect(ini.atendimento.funilComRobo).toBe(false);
    expect(ini.atendimento.funil.map((d) => d.id)).toEqual(["leads", "agendaram", "realizadas"]);
    expect(ini.atendimento.dica).toMatch(/Nenhum lead do período passou pelo robô/);
    // A campanha inteira só com leads de antes do robô: o mesmo funil do painel.
    const tudo = montarInicio(entradaDoRobo({ leads: antigos, eventos: [], range: undefined }));
    expect(tudo.atendimento.funil.map((d) => d.id)).toEqual(["leads", "agendaram", "realizadas"]);
  });

  it("leitura parada: os fatos do robô viram '≥ N', sem taxa nenhuma do robô, e a 1ª linha diz desde quando", () => {
    const parado: RoboAgora = {
      ligado: true,
      lidoAte: brt(HOJE, "12:00"),
      confiavel: false,
      sync: { ultimoOk: brt(HOJE, "12:00"), falha: { desde: brt(HOJE, "12:30"), erro: "timeout" } },
    };
    const ini = conferir(entradaDoRobo({ robo: parado }));
    const doRobo = ini.atendimento.funil.filter((d) => d.doRobo);
    expect(doRobo.length).toBeGreaterThan(0);
    expect(doRobo.every((d) => d.taxa === null)).toBe(true);
    // TODO degrau do robô, o "Com o robô" inclusive (quem entrou depois da leitura ainda não conta).
    expect(doRobo.map((d) => d.id)).toContain("com-robo");
    for (const d of doRobo) {
      expect(d.piso, d.id).toBe(true);
      expect(d.texto).toBe(`≥ ${formatInt(d.valor)}`);
    }
    expect(ini.atendimento.leituraParada).toEqual({ desde: brt(HOJE, "12:30"), texto: "Robô sem leitura desde 04/11 12:30 ⚠" });
    // Parada, o número do "sem a 1ª mensagem" não se sustenta: a frase sai (o ⚠ é o sync-robo).
    expect(ini.atendimento.frases.some((f) => f.id === "sem-1a-msg")).toBe(false);
    // A Fila continua.
    expect(ini.atendimento.frases.some((f) => f.id === "resgate")).toBe(true);

    const nunca: RoboAgora = { ligado: true, lidoAte: null, confiavel: false, sync: { ultimoOk: null, falha: null } };
    expect(montarInicio(entradaDoRobo({ robo: nunca })).atendimento.leituraParada).toEqual({ desde: null, texto: "Robô ainda não lido ⚠" });
  });

  it("leitura parada há 90 min, ainda 'confiável': quem entrou depois dela fica fora e o 'Com o robô' sai '≥ N'", () => {
    const lido = brt(HOJE, "13:30"); // agora − 90 min: parada (> 45 min), mas a régua ainda mede contra ela (≤ 2 h)
    const atrasado: RoboAgora = { ligado: true, lidoAte: lido, confiavel: true, sync: { ultimoOk: lido, falha: null } };
    const e = entradaDoRobo({ robo: atrasado });
    const f = funilDoAtendimento(e);
    expect(f.parada).toBe(true);
    // "naorecebeu" (14:30) entrou depois da leitura − 15 min; "novinho" (14:50), há menos de 15 min.
    expect(f.fora).toMatchObject({ depoisDaLeitura: 1, recentes: 1 });
    const comRobo = f.degraus.find((d) => d.id === "com-robo")!;
    expect(comRobo).toMatchObject({ valor: 7, piso: true, taxa: null, texto: "≥ 7" });
    const ini = conferir(e);
    expect(ini.atendimento.dica).toContain("≥ 7 dos 12 leads passam pelo robô; fora:");
    expect(ini.atendimento.dica).toContain("1 depois da última leitura do robô");
  });

  it("as frases: a live, o Resgate e a 1ª mensagem do robô, com os números da Fila, da live e do alerta", () => {
    const e = entradaDoRobo();
    const ini = conferir(e);
    expect(ini.atendimento.frases.map((f) => f.id)).toEqual(["live", "resgate", "sem-1a-msg"]);
    expect(e.filaLive.map((i) => i.leadId)).toEqual(["liveA"]);
    const [live, resgate, semMsg] = ini.atendimento.frases;
    expect(live.texto).toBe("Live 01/12 · 1 na fila → Fila");
    expect(live.href).toBe("/fila?range=2026-10-29..2026-11-04#live");
    const fila = montarFila({ nowIso: AGORA, leads: e.data.leads, eventos: e.eventos, robo: ROBO });
    const g = fila.grupos.find((x) => x.etapa === "resgate")!;
    expect(resgate.texto).toBe(`Resgate · ${g.total}${g.foraDoPrazo > 0 ? ` · ${g.foraDoPrazo} fora do prazo` : ""} → Fila`);
    expect(resgate.href).toBe("/fila?etapa=resgate&range=2026-10-29..2026-11-04#resgate");
    // "naorecebeu" (25 min) e "naofalou" (4 h: também no resgate) — o número do alerta e da B1.
    expect(semMsg).toMatchObject({ texto: "Sem a 1ª mensagem do robô · 2 → Leads", total: 2, dono: "BOT" });
    // O título: pessoas, sem contar duas vezes; o MESMO número da /fila.
    expect(ini.atendimento.esperando).toBe(esperandoOComercial(fila, e.filaLive, true));
    expect(ini.atendimento.titulo).toBe(`Atendimento · ${ini.atendimento.esperando} esperando o comercial`);

    // Sem a live: o próximo da ordem entra ("Aceitou o convite").
    const semLive = montarInicio(entradaDoRobo({ filaLive: [] }));
    expect(semLive.atendimento.frases.map((f) => f.id)).toEqual(["resgate", "sem-1a-msg", "convite-aceito"]);
  });

  it("nada esperando: uma linha", () => {
    const frases = frasesDoAtendimento({
      fila: { grupos: [] },
      filaLive: [],
      roboLigado: true,
      semMensagem: 0,
      rangeKey: "7d",
    });
    expect(frases).toEqual([]);
    const ini = montarInicio(entradaDoRobo({ leads: [], eventos: [], filaLive: [] }));
    expect(ini.atendimento.vazio).toBe("Nada esperando o comercial agora.");
    expect(ini.atendimento.titulo).toBe("Atendimento · ninguém esperando");
  });

  it("robô desligado na mesma base: o processo antigo inteiro", () => {
    const ini = conferir(entradaDoRobo({ robo: undefined }));
    expect(ini.atendimento.funil.map((d) => d.id)).toEqual(["leads", "agendaram", "realizadas"]);
    expect(ini.atendimento.frases.every((f) => ["live", "novo", "retornar", "confirmar", "sem-desfecho"].includes(f.id))).toBe(true);
    expect(ini.atendimento.leituraParada).toBeNull();
    // Desligado (ligado: false) é a mesma coisa que ausente.
    const desligado = montarInicio(entradaDoRobo({ robo: { ...ROBO, ligado: false } }));
    expect(desligado.atendimento).toEqual(ini.atendimento);
  });
});

// ---------------------------------------------------------------- cartões e custo

describe("cartões: o custo por reunião pelo fato único (C4)", () => {
  const SEM: DateRange = { from: "2026-10-01", to: "2026-10-07" };
  const H = "2026-10-08";
  const A = "2026-10-08T15:00:00.000Z";
  // A semana coberta por sync: dia sem linha é pausa, não buraco (o investimento não vira piso).
  const COB: Intervalo[] = [{ from: "2026-10-01", to: "2026-10-07" }];
  const entrada = (data: DashboardData, opts: Parameters<typeof kpisDoPeriodo>[2] = {}): EntradaInicio => ({
    data,
    range: SEM,
    rangeKey: "2026-10-01..2026-10-07",
    kpis: kpisDoPeriodo(data, SEM, { hoje: H, agora: A, cobertura: COB, ...opts }),
    eventos: [],
    cobertura: COB,
    filaLive: [],
    agora: A,
    hoje: H,
  });
  const agendada = (id: string) =>
    lead(id, { createdAt: "2026-10-02T15:00:00.000Z", status: "agendado", bookedAt: "2026-10-03T15:00:00.000Z", meetingFor: "2026-11-01T15:00:00.000Z" });

  it("fontes divergentes: o cartão Reuniões vira '—' e o custo não imprime razão nem a contagem em quarentena", () => {
    const data = base({ adDaily: [ad("2026-10-05", "100001", 160)] });
    const ini = conferir(entrada(data, { roboReunioes: 3 }));
    expect(ini.cartoes.reunioes.texto).toBe("—");
    expect(ini.cartoes.custoReuniao).not.toMatch(/por reunião/);
    // Nenhum número de reuniões (nem o 0 que a trava manda não exibir).
    expect(ini.cartoes.custoReuniao).not.toMatch(/\d+ reuni/);
    expect(ini.cartoes.custoReuniao).toBe(`${formatCurrency0(160)} investidos · reuniões sem leitura confiável`);
    // A Mídia lê o mesmo fato (inteiro: sem o cartão de investimento ao lado).
    const k = kpisDoPeriodo(data, SEM, { hoje: H, agora: A, cobertura: COB, roboReunioes: 3 });
    expect(resumoDaMidia(k, []).custoPorReuniao).toMatchObject({ exibivel: false, texto: ini.cartoes.custo.fato });
    expect(ini.cartoes.custo.fato).toBe(`${formatCurrency0(160)} investidos em conversão · reuniões sem leitura confiável`);
  });

  it("0 e 3 reuniões de conversão: o fato com n = 0, e a razão com n = 3", () => {
    const zero = conferir(entrada(base({ adDaily: [ad("2026-10-05", "100001", 900)] })));
    expect(zero.cartoes.custo).toMatchObject({ exibivel: false, n: 0 });
    expect(zero.cartoes.custoReuniao).toBe(`${formatCurrency0(900)} investidos · 0 reuniões de conversão`);

    const tres = base({ adDaily: [ad("2026-10-05", "100001", 900)], leads: [agendada("r1"), agendada("r2"), agendada("r3")] });
    const ini = conferir(entrada(tres));
    expect(ini.cartoes.custo).toMatchObject({ exibivel: true, n: 3, valor: formatCurrency(300) });
    expect(ini.cartoes.custoReuniao).toBe(`${formatCurrency(300)} por reunião de conversão`);
    expect(ini.cartoes.reunioes.texto).toBe("3");

    // A Mídia lê o MESMO fato: valor no número quando se sustenta, senão o fato; n no rodapé.
    const k3 = kpisDoPeriodo(tres, SEM, { hoje: H, agora: A, cobertura: COB });
    expect(resumoDaMidia(k3, []).custoPorReuniao).toMatchObject({ exibivel: true, texto: formatCurrency(300), n: 3 });
    const um = base({ adDaily: [ad("2026-10-05", "100001", 160)], leads: [agendada("u1")] });
    const k1 = kpisDoPeriodo(um, SEM, { hoje: H, agora: A, cobertura: COB });
    expect(resumoDaMidia(k1, []).custoPorReuniao.texto).toBe(`${formatCurrency0(160)} investidos em conversão · 1 reunião de conversão`);
    // O cartão: os MESMOS números, sem o "em conversão" depois de "investidos" (o cartão ao lado já o diz).
    const cartaoUm = conferir(entrada(um)).cartoes;
    expect(cartaoUm.custo.fato).toBe(resumoDaMidia(k1, []).custoPorReuniao.texto);
    expect(cartaoUm.custoReuniao).toBe(`${formatCurrency0(160)} investidos · 1 reunião de conversão`);
  });

  it("período que ainda não começou (C9): nenhum cartão leva o anterior — nada de '−100%' contra hoje", () => {
    const H2 = "2026-11-05";
    const A2 = brt(H2, "15:00");
    const data = base({
      adDaily: [ad("2026-11-01", "100001", 80), ad("2026-11-04", "100001", 80), ad(H2, "100001", 80)],
      leads: [lead("h1", { createdAt: brt(H2, "09:00") }), lead("h2", { createdAt: brt(H2, "10:00") }), lead("h3", { createdAt: brt(H2, "11:00") })],
    });
    const { range, naoComecou } = pageRange(data, "2026-11-06..2026-11-12", H2);
    expect(naoComecou).toBe(true);
    expect(range).toEqual({ from: "2026-11-06", to: "2026-11-06" });
    // Com os kpis comparados (o "anterior" do 1º dia futuro é HOJE), o Início não leva o anterior...
    const k = kpisDoPeriodo(data, range, { hoje: H2, agora: A2, comparar: true });
    expect(k.leads.anterior).toBe(3);
    const ini = conferir({ data, range, rangeKey: "2026-11-06..2026-11-12", kpis: k, eventos: [], filaLive: [], agora: A2, hoje: H2 });
    for (const c of [ini.cartoes.investimento, ini.cartoes.cpl, ini.cartoes.leads, ini.cartoes.reunioes]) expect(c.anterior).toBeUndefined();
    expect(ini.cartoes.leads.texto).toBe("0");
    // ...e um período que já começou continua com ele.
    const semana = pageRange(data, "7d", H2).range;
    const k7 = kpisDoPeriodo(data, semana, { hoje: H2, agora: A2, comparar: true });
    expect(montarInicio({ data, range: semana, rangeKey: "7d", kpis: k7, eventos: [], filaLive: [], agora: A2, hoje: H2 }).cartoes.leads.anterior).toBe(k7.leads.anterior);
  });

  it("CPL sem lead de conversão: o motivo (ⓘ e ⚠) diz 'de conversão' quando o cartão de Leads conta orgânicos", () => {
    const org = (id: string) => lead(id, { createdAt: "2026-10-02T15:00:00.000Z", utmSource: "instagram", utmMedium: "bio" });
    const ads = [ad("2026-10-01", "100001", 100), ad("2026-10-02", "100001", 100)];
    const comOrg = conferir(entrada(base({ adDaily: ads, leads: [org("o1"), org("o2"), org("o3")] })));
    expect(comOrg.cartoes.leads.texto).toBe("3");
    expect(comOrg.cartoes.leadsOrganicos).toBe(3);
    expect(comOrg.cartoes.cpl.texto).toBe("—");
    expect(comOrg.cartoes.cpl.confianca?.motivo).toBe("Nenhum lead de conversão no período");
    // Sem lead nenhum, o texto de sempre.
    const semNada = conferir(entrada(base({ adDaily: ads })));
    expect(semNada.cartoes.leads.texto).toBe("0");
    expect(semNada.cartoes.cpl.confianca?.motivo).toBe("Nenhum lead registrado no período");
  });

  it("o fato herda o '≥' do investimento piso", () => {
    // 1 dia com linha em 7 (sem cobertura): o investimento é piso.
    const data = base({ adDaily: [ad("2026-10-05", "100001", 160)] });
    const k = kpisDoPeriodo(data, SEM, { hoje: H, agora: A });
    expect(k.investimentoConversao.confianca?.nivel).toBe("piso");
    expect(fatoDoCustoPorReuniao(k).fato).toBe(`≥ ${formatCurrency0(160)} investidos em conversão · 0 reuniões de conversão`);
    expect(fatoNoCartao(k, fatoDoCustoPorReuniao(k))).toBe(`≥ ${formatCurrency0(160)} investidos · 0 reuniões de conversão`);
    // Piso: sem minigráfico.
    expect(sparkDoInvestimento(data, SEM, k, undefined, H)).toBeNull();
  });
});

describe("cartões: o minigráfico do investimento (C3)", () => {
  const H = "2026-10-07";
  const A = brt(H, "15:00");
  const diasDe = (from: string, to: string) => {
    const out: string[] = [];
    for (let d = from; d <= to; d = somarDias(d, 1)) out.push(d);
    return out;
  };

  it("gasto de conversão por dia até ontem; os dias 'sem dados' do FIM saem; Σ + hoje = o cartão", () => {
    const R: DateRange = { from: "2026-09-24", to: H };
    const linhas = [
      ...diasDe("2026-09-24", "2026-10-05").map((d, i) => ad(d, "100001", 10 + i)),
      ...diasDe("2026-09-24", "2026-10-05").map((d) => ad(d, "200001", 7, { objective: "OUTCOME_AWARENESS" })),
      ad(H, "100001", 30), // hoje (parcial)
    ];
    const data = base({ adDaily: linhas }); // 06/10 (ontem) sem linha e sem cobertura: atraso da Meta
    const k = kpisDoPeriodo(data, R, { hoje: H, agora: A, cobertura: [{ from: "2026-09-24", to: "2026-10-04" }] });
    expect(k.investimentoConversao.confianca).toBeUndefined();
    const spark = sparkDoInvestimento(data, R, k, [{ from: "2026-09-24", to: "2026-10-04" }], H)!;
    expect(spark).toEqual(diasDe("2026-09-24", "2026-10-05").map((_, i) => 10 + i)); // sem a descoberta
    expect(spark.reduce((s, v) => s + v, 0) + 30).toBeCloseTo(k.investimentoConversao.valor, 6);
    const ini = conferir({
      data,
      range: R,
      rangeKey: "14d",
      kpis: k,
      eventos: [],
      cobertura: [{ from: "2026-09-24", to: "2026-10-04" }],
      filaLive: [],
      agora: A,
      hoje: H,
    });
    expect(ini.cartoes.sparkInvestimento).toEqual(spark);
    expect(ini.cartoes.investimento.dica).toMatch(/até ontem/);
  });

  it("dia pausado (coberto, sem linha) no meio entra como zero; buraco sem dados no meio some com o minigráfico", () => {
    const R: DateRange = { from: "2026-09-08", to: H };
    const todos = diasDe("2026-09-08", "2026-10-05");
    // 20/09 sem linha: coberto = pausa (zero no minigráfico); sem cobertura = buraco.
    const linhas = todos.filter((d) => d !== "2026-09-20").map((d) => ad(d, "100001", 10));
    const data = base({ adDaily: linhas });
    const coberto: Intervalo[] = [{ from: "2026-09-08", to: "2026-10-03" }];
    const k1 = kpisDoPeriodo(data, R, { hoje: H, agora: A, cobertura: coberto });
    const s1 = sparkDoInvestimento(data, R, k1, coberto, H)!;
    expect(s1).not.toBeNull();
    expect(s1[diasDe("2026-09-08", "2026-09-20").length - 1]).toBe(0);
    const k2 = kpisDoPeriodo(data, R, { hoje: H, agora: A });
    expect(k2.investimentoConversao.confianca).toBeUndefined(); // 2 de 29 dias: abaixo dos 10%
    expect(sparkDoInvestimento(data, R, k2, undefined, H)).toBeNull();
  });

  it("menos de 3 pontos: sem minigráfico", () => {
    const R: DateRange = { from: "2026-10-05", to: H };
    const data = base({ adDaily: [ad("2026-10-05", "100001", 10), ad("2026-10-06", "100001", 10), ad(H, "100001", 10)] });
    const k = kpisDoPeriodo(data, R, { hoje: H, agora: A });
    expect(sparkDoInvestimento(data, R, k, undefined, H)).toBeNull();
  });
});

// ---------------------------------------------------------------- leads chegando

describe("leads chegando: barras por dia de Brasília e a lista", () => {
  it("com agora = 09/10 01:00Z (22h do dia 08 em Brasília), o lead das 22h fica na barra de hoje (08)", () => {
    const agora = "2026-10-09T01:00:00.000Z";
    const hoje = hojeEmBrasilia(new Date(agora));
    expect(hoje).toBe("2026-10-08");
    const R: DateRange = { from: "2026-10-02", to: hoje };
    const data = base({ leads: [lead("noite", { createdAt: brt("2026-10-08", "22:00") }), lead("tarde", { createdAt: brt("2026-10-07", "15:00") })] });
    const dias = leadsPorDia(data, R, undefined, hoje);
    expect(dias.at(-1)).toEqual({ date: "2026-10-08", leads: 1, pausado: false });
    expect(dias.find((d) => d.date === "2026-10-07")?.leads).toBe(1);
    expect(dias.some((d) => d.date === "2026-10-09")).toBe(false);
    const ini = montarInicio({
      data,
      range: R,
      rangeKey: "7d",
      kpis: kpisDoPeriodo(data, R, { hoje, agora }),
      eventos: [],
      filaLive: [],
      agora,
      hoje,
    });
    expect(ini.leadsChegando.ultimos.map((u) => u.id)).toEqual(["noite", "tarde"]);
    // Entrou às 22h e agora são 22h em Brasília: "agora".
    expect(ini.leadsChegando.titulo).toBe("Leads · último agora");
    expect(ini.leadsChegando.ultimos[1].ha).toBe("há 1 d 7 h");
  });

  it("cinza só no dia PAUSADO (sem linha de conversão e coberto por sync); 'sem dados' não é marcado", () => {
    const H = "2026-10-07";
    const R: DateRange = { from: "2026-10-01", to: H };
    const data = base({
      adDaily: [
        ad("2026-10-02", "100001", 10),
        ad("2026-10-03", "100001", 10),
        ad("2026-10-04", "200001", 10, { objective: "OUTCOME_AWARENESS" }), // só descoberta
        ad(H, "100001", 10),
      ],
    });
    const cobertura: Intervalo[] = [{ from: "2026-10-01", to: "2026-10-05" }];
    const dias = leadsPorDia(data, R, cobertura, H);
    // 01/10 vem antes da 1ª linha de anúncio (02/10): a campanha não existia — coberto por sync
    // ou não, não é pausa (a mesma régua de `dailySeries` na Mídia e das coortes do Funil).
    expect(dias.filter((d) => d.pausado).map((d) => d.date)).toEqual(["2026-10-04", "2026-10-05"]);
    const serie = dailySeries(data, R, cobertura, H);
    expect(serie.find((p) => p.date === "2026-10-01")).toMatchObject({ semDado: false, semVeiculacao: false });
    expect(serie.find((p) => p.date === "2026-10-05")).toMatchObject({ semDado: false, semVeiculacao: true });
    const ini = montarInicio({ data, range: R, rangeKey: "7d", kpis: kpisDoPeriodo(data, R, { hoje: H, cobertura }), eventos: [], cobertura, filaLive: [], agora: brt(H, "12:00"), hoje: H });
    expect(ini.leadsChegando.faixasPausa).toEqual([{ from: "2026-10-04", to: "2026-10-05" }]);
    // Sem cobertura nenhuma: nenhum dia vira pausa (o que não se sabe não é pausa).
    expect(leadsPorDia(data, R, undefined, H).some((d) => d.pausado)).toBe(false);
    // Dia depois de hoje é futuro: nunca pausado.
    expect(leadsPorDia(data, { from: "2026-10-06", to: "2026-10-09" }, [{ from: "2026-10-01", to: "2026-10-31" }], H).filter((d) => d.pausado).map((d) => d.date)).toEqual(["2026-10-06"]);
  });

  it("a lista: os 8 mais recentes, sem teste e sem a CÓPIA de duplicado (o principal fica), 'agora' abaixo de 1 min", () => {
    const H = "2026-10-08";
    const agora = brt(H, "15:00");
    const R: DateRange = { from: "2026-10-01", to: H };
    const varios = Array.from({ length: 9 }, (_, i) => lead(`v${i}`, { createdAt: brt(`2026-10-0${i % 7 + 1}`, `1${i}:00`) }));
    const principal = lead("principal", { createdAt: brt("2026-10-02", "09:00"), email: "mesma.pessoa@exemplo.com.br" });
    const copia = lead("copia", { createdAt: brt(H, "14:58"), email: "mesma.pessoa@exemplo.com.br" });
    const teste = lead("teste", { createdAt: brt(H, "14:59"), email: "teste@exemplo.com.br" });
    const agoraMesmo = lead("agoramesmo", { createdAt: "2026-10-08T17:59:40.000Z" }); // 20 s antes de agora
    const data = base({ leads: [...varios, principal, copia, teste, agoraMesmo] });
    const ini = conferir({ data, range: R, rangeKey: "7d", kpis: kpisDoPeriodo(data, R, { hoje: H, agora }), eventos: [], filaLive: [], agora, hoje: H });
    const ids = ini.leadsChegando.ultimos.map((u) => u.id);
    expect(ids).toHaveLength(8);
    expect(ids[0]).toBe("agoramesmo");
    expect(ids).not.toContain("teste");
    expect(ids).not.toContain("copia");
    expect(ini.leadsChegando.ultimos[0].ha).toBe("agora");
    expect(ini.leadsChegando.titulo).toBe("Leads · último agora");
    // As barras contam todo mundo (o cartão de Leads também).
    expect(ini.leadsChegando.dias.reduce((s, d) => s + d.leads, 0)).toBe(13);
    // Origem curta: o anúncio, ou "—" sem origem.
    expect(ini.leadsChegando.ultimos.every((u) => u.origem.length <= 40)).toBe(true);
  });

  it("'agora' é menos de 1 min SEM arredondar: 45 s ainda é 'agora'; 60 s é 'há 1 min'", () => {
    const agora = "2026-10-08T18:00:00.000Z";
    expect(haQuanto("2026-10-08T17:59:15.000Z", agora)).toBe("agora");
    expect(haQuanto("2026-10-08T17:59:00.001Z", agora)).toBe("agora");
    expect(haQuanto("2026-10-08T17:59:00.000Z", agora)).toBe("há 1 min");
    expect(haQuanto("2026-10-08T17:58:31.000Z", agora)).toBe("há 1 min");
    // O título usa UMA unidade, para baixo (orçamento de palavras); a lista, o tempo inteiro.
    expect(haQuantoNoTitulo("2026-10-08T17:59:15.000Z", agora)).toBe("agora");
    expect(haQuantoNoTitulo("2026-10-08T17:35:00.000Z", agora)).toBe("há 25 min");
    expect(haQuantoNoTitulo("2026-10-08T12:01:00.000Z", agora)).toBe("há 5 h");
    expect(haQuanto("2026-10-08T12:01:00.000Z", agora)).toBe("há 5 h 59 min");
    expect(haQuantoNoTitulo("2026-10-05T17:00:00.000Z", agora)).toBe("há 3 d");
    expect(haQuantoNoTitulo("lixo", agora)).toBe("—");
    // Na virada de unidade o título e a lista arredondam do MESMO jeito (`formatarEspera`).
    const viradas: [number, string, string][] = [
      [59.6, "há 1 h", "há 1 h"],
      [59.4, "há 59 min", "há 59 min"],
      [119, "há 1 h 59 min", "há 1 h"],
      [23 * 60 + 59.6, "há 1 d", "há 1 d"],
      [47 * 60, "há 1 d 23 h", "há 1 d"],
      [47 * 60 + 40, "há 2 d", "há 2 d"],
    ];
    for (const [min, lista, titulo] of viradas) {
      const iso = new Date(Date.parse(agora) - min * 60_000).toISOString();
      expect([haQuanto(iso, agora), haQuantoNoTitulo(iso, agora)], `${min} min`).toEqual([lista, titulo]);
    }
    const H = "2026-10-08";
    const R: DateRange = { from: "2026-10-02", to: H };
    const data = base({ leads: [lead("quase", { createdAt: "2026-10-08T17:59:15.000Z" })] });
    const ini = montarInicio({ data, range: R, rangeKey: "7d", kpis: kpisDoPeriodo(data, R, { hoje: H, agora }), eventos: [], filaLive: [], agora, hoje: H });
    expect(ini.leadsChegando.titulo).toBe("Leads · último agora");
    expect(ini.leadsChegando.ultimos[0].ha).toBe("agora");
  });

  it("período sem lead: 'nenhum no período'", () => {
    const H = "2026-10-08";
    const R: DateRange = { from: "2026-10-01", to: H };
    const data = base({ leads: [lead("velho", { createdAt: brt("2026-09-01", "10:00") })] });
    const ini = montarInicio({ data, range: R, rangeKey: "7d", kpis: kpisDoPeriodo(data, R, { hoje: H }), eventos: [], filaLive: [], agora: brt(H, "12:00"), hoje: H });
    expect(ini.leadsChegando).toMatchObject({ titulo: "Leads · nenhum no período", ultimoEm: null, ultimos: [] });
  });

  it("período só com teste ou cópia de duplicado: o título não diz 'nenhum' ao lado do cartão que conta 2", () => {
    const H = "2026-11-04";
    const R: DateRange = { from: "2026-10-29", to: H };
    const agora = brt(H, "15:00");
    const data = base({
      leads: [
        lead("principal", { createdAt: brt("2026-10-01", "09:00"), email: "mesma.pessoa@exemplo.com.br" }),
        lead("copia", { createdAt: brt("2026-11-02", "10:00"), email: "mesma.pessoa@exemplo.com.br" }),
        lead("teste", { createdAt: brt("2026-11-03", "10:00"), name: "teste teste", email: "teste@teste.com" }),
      ],
    });
    const ini = conferir({ data, range: R, rangeKey: "7d", kpis: kpisDoPeriodo(data, R, { hoje: H, agora }), eventos: [], filaLive: [], agora, hoje: H });
    expect(ini.cartoes.leads.texto).toBe("2");
    expect(ini.leadsChegando.dias.reduce((s, d) => s + d.leads, 0)).toBe(2);
    expect(ini.leadsChegando).toMatchObject({ titulo: "Leads · só teste ou duplicado", ultimoEm: null, ultimos: [] });
  });
});

// ---------------------------------------------------------------- rodapé

describe("rodapé: o último post da grade", () => {
  const H = "2026-10-08";
  const agora = brt(H, "15:00");
  const R: DateRange = { from: "2026-10-02", to: H };
  const entrada = (igPosts: IgPost[]): EntradaInicio => {
    const data = base({ igPosts });
    return { data, range: R, rangeKey: "7d", kpis: kpisDoPeriodo(data, R, { hoje: H, agora }), eventos: [], filaLive: [], agora, hoje: H };
  };

  it("uma semana sem post é 'há 9 dias', nunca 'há 0' — o mesmo número do placar do Conteúdo", () => {
    const ini = conferir(entrada([post("p1", brt("2026-09-29", "22:00"))]));
    expect(ini.rodape.diasDesdeUltimoPost).toBe(9);
    expect(ini.rodape.links.find((l) => l.id === "posts")).toMatchObject({ rotulo: "Último post há 9 dias", href: "/conteudo?range=7d" });
    expect(ini.rodape.links.map((l) => l.href)).toEqual(["/funil?range=7d", "/midia?range=7d", "/conteudo?range=7d"]);
  });

  it("teste e impulsionado não contam; nunca houve post = 'Nenhum post ainda'", () => {
    const ini = conferir(entrada([post("t", brt(H, "10:00"), { isTest: true })]));
    expect(ini.rodape.diasDesdeUltimoPost).toBeNull();
    expect(ini.rodape.links.find((l) => l.id === "posts")?.rotulo).toBe("Nenhum post ainda");
    expect(textoDoUltimoPost(0)).toBe("Último post hoje");
    expect(textoDoUltimoPost(1)).toBe("Último post há 1 dia");
  });
});
