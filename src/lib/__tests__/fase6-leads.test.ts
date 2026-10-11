/**
 * Fase 6.4 — a página Leads. Fixture sintética (nenhum dado real).
 * Datas em Brasília (UTC−3, sem horário de verão). 2026-10-08 é quinta.
 */
import { describe, expect, it } from "vitest";
import { mascararContato, mascararEmail, mascararTelefone } from "../lgpd";
import { ETAPA_MAXIMA_LABEL, etapaMaxima } from "../lead-status";
import {
  CSV_CABECALHO,
  FILTRO_VAZIO,
  aplicarFiltro,
  contarPorStatus,
  descreverFiltro,
  montarCsvDeLeads,
  montarLinhasDeLeads,
  type LinhaDeLead,
} from "../leads-vista";
import { proximaPelaCadencia } from "../contato";
import type { AdDaily, Creative, DashboardData, Lead, LeadEvent } from "../types";

const brt = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();

// ---------------------------------------------------------------- fixture

const criativo = (adId: string, name: string): Creative => ({ adId, brand: "consorcio", name, format: "imagem" });
const ad = (adId: string, campaign: string, campaignId: string, adset: string, adsetId: string): AdDaily => ({
  brand: "consorcio",
  date: "2026-10-05",
  campaign,
  campaignId,
  adset,
  adsetId,
  adId,
  objective: "OUTCOME_LEADS",
  spend: 100,
  impressions: 1000,
  reach: 800,
  frequency: 1.2,
  clicks: 50,
  leads: 1,
});

const lead = (id: string, over: Partial<Lead> = {}): Lead => ({
  id,
  brand: "consorcio",
  createdAt: brt("2026-10-08", "10:00"),
  name: `Pessoa ${id}`,
  phone: `1199999${id.padStart(4, "0")}`,
  email: `pessoa${id}@exemplo.com`,
  status: "lead",
  ...over,
});

let seq = 0;
const tentativa = (leadId: string, quando: string, falou: boolean): LeadEvent => ({
  id: `T${++seq}`,
  leadId,
  leadName: "Pessoa",
  actor: "ana",
  action: "tentativa",
  occurredAt: quando,
  createdAt: quando,
  payload: { canal: "whatsapp", falou: falou ? "sim" : "nao", ...(falou ? {} : { proxima: proximaPelaCadencia(quando, 1)! }) },
});

function base(over: Partial<DashboardData> = {}): DashboardData {
  return {
    campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-08-01", budgetTotal: 0 },
    igAccountDaily: [],
    igPosts: [],
    adDaily: [ad("100001", "Consórcio Leads", "900", "Interesses 25-45", "800"), ad("100002", "Consórcio Leads", "900", "Lookalike", "801")],
    creatives: [criativo("100001", "Anúncio A"), criativo("100002", "Anúncio B")],
    lpDaily: [],
    leads: [],
    goals: [],
    metas: [],
    updatedAt: "2026-10-08T12:00:00.000Z",
    ...over,
  };
}

// AGORA: quinta 13:00 em Brasília.
const AGORA = brt("2026-10-08", "13:00");

const A = lead("1", {
  status: "em_contato",
  firstContactAt: brt("2026-10-08", "10:30"),
  adId: "100002",
  adsetId: "801",
  campaignId: "900",
});
const B = lead("2", { createdAt: brt("2026-10-08", "11:00"), utmContent: "Anúncio A" });
const C = lead("3", {
  status: "agendado",
  firstContactAt: brt("2026-10-08", "10:05"),
  bookedAt: brt("2026-10-08", "10:10"),
  meetingFor: brt("2026-10-09", "10:00"),
});
const D = lead("4", { status: "sem_interesse", bookedAt: brt("2026-10-07", "10:00"), lostAt: brt("2026-10-08", "09:00") });
const E = lead("5", { createdAt: brt("2026-09-01", "10:00"), status: "cliente", closedAt: brt("2026-09-10", "10:00"), value: 100000 });
// F: mesma pessoa que B (mesmo telefone) — duplicado.
const F = lead("6", { createdAt: brt("2026-10-08", "12:00"), phone: B.phone, email: undefined });
// G: cadastro de teste com telefone curto.
const G = lead("7", { name: "teste", phone: "123", email: "x@exemplo.com" });
// H: excluído — não aparece.
const H = lead("8", { deletedAt: brt("2026-10-08", "12:30"), deletedBy: "admin", deletedReason: "spam" });
// I: 1º contato fora do prazo (entrou quarta 17:00, contato quinta 09:30 = 1h30 útil).
const I = lead("9", {
  createdAt: brt("2026-10-07", "17:00"),
  status: "em_contato",
  firstContactAt: brt("2026-10-08", "09:30"),
});

const dados = base({ leads: [A, B, C, D, E, F, G, H, I] });
const eventos: LeadEvent[] = [
  tentativa(A.id, brt("2026-10-08", "10:30"), false),
  tentativa(C.id, brt("2026-10-08", "10:05"), true),
  tentativa(I.id, brt("2026-10-08", "09:30"), false),
];

const porId = (linhas: LinhaDeLead[]) => new Map(linhas.map((l) => [l.id, l]));

// ---------------------------------------------------------------- máscara

describe("máscara LGPD (papel Marketing)", () => {
  it("telefone: fica o DDD e o final — com ou sem DDI, celular ou fixo", () => {
    expect(mascararTelefone("(11) 99999-1234")).toBe("(11) •••••-1234");
    expect(mascararTelefone("5511999991234")).toBe("(11) •••••-1234");
    expect(mascararTelefone("+55 11 3333-4444")).toBe("(11) ••••-4444");
    expect(mascararTelefone("999991234")).toBe("•••••-1234");
    expect(mascararTelefone("123")).toBe("•••");
    expect(mascararTelefone("")).toBe("");
    expect(mascararTelefone(undefined)).toBe("");
  });

  it("e-mail: a 1ª letra e o domínio", () => {
    expect(mascararEmail("ana.silva@dominio.com")).toBe("a•••@dominio.com");
    expect(mascararEmail("  b@x.co ")).toBe("b•••@x.co");
    expect(mascararEmail("sem-arroba")).toBe("•••");
    expect(mascararEmail(undefined)).toBe("");
  });

  it("mascararContato troca só telefone e e-mail, e não inventa campo vazio", () => {
    const original = { id: "1", phone: "11999991234", email: "ana@x.com", name: "Ana" };
    expect(mascararContato(original)).toEqual({ id: "1", phone: "(11) •••••-1234", email: "a•••@x.com", name: "Ana" });
    const semContato: { id: string; phone?: string; email?: string } = { id: "2" };
    expect(mascararContato(semContato)).toEqual({ id: "2" });
  });
});

// ---------------------------------------------------------------- etapa máxima

describe("etapa máxima (ADR-01: função dos marcos, nunca campo gravado)", () => {
  it("lê os marcos na ordem do funil; quem agendou e se perdeu continua tendo agendado", () => {
    expect(etapaMaxima({ status: "lead" })).toBe("lead");
    expect(etapaMaxima({ status: "em_contato" })).toBe("em_contato");
    expect(etapaMaxima({ status: "sem_resposta", firstContactAt: "x" })).toBe("em_contato");
    expect(etapaMaxima({ status: "sem_interesse", bookedAt: "x" })).toBe("agendado");
    expect(etapaMaxima({ status: "no_show" })).toBe("agendado");
    expect(etapaMaxima({ status: "sem_resposta", attendedAt: "x" })).toBe("reuniao_realizada");
    expect(etapaMaxima({ status: "cliente" })).toBe("cliente");
    expect(etapaMaxima({ status: "desistencia", closedAt: "x" })).toBe("cliente");
  });

  it("perda por decisão implica conversa; por qualidade, só a entrada", () => {
    expect(etapaMaxima({ status: "sem_interesse" })).toBe("em_contato");
    expect(etapaMaxima({ status: "desistencia" })).toBe("em_contato");
    expect(etapaMaxima({ status: "contato_invalido" })).toBe("lead");
    expect(etapaMaxima({ status: "sem_resposta" })).toBe("lead");
  });

  it("o rótulo é o fato, não o status", () => {
    expect(ETAPA_MAXIMA_LABEL.agendado).toBe("Agendou");
  });
});

// ---------------------------------------------------------------- linhas

describe("montarLinhasDeLeads", () => {
  const linhas = montarLinhasDeLeads(dados, eventos, AGORA);
  const l = porId(linhas);

  it("não lista excluídos e dá uma linha por lead vivo", () => {
    expect(linhas.map((x) => x.id).sort()).toEqual(["1", "2", "3", "4", "5", "6", "7", "9"]);
  });

  it("tempo até o 1º contato em horas úteis, com a régua de 1 hora útil", () => {
    expect(l.get("1")!.horasAte1oContato).toBeCloseTo(0.5, 5);
    expect(l.get("1")!.primeiroContatoNoPrazo).toBe(true);
    // Entrou quarta 17h: 1 h útil até 18h + 30 min na quinta = 1,5 h → fora do prazo.
    expect(l.get("9")!.horasAte1oContato).toBeCloseTo(1.5, 5);
    expect(l.get("9")!.primeiroContatoNoPrazo).toBe(false);
    expect(l.get("2")!.horasAte1oContato).toBeNull();
    expect(l.get("2")!.primeiroContatoNoPrazo).toBeNull();
  });

  it("etapa máxima e tentativas saem das fontes únicas", () => {
    expect(l.get("1")!.etapaMaxima).toBe("em_contato");
    expect(l.get("3")!.etapaMaxima).toBe("agendado");
    expect(l.get("4")!.etapaMaxima).toBe("agendado");
    expect(l.get("5")!.etapaMaxima).toBe("cliente");
    expect(l.get("1")!.tentativas).toBe(1);
    expect(l.get("3")!.falou).toBe(true);
    expect(l.get("2")!.tentativas).toBe(0);
  });

  it("próxima ação é a da Fila: ligar agora, retornar, confirmar, ou nada (com o porquê)", () => {
    // B entrou 11h, ninguém tentou, são 13h: 2 h úteis num prazo de 1 → atrasada.
    expect(l.get("2")!.proximaAcao).toBe("ligar agora");
    expect(l.get("2")!.etapaDaFila).toBe("novo");
    expect(l.get("2")!.acaoAtrasada).toBe(true);
    expect(l.get("2")!.dono).toBe("COM");
    // A: tentativa 10h30 sem resposta, cadência +2 h = 12h30 < 13h → retornar.
    expect(l.get("1")!.proximaAcao).toBe("retornar");
    expect(l.get("1")!.acaoAtrasada).toBe(false);
    // C: reunião amanhã 10h (21 h) → confirmar.
    expect(l.get("3")!.proximaAcao).toBe("confirmar reunião");
    expect(l.get("3")!.acaoAtrasada).toBe(false);
    // D: encerrado → "—", sem dono, e a dica diz por quê.
    expect(l.get("4")!.proximaAcao).toBe("—");
    expect(l.get("4")!.dono).toBeUndefined();
    expect(l.get("4")!.acaoPorque).toContain("Encerrado");
    // E: cliente → "—", dono especialista.
    expect(l.get("5")!.proximaAcao).toBe("—");
    expect(l.get("5")!.dono).toBe("ESP");
  });

  it("origem é a trilha campanha › conjunto › anúncio", () => {
    expect(l.get("1")!.origem.trilha).toBe("Consórcio Leads › Lookalike › Anúncio B");
    expect(l.get("2")!.origem.trilha).toBe("Consórcio Leads › Interesses 25-45 › Anúncio A");
    expect(l.get("3")!.origem.anuncio).toBe("—");
  });

  it("sinalizadores: teste, duplicado (de quem) e contato inválido", () => {
    expect(l.get("7")!.sinalizadores.teste).toContain("teste");
    expect(l.get("7")!.sinalizadores.contatoInvalido).toBe(true);
    expect(l.get("2")!.sinalizadores.duplicado).toBe(true);
    expect(l.get("6")!.sinalizadores.duplicado).toBe(true);
    // Empate de história: o principal é o mais antigo (B); F é o duplicado dele.
    expect(l.get("6")!.sinalizadores.duplicadoDe).toBe(B.name);
    expect(l.get("2")!.sinalizadores.duplicadoDe).toBeUndefined();
    expect(l.get("1")!.sinalizadores).toEqual({ teste: null, duplicado: false, duplicadoDe: undefined, contatoInvalido: false });
  });

  it("o período filtra pela entrada (coorte); os duplicados continuam olhando a base inteira", () => {
    const outubro = montarLinhasDeLeads(dados, eventos, AGORA, { range: { from: "2026-10-01", to: "2026-10-31" } });
    expect(outubro.map((x) => x.id)).not.toContain("5");
    expect(outubro).toHaveLength(7);
    const so8 = montarLinhasDeLeads(dados, eventos, AGORA, { range: { from: "2026-10-08", to: "2026-10-08" } });
    expect(porId(so8).get("6")!.sinalizadores.duplicadoDe).toBe(B.name);
  });
});

// ---------------------------------------------------------------- abas, filtros e CSV

describe("abas, filtros e CSV", () => {
  const linhas = montarLinhasDeLeads(dados, eventos, AGORA);

  it("as contagens das abas somam o total", () => {
    const c = contarPorStatus(linhas);
    const { todos, ...porStatus } = c;
    expect(todos).toBe(linhas.length);
    expect(Object.values(porStatus).reduce((s, n) => s + n, 0)).toBe(todos);
    // Novos: B, F e G (H está excluído e não entra).
    expect(c.lead).toBe(3);
    expect(c.em_contato).toBe(2);
    expect(c.cliente).toBe(1);
  });

  it("o filtro respeita status, origem, dono, sinalizadores (OU) e busca", () => {
    expect(aplicarFiltro(linhas, { ...FILTRO_VAZIO, status: "em_contato" }).map((x) => x.id).sort()).toEqual(["1", "9"]);
    expect(aplicarFiltro(linhas, { ...FILTRO_VAZIO, campanha: "Consórcio Leads", conjunto: "Lookalike" }).map((x) => x.id)).toEqual(["1"]);
    expect(aplicarFiltro(linhas, { ...FILTRO_VAZIO, dono: "ESP" }).map((x) => x.id)).toEqual(["5"]);
    expect(aplicarFiltro(linhas, { ...FILTRO_VAZIO, sinalizadores: ["teste", "duplicado"] }).map((x) => x.id).sort()).toEqual(["2", "6", "7"]);
    expect(aplicarFiltro(linhas, { ...FILTRO_VAZIO, busca: "pessoa 5" }).map((x) => x.id)).toEqual(["5"]);
    expect(aplicarFiltro(linhas, { ...FILTRO_VAZIO, busca: "(11) 99999-0003" }).map((x) => x.id)).toEqual(["3"]);
  });

  it("o CSV leva só o subconjunto filtrado, com o telefone como texto para o Excel", () => {
    const filtradas = aplicarFiltro(linhas, { ...FILTRO_VAZIO, status: "em_contato" });
    const csv = montarCsvDeLeads(filtradas);
    const linhasCsv = csv.split("\r\n");
    expect(linhasCsv).toHaveLength(1 + filtradas.length);
    expect(linhasCsv[0]).toBe("﻿" + CSV_CABECALHO.join(";"));
    const colunas = linhasCsv[1].split(";");
    expect(colunas).toHaveLength(CSV_CABECALHO.length);
    expect(colunas[2]).toMatch(/^="\d+"$/);
    expect(colunas[3]).toBe("Em contato");
    expect(colunas[4]).toBe("Contato feito");
    expect(colunas[9]).toBe("Consórcio Leads");
    expect(colunas[13]).toBe("comercial");
    expect(csv).not.toContain("Pessoa 5");
    expect(montarCsvDeLeads([]).split("\r\n")).toHaveLength(1);
  });

  it("a descrição do filtro vai para o registro sem o texto da busca", () => {
    const d = descreverFiltro(
      { status: "agendado", campanha: "Consórcio Leads", sinalizadores: ["duplicado"], busca: "11999990003", dono: "COM" },
      "30 dias",
    );
    expect(d).toBe("período: 30 dias · status: Agendado · campanha: Consórcio Leads · dono: comercial · sinalizadores: Duplicado · busca: sim");
    expect(d).not.toContain("11999990003");
    expect(descreverFiltro(FILTRO_VAZIO, "Campanha")).toBe("período: Campanha · status: todos");
  });
});
