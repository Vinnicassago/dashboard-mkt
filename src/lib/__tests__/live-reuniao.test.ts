/**
 * Live 01/12 — E5-05: a reunião com o Brunno, da véspera ao resultado. A linha
 * para o Brunno na véspera, o resultado que ainda não é status (proposta enviada,
 * vai pensar), os alertas do diagnóstico e o texto de 15/12.
 */
import { describe, expect, it } from "vitest";
import { LIVE_PADRAO } from "../live";
import { montarPainelLive, relatoriosDaLive } from "../live-painel";
import { lerAtualizacao } from "../n8n/entrada";
import { mensagemDaVespera, resultadoDaReuniao } from "../reuniao";
import { EXPEDIENTE_PADRAO } from "../turno";
import type { DashboardData, Lead, LeadEvent } from "../types";

const lead = (extra: Partial<Lead>): Lead => ({
  id: "L1",
  brand: "consorcio",
  createdAt: "2026-11-17T22:00:00.000Z",
  name: "Maria Souza",
  status: "agendado",
  ...extra,
});

const fato = (leadId: string, resultado: string, em: string, f = "resultado_reuniao"): LeadEvent => ({
  id: `f-${leadId}-${em}`,
  leadId,
  leadName: "P",
  actor: "victor",
  action: "ficha",
  payload: { fato: f, resultado },
  createdAt: em,
});

describe("E5-05 — a véspera", () => {
  it("a linha para o Brunno, no formato da tarefa (hora de Brasília)", () => {
    const l = lead({
      meetingFor: "2026-12-03T22:00:00.000Z",
      bem: "imovel",
      faixaValor: "500k_1m",
      prazoCompra: "1_3_anos",
      faixaParcela: "3000_6000",
      diagnostico: { respostas: [{ resposta: "r" }], perfil: "Pronto para planejar com lance", alertas: ["resgate", "reserva"] },
    });
    expect(mensagemDaVespera(l)).toBe(
      "03/12 19:00 · Maria Souza · quer imóvel de R$ 500 mil a R$ 1 milhão em 1 a 3 anos · parcela que cabe R$ 3.000 a R$ 6.000 · perfil do diagnóstico: Pronto para planejar com lance · alertas: resgate, reserva",
    );
  });

  it("o que falta vira —; diagnóstico sem alerta diz 'nenhum'", () => {
    expect(mensagemDaVespera(lead({}))).toBe("— · Maria Souza · quer — · parcela que cabe — · perfil do diagnóstico: — · alertas: —");
    expect(mensagemDaVespera(lead({ bem: "carro", diagnostico: { respostas: [], perfil: "Começando a base" } }))).toContain(
      "quer carro · parcela que cabe — · perfil do diagnóstico: Começando a base · alertas: nenhum",
    );
  });

  it("os alertas chegam pelo n8n no diagnóstico (lista ou texto com vírgulas)", () => {
    const agora = "2026-11-20T12:00:00.000Z";
    const texto = lerAtualizacao({ diagnostico: { respostas: ["a"], perfil: "P", alertas: "resgate, não é sorte" } }, agora);
    const lista = lerAtualizacao({ diagnostico: { respostas: ["a"], alertas: ["reserva", "  "] } }, agora);
    const sem = lerAtualizacao({ diagnostico: { respostas: ["a"] } }, agora);
    expect(texto.ok && texto.valor.ficha.diagnostico?.alertas).toEqual(["resgate", "não é sorte"]);
    expect(lista.ok && lista.valor.ficha.diagnostico?.alertas).toEqual(["reserva"]);
    expect(sem.ok && sem.valor.ficha.diagnostico && "alertas" in sem.valor.ficha.diagnostico).toBe(false);
  });
});

describe("E5-03 — as ligações do pós-live", () => {
  it("base = A e B sem reunião quando o pós-live começou; ligados, atenderam e marcaram desde então", () => {
    const t = (leadId: string, em: string, resultado: string): LeadEvent => ({
      id: `t-${leadId}-${em}`,
      leadId,
      leadName: "P",
      actor: "eduardo",
      action: "tentativa",
      payload: { canal: "ligacao", falou: resultado === "nao_atendeu" ? "nao" : "sim", resultado },
      occurredAt: em,
      createdAt: em,
    });
    const leads = [
      lead({ id: "Q1", classe: "A", status: "em_contato" }),
      lead({ id: "Q2", classe: "B", status: "em_contato" }),
      lead({ id: "Q3", classe: "A", status: "agendado", bookedAt: "2026-12-04T15:00:00.000Z", meetingFor: "2026-12-08T22:00:00.000Z" }),
      lead({ id: "Q4", classe: "A", status: "agendado", bookedAt: "2026-11-25T15:00:00.000Z", meetingFor: "2026-12-03T22:00:00.000Z" }),
      lead({ id: "Q5", classe: "C", status: "lead" }),
    ];
    const eventos = [
      t("Q1", "2026-12-03T14:00:00.000Z", "falou"),
      t("Q2", "2026-12-03T14:10:00.000Z", "nao_atendeu"),
      t("Q2", "2026-11-28T14:10:00.000Z", "falou"), // antes do pós-live: não conta
      t("Q3", "2026-12-04T14:50:00.000Z", "agendou"),
    ];
    const data: DashboardData = {
      campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-11-16", budgetTotal: 5000 },
      igAccountDaily: [],
      igPosts: [],
      adDaily: [],
      creatives: [],
      lpDaily: [],
      leads,
      goals: [],
      metas: [],
      updatedAt: "2026-12-05T20:00:00.000Z",
    };
    const p = montarPainelLive({
      data,
      eventos,
      cfg: LIVE_PADRAO,
      expediente: EXPEDIENTE_PADRAO,
      range: { de: LIVE_PADRAO.periodo.de, ate: "2026-12-05" },
      hoje: "2026-12-05",
      agora: "2026-12-05T20:00:00.000Z",
    });
    expect(p.ligacoesPosLive).toEqual({ semReuniao: 3, ligados: 3, atenderam: 2, marcaram: 1 });
    expect(relatoriosDaLive(p, LIVE_PADRAO, "2026-12-05").find((r) => r.id === "ligacoes")!.texto).toBe(
      [
        "Leads A e B sem reunião em 02/12: 3",
        "Ligados até 05/12: 3",
        "Atenderam: 2",
        "Reuniões marcadas por essas ligações: 1",
      ].join("\n"),
    );
  });
});

describe("E5-05 — o resultado da reunião", () => {
  it("o último registrado vale; outros fatos da ficha não contam", () => {
    const eventos = [
      fato("L1", "pensando", "2026-12-04T15:00:00.000Z"),
      fato("L1", "proposta", "2026-12-05T15:00:00.000Z"),
      fato("L1", "x", "2026-12-06T15:00:00.000Z", "comunidade"),
    ];
    expect(resultadoDaReuniao(eventos)).toEqual({ resultado: "proposta", em: "2026-12-05T15:00:00.000Z" });
    expect(resultadoDaReuniao([])).toBeUndefined();
  });

  it("o texto de 15/12: realizadas, vendas da ficha, propostas em aberto, fechamento e quem disse não", () => {
    const quem = (id: string, extra: Partial<Lead>) => lead({ id, classe: "A", attendedAt: "2026-12-04T15:00:00.000Z", ...extra });
    const leads = [
      quem("R1", { status: "reuniao_realizada" }),
      quem("R2", { status: "cliente", closedAt: "2026-12-06T15:00:00.000Z", value: 300000 }),
      quem("R3", { status: "sem_interesse" }),
    ];
    const data: DashboardData = {
      campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-11-16", budgetTotal: 5000 },
      igAccountDaily: [],
      igPosts: [],
      adDaily: [],
      creatives: [],
      lpDaily: [],
      leads,
      goals: [],
      metas: [],
      updatedAt: "2026-12-15T20:00:00.000Z",
    };
    const p = montarPainelLive({
      data,
      eventos: [fato("R1", "proposta", "2026-12-05T15:00:00.000Z")],
      cfg: LIVE_PADRAO,
      expediente: EXPEDIENTE_PADRAO,
      range: { de: LIVE_PADRAO.periodo.de, ate: "2026-12-15" },
      hoje: "2026-12-15",
      agora: "2026-12-15T20:00:00.000Z",
    });
    expect(p.fechamento).toEqual({ realizadas: 3, vendas: 1, valorEmCartas: 300000, propostasEmAberto: 1, disseramNao: 1 });
    // A linha "Vendas" da aba é a mesma: sem número digitado, os clientes da ficha.
    expect(p.metas.find((m) => m.id === "vendas")?.valor).toBe(1);
    const texto = relatoriosDaLive(p, LIVE_PADRAO, "2026-12-15").find((r) => r.id === "fechamento")!.texto;
    expect(texto).toBe(
      [
        "Reuniões realizadas: 3 (meta 11)",
        "Vendas: 1 · Valor total em cartas: R$ 300.000",
        "Propostas em aberto: 1",
        "Taxa de fechamento (vendas ÷ realizadas): 33%",
        'Motivos mais comuns de "não": __ (1 disse não depois da reunião)',
      ].join("\n"),
    );
  });
});
