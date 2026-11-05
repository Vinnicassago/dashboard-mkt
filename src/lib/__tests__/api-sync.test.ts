/**
 * Fase 1 (nov/26), etapa A — a rota do cron `/api/sync` (11.9): fonte
 * desconhecida é 400 (nunca "all", que bateria na Meta a cada 15 min);
 * `source=robo` roda SÓ o robô e grava `roboUltimoCron`; o "all" inclui o robô
 * sem gravar `roboUltimoCron`. O "Sincronizar agora" segue a mesma regra, e "só
 * o robô" com ele desligado não é erro. Sync da Meta, do robô e store dublados.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const d = vi.hoisted(() => ({
  runSync: vi.fn(async () => ({ ranAt: "2026-11-04T15:00:00.000Z", skipped: [] as string[] })),
  incluirRoboNoRelatorio: vi.fn(async (report: { robo?: unknown }) => {
    report.robo = { ok: true, detail: "1 lidas" };
    return { ok: true, origem: "cron" };
  }),
  setState: vi.fn(async () => {}),
}));

vi.mock("@/lib/meta/sync", () => ({ runSync: d.runSync }));
vi.mock("@/lib/robo/sync", () => ({ incluirRoboNoRelatorio: d.incluirRoboNoRelatorio }));
vi.mock("@/lib/data/store", () => ({ setState: d.setState }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { GET } from "@/app/api/sync/route";

const envAntes = { ...process.env };
beforeAll(() => {
  delete process.env.CRON_SECRET; // fora de produção, sem segredo, a rota abre
});
afterAll(() => {
  process.env = envAntes;
});
beforeEach(() => vi.clearAllMocks());

const chamar = (qs: string) => GET(new Request(`http://localhost/api/sync${qs}`));
const gravouCron = () => d.setState.mock.calls.some((c) => (c as unknown[])[0] === "robo_ultimo_cron");

describe("/api/sync — a fonte pedida", () => {
  it("fonte desconhecida = 400 com frase humana, e nada roda", async () => {
    for (const qs of ["?source=robô", "?source=tudo", "?source=ROBO"]) {
      const res = await chamar(qs);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/Fonte de sincronização desconhecida/);
    }
    expect(d.runSync).not.toHaveBeenCalled();
    expect(d.incluirRoboNoRelatorio).not.toHaveBeenCalled();
  });

  it("source=robo roda SÓ o robô (origem cron) e grava a última execução do cron", async () => {
    const res = await chamar("?source=robo");
    expect(res.status).toBe(200);
    expect(d.runSync).not.toHaveBeenCalled();
    expect(d.incluirRoboNoRelatorio).toHaveBeenCalledWith(expect.anything(), "cron");
    expect(gravouCron()).toBe(true);
    expect((await res.json()).robo).toEqual({ ok: true, detail: "1 lidas" });
  });

  it("sem fonte = all: Meta e Instagram e o robô, sem gravar a execução do cron do robô", async () => {
    for (const qs of ["", "?source=all"]) {
      vi.clearAllMocks();
      const res = await chamar(qs);
      expect(res.status).toBe(200);
      expect(d.runSync).toHaveBeenCalledWith(expect.objectContaining({ source: "all" }));
      expect(d.incluirRoboNoRelatorio).toHaveBeenCalledTimes(1);
      expect(gravouCron()).toBe(false);
    }
  });

  it("ads / instagram não leem o robô; all de outra marca também não", async () => {
    await chamar("?source=ads");
    await chamar("?source=instagram");
    await chamar("?source=all&brand=krone");
    expect(d.runSync).toHaveBeenCalledTimes(3);
    expect(d.incluirRoboNoRelatorio).not.toHaveBeenCalled();
  });
});

describe("Sincronizar agora (Integrações) — a mesma regra da rota", () => {
  it("'Só o robô' com o robô desligado não é erro; fonte desconhecida é, e nada roda", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth/guard", () => ({ can: vi.fn(async () => true), deny: vi.fn(async () => null) }));
    const desligado = vi.fn(async (report: { skipped: string[] }) => {
      report.skipped.push("robô (desligado)");
      return { ok: true, origem: "manual", desligado: true };
    });
    vi.doMock("@/lib/robo/sync", () => ({ incluirRoboNoRelatorio: desligado }));
    const { syncNowAction } = await import("@/app/(dashboard)/configuracoes/actions");
    const pedido = (source: string) => {
      const f = new FormData();
      f.set("source", source);
      return f;
    };

    expect(await syncNowAction(null, pedido("robo"))).toEqual({ ok: true, message: "Robô desligado — nada para ler." });
    expect(desligado).toHaveBeenCalledWith(expect.anything(), "manual");
    expect(d.runSync).not.toHaveBeenCalled();

    desligado.mockClear();
    const r = await syncNowAction(null, pedido("robô"));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Fonte de sincronização desconhecida/);
    expect(desligado).not.toHaveBeenCalled();
    expect(d.runSync).not.toHaveBeenCalled();
  });
});
