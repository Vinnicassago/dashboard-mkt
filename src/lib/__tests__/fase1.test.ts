import { describe, expect, it } from "vitest";
import { formatarEspera } from "../format";
import { destinosPermitidos, podeTransitar } from "../lead-status";
import { lerTelefone } from "../leads-csv";

describe("formatarEspera — arredonda o total antes de fatiar (B1)", () => {
  const h = (d: number, hh: number, mm: number) => d * 24 + hh + mm / 60;
  it.each([
    [h(31, 23, 41), "32 d"],
    [h(12, 23, 50), "13 d"],
    [h(1, 5, 10), "1 d 5 h"],
    [h(0, 5, 59.6), "6 h"],
    [h(0, 0, 59.6), "1 h"],
    [h(0, 0, 35), "35 min"],
    [h(0, 23, 59.9), "1 d"],
  ])("%s h → %s", (horas, esperado) => {
    expect(formatarEspera(horas)).toBe(esperado);
  });
  it("sem dado é traço, nunca zero", () => {
    expect(formatarEspera(undefined)).toBe("—");
    expect(formatarEspera(null)).toBe("—");
  });
});

describe("transições de status (B19 e o registro do comercial)", () => {
  const novo = { status: "lead" as const, jaAgendou: false };
  const agendado = { status: "agendado" as const, jaAgendou: true };

  it("Desistência só aparece para quem chegou a agendar", () => {
    expect(destinosPermitidos(novo)).not.toContain("desistencia");
    expect(destinosPermitidos(agendado)).toContain("desistencia");
    expect(podeTransitar(novo, "desistencia")).toMatch(/chegou a agendar/);
    expect(podeTransitar(agendado, "desistencia")).toBeNull();
  });

  it("perda depois de agendar continua liberando Desistência (o marco fica)", () => {
    expect(destinosPermitidos({ status: "sem_resposta", jaAgendou: true })).toContain("desistencia");
  });

  it("Agendado exige data e hora da reunião", () => {
    expect(podeTransitar(novo, "agendado")).toMatch(/data e a hora/);
    expect(podeTransitar(novo, "agendado", { meetingFor: "não é data" })).toMatch(/data e a hora/);
    expect(podeTransitar(novo, "agendado", { meetingFor: "2026-10-09T17:30:00.000Z" })).toBeNull();
  });

  it("Cliente exige o valor da carta", () => {
    expect(podeTransitar(agendado, "cliente")).toMatch(/valor/);
    expect(podeTransitar(agendado, "cliente", { value: 0 })).toMatch(/valor/);
    expect(podeTransitar(agendado, "cliente", { value: 250000 })).toBeNull();
  });

  it("Reunião realizada e Cliente estão disponíveis (antes não havia tela para isso)", () => {
    expect(destinosPermitidos(agendado)).toEqual(
      expect.arrayContaining(["reuniao_realizada", "cliente"]),
    );
  });

  it("mesmo status não é mudança", () => {
    expect(destinosPermitidos(novo)).not.toContain("lead");
    expect(podeTransitar(agendado, "agendado", { meetingFor: "2026-10-09T17:30:00.000Z" })).toMatch(/já está/);
  });
});

describe("telefone da planilha (B8)", () => {
  it("recusa notação científica — o Excel já cortou os dígitos", () => {
    expect(lerTelefone("5,51299E+12")).toEqual({ ilegivel: true });
    expect(lerTelefone("5.51299e12")).toEqual({ ilegivel: true });
  });
  it("desfaz o =\"…\" com que o painel exporta", () => {
    expect(lerTelefone('="5511999990000"')).toEqual({ valor: "5511999990000", ilegivel: false });
  });
  it("mantém o resto como veio", () => {
    expect(lerTelefone("(11) 99999-0000")).toEqual({ valor: "(11) 99999-0000", ilegivel: false });
    expect(lerTelefone(undefined)).toEqual({ ilegivel: false });
  });
});
