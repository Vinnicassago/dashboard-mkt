/**
 * Fase 2 (nov/26), etapa A2b — os alertas do Início (normal e live), a régua da
 * configuração fora do ⚠ (F18), o painel da live montado como a antiga `/live`
 * (C10/C11) e a IA lendo o Início (C12/F20). Puro; fixtures sintéticas. Instantes
 * em Z ou pelo `brt(dia, "HH:MM")` (Brasília, UTC−3), nunca texto sem fuso.
 */
import { describe, expect, it } from "vitest";
import { alertasDeConfianca } from "../alertas";
import { chavesDaLive } from "../atalho-live";
import { alertasDaLive, alertasDoInicio, montarBussola, montarModoLive } from "../bussola";
import { pendenciasDeConfiguracoes } from "../configuracoes";
import { montarFila } from "../fila";
import { montarFilaDaLive } from "../fila-live";
import { custoExibivel, kpisDoPeriodo, mostrar } from "../kpis";
import { coortesDoFunil } from "../funil";
import { dailySeries } from "../metrics";
import { pageRange } from "../page-range";
import { LIVE_PADRAO, type CampanhaDaLive } from "../live";
import { montarPainelLive, relatoriosDaLive } from "../live-painel";
import { parseCustomRange } from "../range";
import { primeiroNome, type RoboAgora } from "../robo/situacao";
import { assessTrust, type Trava } from "../trust";
import { EXPEDIENTE_PADRAO } from "../turno";
import { buildBriefing } from "../ai/briefing";
import type { AdDaily, DashboardData, Lead, LpDaily, Meta } from "../types";

const brt = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();

function base(over: Partial<DashboardData> = {}): DashboardData {
  return {
    campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-09-01", budgetTotal: 5000 },
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

const lp = (date: string, visits: number): LpDaily => ({ brand: "consorcio", date, visits, clicks: Math.round(visits / 2), formSubmits: 5 });

const meta = (metrica: Meta["metrica"], alvo: number): Meta => ({
  id: `${metrica}-2026-01-01`,
  brand: "consorcio",
  metrica,
  periodo: "semana",
  alvo,
  vigenteDesde: "2026-01-01",
  provisoria: false,
  origem: "manual",
  criadaEm: "2026-01-01T12:00:00.000Z",
  criadaPor: "teste",
});

// ---------------------------------------------------------------- F18: config fora do ⚠

describe("F18: meta e orçamento não cadastrados saem do ⚠ e ficam nas Pendências", () => {
  const semNada = base({ campaign: { ...base().campaign, budgetTotal: 0 }, metas: [] });
  const travasDe = (data: DashboardData) =>
    assessTrust({ data, range: { from: "2026-10-01", to: "2026-10-07" }, brandRules: [], kpis: { meetings: 0, leads: 0, spendConversao: 0, spendTotal: 0 }, hoje: "2026-10-08" }).travas;

  it("assessTrust continua gerando as duas travas de configuração (conversão: metas; awareness: goals)", () => {
    const ids = travasDe(semNada).filter((t) => t.nivel === "config").map((t) => t.id);
    expect(ids.sort()).toEqual(["budget-ausente", "metas-ausentes"]);
    // Com meta e orçamento, nenhuma.
    expect(travasDe(base({ metas: [meta("cpl", 50)] })).some((t) => t.nivel === "config")).toBe(false);
    // Awareness: a régua são as metas de conteúdo (`goals`).
    const krone = base({ campaign: { ...base().campaign, brand: "krone" }, goals: [] });
    expect(travasDe(krone).map((t) => t.id)).toContain("metas-ausentes");
    const kroneComMeta = base({ campaign: { ...base().campaign, brand: "krone" }, goals: [{ brand: "krone", metric: "followers", period: "campanha", target: 1000 }] });
    expect(travasDe(kroneComMeta).map((t) => t.id)).not.toContain("metas-ausentes");
  });

  it("alertasDeConfianca descarta as 'config' e mantém o resto, com o id da trava", () => {
    const travas: Trava[] = [
      { id: "metas-ausentes", nivel: "config", titulo: "Nenhuma meta cadastrada", detalhe: "x", afeta: [], cta: { label: "Montar as metas", href: "/configuracoes#metas" } },
      { id: "budget-ausente", nivel: "config", titulo: "Orçamento", detalhe: "x", afeta: [], cta: { label: "Cadastrar orçamento", href: "/configuracoes#orcamento" } },
      { id: "sem-lead", nivel: "quarentena", titulo: "Sem lead", detalhe: "x", afeta: ["cpl"] },
      { id: "cobertura-de-dias", nivel: "piso", titulo: "Dias sem dado", detalhe: "x", afeta: ["spend"] },
    ];
    const al = alertasDeConfianca(travas);
    expect(al.map((a) => a.id)).toEqual(["trava-sem-lead", "trava-cobertura-de-dias"]);
    expect(al.some((a) => a.nivel === "config")).toBe(false);
    // As MESMAS travas continuam em Configurações → Pendências → Preencher.
    const p = pendenciasDeConfiguracoes(travas, "7d");
    expect(p.preencher.map((x) => x.id)).toEqual(["metas-ausentes", "budget-ausente"]);
    expect(p.preencher[0].link?.href).toBe("/configuracoes?range=7d#metas");
  });

  it("com travas reais de assessTrust: o ⚠ fica sem config e as Pendências com as duas", () => {
    const travas = travasDe(semNada);
    expect(alertasDeConfianca(travas).some((a) => a.id === "trava-metas-ausentes" || a.id === "trava-budget-ausente")).toBe(false);
    expect(pendenciasDeConfiguracoes(travas).preencher.map((x) => x.id).sort()).toEqual(["budget-ausente", "metas-ausentes"]);
  });
});

// ---------------------------------------------------------------- F19: alertas do Início

describe("F19: os alertas do Início (modo normal)", () => {
  const HOJE = "2026-10-08";
  const AGORA = brt(HOJE, "12:00");
  const data = base({
    campaign: { ...base().campaign, budgetTotal: 0 },
    adDaily: [ad("2026-10-02", "100001", 300)],
    lpDaily: [lp("2026-09-10", 500)],
  });
  const kpisDe = (range: { from: string; to: string } | undefined) => kpisDoPeriodo(data, range, { hoje: HOJE, agora: AGORA });

  it("período passado sem linha da LP: 'lp-sem-dado', sem citar 'Onde trava'; e nada de config no ⚠", () => {
    const range = { from: "2026-10-01", to: "2026-10-07" };
    const al = alertasDoInicio({ data, range, kpis: kpisDe(range), hoje: HOJE });
    const lpSem = al.find((a) => a.id === "lp-sem-dado");
    expect(lpSem).toMatchObject({ nivel: "aviso", titulo: "O rastreio da landing page parou: sem visitas registradas no período" });
    expect(`${lpSem?.titulo} ${lpSem?.detalhe}`).not.toMatch(/Onde trava/);
    expect(al.some((a) => a.nivel === "config")).toBe(false);
    // As travas que desqualificam número continuam (sem lead → CPL "—").
    expect(al.map((a) => a.id)).toContain("trava-sem-lead");
  });

  it("período que ainda não começou (C9): sem 'lp-sem-dado' (não é o rastreio parado)", () => {
    const futuro = { from: "2026-10-20", to: "2026-10-20" };
    const al = alertasDoInicio({ data, range: futuro, kpis: kpisDe(futuro), hoje: HOJE });
    expect(al.some((a) => a.id === "lp-sem-dado")).toBe(false);
    expect(al.some((a) => a.id === "trava-cobertura-de-dias")).toBe(false);
  });

  it("período INTEIRO antes do 1º dado (C9, caso 2): sem 'lp-sem-dado' nem a cobertura — a LP e a campanha não existiam", () => {
    const desde = (de: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${de}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
    const dias = desde("2026-09-15", 23); // 15/09 a 07/10
    const comHistorico = base({
      adDaily: dias.map((d) => ad(d, "100001", 50)),
      lpDaily: dias.map((d) => lp(d, 100)),
    });
    const { range } = pageRange(comHistorico, "2026-08-01..2026-08-07", HOJE);
    expect(range).toEqual({ from: "2026-08-01", to: "2026-08-07" });
    const k = kpisDoPeriodo(comHistorico, range, { hoje: HOJE, agora: AGORA });
    expect(k.trust.travas.map((t) => t.id)).not.toContain("cobertura-de-dias");
    expect(k.investimentoConversao.confianca).toBeUndefined();
    const ids = alertasDoInicio({ data: comHistorico, range, kpis: k, hoje: HOJE }).map((a) => a.id);
    expect(ids).not.toContain("lp-sem-dado");
    expect(ids).not.toContain("trava-cobertura-de-dias");
    // O gráfico diário da Mídia e as coortes do Funil também não marcam "sem dados" antes do 1º dado.
    expect(dailySeries(comHistorico, range, undefined, HOJE).some((p) => p.semDado)).toBe(false);
    expect(coortesDoFunil(comHistorico, range, { agora: AGORA, hoje: HOJE }).every((c) => c.veiculacao === "ok")).toBe(true);
    // Um período DEPOIS do início, sem linha da LP e sem anúncio, continua com os dois.
    const depois = base({ adDaily: [ad("2026-09-15", "100001", 50)], lpDaily: [lp("2026-09-15", 100)] });
    const r2 = { from: "2026-10-01", to: "2026-10-07" };
    const k2 = kpisDoPeriodo(depois, r2, { hoje: HOJE, agora: AGORA });
    const ids2 = alertasDoInicio({ data: depois, range: r2, kpis: k2, hoje: HOJE }).map((a) => a.id);
    expect(ids2).toEqual(expect.arrayContaining(["lp-sem-dado", "trava-cobertura-de-dias"]));
    // E um período que começa antes do 1º dado e entra nele: só os dias depois dele contam.
    const meio = { from: "2026-09-10", to: "2026-09-20" };
    expect(kpisDoPeriodo(comHistorico, meio, { hoje: HOJE, agora: AGORA }).trust.travas.map((t) => t.id)).not.toContain("cobertura-de-dias");
  });

  it("campanha inteira (sem range) e período com linha da LP: sem 'lp-sem-dado'", () => {
    expect(alertasDoInicio({ data, range: undefined, kpis: kpisDe(undefined), hoje: HOJE }).some((a) => a.id === "lp-sem-dado")).toBe(false);
    const comLp = base({ lpDaily: [lp("2026-10-03", 100)] });
    const range = { from: "2026-10-01", to: "2026-10-07" };
    expect(alertasDoInicio({ data: comLp, range, kpis: kpisDoPeriodo(comLp, range, { hoje: HOJE }), hoje: HOJE }).some((a) => a.id === "lp-sem-dado")).toBe(false);
  });
});

// ---------------------------------------------------------------- C10/C11: o modo live

/** A conta da antiga `live/page.tsx` (05/11), copiada literalmente — o painel tem de receber o MESMO recorte. */
function rangeDaLiveAntiga(chave: string, cfg: CampanhaDaLive, hoje: string) {
  const livre = parseCustomRange(chave)!;
  const de = livre.from ?? cfg.periodo.de;
  const ateBruto = livre.to ?? cfg.periodo.ate;
  const ate = ateBruto > hoje ? hoje : ateBruto;
  const naoComecou = de > hoje;
  return naoComecou ? { de, ate: de } : { de, ate };
}

describe("C10/C11: o painel da live no Início", () => {
  const cfg = LIVE_PADRAO;
  const chaves = chavesDaLive(cfg);
  const inscrito = (id: string, dia: string, over: Partial<Lead> = {}): Lead => ({
    id,
    brand: "consorcio",
    createdAt: brt(dia, "10:00"),
    name: `Inscrito ${id}`,
    phone: `5511977700${id.padStart(3, "0")}`,
    status: "lead",
    utmSource: "meta",
    bem: "imovel",
    classe: "A",
    ...over,
  });
  const data = base({
    adDaily: [ad("2026-11-16", "100001", 250, { campaign: "[LIVE] Captação" }), ad("2026-11-17", "100001", 250, { campaign: "[LIVE] Captação" })],
    leads: [inscrito("1", "2026-11-16"), inscrito("2", "2026-11-17"), inscrito("3", "2026-11-20", { classe: "B" })],
  });

  for (const hoje of ["2026-11-05", "2026-11-20", "2026-12-20"]) {
    for (const periodo of ["campanha", "captacao", "posLive"] as const) {
      it(`${periodo} com hoje = ${hoje}: o recorte e o painel são os da antiga /live`, () => {
        const agora = brt(hoje, "15:00");
        const chave = chaves[periodo];
        const m = montarModoLive({ data, eventos: [], cfg, expediente: EXPEDIENTE_PADRAO, chave, periodo, hoje, agora });
        const antigo = rangeDaLiveAntiga(chave, cfg, hoje);
        expect({ de: m.rangePainel.de, ate: m.rangePainel.ate }).toEqual(antigo);
        expect(m.rangePainel.naoComecou).toBe(antigo.de > hoje);
        const p = montarPainelLive({ data, eventos: [], cfg, expediente: EXPEDIENTE_PADRAO, range: antigo, hoje, agora });
        expect(m.painel).toEqual(p);
        expect(m.relatorios).toEqual(relatoriosDaLive(p, cfg, hoje));
        // Os sub-atalhos viram links do Início, e os links fixos levam o período.
        expect(m.subAtalhos.map((s) => s.href)).toEqual([chaves.campanha, chaves.captacao, chaves.posLive].map((k) => `/?range=${k}`));
        expect(m.subAtalhos.filter((s) => s.atual).map((s) => s.id)).toEqual([periodo]);
        expect(m.links).toEqual({ filaDaLive: `/fila?range=${chave}#live` });
      });
    }
  }

  it("alertas do modo live: qualidade, atribuição e a cobertura de dias — nunca as travas de CPL e custo por reunião", () => {
    const hoje = "2026-11-21";
    const range = { from: "2026-11-16", to: "2026-11-20" };
    // Gasto num dia só (sem cobertura): os outros viram "sem dados" → piso; sem reunião → quarentena do custo.
    const d = base({ adDaily: [ad("2026-11-16", "100001", 250, { campaign: "[LIVE] Captação" })] });
    const kpis = kpisDoPeriodo(d, range, { hoje });
    const travas = kpis.trust.travas.map((t) => t.id);
    expect(travas).toContain("cobertura-de-dias");
    expect(travas).toContain("sem-reuniao");
    expect(travas).toContain("sem-lead");
    const live = montarModoLive({ data: d, eventos: [], cfg, expediente: EXPEDIENTE_PADRAO, chave: chaves.campanha, periodo: "campanha", hoje, agora: brt(hoje, "15:00") });
    const al = alertasDaLive({ data: d, range, kpis, live, hoje });
    const ids = al.map((a) => a.id);
    expect(ids).toContain("trava-cobertura-de-dias");
    expect(ids.filter((id) => id.startsWith("trava-"))).toEqual(["trava-cobertura-de-dias"]);
    // A campanha [LIVE] casou: nada de "nenhuma campanha".
    expect(ids).not.toContain("live-sem-campanhas");
    // O Início normal, no mesmo período, registra as do custo.
    expect(alertasDoInicio({ data: d, range, kpis, hoje }).map((a) => a.id)).toEqual(expect.arrayContaining(["trava-sem-reuniao", "trava-sem-lead"]));
  });

  it("'nenhuma campanha casou' vira alerta 'aviso' só a partir do 1º dia da régua", () => {
    const d = base({ adDaily: [ad("2026-11-03", "100001", 100)] }); // nenhuma [LIVE]
    for (const [hoje, espera] of [
      ["2026-11-05", false],
      ["2026-11-15", false],
      ["2026-11-16", true],
      ["2026-12-20", true],
    ] as const) {
      const live = montarModoLive({ data: d, eventos: [], cfg, expediente: EXPEDIENTE_PADRAO, chave: chaves.campanha, periodo: "campanha", hoje, agora: brt(hoje, "15:00") });
      expect(live.painel.semCampanhas).toBe(true);
      const range = { from: "2026-11-16", to: hoje < "2026-11-16" ? "2026-11-16" : hoje };
      const al = alertasDaLive({ data: d, range, kpis: kpisDoPeriodo(d, range, { hoje }), live, hoje });
      const a = al.find((x) => x.id === "live-sem-campanhas");
      expect(Boolean(a), hoje).toBe(espera);
      if (a) {
        expect(a).toMatchObject({ nivel: "aviso", titulo: "Nenhuma campanha do Gerenciador casou com os nomes da live", cta: { href: "/configuracoes#campanha-live" } });
        expect(a.detalhe).toContain("[LIVE] Captação");
      }
    }
  });
});

// ---------------------------------------------------------------- C12/F20: a IA

describe("C12: o briefing lê o Início (sem placar, sem o motor, sem pessoas)", () => {
  const HOJE = "2026-11-04";
  const AGORA = brt(HOJE, "15:00");
  const LIDO = brt(HOJE, "14:55");
  const ROBO: RoboAgora = { ligado: true, lidoAte: LIDO, confiavel: true, sync: { ultimoOk: LIDO, falha: null } };
  const SEMANA = { from: "2026-10-29", to: HOJE };
  const pessoa = (id: string, name: string, over: Partial<Lead> = {}): Lead => ({
    id,
    brand: "consorcio",
    createdAt: brt(HOJE, "09:00"),
    name,
    email: `${id}.contato@exemplo-lgpd.com.br`,
    phone: `551198880${id.padStart(4, "0")}`,
    status: "lead",
    utmSource: "meta",
    utmContent: "Anúncio A|100001",
    ...over,
  });
  const leads: Lead[] = [
    // Resgate (o robô não falou em 2 h): a Fila guarda o 1º nome — nunca pode chegar à IA.
    pessoa("1", "Quitéria Zanotto", { createdAt: brt(HOJE, "11:00") }),
    // Aceitou o convite, sem reunião.
    pessoa("2", "Benedita Xavante", {
      createdAt: brt("2026-11-02", "10:00"),
      roboVistoEm: brt("2026-11-02", "10:05"),
      roboRecebidoEm: brt("2026-11-02", "10:00"),
      roboSaudacaoEm: brt("2026-11-02", "10:01"),
      roboRespondeuEm: brt("2026-11-02", "10:20"),
      roboConviteEm: brt("2026-11-02", "11:00"),
      roboAceitouEm: brt("2026-11-02", "11:10"),
      roboEtapa: "transferido",
    }),
    // Três reuniões de conversão no período (o custo por reunião aparece).
    ...["3", "4", "5"].map((id, i) =>
      pessoa(id, ["Rosalva Pimentel", "Doralice Quintanilha", "Eufrásia Tavernard"][i], {
        createdAt: brt("2026-10-30", "10:00"),
        status: "agendado",
        bookedAt: brt("2026-10-31", "10:00"),
        meetingFor: brt("2026-11-10", "10:00"),
      }),
    ),
    // Inscrito da live.
    pessoa("6", "Teodora Liberato", { classe: "A", bem: "imovel" }),
  ];
  const data = base({
    adDaily: [ad("2026-10-30", "100001", 450), ad("2026-10-31", "100001", 450)],
    creatives: [{ adId: "100001", brand: "consorcio", name: "Anúncio A", format: "imagem" }],
    leads,
  });
  const eventos: never[] = [];
  const kpis = kpisDoPeriodo(data, SEMANA, { hoje: HOJE, agora: AGORA, comparar: true });
  const filaLive = montarFilaDaLive(data.leads, eventos, AGORA, EXPEDIENTE_PADRAO);
  const { inicio } = montarBussola({
    data,
    range: SEMANA,
    rangeKey: "2026-10-29..2026-11-04",
    kpis,
    eventos,
    robo: ROBO,
    expediente: EXPEDIENTE_PADRAO,
    filaLive,
    agora: AGORA,
    hoje: HOJE,
  });
  const briefing = buildBriefing(data, SEMANA, { nowIso: AGORA, warnings: [], kpis, inicio });

  it("sem 'bussola' e sem regra do motor; o bloco 'inicio' com os textos da tela", () => {
    expect("bussola" in briefing).toBe(false);
    expect(briefing.alertasJaDetectados.every((a) => a.regra === "conteudo")).toBe(true);
    const i = briefing.inicio!;
    expect(i).not.toBeNull();
    expect(i.cartoes).toEqual({
      investimentoConversao: mostrar(kpis.investimentoConversao, "moeda0"),
      cpl: mostrar(kpis.cpl, "moeda"),
      leads: mostrar(kpis.leads, "int"),
      reunioesAgendadas: mostrar(kpis.reunioesAgendadas, "int"),
      custoPorReuniao: inicio.cartoes.custoReuniao,
    });
    expect(i.cartoes.custoPorReuniao).toMatch(/por reunião de conversão$/);
    expect(i.leadsChegando.porDia.reduce((s, d) => s + d.leads, 0)).toBe(kpis.leads.valor);
    expect(i.leadsChegando.ultimoLead).toBe(inicio.leadsChegando.ultimos[0].ha);
    expect(i.atendimento.titulo).toBe(inicio.atendimento.titulo);
    expect(i.atendimento.frases).toEqual(inicio.atendimento.frases.map((f) => f.texto));
    expect(i.atendimento.frases.length).toBeGreaterThan(0);
    expect(i.atendimento.funil.degraus.map((d) => d.contagem)).toEqual(inicio.atendimento.funil.map((d) => d.valor));
    expect(i.diasDesdeOUltimoPost).toBe(inicio.rodape.diasDesdeUltimoPost);
    // A lista de pessoas não vai.
    expect("ultimos" in i.leadsChegando).toBe(false);
  });

  it("LGPD: nenhum nome, primeiro nome, telefone ou e-mail do fixture no JSON do briefing", () => {
    // A Fila tem o 1º nome no resgate — conferir que o fixture o produz, para o teste valer.
    const fila = montarFila({ nowIso: AGORA, leads: data.leads, eventos, robo: ROBO });
    expect(fila.entradasDeResgate.map((r) => r.primeiroNome)).toContain("Quitéria");
    const json = JSON.stringify(briefing);
    for (const l of data.leads) {
      expect(json.includes(l.name), l.name).toBe(false);
      const p = primeiroNome(l.name);
      if (p) expect(json.includes(p), p).toBe(false);
      if (l.email) expect(json.includes(l.email), l.email).toBe(false);
      if (l.phone) {
        expect(json.includes(l.phone), l.phone).toBe(false);
        expect(json.includes(l.phone.slice(-8)), l.phone).toBe(false);
      }
    }
    // ("nome" existe, mas é do dicionário e do anúncio — os nomes de pessoa já foram procurados acima.)
    expect(/"(phone|email|telefone|primeiroNome|leadName)"/.test(json)).toBe(false);
  });

  it("o `pago` sai dos kpis recebidos: o mesmo objeto do cartão (com a confiança dele)", () => {
    if (!("pago" in briefing) || !briefing.pago || !("cpl" in briefing.pago)) throw new Error("briefing de conversão sem pago");
    expect(briefing.pago.leads).toBe(kpis.leads.valor);
    expect(briefing.pago.cpl === null).toBe(!custoExibivel(kpis.cpl));
    expect(briefing.pago.cpr === null).toBe(!custoExibivel(kpis.custoPorReuniao));
    expect(briefing.pago.cpr).toBeCloseTo(300, 6);
    // Prova da fiação: com os kpis de OUTRO período, `pago` acompanha os kpis, não o range.
    const outra = { from: "2026-11-03", to: HOJE };
    const kOutra = kpisDoPeriodo(data, outra, { hoje: HOJE, agora: AGORA });
    const b2 = buildBriefing(data, SEMANA, { nowIso: AGORA, warnings: [], kpis: kOutra });
    if (!("pago" in b2) || !b2.pago || !("cpl" in b2.pago)) throw new Error("briefing de conversão sem pago");
    expect(b2.pago.leads).toBe(kOutra.leads.valor);
    expect(b2.pago.reunioesAgendadasNoPeriodo).toBe(kOutra.reunioesAgendadas.valor);
    expect(b2.pago.cpr).toBeNull();
    expect(b2.inicio).toBeNull();
  });

  it("awareness: sem 'inicio' e sem 'bussola'", () => {
    const krone = base({ campaign: { ...base().campaign, brand: "krone" } });
    const b = buildBriefing(krone, SEMANA, { nowIso: AGORA, warnings: [] });
    expect(b.inicio).toBeNull();
    expect("bussola" in b).toBe(false);
  });
});
