/**
 * Fase 3 (§8.5 da spec, K22) — o carregador do Funil (`carregarFunil`) de verdade,
 * sobre um JSON local TEMPORÁRIO (o seed, que some no fim; nunca o `.localdata`),
 * com a credencial do robô definida (o robô ligado na marca padrão) e o
 * `@supabase/supabase-js` dublado para LANÇAR: se qualquer caminho do Funil tocar o
 * banco do robô, o teste cai. Só o relógio (`Date`) é simulado.
 *
 * O seed só tem leads de julho — com eles a consorcio cairia no período todo
 * anterior ao robô, sem o trecho dele. Por isso o teste grava pelo store um lead
 * de 05/11 em cada marca, com telefone válido e os fatos do robô.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Lead } from "../types";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    throw new Error("o Funil leu o banco do robô");
  },
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carregador-funil-"));
const envAntes = { ...process.env };

let carregar: typeof import("@/lib/funil-server");
let store: typeof import("@/lib/data/store");

const brt = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();

/** Um lead de 05/11 por marca, com telefone válido; o robô o viu e saudou (as colunas `robo_*`, gravadas como o sync grava). */
const NOVOS: Lead[] = [
  {
    id: "LEAD-F3-CONSORCIO",
    brand: "consorcio",
    createdAt: brt("2026-11-05", "10:00"),
    name: "Fulano-carregador-consorcio-zq",
    email: "carregador.consorcio@exemplo.com.br",
    phone: "5511987650001",
    status: "lead",
    utmSource: "meta",
  },
  {
    id: "LEAD-F3-KRONE",
    brand: "krone",
    createdAt: brt("2026-11-05", "10:00"),
    name: "Fulano-carregador-krone-zq",
    email: "carregador.krone@exemplo.com.br",
    phone: "5511987650002",
    status: "lead",
    utmSource: "meta",
  },
];

beforeAll(async () => {
  process.env.LOCAL_DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_URL;
  // O robô LIGADO (credencial presente): só a marca padrão o tem.
  process.env.ROBO_SUPABASE_URL = "https://robo.invalid";
  process.env.ROBO_SUPABASE_KEY = "chave-de-teste";
  vi.resetModules();
  carregar = await import("@/lib/funil-server");
  store = await import("@/lib/data/store");
  for (const l of NOVOS) {
    await store.addLead(l);
    await store.updateLeadsRobo([
      {
        id: l.id,
        patch: {
          roboVistoEm: brt("2026-11-05", "10:05"),
          roboRecebidoEm: brt("2026-11-05", "10:00"),
          roboSaudacaoEm: brt("2026-11-05", "10:01"),
          roboEtapa: "nao_respondeu",
        },
      },
    ]);
  }
}, 60_000);

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  process.env = envAntes;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Roda com o relógio em `iso` (só `Date`: as promessas do store seguem normais). */
async function em<T>(iso: string, f: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
  try {
    return await f();
  } finally {
    vi.useRealTimers();
  }
}

const AGORA = "2026-11-06T15:00:00.000Z";
const SEM_O_ROBO = "Sem o robô: o funil é o do painel.";

describe("carregarFunil: o carregador real, sem ler o banco do robô", () => {
  it("o lead de 05/11 está no store, com os fatos do robô (o fixture vale o que diz)", async () => {
    const l = await store.getLead("LEAD-F3-CONSORCIO");
    expect(l?.roboSaudacaoEm).toBe(brt("2026-11-05", "10:01"));
  });

  it("sem ?range= (a Campanha, F3-D12) e com ?range=7d: resolve", async () => {
    const semRange = await em(AGORA, () => carregar.carregarFunil("consorcio"));
    expect(semRange.rangeKey).toBe("all");
    expect(semRange.funil.manchete).toBeDefined();
    const seteDias = await em(AGORA, () => carregar.carregarFunil("consorcio", "7d"));
    expect(seteDias.rangeKey).toBe("7d");
    expect(seteDias.funil.funil).not.toBeNull();
  });

  it("consorcio, 30 dias: o trecho do robô aparece (ligado, lido do store) — o ⓘ não diz 'Sem o robô'", async () => {
    const { funil } = await em(AGORA, () => carregar.carregarFunil("consorcio", "30d"));
    expect(funil.funil).not.toBeNull();
    expect(funil.funil!.linhas.map((l) => l.id)).toContain("com-robo");
    expect(funil.funil!.dica.endsWith(SEM_O_ROBO)).toBe(false);
  });

  it("awareness, 30 dias: o robô vale só na marca padrão — nenhuma linha do robô, e o ⓘ diz isso", async () => {
    const { funil } = await em(AGORA, () => carregar.carregarFunil("krone", "30d"));
    expect(funil.funil).not.toBeNull();
    expect(funil.funil!.linhas.some((l) => l.id === "com-robo")).toBe(false);
    expect(funil.funil!.dica.endsWith(SEM_O_ROBO)).toBe(true);
  });

  it("LGPD: o objeto da tela não leva nome, telefone nem e-mail de lead nenhum", async () => {
    const { funil } = await em(AGORA, () => carregar.carregarFunil("consorcio", "all"));
    const json = JSON.stringify(funil).toLowerCase();
    const data = await store.getData("consorcio");
    let procurados = 0;
    for (const l of data.leads) {
      for (const c of [l.email, l.phone, l.phone?.replace(/\D/g, "")]) {
        if (!c || c.length < 8) continue;
        procurados += 1;
        expect(json.includes(c.toLowerCase()), c).toBe(false);
      }
      if (l.name.includes(" ") || l.name.endsWith("-zq")) expect(json.includes(l.name.toLowerCase()), l.name).toBe(false);
    }
    expect(procurados).toBeGreaterThan(0);
  });
});
