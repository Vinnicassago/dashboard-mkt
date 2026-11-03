/**
 * Live 01/12 — etapa 2 (E1-15): a ficha do lead. Vocabulário das respostas, as
 * leituras derivadas (atendimento em cinco estados, estado da reunião), os
 * filtros e o CSV de Leads e as etapas novas do funil. Fixture sintética.
 */
import { describe, expect, it } from "vitest";
import { kpisDoPeriodo } from "../kpis";
import { montarFunil } from "../funil";
import {
  CSV_CABECALHO,
  FILTRO_VAZIO,
  aplicarFiltro,
  descreverFiltro,
  filtroDoPedido,
  montarCsvDeLeads,
  montarLinhasDeLeads,
} from "../leads-vista";
import {
  BENS,
  FAIXAS_PARCELA,
  FAIXAS_VALOR,
  FINALIDADES,
  PRAZOS_COMPRA,
  classeDiverge,
  classeDoLead,
  lerOpcao,
  lerSimNao,
  statusAtendimento,
  statusReuniao,
} from "../qualificacao";
import { tentativasDoLead } from "../contato";
import type { DashboardData, Lead, LeadEvent } from "../types";

const HOJE = "2026-11-20";
const AGORA = "2026-11-20T15:00:00.000Z";
const CAPTACAO = { from: "2026-11-16", to: "2026-11-20" };

const lead = (id: string, createdAt: string, extra: Partial<Lead> = {}): Lead => ({
  id,
  brand: "consorcio",
  createdAt,
  name: `Pessoa ${id}`,
  phone: `55119999${id.padStart(5, "0").slice(-5)}`,
  status: "lead",
  utmSource: "meta",
  ...extra,
});

function base(leads: Lead[]): DashboardData {
  return {
    campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-08-01", budgetTotal: 5000 },
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

describe("vocabulário das respostas — lê do jeito que o n8n escreve", () => {
  it("aceita chave, rótulo e grafias sem acento, sem espaço, com ou sem R$", () => {
    expect(lerOpcao(BENS, "Imóvel")).toBe("imovel");
    expect(lerOpcao(BENS, "imovel")).toBe("imovel");
    expect(lerOpcao(BENS, "Bem para a empresa")).toBe("empresa");
    expect(lerOpcao(FAIXAS_VALOR, "R$50 mil a R$150 mil")).toBe("50k_150k");
    expect(lerOpcao(FAIXAS_VALOR, "Acima de R$1 milhão")).toBe("acima_1m");
    expect(lerOpcao(FAIXAS_VALOR, "300k_500k")).toBe("300k_500k");
    expect(lerOpcao(FAIXAS_PARCELA, "R$1.500 a R$3.000")).toBe("1500_3000");
    expect(lerOpcao(FAIXAS_PARCELA, "Até R$ 1.500")).toBe("ate_1500");
    expect(lerOpcao(FINALIDADES, "Quitar dívidas ou ter dinheiro na mão")).toBe("quitar_dividas");
    expect(lerOpcao(PRAZOS_COMPRA, "preciso agora")).toBe("agora");
  });

  it("o que não é do vocabulário vira undefined (a API devolve erro, não grava lixo)", () => {
    expect(lerOpcao(BENS, "Barco")).toBeUndefined();
    expect(lerOpcao(FAIXAS_VALOR, "")).toBeUndefined();
    expect(lerOpcao(FAIXAS_VALOR, 50000)).toBeUndefined();
  });

  it("sim/não em qualquer grafia", () => {
    expect(lerSimNao("Sim")).toBe(true);
    expect(lerSimNao("não")).toBe(false);
    expect(lerSimNao(true)).toBe(true);
    expect(lerSimNao(0)).toBe(false);
    expect(lerSimNao("talvez")).toBeUndefined();
  });
});

describe("leituras derivadas — não é uma segunda máquina de estados", () => {
  it("cinco estados do atendimento a partir dos 10 status", () => {
    expect(statusAtendimento({ status: "lead" })).toBe("novo");
    expect(statusAtendimento({ status: "em_contato" })).toBe("em_contato");
    expect(statusAtendimento({ status: "sem_resposta" })).toBe("sem_resposta");
    for (const s of ["agendado", "no_show", "reuniao_realizada"] as const) expect(statusAtendimento({ status: s })).toBe("agendou");
    for (const s of ["cliente", "contato_invalido", "sem_interesse", "desistencia"] as const) {
      expect(statusAtendimento({ status: s })).toBe("encerrado");
    }
  });

  it("estado da reunião: agendada → confirmada → realizada; remarcar e não compareceu", () => {
    const ag = { status: "agendado" as const, meetingFor: "2026-11-25T22:00:00.000Z", bookedAt: "2026-11-20T15:00:00.000Z" };
    expect(statusReuniao(ag)).toBe("agendada");
    expect(statusReuniao({ ...ag, reuniaoConfirmadaEm: "2026-11-24T15:00:00.000Z" })).toBe("confirmada");
    expect(statusReuniao({ ...ag, reuniaoRemarcarEm: "2026-11-24T15:00:00.000Z" })).toBe("remarcar");
    expect(statusReuniao({ ...ag, status: "no_show" })).toBe("nao_compareceu");
    expect(statusReuniao({ ...ag, status: "reuniao_realizada", attendedAt: "2026-11-25T23:00:00.000Z" })).toBe("realizada");
    // perda depois de comparecer continua "realizada" (o marco fica)
    expect(statusReuniao({ ...ag, status: "sem_interesse", attendedAt: "2026-11-25T23:00:00.000Z" })).toBe("realizada");
    expect(statusReuniao({ status: "lead" })).toBeUndefined();
  });

  it("classe que vale: a do painel; sem ela, a do n8n — e o aviso quando discordam", () => {
    expect(classeDoLead({ classe: "B", classeN8n: "A" })).toBe("B");
    expect(classeDoLead({ classeN8n: "A" })).toBe("A");
    expect(classeDiverge({ classe: "B", classeN8n: "A" })).toBe(true);
    expect(classeDiverge({ classe: "A", classeN8n: "A" })).toBe(false);
    expect(classeDiverge({ classeN8n: "A" })).toBe(false);
  });

  it("tentativas da ficha: em ordem, sem as desfeitas, com resultado e nota", () => {
    const ev = (id: string, em: string, payload: Record<string, string>): LeadEvent => ({
      id,
      leadId: "1",
      leadName: "P",
      actor: "eduardo",
      action: "tentativa",
      payload,
      occurredAt: em,
      createdAt: em,
    });
    const eventos: LeadEvent[] = [
      ev("t2", "2026-11-17T20:00:00.000Z", { canal: "whatsapp", falou: "nao", resultado: "nao_atendeu" }),
      ev("t1", "2026-11-17T16:00:00.000Z", { canal: "ligacao", falou: "nao", resultado: "nao_atendeu" }),
      ev("t3", "2026-11-18T16:00:00.000Z", { canal: "ligacao", falou: "sim", resultado: "falou", nota: "Quer imóvel em 2027" }),
      { id: "d", leadId: "1", leadName: "P", actor: "eduardo", action: "desfeito", payload: { evento: "t2" }, createdAt: "2026-11-17T20:01:00.000Z" },
    ];
    const ts = tentativasDoLead(eventos);
    expect(ts.map((t) => t.id)).toEqual(["t1", "t3"]);
    expect(ts[1]).toMatchObject({ resultado: "falou", falou: true, nota: "Quer imóvel em 2027", canal: "ligacao" });
  });
});

describe("Leads — filtros e CSV da ficha", () => {
  const leads = [
    lead("1", "2026-11-16T19:00:00.000Z", { classe: "A", classeN8n: "A", bem: "imovel", comunidadeEm: "2026-11-16T19:30:00.000Z", msg1EnviadaEm: "2026-11-16T19:00:10.000Z" }),
    lead("2", "2026-11-17T19:00:00.000Z", { classe: "B", classeN8n: "A", bem: "carro", msg1Status: "falhou" }),
    lead("3", "2026-11-18T19:00:00.000Z", { classe: "X", finalidade: "quitar_dividas" }),
    lead("4", "2026-11-18T20:00:00.000Z"),
  ];
  const linhas = montarLinhasDeLeads(base(leads), [], AGORA, { range: CAPTACAO });

  it("cada filtro da ficha recorta pelo valor da linha", () => {
    const ids = (f: Partial<typeof FILTRO_VAZIO>) => aplicarFiltro(linhas, { ...FILTRO_VAZIO, ...f }).map((r) => r.id).sort();
    expect(ids({ classe: "A" })).toEqual(["1"]);
    expect(ids({ classe: "sem" })).toEqual(["4"]);
    expect(ids({ bem: "carro" })).toEqual(["2"]);
    expect(ids({ comunidade: "sim" })).toEqual(["1"]);
    expect(ids({ comunidade: "nao" })).toEqual(["2", "3", "4"]);
    expect(ids({ msg1: "falhou" })).toEqual(["2"]);
    expect(ids({ msg1: "nao" })).toEqual(["3", "4"]);
    expect(ids({ atendimento: "novo" })).toEqual(["1", "2", "3", "4"]);
  });

  it("o pedido de exportação só aceita valores do vocabulário — e o registro diz o filtro", () => {
    const f = filtroDoPedido({ classe: "A", bem: "barco", comunidade: "sim", status: "todos" });
    expect(f.classe).toBe("A");
    expect(f.bem).toBeUndefined();
    expect(descreverFiltro(f, "Captação")).toContain("classe: A");
    expect(descreverFiltro(f, "Captação")).toContain("comunidade: Clicou");
  });

  it("CSV: cabeçalho e linhas com o mesmo número de colunas, divergência marcada", () => {
    const csv = montarCsvDeLeads(linhas).replace(/^﻿/, "").split("\r\n");
    const n = CSV_CABECALHO.length;
    for (const l of csv) expect(l.split(";").length).toBe(n);
    const dois = csv.find((l) => l.startsWith("Pessoa 2"))!;
    expect(dois).toContain(";B;sim;Carro;");
  });
});

describe("Funil — Qualificado e Clicou na comunidade entre Leads e o 1º contato", () => {
  const kp = (data: DashboardData) => kpisDoPeriodo(data, CAPTACAO, { hoje: HOJE, agora: AGORA });
  const funil = (data: DashboardData, vista: "periodo" | "coorte") =>
    montarFunil({ data, range: CAPTACAO, kpis: kp(data), robo: null, comercial: null, vista, hoje: HOJE, agora: AGORA });

  it("sem nenhum lead com classe ou clique, o funil fica como era", () => {
    const data = base([lead("1", "2026-11-16T19:00:00.000Z"), lead("2", "2026-11-17T19:00:00.000Z")]);
    expect(funil(data, "coorte").etapas.map((e) => e.key)).not.toContain("qualificados");
  });

  it("com a ficha: a ordem é Leads → Qualificado → Comunidade → 1º contato, e a taxa diz sobre quem", () => {
    const leads = [
      ...["A", "A", "B", "C", "X"].map((c, i) =>
        lead(String(i + 1), `2026-11-1${6 + (i % 3)}T19:00:00.000Z`, {
          classe: c as Lead["classe"],
          comunidadeEm: i < 2 ? "2026-11-18T19:00:00.000Z" : undefined,
        }),
      ),
      lead("9", "2026-11-18T19:00:00.000Z"), // sem as respostas
    ];
    const f = funil(base(leads), "coorte");
    const keys = f.etapas.map((e) => e.key);
    const i = keys.indexOf("leads");
    expect(keys.slice(i, i + 4)).toEqual(["leads", "qualificados", "comunidade", "primeiro_contato"]);
    const q = f.etapas.find((e) => e.key === "qualificados")!;
    expect(q.valor).toBe(3);
    expect(q.daAnterior).toBeCloseTo(3 / 5); // sobre os 5 com classe, não os 6
    expect(q.baseDaTaxa).toBe("dos que têm classe");
    expect(q.nota).toContain("1 lead sem classe");
    const c = f.etapas.find((e) => e.key === "comunidade")!;
    expect(c.valor).toBe(2);
    expect(c.baseDaTaxa).toBe("dos leads");
    expect(f.etapas.find((e) => e.key === "primeiro_contato")!.baseDaTaxa).toBe("dos leads");
  });

  it("vista de período: a comunidade conta cliques do período (eventos) — sem taxa", () => {
    const leads = [lead("1", "2026-11-16T19:00:00.000Z", { classe: "A", comunidadeEm: "2026-11-19T10:00:00.000Z" })];
    const c = funil(base(leads), "periodo").etapas.find((e) => e.key === "comunidade")!;
    expect(c.valor).toBe(1);
    expect(c.daAnterior).toBeUndefined();
    expect(c.semTaxa).toBeDefined();
  });
});
