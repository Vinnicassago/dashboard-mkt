/**
 * Fase 6.2 — o Funil: dois funis com escopo próprio, período × coorte, tendência
 * das taxas, coortes com todas as semanas, perdas confiáveis e a confiança do
 * registro. Fixture sintética (nenhum dado real). Datas em UTC; Brasília = UTC−3.
 */
import { describe, expect, it } from "vitest";
import { kpisDoPeriodo } from "../kpis";
import { gargalo, transicoesDoFunil } from "../gargalo";
import { AMOSTRA_MIN, ATRASO_REGISTRO_SHARE, LOTE_MIN } from "../motor";
import { TENTATIVAS_PARA_SEM_RESPOSTA } from "../lead-status";
import { lpKpis, type DateRange } from "../metrics";
import type { CascataComercial, CascataRobo } from "../cascata";
import {
  SEM_TAXA_CAMPANHA_INTEIRA,
  SEM_TAXA_NAO_ANINHADA,
  SEM_TAXA_PERIODO,
  SLA_PRIMEIRO_CONTATO_HORAS,
  confiancaDoRegistro,
  coortesDoFunil,
  fraseDoGargalo,
  funilDeDescoberta,
  impressoesDeConversao,
  montarFunil,
  notasDeMedicao,
  ondeAtacar,
  ondeAtacarSemResposta,
  perdasConfiaveis,
  tendenciaDasTaxas,
  vistaDoFunil,
  type VistaFunil,
} from "../funil";
import type { AdDaily, DashboardData, IgAccountDaily, Lead, LeadEvent, LpDaily, Meta } from "../types";

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

const ig = (date: string, extra: Partial<IgAccountDaily> = {}): IgAccountDaily => ({
  brand: "consorcio",
  date,
  followers: 1000,
  reach: 500,
  views: 900,
  profileLinkTaps: 4,
  accountsEngaged: 40,
  totalInteractions: 60,
  profileViews: 50,
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

const funilDe = (data: DashboardData, vista: "periodo" | "coorte" = "periodo", range = SEMANA as { from: string; to: string } | undefined) =>
  montarFunil({ data, range, kpis: kpisDe(data, range), robo: null, comercial: null, vista, hoje: HOJE, agora: AGORA });

// ---------------------------------------------------------------- funil de conversão

describe("funil de conversão: só campanhas de conversão no topo", () => {
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

  it("as impressões do funil são as de conversão; as de descoberta viram nota", () => {
    expect(impressoesDeConversao(data, SEMANA)).toBe(10_000);
    const f = funilDe(data);
    expect(f.etapas[0]).toMatchObject({ key: "impressoes", valor: 10_000, fonte: "meta", ehAncora: true });
    expect(f.etapas[0].nota).toContain("50.000");
    expect(f.investimentoConversao).toBe(600);
  });

  it("cliques e envios de formulário não são degraus; a sequência é a do relatório", () => {
    const f = funilDe(data);
    expect(f.etapas.map((e) => e.key)).toEqual(["impressoes", "visitas", "leads", "primeiro_contato", "reunioes", "compareceu", "clientes"]);
    expect(f.etapas.find((e) => e.key === "envios")).toBeUndefined();
    // Visita → lead é a conversão da anterior em Leads (a mesma transição do gargalo).
    expect(f.etapas.find((e) => e.key === "leads")?.daAnterior).toBeCloseTo(20 / 500, 6);
    // Custo por lead = o CPL do dicionário (R$ 600 ÷ 20 leads de conversão).
    expect(f.etapas.find((e) => e.key === "leads")?.custo).toMatchObject({ valor: 30, rotulo: "por lead" });
  });
});

describe("funil de conversão: período (eventos) × coorte (entrada)", () => {
  // Entrou em setembro, agendou em outubro: reunião DE outubro no período, de setembro na coorte.
  const data = base({
    adDaily: [ad("2026-10-05", "100001", 900)],
    leads: [
      lead("2026-09-10", { status: "agendado", bookedAt: "2026-10-05T12:00:00.000Z", meetingFor: "2026-10-20T12:00:00.000Z", firstContactAt: "2026-10-05T11:00:00.000Z" }),
      lead("2026-09-11", { status: "reuniao_realizada", bookedAt: "2026-10-05T12:00:00.000Z", attendedAt: "2026-10-06T12:00:00.000Z", firstContactAt: "2026-09-11T14:00:00.000Z" }),
      lead("2026-09-12", { status: "cliente", bookedAt: "2026-10-05T12:00:00.000Z", attendedAt: "2026-10-06T12:00:00.000Z", closedAt: "2026-10-07T12:00:00.000Z", value: 50_000 }),
      ...Array.from({ length: 5 }, () => lead("2026-10-05", { firstContactAt: "2026-10-05T13:30:00.000Z" })),
      lead("2026-10-06", { status: "agendado", bookedAt: "2026-10-06T12:00:00.000Z", meetingFor: "2026-10-21T12:00:00.000Z" }),
    ],
    metas: [meta("reunioes_agendadas", 7), meta("taxa_lead_agendada", 0.1), meta("primeiro_contato_no_prazo", 0.9)],
  });

  it("por período, as reuniões são as agendadas NO período, com o custo por reunião do dicionário", () => {
    const f = funilDe(data, "periodo");
    const k = kpisDe(data);
    const porKey = Object.fromEntries(f.etapas.map((e) => [e.key, e]));
    expect(porKey.reunioes.valor).toBe(4);
    expect(porKey.reunioes.valor).toBe(k.reunioesAgendadas.valor);
    expect(porKey.reunioes.label).toBe("Reuniões agendadas");
    // 4 reuniões de conversão ≥ MIN_REUNIOES: R$ 900 ÷ 4.
    expect(porKey.reunioes.custo).toMatchObject({ valor: 225, rotulo: "por reunião" });
    expect(porKey.reunioes.meta).toMatchObject({ metrica: "reunioes_agendadas", alvo: 7 });
    expect(porKey.compareceu).toMatchObject({ label: "Reuniões realizadas", valor: 2 });
    expect(porKey.clientes).toMatchObject({ label: "Vendas", valor: 1 });
    // 1º contato pela data da 1ª tentativa: 1 (set→out) + 5 de outubro.
    expect(porKey.primeiro_contato.valor).toBe(6);
    expect(porKey.primeiro_contato.meta).toMatchObject({ metrica: "primeiro_contato_no_prazo", alvo: 0.9 });
    expect(porKey.leads.valor).toBe(6);
  });

  it("por coorte, as etapas seguem quem entrou no período — e o custo por reunião não aparece", () => {
    const f = funilDe(data, "coorte");
    const k = kpisDe(data);
    const porKey = Object.fromEntries(f.etapas.map((e) => [e.key, e]));
    expect(porKey.reunioes.valor).toBe(1);
    expect(porKey.reunioes.valor).toBe(k.agendaram.valor);
    expect(porKey.reunioes.label).toBe("Agendaram reunião");
    expect(porKey.reunioes.custo).toBeUndefined();
    expect(porKey.reunioes.meta).toMatchObject({ metrica: "taxa_lead_agendada", alvo: 0.1 });
    expect(porKey.primeiro_contato.valor).toBe(5);
    expect(porKey.compareceu.valor).toBe(0);
    expect(porKey.clientes.valor).toBe(0);
  });

  it("abaixo de 3 reuniões o custo por reunião some, em qualquer vista", () => {
    const pouco = base({
      adDaily: [ad("2026-10-05", "100001", 900)],
      leads: [lead("2026-10-05", { status: "agendado", bookedAt: "2026-10-06T12:00:00.000Z", meetingFor: "2026-10-21T12:00:00.000Z" })],
    });
    expect(funilDe(pouco, "periodo").etapas.find((e) => e.key === "reunioes")?.custo).toBeUndefined();
  });

  it("o Δ é o mesmo funil no período anterior; o toggle lê a URL", () => {
    const f = funilDe(data, "coorte");
    // Período anterior (25/09–01/10): nenhum lead entrou.
    expect(f.etapas.find((e) => e.key === "leads")).toMatchObject({ valor: 6, anterior: 0 });
    // Campanha inteira não tem "antes".
    const inteira = montarFunil({ data, range: undefined, kpis: kpisDoPeriodo(data, undefined, { hoje: HOJE, agora: AGORA }), robo: null, comercial: null, vista: "coorte", hoje: HOJE, agora: AGORA });
    expect(inteira.etapas.find((e) => e.key === "leads")?.anterior).toBeUndefined();
    expect(vistaDoFunil("coorte")).toBe("coorte");
    expect(vistaDoFunil("qualquer")).toBe("periodo");
    expect(vistaDoFunil(undefined)).toBe("periodo");
  });
});

// ---------------------------------------------------------------- correções da revisão (6.2)

/** Robô e atendimento ligados — contagens da campanha inteira, sintéticas. */
const ROBO: CascataRobo = { conversas: 40, responderam: 20, convidados: 10, transferidos: 6, convitePendente: 2 };
const COMERCIAL: CascataComercial = { abordados: 5, reunioesRealizadas: 3, negociosFechados: 1, aguardandoAbordagem: 1 };

/** `null` = campanha inteira (um `undefined` explícito cairia no default de parâmetro). */
const funilCom = (
  data: DashboardData,
  vista: VistaFunil,
  robo: CascataRobo | null,
  comercial: CascataComercial | null,
  periodo: DateRange | null = SEMANA,
) =>
  montarFunil({
    data,
    range: periodo ?? undefined,
    kpis: kpisDoPeriodo(data, periodo ?? undefined, { hoje: HOJE, agora: AGORA, comparar: true }),
    robo,
    comercial,
    vista,
    hoje: HOJE,
    agora: AGORA,
  });

type Funil = ReturnType<typeof funilCom>;
const porKey = (etapas: Funil["etapas"]) => Object.fromEntries(etapas.map((e) => [e.key, e]));
const todas = (f: Funil) => [...f.etapas, ...(f.bloco?.etapas ?? [])];

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
    metas: [meta("reunioes_agendadas", 7), meta("taxa_lead_agendada", 0.1), meta("primeiro_contato_no_prazo", 0.9)],
  });

describe("com robô/atendimento ligados, as vistas ainda diferem e a north star fica no funil", () => {
  const data = agendamentos();
  const k = kpisDe(data);

  it("por período: Leads → 1º contato → Reuniões agendadas (com o custo do dicionário) → realizadas → vendas; o robô vira bloco", () => {
    const f = funilCom(data, "periodo", ROBO, COMERCIAL);
    expect(f.etapas.map((e) => e.key)).toEqual(["impressoes", "leads", "primeiro_contato", "reunioes", "compareceu", "clientes"]);
    const r = porKey(f.etapas).reunioes;
    expect(r).toMatchObject({ label: "Reuniões agendadas", valor: k.reunioesAgendadas.valor, dica: "reunioes_agendadas" });
    expect(r.valor).toBe(4);
    expect(r.custo).toMatchObject({ valor: 225, rotulo: "por reunião", dica: "custo_por_reuniao" });
    expect(r.meta).toMatchObject({ metrica: "reunioes_agendadas", alvo: 7 });
    expect(f.bloco?.etapas.map((e) => e.key)).toEqual(["conversas", "responderam", "convite", "transferidos", "abordados", "reuniao", "negocio"]);
    expect(f.bloco?.etapas.every((e) => e.fonte === "robo" || e.fonte === "comercial")).toBe(true);
  });

  it("por coorte: 'Agendaram reunião' com a taxa lead → reunião — e as duas vistas não são o mesmo funil", () => {
    const periodo = funilCom(data, "periodo", ROBO, COMERCIAL);
    const coorte = funilCom(data, "coorte", ROBO, COMERCIAL);
    const r = porKey(coorte.etapas).reunioes;
    expect(r).toMatchObject({ label: "Agendaram reunião", valor: k.agendaram.valor, dica: "agendaram" });
    expect(r.valor).toBe(1);
    expect(r.custo).toBeUndefined();
    expect(r.meta?.metrica).toBe("taxa_lead_agendada");
    const valores = (f: Funil) => f.etapas.map((e) => [e.key, e.label, e.valor]);
    expect(valores(coorte)).not.toEqual(valores(periodo));
  });

  it("meio-ligado (robô sem a mesa do atendimento): a meta de reuniões agendadas nunca gruda no número da coorte", () => {
    for (const vista of ["periodo", "coorte"] as const) {
      const f = funilCom(data, vista, ROBO, null);
      expect(f.etapas.some((e) => e.key === "reunioes")).toBe(true);
      for (const e of todas(f).filter((x) => x.meta?.metrica === "reunioes_agendadas")) {
        expect(e.valor).toBe(k.reunioesAgendadas.valor);
      }
    }
    const coorte = porKey(funilCom(data, "coorte", ROBO, null).etapas);
    expect(coorte.reunioes).toMatchObject({ label: "Agendaram reunião", valor: 1 });
    expect(coorte.reunioes.meta?.metrica).toBe("taxa_lead_agendada");
    // Sem o atendimento, quem não teve tentativa está parado no 1º contato (como na cascata).
    expect(coorte.primeiro_contato).toMatchObject({ parados: 5, etapaFila: "novo" });
    // Com ele, quem espera aparece no bloco (aguardando abordagem) — não duas vezes.
    expect(porKey(funilCom(data, "coorte", ROBO, COMERCIAL).etapas).primeiro_contato.parados).toBeUndefined();
  });
});

describe("'% da anterior' só entre populações aninhadas — nunca acima de 100%", () => {
  // 10 leads na semana: 3 com tentativa registrada, 5 agendados direto do "Novo" (sem tentativa).
  const data = base({
    leads: [
      ...Array.from({ length: 3 }, () => lead("2026-10-05", { status: "em_contato", firstContactAt: "2026-10-05T13:30:00.000Z" })),
      ...Array.from({ length: 5 }, () => lead("2026-10-05", { status: "agendado", bookedAt: "2026-10-05T15:00:00.000Z", meetingFor: "2026-10-20T12:00:00.000Z" })),
      ...Array.from({ length: 2 }, () => lead("2026-10-06")),
    ],
  });

  it("por coorte: 1º contato é ramo paralelo e Reuniões é sobre os LEADS (5 de 10), não '166,7% da anterior'", () => {
    const f = funilCom(data, "coorte", null, null);
    const e = porKey(f.etapas);
    expect(e.primeiro_contato.valor).toBe(3);
    expect(e.primeiro_contato.daAnterior).toBeCloseTo(0.3, 9);
    expect(e.reunioes).toMatchObject({ valor: 5, baseDaTaxa: "dos leads" });
    expect(e.reunioes.daAnterior).toBeCloseTo(0.5, 9);
    expect(e.reunioes.daAnterior).toBeCloseTo(kpisDe(data).taxaLeadAgendada.valor, 9);
    for (const x of todas(f)) if (x.daAnterior !== undefined) expect(x.daAnterior).toBeLessThanOrEqual(1);
  });

  it("por período: eventos de leads de qualquer data não são fração da etapa acima — sem taxa, e a tela diz por quê", () => {
    // Mutirão: 20 leads de setembro contatados nesta semana, contra 5 leads novos.
    const mutirao = base({
      leads: [
        ...Array.from({ length: 20 }, () => lead("2026-09-10", { status: "em_contato", firstContactAt: "2026-10-06T13:00:00.000Z" })),
        ...Array.from({ length: 5 }, () => lead("2026-10-05")),
      ],
    });
    for (const d of [data, mutirao]) {
      const f = funilCom(d, "periodo", null, null);
      for (const key of ["primeiro_contato", "reunioes", "compareceu", "clientes"]) {
        const e = porKey(f.etapas)[key];
        expect(e.daAnterior).toBeUndefined();
        expect(e.semTaxa).toBe(SEM_TAXA_PERIODO);
      }
      for (const x of todas(f)) if (x.daAnterior !== undefined) expect(x.daAnterior).toBeLessThanOrEqual(1);
    }
    expect(porKey(funilCom(mutirao, "periodo", null, null).etapas).primeiro_contato.valor).toBe(20);
  });

  it("mais gente que na base (realizadas sem o marco do agendamento) não vira taxa: vira 'sem taxa' com o motivo", () => {
    const legado = base({
      leads: [
        ...Array.from({ length: 3 }, () => lead("2026-10-05", { status: "agendado", bookedAt: "2026-10-05T15:00:00.000Z", meetingFor: "2026-10-20T12:00:00.000Z" })),
        // Realizada antes de o marco `bookedAt` existir, e depois encerrada: conta como realizada, não como agendada.
        ...Array.from({ length: 4 }, () => lead("2026-10-05", { status: "sem_interesse", attendedAt: "2026-10-06T12:00:00.000Z", lostAt: "2026-10-07T12:00:00.000Z" })),
      ],
    });
    const e = porKey(funilCom(legado, "coorte", null, null).etapas);
    expect(e.reunioes.valor).toBe(3);
    expect(e.compareceu.valor).toBe(4);
    expect(e.compareceu.daAnterior).toBeUndefined();
    expect(e.compareceu.semTaxa).toBe(SEM_TAXA_NAO_ANINHADA);
  });
});

describe("robô/atendimento com período: nada divide a verba do período pela contagem da campanha inteira", () => {
  const data = agendamentos();

  it("com ?range=, o bloco sai sem custo, sem taxa sobre os leads do período e sem Δ — a nota fica", () => {
    for (const vista of ["periodo", "coorte"] as const) {
      const f = funilCom(data, vista, ROBO, COMERCIAL);
      const bloco = f.bloco!;
      expect(bloco.nota).toContain("campanha inteira");
      expect(bloco.etapas.every((e) => e.custo === undefined)).toBe(true);
      expect(bloco.etapas.every((e) => e.anterior === undefined)).toBe(true);
      expect(bloco.etapas[0]).toMatchObject({ key: "conversas", semTaxa: SEM_TAXA_CAMPANHA_INTEIRA });
      expect(bloco.etapas[0].daAnterior).toBeUndefined();
      // Dentro do bloco, campanha inteira sobre campanha inteira: a taxa fica.
      expect(porKey(bloco.etapas).responderam.daAnterior).toBeCloseTo(20 / 40, 9);
      // E nenhuma etapa do bloco se passa por etapa do painel.
      expect(f.etapas.some((e) => e.fonte === "robo" || e.fonte === "comercial")).toBe(false);
    }
    // Sem a mesa do robô, o 1º degrau do bloco é o do atendimento — mesma regra.
    const soComercial = funilCom(data, "periodo", null, COMERCIAL).bloco!;
    expect(soComercial.etapas[0]).toMatchObject({ key: "abordados", semTaxa: SEM_TAXA_CAMPANHA_INTEIRA });
    expect(soComercial.etapas.every((e) => e.custo === undefined)).toBe(true);
  });

  it("na campanha inteira numerador e denominador coincidem: o custo por etapa do robô volta", () => {
    const f = funilCom(data, "coorte", ROBO, COMERCIAL, null);
    const e = porKey(f.bloco?.etapas ?? []);
    expect(f.investimentoConversao).toBe(900);
    expect(e.conversas.custo).toMatchObject({ valor: 900 / 40, rotulo: "por conversa" });
    expect(e.reuniao.custo).toMatchObject({ valor: 900 / 3, rotulo: "por reunião realizada" });
    expect(f.bloco?.nota).not.toContain("sem custo");
  });
});

// ---------------------------------------------------------------- a resposta

describe("a resposta é o gargalo da Bússola, nas mesmas palavras", () => {
  const data = base({
    leads: [
      ...Array.from({ length: 49 }, () => lead("2026-10-05", { status: "sem_interesse", lostAt: "2026-10-06T18:00:00.000Z" })),
      lead("2026-10-05", { status: "agendado", bookedAt: "2026-10-06T12:00:00.000Z", meetingFor: "2026-10-20T12:00:00.000Z" }),
    ],
    metas: [meta("taxa_lead_agendada", 0.1)],
  });
  it("título com a transição, detalhe com dono, taxa, régua e impacto", () => {
    const t = transicoesDoFunil(data, SEMANA, kpisDe(data), { agora: AGORA, hoje: HOJE });
    const g = gargalo(t, SEMANA)!;
    const r = fraseDoGargalo(g);
    expect(r.titulo).toBe("Gargalo: Lead → Agendada");
    expect(r.detalhe).toBe("(comercial) — 2,0% contra meta de 10%. +4 reuniões por semana se batesse a meta.");
    expect(fraseDoGargalo(null).titulo).toBe("Sem gargalo para apontar");
  });
});

// ---------------------------------------------------------------- descoberta

describe("funil de descoberta: a conta do Instagram, rotulada com honestidade", () => {
  it("sem dia sincronizado é sem leitura, não zero", () => {
    expect(funilDeDescoberta(base(), SEMANA, kpisDe(base()))).toMatchObject({ semDado: true, dias: 0 });
    expect(funilDeDescoberta(base(), SEMANA, kpisDe(base())).etapas.every((e) => e.valor === null)).toBe(true);
  });
  it("alcance é soma diária (e o rótulo diz), seguidores são líquidos, custo só com verba de descoberta", () => {
    const data = base({
      igAccountDaily: [ig("2026-10-05", { followers: 1000, dmConversations: 3 }), ig("2026-10-06", { followers: 1010, dmConversations: 2 })],
      adDaily: [ad("2026-10-05", "200001", 100, { objective: "OUTCOME_ENGAGEMENT", leads: 0 })],
    });
    const f = funilDeDescoberta(data, SEMANA, kpisDe(data));
    const porKey = Object.fromEntries(f.etapas.map((e) => [e.key, e]));
    expect(porKey.alcance.valor).toBe(1000);
    expect(porKey.alcance.nota).toContain("soma do alcance diário");
    expect(porKey.visitas_perfil).toMatchObject({ valor: 100, daAnterior: 0.1 });
    expect(porKey.seguidores).toMatchObject({ valor: 10, daAnterior: 0.1 });
    expect(porKey.seguidores.custo).toMatchObject({ valor: 10, rotulo: "por seguidor" });
    expect(f.extras.map((x) => [x.key, x.valor])).toEqual([
      ["link_bio", 8],
      ["dm", 5],
    ]);
    expect(f.investimentoDescoberta).toBe(100);
  });

  it("período anterior sem dia do Instagram é sem leitura: nenhum '+N vs. anterior'", () => {
    // A integração ligou nesta semana: nada em 25/09–01/10.
    const data = base({ igAccountDaily: [ig("2026-10-05", { dmConversations: 3 }), ig("2026-10-06", { followers: 1010, dmConversations: 2 })] });
    const f = funilDeDescoberta(data, SEMANA, kpisDe(data));
    expect(f.semDado).toBe(false);
    expect(f.etapas.every((e) => e.anterior === undefined)).toBe(true);
    expect(f.extras.length).toBeGreaterThan(0);
    expect(f.extras.every((x) => x.anterior === undefined)).toBe(true);
    expect(f.semComparacao).toContain("não tem leitura");
  });

  it("período anterior com menos dias que o atual também não compara; com cobertura completa, compara", () => {
    const semana = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"];
    const anterior = ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"];
    const buraco = base({ igAccountDaily: [ig(anterior[0]), ...semana.map((d) => ig(d))] });
    const f = funilDeDescoberta(buraco, SEMANA, kpisDe(buraco));
    expect(f.etapas.every((e) => e.anterior === undefined)).toBe(true);
    expect(f.semComparacao).toContain("1 dia com dado");
    const completo = base({ igAccountDaily: [...anterior, ...semana].map((d) => ig(d)) });
    const g = funilDeDescoberta(completo, SEMANA, kpisDe(completo));
    expect(g.semComparacao).toBeUndefined();
    expect(g.etapas.find((e) => e.key === "alcance")).toMatchObject({ valor: 3500, anterior: 3500 });
    expect(g.extras.find((x) => x.key === "link_bio")).toMatchObject({ valor: 28, anterior: 28 });
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
    expect(s.leadContatoNoPrazo).toBeCloseTo(k.primeiroContatoNoPrazo.valor, 9);
    expect(s.leadAgendada).toBeCloseTo(k.taxaLeadAgendada.valor, 9);
    expect(s.n).toEqual({ contato: 11, leads: 11, visitas: 200 });
    // Semana vazia: nenhuma taxa inventada.
    const vazia = t.find((p) => p.semana === "2026-09-28")!;
    expect(vazia).toMatchObject({ leads: 0, visitas: 0, visitaLead: undefined, leadContatoNoPrazo: undefined, leadAgendada: undefined });
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
    expect(coortes[0].primeiroContatoNoPrazo.n).toBeGreaterThan(0);
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
  const porStatus = Object.fromEntries(p.linhas.map((l) => [l.status, l]));

  it("a tabela não contém teste, duplicado nem lead que chegou a 'Agendado'", () => {
    expect(p.total).toBe(6);
    expect(p.base).toBe(8); // 10 − teste − duplicado
    expect(p.excluidos).toEqual({ testes: 1, duplicados: 1, comReuniao: 1 });
    expect(p.linhas.reduce((s, l) => s + l.n, 0)).toBe(6);
    expect(porStatus.sem_resposta.n).toBe(3);
    expect(porStatus.contato_invalido.n).toBe(2);
    expect(porStatus.sem_interesse.n).toBe(1);
  });

  it("'Onde atacar' é aplicado lead a lead; 'Contato inválido' abre pelo motivo", () => {
    expect(porStatus.sem_resposta.ondeAtacar).toEqual({ comercial: 2, midia_formulario: 1 });
    expect(p.semTentativa).toBe(1);
    expect(porStatus.contato_invalido.ondeAtacar).toEqual({ midia_formulario: 2 });
    expect(porStatus.contato_invalido.detalhes).toEqual([
      { motivo: "numero_inexistente", label: "Número não existe", n: 1 },
      { motivo: "sem_whatsapp", label: "Sem WhatsApp", n: 1 },
    ]);
    expect(porStatus.sem_interesse.ondeAtacar).toEqual({ oferta: 1 });
  });

  it("% registrado com atraso (> 72 h) e média de tentativas, por motivo", () => {
    // sem_resposta: insistido (evento 4 dias depois) atrasado; tardio (2 dias) não; ignorado (lostAt no dia) não.
    expect(porStatus.sem_resposta.atrasoN).toBe(3);
    expect(porStatus.sem_resposta.registradoComAtraso).toBeCloseTo(1 / 3, 6);
    expect(porStatus.sem_resposta.mediaTentativas).toBeCloseTo(2, 6);
    // contato_invalido: invalido2 pelo marco (4 dias) atrasado.
    expect(porStatus.contato_invalido.registradoComAtraso).toBeCloseTo(0.5, 6);
    expect(porStatus.sem_resposta.share).toBeCloseTo(0.5, 6);
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

  it("2 de 10 não derrubam; abaixo da amostra mínima o selo não acende", () => {
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
});

// ---------------------------------------------------------------- notas de medição

describe("notas de medição: cliques × visitas, Pixel × painel, eventos × pessoas", () => {
  it("as três notas saem com os números do período; a antiga 'Onde não agir' vira nota", () => {
    const data = base({
      adDaily: [ad("2026-10-05", "100001", 300, { clicks: 900, leads: 40 })],
      lpDaily: [lp("2026-10-05", 300, 35)],
      leads: Array.from({ length: 30 }, () => lead("2026-10-05")),
    });
    const f = funilDe(data);
    const notas = notasDeMedicao({ data, range: SEMANA, kpis: kpisDe(data), cascata: f.cascata });
    const titulos = notas.map((n) => n.titulo);
    expect(titulos[0]).toBe("Cliques × visitas: 900 cliques (Meta) contra 300 visitas (landing page)");
    expect(titulos[1]).toBe("Pixel × painel: 40 conversões do Pixel contra 30 leads");
    expect(titulos[2]).toBe("Eventos × pessoas: 35 envios de formulário viraram 30 leads");
    expect(titulos[3]).toContain("visitas que não preencheram");
    expect(notas[0].detalhe).toContain("artefato de medição");
  });
});
