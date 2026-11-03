/**
 * Live 01/12 — etapa 4: a API do n8n de ponta a ponta, chamando as rotas de
 * verdade sobre um JSON local temporário. O relógio fica parado na terça
 * 17/11/2026 19h20 (Brasília), dentro do turno de 16h–22h.
 *
 * Os leads de teste ficam no diretório temporário e somem com ele.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TOKEN = "token-de-teste-n8n";
const AGORA = new Date("2026-11-17T22:20:00.000Z");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-api-"));
const envAntes = { ...process.env };

type Rotas = {
  leads: typeof import("@/app/api/n8n/leads/route");
  lead: typeof import("@/app/api/n8n/leads/[chave]/route");
  pendentes: typeof import("@/app/api/n8n/pendentes/route");
  store: typeof import("@/lib/data/store");
};
let r: Rotas;

beforeAll(async () => {
  vi.useFakeTimers({ now: AGORA, toFake: ["Date"] });
  process.env.LOCAL_DATA_DIR = dir;
  process.env.N8N_API_TOKEN = TOKEN;
  process.env.PAINEL_URL = "https://painel.exemplo";
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_URL;
  vi.resetModules();
  r = {
    leads: await import("@/app/api/n8n/leads/route"),
    lead: await import("@/app/api/n8n/leads/[chave]/route"),
    pendentes: await import("@/app/api/n8n/pendentes/route"),
    store: await import("@/lib/data/store"),
  };
}, 60_000);

afterAll(() => {
  vi.useRealTimers();
  process.env = envAntes;
  fs.rmSync(dir, { recursive: true, force: true });
});

const req = (url: string, init: RequestInit & { token?: string | null } = {}) => {
  const headers = new Headers(init.headers);
  if (init.token !== null) headers.set("authorization", `Bearer ${init.token ?? TOKEN}`);
  return new Request(`http://localhost${url}`, { ...init, headers });
};
const post = (body: unknown, token?: string | null) =>
  r.leads.POST(req("/api/n8n/leads", { method: "POST", body: JSON.stringify(body), token }));
const patch = (chave: string, body: unknown) =>
  r.lead.PATCH(req(`/api/n8n/leads/${chave}`, { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ chave }),
  });
const get = (chave: string) => r.lead.GET(req(`/api/n8n/leads/${chave}`), { params: Promise.resolve({ chave }) });

const inscricaoA = {
  nome: "Teste Classe A",
  whatsapp: "11 99999-0101",
  email: "classe.a@exemplo.test",
  bem: "Imóvel",
  valor: "R$300 mil a R$500 mil",
  finalidade: "Morar",
  parcela: "R$1.500 a R$3.000",
  prazo: "Em até 1 ano",
  classe: "A",
  aceite_mensagens: true,
  utm_source: "meta",
  utm_campaign: "120200000000000011",
  utm_content: "120230000000000101",
  inscrito_em: "2026-11-17T19:10:00-03:00",
};

describe("API do n8n — autenticação", () => {
  it("sem token, ou token errado: 401; sem a variável no servidor: 503", async () => {
    expect((await post(inscricaoA, null)).status).toBe(401);
    expect((await post(inscricaoA, "errado")).status).toBe(401);
    delete process.env.N8N_API_TOKEN;
    expect((await post(inscricaoA)).status).toBe(503);
    process.env.N8N_API_TOKEN = TOKEN;
  });
});

describe("API do n8n — inscrição (POST)", () => {
  let idA = "";

  it("cria o lead A com a classe do painel e o prazo de 1 hora do turno", async () => {
    const res = await post(inscricaoA);
    expect(res.status).toBe(201);
    const { lead, criado } = await res.json();
    expect(criado).toBe(true);
    idA = lead.id;
    expect(lead).toMatchObject({
      whatsapp: "5511999990101",
      classe: "A",
      classe_painel: "A",
      classe_n8n: "A",
      classe_diverge: false,
      bem: "imovel",
      valor: "300k_500k",
      status: "lead",
      status_atendimento: "novo",
      etapa_fila: "primeira",
      prazo_tentativa: "2026-11-17T23:10:00.000Z", // 19h10 + 1 h → 20h10
      link_ficha: `https://painel.exemplo/leads/${encodeURIComponent(idA)}`,
    });
  });

  it("a mesma pessoa inscrita de novo (outro formato do número) atualiza a ficha — não duplica", async () => {
    const res = await post({ ...inscricaoA, whatsapp: "+55 (11) 99999-0101", prazo: "Mais de 3 anos" });
    expect(res.status).toBe(200);
    const { lead, criado } = await res.json();
    expect(criado).toBe(false);
    expect(lead.id).toBe(idA);
    expect(lead.prazo).toBe("mais_3_anos");
    expect(lead.classe_painel).toBe("B"); // prazo de mais de 3 anos → B
    expect(lead.classe_diverge).toBe(true); // o n8n disse A
    const mesmos = (await r.store.listLeads("consorcio")).filter((l) => l.phone && l.phone.replace(/\D/g, "").endsWith("999990101"));
    expect(mesmos).toHaveLength(1);
    // e volta a ser A quando a resposta volta
    await post(inscricaoA);
  });

  it("B fora do turno: prazo no fim do turno do próximo dia útil", async () => {
    const res = await post({ ...inscricaoA, nome: "Teste B fora do turno", whatsapp: "11999990202", email: undefined, prazo: "Preciso agora", classe: "B", inscrito_em: "2026-11-16T23:30:00-03:00" });
    const { lead } = await res.json();
    expect(lead.classe).toBe("B");
    // seg 23h30 (fora do turno) → fim do turno de ter 22h
    expect(lead.prazo_tentativa).toBe("2026-11-18T01:00:00.000Z");
  });

  it("C e X: gravados, mas fora da Fila", async () => {
    const c = await (await post({ ...inscricaoA, nome: "Teste C", whatsapp: "11999990303", email: undefined, valor: "R$150 mil a R$300 mil", classe: "C" })).json();
    const x = await (await post({ ...inscricaoA, nome: "Teste X", whatsapp: "11999990404", email: undefined, finalidade: "Quitar dívidas ou ter dinheiro na mão", classe: "X" })).json();
    expect(c.lead).toMatchObject({ classe: "C", na_fila: false, prazo_tentativa: null });
    expect(x.lead).toMatchObject({ classe: "X", na_fila: false });
  });

  it("campo fora do vocabulário: 422 com o nome do campo, nada gravado", async () => {
    const res = await post({ ...inscricaoA, whatsapp: "11999990505", bem: "Barco" });
    expect(res.status).toBe(422);
    const corpo = await res.json();
    expect(corpo.erros.join(" ")).toContain("bem:");
    expect(await r.store.listLeads("consorcio").then((ls) => ls.some((l) => l.phone === "5511999990505"))).toBe(false);
    expect((await post({ ...inscricaoA, whatsapp: "123" })).status).toBe(422);
  });
});

describe("API do n8n — pendentes (GET) e fatos (PATCH)", () => {
  it("pendentes: só A e B, do prazo mais antigo para o mais novo", async () => {
    const res = await r.pendentes.GET(req("/api/n8n/pendentes"));
    const corpo = await res.json();
    expect(corpo.itens.map((i: { nome: string }) => i.nome)).toEqual(["Teste Classe A", "Teste B fora do turno"]);
    expect(corpo.itens.every((i: { classe: string }) => ["A", "B"].includes(i.classe))).toBe(true);
    const so = await (await r.pendentes.GET(req("/api/n8n/pendentes?classe=B"))).json();
    expect(so.itens).toHaveLength(1);
  });

  it("mensagem, aviso, comunidade e diagnóstico: gravados uma vez, na ficha e no histórico", async () => {
    const res = await patch("5511999990101", {
      msg1_enviada_em: "2026-11-17T19:10:30-03:00",
      msg1_status: "enviada",
      eduardo_avisado_em: true,
      clicou_comunidade: true,
      diagnostico: { respostas: ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"], perfil: "Comprador planejado" },
    });
    expect(res.status).toBe(200);
    const { lead } = await res.json();
    expect(lead.msg1_enviada_em).toBe("2026-11-17T22:10:30.000Z");
    expect(lead.clicou_comunidade).toBe(true);
    expect(lead.diagnostico.respostas).toHaveLength(9);
    // a 2ª mensagem não apaga quando foi a 1ª
    const de2 = await (await patch("5511999990101", { msg1_enviada_em: true, msg1_status: "lida" })).json();
    expect(de2.lead).toMatchObject({ msg1_enviada_em: "2026-11-17T22:10:30.000Z", msg1_status: "lida" });
  });

  it("tentativa sem resposta → próxima pela cadência do turno (áudio 4 h depois)", async () => {
    const res = await patch("5511999990101", { tentativa: { em: "2026-11-17T19:15:00-03:00", canal: "ligação", resultado: "Não atendeu", notas: "caixa postal" } });
    const { lead } = await res.json();
    expect(lead).toMatchObject({
      status: "em_contato",
      tentativa_1_em: "2026-11-17T22:15:00.000Z",
      resultado_contato: "nao_atendeu",
      etapa_fila: "cadencia",
      // 19h15 + 4 h do turno: 2h45 ter + 1h15 qua → qua 17h15
      prazo_tentativa: "2026-11-18T20:15:00.000Z",
    });
    expect(lead.tentativas[0].notas).toBe("caixa postal");
  });

  it("tentativa 'Agendou' com a data → reunião agendada; depois 'Confirmada'", async () => {
    const a = await (await patch("5511999990101", { tentativa: { canal: "whatsapp", resultado: "Agendou" }, reuniao_em: "2026-11-25T19:00:00-03:00" })).json();
    expect(a.lead).toMatchObject({ status: "agendado", reuniao_status: "agendada", reuniao_em: "2026-11-25T22:00:00.000Z", na_fila: false });
    const c = await (await patch("5511999990101", { reuniao_status: "Confirmada" })).json();
    expect(c.lead.reuniao_status).toBe("confirmada");
  });

  it("transição que a régua não deixa: 409 com o que já foi gravado", async () => {
    const res = await patch("5511999990202", { horario_preferido: "Noite", reuniao_status: "Confirmada" });
    expect(res.status).toBe(409);
    const corpo = await res.json();
    expect(corpo.aplicado).toContain("horario");
    expect(corpo.erro).toContain("Só se confirma reunião agendada");
  });

  it("'Sem resposta' (48 h sem contato válido) pelo status; outro status é recusado", async () => {
    const ok = await (await patch("5511999990202", { status: "Sem resposta" })).json();
    expect(ok.lead).toMatchObject({ status: "sem_resposta", status_atendimento: "sem_resposta" });
    expect((await patch("5511999990303", { status: "Encerrado" })).status).toBe(422);
  });

  it("lead que não existe: 404; GET devolve a ficha", async () => {
    expect((await get("5511988887777")).status).toBe(404);
    const f = await (await get("5511999990404")).json();
    expect(f.lead.classe).toBe("X");
  });

  it("os testes saem por exclusão reversível (nunca DELETE)", async () => {
    const meus = (await r.store.listLeads("consorcio")).filter((l) => l.name.startsWith("Teste "));
    for (const l of meus) await r.store.softDeleteLead(l.id, { at: AGORA.toISOString(), by: "teste", reason: "lead de teste" });
    expect((await r.store.listLeads("consorcio")).filter((l) => l.name.startsWith("Teste "))).toHaveLength(0);
    expect((await r.store.listDeletedLeads("consorcio")).filter((l) => l.name.startsWith("Teste "))).toHaveLength(meus.length);
  });
});
