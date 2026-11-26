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
import { LIVE_PADRAO, ehInscritoDaLive } from "@/lib/live";

// `after` do Next só existe dentro de uma requisição (a página, /api/track, usa no lead novo).
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => {},
}));

const TOKEN = "token-de-teste-n8n";
const AGORA = new Date("2026-11-17T22:20:00.000Z");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-api-"));
const envAntes = { ...process.env };

type Rotas = {
  leads: typeof import("@/app/api/n8n/leads/route");
  lead: typeof import("@/app/api/n8n/leads/[chave]/route");
  pendentes: typeof import("@/app/api/n8n/pendentes/route");
  track: typeof import("@/app/api/track/route");
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
  delete process.env.TRACK_INGEST_KEY;
  vi.resetModules();
  r = {
    leads: await import("@/app/api/n8n/leads/route"),
    lead: await import("@/app/api/n8n/leads/[chave]/route"),
    pendentes: await import("@/app/api/n8n/pendentes/route"),
    track: await import("@/app/api/track/route"),
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

describe("API do n8n — quem já era lead e se inscreve na live", () => {
  /** Um lead da campanha de outubro: entrou pelo link da bio, foi ligado e falou. */
  const leadAntigo = async (id: string, phone: string, extra: Record<string, unknown> = {}) => {
    await r.store.addLead({
      id,
      brand: "consorcio",
      createdAt: "2026-10-27T15:00:00.000Z",
      name: "Teste Antigo",
      phone,
      utmContent: "link_in_bio",
      status: "lead",
      ...extra,
    });
    await r.store.setLeadStatus(id, "em_contato");
    await r.store.addLeadEvent({
      id: `${id}-tentativa-outubro`,
      leadId: id,
      brand: "consorcio",
      leadName: "Teste Antigo",
      actor: "Eduardo",
      action: "tentativa",
      payload: { canal: "ligacao", falou: "sim" },
      createdAt: "2026-10-27T16:00:00.000Z",
      occurredAt: "2026-10-27T16:00:00.000Z",
    });
  };
  const reenvios = async (leadId: string) =>
    (await r.store.listLeadEvents({ leadId, limit: 0 })).filter((e) => e.action === "reenvio");

  it("lead novo: a inscrição na live é a da entrada, e não é reinscrição", async () => {
    const res = await post({ ...inscricaoA, nome: "Teste Novo na live", whatsapp: "11 99999-0707", email: undefined });
    expect(res.status).toBe(201);
    const { lead, criado } = await res.json();
    expect(criado).toBe(true);
    expect(lead).toMatchObject({
      inscrito_em: "2026-11-17T22:10:00.000Z",
      inscrito_live_em: "2026-11-17T22:10:00.000Z",
      reinscricao: false,
    });
  });

  it("lead antigo que se inscreve: passa a contar na live pela inscrição, sem mexer na entrada", async () => {
    await leadAntigo("LEAD-LP-antigo1", "5511999990808");
    const antes = (await r.store.getLead("LEAD-LP-antigo1"))!;
    expect(ehInscritoDaLive(antes, LIVE_PADRAO)).toBe(false);

    const res = await post({ ...inscricaoA, nome: "Teste Antigo", whatsapp: "11 99999-0808", email: undefined, inscrito_em: "2026-11-17T19:00:00-03:00" });
    expect(res.status).toBe(200);
    const { lead, criado } = await res.json();
    expect(criado).toBe(false);
    expect(lead).toMatchObject({
      id: "LEAD-LP-antigo1",
      inscrito_em: "2026-10-27T15:00:00.000Z",
      inscrito_live_em: "2026-11-17T22:00:00.000Z",
      reinscricao: true,
      etapa_fila: "primeira",
      tentativa_1_em: null,
    });
    expect(lead.tentativas).toHaveLength(1); // a de outubro fica no histórico

    const depois = (await r.store.getLead("LEAD-LP-antigo1"))!;
    expect(depois.createdAt).toBe("2026-10-27T15:00:00.000Z");
    expect(depois.utmContent).toBe("link_in_bio");
    expect(ehInscritoDaLive(depois, LIVE_PADRAO)).toBe(true);
    const [reenvio] = await reenvios("LEAD-LP-antigo1");
    expect(reenvio.payload).toMatchObject({ inscricaoLive: "Live 01/12", leadDesde: "2026-10-27T15:00:00.000Z" });

    // Na Fila da live como 1ª tentativa: as tentativas antigas não contam para a cadência.
    const pend = await (await r.pendentes.GET(req("/api/n8n/pendentes"))).json();
    expect(pend.itens.find((i: { id: string }) => i.id === "LEAD-LP-antigo1")).toMatchObject({ etapa_fila: "primeira", tentativas: 0 });
  });

  it("a 2ª inscrição dentro do período não muda a data (vale a 1ª)", async () => {
    const res = await post({ ...inscricaoA, nome: "Teste Antigo", whatsapp: "5511999990808", email: undefined, inscrito_em: "2026-11-17T19:15:00-03:00" });
    const { lead } = await res.json();
    expect(lead).toMatchObject({ inscrito_live_em: "2026-11-17T22:00:00.000Z", reinscricao: true });
    const todos = await reenvios("LEAD-LP-antigo1");
    expect(todos).toHaveLength(2);
    expect(todos.filter((e) => e.payload?.inscricaoLive)).toHaveLength(1); // só a 1ª é "inscreveu-se na live"
  });

  it("a 1ª tentativa da live recomeça a cadência: a de outubro não conta (áudio 4 h depois, não a 3ª)", async () => {
    const res = await patch("5511999990808", { tentativa: { em: "2026-11-17T19:15:00-03:00", canal: "ligação", resultado: "Não atendeu" } });
    const { lead } = await res.json();
    expect(lead).toMatchObject({
      tentativa_1_em: "2026-11-17T22:15:00.000Z",
      tentativa_2_em: null,
      resultado_contato: "nao_atendeu",
      etapa_fila: "cadencia",
      // a 2ª da cadência do turno: 19h15 + 4 h do turno → qua 17h15 (com a de outubro seria a 3ª, 24 h depois)
      prazo_tentativa: "2026-11-18T20:15:00.000Z",
    });
    expect(lead.tentativas).toHaveLength(2);
  });

  it("lead antigo sem inscrição na live continua fora, mesmo com a ficha preenchida pelo comercial", async () => {
    await leadAntigo("LEAD-LP-antigo2", "5511999991010", { classe: "A", bem: "imovel" });
    const l = (await r.store.getLead("LEAD-LP-antigo2"))!;
    expect(l.inscritoLiveEm).toBeUndefined();
    expect(ehInscritoDaLive(l, LIVE_PADRAO)).toBe(false);
  });

  it("dois cadastros antigos do mesmo número (não mesclados): a página e o n8n inscrevem o MESMO", async () => {
    await leadAntigo("LEAD-LP-dup-velho", "5511999991212");
    await r.store.addLead({ id: "LEAD-LP-dup-novo", brand: "consorcio", createdAt: "2026-11-01T15:00:00.000Z", name: "Teste Antigo", phone: "5511999991212", status: "lead" });
    const pagina = await r.track.POST(
      new Request("http://localhost/api/track", {
        method: "POST",
        body: JSON.stringify({ type: "lead", eventId: "evt-dup", name: "Teste Antigo", phone: "11 99999-1212", bem: "Imóvel", prazo: "Em até 1 ano" }),
      }),
    );
    const { leadId } = await pagina.json();
    const n8n = await (await post({ ...inscricaoA, nome: "Teste Antigo", whatsapp: "11 99999-1212", email: undefined })).json();
    expect(n8n.lead.id).toBe(leadId);
    const inscritos = (await r.store.listLeads("consorcio")).filter((l) => l.phone === "5511999991212" && l.inscritoLiveEm);
    expect(inscritos.map((l) => l.id)).toEqual([leadId]);
    // e o GET/PATCH do n8n pelo número acham esse mesmo cadastro
    expect((await (await get("5511999991212")).json()).lead.id).toBe(leadId);
  });

  it("dois cadastros do mesmo número, o n8n antes da página: os dois também ficam no MESMO", async () => {
    await leadAntigo("LEAD-LP-dup2-velho", "5511999991515");
    await r.store.addLead({ id: "LEAD-LP-dup2-novo", brand: "consorcio", createdAt: "2026-11-01T15:00:00.000Z", name: "Teste Antigo", phone: "5511999991515", status: "lead" });
    const n8n = await (await post({ ...inscricaoA, nome: "Teste Antigo", whatsapp: "11 99999-1515", email: undefined })).json();
    // O principal da mesclagem: o que carrega mais história (o de outubro, que foi trabalhado).
    expect(n8n.lead.id).toBe("LEAD-LP-dup2-velho");
    const pagina = await r.track.POST(
      new Request("http://localhost/api/track", {
        method: "POST",
        body: JSON.stringify({ type: "lead", eventId: "evt-dup2", name: "Teste Antigo", phone: "11 99999-1515", bem: "Imóvel", prazo: "Em até 1 ano" }),
      }),
    );
    expect((await pagina.json()).leadId).toBe("LEAD-LP-dup2-velho");
    const inscritos = (await r.store.listLeads("consorcio")).filter((l) => l.phone === "5511999991515" && l.inscritoLiveEm);
    expect(inscritos.map((l) => l.id)).toEqual(["LEAD-LP-dup2-velho"]);
  });

  it("achado pela página só pelo e-mail, com OUTRO número: a pessoa da live é a do número novo (conta uma vez)", async () => {
    await leadAntigo("LEAD-LP-email", "5511999991313", { email: "mesma.pessoa@exemplo.test" });
    await r.track.POST(
      new Request("http://localhost/api/track", {
        method: "POST",
        body: JSON.stringify({ type: "lead", eventId: "evt-email", name: "Teste Antigo", phone: "11 99999-1414", email: "mesma.pessoa@exemplo.test", bem: "Imóvel" }),
      }),
    );
    expect((await r.store.getLead("LEAD-LP-email"))!.inscritoLiveEm).toBeUndefined();
    const n8n = await (await post({ ...inscricaoA, nome: "Teste Antigo", whatsapp: "11 99999-1414", email: "mesma.pessoa@exemplo.test" })).json();
    expect(n8n.criado).toBe(true);
    expect(n8n.lead.inscrito_live_em).toBe("2026-11-17T22:10:00.000Z"); // o inscrito_em do envio
  });

  it("a página manda primeiro e o n8n logo depois: uma reinscrição só, e a mesma data", async () => {
    await leadAntigo("LEAD-LP-antigo3", "5511999990909");
    const res = await r.track.POST(
      new Request("http://localhost/api/track", {
        method: "POST",
        body: JSON.stringify({ type: "lead", eventId: "evt-reinscricao-pagina", name: "Teste Antigo", phone: "11 99999-0909", bem: "Imóvel", valor: "R$300 mil a R$500 mil", finalidade: "Morar", parcela: "R$1.500 a R$3.000", prazo: "Em até 1 ano" }),
      }),
    );
    expect((await res.json()).leadId).toBe("LEAD-LP-antigo3");
    expect((await r.store.getLead("LEAD-LP-antigo3"))!.inscritoLiveEm).toBe(AGORA.toISOString());

    const n8n = await (await post({ ...inscricaoA, nome: "Teste Antigo", whatsapp: "11 99999-0909", email: undefined })).json();
    expect(n8n.lead).toMatchObject({ inscrito_live_em: AGORA.toISOString(), reinscricao: true });
    const todos = await reenvios("LEAD-LP-antigo3");
    expect(todos).toHaveLength(1); // a do n8n é a mesma inscrição: não vira um 2º reenvio
    expect(todos[0]).toMatchObject({ actor: "Landing page", payload: { inscricaoLive: "Live 01/12" } });
  });
});

describe("API do n8n — lista para disparo (GET)", () => {
  it("sem token: 401; com token: a lista da marca com o WhatsApp normalizado", async () => {
    expect((await r.leads.GET(req("/api/n8n/leads", { token: null }))).status).toBe(401);
    await post({ ...inscricaoA, whatsapp: "11 98765-4321", nome: "Lista Disparo" });
    const res = await r.leads.GET(req("/api/n8n/leads"));
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.ok).toBe(true);
    expect(corpo.total).toBe(corpo.leads.length);
    const l = corpo.leads.find((x: { whatsapp: string }) => x.whatsapp === "5511987654321");
    expect(l).toMatchObject({ nome: "Lista Disparo", status: "lead" });
    expect(l.inscrito_live_em).toBeTruthy();
    expect(Object.keys(l).sort()).toEqual(
      ["criado_em", "id", "inscrito_live_em", "nome", "opt_out_em", "status", "whatsapp"],
    );
  });
});
