import { describe, expect, it } from "vitest";
import { diagnosticarLeads, propostaDeReparo, rajadasDeRegistro } from "../diagnostico-leads";
import type { Lead, LeadEvent, LeadStatus } from "../types";

// Fixture sintética — nomes e contatos inventados, nenhum dado real.
let seq = 0;
const ev = (
  leadId: string,
  createdAt: string,
  action: LeadEvent["action"],
  extra: Partial<LeadEvent> = {},
): LeadEvent => ({
  id: `E${++seq}`,
  leadId,
  leadName: extra.leadName ?? "Pessoa Teste",
  actor: extra.actor ?? (action === "created" ? "Landing page" : "ana"),
  action,
  createdAt,
  ...extra,
});
const lead = (id: string, status: LeadStatus, createdAt: string, extra: Partial<Lead> = {}): Lead => ({
  id,
  brand: "consorcio",
  name: "Pessoa Teste",
  status,
  createdAt,
  ...extra,
});

describe("propostaDeReparo", () => {
  it("lead zerado por reenvio: volta ao status do histórico, à entrada original e ganha o marco", () => {
    const l = lead("LEAD-LP-a1", "lead", "2026-09-20T10:00:00.000Z");
    const eventos = [
      ev(l.id, "2026-09-01T10:00:00.000Z", "created", { toStatus: "lead" }),
      ev(l.id, "2026-09-02T15:00:00.000Z", "status_changed", { fromStatus: "lead", toStatus: "agendado" }),
      ev(l.id, "2026-09-20T10:00:00.000Z", "created", { toStatus: "lead" }), // o reenvio
    ];
    expect(propostaDeReparo(l, eventos)).toEqual({
      leadId: l.id,
      nome: l.name,
      statusAtual: "lead",
      statusProposto: "agendado",
      entradaAtual: l.createdAt,
      entradaProposta: "2026-09-01T10:00:00.000Z",
      bookedAt: "2026-09-02T15:00:00.000Z",
    });
  });

  it("perda zerada: volta à perda com a data da perda", () => {
    const l = lead("LEAD-LP-a2", "lead", "2026-09-20T10:00:00.000Z");
    const eventos = [
      ev(l.id, "2026-09-01T10:00:00.000Z", "created"),
      ev(l.id, "2026-09-03T10:00:00.000Z", "status_changed", { toStatus: "sem_resposta" }),
      ev(l.id, "2026-09-20T10:00:00.000Z", "created"),
    ];
    const r = propostaDeReparo(l, eventos);
    expect(r?.statusProposto).toBe("sem_resposta");
    expect(r?.lostAt).toBe("2026-09-03T10:00:00.000Z");
  });

  it("só a entrada regravada (sem status) também é reparada", () => {
    const l = lead("LEAD-LP-a3", "lead", "2026-09-20T10:00:00.000Z");
    const eventos = [ev(l.id, "2026-09-01T10:00:00.000Z", "created"), ev(l.id, "2026-09-20T10:00:00.000Z", "created")];
    const r = propostaDeReparo(l, eventos);
    expect(r?.statusProposto).toBeUndefined();
    expect(r?.entradaProposta).toBe("2026-09-01T10:00:00.000Z");
  });

  it("lead certo: nada a reparar", () => {
    const l = lead("LEAD-LP-a4", "agendado", "2026-09-01T10:00:00.000Z", { bookedAt: "2026-09-02T10:00:00.000Z" });
    const eventos = [
      ev(l.id, "2026-09-01T10:00:00.000Z", "created"),
      ev(l.id, "2026-09-02T10:00:00.000Z", "status_changed", { toStatus: "agendado" }),
    ];
    expect(propostaDeReparo(l, eventos)).toBeNull();
  });

  it("status mudado DEPOIS do reenvio não é desfeito", () => {
    const l = lead("LEAD-LP-a5", "sem_interesse", "2026-09-01T10:00:00.000Z");
    const eventos = [
      ev(l.id, "2026-09-01T10:00:00.000Z", "created"),
      ev(l.id, "2026-09-02T10:00:00.000Z", "status_changed", { toStatus: "agendado" }),
      ev(l.id, "2026-09-05T10:00:00.000Z", "created"),
      ev(l.id, "2026-09-06T10:00:00.000Z", "status_changed", { fromStatus: "lead", toStatus: "sem_interesse" }),
    ];
    const r = propostaDeReparo(l, eventos);
    expect(r?.statusProposto).toBeUndefined();
    expect(r?.bookedAt).toBe("2026-09-02T10:00:00.000Z"); // a reunião que aconteceu volta a contar
  });
});

describe("id compartilhado por várias pessoas (colisão)", () => {
  // O caso real de out/2026: um id recebeu dezenas de cadastros de pessoas
  // diferentes desde 03/09; cada um sobrescreveu o anterior e só o último ficou.
  const id = "LEAD-LP-compart";
  const atual = lead(id, "lead", "2026-10-07T09:40:00.000Z", { name: "Pessoa Atual" });
  const historico = [
    ev(id, "2026-09-03T19:32:00.000Z", "created", { leadName: "Pessoa Um" }),
    ev(id, "2026-09-04T10:00:00.000Z", "status_changed", { leadName: "Pessoa Um", toStatus: "agendado" }),
    ev(id, "2026-09-10T10:00:00.000Z", "created", { leadName: "Pessoa Dois" }),
    ev(id, "2026-09-11T10:00:00.000Z", "created", { leadName: "Pessoa Dois" }),
    ev(id, "2026-10-07T09:40:00.000Z", "created", { leadName: "Pessoa Atual" }),
  ];

  it("não propõe reparo com o histórico de quem foi sobrescrito", () => {
    // antes: entrada 03/09 e status "agendado" — ambos de OUTRA pessoa
    expect(propostaDeReparo(atual, historico)).toBeNull();
  });

  it("lista quem sumiu, com a 1ª data e quantos envios", () => {
    const d = diagnosticarLeads([atual], historico);
    expect(d.colisoes).toEqual([
      {
        leadId: id,
        nomeAtual: "Pessoa Atual",
        criacoes: 4,
        sobrescritos: [
          { nome: "Pessoa Um", primeiraVez: "2026-09-03T19:32:00.000Z", envios: 1 },
          { nome: "Pessoa Dois", primeiraVez: "2026-09-10T10:00:00.000Z", envios: 2 },
        ],
      },
    ]);
    expect(d.reparos).toEqual([]);
  });

  it("dentro do id compartilhado, o histórico da própria pessoa ainda repara", () => {
    const comReenvio = [
      ...historico,
      ev(id, "2026-10-07T12:00:00.000Z", "status_changed", { leadName: "Pessoa Atual", toStatus: "agendado" }),
      ev(id, "2026-10-07T13:00:00.000Z", "created", { leadName: "Pessoa Atual" }),
    ];
    const r = propostaDeReparo(atual, comReenvio);
    expect(r?.statusProposto).toBe("agendado");
    expect(r?.entradaProposta).toBeUndefined(); // a entrada certa é a dela, 07/10 09:40
    expect(r?.bookedAt).toBe("2026-10-07T12:00:00.000Z"); // não o agendamento da Pessoa Um
  });
});

describe("diagnosticarLeads", () => {
  it("separa reenvio, colisão, órfão e marca", () => {
    const leads = [
      lead("LEAD-LP-r1", "lead", "2026-09-01T10:00:00.000Z"),
      lead("LEAD-LP-c1", "lead", "2026-09-01T10:00:00.000Z", { name: "Segunda Pessoa" }),
      lead("LEAD-LP-k1", "lead", "2026-09-01T10:00:00.000Z", { brand: "krone" }),
      lead("LEAD-LP-x1", "lead", "2026-09-01T10:00:00.000Z", { deletedAt: "2026-09-10T10:00:00.000Z" }),
    ];
    const eventos = [
      ev("LEAD-LP-r1", "2026-09-01T10:00:00.000Z", "created"),
      ev("LEAD-LP-r1", "2026-09-01T10:00:30.000Z", "created"),
      ev("LEAD-LP-c1", "2026-09-01T09:00:00.000Z", "created", { leadName: "Primeira Pessoa" }),
      ev("LEAD-LP-c1", "2026-09-01T10:00:00.000Z", "created", { leadName: "Segunda Pessoa" }),
      ev("LEAD-LP-k1", "2026-09-01T10:00:00.000Z", "created"),
      ev("LEAD-LP-x1", "2026-09-01T10:00:00.000Z", "created"),
      ev("LEAD-LP-sumiu", "2026-09-01T10:00:00.000Z", "created"),
      ev("LEAD-M-manual", "2026-09-01T10:00:00.000Z", "created", { actor: "ana" }), // não é da LP
    ];
    const d = diagnosticarLeads(leads, eventos);
    expect(d.criacoesLp).toBe(7);
    expect(d.leadsLp).toBe(4);
    expect(d.reenvios).toEqual([{ leadId: "LEAD-LP-r1", criacoes: 2 }]);
    expect(d.colisoes).toEqual([
      {
        leadId: "LEAD-LP-c1",
        nomeAtual: "Segunda Pessoa",
        criacoes: 2,
        sobrescritos: [{ nome: "Primeira Pessoa", primeiraVez: "2026-09-01T09:00:00.000Z", envios: 1 }],
      },
    ]);
    expect(d.orfaos).toBe(1);
    expect(d.foraDaMarcaPadrao).toBe(1);
    expect(d.excluidos).toBe(1);
  });
});

describe("rajadasDeRegistro", () => {
  it("12 status do mesmo usuário em 12 minutos é uma rajada; 3 espalhados não", () => {
    const base = Date.parse("2026-10-06T14:51:00.000Z");
    const eventos: LeadEvent[] = [];
    for (let i = 0; i < 12; i++) {
      eventos.push(ev(`L${i}`, new Date(base + i * 60_000).toISOString(), "status_changed", { actor: "ana" }));
    }
    for (let i = 0; i < 3; i++) {
      eventos.push(ev(`M${i}`, new Date(base + i * 86_400_000).toISOString(), "status_changed", { actor: "bia" }));
    }
    const r = rajadasDeRegistro(eventos);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ actor: "ana", eventos: 12 });
  });
});
