/**
 * Depois da inscrição na live — `/api/track` de ponta a ponta com os tipos novos
 * (`comunidade` e `diagnostico`), sobre um JSON local temporário (nunca um banco
 * de verdade). O relógio é o do teste: a hora gravada é a da CHEGADA ao servidor.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `after` do Next só existe dentro de uma requisição (o /api/track usa no lead novo).
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => {},
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "depois-inscricao-"));
const envAntes = { ...process.env };

type Rotas = {
  track: typeof import("@/app/api/track/route");
  store: typeof import("@/lib/data/store");
};
let r: Rotas;

beforeAll(async () => {
  vi.useFakeTimers({ now: new Date("2026-11-20T22:00:00.000Z"), toFake: ["Date"] });
  process.env.LOCAL_DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_URL;
  delete process.env.TRACK_INGEST_KEY;
  delete process.env.META_DATASET_ID;
  delete process.env.N8N_LEAD_WEBHOOK_URL;
  vi.resetModules();
  r = { track: await import("@/app/api/track/route"), store: await import("@/lib/data/store") };
}, 60_000);

afterAll(() => {
  vi.useRealTimers();
  process.env = envAntes;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  delete process.env.TRACK_INGEST_KEY;
});

const enviar = (body: unknown, cru?: string) =>
  r.track.POST(
    new Request("http://localhost/api/track", {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8", origin: "https://diagnostico.exemplo" },
      body: cru ?? JSON.stringify(body),
    }),
  );
const em = (iso: string) => vi.setSystemTime(new Date(iso));

const resposta = (n: number, extra: Record<string, unknown> = {}) => ({ n, pergunta: `Pergunta ${n}`, resposta: `Resposta ${n}`, ...extra });
const diag = (over: Record<string, unknown>) => ({
  type: "diagnostico",
  tentativa: "t-maria",
  etapa: "resposta",
  phone: "5511987650001",
  respondidas: 1,
  total: 9,
  respostas: [resposta(1)],
  pageUrl: "https://diagnostico.exemplo/",
  ...over,
});

describe("os tipos de antes continuam iguais", () => {
  it("page_view e cta_click: 204; lead: { ok, leadId } e o eventId fica no histórico da entrada", async () => {
    em("2026-11-20T21:00:00.000Z");
    expect((await enviar({ type: "page_view" })).status).toBe(204);
    expect((await enviar({ type: "cta_click", label: "Quero" })).status).toBe(204);
    const res = await enviar({ type: "lead", eventId: "base01", name: "Base", phone: "11 98765-0000", bem: "Imóvel" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, leadId: "LEAD-LP-base01" });
    const [criado] = await r.store.listLeadEvents({ leadId: "LEAD-LP-base01", action: "created" });
    expect(criado.payload).toMatchObject({ eventId: "base01" });
    expect((await enviar({ type: "outro" })).status).toBe(400);
  });

  it("a mesma ingestKey vale para os tipos novos: chave errada = 401, nada gravado", async () => {
    process.env.TRACK_INGEST_KEY = "chave-certa";
    const res = await enviar({ ...diag({ tentativa: "t-sem-chave" }), ingestKey: "errada" });
    expect(res.status).toBe(401);
    expect((await enviar({ type: "comunidade", eventId: "base01", ingestKey: "errada" })).status).toBe(401);
    expect((await r.store.listDiagnosticos()).find((t) => t.tentativa === "t-sem-chave")).toBeUndefined();
    expect((await enviar({ ...diag({ tentativa: "t-com-chave", phone: "5511900009999" }), ingestKey: "chave-certa" })).status).toBe(204);
  });
});

describe("comunidade: o 1º clique, ligado ao lead pelo eventId", () => {
  it("lead novo: o clique vira comunidadeEm (o fato da ficha) e fica no histórico", async () => {
    em("2026-11-20T22:00:00.000Z");
    await enviar({ type: "lead", eventId: "k3x9qa", name: "Maria Teste", phone: "5511987650001", bem: "Imóvel", valor: "R$300 mil a R$500 mil" });
    em("2026-11-20T22:01:30.000Z");
    expect((await enviar({ type: "comunidade", eventId: "k3x9qa", pageUrl: "https://lp.exemplo/obrigado.html" })).status).toBe(204);
    em("2026-11-20T22:05:00.000Z");
    expect((await enviar({ type: "comunidade", eventId: "k3x9qa" })).status).toBe(204);

    const l = await r.store.getLead("LEAD-LP-k3x9qa");
    expect(l?.comunidadeEm).toBe("2026-11-20T22:01:30.000Z"); // o 1º clique
    expect(l?.bem).toBe("imovel"); // as respostas do formulário seguem gravadas
    expect(l?.faixaValor).toBe("300k_500k");
    const clique = (await r.store.listCliquesComunidade()).find((c) => c.eventId === "k3x9qa");
    expect(clique).toMatchObject({ primeiroEm: "2026-11-20T22:01:30.000Z", cliques: 2, leadId: "LEAD-LP-k3x9qa" });
    const fichas = await r.store.listLeadEvents({ leadId: "LEAD-LP-k3x9qa", action: "ficha" });
    expect(fichas.filter((e) => e.payload?.fato === "comunidade")).toHaveLength(1);
    expect(fichas.find((e) => e.payload?.fato === "comunidade")?.actor).toBe("Página de obrigado");
  });

  it("quem já era lead da campanha anterior: o reenvio cai no cadastro antigo, e o clique vai para ele", async () => {
    await r.store.addLead({
      id: "LEAD-LP-antigo01",
      brand: "consorcio",
      createdAt: "2026-10-01T15:00:00.000Z",
      name: "João Antigo",
      phone: "5511987650002",
      status: "em_contato",
    });
    em("2026-11-20T22:10:00.000Z");
    const res = await enviar({ type: "lead", eventId: "z9z9z9", name: "João Antigo", phone: "11 98765-0002", bem: "Imóvel" });
    expect((await res.json()).leadId).toBe("LEAD-LP-antigo01");
    em("2026-11-20T22:11:00.000Z");
    await enviar({ type: "comunidade", eventId: "z9z9z9" });
    const l = await r.store.getLead("LEAD-LP-antigo01");
    expect(l?.comunidadeEm).toBe("2026-11-20T22:11:00.000Z");
    expect(l?.status).toBe("em_contato"); // nada além do clique mudou
    expect(l?.createdAt).toBe("2026-10-01T15:00:00.000Z");
  });

  it("clique sem lead (ainda): guardado, 204, nada se perde", async () => {
    em("2026-11-20T22:12:00.000Z");
    expect((await enviar({ type: "comunidade", eventId: "semlead" })).status).toBe(204);
    const c = (await r.store.listCliquesComunidade()).find((x) => x.eventId === "semlead");
    expect(c).toMatchObject({ cliques: 1 });
    expect(c?.leadId).toBeUndefined();
  });

  it("sem eventId: 400 e nada gravado", async () => {
    const antes = (await r.store.listCliquesComunidade()).length;
    const res = await enviar({ type: "comunidade" });
    expect(res.status).toBe(400);
    expect((await res.json()).erros).toEqual(["eventId: obrigatório (texto)."]);
    expect((await r.store.listCliquesComunidade()).length).toBe(antes);
  });
});

describe("diagnóstico: o último evento da tentativa vale", () => {
  it("inicio → respostas (com volta) → resultado: uma linha, o estado do último, e o resultado na ficha", async () => {
    em("2026-11-20T22:20:00.000Z");
    expect((await enviar(diag({ etapa: "inicio", respondidas: 0, respostas: [] }))).status).toBe(204);
    em("2026-11-20T22:21:00.000Z");
    await enviar(diag({ respondidas: 2, respostas: [resposta(1), resposta(2)] }));
    em("2026-11-20T22:22:00.000Z");
    // voltou e mudou a 1
    await enviar(diag({ respondidas: 2, respostas: [resposta(1, { resposta: "Mudei" }), resposta(2)] }));

    let t = (await r.store.listDiagnosticos()).find((x) => x.tentativa === "t-maria")!;
    expect(t).toMatchObject({ etapa: "resposta", respondidas: 2, eventos: 3, iniciadoEm: "2026-11-20T22:20:00.000Z" });
    expect(t.respostas[0].resposta).toBe("Mudei");
    expect(t.concluidoEm).toBeUndefined();

    const nove = Array.from({ length: 9 }, (_, i) => resposta(i + 1, i >= 5 && i <= 7 ? { acertou: i !== 6 } : {}));
    em("2026-11-20T22:30:00.000Z");
    await enviar(
      diag({
        etapa: "resultado",
        respondidas: 9,
        respostas: nove,
        perfil: "Construtor de patrimônio",
        notas: { reserva: 85, lance: 40, conhecimento: 65, plano: 30 },
        conquistas: 7,
        conquistas_total: 12,
      }),
    );
    t = (await r.store.listDiagnosticos({ chaveTelefone: "1187650001" }))[0];
    expect(t).toMatchObject({ etapa: "resultado", concluidoEm: "2026-11-20T22:30:00.000Z", perfil: "Construtor de patrimônio", conquistas: 7 });
    expect(t.respostas.filter((x) => x.acertou === false).map((x) => x.n)).toEqual([7]);

    // a ficha do lead (o formato do n8n), para o painel da live e a véspera
    const l = await r.store.getLead("LEAD-LP-k3x9qa");
    expect(l?.diagnostico).toMatchObject({ origem: "pagina", perfil: "Construtor de patrimônio", feitoEm: "2026-11-20T22:30:00.000Z" });
    expect(l?.diagnostico?.notas).toEqual({ reserva: 85, lance: 40, conhecimento: 65, plano: 30 });
    const fichas = await r.store.listLeadEvents({ leadId: "LEAD-LP-k3x9qa", action: "ficha" });
    expect(fichas.find((e) => e.payload?.fato === "diagnostico")?.actor).toBe("Página do diagnóstico");
  });

  it("evento inválido: 400 com o campo que errou e NADA gravado (nem a tentativa nova)", async () => {
    const casos = [
      diag({ tentativa: "t-ruim", etapa: "fim" }),
      diag({ tentativa: "t-ruim", respondidas: 10 }),
      diag({ tentativa: "t-ruim", respostas: Array.from({ length: 10 }, (_, i) => resposta((i % 9) + 1)) }),
      diag({ tentativa: "t-ruim", respostas: [{ n: 1, pergunta: "P", resposta: "x".repeat(201) }] }),
      diag({ tentativa: "t-ruim", etapa: "resultado", notas: { reserva: 101 } }),
    ];
    for (const c of casos) {
      const res = await enviar(c);
      expect(res.status).toBe(400);
      expect((await res.json()).erros.length).toBeGreaterThan(0);
    }
    expect((await r.store.listDiagnosticos()).find((t) => t.tentativa === "t-ruim")).toBeUndefined();
    // um evento inválido de uma tentativa que EXISTE não muda nada nela
    const antes = (await r.store.listDiagnosticos()).find((t) => t.tentativa === "t-maria");
    expect((await enviar(diag({ etapa: "inicio", respondidas: 99 }))).status).toBe(400);
    expect((await r.store.listDiagnosticos()).find((t) => t.tentativa === "t-maria")).toEqual(antes);
    // JSON que não é objeto, corpo gigante
    expect((await enviar(null, "null")).status).toBe(400);
    expect((await enviar(null, JSON.stringify(diag({ lixo: "x".repeat(20_000) })))).status).toBe(413);
  });

  it("diagnóstico de um número sem lead: gravado (vai para 'Diagnóstico sem inscrição')", async () => {
    em("2026-11-20T23:00:00.000Z");
    expect((await enviar(diag({ tentativa: "t-sem-lead", phone: "(21) 99999-1234", etapa: "inicio", respondidas: 0, respostas: [] }))).status).toBe(204);
    const t = (await r.store.listDiagnosticos()).find((x) => x.tentativa === "t-sem-lead");
    expect(t).toMatchObject({ telefone: "21999991234", chaveTelefone: "2199991234" });
  });

  it("o diagnóstico que o n8n gravou na ficha não é apagado pela página", async () => {
    await r.store.addLead({ id: "LEAD-LP-n8n01", brand: "consorcio", createdAt: "2026-11-19T15:00:00.000Z", name: "Do n8n", phone: "5511987650003", status: "lead", bem: "imovel" });
    await r.store.updateLeadFicha("LEAD-LP-n8n01", { diagnostico: { respostas: [{ resposta: "x" }], perfil: "Do n8n", alertas: ["reserva"] } });
    em("2026-11-20T23:10:00.000Z");
    await enviar(diag({ tentativa: "t-n8n", phone: "5511987650003", etapa: "resultado", respondidas: 9, perfil: "Da página" }));
    const l = await r.store.getLead("LEAD-LP-n8n01");
    expect(l?.diagnostico).toMatchObject({ perfil: "Do n8n", alertas: ["reserva"] });
    expect(l?.diagnostico?.origem).toBeUndefined();
  });
});
