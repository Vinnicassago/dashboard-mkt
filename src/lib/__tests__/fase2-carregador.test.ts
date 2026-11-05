/**
 * Fase 2 (nov/26), etapa A2b — o carregador do Início (`carregarBussola`) de
 * verdade, sobre um JSON local temporário (o seed, que some no fim); só o relógio
 * (`Date`) é simulado. Confere o modo pela CHAVE do período (normal × live), os
 * alertas de cada modo e o desvio do resumo semanal (`semModoLive`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chavesDaLive } from "../atalho-live";
import { LIVE_PADRAO } from "../live";
import { STATE_KEYS } from "../data/backend";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carregador-inicio-"));
const envAntes = { ...process.env };

let carregar: typeof import("@/lib/bussola-server");
let store: typeof import("@/lib/data/store");

beforeAll(async () => {
  process.env.LOCAL_DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_URL;
  delete process.env.ROBO_SUPABASE_URL;
  delete process.env.ROBO_SUPABASE_KEY;
  vi.resetModules();
  carregar = await import("@/lib/bussola-server");
  store = await import("@/lib/data/store");
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

const chaves = chavesDaLive(LIVE_PADRAO);

describe("carregarBussola: o modo sai da chave do período", () => {
  it("sem ?range=: a semana, modo normal, os quatro blocos e o rodapé com o período", async () => {
    const b = await em("2026-11-05T15:00:00.000Z", () => carregar.carregarBussola("consorcio"));
    expect(b.modo).toBe("normal");
    if (b.modo !== "normal") return;
    expect(b.rangeKey).toBe("7d");
    expect(b.hoje).toBe("2026-11-05");
    expect(b.range).toEqual({ from: "2026-10-30", to: "2026-11-05" });
    expect(b.live).toBeNull();
    expect(b.inicio.cartoes.leads.valor).toBe(b.kpis.leads.valor);
    expect(b.inicio.rodape.links.map((l) => l.href)).toEqual(["/funil?range=7d", "/midia?range=7d", "/conteudo/posts?range=7d"]);
    // O seed tem LP em julho e nada nesta semana: o rastreio "parou", sem citar "Onde trava".
    const lp = b.alertas.find((a) => a.id === "lp-sem-dado");
    expect(lp?.titulo).toBe("O rastreio da landing page parou: sem visitas registradas no período");
    expect(b.alertas.some((a) => a.nivel === "config")).toBe(false);
  });

  it("LGPD: o objeto do Início (o que vai aos componentes) não leva contato — com gente na lista", async () => {
    // A campanha inteira: o seed só tem leads de julho, e a semana de 05/11 sairia com a lista vazia (nada a conferir).
    const b = await em("2026-11-05T15:00:00.000Z", () => carregar.carregarBussola("consorcio", "all"));
    expect(b.modo).toBe("normal");
    if (b.modo !== "normal") return;
    const ultimos = b.inicio.leadsChegando.ultimos;
    expect(ultimos.length).toBeGreaterThan(0);
    const porId = new Map(b.data.leads.map((l) => [l.id, l]));
    // As pessoas da lista têm contato no store — senão a busca abaixo não provaria nada.
    expect(ultimos.every((u) => porId.has(u.id))).toBe(true);
    expect(ultimos.some((u) => Boolean(porId.get(u.id)?.phone || porId.get(u.id)?.email))).toBe(true);
    // Nenhum telefone (cru ou só os dígitos) nem e-mail de NENHUM lead da base, nem as chaves.
    const json = JSON.stringify(b.inicio);
    let procurados = 0;
    for (const l of b.data.leads) {
      const contatos = [l.email, l.phone, l.phone?.replace(/\D/g, "")].filter((c): c is string => Boolean(c && c.length >= 8));
      for (const c of contatos) {
        procurados += 1;
        expect(json.includes(c), c).toBe(false);
      }
    }
    expect(procurados).toBeGreaterThan(0);
    expect(/"(phone|email|telefone)"/.test(json)).toBe(false);
  });

  it("período que ainda não começou (C9): o 1º dia, vazio, sem 'lp-sem-dado' nem a cobertura", async () => {
    const b = await em("2026-11-05T15:00:00.000Z", () => carregar.carregarBussola("consorcio", "2026-11-20..2026-11-25"));
    expect(b.modo).toBe("normal");
    expect(b.range).toEqual({ from: "2026-11-20", to: "2026-11-20" });
    expect(b.naoComecou).toBe(true);
    expect(b.kpis.leads.valor).toBe(0);
    expect(b.alertas.some((a) => a.id === "lp-sem-dado" || a.id === "trava-cobertura-de-dias")).toBe(false);
    // Sem "anterior": o dia antes do 1º dia futuro é hoje (parcial) — a seta seria uma queda falsa.
    expect(b.kpis.leads.anterior).toBeUndefined();
    expect(b.kpis.investimentoConversao.anterior).toBeUndefined();
    if (b.modo === "normal") expect(b.inicio.cartoes.leads.anterior).toBeUndefined();
  });

  it("chave da campanha da live, antes de 16/11: o painel (recorte = o 1º dia), sem os alertas do custo nem 'nenhuma campanha'", async () => {
    const b = await em("2026-11-05T15:00:00.000Z", () => carregar.carregarBussola("consorcio", chaves.campanha));
    expect(b.modo).toBe("live");
    if (b.modo !== "live") return;
    expect(b.inicio).toBeNull();
    expect(b.live.periodo).toBe("campanha");
    expect(b.live.rangePainel).toEqual({ de: "2026-11-16", ate: "2026-11-16", naoComecou: true });
    expect(b.live.cfg.nome).toBe(LIVE_PADRAO.nome);
    expect(b.live.subAtalhos.find((s) => s.atual)?.id).toBe("campanha");
    // Os kpis da página seguem o `resolveRange` (C9).
    expect(b.range).toEqual({ from: "2026-11-16", to: "2026-11-16" });
    const ids = b.alertas.map((a) => a.id);
    expect(ids).not.toContain("lp-sem-dado");
    expect(ids).not.toContain("live-sem-campanhas");
    expect(ids.filter((id) => id.startsWith("trava-") && id !== "trava-cobertura-de-dias")).toEqual([]);
  });

  it("depois de 16/11, sem campanha [LIVE] no Gerenciador: 'nenhuma campanha casou' vai para o ⚠; captação abre a captação", async () => {
    const b = await em("2026-11-20T15:00:00.000Z", () => carregar.carregarBussola("consorcio", chaves.captacao));
    expect(b.modo).toBe("live");
    if (b.modo !== "live") return;
    expect(b.live.periodo).toBe("captacao");
    expect(b.live.rangePainel).toEqual({ de: "2026-11-16", ate: "2026-11-20", naoComecou: false });
    expect(b.alertas.find((a) => a.id === "live-sem-campanhas")?.nivel).toBe("aviso");
  });

  it("o resumo semanal nunca abre o painel (semModoLive), mesmo com a chave da live", async () => {
    const b = await em("2026-11-20T15:00:00.000Z", () => carregar.carregarBussola("consorcio", chaves.campanha, { semModoLive: true }));
    expect(b.modo).toBe("normal");
    expect(b.live).toBeNull();
  });

  it("a régua editada: a chave antiga vira período comum; a régua passada pela página vale", async () => {
    const cfg = { ...LIVE_PADRAO, periodo: { de: "2026-11-17", ate: "2026-12-15" } };
    const antiga = await em("2026-11-20T15:00:00.000Z", () => carregar.carregarBussola("consorcio", chaves.campanha, { cfgDaLive: cfg }));
    expect(antiga.modo).toBe("normal");
    const nova = await em("2026-11-20T15:00:00.000Z", () => carregar.carregarBussola("consorcio", chavesDaLive(cfg).campanha, { cfgDaLive: cfg }));
    expect(nova.modo).toBe("live");
    // Sem a régua da página, vale a do store (a padrão: nada foi salvo) — a chave dela abre o painel.
    expect(await store.getState(STATE_KEYS.campanhaDaLive)).toBeFalsy();
    const doStore = await em("2026-11-20T15:00:00.000Z", () => carregar.carregarBussola("consorcio", chaves.campanha));
    expect(doStore.modo).toBe("live");
  });
});
