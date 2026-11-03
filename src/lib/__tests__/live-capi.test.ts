/**
 * Live 01/12 — E2-19: a CAPI manda "Lead qualificado" (classe A ou B) e "Entrou
 * na comunidade", além do Lead de sempre. Só o painel sabe a classe, então os
 * dois saem só pelo servidor, pela caixa de saída (o mesmo fato entra uma vez).
 * A parte pura e o caminho de verdade (página → /api/track → ficha → fila da
 * CAPI) sobre um JSON local temporário, com a Graph API dublada.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "../types";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => {},
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-capi-"));
const envAntes = { ...process.env };

type Mods = {
  track: typeof import("@/app/api/track/route");
  store: typeof import("@/lib/data/store");
  ficha: typeof import("@/lib/leads/gravar-ficha");
};
let m: Mods;

/** O que chegou à Graph API: um evento por chamada. */
const postados: Record<string, unknown>[] = [];

beforeAll(async () => {
  process.env.LOCAL_DATA_DIR = dir;
  process.env.META_DATASET_ID = "9876543210";
  process.env.META_CAPI_TOKEN = "TOKEN-DE-TESTE";
  process.env.META_CAPI_TEST_EVENT_CODE = "";
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_URL;
  delete process.env.TRACK_INGEST_KEY;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const corpo = JSON.parse(String(init?.body ?? "{}")) as { data?: Record<string, unknown>[] };
      postados.push(...(corpo.data ?? []));
      return new Response(JSON.stringify({ events_received: 1, fbtrace_id: "T" }), { status: 200 });
    }),
  );
  vi.resetModules();
  m = {
    track: await import("@/app/api/track/route"),
    store: await import("@/lib/data/store"),
    ficha: await import("@/lib/leads/gravar-ficha"),
  };
}, 60_000);

afterAll(() => {
  vi.unstubAllGlobals();
  process.env = envAntes;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  postados.length = 0;
  vi.spyOn(console, "info").mockImplementation(() => {});
});

const base = (extra: Partial<Lead> = {}): Lead => ({
  id: "LEAD-X",
  brand: "consorcio",
  createdAt: "2026-11-17T22:00:00.000Z",
  name: "Pessoa Teste",
  status: "lead",
  ...extra,
});

describe("E2-19 — quando cada evento sai (puro)", () => {
  it("vira A ou B pela 1ª vez → LeadQualificado; já qualificado, nada", async () => {
    const { eventosDaFicha } = m.ficha;
    expect(eventosDaFicha(base(), base({ classe: "A" }))).toEqual(["LeadQualificado"]);
    expect(eventosDaFicha(base({ classe: "C" }), base({ classe: "B" }))).toEqual(["LeadQualificado"]);
    expect(eventosDaFicha(base({ classe: "A" }), base({ classe: "B" }))).toEqual([]);
    expect(eventosDaFicha(base(), base({ classe: "C" }))).toEqual([]);
    // Sem a do painel, vale a do n8n (`classeDoLead`).
    expect(eventosDaFicha(base(), base({ classeN8n: "A" }))).toEqual(["LeadQualificado"]);
  });

  it("clicou na comunidade → EntrouNaComunidade, uma vez", async () => {
    const { eventosDaFicha } = m.ficha;
    const clicou = "2026-11-17T22:30:00.000Z";
    expect(eventosDaFicha(base(), base({ comunidadeEm: clicou }))).toEqual(["EntrouNaComunidade"]);
    expect(eventosDaFicha(base({ comunidadeEm: clicou }), base({ comunidadeEm: clicou }))).toEqual([]);
  });
});

const enviar = async (corpo: Record<string, unknown>) => {
  const res = await m.track.POST(
    new Request("http://localhost/api/track", { method: "POST", body: JSON.stringify({ type: "lead", ...corpo }) }),
  );
  return ((await res.json()) as { leadId: string }).leadId;
};

const respostasA = {
  bem: "Imóvel",
  valor: "R$500 mil a R$1 milhão",
  finalidade: "Morar",
  parcela: "R$3.000 a R$6.000",
  prazo: "De 1 a 3 anos",
  aceite_mensagens: true,
};

describe("E2-19 — de ponta a ponta: página → painel → CAPI", () => {
  it("inscrição A pela página: Lead (o id do Pixel) e LeadQualificado com a classe, e-mail e telefone em hash", async () => {
    const leadId = await enviar({
      eventId: "evt-capi-a",
      name: "Pessoa Qualificada",
      email: "qualificada@exemplo.test",
      phone: "11 97777-0101",
      ...respostasA,
    });
    const envios = await m.store.listCapiEnvios({ leadId });
    expect(envios.map((e) => e.id).sort()).toEqual([`LeadQualificado:qualificado-${leadId}`, "Lead:evt-capi-a"].sort());
    expect(envios.every((e) => e.status === "enviado")).toBe(true);

    const q = postados.find((e) => e.event_name === "LeadQualificado")!;
    expect(q).toMatchObject({
      event_id: `qualificado-${leadId}`,
      action_source: "system_generated",
      custom_data: { content_name: "Lead qualificado", classe: "A" },
    });
    const user = q.user_data as Record<string, unknown>;
    expect(user.em).toHaveLength(1);
    expect(user.ph).toHaveLength(1);
    expect(user.external_id).toBeDefined();
  });

  it("classe C não manda LeadQualificado; virar A depois manda — e voltar a A de novo não manda outro", async () => {
    const leadId = await enviar({
      eventId: "evt-capi-c",
      name: "Pessoa C",
      phone: "11 97777-0102",
      ...respostasA,
      valor: "Até R$50 mil",
    });
    expect((await m.store.getLead(leadId))?.classe).toBe("C");
    expect(postados.some((e) => e.event_name === "LeadQualificado")).toBe(false);

    const lead = (await m.store.getLead(leadId))!;
    await m.ficha.gravarFicha(lead, { faixaValor: "500k_1m", classe: "A" }, "teste");
    expect(postados.filter((e) => e.event_name === "LeadQualificado")).toHaveLength(1);

    await m.ficha.gravarFicha((await m.store.getLead(leadId))!, { classe: "C" }, "teste");
    await m.ficha.gravarFicha((await m.store.getLead(leadId))!, { classe: "A" }, "teste");
    expect(postados.filter((e) => e.event_name === "LeadQualificado")).toHaveLength(1);
    const ids = (await m.store.listCapiEnvios({ leadId })).map((e) => e.id);
    expect(ids.filter((id) => id.startsWith("LeadQualificado:"))).toHaveLength(1);
  });

  it("o n8n grava o clique na comunidade: EntrouNaComunidade com a hora do clique, uma vez", async () => {
    const leadId = await enviar({ eventId: "evt-capi-com", name: "Pessoa Comunidade", phone: "11 97777-0103" });
    // Relativo ao relógio: o fato precisa estar dentro das 48 h em que a caixa de saída posta.
    const clicou = new Date(Math.floor((Date.now() - 30 * 60_000) / 1000) * 1000).toISOString();
    await m.ficha.gravarFicha((await m.store.getLead(leadId))!, { comunidadeEm: clicou }, "n8n");
    await m.ficha.gravarFicha((await m.store.getLead(leadId))!, { comunidadeEm: clicou }, "n8n");
    const com = postados.filter((e) => e.event_name === "EntrouNaComunidade");
    expect(com).toHaveLength(1);
    expect(com[0]).toMatchObject({
      event_id: `comunidade-${leadId}`,
      event_time: Math.floor(Date.parse(clicou) / 1000),
      custom_data: { content_name: "Entrou na comunidade" },
    });
  });
});
