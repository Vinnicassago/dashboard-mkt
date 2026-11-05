/**
 * Fase 1 (nov/26), etapa A — o sync do robô sobre um JSON local temporário, com
 * a leitura do banco do robô dublada (`lerLeadsDoRobo`). Prova: desligado não
 * grava nada; a leitura casa e grava só `robo_*` (o status não muda); zero
 * inesperado é falha; o erro não leva telefone; o "falhando desde" é o da 1ª
 * falha e some no sucesso; e a carona só roda quando deve.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinhaRobo } from "../robo/etapa";
import type { Lead } from "../types";

const robo = vi.hoisted(() => ({
  configurado: true,
  ligado: true,
  linhas: [] as LinhaRobo[],
  erro: null as Error | null,
  chamadas: 0,
  /** Segura a leitura até alguém soltar (para testar "em andamento"). */
  trava: null as Promise<void> | null,
}));

vi.mock("@/lib/robo/client", () => ({
  isRoboConfigured: () => robo.configurado,
  roboLigado: async () => robo.ligado,
  lerLeadsDoRobo: async () => {
    robo.chamadas++;
    if (robo.trava) await robo.trava;
    if (robo.erro) throw robo.erro;
    return robo.linhas.map((l) => ({ ...l }));
  },
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "robo-sync-"));
const envAntes = { ...process.env };

type Mods = {
  sync: typeof import("@/lib/robo/sync");
  store: typeof import("@/lib/data/store");
  backend: typeof import("@/lib/data/backend");
  sinc: typeof import("@/lib/sincronizacao");
};
let m: Mods;

beforeAll(async () => {
  process.env.LOCAL_DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_URL;
  vi.resetModules();
  m = {
    sync: await import("@/lib/robo/sync"),
    store: await import("@/lib/data/store"),
    backend: await import("@/lib/data/backend"),
    sinc: await import("@/lib/sincronizacao"),
  };
}, 60_000);

afterAll(() => {
  process.env = envAntes;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  robo.configurado = true;
  robo.ligado = true;
  robo.linhas = [];
  robo.erro = null;
  robo.chamadas = 0;
  robo.trava = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const linha = (extra: Partial<LinhaRobo> = {}): LinhaRobo => ({
  sessionId: "S-1",
  telefone: "5511987650001",
  status: null,
  statusAtendimento: null,
  turno: 1,
  conviteEnviado: false,
  conviteEnviadoEm: null,
  transferidoEm: null,
  criadoEm: "2026-11-03T12:00:00.000Z",
  ultimaInteracao: "2026-11-03T13:00:00.000Z",
  saudacaoEm: "2026-11-03T12:01:00.000Z",
  ultimaMsgClienteEm: "2026-11-03T12:30:00.000Z",
  followupsEnviados: 0,
  ultimoFollowupEm: null,
  roboEncerradoEm: null,
  optOut: false,
  optOutEm: null,
  botPausado: false,
  ...extra,
});

const lead = (id: string, extra: Partial<Lead> = {}): Lead => ({
  id,
  brand: "consorcio",
  createdAt: "2026-11-03T11:59:00.000Z",
  name: "Pessoa Teste",
  phone: "(11) 98765-0001",
  status: "em_contato",
  ...extra,
});

const runsDoRobo = () => m.store.listSyncRuns({ source: "robo", brand: "consorcio", limit: 0 });

describe("sincronizarRobo", () => {
  it("robô desligado: não lê, não grava execução nem estado (desligado não é erro)", async () => {
    robo.ligado = false;
    const r = await m.sync.sincronizarRobo({ origem: "cron", agora: "2026-11-04T15:00:00.000Z" });
    expect(r).toMatchObject({ ok: true, desligado: true });
    expect(robo.chamadas).toBe(0);
    expect(await runsDoRobo()).toHaveLength(0);
    expect(await m.store.getState(m.backend.STATE_KEYS.roboUltimaLeitura)).toBeNull();
    expect(m.sync.resumoDoSyncRobo(r)).toBeNull();
  });

  it("zero linhas com lead recente da marca = FALHA (chave sem permissão?), com o desde da 1ª falha", async () => {
    await m.store.addLead(lead("LEAD-ZERO", { phone: "(11) 98765-0009", status: "lead" }));
    const r = await m.sync.sincronizarRobo({ origem: "cron", agora: "2026-11-04T15:00:00.000Z" });
    expect(r).toMatchObject({ ok: false, erro: m.sync.ZERO_INESPERADO });
    const [run] = await runsDoRobo();
    expect(run).toMatchObject({ ok: false, error: m.sync.ZERO_INESPERADO, brand: "consorcio", source: "robo" });
    expect(run.dateFrom).toBeUndefined();
    expect(await m.store.getState(m.backend.STATE_KEYS.roboFalhaDesde)).toBe("2026-11-04T15:00:00.000Z");

    // a 2ª falha não move o "desde"
    await m.sync.sincronizarRobo({ origem: "cron", agora: "2026-11-04T15:15:00.000Z" });
    expect(await m.store.getState(m.backend.STATE_KEYS.roboFalhaDesde)).toBe("2026-11-04T15:00:00.000Z");
    const e = await m.sinc.estadoDaFonte("robo", "consorcio");
    expect(e.falha).toMatchObject({ desde: "2026-11-04T15:00:00.000Z", erro: m.sync.ZERO_INESPERADO });
    expect(e.ultimoOk).toBeNull();
  });

  it("erro da leitura vira frase humana, sem telefone na tela, no registro nem no log", async () => {
    robo.erro = new TypeError("fetch failed ao ler 5511987650001 (+55 11 98765-0001)");
    const r = await m.sync.sincronizarRobo({ origem: "manual", agora: "2026-11-04T15:30:00.000Z" });
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/banco do robô/);
    expect(r.erro).not.toMatch(/98765|5511/);
    const [run] = await runsDoRobo();
    expect(run.error).toBe(r.erro);
    const logado = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logado).not.toMatch(/98765|5511987650001/);
  });

  it("lê, casa e grava só robo_*: o status não muda, as contagens ficam no estado e o falhando some", async () => {
    await m.store.addLead(lead("LEAD-ROBO-1"));
    // a mesma pessoa duas vezes no painel (12 × 13 dígitos): os dois recebem
    await m.store.addLead(lead("LEAD-ROBO-2", { phone: "551187650001", createdAt: "2026-11-03T12:05:00.000Z" }));
    robo.linhas = [
      linha(),
      linha({ sessionId: "S-2", telefone: "5521911110000" }), // sem lead no painel
      linha({ sessionId: "S-3", telefone: "5531922220000", transferidoEm: "2026-11-03T15:00:00.000Z" }),
      linha({ sessionId: "S-4", telefone: "" }),
      // a pessoa do teste do zero, sem saudação ainda
      linha({ sessionId: "S-5", telefone: "5511987650009", turno: 0, saudacaoEm: null, ultimaMsgClienteEm: null }),
    ];
    const agora = "2026-11-04T16:00:00.000Z";
    const r = await m.sync.sincronizarRobo({ origem: "cron", agora });
    expect(r.ok).toBe(true);
    expect(r.leitura).toEqual({
      em: agora,
      lidos: 5,
      casaram: 2,
      semLeadNoPainel: 2,
      semTelefone: 1,
      transferidosSemLead: 1,
    });
    expect(r.atualizados).toBe(3);

    for (const id of ["LEAD-ROBO-1", "LEAD-ROBO-2"]) {
      expect(await m.store.getLead(id)).toMatchObject({
        status: "em_contato",
        roboVistoEm: agora,
        roboRecebidoEm: "2026-11-03T12:00:00.000Z",
        roboSaudacaoEm: "2026-11-03T12:01:00.000Z",
        roboRespondeuEm: "2026-11-03T12:30:00.000Z",
        roboEtapa: "em_conversa",
        roboCobrancas: 0,
        roboPausado: false,
      });
    }
    expect(await m.store.getLead("LEAD-ZERO")).toMatchObject({ status: "lead", roboEtapa: "sem_mensagem" });
    // o robô não é tentativa: nenhum evento, nenhum 1º contato
    expect((await m.store.getLead("LEAD-ROBO-1"))?.firstContactAt).toBeUndefined();
    expect(await m.store.listLeadEvents({ leadId: "LEAD-ROBO-1", limit: 0 })).toEqual([]);

    const [run] = await runsDoRobo();
    expect(run).toMatchObject({ ok: true, rows: 2, startedAt: agora, finishedAt: agora });
    const resumo = await m.store.getState(m.backend.STATE_KEYS.roboUltimaLeitura);
    expect(resumo).toEqual(r.leitura);
    expect(JSON.stringify(resumo)).not.toMatch(/9876|9111|9222/);
    // limpo com "" (o Supabase recusa null em app_state.value): vazio = sem falha
    expect(await m.store.getState(m.backend.STATE_KEYS.roboFalhaDesde)).toBe("");
    const e = await m.sinc.estadoDaFonte("robo", "consorcio");
    expect(e).toEqual({ ultimoOk: agora, falha: null });
    expect(m.sync.resumoDoSyncRobo(r)).toMatchObject({ ok: true });

    // a mesma leitura de novo: nada mudou, nada é gravado nos leads
    const r2 = await m.sync.sincronizarRobo({ origem: "cron", agora: "2026-11-04T16:15:00.000Z" });
    expect(r2.atualizados).toBe(0);
    expect((await m.store.getLead("LEAD-ROBO-1"))?.roboVistoEm).toBe(agora);
  });

  it("lead reaberto: a saudação da conversa nova substitui a de antes do reaberto (só dele)", async () => {
    await m.store.addLeadEvent({
      id: "EV-REAB-1",
      leadId: "LEAD-ROBO-1",
      brand: "consorcio",
      leadName: "Pessoa Teste",
      actor: "Landing page",
      action: "reaberto",
      createdAt: "2026-11-04T17:00:00.000Z",
    });
    robo.linhas = [linha({ saudacaoEm: "2026-11-04T17:05:00.000Z", ultimaInteracao: "2026-11-04T17:05:00.000Z" })];
    const agora = "2026-11-04T17:30:00.000Z";
    const r = await m.sync.sincronizarRobo({ origem: "cron", agora });
    expect(r.ok).toBe(true);
    expect(await m.store.getLead("LEAD-ROBO-1")).toMatchObject({
      roboSaudacaoEm: "2026-11-04T17:05:00.000Z",
      roboVistoEm: agora,
      roboRecebidoEm: "2026-11-03T12:00:00.000Z", // a mesma conversa: criado_em de antes, fica
    });
    // o outro cadastro da mesma pessoa não foi reaberto: UMA VEZ continua UMA VEZ
    expect(await m.store.getLead("LEAD-ROBO-2")).toMatchObject({
      roboSaudacaoEm: "2026-11-03T12:01:00.000Z",
      roboVistoEm: "2026-11-04T16:00:00.000Z",
      roboUltimaInteracaoEm: "2026-11-04T17:05:00.000Z",
    });
    // nenhum evento novo: o robô não é tentativa
    expect((await m.store.listLeadEvents({ leadId: "LEAD-ROBO-1", limit: 0 })).map((e) => e.action)).toEqual(["reaberto"]);
  });

  it("60 falhas seguidas: o último ok cai para a última leitura gravada (nunca 'nunca')", async () => {
    const leitura = (await m.store.getState<{ em: string }>(m.backend.STATE_KEYS.roboUltimaLeitura))!;
    for (let i = 0; i < 61; i++) {
      const t = new Date(Date.parse("2026-11-05T00:00:00.000Z") + i * 900_000).toISOString();
      await m.store.addSyncRun({ id: `F-${i}`, source: "robo", brand: "consorcio", startedAt: t, finishedAt: t, ok: false, error: "x" });
    }
    await m.store.setState(m.backend.STATE_KEYS.roboFalhaDesde, "2026-11-05T00:00:00.000Z");
    const e = await m.sinc.estadoDaFonte("robo", "consorcio");
    expect(e.ultimoOk).toBe(leitura.em);
    expect(e.falha?.desde).toBe("2026-11-05T00:00:00.000Z");
  });
});

describe("carona ao abrir a Fila", () => {
  it("outra marca, robô desligado ou tentativa recente (< 15 min, ok ou não): não roda", async () => {
    const [ultima] = await runsDoRobo();
    const logo = new Date(Date.parse(ultima.finishedAt) + 10 * 60_000);
    expect(await m.sync.dispararCaronaDoRobo("krone", logo)).toBe(false);
    expect(await m.sync.dispararCaronaDoRobo("consorcio", logo)).toBe(false);
    robo.ligado = false;
    expect(await m.sync.dispararCaronaDoRobo("consorcio", new Date(Date.parse(ultima.finishedAt) + 60 * 60_000))).toBe(false);
    expect(robo.chamadas).toBe(0);
  });

  it("última tentativa há mais de 15 min: roda (e grava a execução)", async () => {
    const antes = (await runsDoRobo()).length;
    const [ultima] = await runsDoRobo();
    const depois = new Date(Date.parse(ultima.finishedAt) + 16 * 60_000);
    expect(await m.sync.dispararCaronaDoRobo("consorcio", depois)).toBe(true);
    expect(robo.chamadas).toBe(1);
    expect((await runsDoRobo()).length).toBe(antes + 1);
  });

  it("com um sync do robô em andamento no processo, a carona não enfileira outro", async () => {
    let soltar!: () => void;
    robo.trava = new Promise<void>((r) => (soltar = r));
    const emCurso = m.sync.sincronizarRobo({ origem: "manual" });
    expect(m.sync.syncDoRoboEmAndamento()).toBe(true);
    expect(await m.sync.dispararCaronaDoRobo("consorcio", new Date("2030-01-01T00:00:00.000Z"))).toBe(false);
    soltar();
    await emCurso;
    expect(m.sync.syncDoRoboEmAndamento()).toBe(false);
    expect(robo.chamadas).toBe(1);
  });
});
