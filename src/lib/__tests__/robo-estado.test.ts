/**
 * Fase 1 (nov/26), etapa A — `estadoDoRoboAgora`, a leitura ÚNICA do estado do
 * robô (11.1): desligado sem tocar o store quando não há credencial ou a marca
 * é outra; `lidoAte` = último ok; `confiavel` só com leitura de até 2 h.
 * Store dublado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncRun } from "../types";

const st = vi.hoisted(() => ({
  configurado: true,
  /** Outra condição de `roboLigado` (além da credencial e da chave "desativado"). */
  pausadoPorOutraRegra: false,
  state: {} as Record<string, unknown>,
  runs: [] as SyncRun[],
}));

vi.mock("@/lib/robo/client", () => ({
  isRoboConfigured: () => st.configurado,
  // o molde de `roboLigado` (client.ts): credencial e a chave "desativado" — mais uma regra qualquer
  roboLigado: async () => st.configurado && st.state.robo_desativado !== true && !st.pausadoPorOutraRegra,
}));
vi.mock("@/lib/data/store", () => ({
  getState: vi.fn(async (k: string) => (k in st.state ? st.state[k] : null)),
  listSyncRuns: vi.fn(async () => st.runs),
}));

import { estadoDoRoboAgora, LEITURA_CONFIAVEL_H } from "../robo/estado";
import * as store from "@/lib/data/store";

const run = (finishedAt: string, ok: boolean, error?: string): SyncRun => ({
  id: `R-${finishedAt}`,
  source: "robo",
  brand: "consorcio",
  startedAt: finishedAt,
  finishedAt,
  ok,
  error,
});
const AGORA = new Date("2026-11-04T15:00:00.000Z");

beforeEach(() => {
  st.configurado = true;
  st.pausadoPorOutraRegra = false;
  st.state = {};
  st.runs = [];
});
afterEach(() => vi.clearAllMocks());

describe("estadoDoRoboAgora", () => {
  it("sem credencial ou em outra marca: desligado, sem tocar o store", async () => {
    st.configurado = false;
    expect(await estadoDoRoboAgora("consorcio", AGORA)).toEqual({
      ligado: false,
      lidoAte: null,
      confiavel: false,
      sync: { ultimoOk: null, falha: null },
    });
    st.configurado = true;
    expect((await estadoDoRoboAgora("krone", AGORA)).ligado).toBe(false);
    expect(store.getState).not.toHaveBeenCalled();
    expect(store.listSyncRuns).not.toHaveBeenCalled();
  });

  it("desativado em Configurações: desligado, sem ler as execuções", async () => {
    st.state.robo_desativado = true;
    expect((await estadoDoRoboAgora("consorcio", AGORA)).ligado).toBe(false);
    expect(store.listSyncRuns).not.toHaveBeenCalled();
  });

  it("a decisão de ligado é a MESMA do sync (`roboLigado`): uma regra nova lá desliga aqui", async () => {
    st.pausadoPorOutraRegra = true;
    expect((await estadoDoRoboAgora("consorcio", AGORA)).ligado).toBe(false);
    expect(store.listSyncRuns).not.toHaveBeenCalled();
  });

  it("leitura de até 2 h é confiável; mais velha, não; nunca lido, também não", async () => {
    expect(LEITURA_CONFIAVEL_H).toBe(2);
    st.runs = [run("2026-11-04T13:10:00.000Z", true)];
    expect(await estadoDoRoboAgora("consorcio", AGORA)).toMatchObject({
      ligado: true,
      lidoAte: "2026-11-04T13:10:00.000Z",
      confiavel: true,
      sync: { ultimoOk: "2026-11-04T13:10:00.000Z", falha: null },
    });
    st.runs = [run("2026-11-04T12:59:00.000Z", true)];
    expect((await estadoDoRoboAgora("consorcio", AGORA)).confiavel).toBe(false);
    st.runs = [];
    expect(await estadoDoRoboAgora("consorcio", AGORA)).toMatchObject({ ligado: true, lidoAte: null, confiavel: false });
  });

  it("falhando: o desde é o gravado na 1ª falha (não o da janela) e o último ok continua o lido", async () => {
    st.runs = [
      run("2026-11-04T14:45:00.000Z", false, "Robô: a credencial não tem permissão para esta leitura."),
      run("2026-11-04T14:30:00.000Z", false, "x"),
      run("2026-11-04T14:15:00.000Z", true),
    ];
    st.state.robo_falha_desde = "2026-11-04T14:29:00.000Z";
    expect(await estadoDoRoboAgora("consorcio", AGORA)).toMatchObject({
      ligado: true,
      lidoAte: "2026-11-04T14:15:00.000Z",
      confiavel: true,
      sync: {
        ultimoOk: "2026-11-04T14:15:00.000Z",
        falha: { desde: "2026-11-04T14:29:00.000Z", erro: "Robô: a credencial não tem permissão para esta leitura." },
      },
    });
  });

  it("um \"desde\" que sobrou de antes do último ok (a limpeza falhou) não vale: o da janela", async () => {
    st.runs = [
      run("2026-11-04T14:45:00.000Z", false, "x"),
      run("2026-11-04T14:30:00.000Z", false, "x"),
      run("2026-11-04T14:15:00.000Z", true),
    ];
    st.state.robo_falha_desde = "2026-11-01T10:00:00.000Z";
    expect((await estadoDoRoboAgora("consorcio", AGORA)).sync.falha?.desde).toBe("2026-11-04T14:30:00.000Z");
    // limpo com "" (o Supabase recusa null em app_state): vazio = sem "desde" gravado
    st.state.robo_falha_desde = "";
    expect((await estadoDoRoboAgora("consorcio", AGORA)).sync.falha?.desde).toBe("2026-11-04T14:30:00.000Z");
  });

  it("todas as execuções lidas falharam: o último ok vem da última leitura gravada", async () => {
    st.runs = [run("2026-11-04T14:45:00.000Z", false, "x")];
    st.state.robo_ultima_leitura = { em: "2026-11-04T01:00:00.000Z", lidos: 3, casaram: 2, semLeadNoPainel: 1, semTelefone: 0, transferidosSemLead: 0 };
    const e = await estadoDoRoboAgora("consorcio", AGORA);
    expect(e).toMatchObject({ lidoAte: "2026-11-04T01:00:00.000Z", confiavel: false });
    // sem o "desde" gravado, o da janela (a falha mais antiga lida)
    expect(e.sync.falha?.desde).toBe("2026-11-04T14:45:00.000Z");
  });
});
