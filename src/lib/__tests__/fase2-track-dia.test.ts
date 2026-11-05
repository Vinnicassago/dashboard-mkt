/**
 * Fase 2 (nov/26), item 2.8 — `/api/track` grava o `lp_daily` no dia de
 * Brasília (o mesmo calendário do lead). A rota de verdade, sobre um JSON local
 * temporário que some no fim; só o relógio (`Date`) é simulado.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// `after` do Next só existe dentro de uma requisição; aqui não há o que adiantar.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => {},
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "track-dia-"));
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

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  process.env = envAntes;
  fs.rmSync(dir, { recursive: true, force: true });
});

const visitasNoDia = async (dia: string) =>
  (await store.getData()).lpDaily.filter((r) => r.date === dia).reduce((s, r) => s + r.visits, 0);

describe("/api/track: visita às 22h de Brasília é do dia em Brasília", () => {
  it("page_view em 06/11 01:00 UTC (05/11 22:00 em Brasília) conta no dia 05", async () => {
    const antes05 = await visitasNoDia("2026-11-05");
    const antes06 = await visitasNoDia("2026-11-06");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T01:00:00.000Z"));
    const res = await track.POST(
      new Request("http://localhost/api/track", { method: "POST", body: JSON.stringify({ type: "page_view" }) }),
    );
    expect(res.status).toBe(204);
    vi.useRealTimers();
    expect(await visitasNoDia("2026-11-05")).toBe(antes05 + 1);
    expect(await visitasNoDia("2026-11-06")).toBe(antes06);
  });
});
