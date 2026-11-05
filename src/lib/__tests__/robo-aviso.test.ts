/**
 * Fase 1 (nov/26), etapa B — o aviso de resgate ao n8n. A parte pura
 * (`planejarAvisoResgate`: janela de 15 min, fora do horário acumula, poda, um
 * aviso por ENTRADA no resgate, falha repete), o corpo sem PII (`avisarResgate`),
 * o aviso de lead novo com o robô ligado, e o caminho de verdade sobre um JSON
 * local temporário (`avisarResgateSePreciso` e o fim do sync do robô), com a
 * leitura do banco do robô e o n8n dublados.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ESTADO_AVISO_VAZIO,
  chaveDoAviso,
  estadoDepoisDoAviso,
  lerEstadoAvisoResgate,
  planejarAvisoResgate,
  type EstadoAvisoResgate,
  type ItemResgate,
} from "../robo/aviso-resgate";
import type { LinhaRobo } from "../robo/etapa";
import { montarFila } from "../fila";
import type { Lead } from "../types";

const brt = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();
const item = (id: string, desde = brt("2026-11-04", "10:00"), motivo: ItemResgate["motivo"] = "robo-nao-falou"): ItemResgate => ({
  id,
  primeiroNome: `P${id}`,
  motivo,
  desde,
});
const vazio = (): EstadoAvisoResgate => ({ ...ESTADO_AVISO_VAZIO, avisados: {} });

// ---------------------------------------------------------------- puro

describe("planejarAvisoResgate — quem avisar, e quando", () => {
  const QUARTA_15 = brt("2026-11-04", "15:00");

  it("avisa as entradas novas no horário comercial, a mais antiga primeiro; enviado → marcado", () => {
    const naFila = [item("b", brt("2026-11-04", "12:00")), item("a", brt("2026-11-04", "10:00"))];
    const p = planejarAvisoResgate({ naFila, estado: vazio(), agora: QUARTA_15 });
    expect(p.enviar.map((i) => i.id)).toEqual(["a", "b"]);
    expect(p).toMatchObject({ total: 2, espera: null });
    const depois = estadoDepoisDoAviso(p, { ok: true, agora: QUARTA_15 });
    expect(depois).toEqual({
      avisados: { [chaveDoAviso(naFila[1])]: QUARTA_15, [chaveDoAviso(naFila[0])]: QUARTA_15 },
      ultimoEnvio: QUARTA_15,
      ultimaFalha: null,
    });
    // A mesma entrada não é avisada de novo.
    const de_novo = planejarAvisoResgate({ naFila, estado: depois, agora: brt("2026-11-04", "16:00") });
    expect(de_novo).toMatchObject({ enviar: [], espera: "nada-novo", total: 2 });
  });

  it("a chave é a ENTRADA (lead:motivo:desde): sair e voltar ao resgate é aviso novo; mudar só de motivo também", () => {
    expect(chaveDoAviso(item("a"))).toBe(`a:robo-nao-falou:${brt("2026-11-04", "10:00")}`);
    const avisado = estadoDepoisDoAviso(planejarAvisoResgate({ naFila: [item("a")], estado: vazio(), agora: QUARTA_15 }), {
      ok: true,
      agora: QUARTA_15,
    });
    const voltou = item("a", brt("2026-11-05", "10:01"), "sem-resposta-24h");
    const p = planejarAvisoResgate({ naFila: [voltou], estado: avisado, agora: brt("2026-11-05", "11:00") });
    expect(p.enviar).toEqual([voltou]);
    // A poda tirou a entrada antiga (ela não existe mais).
    expect(Object.keys(p.estado.avisados)).toEqual([]);
  });

  it("janela de 15 min entre envios: o novo espera e sai na rodada seguinte", () => {
    const enviado = estadoDepoisDoAviso(planejarAvisoResgate({ naFila: [item("a")], estado: vazio(), agora: QUARTA_15 }), {
      ok: true,
      agora: QUARTA_15,
    });
    const naFila = [item("a"), item("b", brt("2026-11-04", "13:00"))];
    expect(planejarAvisoResgate({ naFila, estado: enviado, agora: brt("2026-11-04", "15:10") })).toMatchObject({ enviar: [], espera: "janela" });
    expect(planejarAvisoResgate({ naFila, estado: enviado, agora: brt("2026-11-04", "15:15") }).enviar.map((i) => i.id)).toEqual(["b"]);
  });

  it("a janela tem folga para o cron de 15 min: o sync seguinte que termina 3 s mais cedo não pula a rodada", () => {
    // Enviou no fim de um sync de 8 s (10:00:08); o cron das 10:15 levou 5 s e terminou às 10:15:05.
    const fimAnterior = new Date(Date.parse(brt("2026-11-04", "10:00")) + 8_000).toISOString();
    const enviado = estadoDepoisDoAviso(planejarAvisoResgate({ naFila: [item("a")], estado: vazio(), agora: fimAnterior }), {
      ok: true,
      agora: fimAnterior,
    });
    const naFila = [item("a"), item("b", brt("2026-11-04", "10:05"))];
    const fimSeguinte = new Date(Date.parse(brt("2026-11-04", "10:15")) + 5_000).toISOString(); // 14 min 57 s depois
    expect(planejarAvisoResgate({ naFila, estado: enviado, agora: fimSeguinte }).enviar.map((i) => i.id)).toEqual(["b"]);
    // Um "Sincronizar agora" 12 min depois continua esperando (no máximo um aviso por rodada do cron).
    expect(planejarAvisoResgate({ naFila, estado: enviado, agora: brt("2026-11-04", "10:12") })).toMatchObject({ espera: "janela" });
  });

  it("fora do horário acumula (e poda) — sai tudo junto na 1ª rodada do expediente", () => {
    const noite = brt("2026-11-04", "20:00");
    const naFila = [item("a", brt("2026-11-04", "19:00")), item("b", brt("2026-11-04", "21:00"))];
    const p1 = planejarAvisoResgate({ naFila: naFila.slice(0, 1), estado: vazio(), agora: noite });
    expect(p1).toMatchObject({ enviar: [], espera: "fora-do-horario", total: 1 });
    const sabado = planejarAvisoResgate({ naFila, estado: p1.estado, agora: brt("2026-11-07", "10:00") });
    expect(sabado.espera).toBe("fora-do-horario");
    const segunda = planejarAvisoResgate({ naFila, estado: sabado.estado, agora: brt("2026-11-09", "09:00") });
    expect(segunda.enviar.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("poda: quem saiu do resgate (respondeu, fechou) sai de 'avisados'; a cadência que esconde do grupo não é saída", () => {
    const estado: EstadoAvisoResgate = {
      avisados: { [chaveDoAviso(item("a"))]: QUARTA_15, [chaveDoAviso(item("b"))]: QUARTA_15 },
      ultimoEnvio: QUARTA_15,
    };
    // "a" continua (mesmo escondido do grupo pela cadência, a entrada existe); "b" saiu.
    const p = planejarAvisoResgate({ naFila: [item("a")], estado, agora: brt("2026-11-04", "16:00") });
    expect(p).toMatchObject({ enviar: [], espera: "nada-novo" });
    expect(Object.keys(p.estado.avisados)).toEqual([chaveDoAviso(item("a"))]);
  });

  it("só os motivos avisáveis (não compareceu e retorno ficam fora)", () => {
    const p = planejarAvisoResgate({
      naFila: [item("n", undefined, "nao-compareceu"), item("r", undefined, "retorno"), item("w", undefined, "sem-whatsapp"), item("t", undefined, "sem-telefone")],
      estado: vazio(),
      agora: QUARTA_15,
    });
    expect(p.enviar.map((i) => i.id).sort()).toEqual(["t", "w"]);
    expect(p.total).toBe(2);
  });

  it("falha no envio: ninguém marcado, a falha guardada — e a rodada seguinte tenta de novo", () => {
    const p = planejarAvisoResgate({ naFila: [item("a")], estado: vazio(), agora: QUARTA_15 });
    const falhou = estadoDepoisDoAviso(p, { ok: false, agora: QUARTA_15 });
    expect(falhou.avisados).toEqual({});
    expect(falhou.ultimoEnvio).toBeNull();
    expect(falhou.ultimaFalha).toMatchObject({ em: QUARTA_15 });
    // Sem envio que deu certo, a janela não segura: tenta já na próxima rodada.
    const outra = planejarAvisoResgate({ naFila: [item("a")], estado: falhou, agora: brt("2026-11-04", "15:05") });
    expect(outra.enviar.map((i) => i.id)).toEqual(["a"]);
    expect(estadoDepoisDoAviso(outra, { ok: true, agora: brt("2026-11-04", "15:05") }).ultimaFalha).toBeNull();
  });

  it("o estado gravado é lido com tolerância", () => {
    expect(lerEstadoAvisoResgate(null)).toEqual({ avisados: {}, ultimoEnvio: null, ultimaFalha: null });
    expect(lerEstadoAvisoResgate("lixo")).toEqual({ avisados: {}, ultimoEnvio: null, ultimaFalha: null });
    expect(lerEstadoAvisoResgate({ avisados: { a: "x", b: 3 }, ultimoEnvio: "" })).toEqual({ avisados: { a: "x" }, ultimoEnvio: null, ultimaFalha: null });
  });
});

// ---------------------------------------------------------------- de verdade

const robo = vi.hoisted(() => ({ ligado: true, linhas: [] as LinhaRobo[] }));
vi.mock("@/lib/robo/client", () => ({
  isRoboConfigured: () => true,
  roboLigado: async () => robo.ligado,
  lerLeadsDoRobo: async () => robo.linhas.map((l) => ({ ...l })),
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "robo-aviso-"));
const envAntes = { ...process.env };

type Mods = {
  avisar: typeof import("@/lib/robo/avisar-resgate");
  avisos: typeof import("@/lib/avisos");
  sync: typeof import("@/lib/robo/sync");
  store: typeof import("@/lib/data/store");
  backend: typeof import("@/lib/data/backend");
};
let m: Mods;

/** O que chegou ao n8n. */
const postados: { url: string; corpo: Record<string, unknown>; headers: Record<string, string> }[] = [];
let respostaDoN8n = 200;

beforeAll(async () => {
  process.env.LOCAL_DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_URL;
  process.env.PAINEL_URL = "https://painel.exemplo/";
  process.env.N8N_LEAD_WEBHOOK_SECRET = "segredo";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      postados.push({ url, corpo: JSON.parse(String(init?.body ?? "{}")), headers: (init?.headers ?? {}) as Record<string, string> });
      return new Response("{}", { status: respostaDoN8n });
    }),
  );
  vi.resetModules();
  m = {
    avisar: await import("@/lib/robo/avisar-resgate"),
    avisos: await import("@/lib/avisos"),
    sync: await import("@/lib/robo/sync"),
    store: await import("@/lib/data/store"),
    backend: await import("@/lib/data/backend"),
  };
}, 60_000);

afterAll(() => {
  vi.unstubAllGlobals();
  process.env = envAntes;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  postados.length = 0;
  respostaDoN8n = 200;
  robo.ligado = true;
  robo.linhas = [];
  process.env.N8N_RESGATE_WEBHOOK_URL = "https://n8n.exemplo/webhook/resgate";
  process.env.N8N_LEAD_WEBHOOK_URL = "https://n8n.exemplo/webhook/lead";
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

let seq = 0;
const lead = (id: string, extra: Partial<Lead> = {}): Lead => ({
  id,
  brand: "consorcio",
  createdAt: brt("2026-11-04", "09:00"),
  name: `Pessoa ${id} da Silva`,
  phone: `(11) 98765-${String(1000 + ++seq)}`,
  email: `${id}@exemplo.com`,
  status: "lead",
  classe: undefined,
  ...extra,
});

/** Uma leitura do robô que deu certo, terminada em `em` (é o `lidoAte`). */
const leituraOk = (em: string) =>
  m.store.addSyncRun({ id: `SYNC-${em}`, source: "robo", brand: "consorcio", startedAt: em, finishedAt: em, ok: true, rows: 0 });

const estado = async () => lerEstadoAvisoResgate(await m.store.getState(m.backend.STATE_KEYS.avisoResgate));

describe("avisarResgate e avisarLeadNovo — o corpo que vai ao n8n", () => {
  it("resgate: webhook próprio, segredo, link da Fila e da ficha — sem telefone, e-mail, classe nem conversa", async () => {
    const ok = await m.avisos.avisarResgate({
      marca: "consorcio",
      itens: Array.from({ length: 25 }, (_, i) => item(`L${i}`)),
      total: 30,
      agora: brt("2026-11-04", "15:00"),
    });
    expect(ok).toBe(true);
    expect(postados).toHaveLength(1);
    const [{ url, corpo, headers }] = postados;
    expect(url).toBe("https://n8n.exemplo/webhook/resgate");
    expect(headers["x-painel-secret"]).toBe("segredo");
    expect(corpo).toMatchObject({ evento: "resgate", marca: "consorcio", total: 30, novos: 25, fila: "https://painel.exemplo/fila?etapa=resgate#resgate" });
    const itens = corpo.itens as Record<string, unknown>[];
    expect(itens).toHaveLength(20);
    expect(Object.keys(itens[0]).sort()).toEqual(["desde", "ficha", "id", "motivo", "primeiroNome"]);
    expect(itens[0].ficha).toBe("https://painel.exemplo/leads/L0");
  });

  it("resgate: o lead que a API do n8n criou sem event_id (LEAD-WA-<whatsapp>) vai SEM o id e sem o link da ficha", async () => {
    const ok = await m.avisos.avisarResgate({
      marca: "consorcio",
      itens: [
        { ...item("LEAD-WA-5511987650001"), primeiroNome: "Maria" },
        { ...item("LEAD-WA-5511987650002-m1x2"), primeiroNome: "João" },
        { ...item("LEAD-LP-abc"), primeiroNome: "Ana" },
      ],
      total: 3,
      agora: brt("2026-11-04", "15:00"),
    });
    expect(ok).toBe(true);
    const corpo = postados[0].corpo;
    const itens = corpo.itens as Record<string, unknown>[];
    expect(itens.map((i) => [i.id, i.ficha])).toEqual([
      [null, null],
      [null, null],
      ["LEAD-LP-abc", "https://painel.exemplo/leads/LEAD-LP-abc"],
    ]);
    expect(itens[0]).toMatchObject({ primeiroNome: "Maria", motivo: "robo-nao-falou" });
    // Nenhum telefone em lugar nenhum do corpo.
    expect(JSON.stringify(corpo)).not.toMatch(/98765000[12]/);
  });

  it("sem a variável do webhook de resgate: não avisa (nem tenta)", async () => {
    delete process.env.N8N_RESGATE_WEBHOOK_URL;
    expect(await m.avisos.avisarResgate({ marca: "consorcio", itens: [item("a")], total: 1, agora: brt("2026-11-04", "15:00") })).toBe(false);
    expect(postados).toHaveLength(0);
    expect(m.avisos.avisoDeResgateConfigurado()).toBe(false);
  });

  it("lead novo com o robô ligado: o link vai para a ficha e o payload diz robo: true; desligado, a Fila em 'Novos'", async () => {
    const l = lead("novo1");
    await m.avisos.avisarLeadNovo(l, "lead_novo", { robo: true });
    await m.avisos.avisarLeadNovo(l);
    expect(postados.map((p) => p.url)).toEqual(["https://n8n.exemplo/webhook/lead", "https://n8n.exemplo/webhook/lead"]);
    expect(postados[0].corpo).toMatchObject({ evento: "lead_novo", robo: true, fila: "https://painel.exemplo/leads/novo1", ficha: "https://painel.exemplo/leads/novo1" });
    expect(postados[1].corpo).toMatchObject({ evento: "lead_novo", fila: "https://painel.exemplo/fila?etapa=novo" });
    expect(postados[1].corpo).not.toHaveProperty("robo");
  });
});

describe("avisarResgateSePreciso — o aviso de verdade (a MESMA Fila, o MESMO estado do robô)", () => {
  it("avisa quem entrou no resgate uma vez; a rodada seguinte não repete; gente nova sai depois da janela", async () => {
    await m.store.addLead(lead("A1", { createdAt: brt("2026-11-04", "11:00") })); // robô não falou desde 13:00
    await m.store.addLead(lead("A2", { createdAt: brt("2026-11-04", "11:30"), phone: undefined })); // sem telefone
    await m.store.addLead(lead("A3", { createdAt: brt("2026-11-04", "14:30") })); // ainda com o robô
    await m.store.addLead(lead("A4", { createdAt: brt("2026-11-04", "11:00"), classe: "A" })); // live: fora
    await leituraOk(brt("2026-11-04", "14:58"));

    const r1 = await m.avisar.avisarResgateSePreciso(brt("2026-11-04", "15:00"));
    expect(r1).toMatchObject({ enviado: true, novos: 2, total: 2 });
    expect(postados).toHaveLength(1);
    const corpo = postados[0].corpo;
    expect((corpo.itens as ItemResgate[]).map((i) => [i.id, i.motivo, i.primeiroNome])).toEqual([
      ["A2", "sem-telefone", "Pessoa"],
      ["A1", "robo-nao-falou", "Pessoa"],
    ]);
    // Nada de PII no corpo.
    const texto = JSON.stringify(corpo);
    expect(texto).not.toMatch(/98765|@exemplo\.com|da Silva/);
    expect(Object.keys(await estado().then((e) => e.avisados))).toHaveLength(2);

    // 20 min depois, nada novo: não avisa de novo.
    await leituraOk(brt("2026-11-04", "15:18"));
    expect(await m.avisar.avisarResgateSePreciso(brt("2026-11-04", "15:20"))).toMatchObject({ enviado: false, espera: "nada-novo" });
    expect(postados).toHaveLength(1);

    // A3 passou das 2 h (16:30): entrada nova, aviso novo — só dela.
    await leituraOk(brt("2026-11-04", "16:40"));
    const r3 = await m.avisar.avisarResgateSePreciso(brt("2026-11-04", "16:45"));
    expect(r3).toMatchObject({ enviado: true, novos: 1, total: 3 });
    expect((postados[1].corpo.itens as ItemResgate[]).map((i) => i.id)).toEqual(["A3"]);
  });

  it("o n8n fora do ar: não marca ninguém, guarda a falha e repete na rodada seguinte", async () => {
    await m.store.addLead(lead("B1", { createdAt: brt("2026-11-05", "09:00") }));
    await leituraOk(brt("2026-11-05", "11:28"));
    respostaDoN8n = 500;
    const r = await m.avisar.avisarResgateSePreciso(brt("2026-11-05", "11:30"));
    expect(r).toMatchObject({ enviado: false, espera: "falhou" });
    const depois = await estado();
    expect(depois.ultimaFalha).toMatchObject({ em: brt("2026-11-05", "11:30") });
    expect(Object.keys(depois.avisados).some((k) => k.startsWith("B1:"))).toBe(false);

    respostaDoN8n = 200;
    await leituraOk(brt("2026-11-05", "11:43"));
    const de_novo = await m.avisar.avisarResgateSePreciso(brt("2026-11-05", "11:45"));
    expect(de_novo.enviado).toBe(true);
    expect((postados.at(-1)!.corpo.itens as ItemResgate[]).map((i) => i.id)).toContain("B1");
    expect((await estado()).ultimaFalha).toBeNull();
  });

  it("sem o webhook, ou com o robô desligado: não faz nada (nem toca o estado)", async () => {
    await m.store.addLead(lead("C1", { createdAt: brt("2026-11-05", "09:00") }));
    const antes = await m.store.getState(m.backend.STATE_KEYS.avisoResgate);
    delete process.env.N8N_RESGATE_WEBHOOK_URL;
    expect(await m.avisar.avisarResgateSePreciso(brt("2026-11-05", "14:00"))).toMatchObject({ enviado: false, espera: "desligado" });
    process.env.N8N_RESGATE_WEBHOOK_URL = "https://n8n.exemplo/webhook/resgate";
    robo.ligado = false;
    expect(await m.avisar.avisarResgateSePreciso(brt("2026-11-05", "14:00"))).toMatchObject({ enviado: false, espera: "desligado" });
    expect(postados).toHaveLength(0);
    expect(await m.store.getState(m.backend.STATE_KEYS.avisoResgate)).toEqual(antes);
  });

  it("o fim do sync do robô avisa só nas origens cron e manual — a carona nunca avisa", async () => {
    await m.store.addLead(lead("D1", { createdAt: brt("2026-11-06", "09:00") }));
    // Uma linha do robô de outra pessoa: a leitura não é "zero inesperado".
    robo.linhas = [
      {
        sessionId: "S-outra",
        telefone: "5511900000000",
        status: null,
        statusAtendimento: null,
        turno: 0,
        conviteEnviado: false,
        conviteEnviadoEm: null,
        transferidoEm: null,
        criadoEm: brt("2026-11-06", "08:00"),
        ultimaInteracao: brt("2026-11-06", "08:00"),
        saudacaoEm: null,
        ultimaMsgClienteEm: null,
        followupsEnviados: 0,
        ultimoFollowupEm: null,
        roboEncerradoEm: null,
        optOut: false,
        optOutEm: null,
        botPausado: false,
      },
    ];
    const carona = await m.sync.sincronizarRobo({ origem: "carona", agora: brt("2026-11-06", "12:00") });
    expect(carona.ok).toBe(true);
    expect(postados).toHaveLength(0);
    const cron = await m.sync.sincronizarRobo({ origem: "cron", agora: brt("2026-11-06", "12:15") });
    expect(cron.ok).toBe(true);
    expect(postados).toHaveLength(1);
    expect((postados[0].corpo.itens as ItemResgate[]).map((i) => i.id)).toContain("D1");
  });

  it("o 'total' do corpo é o do grupo Resgate que o link abre: com o 'não compareceu', sem quem a cadência escondeu", async () => {
    const dia = "2026-11-10"; // terça
    await m.store.addLead(lead("E1", { createdAt: brt(dia, "09:00") })); // o robô não falou: no grupo e avisável
    await m.store.addLead(lead("E2", { createdAt: brt(dia, "09:00") })); // idem, mas o comercial ligou às 14:00
    await m.store.addLeadEvent({
      id: "T-E2",
      leadId: "E2",
      brand: "consorcio",
      leadName: "x",
      actor: "ana",
      action: "tentativa",
      occurredAt: brt(dia, "14:00"),
      createdAt: brt(dia, "14:00"),
      payload: { canal: "whatsapp", falou: "nao", proxima: brt(dia, "16:00") },
    });
    // Faltou à reunião: no grupo, mas não é motivo de aviso.
    await m.store.addLead(lead("E3", { createdAt: brt("2026-11-01", "09:00"), status: "no_show", bookedAt: brt("2026-11-02", "10:00"), meetingFor: brt(dia, "10:00") }));
    await leituraOk(brt(dia, "14:58"));

    const agora = brt(dia, "15:00");
    const r = await m.avisar.avisarResgateSePreciso(agora);
    expect(r.enviado).toBe(true);
    const fila = montarFila({
      nowIso: agora,
      leads: await m.store.listLeads("consorcio"),
      eventos: await m.store.listLeadEvents({ brand: "consorcio", limit: 0 }),
      robo: { ligado: true, lidoAte: brt(dia, "14:58"), confiavel: true },
    });
    const grupo = fila.grupos.find((g) => g.etapa === "resgate")!;
    expect(grupo.itens.map((i) => i.leadId)).toContain("E3");
    expect(grupo.itens.map((i) => i.leadId)).not.toContain("E2");
    const corpo = postados.at(-1)!.corpo;
    expect(corpo.total).toBe(grupo.total);
    expect(r.total).toBe(grupo.total);
    // Avisados: as ENTRADAS novas (a cadência não é saída); o não compareceu não avisa.
    const ids = (corpo.itens as ItemResgate[]).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["E1", "E2"]));
    expect(ids).not.toContain("E3");
  });
});
