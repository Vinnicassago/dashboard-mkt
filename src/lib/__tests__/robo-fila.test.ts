/**
 * Fase 1 (nov/26), etapa B — a Fila com o robô de WhatsApp ligado: os quatro
 * grupos na ordem fixa, a cadência humana no resgate e no convite aceito, as
 * reuniões, o "não compareceu", o retorno de antes do robô, o dedupe, a barra
 * "Com o robô agora" e as entradas do aviso. E o robô DESLIGADO = a Fila de antes.
 * Puro; datas em Brasília (UTC−3); AGORA ≥ 29/10.
 */
import { describe, expect, it } from "vitest";
import {
  FILA_ETAPAS,
  GRUPOS_COM_ROBO,
  GRUPOS_SEM_ROBO,
  SLA_PRIMEIRO_CONTATO_HORAS,
  etapaDoLead,
  grupoDaUrl,
  montarFila,
  type FilaEtapa,
} from "../fila";
import { SLA_PRIMEIRO_CONTATO_HORAS as DO_FUNIL } from "../funil";
import { proximaPelaCadencia } from "../contato";
import type { RoboNaFila } from "../robo/situacao";
import type { Lead, LeadEvent } from "../types";
import { estaResolvido, podarResolvidos, type Resolvido } from "@/components/fila/resolvidos";

const brt = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();
const AGORA = brt("2026-11-04", "15:00"); // quarta
const ROBO: RoboNaFila = { ligado: true, lidoAte: brt("2026-11-04", "14:55"), confiavel: true };

let seq = 0;
const lead = (id: string, extra: Partial<Lead> = {}): Lead => ({
  id,
  brand: "consorcio",
  createdAt: brt("2026-11-04", "09:00"),
  name: `Pessoa ${id}`,
  phone: `55119876${String(++seq).padStart(5, "0")}`,
  status: "lead",
  ...extra,
});

const tentativa = (leadId: string, quando: string, n = 1, falou = false): LeadEvent => ({
  id: `T-${leadId}-${quando}`,
  leadId,
  leadName: "x",
  actor: "ana",
  action: "tentativa",
  occurredAt: quando,
  createdAt: quando,
  payload: { canal: "whatsapp", falou: falou ? "sim" : "nao", ...(falou ? {} : { proxima: proximaPelaCadencia(quando, n)! }) },
});

/** Respondeu ao robô e aceitou o convite. */
const aceite = (em: string): Partial<Lead> => ({
  roboVistoEm: brt("2026-11-04", "09:05"),
  roboSaudacaoEm: brt("2026-11-04", "09:01"),
  roboRespondeuEm: brt("2026-11-04", "09:10"),
  roboEtapa: "transferido",
  roboAceitouEm: em,
});
/** Saudado ontem e nunca respondeu: resgate "sem resposta" desde hoje 10:01. */
const semResposta: Partial<Lead> = {
  createdAt: brt("2026-11-03", "10:00"),
  roboVistoEm: brt("2026-11-03", "10:05"),
  roboSaudacaoEm: brt("2026-11-03", "10:01"),
  roboEtapa: "nao_respondeu",
};

describe("a régua dos grupos (fonte única)", () => {
  it("rótulos, prazos de 2 horas úteis no resgate e no convite aceito, profundidade e hints de uma frase", () => {
    expect(FILA_ETAPAS.resgate).toMatchObject({ label: "Resgate", slaHoras: 2, horasUteis: true, dono: "COM", profundidade: 1.5 });
    expect(FILA_ETAPAS["convite-aceito"]).toMatchObject({ label: "Aceitou o convite", slaHoras: 2, horasUteis: true, dono: "COM", profundidade: 3 });
    expect(FILA_ETAPAS.confirmar.profundidade).toBe(4);
    expect(FILA_ETAPAS["sem-desfecho"].profundidade).toBe(5);
    // Os grupos do robô ligado: o hint é UMA frase de até 12 palavras (vira o ⓘ do grupo).
    for (const e of GRUPOS_COM_ROBO) {
      const m = FILA_ETAPAS[e];
      expect(m.hint.split(/\s+/).filter((p) => /\p{L}|\d/u.test(p)).length, e).toBeLessThanOrEqual(12);
      expect(m.hint.replace(/\.$/, "").includes(". "), e).toBe(false); // uma frase
    }
    for (const m of Object.values(FILA_ETAPAS)) expect(m.dono).toBe("COM");
    expect(GRUPOS_COM_ROBO).toEqual(["resgate", "convite-aceito", "confirmar", "sem-desfecho"]);
    expect(GRUPOS_SEM_ROBO).toEqual(["novo", "retornar", "confirmar", "sem-desfecho"]);
  });

  it("o prazo do 1º contato humano mora na Fila (derivado de 'novo') e o Funil reexporta o mesmo", () => {
    expect(SLA_PRIMEIRO_CONTATO_HORAS).toBe(FILA_ETAPAS.novo.slaHoras);
    expect(DO_FUNIL).toBe(SLA_PRIMEIRO_CONTATO_HORAS);
  });

  it("links antigos (?etapa=) abrem o grupo de hoje — ou o topo", () => {
    for (const e of ["novo", "retornar", "sem-status", "resgate"]) expect(grupoDaUrl(e, true)).toBe("resgate");
    expect(grupoDaUrl("aguardando-contato", true)).toBe("convite-aceito");
    expect(grupoDaUrl("convite-aceito", true)).toBe("convite-aceito");
    for (const e of ["convite-pendente", "quentes", "todos", "xyz", undefined]) expect(grupoDaUrl(e, true)).toBeNull();
    expect(grupoDaUrl("confirmar", true)).toBe("confirmar");
    expect(grupoDaUrl("sem-desfecho", false)).toBe("sem-desfecho");
    // Robô desligado: o processo antigo.
    expect(grupoDaUrl("novo", false)).toBe("novo");
    expect(grupoDaUrl("sem-status", false)).toBe("novo");
    expect(grupoDaUrl("retornar", false)).toBe("retornar");
    expect(grupoDaUrl("aguardando-contato", false)).toBeNull();
    // `?etapa=a&etapa=b` chega como lista: vale o primeiro, e a página nunca cai.
    expect(grupoDaUrl(["novo", "resgate"], true)).toBe("resgate");
    expect(grupoDaUrl(["confirmar", "novo"], false)).toBe("confirmar");
    expect(grupoDaUrl([], true)).toBeNull();
  });
});

describe("Fila com o robô ligado", () => {
  it("quatro grupos na ordem fixa; dentro do grupo, o mais atrasado primeiro; quem está com o robô fica fora", () => {
    const leads = [
      lead("conf", { status: "agendado", meetingFor: brt("2026-11-05", "10:00"), bookedAt: brt("2026-11-03", "10:00") }),
      lead("semdes", { status: "agendado", meetingFor: brt("2026-11-03", "10:00"), bookedAt: brt("2026-11-01", "10:00") }),
      lead("aceitou", aceite(brt("2026-11-04", "11:00"))),
      lead("r1", semResposta),
      lead("r2", { createdAt: brt("2026-11-04", "12:00") }), // robô não falou desde 14:00
      lead("conversa", { roboVistoEm: brt("2026-11-04", "09:05"), roboSaudacaoEm: brt("2026-11-04", "09:01"), roboRespondeuEm: brt("2026-11-04", "09:10"), roboEtapa: "em_conversa" }),
      lead("novinho", { createdAt: brt("2026-11-04", "14:30") }), // ainda dentro dos 2 h do robô
    ];
    const f = montarFila({ nowIso: AGORA, leads, eventos: [], robo: ROBO });
    expect(f.grupos.map((g) => g.etapa)).toEqual(GRUPOS_COM_ROBO);
    expect(f.itens.map((i) => i.leadId)).toEqual(["r1", "r2", "aceitou", "conf", "semdes"]);
    const resgate = f.grupos[0];
    expect(resgate.itens.map((i) => [i.leadId, i.motivo])).toEqual([
      ["r1", "sem-resposta-24h"],
      ["r2", "robo-nao-falou"],
    ]);
    // r1: 10:01 → 15:00 = 5 h úteis contra 2 → 2,5×; r2: 1 h → 0,5×.
    expect(resgate.itens[0].atraso).toBeCloseTo(4.98 / 2, 1);
    expect(resgate.foraDoPrazo).toBe(1);
    // "A confirmar" não tem "fora do prazo".
    expect(f.grupos.find((g) => g.etapa === "confirmar")).toMatchObject({ total: 1, foraDoPrazo: 0 });
    expect(f.total).toBe(5);
  });

  it("cadência humana no resgate: quem já tentou some até a próxima da cadência — e a entrada continua (não é saída)", () => {
    const l = lead("r", semResposta);
    const t = tentativa("r", brt("2026-11-04", "14:00")); // próxima: 16:00
    expect(etapaDoLead(l, [t], AGORA, ROBO)).toBeNull();
    const f = montarFila({ nowIso: AGORA, leads: [l], eventos: [t], robo: ROBO });
    expect(f.total).toBe(0);
    expect(f.entradasDeResgate).toEqual([{ id: "r", primeiroNome: "Pessoa", motivo: "sem-resposta-24h", desde: brt("2026-11-04", "10:01") }]);
    // Às 16:30 a cadência venceu: volta ao grupo, com o relógio da tentativa.
    const depois = etapaDoLead(l, [t], brt("2026-11-04", "16:30"), { ...ROBO, lidoAte: brt("2026-11-04", "16:25") })!;
    expect(depois).toMatchObject({ nome: "resgate", motivo: "sem-resposta-24h", desde: brt("2026-11-04", "16:00") });
    expect(depois.contato?.tentativas).toBe(1);
  });

  it("aceitou o convite: todo lead (com classe também), com a mesma cadência; sai quando agenda", () => {
    const aceitou = lead("a", aceite(brt("2026-11-04", "11:00")));
    expect(etapaDoLead(aceitou, [], AGORA, ROBO)).toMatchObject({ nome: "convite-aceito", desde: brt("2026-11-04", "11:00") });
    expect(etapaDoLead(lead("aA", { ...aceite(brt("2026-11-04", "11:00")), classe: "A" }), [], AGORA, ROBO)?.nome).toBe("convite-aceito");
    // Ligou às 14:30 e não atendeu: some até 16:30.
    expect(etapaDoLead(aceitou, [tentativa("a", brt("2026-11-04", "14:30"))], AGORA, ROBO)).toBeNull();
    // Agendou (Calendly conferido): sai — a reunião longe ainda não é nada.
    const agendou = lead("ag", { ...aceite(brt("2026-11-04", "11:00")), status: "agendado", bookedAt: AGORA, meetingFor: brt("2026-11-10", "10:00") });
    expect(etapaDoLead(agendou, [], AGORA, ROBO)).toBeNull();
    expect(etapaDoLead(lead("enc", { ...aceite(brt("2026-11-04", "11:00")), status: "sem_interesse" }), [], AGORA, ROBO)).toBeNull();
  });

  it("aceitou o convite DEPOIS de uma conversa do resgate: a conversa de antes não adia a conferência do Calendly", () => {
    const aceitou = lead("a2", aceite(brt("2026-11-04", "11:00")));
    // Falou com a pessoa às 10:00 (antes do aceite): sem a regra, sumia até amanhã 10:00.
    const conversa = tentativa("a2", brt("2026-11-04", "10:00"), 1, true);
    expect(etapaDoLead(aceitou, [conversa], AGORA, ROBO)).toMatchObject({ nome: "convite-aceito", desde: brt("2026-11-04", "11:00") });
    // A tentativa DEPOIS do aceite continua valendo pela cadência.
    expect(etapaDoLead(aceitou, [conversa, tentativa("a2", brt("2026-11-04", "14:30"), 2)], AGORA, ROBO)).toBeNull();
  });

  it("'a confirmar' sem quem já confirmou — nos dois modos", () => {
    const reuniao = { status: "agendado" as const, meetingFor: brt("2026-11-05", "10:00"), bookedAt: brt("2026-11-03", "10:00") };
    for (const robo of [ROBO, undefined]) {
      expect(etapaDoLead(lead("c", reuniao), [], AGORA, robo)?.nome).toBe("confirmar");
      expect(etapaDoLead(lead("c", { ...reuniao, reuniaoConfirmadaEm: brt("2026-11-04", "10:00") }), [], AGORA, robo)).toBeNull();
    }
  });

  it("não compareceu → resgate para todos (com classe, antes do robô); com o robô desligado continua 'retornar'", () => {
    const faltou = { status: "no_show" as const, meetingFor: brt("2026-11-03", "10:00"), bookedAt: brt("2026-11-01", "10:00") };
    expect(etapaDoLead(lead("n", faltou), [], AGORA, ROBO)).toMatchObject({ nome: "resgate", motivo: "nao-compareceu", desde: brt("2026-11-03", "10:00") });
    expect(etapaDoLead(lead("nA", { ...faltou, classe: "A" }), [], AGORA, ROBO)?.motivo).toBe("nao-compareceu");
    expect(etapaDoLead(lead("nV", { ...faltou, createdAt: brt("2026-10-10", "10:00") }), [], AGORA, ROBO)?.motivo).toBe("nao-compareceu");
    expect(etapaDoLead(lead("n", faltou), [], AGORA)?.nome).toBe("retornar");
  });

  it("não compareceu COM a cadência: a tentativa depois da reunião some com a pessoa até a próxima; a de antes não adia", () => {
    const faltou = lead("ns", { status: "no_show", meetingFor: brt("2026-11-03", "10:00"), bookedAt: brt("2026-11-01", "10:00") });
    // Ligou às 14:00 de hoje (o status continua `no_show`): a próxima é 16:00.
    const t = tentativa("ns", brt("2026-11-04", "14:00"));
    expect(etapaDoLead(faltou, [t], AGORA, ROBO)).toBeNull();
    expect(montarFila({ nowIso: AGORA, leads: [faltou], eventos: [t], robo: ROBO }).total).toBe(0);
    const depois = etapaDoLead(faltou, [t], brt("2026-11-04", "16:30"), ROBO)!;
    expect(depois).toMatchObject({ nome: "resgate", motivo: "nao-compareceu", desde: brt("2026-11-04", "16:00") });
    // A confirmação da véspera (falou, antes da reunião) não adia o resgate do não compareceu.
    const confirmou = tentativa("ns", brt("2026-11-02", "15:00"), 1, true);
    expect(etapaDoLead(faltou, [confirmou], AGORA, ROBO)).toMatchObject({ nome: "resgate", desde: brt("2026-11-03", "10:00") });
  });

  it("antes do robô: só o retorno de quem estava sendo trabalhado (tentativa nos últimos 7 dias)", () => {
    const antigo = { createdAt: brt("2026-10-20", "10:00"), status: "em_contato" as const };
    const recente = tentativa("v", brt("2026-11-02", "10:00"), 3); // 3ª da cadência: a próxima é 48 h depois
    expect(etapaDoLead(lead("v", antigo), [recente], AGORA, ROBO)).toMatchObject({ nome: "resgate", motivo: "retorno", desde: brt("2026-11-04", "10:00") });
    const velha = tentativa("v", brt("2026-10-25", "10:00"), 3);
    expect(etapaDoLead(lead("v", antigo), [velha], AGORA, ROBO)).toBeNull();
    // Nunca contatado antes do robô: sai da Fila (fica no filtro "Antes do robô" de Leads).
    expect(etapaDoLead(lead("w", { createdAt: brt("2026-10-20", "10:00") }), [], AGORA, ROBO)).toBeNull();
    // Com o robô desligado, os dois voltam ao processo antigo.
    expect(etapaDoLead(lead("w", { createdAt: brt("2026-10-20", "10:00") }), [], AGORA)?.nome).toBe("novo");
  });

  it("reaberto: o relógio recomeça no reaberto — o lead de setembro que voltou hoje entra no resgate 2 h depois, não 'antes do robô'", () => {
    const l = lead("v", { createdAt: brt("2026-09-01", "12:00") });
    const reab: LeadEvent = {
      id: "R-v",
      leadId: "v",
      leadName: "x",
      actor: "Landing page",
      action: "reaberto",
      fromStatus: "sem_resposta",
      toStatus: "lead",
      createdAt: brt("2026-11-04", "11:00"),
    };
    expect(etapaDoLead(l, [], AGORA, ROBO)).toBeNull(); // sem o reaberto: antes do robô
    expect(etapaDoLead(l, [reab], AGORA, ROBO)).toMatchObject({ nome: "resgate", motivo: "robo-nao-falou", desde: brt("2026-11-04", "13:00") });
    // Com o robô desligado, o caso de identidade.test: "novo" desde o reaberto.
    expect(etapaDoLead(l, [reab], AGORA)).toMatchObject({ nome: "novo", desde: brt("2026-11-04", "11:00") });
  });

  it("reaberto com tentativas do episódio ANTERIOR: a cadência delas não esconde quem voltou do resgate", () => {
    // Entrou em 01/11; três tentativas sem resposta (a 3ª combinou 06/11 09:00) e "Sem
    // resposta". Hoje 10:00 preencheu de novo (reaberto como "Novo"); o sync renovou o
    // "visto" e o robô não falou: resgate às 12:00 — não em 06/11.
    const l = lead("rv", {
      createdAt: brt("2026-11-01", "10:00"),
      roboVistoEm: brt("2026-11-04", "10:15"),
      roboRecebidoEm: brt("2026-11-01", "10:00"),
      roboSaudacaoEm: brt("2026-11-01", "10:01"),
      roboUltimaInteracaoEm: brt("2026-11-01", "10:01"),
      roboEtapa: "nao_respondeu",
    });
    const reab: LeadEvent = {
      id: "R-rv",
      leadId: "rv",
      leadName: "x",
      actor: "Landing page",
      action: "reaberto",
      fromStatus: "sem_resposta",
      toStatus: "lead",
      createdAt: brt("2026-11-04", "10:00"),
    };
    const antes = [
      tentativa("rv", brt("2026-11-02", "10:00"), 1),
      tentativa("rv", brt("2026-11-03", "10:00"), 2),
      tentativa("rv", brt("2026-11-04", "09:00"), 3),
    ];
    const evs = [...antes, reab];
    expect(etapaDoLead(l, evs, AGORA, ROBO)).toMatchObject({ nome: "resgate", motivo: "robo-nao-falou", desde: brt("2026-11-04", "12:00") });
    const f = montarFila({ nowIso: AGORA, leads: [l], eventos: evs, robo: ROBO });
    expect(f.grupos[0]).toMatchObject({ etapa: "resgate", total: 1 });
    expect(f.entradasDeResgate.map((e) => e.id)).toEqual(["rv"]); // o aviso leva ao grupo onde a pessoa ESTÁ
    // Robô desligado, o mesmo lead está em "Novos" desde o reaberto (o processo de antes).
    expect(etapaDoLead(l, evs, AGORA)).toMatchObject({ nome: "novo", desde: brt("2026-11-04", "10:00") });
    // A tentativa DEPOIS do reaberto volta a valer: some até a próxima da cadência.
    const depois = [...evs, tentativa("rv", brt("2026-11-04", "14:00"), 2)];
    expect(etapaDoLead(l, depois, AGORA, ROBO)).toBeNull();
  });

  it("agendou num episódio anterior, foi reaberto e aceitou o convite DE NOVO: 'Aceitou o convite' (não fica sem dono)", () => {
    const l = lead("ag", {
      createdAt: brt("2026-10-30", "10:00"),
      bookedAt: brt("2026-10-31", "10:00"), // o marco fica depois da desistência
      ...aceite(brt("2026-11-04", "11:05")),
      roboUltimaInteracaoEm: brt("2026-11-04", "11:05"),
    });
    const reab: LeadEvent = {
      id: "R-ag",
      leadId: "ag",
      leadName: "x",
      actor: "Landing page",
      action: "reaberto",
      fromStatus: "desistencia",
      toStatus: "lead",
      createdAt: brt("2026-11-04", "10:00"),
    };
    expect(etapaDoLead(l, [reab], AGORA, ROBO)).toMatchObject({ nome: "convite-aceito", desde: brt("2026-11-04", "11:05") });
    expect(montarFila({ nowIso: AGORA, leads: [l], eventos: [reab], robo: ROBO }).grupos[1]).toMatchObject({ etapa: "convite-aceito", total: 1 });
  });

  it("leitura nunca feita (ou parada): mede contra agora e ninguém fica sem dono; sem telefone vai ao resgate", () => {
    const nunca: RoboNaFila = { ligado: true, lidoAte: null, confiavel: false };
    expect(etapaDoLead(lead("x", { createdAt: brt("2026-11-04", "12:00") }), [], AGORA, nunca)).toMatchObject({ nome: "resgate", motivo: "robo-nao-falou" });
    const parada: RoboNaFila = { ligado: true, lidoAte: brt("2026-11-04", "09:00"), confiavel: false };
    expect(etapaDoLead(lead("y", { createdAt: brt("2026-11-04", "12:00") }), [], AGORA, parada)?.motivo).toBe("robo-nao-falou");
    expect(etapaDoLead(lead("z", { phone: undefined }), [], AGORA, ROBO)).toMatchObject({ nome: "resgate", motivo: "sem-telefone" });
  });

  it("dedupe por telefone: a mesma pessoa uma vez, no grupo mais fundo — e fora do aviso de resgate", () => {
    const fone = "5511987650099";
    const leads = [
      lead("dup1", { ...semResposta, phone: fone }),
      lead("dup2", { ...semResposta, phone: fone, createdAt: brt("2026-11-03", "11:00"), status: "agendado", meetingFor: brt("2026-11-05", "10:00"), bookedAt: AGORA }),
    ];
    const f = montarFila({ nowIso: AGORA, leads, eventos: [], robo: ROBO });
    expect(f.itens.map((i) => [i.leadId, i.etapa, i.tambemEm])).toEqual([["dup2", "confirmar", ["resgate"]]]);
    expect(f.entradasDeResgate).toEqual([]);
    // Dois cadastros no resgate: um aviso só, o que espera há mais tempo.
    const dois = montarFila({
      nowIso: AGORA,
      leads: [lead("d1", { ...semResposta, phone: fone }), lead("d2", { ...semResposta, phone: fone })],
      eventos: [],
      robo: ROBO,
    });
    expect(dois.total).toBe(1);
    expect(dois.entradasDeResgate.map((e) => e.id)).toEqual(["d1"]);
    // "A confirmar" venceu: a ordem dele é a proximidade da reunião (amanhã 10:00, 19 h), não a espera do outro.
    expect(f.itens[0].atraso).toBeCloseTo(1 - 19 / FILA_ETAPAS.confirmar.slaHoras, 5);
  });

  it("dedupe entre grupos diferentes: o atraso fica na régua do grupo que venceu (horas ÚTEIS), nunca as corridas do outro", () => {
    // A está no resgate desde sexta 17:00; B (o mesmo telefone) teve a reunião hoje,
    // segunda, às 9:00, sem desfecho. Agora: segunda 10:00 — 2 horas úteis desde sexta 17:00.
    const SEG = brt("2026-11-09", "10:00");
    const robo: RoboNaFila = { ligado: true, lidoAte: brt("2026-11-09", "09:55"), confiavel: true };
    const fone = "5511987650088";
    const leads = [
      lead("A", {
        phone: fone,
        createdAt: brt("2026-11-05", "16:59"),
        roboVistoEm: brt("2026-11-05", "17:05"),
        roboSaudacaoEm: brt("2026-11-05", "17:00"),
        roboEtapa: "nao_respondeu",
      }),
      lead("B", { phone: fone, status: "agendado", meetingFor: brt("2026-11-09", "09:00"), bookedAt: brt("2026-11-05", "18:00") }),
    ];
    expect(etapaDoLead(leads[0], [], SEG, robo)).toMatchObject({ nome: "resgate", desde: brt("2026-11-06", "17:00") });
    const f = montarFila({ nowIso: SEG, leads, eventos: [], robo });
    const semDesfecho = f.grupos.find((g) => g.etapa === "sem-desfecho")!;
    expect(semDesfecho.itens.map((i) => [i.leadId, i.tambemEm])).toEqual([["B", ["resgate"]]]);
    // A espera exibida é a maior (desde sexta), o atraso é 2 h úteis ÷ 24 — não 65 h corridas ÷ 24 ("2× o prazo").
    expect(semDesfecho.itens[0].desde).toBe(brt("2026-11-06", "17:00"));
    expect(semDesfecho.itens[0].atraso).toBeCloseTo(2 / FILA_ETAPAS["sem-desfecho"].slaHoras, 5);
    expect(semDesfecho.foraDoPrazo).toBe(0);
  });

  it("telefone lixo não junta: duas pessoas com '123' são duas no resgate e dois avisos (nos dois modos)", () => {
    const leads = [lead("j1", { phone: "123" }), lead("j2", { phone: "123" })];
    const f = montarFila({ nowIso: AGORA, leads, eventos: [], robo: ROBO });
    expect(f.grupos[0].itens.map((i) => [i.leadId, i.motivo])).toEqual([
      ["j1", "sem-telefone"],
      ["j2", "sem-telefone"],
    ]);
    expect(f.entradasDeResgate.map((e) => e.id)).toEqual(["j1", "j2"]);
    // Robô desligado: os dois em "Novos" (antes, um sumia — sem dono).
    expect(montarFila({ nowIso: AGORA, leads, eventos: [] }).grupos[0].itens.map((i) => i.leadId).sort()).toEqual(["j1", "j2"]);
  });

  it("a barra 'Com o robô agora': em conversa, esperando resposta e encerrados (abertos, sem classe, depois do corte)", () => {
    const leads = [
      lead("c1", { roboVistoEm: brt("2026-11-04", "09:05"), roboSaudacaoEm: brt("2026-11-04", "09:01"), roboRespondeuEm: brt("2026-11-04", "09:10"), roboEtapa: "em_conversa" }),
      lead("c2", { roboVistoEm: brt("2026-11-04", "09:05"), roboSaudacaoEm: brt("2026-11-04", "09:01"), roboRespondeuEm: brt("2026-11-04", "09:10"), roboEtapa: "convite_pendente" }),
      lead("e1", { roboVistoEm: brt("2026-11-04", "09:05"), roboSaudacaoEm: brt("2026-11-04", "09:01"), roboEtapa: "nao_respondeu" }),
      lead("x1", { roboVistoEm: brt("2026-11-04", "09:05"), roboSaudacaoEm: brt("2026-11-04", "09:01"), roboRespondeuEm: brt("2026-11-04", "09:10"), roboEtapa: "frio" }),
      lead("x2", { roboVistoEm: brt("2026-11-04", "09:05"), roboEtapa: "opt_out", roboOptOutEm: brt("2026-11-04", "09:30") }),
      lead("live", { classe: "A", roboVistoEm: brt("2026-11-04", "09:05"), roboSaudacaoEm: brt("2026-11-04", "09:01"), roboRespondeuEm: brt("2026-11-04", "09:10"), roboEtapa: "em_conversa" }),
      lead("r", semResposta), // resgate: está com o comercial, não com o robô
    ];
    const f = montarFila({ nowIso: AGORA, leads, eventos: [], robo: ROBO });
    expect(f.comRobo).toEqual({ emConversa: 2, esperando: 1, encerrados: 2 });
    expect(f.itens.map((i) => i.leadId)).toEqual(["r"]);
    expect(montarFila({ nowIso: AGORA, leads, eventos: [] }).comRobo).toEqual({ emConversa: 0, esperando: 0, encerrados: 0 });
  });
});

describe("robô desligado = a Fila de antes do robô, intacta", () => {
  it("as mesmas pessoas viram 'Novos' e 'Retornar' (e nada de resgate, aceite ou barra)", () => {
    const leads = [
      lead("novo", { createdAt: brt("2026-11-04", "12:00") }),
      lead("r1", semResposta),
      lead("aceitou", aceite(brt("2026-11-04", "11:00"))),
      lead("ret", { status: "em_contato" }),
      lead("conf", { status: "agendado", meetingFor: brt("2026-11-05", "10:00"), bookedAt: brt("2026-11-03", "10:00") }),
    ];
    const eventos = [tentativa("ret", brt("2026-11-04", "09:30"))]; // próxima 11:30: venceu
    for (const robo of [undefined, { ...ROBO, ligado: false }]) {
      const f = montarFila({ nowIso: AGORA, leads, eventos, robo });
      expect(f.grupos.map((g) => g.etapa)).toEqual(GRUPOS_SEM_ROBO);
      const porEtapa = Object.fromEntries(f.grupos.map((g) => [g.etapa, g.itens.map((i) => i.leadId).sort()])) as Record<FilaEtapa, string[]>;
      expect(porEtapa).toEqual({ novo: ["aceitou", "novo", "r1"], retornar: ["ret"], confirmar: ["conf"], "sem-desfecho": [] });
      expect(f.entradasDeResgate).toEqual([]);
      expect(f.comRobo).toEqual({ emConversa: 0, esperando: 0, encerrados: 0 });
    }
  });

  it("mudança de nov/26 também no modo desligado: dois cadastros da mesma pessoa na MESMA etapa medem o atraso em horas úteis", () => {
    // 08:00 e 08:30 (antes do expediente), agora 09:30: meia hora útil — no prazo de 1 hora útil.
    // Antes, o atraso do outro cadastro era refeito com as horas CORRIDAS (1,5 h → 1,5×, "fora do prazo").
    const fone = "5511987650777";
    const leads = [
      lead("tarde", { phone: fone, createdAt: brt("2026-11-04", "08:30") }),
      lead("cedo", { phone: fone, createdAt: brt("2026-11-04", "08:00") }),
    ];
    const f = montarFila({ nowIso: brt("2026-11-04", "09:30"), leads, eventos: [] });
    expect(f.total).toBe(1);
    const [item] = f.grupos[0].itens;
    expect(item).toMatchObject({ etapa: "novo", desde: brt("2026-11-04", "08:00"), tambemEm: [] });
    expect(item.horasEsperando).toBeCloseTo(1.5, 5);
    expect(item.atraso).toBeCloseTo(0.5, 5);
    expect(f.grupos[0].foraDoPrazo).toBe(0);
  });
});

describe("Fila na tela: as linhas resolvidas valem para o grupo e são podadas a cada resposta do servidor", () => {
  const item = (id: string, etapa: FilaEtapa) => ({ id, etapa, nome: id, atraso: 0, tambemEm: [] as FilaEtapa[] });
  const grupo = (etapa: FilaEtapa, ...ids: string[]) => ({ etapa, itens: ids.map((id) => item(id, etapa)) });

  it("registrou a reunião em “Aceitou o convite” e a pessoa caiu em “a confirmar”: a linha aparece lá", () => {
    // Antes: o resolvido era só o id (`lead:<id>`, o mesmo em todos os grupos) e a linha
    // sumia de "a confirmar" com o título contando 1.
    const resolvidos = [{ id: "lead:maria", etapa: "convite-aceito" as const }];
    expect(estaResolvido(resolvidos, item("lead:maria", "convite-aceito"))).toBe(true);
    expect(estaResolvido(resolvidos, item("lead:maria", "confirmar"))).toBe(false);
    // A resposta do servidor já não lista Maria no convite aceito: o resolvido sai.
    expect(podarResolvidos(resolvidos, [grupo("convite-aceito"), grupo("confirmar", "lead:maria")])).toEqual([]);
  });

  it("enquanto o servidor ainda lista a pessoa no mesmo grupo (a resposta não chegou), ela continua escondida", () => {
    const resolvidos = [{ id: "lead:ana", etapa: "resgate" as const }];
    expect(podarResolvidos(resolvidos, [grupo("resgate", "lead:ana", "lead:bia")])).toEqual(resolvidos);
  });

  it("“Sem resposta” no resgate: some pela cadência e, quando volta, reaparece (o resolvido já foi podado)", () => {
    let resolvidos: Resolvido[] = [{ id: "lead:ana", etapa: "resgate" }];
    resolvidos = podarResolvidos(resolvidos, [grupo("resgate", "lead:bia")]); // a cadência a escondeu
    expect(resolvidos).toEqual([]);
    expect(estaResolvido(resolvidos, item("lead:ana", "resgate"))).toBe(false); // voltou horas depois
  });
});
