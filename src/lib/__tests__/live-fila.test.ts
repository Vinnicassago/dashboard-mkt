/**
 * Live 01/12 — etapa 5: a Fila de contato com a ficha da live. Os inscritos com
 * classe saem da Fila de sempre (A e B vão para a Fila da live; C e X ficam só em
 * Leads), as reuniões continuam lá, a Bússola (C1) conta os A e B atrasados e
 * Leads mostra a próxima ação pela mesma régua.
 */
import { describe, expect, it } from "vitest";
import { etapaDoLead, montarFila } from "../fila";
import { montarFilaDaLive } from "../fila-live";
import { motorDeAcoes } from "../motor";
import { kpisDoPeriodo } from "../kpis";
import { montarLinhasDeLeads } from "../leads-vista";
import { EXPEDIENTE_PADRAO } from "../turno";
import type { DashboardData, Lead } from "../types";

const AGORA = "2026-11-18T00:30:00.000Z"; // ter 17/11, 21h30 em Brasília
const HOJE = "2026-11-17";

const lead = (id: string, extra: Partial<Lead>): Lead => ({
  id,
  brand: "consorcio",
  createdAt: "2026-11-17T22:00:00.000Z", // ter 19h
  name: `Pessoa ${id}`,
  // Um número por pessoa (a Fila junta quem tem o mesmo telefone).
  phone: `5511988${String(id.charCodeAt(0)).padStart(6, "0")}`,
  status: "lead",
  utmSource: "meta",
  ...extra,
});

function base(leads: Lead[]): DashboardData {
  return {
    campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-11-16", budgetTotal: 5000 },
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

const leads = [
  lead("a", { classe: "A" }), // prazo 20h → atrasado
  lead("b", { classe: "B" }), // prazo 22h → no prazo
  lead("c", { classe: "C" }),
  lead("x", { classe: "X" }),
  lead("s", {}), // sem classe: Fila de sempre
  lead("m", { classe: "A", status: "agendado", meetingFor: "2026-11-18T22:00:00.000Z", bookedAt: "2026-11-17T23:00:00.000Z" }),
];

describe("Fila de sempre × Fila da live", () => {
  it("quem tem classe sai das etapas de contato da Fila de sempre; a reunião continua lá", () => {
    expect(etapaDoLead(leads[0], [], AGORA)).toBeNull();
    expect(etapaDoLead(leads[2], [], AGORA)).toBeNull(); // C: fora de toda fila de contato
    expect(etapaDoLead(leads[4], [], AGORA)?.nome).toBe("novo");
    expect(etapaDoLead(leads[5], [], AGORA)?.nome).toBe("confirmar");
    const fila = montarFila({ nowIso: AGORA, leads, eventos: [], convites: [], comercial: [] });
    expect(fila.itens.map((i) => i.leadId).sort()).toEqual(["m", "s"]);
  });

  it("a Fila da live leva só A e B — juntas, ninguém fica de fora nem aparece duas vezes", () => {
    const live = montarFilaDaLive(leads, [], AGORA, EXPEDIENTE_PADRAO).map((i) => i.leadId);
    expect(live).toEqual(["a", "b"]);
    const sempre = montarFila({ nowIso: AGORA, leads, eventos: [], convites: [], comercial: [] }).itens.map((i) => i.leadId);
    expect(live.filter((id) => sempre.includes(id))).toEqual([]);
  });
});

describe("Bússola — a C1 conta os A e B sem a 1ª tentativa no prazo do turno", () => {
  it("o A atrasado entra na ação, com link para a Fila da live", () => {
    const data = base(leads.filter((l) => l.id !== "s"));
    const filaLive = montarFilaDaLive(data.leads, [], AGORA, EXPEDIENTE_PADRAO);
    const acoes = motorDeAcoes({
      data,
      range: { from: "2026-11-16", to: HOJE },
      kpis: kpisDoPeriodo(data, { from: "2026-11-16", to: HOJE }, { hoje: HOJE, agora: AGORA }),
      eventos: [],
      filaLive,
      agora: AGORA,
      hoje: HOJE,
    });
    const c1 = acoes.find((a) => a.regra === "C1");
    expect(c1?.titulo).toMatch(/^1 lead sem 1º contato além do prazo/);
    expect(c1?.detalhe).toContain("1 inscrito da live (1 classe A)");
    expect(c1?.href).toBe("/fila#live");
  });
});

describe("Leads — a próxima ação pela mesma régua", () => {
  it("A e B: a etapa da Fila da live; C e X: fora da Fila, dito com todas as letras", () => {
    const linhas = montarLinhasDeLeads(base(leads), [], AGORA, { expediente: EXPEDIENTE_PADRAO });
    const por = Object.fromEntries(linhas.map((l) => [l.id, l]));
    expect(por.a).toMatchObject({ proximaAcao: "ligar agora", naFilaDaLive: true, acaoAtrasada: true });
    expect(por.b).toMatchObject({ proximaAcao: "ligar agora", naFilaDaLive: true, acaoAtrasada: false });
    expect(por.c).toMatchObject({ proximaAcao: "—", naFilaDaLive: false });
    expect(por.c.acaoPorque).toBe("Classe C: fica fora da Fila de contato (só em Leads).");
    expect(por.x.acaoPorque).toContain("Classe X");
    expect(por.s).toMatchObject({ proximaAcao: "ligar agora", etapaDaFila: "novo" });
  });
});
