/**
 * Avisos de lead novo por Web Push (nov/26). O texto do aviso (LGPD: só o primeiro
 * nome), a inscrição que o navegador manda (só serviços de push conhecidos — o
 * servidor faz POST no endpoint), o envio (404/410 apagam a inscrição; 403 e 5xx,
 * não) e o disparo de ponta a ponta: as rotas de verdade (`/api/track`, a API do
 * n8n e `/api/push/inscricao`) sobre um JSON local temporário. Só o `web-push` (a
 * rede) e a sessão são dublês; o `after` do Next roda na mão, depois da resposta.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aparelhoDoUserAgent,
  avisoDoLead,
  inscricaoMorta,
  lerInscricao,
  primeiroNome,
  type AvisoPush,
} from "@/lib/push/aviso";
import { estadoDosAvisosPush } from "@/lib/configuracoes";

// ---------------------------------------------------------------- dublês

const h = vi.hoisted(() => ({
  /** O que o `after` do Next recebeu (roda com `rodarDepois`). */
  depois: [] as Array<() => unknown>,
  /** Status que o serviço de push devolve por endpoint (sem entrada = 201). */
  respostas: new Map<string, number>(),
  enviados: [] as Array<{ endpoint: string; aviso: AvisoPush; opcoes: Record<string, unknown> }>,
  usuario: null as { username: string; role: string } | null,
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    h.depois.push(fn);
  },
}));

vi.mock("web-push", () => {
  class WebPushError extends Error {
    constructor(
      message: string,
      public statusCode: number,
    ) {
      super(message);
    }
  }
  const sendNotification = async (sub: { endpoint: string }, payload: string, opcoes: Record<string, unknown>) => {
    const status = h.respostas.get(sub.endpoint) ?? 201;
    if (status >= 400) throw new WebPushError(`Received unexpected response code\nbody`, status);
    h.enviados.push({ endpoint: sub.endpoint, aviso: JSON.parse(payload) as AvisoPush, opcoes });
    return { statusCode: status, body: "", headers: {} };
  };
  return { default: { sendNotification, WebPushError }, sendNotification, WebPushError };
});

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => h.usuario }));

const rodarDepois = async () => {
  const fila = h.depois.splice(0);
  for (const fn of fila) await fn();
};

// ---------------------------------------------------------------- o texto do aviso

const LEAD = {
  id: "LEAD-LP-abc123",
  name: "Maria Aparecida da Silva",
  phone: "11 98888-7777",
  email: "maria@exemplo.test",
  createdAt: "2026-11-18T13:00:00.000Z",
};

describe("avisoDoLead: o que aparece na tela bloqueada", () => {
  it("só o primeiro nome; nunca telefone nem e-mail; o link é a ficha", () => {
    const a = avisoDoLead(LEAD, "lead_novo", { robo: false });
    expect(a).toEqual({
      titulo: "Lead novo: Maria",
      corpo: "Toque para abrir a ficha",
      url: "/leads/LEAD-LP-abc123",
      tag: "lead:LEAD-LP-abc123",
    });
    const json = JSON.stringify(a);
    expect(json).not.toContain("98888");
    expect(json).not.toContain("maria@");
    expect(json).not.toContain("Silva");
  });

  it("classe, live e robô no corpo; o robô só para quem não é da live, sem classe e com telefone", () => {
    expect(avisoDoLead({ ...LEAD, classe: "A", inscritoLiveEm: LEAD.createdAt }, "lead_novo", { robo: true }).corpo).toBe(
      "Classe A · inscrição na live",
    );
    expect(avisoDoLead({ ...LEAD, classeN8n: "B" }, "lead_novo", { robo: true }).corpo).toBe("Classe B");
    expect(avisoDoLead(LEAD, "lead_novo", { robo: true }).corpo).toBe("O robô faz a 1ª mensagem");
    expect(avisoDoLead({ ...LEAD, phone: undefined }, "lead_novo", { robo: true }).corpo).toBe("Toque para abrir a ficha");
  });

  it("lead que voltou; sem nome não inventa nome", () => {
    const a = avisoDoLead({ ...LEAD, name: "Lead sem nome" }, "lead_voltou", { robo: false });
    expect(a.titulo).toBe("Lead voltou");
    expect(a.corpo).toBe("Estava perdido e se inscreveu de novo");
    expect(primeiroNome("  ")).toBeNull();
  });

  it("id que carrega o WhatsApp (lead do n8n sem event_id): vai para a Fila, sem o número na URL nem na tag", () => {
    const a = avisoDoLead({ ...LEAD, id: "LEAD-WA-5511988887777" }, "lead_novo", { robo: false });
    expect(a.url).toBe("/fila");
    expect(a.tag).toBe(`lead:${LEAD.createdAt}`);
  });
});

describe("lerInscricao: só serviço de push conhecido (o servidor faz POST no endpoint)", () => {
  const chaves = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/QGx1",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ])("aceita %s", (endpoint) => {
    expect(lerInscricao({ endpoint, keys: chaves })).toEqual({ ok: true, valor: { endpoint, ...chaves } });
  });

  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com.evil.test/x",
    "https://localhost/x",
    "https://10.0.0.1/x",
    "https://fcm.googleapis.com:8443/x",
    "https://user:senha@fcm.googleapis.com/x",
    "não é url",
  ])("recusa %s", (endpoint) => {
    expect(lerInscricao({ endpoint, keys: chaves }).ok).toBe(false);
  });

  it("recusa chave que não é base64url, ou sem chaves", () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    expect(lerInscricao({ endpoint, keys: { p256dh: "<script>", auth: chaves.auth } }).ok).toBe(false);
    expect(lerInscricao({ endpoint }).ok).toBe(false);
    expect(lerInscricao(null).ok).toBe(false);
  });
});

describe("aparelho e resposta do serviço", () => {
  it("rótulo curto do aparelho, nunca o user-agent inteiro", () => {
    expect(
      aparelhoDoUserAgent(
        "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Chrome · Android");
    expect(
      aparelhoDoUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
      ),
    ).toBe("Edge · Windows");
    expect(
      aparelhoDoUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari · iPhone/iPad");
    expect(aparelhoDoUserAgent(null)).toBeNull();
  });

  it("só 404 e 410 apagam a inscrição (403 costuma ser a NOSSA chave: apagaria todos)", () => {
    expect([404, 410].map(inscricaoMorta)).toEqual([true, true]);
    expect([400, 403, 413, 429, 500, undefined].map(inscricaoMorta)).toEqual([false, false, false, false, false, false]);
  });
});

describe("estadoDosAvisosPush (Integrações)", () => {
  it("desligado sem chaves; conta os aparelhos; falha com o 403 aponta as chaves", () => {
    expect(estadoDosAvisosPush({ configurado: false, aparelhos: 0, ultimo: null }).estado).toBe("nao-configurado");
    expect(estadoDosAvisosPush({ configurado: true, aparelhos: 0, ultimo: null })).toMatchObject({
      estado: "nunca",
      rotulo: "Nenhum aparelho",
    });
    expect(estadoDosAvisosPush({ configurado: true, aparelhos: 3, ultimo: null }).rotulo).toBe("3 aparelhos ligados");
    const falhou = estadoDosAvisosPush({
      configurado: true,
      aparelhos: 2,
      ultimo: { em: "2026-11-18T13:00:00.000Z", evento: "lead_novo", aparelhos: 2, entregues: 1, removidas: 0, falhas: 1, erro: "403 x" },
    });
    expect(falhou.estado).toBe("falhando");
    expect(falhou.detalhe).toContain("VAPID");
    const saíram = estadoDosAvisosPush({
      configurado: true,
      aparelhos: 1,
      ultimo: { em: "2026-11-18T13:00:00.000Z", evento: "lead_novo", aparelhos: 3, entregues: 1, removidas: 2, falhas: 0 },
    });
    expect(saíram).toMatchObject({ estado: "ativo", rotulo: "1 aparelho ligado" });
    expect(saíram.detalhe).toContain("1 de 3 entregues (2 aparelhos saíram: desligaram no navegador)");
  });
});

// ---------------------------------------------------------------- de ponta a ponta

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "push-avisos-"));
const envAntes = { ...process.env };

type Mods = {
  track: typeof import("@/app/api/track/route");
  n8n: typeof import("@/app/api/n8n/leads/route");
  inscricao: typeof import("@/app/api/push/inscricao/route");
  store: typeof import("@/lib/data/store");
  enviar: typeof import("@/lib/push/enviar");
};
let m: Mods;

beforeAll(async () => {
  process.env.LOCAL_DATA_DIR = dir;
  process.env.N8N_API_TOKEN = "token-n8n";
  // Um par VAPID de verdade não é preciso: o web-push é dublê.
  process.env.VAPID_PUBLIC_KEY = "BPublicaDeTeste";
  process.env.VAPID_PRIVATE_KEY = "privada-de-teste";
  process.env.VAPID_SUBJECT = "https://painel.exemplo";
  for (const k of ["DATABASE_URL", "SUPABASE_URL", "TRACK_INGEST_KEY", "AUTH_SECRET", "N8N_LEAD_WEBHOOK_URL", "ROBO_SUPABASE_URL"]) {
    delete process.env[k];
  }
  vi.resetModules();
  m = {
    track: await import("@/app/api/track/route"),
    n8n: await import("@/app/api/n8n/leads/route"),
    inscricao: await import("@/app/api/push/inscricao/route"),
    store: await import("@/lib/data/store"),
    enviar: await import("@/lib/push/enviar"),
  };
}, 60_000);

afterAll(() => {
  process.env = envAntes;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  h.depois.length = 0;
  h.enviados.length = 0;
  h.respostas.clear();
  h.usuario = null;
  delete process.env.AUTH_SECRET;
  for (const i of await m.store.listInscricoesPush()) await m.store.removerInscricaoPush(i.endpoint);
});

const KEYS = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
const inscricaoDe = (n: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: KEYS });

const pedido = (method: "POST" | "DELETE", corpo: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/push/inscricao", {
    method,
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36", ...headers },
    body: JSON.stringify(corpo),
  });

const ativar = async (n: string, extra: Record<string, unknown> = {}) =>
  m.inscricao.POST(pedido("POST", { inscricao: inscricaoDe(n), ...extra }));

describe("/api/push/inscricao", () => {
  it("de outro site, sem JSON, ou com login ligado e sem sessão: recusado e nada gravado", async () => {
    expect((await m.inscricao.POST(pedido("POST", { inscricao: inscricaoDe("x") }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await m.inscricao.POST(pedido("POST", { inscricao: inscricaoDe("x") }, { "sec-fetch-site": "same-site" }))).status).toBe(403);
    expect((await m.inscricao.POST(pedido("POST", { inscricao: inscricaoDe("x") }, { "content-type": "text/plain" }))).status).toBe(415);
    process.env.AUTH_SECRET = "segredo";
    expect((await ativar("x")).status).toBe(401);
    expect(await m.store.listInscricoesPush()).toEqual([]);
  });

  it("endpoint fora dos serviços de push: 400", async () => {
    const res = await m.inscricao.POST(pedido("POST", { inscricao: { endpoint: "https://169.254.169.254/latest", keys: KEYS } }));
    expect(res.status).toBe(400);
    expect(await m.store.listInscricoesPush()).toEqual([]);
  });

  it("ativar grava com o usuário e o aparelho; `testar` manda o aviso SÓ para este aparelho", async () => {
    process.env.AUTH_SECRET = "segredo";
    h.usuario = { username: "ana", role: "comercial" };
    await ativar("outro");
    const res = await ativar("este", { testar: true });
    expect(await res.json()).toEqual({ ok: true, teste: "entregue" });
    expect(h.enviados.map((e) => e.endpoint)).toEqual([inscricaoDe("este").endpoint]);
    expect(h.enviados[0].aviso.titulo).toBe("Avisos de lead novo ligados");
    const gravada = (await m.store.listInscricoesPush()).find((i) => i.endpoint.endsWith("/este"));
    expect(gravada).toMatchObject({ usuario: "ana", aparelho: "Chrome · Windows", p256dh: KEYS.p256dh });
    // O teste de UM aparelho não é "o último envio" de Integrações.
    expect(await m.store.getState("push_ultimo_envio")).toBeNull();
  });

  it("`anterior` (o navegador trocou a inscrição) sai; DELETE desliga", async () => {
    await ativar("velha");
    await ativar("nova", { anterior: inscricaoDe("velha").endpoint });
    expect((await m.store.listInscricoesPush()).map((i) => i.endpoint)).toEqual([inscricaoDe("nova").endpoint]);
    const res = await m.inscricao.DELETE(pedido("DELETE", { endpoint: inscricaoDe("nova").endpoint }));
    expect(res.status).toBe(200);
    expect(await m.store.listInscricoesPush()).toEqual([]);
  });

  it("sem as chaves VAPID: 503 e nada gravado", async () => {
    const antes = process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    expect((await ativar("x")).status).toBe(503);
    process.env.VAPID_PRIVATE_KEY = antes;
    expect(await m.store.listInscricoesPush()).toEqual([]);
  });
});

describe("enviarAviso: quem recebe e o que sai da lista", () => {
  const aviso: AvisoPush = { titulo: "t", corpo: "c", url: "/fila", tag: "x" };

  it("410 apaga; 500 e 403 ficam; o resumo (só contagens) vai para Integrações", async () => {
    for (const n of ["ok", "sumiu", "fora", "chave"]) await ativar(n);
    h.respostas.set(inscricaoDe("sumiu").endpoint, 410);
    h.respostas.set(inscricaoDe("fora").endpoint, 500);
    h.respostas.set(inscricaoDe("chave").endpoint, 403);
    const r = await m.enviar.enviarAviso(aviso, "lead_novo");
    expect(r).toMatchObject({ aparelhos: 4, entregues: 1, removidas: 1, falhas: 2 });
    expect((await m.store.listInscricoesPush()).map((i) => i.endpoint.split("/").pop()).sort()).toEqual(["chave", "fora", "ok"]);
    const salvo = await m.store.getState<Record<string, unknown>>("push_ultimo_envio");
    expect(salvo).toMatchObject({ evento: "lead_novo", entregues: 1, removidas: 1, falhas: 2 });
    expect(JSON.stringify(salvo)).not.toContain("googleapis");
    // Validade curta e urgência alta: aviso de lead velho não é aviso.
    expect(h.enviados[0].opcoes).toMatchObject({ TTL: 7200, urgency: "high" });
  });

  it("com login: inscrição de usuário que não existe mais não recebe e sai", async () => {
    await m.store.createUser({ username: "ana", passwordHash: "x", role: "comercial", createdAt: "2026-11-01T00:00:00.000Z" });
    process.env.AUTH_SECRET = "segredo";
    h.usuario = { username: "ana", role: "comercial" };
    await ativar("da-ana");
    h.usuario = { username: "saiu", role: "comercial" };
    await ativar("de-quem-saiu");
    await m.enviar.enviarAviso(aviso, "lead_novo");
    expect(h.enviados.map((e) => e.endpoint.split("/").pop())).toEqual(["da-ana"]);
    expect((await m.store.listInscricoesPush()).map((i) => i.usuario)).toEqual(["ana"]);
  });
});

describe("disparo: lead novo avisa todos os aparelhos, uma vez", () => {
  const lp = (corpo: Record<string, unknown>) =>
    m.track.POST(new Request("http://localhost/api/track", { method: "POST", body: JSON.stringify({ type: "lead", ...corpo }) }));

  it("/api/track: o lead novo avisa DEPOIS da resposta; o reenvio do mesmo formulário não avisa", async () => {
    await ativar("a");
    await ativar("b");
    const res = await lp({ eventId: "push-lp-1", name: "Joana Prado", phone: "11 97777-1212", email: "joana@exemplo.test" });
    expect(res.status).toBe(200);
    expect(h.enviados).toEqual([]); // nada antes da resposta
    await rodarDepois();
    const avisos = h.enviados.filter((e) => e.aviso.tag !== "teste");
    expect(avisos.map((e) => e.endpoint.split("/").pop()).sort()).toEqual(["a", "b"]);
    expect(avisos[0].aviso).toMatchObject({ titulo: "Lead novo: Joana", url: "/leads/LEAD-LP-push-lp-1" });
    expect(JSON.stringify(avisos)).not.toContain("97777");

    h.enviados.length = 0;
    await lp({ eventId: "push-lp-1", name: "Joana Prado", phone: "11 97777-1212" });
    await rodarDepois();
    expect(h.enviados).toEqual([]);
  });

  it("API do n8n: a inscrição que cria o lead avisa; a 2ª da mesma pessoa, não", async () => {
    await ativar("a");
    const inscricao = { nome: "Carlos Lima", whatsapp: "11 96666-3434", aceite_mensagens: true };
    const post = () =>
      m.n8n.POST(
        new Request("http://localhost/api/n8n/leads", {
          method: "POST",
          headers: { authorization: "Bearer token-n8n" },
          body: JSON.stringify(inscricao),
        }),
      );
    expect((await post()).status).toBe(201);
    await rodarDepois();
    expect(h.enviados.map((e) => e.aviso.titulo)).toEqual(["Lead novo: Carlos"]);
    expect(h.enviados[0].aviso.corpo).toBe("Inscrição na live");

    h.enviados.length = 0;
    expect((await post()).status).toBe(200);
    await rodarDepois();
    expect(h.enviados).toEqual([]);
  });

  it("sem ninguém com o sino ligado: nada sai e nada quebra", async () => {
    const res = await lp({ eventId: "push-lp-2", name: "Sem Aparelho", phone: "11 95555-0000" });
    expect(res.status).toBe(200);
    await rodarDepois();
    expect(h.enviados).toEqual([]);
  });
});
