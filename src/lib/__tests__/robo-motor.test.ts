/**
 * Fase 1 (nov/26), etapa B — o motor com o robô de WhatsApp: a C1 nova (resgate,
 * aceitou o convite, misto, live com dedupe; desligada = a de antes), a B1 "robô
 * parado" (leitura falhando/parada × gente sem a 1ª mensagem, uma suprime a
 * outra), a C2 nula com o robô ligado, a ordem fixa C1 > B1 > resto, e o KPI do
 * 1º contato sem quem o robô recebeu. Puro; AGORA ≥ 29/10.
 */
import { describe, expect, it } from "vitest";
import { kpisDoPeriodo } from "../kpis";
import { montarCascata } from "../cascata";
import { montarFunil } from "../funil";
import { montarFila } from "../fila";
import { motorDeAcoes, type Acao } from "../motor";
import { montarFilaDaLive } from "../fila-live";
import { EXPEDIENTE_PADRAO } from "../turno";
import { semMensagemDoRobo, type RoboAgora } from "../robo/situacao";
import { alertaRoboSem1aMsg } from "../alertas";
import type { DashboardData, Lead, Meta } from "../types";

const brt = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();
const HOJE = "2026-11-04";
const AGORA = brt(HOJE, "15:00"); // quarta

const roboOk = (lidoAte = brt(HOJE, "14:55")): RoboAgora => ({
  ligado: true,
  lidoAte,
  confiavel: true,
  sync: { ultimoOk: lidoAte, falha: null },
});

let seq = 0;
const lead = (extra: Partial<Lead> = {}): Lead => ({
  id: `L${++seq}`,
  brand: "consorcio",
  createdAt: brt(HOJE, "09:00"),
  name: "Pessoa Teste",
  phone: `55119876${String(seq).padStart(5, "0")}`,
  status: "lead",
  ...extra,
});

/** Saudado ontem, nunca respondeu: no resgate desde hoje 10:01 (2,5× o prazo às 15h). */
const semResposta = (): Partial<Lead> => ({
  createdAt: brt("2026-11-03", "10:00"),
  roboVistoEm: brt("2026-11-03", "10:05"),
  roboSaudacaoEm: brt("2026-11-03", "10:01"),
  roboEtapa: "nao_respondeu",
});
/** Aceitou o convite às 10h: 5 h úteis sem a reunião registrada. */
const aceitou = (): Partial<Lead> => ({
  roboVistoEm: brt(HOJE, "09:05"),
  roboSaudacaoEm: brt(HOJE, "09:01"),
  roboRespondeuEm: brt(HOJE, "09:10"),
  roboEtapa: "transferido",
  roboAceitouEm: brt(HOJE, "10:00"),
});

const meta = (metrica: Meta["metrica"], alvo: number): Meta => ({
  id: `${metrica}-x`,
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

function base(leads: Lead[], extra: Partial<DashboardData> = {}): DashboardData {
  return {
    campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-10-01", budgetTotal: 5000 },
    igAccountDaily: [],
    igPosts: [],
    adDaily: [],
    creatives: [],
    lpDaily: [],
    leads,
    goals: [],
    metas: [],
    updatedAt: AGORA,
    ...extra,
  };
}

const rodar = (data: DashboardData, opts: Partial<Parameters<typeof motorDeAcoes>[0]> = {}, agora = AGORA, hoje = HOJE) =>
  motorDeAcoes({ data, range: undefined, kpis: kpisDoPeriodo(data, undefined, { hoje, agora }), eventos: [], agora, hoje, ...opts });
const regra = (acoes: Acao[], id: string) => acoes.find((a) => a.regra === id);

describe("C1 com o robô ligado: o Resgate e quem aceitou o convite, fora do prazo", () => {
  it("só resgate: 'N pessoas no resgate fora do prazo', link para o grupo", () => {
    const data = base([lead(semResposta()), lead(semResposta()), lead({ createdAt: brt(HOJE, "14:00") })]);
    const c1 = regra(rodar(data, { robo: roboOk() }), "C1")!;
    expect(c1).toMatchObject({ titulo: "2 pessoas no resgate fora do prazo", href: "/fila?etapa=resgate#resgate", dono: "COM", severidade: "agora", confianca: "alta" });
    expect(c1.amostra.n).toBe(2);
    expect(c1.id).toMatch(/^C1:/);
    expect(c1.detalhe).toMatch(/^No resgate, ligue ou mande WhatsApp/);
  });

  it("só aceite: 'N aceitaram o convite sem reunião registrada'", () => {
    const c1 = regra(rodar(base([lead(aceitou()), lead(aceitou())]), { robo: roboOk() }), "C1")!;
    expect(c1).toMatchObject({ titulo: "2 aceitaram o convite sem reunião registrada", href: "/fila?etapa=convite-aceito#convite-aceito" });
    expect(c1.detalhe).toContain("confira o Calendly e registre a data");
  });

  it("misto: as partes que existem, em ≤ 12 palavras, e a Fila inteira", () => {
    const c1 = regra(rodar(base([lead(semResposta()), lead(semResposta()), lead(aceitou())]), { robo: roboOk() }), "C1")!;
    expect(c1).toMatchObject({ titulo: "2 no resgate e 1 com convite aceito, fora do prazo", href: "/fila" });
    expect(c1.titulo.split(/\s+/).filter((p) => /\p{L}|\d/u.test(p)).length).toBeLessThanOrEqual(12);
    expect(c1.amostra.n).toBe(3);
  });

  it("a assinatura leva o grupo: a mesma pessoa em outro grupo é ação nova", () => {
    const l = lead(semResposta());
    const noResgate = regra(rodar(base([l]), { robo: roboOk() }), "C1")!.id;
    const aceite = regra(rodar(base([{ ...l, ...aceitou(), createdAt: l.createdAt }]), { robo: roboOk() }), "C1")!.id;
    expect(noResgate).not.toBe(aceite);
  });

  it("com a live: o link vai para a live; o A que aceitou o convite conta uma vez", () => {
    const AGORA_LIVE = "2026-11-18T00:30:00.000Z"; // ter 17/11, 21h30 em Brasília
    const a = lead({ classe: "A", createdAt: "2026-11-17T22:00:00.000Z", ...aceitou(), roboAceitouEm: "2026-11-17T22:30:00.000Z" });
    const r = lead({ ...semResposta(), createdAt: "2026-11-16T10:00:00.000Z", roboSaudacaoEm: "2026-11-16T10:01:00.000Z", roboVistoEm: "2026-11-16T10:05:00.000Z" });
    const data = base([a, r]);
    const filaLive = montarFilaDaLive(data.leads, [], AGORA_LIVE, EXPEDIENTE_PADRAO);
    expect(filaLive.map((i) => [i.leadId, i.etapa, i.atrasado])).toEqual([[a.id, "primeira", true]]);
    const robo = roboOk("2026-11-18T00:25:00.000Z");
    const c1 = regra(rodar(data, { robo, filaLive }, AGORA_LIVE, "2026-11-17"), "C1")!;
    expect(c1).toMatchObject({ titulo: "1 inscrito da live e 1 no resgate, fora do prazo", href: "/fila#live" });
    expect(c1.amostra.n).toBe(2); // o A está na live e no "aceitou o convite": uma vez
    // Só a live (com o robô ligado): o texto de sempre.
    const soLive = regra(rodar(base([a]), { robo, filaLive }, AGORA_LIVE, "2026-11-17"), "C1")!;
    expect(soLive.titulo).toMatch(/^1 lead sem 1º contato além do prazo/);
    expect(soLive.href).toBe("/fila#live");
  });

  it("leitura falhando ou parada: a C1 continua, com confiança média", () => {
    const data = base([lead(semResposta())]);
    const parada: RoboAgora = { ligado: true, lidoAte: brt(HOJE, "13:30"), confiavel: true, sync: { ultimoOk: brt(HOJE, "13:30"), falha: null } };
    expect(regra(rodar(data, { robo: parada }), "C1")).toMatchObject({ confianca: "media", confiancaMotivo: expect.stringMatching(/parada/) });
    const falhando: RoboAgora = { ...roboOk(), sync: { ultimoOk: brt(HOJE, "14:55"), falha: { desde: brt(HOJE, "14:56"), erro: "x" } } };
    expect(regra(rodar(data, { robo: falhando }), "C1")?.confiancaMotivo).toMatch(/falhando/);
  });

  it("robô desligado: a C1 de antes, intacta (os 'Novos' de 1 hora útil)", () => {
    const data = base([lead({ createdAt: brt(HOJE, "12:00") }), lead(semResposta())]);
    for (const robo of [undefined, { ...roboOk(), ligado: false }]) {
      const c1 = regra(rodar(data, { robo }), "C1")!;
      expect(c1.titulo).toMatch(/^2 leads sem 1º contato além do prazo/);
      expect(c1.href).toBe("/fila?etapa=novo");
      expect(c1.detalhe).toMatch(/A Fila mostra 2 esperando o 1º contato/);
    }
  });
});

describe("B1 — o robô parado (só com o robô ligado)", () => {
  const semMensagem = () => [
    lead({ createdAt: brt(HOJE, "14:00") }), // não chegou ao robô
    lead({ createdAt: brt(HOJE, "14:00"), roboVistoEm: brt(HOJE, "14:05"), roboRecebidoEm: brt(HOJE, "14:01"), roboEtapa: "sem_mensagem" }),
  ];

  it("(b) gente sem a 1ª mensagem há mais de 15 min: dono robô, 'agora', link para Leads sem período", () => {
    const b1 = regra(rodar(base(semMensagem()), { robo: roboOk() }), "B1")!;
    expect(b1).toMatchObject({
      titulo: "2 leads sem a 1ª mensagem do robô há mais de 15 min",
      dono: "BOT",
      severidade: "agora",
      href: "/leads?robo=sem-1a-msg&range=all",
      semImpacto: "estimativa indisponível",
    });
    expect(b1.id).toMatch(/^B1:[0-9a-z]+$/);
    expect(b1.detalhe).toContain("1 não chegou ao robô; 1 chegou e o robô não mandou a 1ª mensagem");
    // Falha antiga (mais de 48 h) não vira ação eterna.
    expect(regra(rodar(base([lead({ createdAt: brt("2026-11-01", "10:00") })]), { robo: roboOk() }), "B1")).toBeUndefined();
  });

  it("(a) leitura falhando: dono dados, alta, id estável pelo início da falha — e (b) não roda", () => {
    const falhando: RoboAgora = { ...roboOk(), sync: { ultimoOk: brt(HOJE, "14:55"), falha: { desde: brt(HOJE, "14:56"), erro: "Não consegui falar com o banco do robô." } } };
    const acoes = rodar(base(semMensagem()), { robo: falhando });
    const b1 = acoes.filter((a) => a.regra === "B1");
    expect(b1).toHaveLength(1);
    expect(b1[0]).toMatchObject({ id: `B1:sync:${brt(HOJE, "14:56")}`, dono: "DADOS", severidade: "alta", href: "/configuracoes/integracoes#robo" });
    expect(b1[0].titulo).toMatch(/^A leitura do robô está falhando desde/);
  });

  it("(a) leitura parada há mais de 45 min (sem falha registrada) e nunca feita", () => {
    const parada: RoboAgora = { ligado: true, lidoAte: brt(HOJE, "14:00"), confiavel: true, sync: { ultimoOk: brt(HOJE, "14:00"), falha: null } };
    expect(regra(rodar(base(semMensagem()), { robo: parada }), "B1")).toMatchObject({ id: `B1:sync:${brt(HOJE, "14:00")}`, titulo: "A leitura do robô está parada há 1 h" });
    const nunca: RoboAgora = { ligado: true, lidoAte: null, confiavel: false, sync: { ultimoOk: null, falha: null } };
    expect(regra(rodar(base([]), { robo: nunca }), "B1")).toMatchObject({ id: "B1:sync:nunca", dono: "DADOS" });
  });

  it("o alerta global 'sem a 1ª mensagem' diz o MESMO número da B1 (b)", () => {
    const data = base(semMensagem());
    const b1 = regra(rodar(data, { robo: roboOk() }), "B1")!;
    const c = semMensagemDoRobo(data.leads, new Map(), roboOk(), AGORA);
    const [alerta] = alertaRoboSem1aMsg(c);
    expect(alerta).toMatchObject({ id: "robo-sem-1a-msg", nivel: "falha", cta: { href: "/configuracoes/integracoes#robo" } });
    expect(alerta.titulo).toBe("2 leads sem a 1ª mensagem do robô");
    expect(b1.amostra.n).toBe(c.total);
    expect(alertaRoboSem1aMsg({ total: 0, naoChegaram: 0 })).toEqual([]);
  });

  it("sem robô, nada de B1 (desligado não é erro)", () => {
    expect(regra(rodar(base(semMensagem())), "B1")).toBeUndefined();
    expect(regra(rodar(base(semMensagem()), { robo: { ...roboOk(), ligado: false } }), "B1")).toBeUndefined();
  });
});

describe("C2, G1 e a ordem com o robô ligado", () => {
  it("C2 (1º contato humano em 1 h útil) é nula com o robô ligado — o 1º contato é dele", () => {
    const leads = Array.from({ length: 10 }, (_, i) =>
      lead({ createdAt: brt("2026-11-02", "10:00"), status: "em_contato", firstContactAt: i < 2 ? brt("2026-11-02", "10:30") : brt("2026-11-03", "11:00") }),
    );
    const data = base(leads, { metas: [meta("primeiro_contato_no_prazo", 0.9)] });
    expect(regra(rodar(data), "C2")).toBeDefined();
    expect(regra(rodar(data, { robo: roboOk() }), "C2")).toBeUndefined();
  });

  it("o 1º contato no prazo não conta quem o robô recebeu (11.7) — nem os 'parados' do 1º contato com o robô ligado", () => {
    const data = base([
      lead({ createdAt: brt("2026-11-02", "10:00"), status: "em_contato", firstContactAt: brt("2026-11-02", "10:30") }),
      lead({ createdAt: brt("2026-11-02", "10:00"), roboVistoEm: brt("2026-11-02", "10:05") }), // com o robô, sem tentativa humana
      lead({ createdAt: brt("2026-11-02", "10:00") }), // nunca visto, prazo vencido
    ]);
    const k = kpisDoPeriodo(data, undefined, { hoje: HOJE, agora: AGORA });
    expect(k.primeiroContatoNoPrazo.n).toBe(2);
    expect(k.primeiroContatoNoPrazo.valor).toBeCloseTo(0.5, 5);
    // Robô DESLIGADO (também depois de ter rodado: o lead visto pelo robô volta a
    // "Novos"): os "parados" do 1º contato — na cascata (degrau "Agendaram reunião",
    // sem a mesa do atendimento) e no Funil — são o grupo "Novos" da Fila, com link.
    const novosNaFila = montarFila({ nowIso: AGORA, leads: data.leads, eventos: [] }).grupos.find((g) => g.etapa === "novo")!.total;
    expect(novosNaFila).toBe(2);
    const cascata = montarCascata({ data, range: undefined, robo: null, comercial: null, kpis: k });
    expect(cascata.degraus.find((d) => d.key === "reunioes")).toMatchObject({ parados: novosNaFila, etapaFila: "novo" });
    const funil = (roboLigado?: boolean) =>
      montarFunil({ data, range: undefined, kpis: k, robo: null, comercial: null, roboLigado, vista: "coorte", hoje: HOJE, agora: AGORA });
    expect(funil().etapas.find((e) => e.key === "primeiro_contato")).toMatchObject({ parados: novosNaFila, etapaFila: "novo" });
    // Robô ligado: quem o robô recebeu sai dos parados, e a Fila não tem "Novos" — o
    // número fica, sem link para um grupo que não existe.
    expect(funil(true).etapas.find((e) => e.key === "primeiro_contato")).toMatchObject({ parados: 1, etapaFila: undefined });
    expect(
      montarCascata({ data, range: undefined, robo: null, comercial: null, kpis: k, roboLigado: true }).degraus.find((d) => d.key === "reunioes"),
    ).toMatchObject({ parados: 1, etapaFila: undefined });
  });

  it("G1 não existe mais; a ordem é C1, depois B1, depois o resto pela prioridade", () => {
    // C3 (alta, com impacto) tem prioridade MAIOR que a B1 ("agora", sem impacto) — e fica atrás dela.
    const encerrados = Array.from({ length: 156 }, () =>
      lead({ createdAt: brt("2026-10-15", "10:00"), status: "sem_interesse", lostAt: brt("2026-10-15", "18:00") }),
    );
    const agendados = Array.from({ length: 4 }, () =>
      lead({ createdAt: brt("2026-10-15", "10:00"), status: "agendado", bookedAt: brt("2026-10-16", "10:00"), meetingFor: brt("2026-12-01", "10:00") }),
    );
    const data = base(
      [...encerrados, ...agendados, lead(semResposta()), lead({ createdAt: brt(HOJE, "14:30") }), lead({ createdAt: brt(HOJE, "14:31") })],
      { metas: [meta("taxa_lead_agendada", 0.1)] },
    );
    const acoes = rodar(data, { robo: roboOk(), fontes: { gastoSemMarca: 300 } });
    expect(acoes.map((a) => a.regra).slice(0, 2)).toEqual(["C1", "B1"]);
    const c3 = regra(acoes, "C3")!;
    expect(c3.prioridade).toBeGreaterThan(regra(acoes, "B1")!.prioridade);
    const resto = acoes.slice(2);
    for (let i = 1; i < resto.length; i++) expect(resto[i - 1].prioridade).toBeGreaterThanOrEqual(resto[i].prioridade);
    expect(acoes.some((a) => (a.regra as string) === "G1")).toBe(false);
  });
});
