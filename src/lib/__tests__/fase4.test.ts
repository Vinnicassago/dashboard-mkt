/**
 * Fase 4 — a régua: metas com vigência, calculadora e status. Fixture sintética.
 */
import { describe, expect, it } from "vitest";
import {
  alvoNoPeriodo,
  calcularMetas,
  errosDaCalculadora,
  formatarAlvo,
  metaVigente,
  metasDaCalculadora,
  precisaRecalibrar,
  statusContraMeta,
  taxasObservadas,
} from "../metas";
import { kpisDoPeriodo, reguaDoPeriodo } from "../kpis";
import type { DashboardData, Lead, Meta } from "../types";

const RELATORIO = { V: 200_000, c: 0.02, m: 0.3, f: 0.2, s: 0.7, a: 0.1, N: 4 };

describe("calculadora (seção 9 do relatório)", () => {
  it("bate os números do relatório: 1.200 / 168 / 16,80 / 6,6 / 66 / 1.109", () => {
    const s = calcularMetas(RELATORIO);
    expect(s.cacMax).toBeCloseTo(1200, 6);
    expect(s.custoPorReuniaoMax).toBeCloseTo(168, 6);
    expect(s.cplMax).toBeCloseTo(16.8, 6);
    expect(s.reunioesPorSemana).toBeCloseTo(6.6, 1);
    expect(Math.round(s.leadsPorSemana)).toBe(66);
    expect(Math.round(s.orcamentoConversaoPorSemana)).toBe(1109);
    expect(formatarAlvo("reunioes_agendadas", s.reunioesPorSemana)).toBe("≈ 7");
  });
  it("recusa taxa fora de 0–100% e campos vazios", () => {
    expect(errosDaCalculadora({ ...RELATORIO, a: 1.5 })).toHaveLength(1);
    expect(errosDaCalculadora({ ...RELATORIO, V: NaN, N: 0 })).toHaveLength(2);
    expect(errosDaCalculadora(RELATORIO)).toEqual([]);
  });
  it("grava uma meta por métrica, com as entradas (auditável) e provisória sem amostra", () => {
    let i = 0;
    const metas = metasDaCalculadora(RELATORIO, {
      brand: "consorcio",
      vigenteDesde: "2026-10-01",
      criadaEm: "2026-10-01T12:00:00.000Z",
      criadaPor: "admin",
      provisoria: true,
      primeiroContatoNoPrazo: 0.9,
      novoId: () => `M${++i}`,
    });
    expect(metas).toHaveLength(8);
    expect(metas.every((m) => m.entradas?.V === 200_000)).toBe(true);
    expect(metas.find((m) => m.metrica === "taxa_lead_agendada")?.provisoria).toBe(true);
    expect(metas.find((m) => m.metrica === "primeiro_contato_no_prazo")?.provisoria).toBe(false);
  });
});

describe("status contra a meta — sempre com texto", () => {
  it("maior é melhor: verde ≥ 100%, âmbar 80–99%, vermelho < 80%", () => {
    expect(statusContraMeta(7, 7, "maior")?.status).toBe("verde");
    expect(statusContraMeta(6, 7, "maior")).toMatchObject({ status: "ambar", rotulo: "Perto da meta (86%)" });
    expect(statusContraMeta(5, 7, "maior")).toMatchObject({ status: "vermelho", rotulo: "Abaixo da meta (71%)" });
  });
  it("custo: verde ≤ alvo, âmbar até 120%, vermelho acima", () => {
    expect(statusContraMeta(16, 16.8, "menor")?.status).toBe("verde");
    expect(statusContraMeta(19, 16.8, "menor")?.status).toBe("ambar");
    expect(statusContraMeta(29.7, 16.8, "menor")).toMatchObject({ status: "vermelho", rotulo: "77% acima do alvo" });
  });
  it("ritmo de verba: nem muito abaixo nem muito acima", () => {
    expect(statusContraMeta(1000, 1109, "ritmo")?.status).toBe("verde");
    expect(statusContraMeta(900, 1109, "ritmo")?.rotulo).toMatch(/Abaixo do ritmo/);
    expect(statusContraMeta(2000, 1109, "ritmo")?.status).toBe("vermelho");
  });
  it("sem alvo não há status", () => {
    expect(statusContraMeta(5, 0, "maior")).toBeUndefined();
  });
});

const meta = (metrica: Meta["metrica"], alvo: number | null, vigenteDesde: string, extra: Partial<Meta> = {}): Meta => ({
  id: `${metrica}-${vigenteDesde}-${alvo}`,
  brand: "consorcio",
  metrica,
  periodo: "semana",
  alvo,
  vigenteDesde,
  provisoria: false,
  origem: "manual",
  criadaEm: `${vigenteDesde}T12:00:00.000Z`,
  criadaPor: "admin",
  ...extra,
});

describe("vigência: mudar a meta não reescreve o passado", () => {
  const metas = [
    meta("reunioes_agendadas", 5, "2026-09-01"),
    meta("reunioes_agendadas", 7, "2026-10-04"),
    meta("cpl", 20, "2026-09-01"),
    meta("cpl", null, "2026-10-06"), // limpa
  ];
  it("cada dia é julgado pela meta que valia nele", () => {
    expect(metaVigente(metas, "reunioes_agendadas", "2026-10-03")?.alvo).toBe(5);
    expect(metaVigente(metas, "reunioes_agendadas", "2026-10-04")?.alvo).toBe(7);
  });
  it("contagem soma dia a dia: 3 dias a 5/sem + 4 dias a 7/sem", () => {
    const a = alvoNoPeriodo(metas, "reunioes_agendadas", { from: "2026-10-01", to: "2026-10-07" });
    expect(a?.alvo).toBeCloseTo((3 * 5) / 7 + (4 * 7) / 7, 6);
    expect(a?.parcial).toBe(false);
  });
  it("meta limpa deixa de valer a partir da data", () => {
    expect(metaVigente(metas, "cpl", "2026-10-05")?.alvo).toBe(20);
    expect(metaVigente(metas, "cpl", "2026-10-06")).toBeUndefined();
  });
  it("período que começa antes da 1ª meta é parcial", () => {
    expect(alvoNoPeriodo(metas, "reunioes_agendadas", { from: "2026-08-29", to: "2026-09-04" })?.parcial).toBe(true);
  });
});

// ---------------------------------------------------------------- dados

const lead = (id: string, createdAt: string, extra: Partial<Lead> = {}): Lead => ({
  id,
  brand: "consorcio",
  createdAt,
  name: "Pessoa Teste",
  status: "lead",
  ...extra,
});

function base(leads: Lead[], metas: Meta[] = []): DashboardData {
  return {
    campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-09-01", budgetTotal: 0 },
    igAccountDaily: [],
    igPosts: [],
    adDaily: [],
    creatives: [],
    lpDaily: [],
    leads,
    goals: [],
    metas,
    updatedAt: "2026-10-08T12:00:00.000Z",
  };
}

// Brasília = UTC−3. 2026-10-06 é terça.
const brt = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();

describe("1º contato no prazo e comparecimento", () => {
  const agora = brt("2026-10-08", "15:00");
  const data = base([
    lead("rapido", brt("2026-10-06", "10:00"), { status: "em_contato", firstContactAt: brt("2026-10-06", "10:40") }),
    lead("lento", brt("2026-10-06", "10:00"), { status: "em_contato", firstContactAt: brt("2026-10-06", "14:00") }),
    lead("esquecido", brt("2026-10-06", "11:00")), // prazo vencido, sem tentativa
    lead("novinho", brt("2026-10-08", "14:30")), // ainda no prazo: fora do n
    lead("legado", brt("2026-10-06", "09:00"), { status: "sem_interesse" }), // sem registro: fora do n
    lead("foi", brt("2026-10-01", "10:00"), { status: "reuniao_realizada", bookedAt: brt("2026-10-02", "10:00"), meetingFor: brt("2026-10-05", "10:00"), attendedAt: brt("2026-10-05", "11:00") }),
    lead("faltou", brt("2026-10-01", "10:00"), { status: "no_show", bookedAt: brt("2026-10-02", "10:00"), meetingFor: brt("2026-10-06", "10:00") }),
    lead("futura", brt("2026-10-01", "10:00"), { status: "agendado", bookedAt: brt("2026-10-02", "10:00"), meetingFor: brt("2026-10-09", "10:00") }),
  ]);
  const k = kpisDoPeriodo(data, { from: "2026-10-01", to: "2026-10-10" }, { agora });

  it("conta só quem teve tentativa ou já estourou o prazo", () => {
    expect(k.primeiroContatoNoPrazo.n).toBe(3);
    expect(k.primeiroContatoNoPrazo.valor).toBeCloseTo(1 / 3, 6);
    // 40 min e 4 h úteis → mediana 2h20
    expect(k.medianaPrimeiroContatoHoras).toBeCloseTo((40 / 60 + 4) / 2, 6);
  });
  it("comparecimento: só reunião com data passada; quem faltou conta como não realizada", () => {
    expect(k.comparecimento.n).toBe(2);
    expect(k.comparecimento.valor).toBeCloseTo(0.5, 6);
  });
});

describe("régua: sem status quando o número não se sustenta", () => {
  it("custo por reunião com 1 reunião não ganha cor, mesmo com meta", () => {
    const data = base(
      [lead("a", "2026-10-02T12:00:00.000Z", { status: "agendado", bookedAt: "2026-10-03T12:00:00.000Z", utmSource: "meta" })],
      [meta("custo_por_reuniao", 168, "2026-09-01"), meta("reunioes_agendadas", 7, "2026-09-01")],
    );
    const range = { from: "2026-10-01", to: "2026-10-07" };
    const r = reguaDoPeriodo(kpisDoPeriodo(data, range), data, range, "2026-10-08");
    expect(r.find((l) => l.metrica === "custo_por_reuniao")?.avaliacao).toBeUndefined();
    expect(r.find((l) => l.metrica === "reunioes_agendadas")?.avaliacao?.status).toBe("vermelho");
  });
});

describe("régua: meta que não cobre o período inteiro não julga", () => {
  it("metas que começam no meio do período aparecem sem status", () => {
    const data = base(
      [lead("a", "2026-10-02T12:00:00.000Z", { status: "agendado", bookedAt: "2026-10-03T12:00:00.000Z" })],
      [meta("reunioes_agendadas", 7, "2026-10-06"), meta("cpl", 20, "2026-10-06")],
    );
    const range = { from: "2026-10-01", to: "2026-10-07" };
    const r = reguaDoPeriodo(kpisDoPeriodo(data, range), data, range, "2026-10-08");
    const reunioes = r.find((l) => l.metrica === "reunioes_agendadas")!;
    expect(reunioes.parcial).toBe(true);
    expect(reunioes.alvo).toBeCloseTo(2, 6);
    expect(reunioes.avaliacao).toBeUndefined();
    expect(r.find((l) => l.metrica === "cpl")?.parcial).toBe(true);
  });
});

describe("taxas observadas e recalibração", () => {
  const muitos = Array.from({ length: 25 }, (_, i) =>
    lead(`l${i}`, "2026-09-20T12:00:00.000Z", i < 6 ? { status: "agendado", bookedAt: "2026-09-21T12:00:00.000Z" } : {}),
  );
  it("com ≥ 20 leads e ≥ 5 agendadas em 8 semanas, a amostra é suficiente", () => {
    const o = taxasObservadas(base(muitos), "2026-10-08", "2026-10-08T12:00:00.000Z");
    expect(o.suficiente).toBe(true);
    expect(o.a).toBeCloseTo(6 / 25, 6);
  });
  it("sem amostra, nada de sugestão de recalibrar", () => {
    const o = taxasObservadas(base(muitos.slice(0, 5)), "2026-10-08", "2026-10-08T12:00:00.000Z");
    expect(o.suficiente).toBe(false);
    expect(precisaRecalibrar([meta("taxa_lead_agendada", 0.1, "2026-07-01", { provisoria: true })], o, "2026-10-08")).toEqual([]);
  });
  it("meta provisória com mais de 8 semanas e amostra: recalibrar", () => {
    const o = taxasObservadas(base(muitos), "2026-10-08", "2026-10-08T12:00:00.000Z");
    expect(precisaRecalibrar([meta("taxa_lead_agendada", 0.1, "2026-07-01", { provisoria: true })], o, "2026-10-08")).toEqual([
      "taxa_lead_agendada",
    ]);
  });
});
