/**
 * Fase 1 (nov/26) — Leads com o robô de WhatsApp ligado: a coluna "Atendimento"
 * (`atendimentoAgora`) sai da MESMA régua da Fila (`etapaDoLead` com o robô) e de
 * `situacaoDoRobo`; o filtro `robo` usa o predicado único (`casaFiltroRobo`) e cada
 * chave conta o MESMO número da barra da Fila, da B1, do alerta e de Integrações.
 * Fixture sintética; datas em Brasília (UTC−3). 04/11/2026 é quarta.
 */
import { describe, expect, it } from "vitest";
import { alertaRoboSem1aMsg } from "../alertas";
import { estadoDoRobo } from "../configuracoes";
import { proximaPelaCadencia } from "../contato";
import { etapaDoLead, montarFila, reunioesPorTelefone } from "../fila";
import { kpisDoPeriodo } from "../kpis";
import { motorDeAcoes } from "../motor";
import { FILTRO_VAZIO, aplicarFiltro, montarCsvDeLeads, montarLinhasDeLeads, type LinhaDeLead } from "../leads-vista";
import { chaveTelefoneValida } from "../phone";
import { comPeriodo } from "../range";
import { reabertosPorLead, semMensagemDoRobo } from "../robo/situacao";
import type { DashboardData, Lead, LeadEvent } from "../types";

const brt = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();
const HOJE = "2026-11-04";
const ONTEM = "2026-11-03";
const AGORA = brt(HOJE, "14:00");
/** Leitura em dia (5 min atrás): as regras medem contra ela. */
const robo = { ligado: true, lidoAte: brt(HOJE, "13:55"), confiavel: true };

let n = 0;
const lead = (id: string, over: Partial<Lead> = {}): Lead => ({
  id,
  brand: "consorcio",
  createdAt: brt(HOJE, "09:00"),
  name: `Pessoa ${id}`,
  // Um número por pessoa (a Fila junta quem tem o mesmo telefone).
  phone: `55119888${String(++n).padStart(5, "0")}`,
  status: "lead",
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

const conversa = lead("conversa", {
  ...saudado(HOJE),
  roboRespondeuEm: brt(HOJE, "09:30"),
  roboUltimaMsgClienteEm: brt(HOJE, "12:00"),
  roboUltimaInteracaoEm: brt(HOJE, "12:00"),
  roboEtapa: "em_conversa",
});
const esperando = lead("esperando", saudado(HOJE));
const semResposta = lead("semresposta", saudado(ONTEM));
const comTentativa = lead("tentativa", {
  ...saudado(ONTEM),
  status: "em_contato",
  firstContactAt: brt(HOJE, "10:00"),
});
const semWhatsapp = lead("semwhats", {
  createdAt: brt(HOJE, "08:00"),
  roboVistoEm: brt(HOJE, "08:05"),
  roboEtapa: "sem_whatsapp",
  roboSemWhatsappEm: brt(HOJE, "08:05"),
});
const roboNaoFalou = lead("naofalou", { createdAt: brt(HOJE, "11:00") }); // 3 h sem registro
const naoRecebeu = lead("naorecebeu", { createdAt: brt(HOJE, "13:30") }); // 30 min sem registro
const aceitou = lead("aceitou", {
  ...saudado(ONTEM),
  roboRespondeuEm: brt(ONTEM, "09:10"),
  roboUltimaMsgClienteEm: brt(HOJE, "13:00"),
  roboUltimaInteracaoEm: brt(HOJE, "13:00"),
  roboConviteEm: brt(HOJE, "12:00"),
  roboAceitouEm: brt(HOJE, "13:00"),
  roboEtapa: "transferido",
});
const confirmar = lead("confirmar", {
  createdAt: brt(ONTEM, "10:00"),
  status: "agendado",
  bookedAt: brt(ONTEM, "11:00"),
  meetingFor: brt("2026-11-05", "10:00"),
});
const semDesfecho = lead("semdesfecho", {
  createdAt: brt("2026-11-02", "10:00"),
  status: "agendado",
  bookedAt: brt("2026-11-02", "11:00"),
  meetingFor: brt(ONTEM, "10:00"),
});
const encerrado = lead("encerrado", {
  ...saudado("2026-11-02"),
  roboRespondeuEm: brt("2026-11-02", "09:10"),
  roboUltimaMsgClienteEm: brt("2026-11-02", "11:00"),
  roboUltimaInteracaoEm: brt("2026-11-02", "11:00"),
  roboEtapa: "frio",
  roboEncerradoEm: brt(ONTEM, "10:00"),
});
const antes = lead("antes", { createdAt: brt("2026-10-20", "10:00") });
const optOut = lead("optout", { ...saudado(HOJE), roboOptOutEm: brt(HOJE, "10:00"), roboEtapa: "opt_out" });

const leads = [
  conversa,
  esperando,
  semResposta,
  comTentativa,
  semWhatsapp,
  roboNaoFalou,
  naoRecebeu,
  aceitou,
  confirmar,
  semDesfecho,
  encerrado,
  antes,
  optOut,
];

const eventos: LeadEvent[] = [
  {
    id: "T1",
    leadId: comTentativa.id,
    leadName: comTentativa.name,
    actor: "ana",
    action: "tentativa",
    occurredAt: brt(HOJE, "10:00"),
    createdAt: brt(HOJE, "10:00"),
    // Sem resposta: a próxima pela cadência é 2 h depois (12:00) — já venceu.
    payload: { canal: "ligacao", falou: "nao", proxima: proximaPelaCadencia(brt(HOJE, "10:00"), 1)! },
  },
];

function base(): DashboardData {
  return {
    campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-10-01", budgetTotal: 0 },
    igAccountDaily: [],
    igPosts: [],
    adDaily: [],
    creatives: [],
    lpDaily: [],
    leads,
    goals: [],
    metas: [],
    updatedAt: AGORA,
  };
}

const porId = (linhas: LinhaDeLead[]) => Object.fromEntries(linhas.map((l) => [l.id, l]));

describe("Leads com o robô ligado — a coluna Atendimento", () => {
  const linhas = montarLinhasDeLeads(base(), eventos, AGORA, { robo });
  const por = porId(linhas);

  it("com o robô: em conversa, esperando resposta, encerrado, não recebeu — com o tempo e o dono robô", () => {
    expect(por.conversa.atendimentoAgora).toMatchObject({ texto: "Robô · em conversa há 2 h", dono: "BOT", atrasado: false });
    expect(por.esperando.atendimentoAgora).toMatchObject({ texto: "Robô · esperando resposta há 5 h", dono: "BOT" });
    expect(por.encerrado.atendimentoAgora.texto).toBe("Robô · encerrado");
    expect(por.naorecebeu.atendimentoAgora.texto).toBe("Robô · não recebeu");
    // Quem está com o robô não está na Fila: sem link de grupo.
    expect(por.conversa.atendimentoAgora.href).toBeUndefined();
  });

  it("resgate: o motivo, ou as tentativas quando já houve — com o link do grupo e o prazo", () => {
    // O motivo sem número: "há 24 h" era a régua, não a medida (achado da Etapa C).
    expect(por.semresposta.atendimentoAgora).toMatchObject({
      texto: "Resgate · não respondeu ao robô",
      dono: "COM",
      href: "/fila?etapa=resgate#resgate",
      atrasado: true, // 09:00 → 14:00 = 5 h úteis num prazo de 2
    });
    expect(por.tentativa.atendimentoAgora.texto).toBe("Resgate · 1 tentativa");
    expect(por.semwhats.atendimentoAgora.texto).toBe("Resgate · sem WhatsApp");
    expect(por.naofalou.atendimentoAgora.texto).toBe("Resgate · o robô não falou");
  });

  it("comercial: conferir o Calendly, confirmar com a data, registrar o desfecho", () => {
    expect(por.aceitou.atendimentoAgora).toMatchObject({
      texto: "Comercial · conferir Calendly",
      href: "/fila?etapa=convite-aceito#convite-aceito",
      atrasado: false,
    });
    expect(por.confirmar.atendimentoAgora.texto).toBe("Comercial · confirmar 05/11");
    expect(por.semdesfecho.atendimentoAgora.texto).toBe("Comercial · registrar desfecho");
  });

  it("antes do robô e opt-out", () => {
    expect(por.antes.atendimentoAgora.texto).toBe("Antes do robô");
    expect(por.optout.atendimentoAgora.texto).toBe("Robô · encerrado");
    expect(por.optout.optOut).toBe(true);
    expect(por.conversa.optOut).toBe(false);
  });

  it("a coluna e a Fila concordam: o grupo da linha é o grupo da Fila, e a ordem é o atraso dela", () => {
    const fila = montarFila({ nowIso: AGORA, leads, eventos, robo });
    for (const item of fila.itens) {
      const l = por[item.leadId!];
      expect(l.etapaDaFila).toBe(item.etapa);
      expect(l.atendimentoAgora.href).toBe(`/fila?etapa=${item.etapa}#${item.etapa}`);
      expect(l.atendimentoAgora.ordem).toBeCloseTo(item.atraso, 6);
    }
    // E o contrário: todo link de grupo da coluna abre um grupo onde a pessoa ESTÁ.
    for (const l of linhas) {
      const g = l.atendimentoAgora.href?.match(/^\/fila\?etapa=([^#]+)#/)?.[1];
      if (!g) continue;
      expect(fila.grupos.find((x) => x.etapa === g)?.itens.some((i) => i.leadId === l.id)).toBe(true);
    }
  });

  it("o filtro dono lê o atendimento", () => {
    expect(
      aplicarFiltro(linhas, { ...FILTRO_VAZIO, dono: "BOT" })
        .map((x) => x.id)
        .sort(),
    ).toEqual(["conversa", "encerrado", "esperando", "naorecebeu", "optout"]);
  });

  it("o CSV leva o texto do atendimento numa coluna só", () => {
    const csv = montarCsvDeLeads([por.conversa]);
    expect(csv.split("\r\n")[1].split(";")[7]).toBe("Robô · em conversa há 2 h");
  });

  it("robô desligado: o texto de antes, sem o prefixo “Robô”, e o filtro do robô vazio", () => {
    const sem = porId(montarLinhasDeLeads(base(), eventos, AGORA));
    expect(sem.conversa.atendimentoAgora).toMatchObject({ texto: "ligar agora", dono: "COM", href: "/fila?etapa=novo#novo" });
    expect(sem.antes.atendimentoAgora.texto).toBe("ligar agora");
    expect(sem.confirmar.atendimentoAgora.texto).toBe("confirmar reunião");
    expect(Object.values(sem).every((x) => x.robo.length === 0)).toBe(true);
    expect(Object.values(sem).some((x) => x.atendimentoAgora.texto.startsWith("Robô"))).toBe(false);
  });

  it("reunião já confirmada (fora de 'a confirmar' nos dois modos): a dica não manda confirmar de novo", () => {
    const confirmada = lead("confirmada", {
      createdAt: brt(ONTEM, "10:00"),
      status: "agendado",
      bookedAt: brt(ONTEM, "11:00"),
      meetingFor: brt("2026-11-05", "10:00"),
      reuniaoConfirmadaEm: brt(HOJE, "09:00"),
    });
    const dados = { ...base(), leads: [confirmada] };
    for (const opts of [{}, { robo }]) {
      const [linha] = montarLinhasDeLeads(dados, [], AGORA, opts);
      expect(linha.atendimentoAgora.texto).toBe("—");
      expect(linha.atendimentoAgora.dica).toMatch(/já confirmada; registre o desfecho depois dela/);
      expect(linha.atendimentoAgora.dica).not.toMatch(/confirmar \d+ h antes/);
    }
  });
});

describe("filtro robo: cada chave conta o número de quem linka para ela", () => {
  const linhas = montarLinhasDeLeads(base(), eventos, AGORA, { robo });
  const ids = (chave: Parameters<typeof aplicarFiltro>[1]["robo"]) =>
    aplicarFiltro(linhas, { ...FILTRO_VAZIO, robo: chave })
      .map((x) => x.id)
      .sort();
  const fila = montarFila({ nowIso: AGORA, leads, eventos, robo });

  it("a barra “Com o robô agora” da Fila = o filtro de Leads (sem período)", () => {
    expect(fila.comRobo).toEqual({ emConversa: 1, esperando: 1, encerrados: 2 });
    expect(ids("em-conversa")).toHaveLength(fila.comRobo.emConversa);
    expect(ids("esperando")).toHaveLength(fila.comRobo.esperando);
    expect(ids("encerrado")).toEqual(["encerrado", "optout"]);
    expect(ids("encerrado")).toHaveLength(fila.comRobo.encerrados);
  });

  it("“sem a 1ª mensagem” = a B1 (b), o alerta e Integrações — o MESMO `semMensagemDoRobo`", () => {
    const sem = semMensagemDoRobo(leads, reabertosPorLead(eventos), robo, AGORA);
    expect(sem).toMatchObject({ total: 2, naoChegaram: 2 });
    expect(ids("sem-1a-msg")).toEqual([...sem.ids].sort());
    expect(alertaRoboSem1aMsg(sem)[0].titulo).toBe("2 leads sem a 1ª mensagem do robô");
    const integracoes = estadoDoRobo({
      configurado: true,
      desativado: false,
      registro: { ultimoOk: robo.lidoAte, falha: null },
      leitura: { casaram: 9, semLeadNoPainel: 1 },
      semMensagem: sem,
      agora: AGORA,
    });
    expect(integracoes.detalhe).toContain(`${ids("sem-1a-msg").length} sem a 1ª mensagem do robô (2 não chegaram ao robô)`);
    // A B1 (b) do motor: o mesmo número, e o link abre exatamente esta chave, sem período.
    const data = base();
    const acoes = motorDeAcoes({
      data,
      range: undefined,
      kpis: kpisDoPeriodo(data, undefined, { hoje: HOJE, agora: AGORA }),
      eventos,
      agora: AGORA,
      hoje: HOJE,
      robo: { ...robo, sync: { ultimoOk: robo.lidoAte, falha: null } },
    });
    const b1 = acoes.find((a) => a.regra === "B1")!;
    expect(b1.href).toBe("/leads?robo=sem-1a-msg&range=all");
    expect(b1.amostra.n).toBe(ids("sem-1a-msg").length);
    // O card de ações passa todo href por `comPeriodo`: o link que já leva `range` sai
    // intacto (antes ganhava um 2º `range=7d` e `searchParams.range` virava array).
    expect(comPeriodo(b1.href, "7d")).toBe(b1.href);
    expect(comPeriodo("/leads?robo=x&range=all#t", "7d")).toBe("/leads?robo=x&range=all#t");
    expect(comPeriodo("/leads?robo=x#t", "7d")).toBe("/leads?robo=x&range=7d#t");
    expect(comPeriodo("/leads?arrange=1", "7d")).toBe("/leads?arrange=1&range=7d");
  });

  it("as outras chaves: os motivos do robô, o convite aceito, sem WhatsApp e antes do robô", () => {
    expect(ids("resgate")).toEqual(["naofalou", "semresposta", "semwhats", "tentativa"]);
    expect(ids("convite-aceito")).toEqual(["aceitou"]);
    expect(ids("sem-whatsapp")).toEqual(["semwhats"]);
    expect(ids("antes")).toEqual(["antes"]);
  });
});

/*
 * Etapa C (achados): quem a cadência humana tirou do grupo AGORA não está na Fila —
 * a coluna diz quando a pessoa volta, sem link para um grupo onde ela não está; e
 * o aceite que a mesma pessoa já transformou em reunião por OUTRO cadastro não
 * volta a pedir a reunião.
 */
describe("Leads com o robô ligado — fora do grupo agora (cadência e outro cadastro)", () => {
  const falouHoje = lead("falou", { ...saudado(ONTEM), status: "em_contato", firstContactAt: brt(HOJE, "10:00") });
  const antesComRetorno = lead("antesret", {
    createdAt: brt("2026-10-20", "10:00"),
    status: "em_contato",
    firstContactAt: brt(ONTEM, "15:00"),
  });
  const telefone = "5511977776666";
  const aceite = {
    ...saudado(ONTEM),
    phone: telefone,
    roboRespondeuEm: brt(ONTEM, "09:10"),
    roboUltimaMsgClienteEm: brt(HOJE, "11:00"),
    roboUltimaInteracaoEm: brt(HOJE, "11:00"),
    roboConviteEm: brt(HOJE, "10:30"),
    roboAceitouEm: brt(HOJE, "11:00"),
    roboEtapa: "transferido" as const,
  };
  const agendouA = lead("cadastroA", {
    ...aceite,
    status: "agendado",
    bookedAt: brt(HOJE, "12:00"),
    meetingFor: brt("2026-11-10", "10:00"), // longe: fora de "a confirmar"
  });
  const cadastroB = lead("cadastroB", aceite);
  const meus = [falouHoje, antesComRetorno, agendouA, cadastroB];
  const evs: LeadEvent[] = [
    {
      id: "TF",
      leadId: falouHoje.id,
      leadName: falouHoje.name,
      actor: "ana",
      action: "tentativa",
      occurredAt: brt(HOJE, "10:00"),
      createdAt: brt(HOJE, "10:00"),
      // Conseguiu falar, sem desfecho: volta 24 h depois (amanhã 10:00).
      payload: { canal: "ligacao", falou: "sim" },
    },
    {
      id: "TA",
      leadId: antesComRetorno.id,
      leadName: antesComRetorno.name,
      actor: "ana",
      action: "tentativa",
      occurredAt: brt(ONTEM, "15:00"),
      createdAt: brt(ONTEM, "15:00"),
      payload: { canal: "ligacao", falou: "nao", proxima: brt(HOJE, "16:00") },
    },
  ];
  const data = { ...base(), leads: meus };
  const por = porId(montarLinhasDeLeads(data, evs, AGORA, { robo }));
  const fila = montarFila({ nowIso: AGORA, leads: meus, eventos: evs, robo });
  const naFila = (id: string) => fila.itens.some((i) => i.leadId === id);

  it("a cadência escondeu do resgate: “Resgate · volta …”, sem link, e a Fila não mostra a pessoa", () => {
    expect(naFila("falou")).toBe(false);
    expect(por.falou.atendimentoAgora).toMatchObject({ texto: "Resgate · volta 05/11 10:00", dono: "COM", atrasado: false });
    expect(por.falou.atendimentoAgora.href).toBeUndefined();
    expect(por.falou.etapaDaFila).toBeUndefined();
    // A dica fala do grupo que existe com o robô — nunca do "Retornar hoje" do robô desligado.
    expect(por.falou.atendimentoAgora.dica).toContain("Volta ao grupo “Resgate” da Fila");
    expect(por.falou.atendimentoAgora.dica).not.toContain("Retornar hoje");
    // O filtro do robô continua contando o fato (os motivos do robô), como antes.
    expect(por.falou.robo).toContain("resgate");
  });

  it("antes do robô com retorno combinado: volta ao Resgate na hora da cadência (não “fica fora da Fila”)", () => {
    expect(naFila("antesret")).toBe(false);
    expect(por.antesret.atendimentoAgora).toMatchObject({ texto: "Resgate · volta 04/11 16:00" });
    expect(por.antesret.atendimentoAgora.href).toBeUndefined();
    expect(por.antesret.atendimentoAgora.dica).not.toContain("fica fora da Fila");
    // Às 16:00, a mesma pessoa está no Resgate (motivo "retorno") — com o link.
    const depois = brt(HOJE, "16:30");
    expect(montarFila({ nowIso: depois, leads: meus, eventos: evs, robo }).itens.find((i) => i.leadId === "antesret")).toMatchObject({
      etapa: "resgate",
      motivo: "retorno",
    });
    expect(porId(montarLinhasDeLeads(data, evs, depois, { robo })).antesret.atendimentoAgora.href).toBe("/fila?etapa=resgate#resgate");
  });

  it("aceitou o convite e a mesma pessoa agendou por outro cadastro depois: não pede a 2ª reunião", () => {
    const grupo = fila.grupos.find((g) => g.etapa === "convite-aceito")!;
    expect(grupo.total).toBe(0);
    expect(por.cadastroB.atendimentoAgora).toMatchObject({ texto: "Reunião em outro cadastro", dono: "COM" });
    expect(por.cadastroB.atendimentoAgora.href).toBeUndefined();
    // Reunião de ANTES do aceite não consome o convite: aí ele continua pedindo a data.
    const antesDoAceite = new Map([[chaveTelefoneValida(telefone)!, brt(ONTEM, "08:00")]]);
    expect(etapaDoLead(cadastroB, [], AGORA, robo, { reunioesPorTelefone: antesDoAceite })?.nome).toBe("convite-aceito");
    expect(reunioesPorTelefone(meus).get(chaveTelefoneValida(telefone)!)).toBe(agendouA.bookedAt);
  });
});
