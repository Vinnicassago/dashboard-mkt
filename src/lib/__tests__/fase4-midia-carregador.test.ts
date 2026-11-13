/**
 * Fase 4 (§5.7 da spec, K22) — o carregador da Mídia (`carregarMidia`) de verdade,
 * sobre um JSON local TEMPORÁRIO (o seed, que some no fim; nunca o `.localdata`), com a
 * credencial do robô definida (o robô ligado na marca padrão) e o `@supabase/supabase-js`
 * dublado para LANÇAR: se qualquer caminho da Mídia tocar o banco do robô, o teste cai.
 * Só o relógio (`Date`) é simulado, em 06/11/2026 15:00 Z (sem ele o lead de 05/11 sai
 * dos 30 dias com o tempo).
 *
 * O seed só tem anúncios de 09/07 a 23/07: sem gasto de conversão em 30 dias,
 * `criativos` seria `null` e nada se provaria. Por isso o teste grava pelo store uma
 * linha de conversão em 05/11 (e o criativo dela), um sync de anúncios que deu certo e
 * um lead de 05/11 com o id do anúncio, telefone utilizável e os fatos do robô (como o
 * sync do robô grava, por `updateLeadsRobo`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LeadRoboPatch } from "../data/backend";
import { AGORA_DO_CARREGADOR, dadosDoCarregador, syncDeAnuncios } from "@/test/fixtures-midia";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    throw new Error("a Mídia leu o banco do robô");
  },
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carregador-midia-"));
const envAntes = { ...process.env };

let carregar: typeof import("@/lib/midia-server");
let store: typeof import("@/lib/data/store");

const DADOS = dadosDoCarregador();

beforeAll(async () => {
  process.env.LOCAL_DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_URL;
  // O robô LIGADO (credencial presente): só a marca padrão o tem.
  process.env.ROBO_SUPABASE_URL = "https://robo.invalid";
  process.env.ROBO_SUPABASE_KEY = "chave-de-teste";
  vi.resetModules();
  carregar = await import("@/lib/midia-server");
  store = await import("@/lib/data/store");
  await store.upsertAdDaily(DADOS.adDaily);
  await store.upsertCreatives([DADOS.creative]);
  // O sync de anúncios que trouxe a linha de 05/11 (o "no ar" ancora no dia dele).
  await store.addSyncRun(syncDeAnuncios("sync-carregador-midia", "2026-11-06T09:02:00Z", "2026-10-01", "2026-11-06"));
  const { roboVistoEm, roboRecebidoEm, roboSaudacaoEm, roboEtapa, ...lead } = DADOS.lead;
  await store.addLead(lead);
  const patch: LeadRoboPatch = { roboVistoEm, roboRecebidoEm, roboSaudacaoEm, roboEtapa };
  await store.updateLeadsRobo([{ id: lead.id, patch }]);
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

const AGORA = AGORA_DO_CARREGADOR;

describe("carregarMidia: o carregador real, sem ler o banco do robô", () => {
  it("o que o teste gravou está no store (o fixture vale o que diz)", async () => {
    const l = await store.getLead(DADOS.lead.id);
    expect(l?.roboSaudacaoEm).toBe(DADOS.lead.roboSaudacaoEm);
    const data = await store.getData("consorcio");
    expect(data.adDaily.some((r) => r.adId === DADOS.creative.adId && r.date === "2026-11-05")).toBe(true);
    expect(data.creatives.some((c) => c.adId === DADOS.creative.adId)).toBe(true);
  });

  it("sem ?range= a Mídia abre em 7 dias (F4-D1); 'all' e '30d' resolvem como pedidos", async () => {
    expect((await em(AGORA, () => carregar.carregarMidia("consorcio"))).rangeKey).toBe("7d");
    expect((await em(AGORA, () => carregar.carregarMidia("consorcio", "all"))).rangeKey).toBe("all");
    expect((await em(AGORA, () => carregar.carregarMidia("consorcio", "30d"))).rangeKey).toBe("30d");
    // Uma chave inválida não quebra a página.
    const lixo = await em(AGORA, () => carregar.carregarMidia("consorcio", "lixo"));
    expect(lixo.midia.resumo.texto.length).toBeGreaterThan(0);
  });

  it("consorcio, 30 dias: as colunas do robô aparecem (ligado, lido do store) e o cartão do anúncio novo tem a resposta ao robô", async () => {
    const { midia } = await em(AGORA, () => carregar.carregarMidia("consorcio", "30d"));
    expect(midia.criativos).not.toBeNull();
    expect(midia.colunasDoRobo).toBe(true);
    expect(["ok", "leitura-parada"]).toContain(midia.roboNosCriativos);
    const chave = DADOS.creative.creativeId ?? DADOS.creative.adId;
    const card = midia.criativos!.todos.find((c) => c.chave === chave);
    expect(card, "o cartão do anúncio gravado").toBeDefined();
    expect(card!.robo).not.toBeNull();
    expect(midia.conferir?.href).toBe("/configuracoes/integracoes?range=30d#conferir-gasto");
  });

  it("awareness (krone), 30 dias: sem as colunas do robô, robô desligado, sem cartões e sem conferir", async () => {
    const { midia } = await em(AGORA, () => carregar.carregarMidia("krone", "30d"));
    expect(midia.colunasDoRobo).toBe(false);
    expect(midia.roboNosCriativos).toBe("robo-desligado");
    expect(midia.criativos).toBeNull();
    expect(midia.conferir).toBeNull();
    expect(midia.verba).toBeNull();
  });

  it("LGPD: o objeto da tela não leva nome, telefone nem e-mail de lead nenhum", async () => {
    const { midia } = await em(AGORA, () => carregar.carregarMidia("consorcio", "all"));
    const json = JSON.stringify(midia).toLowerCase();
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
