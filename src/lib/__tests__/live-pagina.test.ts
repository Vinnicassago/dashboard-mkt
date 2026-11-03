/**
 * Live 01/12 — a página de inscrição manda as 5 respostas direto ao painel
 * (/api/track): o lead entra já classificado, sem depender da API do n8n. A rota
 * de verdade, sobre um JSON local temporário que some no fim.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `after` do Next só existe dentro de uma requisição; aqui não há o que adiantar.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => {},
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-pagina-"));
const envAntes = { ...process.env };

let track: typeof import("@/app/api/track/route");
let store: typeof import("@/lib/data/store");

beforeAll(async () => {
  process.env.LOCAL_DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_URL;
  delete process.env.TRACK_INGEST_KEY;
  vi.resetModules();
  track = await import("@/app/api/track/route");
  store = await import("@/lib/data/store");
}, 60_000);

afterAll(() => {
  process.env = envAntes;
  fs.rmSync(dir, { recursive: true, force: true });
});

const enviar = async (corpo: Record<string, unknown>) => {
  const res = await track.POST(
    new Request("http://localhost/api/track", { method: "POST", body: JSON.stringify({ type: "lead", ...corpo }) }),
  );
  return (await res.json()) as { ok?: boolean; leadId?: string };
};

const classeA = {
  bem: "Imóvel",
  valor: "R$300 mil a R$500 mil",
  finalidade: "Morar",
  parcela: "R$1.500 a R$3.000",
  prazo: "Em até 1 ano",
  aceite_mensagens: true,
};

describe("página de inscrição → painel, com as respostas", () => {
  it("as 5 respostas entram na ficha e o painel classifica na entrada (A), com histórico da página", async () => {
    const { ok, leadId } = await enviar({ eventId: "evt-pagina-a", name: "Teste A", phone: "11 98888-0101", ...classeA });
    expect(ok).toBe(true);
    const lead = await store.getLead(leadId!);
    expect(lead).toMatchObject({
      bem: "imovel",
      faixaValor: "300k_500k",
      finalidade: "morar",
      faixaParcela: "1500_3000",
      prazoCompra: "ate_1_ano",
      aceiteMensagens: true,
      classe: "A",
    });
    expect(lead?.classeN8n).toBeUndefined();
    const eventos = await store.listLeadEvents({ leadId: leadId!, limit: 0 });
    const fichas = eventos.filter((e) => e.action === "ficha");
    expect(fichas.map((e) => e.payload?.fato).sort()).toEqual(["classe", "respostas"]);
    expect(fichas.every((e) => e.actor === "Landing page")).toBe(true);
  });

  it("quitar dívidas vira X mesmo sem as outras respostas", async () => {
    const { leadId } = await enviar({
      eventId: "evt-pagina-x",
      name: "Teste X",
      phone: "11 98888-0102",
      finalidade: "Quitar dívidas ou ter dinheiro na mão",
    });
    expect((await store.getLead(leadId!))?.classe).toBe("X");
  });

  it("classe mandada pela página é ignorada, e resposta fora do vocabulário não derruba o lead", async () => {
    const { ok, leadId } = await enviar({
      eventId: "evt-pagina-torta",
      name: "Teste torto",
      phone: "11 98888-0103",
      ...classeA,
      bem: "Barco",
      classe: "A",
    });
    expect(ok).toBe(true);
    const lead = await store.getLead(leadId!);
    expect(lead?.name).toBe("Teste torto");
    expect(lead?.bem).toBeUndefined();
    expect(lead?.faixaValor).toBe("300k_500k");
    // Sem o bem, não há classe — e a da página não vale como a do n8n.
    expect(lead?.classe).toBeUndefined();
    expect(lead?.classeN8n).toBeUndefined();
  });

  it("o reenvio com resposta vazia não apaga a que estava; resposta nova sobrescreve e reclassifica", async () => {
    const base = { eventId: "evt-pagina-reenvio", name: "Teste reenvio", phone: "11 98888-0104" };
    const { leadId } = await enviar({ ...base, ...classeA });
    await enviar({ ...base, bem: "", valor: "" });
    expect(await store.getLead(leadId!)).toMatchObject({ bem: "imovel", faixaValor: "300k_500k", classe: "A" });
    await enviar({ ...base, prazo: "Preciso agora" });
    expect(await store.getLead(leadId!)).toMatchObject({ prazoCompra: "agora", classe: "B" });
  });

  it("sem respostas (a página de sempre), nada muda: o lead entra sem ficha e sem classe", async () => {
    const { leadId } = await enviar({ eventId: "evt-pagina-antiga", name: "Teste antigo", phone: "11 98888-0105" });
    const lead = await store.getLead(leadId!);
    expect(lead?.classe).toBeUndefined();
    const eventos = await store.listLeadEvents({ leadId: leadId!, limit: 0 });
    expect(eventos.some((e) => e.action === "ficha")).toBe(false);
  });
});
