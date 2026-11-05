/**
 * Fase 1 (nov/26), etapa A — a leitura de "Leads WhatsApp" (`lerLeadsDoRobo`)
 * com o supabase-js dublado: lista EXPLÍCITA de colunas (nada de conversa, nome
 * ou e-mail), ordem estável, paginação até a página vazia, timeout por página e
 * erro que vira exceção (nunca lista vazia). Nenhum banco de verdade.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface Pedido {
  tabela: string;
  select: string;
  ordens: [string, boolean | undefined][];
  range: [number, number] | null;
  signal: AbortSignal | null;
}

const sb = vi.hoisted(() => ({
  pedidos: [] as Pedido[],
  total: 0,
  /** Teto do servidor por resposta (o PostgREST pode cortar abaixo do pedido). */
  teto: 1000,
  erro: null as string | null,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from(tabela: string) {
      const p: Pedido = { tabela, select: "", ordens: [], range: null, signal: null };
      const b = {
        select(s: string) {
          p.select = s;
          return b;
        },
        order(c: string, o?: { ascending?: boolean }) {
          p.ordens.push([c, o?.ascending]);
          return b;
        },
        range(de: number, ate: number) {
          p.range = [de, ate];
          return b;
        },
        abortSignal(s: AbortSignal) {
          p.signal = s;
          sb.pedidos.push(p);
          if (sb.erro) return Promise.resolve({ data: null, error: { message: sb.erro } });
          const [de, ate] = p.range!;
          const fim = Math.min(ate, de + sb.teto - 1, sb.total - 1);
          const data = [];
          for (let i = de; i <= fim; i++) {
            data.push({
              Session_id: `S-${String(i).padStart(5, "0")}`,
              Telefone: `55119${String(10000000 + i)}`,
              status: "Em conversa",
              turno: 1,
              criado_em: "2026-11-03T12:00:00.123456+00:00",
              saudacao_em: null,
            });
          }
          return Promise.resolve({ data, error: null });
        },
      };
      return b;
    },
  }),
}));
vi.mock("@/lib/integracoes", () => ({ roboDesativado: async () => false }));

const envAntes = { ...process.env };
let client: typeof import("@/lib/robo/client");

beforeAll(async () => {
  process.env.ROBO_SUPABASE_URL = "https://robo.invalid";
  process.env.ROBO_SUPABASE_KEY = "chave-de-teste";
  vi.resetModules();
  client = await import("@/lib/robo/client");
});
afterAll(() => {
  process.env = envAntes;
});
beforeEach(() => {
  sb.pedidos.length = 0;
  sb.total = 0;
  sb.teto = 1000;
  sb.erro = null;
});

describe("lerLeadsDoRobo", () => {
  it("select com as colunas EXPLÍCITAS — nada de nome, e-mail, briefing, transcrição ou resumo", async () => {
    sb.total = 3;
    await client.lerLeadsDoRobo();
    const p = sb.pedidos[0];
    expect(p.tabela).toBe("Leads WhatsApp");
    expect(p.select.split(",")).toEqual([...client.COLUNAS_DO_ROBO]);
    expect(p.select).not.toContain("*");
    expect(p.select).not.toMatch(/nome|e-?mail|briefing|transcri|resumo|score/i);
    expect(p.signal).toBeInstanceOf(AbortSignal);
  });

  it("pagina de 1000 em 1000 com ordem estável (criado_em, depois Session_id) até a página vazia", async () => {
    sb.total = 2500;
    const linhas = await client.lerLeadsDoRobo();
    expect(linhas).toHaveLength(2500);
    expect(new Set(linhas.map((l) => l.sessionId)).size).toBe(2500);
    expect(sb.pedidos.map((p) => p.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [2500, 3499],
    ]);
    for (const p of sb.pedidos) {
      expect(p.ordens).toEqual([
        ["criado_em", true],
        ["Session_id", true],
      ]);
    }
    // datas normalizadas para o formato de toISOString
    expect(linhas[0].criadoEm).toBe("2026-11-03T12:00:00.123Z");
  });

  it("servidor que corta abaixo de 1000 não perde linha (avança pelo que veio)", async () => {
    sb.total = 1200;
    sb.teto = 500;
    const linhas = await client.lerLeadsDoRobo();
    expect(linhas).toHaveLength(1200);
    expect(sb.pedidos.map((p) => p.range![0])).toEqual([0, 500, 1000, 1200]);
  });

  it("erro do PostgREST vira exceção — nunca lista vazia", async () => {
    sb.erro = 'permission denied for table "Leads WhatsApp"';
    await expect(client.lerLeadsDoRobo()).rejects.toThrow(/permission denied/);
  });
});
