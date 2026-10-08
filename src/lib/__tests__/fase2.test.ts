/**
 * Fase 2 — processo comercial instrumentado. Fixture sintética (sem dado real).
 * Datas em UTC; Brasília = UTC−3 (sem horário de verão desde 2019).
 */
import { describe, expect, it } from "vitest";
import { diaBrt, horasUteisEntre, somarHorasUteis } from "../horario-util";
import { proximaPelaCadencia, resumoContato } from "../contato";
import {
  BOOKED_STATUSES,
  LEAD_STATUSES,
  MOTIVOS_CONTATO_INVALIDO,
  TRANSICOES,
  destinosPermitidos,
  dadoExigido,
  podeTransitar,
} from "../lead-status";
import { etapaDoLead, montarFila } from "../fila";
import { contarParados } from "../farol";
import { montarCascata } from "../cascata";
import type { DashboardData, Lead, LeadEvent } from "../types";

// 2026-10-09 é sexta; 10-10 sábado; 10-12 segunda.
const brt = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();

describe("horas úteis (seg–sex, 9h–18h, Brasília)", () => {
  it("sexta 20h → segunda 9h10 são 10 minutos úteis, não 61 horas", () => {
    expect(horasUteisEntre(brt("2026-10-09", "20:00"), brt("2026-10-12", "09:10"))).toBeCloseTo(10 / 60, 5);
  });
  it("dentro do expediente conta corrido", () => {
    expect(horasUteisEntre(brt("2026-10-08", "10:00"), brt("2026-10-08", "11:30"))).toBeCloseTo(1.5, 5);
  });
  it("atravessa a noite: quinta 17h → sexta 10h = 2 horas úteis", () => {
    expect(horasUteisEntre(brt("2026-10-08", "17:00"), brt("2026-10-09", "10:00"))).toBeCloseTo(2, 5);
  });
  it("prazo de 1 hora útil para lead de sexta 17h30 vence segunda 9h30", () => {
    expect(somarHorasUteis(brt("2026-10-09", "17:30"), 1)).toBe(brt("2026-10-12", "09:30"));
  });
  it("lead de sábado: prazo vence segunda 10h", () => {
    expect(somarHorasUteis(brt("2026-10-10", "11:00"), 1)).toBe(brt("2026-10-12", "10:00"));
  });
  it("dia de Brasília, não de UTC", () => {
    expect(diaBrt("2026-10-09T02:00:00Z")).toBe("2026-10-08");
  });
});

let seq = 0;
const tentativa = (leadId: string, quando: string, falou: boolean, extra: Partial<LeadEvent> = {}): LeadEvent => ({
  id: `T${++seq}`,
  leadId,
  leadName: "Pessoa Teste",
  actor: "ana",
  action: "tentativa",
  occurredAt: quando,
  createdAt: quando,
  payload: {
    canal: "whatsapp",
    falou: falou ? "sim" : "nao",
    ...(falou ? {} : { proxima: proximaPelaCadencia(quando, 1)! }),
  },
  ...extra,
});

describe("tentativas e cadência", () => {
  it("cadência: +2 h, +1 dia, +2 dias; depois disso, acabou", () => {
    const t0 = "2026-10-08T13:00:00.000Z";
    expect(proximaPelaCadencia(t0, 1)).toBe("2026-10-08T15:00:00.000Z");
    expect(proximaPelaCadencia(t0, 2)).toBe("2026-10-09T13:00:00.000Z");
    expect(proximaPelaCadencia(t0, 3)).toBe("2026-10-10T13:00:00.000Z");
    expect(proximaPelaCadencia(t0, 4)).toBeUndefined();
  });

  it("resumo conta tentativas, dias distintos e ignora as desfeitas", () => {
    const a = tentativa("L", brt("2026-10-08", "10:00"), false);
    const b = tentativa("L", brt("2026-10-08", "14:00"), false);
    const c = tentativa("L", brt("2026-10-09", "10:00"), false);
    const desfaz: LeadEvent = { ...c, id: "D1", action: "desfeito", payload: { evento: c.id } };
    const r = resumoContato([a, b, c, desfaz]);
    expect(r.tentativas).toBe(2);
    expect(r.diasComTentativa).toBe(1);
    expect(r.ultima).toBe(b.occurredAt);
  });

  it("depois de falar com a pessoa não há 'próxima' pela cadência", () => {
    const r = resumoContato([tentativa("L", brt("2026-10-08", "10:00"), true)]);
    expect(r.falou).toBe(true);
    expect(r.proxima).toBeUndefined();
  });
});

describe("máquina de estados", () => {
  const novo = { status: "lead" as const, jaAgendou: false };

  it("'Em contato' não é escolha manual — é a tentativa que põe", () => {
    expect(destinosPermitidos(novo)).not.toContain("em_contato");
    expect(podeTransitar(novo, "em_contato")).toMatch(/tentativa/);
  });

  it("lead encerrado não sai sem reabrir", () => {
    const perdido = { status: "sem_interesse" as const, jaAgendou: false };
    expect(destinosPermitidos(perdido)).toEqual([]);
    expect(podeTransitar(perdido, "agendado", { meetingFor: "2026-10-12T13:00:00Z" })).toMatch(/administrador/);
  });

  it("Reunião realizada só a partir de agendado; Cliente só depois da reunião", () => {
    expect(podeTransitar(novo, "reuniao_realizada")).toMatch(/não dá para ir direto/);
    expect(podeTransitar({ status: "agendado", jaAgendou: true }, "cliente", { value: 1 })).toMatch(/não dá para ir direto/);
    expect(podeTransitar({ status: "reuniao_realizada", jaAgendou: true }, "cliente", { value: 250000 })).toBeNull();
  });

  it("não compareceu → remarcar (com data) ou desistência", () => {
    const ns = { status: "no_show" as const, jaAgendou: true };
    expect(destinosPermitidos(ns)).toEqual(expect.arrayContaining(["agendado", "desistencia"]));
    expect(podeTransitar(ns, "agendado")).toMatch(/data e a hora/);
  });

  it("remarcar: agendado → agendado com data nova", () => {
    expect(podeTransitar({ status: "agendado", jaAgendou: true }, "agendado", { meetingFor: "2026-10-15T13:00:00Z" })).toBeNull();
  });

  it("Contato inválido exige motivo da lista", () => {
    expect(dadoExigido("contato_invalido")).toBe("motivo");
    expect(podeTransitar(novo, "contato_invalido")).toMatch(/por que/);
    expect(podeTransitar(novo, "contato_invalido", { motivo: "sem_whatsapp" })).toBeNull();
  });

  it("Sem resposta antes de 3 tentativas em 2 dias pede confirmação", () => {
    const emContato = { status: "em_contato" as const, jaAgendou: false, tentativas: 1, diasComTentativa: 1 };
    expect(dadoExigido("sem_resposta", emContato)).toBe("confirmacao");
    expect(podeTransitar(emContato, "sem_resposta")).toMatch(/Confirme/);
    expect(podeTransitar(emContato, "sem_resposta", { confirmado: true })).toBeNull();
    const cumpriu = { ...emContato, tentativas: 3, diasComTentativa: 2 };
    expect(dadoExigido("sem_resposta", cumpriu)).toBeNull();
    expect(podeTransitar(cumpriu, "sem_resposta")).toBeNull();
  });
});

const lead = (id: string, extra: Partial<Lead>): Lead => ({
  id,
  brand: "consorcio",
  createdAt: brt("2026-10-08", "10:00"),
  name: "Pessoa Teste",
  status: "lead",
  ...extra,
});

describe("etapas da Fila", () => {
  const agora = brt("2026-10-08", "12:00");

  it("Novo: prazo de 1 hora útil — 2 horas depois está 2× atrasado", () => {
    const e = etapaDoLead(lead("a", {}), [], agora)!;
    expect(e.nome).toBe("novo");
    expect(e.horasUteis).toBeCloseTo(2, 5);
    expect(e.venceEm).toBe(brt("2026-10-08", "11:00"));
  });

  it("Em contato com retorno ainda no futuro: fora da fila", () => {
    const t = tentativa("b", brt("2026-10-08", "11:30"), false); // próxima 13:30
    expect(etapaDoLead(lead("b", { status: "em_contato" }), [t], agora)).toBeNull();
  });

  it("Em contato com retorno vencido: 'Retornar hoje'", () => {
    const t = tentativa("c", brt("2026-10-08", "09:00"), false); // próxima 11:00
    const e = etapaDoLead(lead("c", { status: "em_contato" }), [t], agora)!;
    expect(e.nome).toBe("retornar");
    expect(e.contato?.tentativas).toBe(1);
  });

  it("Reunião em 24 h: a confirmar; reunião que passou: sem desfecho", () => {
    const amanha = lead("d", { status: "agendado", meetingFor: brt("2026-10-09", "12:00"), bookedAt: brt("2026-10-08", "09:00") });
    expect(etapaDoLead(amanha, [], agora)?.nome).toBe("confirmar");
    const ontem = lead("e", { status: "agendado", meetingFor: brt("2026-10-07", "15:00") });
    expect(etapaDoLead(ontem, [], agora)?.nome).toBe("sem-desfecho");
  });

  it("agendado sem data (legado) vira 'sem desfecho' uma semana depois", () => {
    const velho = lead("f", { status: "agendado", bookedAt: brt("2026-09-20", "10:00") });
    expect(etapaDoLead(velho, [], agora)?.nome).toBe("sem-desfecho");
    const recente = lead("g", { status: "agendado", bookedAt: brt("2026-10-07", "10:00") });
    expect(etapaDoLead(recente, [], agora)).toBeNull();
  });

  it("encerrados não aparecem", () => {
    expect(etapaDoLead(lead("h", { status: "sem_interesse" }), [], agora)).toBeNull();
    expect(etapaDoLead(lead("i", { status: "cliente" }), [], agora)).toBeNull();
  });

  it("montarFila ordena o atrasado antes da reunião a confirmar", () => {
    const f = montarFila({
      nowIso: agora,
      leads: [
        lead("novo", {}),
        lead("conf", { status: "agendado", meetingFor: brt("2026-10-09", "12:00") }),
      ],
      eventos: [],
      convites: [],
      comercial: [],
    });
    expect(f.itens.map((i) => i.etapa)).toEqual(["novo", "confirmar"]);
  });
});

describe("farol sem robô: quem espera o 1º contato é 'gente parada'", () => {
  it("conta os leads Novos e abre a Fila direto em 'Novos'", () => {
    const data: DashboardData = {
      campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-10-01", budgetTotal: 0 },
      igAccountDaily: [],
      igPosts: [],
      adDaily: [],
      creatives: [],
      lpDaily: [],
      leads: [lead("1", {}), lead("2", {}), lead("3", { status: "em_contato" }), lead("4", { status: "agendado", bookedAt: brt("2026-10-08", "11:00") })],
      goals: [],
      updatedAt: agoraIso(),
    };
    const c = montarCascata({ data, robo: null, comercial: null, investimentoConversao: 0 });
    const p = contarParados(c.degraus);
    expect(p.parados).toBe(2);
    expect(p.filaHref).toBe("/fila?etapa=novo");
  });
});

function agoraIso() {
  return new Date().toISOString();
}

describe("matriz de transições, par a par (portão da Fase 2)", () => {
  // Com todos os dados exigidos em mãos, a única coisa que decide é a tabela.
  const dados = {
    meetingFor: "2026-10-20T15:00:00.000Z",
    value: 100_000,
    motivo: Object.keys(MOTIVOS_CONTATO_INVALIDO)[0],
    confirmado: true,
  };
  for (const de of LEAD_STATUSES) {
    for (const para of LEAD_STATUSES) {
      const permitido = TRANSICOES[de].includes(para);
      it(`${de} → ${para}: ${permitido ? "pode" : "não pode"}`, () => {
        const estado = { status: de, jaAgendou: BOOKED_STATUSES.includes(de), tentativas: 3, diasComTentativa: 2 };
        expect(podeTransitar(estado, para, dados) === null).toBe(permitido);
      });
    }
  }
  it("ninguém escolhe “Em contato” e todo encerrado é beco sem saída", () => {
    for (const de of LEAD_STATUSES) expect(TRANSICOES[de]).not.toContain("em_contato");
    for (const fim of ["cliente", "contato_invalido", "sem_resposta", "sem_interesse", "desistencia"] as const) {
      expect(TRANSICOES[fim]).toEqual([]);
    }
  });
});
