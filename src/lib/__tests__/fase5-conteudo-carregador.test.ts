/**
 * Fase 5 de nov/26 (§5.3 da spec) — o carregador do Conteúdo (`carregarConteudo`) de
 * verdade, sobre um JSON local TEMPORÁRIO (o seed, que some no fim; nunca o
 * `.localdata`), sem banco (`DATABASE_URL`/`SUPABASE_URL` apagados) e com o
 * `@supabase/supabase-js` dublado para LANÇAR: o Conteúdo não lê banco nenhum além do
 * store. Só o relógio (`Date`) é simulado, em 13/11/2026 15:00 Z (12:00 em Brasília).
 *
 * O seed fica em julho: sem `?range=` (30 dias) o período é vazio — o placar e as ações
 * do AGORA (F5-D34); em Campanha, os 8 posts da grade, os 3 melhores e as 2 ações "alta".
 * O seed não tem peças da Produção: `listDrafts` devolve `[]`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { conferirLgpd } from "@/test/tela";
import { AGORA } from "@/test/fixtures-conteudo";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => {
    throw new Error("o Conteúdo leu um banco que não é o store");
  },
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "carregador-conteudo-"));
const envAntes = { ...process.env };

let carregar: typeof import("@/lib/conteudo-server");
let store: typeof import("@/lib/data/store");

beforeAll(async () => {
  process.env.LOCAL_DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_URL;
  delete process.env.ROBO_SUPABASE_URL;
  delete process.env.ROBO_SUPABASE_KEY;
  vi.resetModules();
  carregar = await import("@/lib/conteudo-server");
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

const placarDe = (c: { placar: { posts: string; ultimo: string; seguidores: string } }) => `${c.placar.posts} · ${c.placar.ultimo} · ${c.placar.seguidores}`;

describe("carregarConteudo: o carregador real, sobre o JSON local temporário", () => {
  it("o store é o temporário (nunca o .localdata) e o seed não tem peças da Produção", async () => {
    expect(process.env.LOCAL_DATA_DIR).toBe(dir);
    expect(dir.startsWith(os.tmpdir())).toBe(true);
    expect(await store.listDrafts("consorcio")).toEqual([]);
    const data = await store.getData("consorcio");
    expect(data.igPosts.length).toBeGreaterThan(0);
  });

  it("sem ?range= o Conteúdo abre em 30 dias (F5-D2): o seed (julho) vazio — o placar e as ações do agora", async () => {
    const { rangeKey, conteudo } = await em(AGORA, () => carregar.carregarConteudo("consorcio"));
    expect(rangeKey).toBe("30d");
    expect(placarDe(conteudo)).toBe("Nenhum post no período · Último post há 113 dias · Seguidores —");
    expect(conteudo.acoes.map((a) => a.id)).toEqual(["no-recent-post", "grade-da-semana"]);
    expect(conteudo.acoes[0].linha).toBe("Publique hoje: 113 dias sem post da grade");
    expect(conteudo.acoes.every((a) => a.destino?.href === "/conteudo/producao?range=30d")).toBe(true);
    expect(conteudo.melhores).toBeNull();
    expect(conteudo.todos).toBeNull();
    expect(conteudo.conta).toBeNull();
  });

  it("consorcio em Campanha: 8 posts da grade, os 3 melhores e as duas ações 'alta' (nenhum vanity-objective)", async () => {
    const { rangeKey, conteudo } = await em(AGORA, () => carregar.carregarConteudo("consorcio", "all"));
    expect(rangeKey).toBe("all");
    expect(placarDe(conteudo)).toBe("8 posts no período · Último post há 113 dias · Seguidores +486 (pago + orgânico)");
    expect(conteudo.melhores?.titulo).toBe("Carrossel de 23/07 lidera: 93 salvos, 67 compartilhamentos");
    expect(conteudo.melhores?.cards.map((c) => c.id)).toEqual(["POST-09", "POST-07", "POST-06"]);
    expect(conteudo.acoes.map((a) => a.id)).toEqual(["no-recent-post", "reels-too-long"]);
    expect(conteudo.acoes.map((a) => a.id)).not.toContain("vanity-objective");
    expect(conteudo.acoes.every((a) => a.destino?.href === "/conteudo/producao?range=all")).toBe(true);
    expect(conteudo.conta?.tituloDoGrafico).toBe("Total de seguidores · 524");
    expect(conteudo.todos?.producao?.href).toBe("/conteudo/producao?range=all");
  });

  it("uma chave inválida não quebra a página; '7d' resolve como pedido", async () => {
    const lixo = await em(AGORA, () => carregar.carregarConteudo("consorcio", "xyz"));
    expect(lixo.conteudo.placar.posts.length).toBeGreaterThan(0);
    expect((await em(AGORA, () => carregar.carregarConteudo("consorcio", "7d"))).rangeKey).toBe("7d");
  });

  it("awareness (krone) em Campanha: sem ações, sem o gráfico, e a variação conta desde a 1ª leitura (09/07)", async () => {
    const { conteudo } = await em(AGORA, () => carregar.carregarConteudo("krone", "all"));
    expect(conteudo.acoes).toEqual([]);
    expect(conteudo.conta?.serieDeSeguidores).toBeNull();
    expect(conteudo.conta?.tituloDoGrafico).toBeNull();
    expect(placarDe(conteudo)).toBe("5 posts no período · Último post há 115 dias · Seguidores +337 (pago + orgânico)");
    expect(conteudo.placar.dica).toContain("Sem leitura do total antes de 09/07");
    expect(conteudo.placar.dica).not.toContain("cartão Leads do Início");
    expect(conteudo.todos?.producao).toBeNull();
  });

  it("LGPD: o objeto da tela não leva nome, telefone, e-mail nem id de lead do seed", async () => {
    for (const marca of ["consorcio", "krone"]) {
      for (const chave of [undefined, "all"]) {
        const { conteudo } = await em(AGORA, () => carregar.carregarConteudo(marca, chave));
        const data = await store.getData(marca);
        // A mesma régua das telas (`conferirLgpd`), sobre o objeto inteiro.
        conferirLgpd({ arvore: conteudo, clients: [], funcoes: [] }, data.leads, { semNomes: true, semIds: true });
        const json = JSON.stringify(conteudo).toLowerCase();
        let procurados = 0;
        for (const l of data.leads) {
          for (const c of [l.email, l.phone, l.phone?.replace(/\D/g, ""), l.id]) {
            if (!c || c.length < 6) continue;
            procurados += 1;
            expect(json.includes(c.toLowerCase()), c).toBe(false);
          }
          if (l.name.includes(" ")) expect(json.includes(l.name.toLowerCase()), l.name).toBe(false);
        }
        if (marca === "consorcio") expect(procurados).toBeGreaterThan(0);
        // Nem legenda inteira, nem chave de dado bruto.
        expect(/"(phone|email|telefone|caption|mediaUrl|thumbnailUrl|leads|igPosts|drafts)"/.test(JSON.stringify(conteudo)), `${marca} ${chave}`).toBe(false);
      }
    }
  });
});
