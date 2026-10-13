/**
 * Fase 6.4 — a página Leads. Fixture sintética (nenhum dado real).
 * Datas em Brasília (UTC−3, sem horário de verão). 2026-10-08 é quinta.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mascararContato, mascararEmail, mascararNoTexto, mascararTelefone } from "../lgpd";
import { ETAPA_MAXIMA_LABEL, etapaMaxima, statusLabel } from "../lead-status";
import {
  CSV_CABECALHO,
  FILTRO_VAZIO,
  aplicarFiltro,
  contarPorStatus,
  descreverFiltro,
  filtroDoPedido,
  montarCsvDeLeads,
  montarLinhasDeLeads,
  periodoDoRegistro,
  type LinhaDeLead,
} from "../leads-vista";
import { proximaPelaCadencia } from "../contato";
import { HORAS_APOS_CONVERSA } from "../fila";
import { formatDateTime } from "../format";
import { pareceTeste } from "../identidade";
import { comPeriodo } from "../range";
import { periodoPadraoDe } from "@/components/layout/nav-items";
import type { AdDaily, Creative, DashboardData, Lead, LeadEvent } from "../types";

// ---------------------------------------------------------------- dublês
// Só o que a exportação e os componentes da ficha tocam: o store (a leitura dos
// leads e o insert em audit_log), o papel, quem age, a marca e a URL (`?range=`).
const dubles = vi.hoisted(() => ({
  addAuditEntry: vi.fn<(entry: unknown) => Promise<void>>(async () => {}),
  getData: vi.fn<(brand?: string) => Promise<DashboardData>>(async () => {
    throw new Error("getData sem dublê neste teste");
  }),
  listLeadEvents: vi.fn<(opts?: unknown) => Promise<LeadEvent[]>>(async () => []),
  can: vi.fn<(cap: string) => Promise<boolean>>(async () => true),
  range: "7d" as string | null,
}));

vi.mock("@/lib/data/store", () => ({
  addAuditEntry: dubles.addAuditEntry,
  getData: dubles.getData,
  listLeadEvents: dubles.listLeadEvents,
}));
vi.mock("@/lib/auth/guard", () => ({ can: dubles.can }));
vi.mock("@/lib/auth/actor", () => ({ currentActor: async () => "ana", newEventId: () => "EVT-teste" }));
vi.mock("@/lib/active-brand", () => ({ activeBrandSlug: async () => "consorcio" }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/leads",
  useSearchParams: () => new URLSearchParams(dubles.range ? `range=${dubles.range}` : ""),
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react");
  return {
    default: ({ href, children, ...resto }: { href: string; children?: ReactNode }) => h("a", { href, ...resto }, children),
  };
});

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

// ---------------------------------------------------------------- revisão (Fase 6.4)

describe("“Parece teste” não fura a máscara (LGPD)", () => {
  const porEmail = lead("21", { name: "Pessoa Vinte e Um", email: "teste7@exemplo.com", phone: "11987654321" });
  const porFone = lead("22", { name: "Pessoa Vinte e Dois", email: "p22@exemplo.com", phone: "(11) 99999-9999" });
  const linhas = montarLinhasDeLeads(base({ leads: [porEmail, porFone] }), [], AGORA);
  const l = porId(linhas);

  it("o motivo diz o porquê sem o contato — é o que vai para a dica do selo e para o aviso da ficha", () => {
    expect(l.get("21")!.sinalizadores.teste).toBe("e-mail de teste");
    expect(l.get("22")!.sinalizadores.teste).toBe("telefone com dígitos repetidos");
    // A ficha chama `pareceTeste(lead)` com o lead cru: o texto já sai sem PII.
    for (const x of [porEmail, porFone]) {
      const motivo = pareceTeste(x)!;
      expect(motivo).not.toContain("@");
      expect(motivo).not.toMatch(/\d/);
    }
  });

  it("a linha mascarada (papel Marketing) não carrega o contato cru em campo nenhum", () => {
    for (const crua of linhas) {
      const json = JSON.stringify(mascararContato(crua));
      expect(json).not.toContain(crua.email!);
      expect(json).not.toContain(crua.phone!);
      expect(json).not.toMatch(/9{5}|987654321/);
    }
  });

  it("motivo antigo gravado com o contato cru sai mascarado; datas e ids de lead passam intactos", () => {
    expect(mascararNoTexto("teste (e-mail “teste7@exemplo.com”)")).toBe("teste (e-mail “t•••@exemplo.com”)");
    expect(mascararNoTexto("teste (telefone “(11) 99999-9999”)")).toBe("teste (telefone “(11) •••••-9999”)");
    expect(mascararNoTexto("teste (telefone “+55 11 99999-9999”)")).not.toContain("99999");
    expect(mascararNoTexto("spam — 08/10/2026 10:00")).toBe("spam — 08/10/2026 10:00");
    expect(mascararNoTexto("duplicado de Pessoa 2 (LEAD-LP-17283912345678)")).toBe(
      "duplicado de Pessoa 2 (LEAD-LP-17283912345678)",
    );
    expect(mascararNoTexto(undefined)).toBe("");
  });
});

describe("CSV: nada que o Excel execute", () => {
  const [modelo] = montarLinhasDeLeads(base({ leads: [lead("41")] }), [], AGORA);
  const linhaDoCsv = (r: LinhaDeLead) => montarCsvDeLeads([r]).split("\r\n")[1];

  it("nome, e-mail e origem que começam com = + - @ (ou tab/CR) saem como texto, com apóstrofo e entre aspas", () => {
    const maliciosa: LinhaDeLead = {
      ...modelo,
      name: '=HYPERLINK("https://phish.example";"Abrir ficha")',
      email: "+5@exemplo.com",
      origem: { ...modelo.origem, campanha: "@SOMA(1;2)", conjunto: "\t=1+1", anuncio: "-2+3+cmd|x" },
    };
    const linha = linhaDoCsv(maliciosa);
    expect(linha.startsWith(`"'=HYPERLINK(""https://phish.example"";""Abrir ficha"")";`)).toBe(true);
    expect(linha).toContain(`;"'+5@exemplo.com";`);
    expect(linha).toContain(`;"'@SOMA(1;2)";"'\t=1+1";"'-2+3+cmd|x";`);
    // Fora das aspas, a única célula que começa com caractere perigoso é o telefone.
    const foraDasAspas = linha.replace(/"'[^"]*(?:""[^"]*)*"/g, "TEXTO");
    expect(foraDasAspas.split(";").filter((c) => /^[=+\-@\t\r]/.test(c))).toEqual([`="${modelo.phone}"`]);
  });

  it("o único = de propósito continua: o telefone como texto; texto comum não ganha apóstrofo", () => {
    const comum: LinhaDeLead = { ...modelo, name: "Ana-Maria Souza", email: "ana@exemplo.com" };
    const colunas = linhaDoCsv(comum).split(";");
    expect(colunas[0]).toBe("Ana-Maria Souza");
    expect(colunas[1]).toBe("ana@exemplo.com");
    expect(colunas[2]).toBe(`="${modelo.phone}"`);
  });
});

describe("exportação: o servidor monta o CSV, registra o que saiu e só então devolve", () => {
  const silencio = vi.spyOn(console, "error");
  // Três pessoas no dia 08/10 (duas "Novo", uma agendada) e uma de setembro.
  const N1 = lead("51");
  const N2 = lead("52", { name: "Pessoa Busca", createdAt: brt("2026-10-08", "11:00") });
  const AG = lead("53", {
    status: "agendado",
    firstContactAt: brt("2026-10-08", "10:20"),
    bookedAt: brt("2026-10-08", "10:30"),
    meetingFor: brt("2026-10-12", "10:00"),
  });
  const SET = lead("54", { createdAt: brt("2026-09-01", "10:00") });
  const dados = base({ leads: [N1, N2, AG, SET] });

  const pedir = (corpo: unknown, headers: Record<string, string> = {}) =>
    new Request("http://localhost/leads/exportar", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    });
  const exportar = async (req: Request) => (await import("@/app/(dashboard)/leads/exportar/route")).POST(req);
  const registro = () => dubles.addAuditEntry.mock.calls[0]?.[0] as { action: string; actor: string; detail: string };

  beforeEach(() => {
    dubles.addAuditEntry.mockReset();
    dubles.addAuditEntry.mockImplementation(async () => {});
    dubles.can.mockReset();
    dubles.can.mockImplementation(async () => true);
    dubles.getData.mockReset();
    dubles.getData.mockImplementation(async () => dados);
    dubles.listLeadEvents.mockReset();
    dubles.listLeadEvents.mockImplementation(async () => []);
    silencio.mockImplementation(() => {});
  });
  afterEach(() => silencio.mockReset());

  it("a contagem e o filtro do registro são os do que SAIU — o que o navegador diz sobre n e descrição não entra", async () => {
    const res = await exportar(
      pedir({
        range: "2026-10-08..2026-10-08",
        filtro: { status: "lead" },
        // Campos que a ação antiga aceitava do navegador: ignorados.
        n: 0,
        descricaoDoFiltro: "qualquer",
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("x-leads-exportados")).toBe("2");
    const csv = await res.text();
    expect(csv.split("\r\n")).toHaveLength(3); // cabeçalho + N1 + N2
    expect(csv).toContain(N1.name);
    expect(csv).toContain(N2.name);
    expect(csv).not.toContain(AG.name); // outro status
    expect(csv).not.toContain(SET.name); // fora do período

    expect(dubles.addAuditEntry).toHaveBeenCalledTimes(1);
    expect(registro()).toMatchObject({ actor: "ana", action: "exportar_leads" });
    expect(registro().detail).toBe(
      `2 leads · marca: consorcio · período: 08/10 a 08/10 (08/10/2026 a 08/10/2026) · status: ${statusLabel("lead")}`,
    );
    expect(registro().detail).not.toContain("qualquer");
    // A marca e os eventos lidos são os da marca ativa, como na página.
    expect(dubles.getData).toHaveBeenCalledWith("consorcio");
    expect(dubles.listLeadEvents).toHaveBeenCalledWith({ brand: "consorcio", limit: 0 });
  });

  it("a busca vale no servidor (vai no corpo, não na URL) e o registro diz só “busca: sim”", async () => {
    const res = await exportar(pedir({ range: "all", filtro: { busca: N2.phone } }));
    expect(res.headers.get("x-leads-exportados")).toBe("1");
    expect(await res.text()).toContain(N2.name);
    expect(registro().detail).toContain("busca: sim");
    expect(registro().detail).not.toContain(N2.phone!);
  });

  it("período inválido exporta a campanha inteira — e o registro diz isso, não o rótulo pedido", async () => {
    const res = await exportar(pedir({ range: "toString", filtro: {} }));
    expect(res.headers.get("x-leads-exportados")).toBe("4");
    expect(registro().detail).toContain("período: Campanha (todo o histórico)");
  });

  it("o insert em audit_log falhou → 503 com mensagem humana e nenhum byte de CSV", async () => {
    dubles.addAuditEntry.mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
    const res = await exportar(pedir({ range: "all", filtro: {} }));
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/json");
    const corpo = (await res.json()) as { ok: boolean; message: string };
    expect(corpo.ok).toBe(false);
    expect(corpo.message).toContain("não foi gerado");
    expect(corpo.message).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(corpo)).not.toContain(N1.name);
  });

  it("sem leads:write (Marketing) → 403, nada lido e nenhum registro", async () => {
    dubles.can.mockImplementation(async () => false);
    const res = await exportar(pedir({ range: "all", filtro: {} }));
    expect(res.status).toBe(403);
    expect(dubles.getData).not.toHaveBeenCalled();
    expect(dubles.addAuditEntry).not.toHaveBeenCalled();
  });

  it("pedido de outro site → 403 (vale também no modo aberto, sem AUTH_SECRET)", async () => {
    const res = await exportar(pedir({ range: "all", filtro: {} }, { "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect(dubles.addAuditEntry).not.toHaveBeenCalled();
  });

  it("filtro sem ninguém → 422 e nenhum registro; corpo que não é JSON → 400", async () => {
    const vazio = await exportar(pedir({ range: "all", filtro: { status: "cliente" } }));
    expect(vazio.status).toBe(422);
    const torto = await exportar(pedir("isto não é json"));
    expect(torto.status).toBe(400);
    expect(dubles.addAuditEntry).not.toHaveBeenCalled();
  });

  it("filtroDoPedido confere campo a campo: o que não é conhecido vira “sem filtro”", () => {
    expect(
      filtroDoPedido({
        status: "hack",
        dono: "toString",
        campanha: 42,
        conjunto: "  Lookalike  ",
        sinalizadores: ["teste", "x", "teste", "constructor"],
        busca: "  ana  ",
      }),
    ).toEqual({
      status: "todos",
      campanha: undefined,
      conjunto: "Lookalike",
      dono: undefined,
      sinalizadores: ["teste"],
      busca: "ana",
    });
    expect(filtroDoPedido(null)).toEqual({ ...FILTRO_VAZIO, campanha: undefined, conjunto: undefined, dono: undefined });
    expect(filtroDoPedido({ status: "agendado", dono: "COM" })).toMatchObject({ status: "agendado", dono: "COM" });
  });

  it("periodoDoRegistro: as datas que o servidor aplicou, ou a campanha inteira", () => {
    expect(periodoDoRegistro("7 dias", { from: "2026-10-07", to: "2026-10-13" })).toBe(
      "7 dias (07/10/2026 a 13/10/2026)",
    );
    expect(periodoDoRegistro("7 dias", undefined)).toBe("Campanha (todo o histórico)");
  });

  it("a tela pede ao servidor e só recebe arquivo com o registro feito; a contagem do aviso é a do servidor", async () => {
    const { pedirCsvDeLeads } = await import("@/components/leads/exportar-csv");
    const enviados: { url: string; corpo: string }[] = [];
    // O fetch da tela ligado direto no route handler.
    const buscar = (async (url: string, init?: RequestInit) => {
      enviados.push({ url, corpo: String(init?.body) });
      return exportar(
        new Request(`http://localhost${url}`, { method: init?.method, headers: init?.headers, body: init?.body }),
      );
    }) as typeof fetch;

    const ok = await pedirCsvDeLeads(
      "2026-10-08..2026-10-08",
      { ...FILTRO_VAZIO, status: "lead", busca: "Busca" },
      buscar,
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.n).toBe(1);
      expect(await ok.arquivo.text()).toContain(N2.name);
    }
    // A busca vai no corpo; a URL não leva nada.
    expect(enviados[0].url).toBe("/leads/exportar");
    expect(JSON.parse(enviados[0].corpo)).toMatchObject({
      range: "2026-10-08..2026-10-08",
      filtro: { busca: "Busca" },
    });

    dubles.addAuditEntry.mockRejectedValueOnce(new Error("insert falhou"));
    const falhou = await pedirCsvDeLeads("all", FILTRO_VAZIO, buscar);
    expect(falhou).toEqual({ ok: false, message: expect.stringContaining("não foi gerado") });
  });

  it("a tela: resposta que não é CSV (login, rede caída) não vira arquivo", async () => {
    const { pedirCsvDeLeads } = await import("@/components/leads/exportar-csv");
    const login = (async () =>
      new Response("<html>entrar</html>", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
    expect((await pedirCsvDeLeads("all", FILTRO_VAZIO, login)).ok).toBe(false);
    const caiu = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const r = await pedirCsvDeLeads("all", FILTRO_VAZIO, caiu);
    expect(r).toEqual({ ok: false, message: expect.stringContaining("nada foi exportado") });
  });
});

describe("o nome abre a ficha COM o período (Histórico e Revisar)", () => {
  afterEach(() => {
    dubles.range = "7d";
  });
  const evento: LeadEvent = {
    id: "EV1",
    leadId: "LEAD-LP-abc",
    leadName: "Pessoa Abc",
    actor: "ana",
    action: "nota",
    createdAt: brt("2026-10-08", "10:00"),
    payload: { texto: "ligar à tarde" },
  };
  const revisado = {
    id: "LEAD-LP-abc",
    name: "Pessoa Abc",
    status: "lead" as const,
    createdAt: brt("2026-10-08", "10:00"),
    origem: "—",
    porque: "e-mail de teste",
  };

  it("Histórico de alterações: /leads/ID?range=7d", async () => {
    const { LeadActivity } = await import("@/components/leads/lead-activity");
    const html = renderToStaticMarkup(createElement(LeadActivity, { events: [evento] }));
    expect(html).toContain('href="/leads/LEAD-LP-abc?range=7d"');
  });

  it("Revisar: /leads/ID?range=7d", async () => {
    const { Revisar } = await import("@/components/leads/revisar");
    const dados = { testes: [revisado], duplicados: [], desistencias: [], contatos: [] };
    const html = renderToStaticMarkup(createElement(Revisar, { dados, podeAgir: false }));
    expect(html).toContain('href="/leads/LEAD-LP-abc?range=7d"');
    expect(html).toContain("por causa do e-mail de teste");
  });

  it("sem ?range= na URL vale o padrão da página — o mesmo que o resto da tela usa", async () => {
    dubles.range = null;
    const { LeadActivity } = await import("@/components/leads/lead-activity");
    const html = renderToStaticMarkup(createElement(LeadActivity, { events: [evento] }));
    expect(html).toContain(`href="${comPeriodo("/leads/LEAD-LP-abc", periodoPadraoDe("/leads"))}"`);
  });
});

describe("o porquê do “—” diz quando a pessoa volta à Fila", () => {
  it("falou e não fechou nada: volta HORAS_APOS_CONVERSA depois da última tentativa — a mesma conta da Fila", () => {
    const J = lead("31", { status: "em_contato", firstContactAt: brt("2026-10-08", "10:00") });
    const ev = [tentativa(J.id, brt("2026-10-08", "10:00"), true)];
    const [agora] = montarLinhasDeLeads(base({ leads: [J] }), ev, AGORA);
    expect(agora.proximaAcao).toBe("—");
    expect(agora.acaoPorque).not.toContain("Nada pendente");
    expect(agora.acaoPorque).toContain("já falou com a pessoa");
    expect(agora.acaoPorque).toContain(`volta à Fila (“Retornar hoje”) em ${formatDateTime(brt("2026-10-09", "10:00"))}`);
    expect(agora.acaoPorque).toContain(`${HORAS_APOS_CONVERSA} h depois`);
    // E a Fila concorda: passado o prazo, a mesma pessoa está em "retornar".
    const [depois] = montarLinhasDeLeads(base({ leads: [J] }), ev, brt("2026-10-09", "10:01"));
    expect(depois.proximaAcao).toBe("retornar");
  });

  it("cadência encerrada sem conversa: o mesmo relógio, sem dizer que falou", () => {
    const K = lead("32", { status: "em_contato", firstContactAt: brt("2026-10-08", "11:00") });
    const semRetorno: LeadEvent = {
      id: "T-fim",
      leadId: K.id,
      leadName: K.name,
      actor: "ana",
      action: "tentativa",
      occurredAt: brt("2026-10-08", "11:00"),
      createdAt: brt("2026-10-08", "11:00"),
      payload: { canal: "telefone", falou: "nao" },
    };
    const [linha] = montarLinhasDeLeads(base({ leads: [K] }), [semRetorno], AGORA);
    expect(linha.proximaAcao).toBe("—");
    expect(linha.acaoPorque).not.toContain("falou");
    expect(linha.acaoPorque).toContain(formatDateTime(brt("2026-10-09", "11:00")));
  });
});
