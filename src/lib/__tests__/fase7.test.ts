/**
 * Fase 7 — integrações de conversão (D9): a CAPI com Lead, Schedule,
 * ReuniaoRealizada e Purchase pela caixa de saída `capi_envios`, com nova
 * tentativa automática dentro da janela de 48 h e "Enviado à Meta ✓" na ficha.
 *
 * O store é um dublê em memória que segue o contrato (atualiza só pendente,
 * reserva atômica, expiração dos vencidos); os três backends reais passam pelo
 * mesmo contrato em store-contract.test.ts.
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CapiEnvio, Lead } from "../types";

const mem = vi.hoisted(() => ({
  envios: new Map<string, CapiEnvio>(),
  status: [] as unknown[][],
  eventos: [] as unknown[],
  falharFila: false,
  falharHistorico: false,
}));

vi.mock("../data/store", async () => {
  const { aplicarPatchCapi } = await import("../data/backend");
  const t = (v?: string) => (v ? Date.parse(v) : NaN);
  return {
    addCapiEnvio: async (e: CapiEnvio) => {
      if (mem.falharFila) throw new Error("relation capi_envios does not exist");
      if (mem.envios.has(e.id)) return false;
      mem.envios.set(e.id, structuredClone(e));
      return true;
    },
    updateCapiEnvio: async (id: string, p: Parameters<typeof aplicarPatchCapi>[1]) => {
      const e = mem.envios.get(id);
      if (!e || e.status !== "pendente") return false;
      mem.envios.set(id, aplicarPatchCapi(e, structuredClone(p)));
      return true;
    },
    reservarCapiEnvio: async (id: string, o: { ate: string; vencidoAte?: string; livreDesde?: string; atualizadoEm: string }) => {
      const e = mem.envios.get(id);
      if (!e || e.status !== "pendente") return false;
      if (o.vencidoAte && !(t(e.proximaTentativa) <= t(o.vencidoAte))) return false;
      if (o.livreDesde && !(t(e.atualizadoEm) <= t(o.livreDesde))) return false;
      mem.envios.set(id, { ...e, proximaTentativa: o.ate, atualizadoEm: o.atualizadoEm });
      return true;
    },
    expirarCapiVencidos: async (o: { eventoAntesDe: string; motivo: string; atualizadoEm: string }) => {
      let n = 0;
      for (const [id, e] of mem.envios) {
        const reservada = e.proximaTentativa && t(e.proximaTentativa) > t(o.atualizadoEm);
        if (e.status === "pendente" && t(e.eventTime) < t(o.eventoAntesDe) && !reservada) {
          n++;
          mem.envios.set(id, { ...e, status: "expirado", motivo: "janela", payload: null, proximaTentativa: undefined, ultimoErro: e.ultimoErro ?? o.motivo, atualizadoEm: o.atualizadoEm });
        }
      }
      return n;
    },
    listCapiEnvios: async (o: { devidosAte?: string; leadId?: string; status?: string; limit?: number }) => {
      let l = [...mem.envios.values()];
      if (o.leadId) l = l.filter((e) => e.leadId === o.leadId);
      if (o.devidosAte) l = l.filter((e) => e.status === "pendente" && t(e.proximaTentativa) <= t(o.devidosAte));
      else if (o.status) l = l.filter((e) => e.status === o.status);
      l.sort((a, b) => t(a.proximaTentativa) - t(b.proximaTentativa));
      return (o.limit ? l.slice(0, o.limit) : l).map((e) => structuredClone(e));
    },
    setLeadStatus: async (...a: unknown[]) => {
      mem.status.push(a);
    },
    addLeadEvent: async (e: unknown) => {
      if (mem.falharHistorico) throw new Error("connection terminated");
      mem.eventos.push(e);
    },
  };
});
vi.mock("../auth/actor", () => ({
  currentActor: async () => "teste",
  newEventId: () => `ev-${Math.random().toString(36).slice(2)}`,
}));

import { hashTelefone, hashTexto, montarEventoCapi, postarEventoCapi } from "../meta/capi";
import { enviarParaMeta, reenviarPendentes, tentarEnvio } from "../meta/capi-envios";
import {
  ESPERAS_MINUTOS,
  JANELA_REENVIO_HORAS,
  MARGEM_FINAL_MINUTOS,
  alertasDaCapi,
  entradasDaMeta,
  erroPermanente,
  estadoDaCapi,
  estadoDoCronCapi,
  expirouJanela,
  mensagemDoErroCapi,
  proximaTentativaCapi,
  resumoDosEnvios,
} from "../capi-politica";
import { aplicarStatus, eventosDaMudanca } from "../leads/mudar-status";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const T0 = "2026-10-14T12:00:00.000Z";
const mais = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString();
const H = 60;
const ID = "Schedule:schedule-LEAD-LP-111";

const lead = (extra: Partial<Lead> = {}): Lead => ({
  id: "LEAD-LP-111",
  brand: "consorcio",
  createdAt: "2026-10-13T12:00:00.000Z",
  name: "Pessoa Exemplo Silva",
  email: "  Pessoa.Exemplo@Exemplo.com ",
  phone: "(11) 98765-4321",
  fbc: "fb.1.1700000000000.AbCdEf",
  fbp: "fb.1.1700000000000.123456789",
  status: "lead",
  ...extra,
});

/** Resposta da Graph API. */
const resposta = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const OK = () => resposta(200, { events_received: 1, fbtrace_id: "TRACE" });

function buscador(...respostas: Array<Response | Error>) {
  const chamadas: { url: string; corpo: Record<string, unknown> }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), corpo: JSON.parse(String(init?.body ?? "{}")) });
    const r = respostas.shift() ?? OK();
    if (r instanceof Error) throw r;
    return r;
  });
  return { fn: fn as unknown as typeof fetch, chamadas };
}

beforeEach(() => {
  mem.envios.clear();
  mem.status.length = 0;
  mem.eventos.length = 0;
  mem.falharFila = false;
  mem.falharHistorico = false;
  vi.stubEnv("META_DATASET_ID", "9876543210");
  vi.stubEnv("META_CAPI_TOKEN", "TOKEN-DE-TESTE");
  vi.stubEnv("META_CAPI_TEST_EVENT_CODE", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- o evento

describe("7.1 — o evento montado segue as regras da Meta", () => {
  const ev = montarEventoCapi({
    eventName: "Lead",
    eventId: "lp-abc-123",
    eventTime: T0,
    eventSourceUrl: "https://lp.exemplo.com/",
    user: {
      email: "  Pessoa.Exemplo@Exemplo.com ",
      phone: "(11) 98765-4321",
      firstName: "José",
      fbc: "fb.1.1700000000000.AbCdEf",
      fbp: "fb.1.1700000000000.123456789",
      ip: "203.0.113.7",
      userAgent: "Mozilla/5.0 (Teste)",
      externalId: "LEAD-LP-111",
    },
    customData: { currency: "BRL" },
  });
  const u = ev.user_data as Record<string, unknown>;

  it("PII em SHA-256 depois de normalizar: e-mail minúsculo e sem espaço; telefone com 55; acento mantido", () => {
    expect(u.em).toEqual([sha("pessoa.exemplo@exemplo.com")]);
    expect(u.ph).toEqual([sha("5511987654321")]);
    expect(u.fn).toEqual([sha("josé")]);
    expect(u.external_id).toEqual([sha("lead-lp-111")]);
    expect(hashTelefone("+55 (11) 98765-4321")).toBe(sha("5511987654321"));
    expect(hashTexto("   ")).toBeUndefined();
  });

  it("fbc, fbp, IP e navegador vão CRUS — em hash a Meta não pareia", () => {
    expect(u.fbc).toBe("fb.1.1700000000000.AbCdEf");
    expect(u.fbp).toBe("fb.1.1700000000000.123456789");
    expect(u.client_ip_address).toBe("203.0.113.7");
    expect(u.client_user_agent).toBe("Mozilla/5.0 (Teste)");
  });

  it("event_time em segundos do instante do fato; o id e o nome que deduplicam com o Pixel", () => {
    expect(ev).toMatchObject({
      event_name: "Lead",
      event_id: "lp-abc-123",
      event_time: Date.parse(T0) / 1000,
      action_source: "website",
      event_source_url: "https://lp.exemplo.com/",
      custom_data: { currency: "BRL" },
    });
  });
});

describe("7.1 — a chamada: token na query, test_event_code no nível de cima", () => {
  it("token só na URL, nunca no corpo; test_event_code ao lado de `data`, não dentro", async () => {
    vi.stubEnv("META_CAPI_TEST_EVENT_CODE", "TEST123");
    const { fn, chamadas } = buscador();
    const r = await postarEventoCapi({ event_name: "Lead", event_id: "x" }, { buscar: fn });
    expect(r).toMatchObject({ ok: true, teste: true, recebidos: 1, fbtraceId: "TRACE" });
    expect(chamadas[0].url).toContain("/9876543210/events?access_token=TOKEN-DE-TESTE");
    expect(JSON.stringify(chamadas[0].corpo)).not.toContain("TOKEN-DE-TESTE");
    expect(chamadas[0].corpo.test_event_code).toBe("TEST123");
    expect((chamadas[0].corpo.data as Record<string, unknown>[])[0]).not.toHaveProperty("test_event_code");
  });

  it("evento REAL nunca sai com test_event_code, mesmo com a variável ligada", async () => {
    vi.stubEnv("META_CAPI_TEST_EVENT_CODE", "TEST123");
    const { fn, chamadas } = buscador();
    expect(await postarEventoCapi({}, { buscar: fn, modoTeste: false })).toMatchObject({ ok: true, teste: false });
    expect(chamadas[0].corpo).not.toHaveProperty("test_event_code");
  });

  it("erro da Meta (com subcódigo) e erro de rede viram resposta — nunca exceção", async () => {
    const { fn } = buscador(
      resposta(400, { error: { message: "Unsupported post request", code: 100, error_subcode: 33 } }),
      new Error("ECONNRESET"),
    );
    expect(await postarEventoCapi({}, { buscar: fn })).toMatchObject({ ok: false, http: 400, codigo: 100, subcodigo: 33 });
    expect(await postarEventoCapi({}, { buscar: fn })).toMatchObject({ ok: false, http: 0, detalhe: "ECONNRESET" });
  });
});

// ---------------------------------------------------------------- a política

describe("7.1 — nova tentativa: só dentro das 48 h da deduplicação", () => {
  it("5 min, 15 min, 1 h, 3 h, 6 h e, daí em diante, 12 h", () => {
    expect(ESPERAS_MINUTOS).toEqual([5, 15, 60, 180, 360, 720]);
    expect(proximaTentativaCapi(1, T0, T0)).toBe(mais(T0, 5));
    expect(proximaTentativaCapi(3, T0, T0)).toBe(mais(T0, 60));
    expect(proximaTentativaCapi(9, T0, T0)).toBe(mais(T0, 720));
  });

  it("a última tentativa vai para 30 min antes do fim da janela — não desiste 12 h antes da hora", () => {
    const fim = mais(T0, JANELA_REENVIO_HORAS * H);
    // Às 40 h, a espera de 12 h cairia fora: a última tentativa fica para 47 h 30.
    expect(proximaTentativaCapi(7, T0, mais(T0, 40 * H))).toBe(mais(fim, -MARGEM_FINAL_MINUTOS));
    // Já na margem: desiste.
    expect(proximaTentativaCapi(8, T0, mais(fim, -MARGEM_FINAL_MINUTOS))).toBeNull();
    expect(expirouJanela(T0, fim)).toBe(true);
    expect(expirouJanela(T0, mais(fim, -1))).toBe(false);
  });

  it("só a recusa do PRÓPRIO evento (100 + subcódigo 2804xxx) é permanente; dataset/permissão (100/33) e token (190) seguem na fila", () => {
    expect(erroPermanente({ detalhe: "", http: 400, codigo: 100, subcodigo: 2804019 })).toBe(true);
    expect(erroPermanente({ detalhe: "", http: 400, codigo: 100, subcodigo: 33 })).toBe(false);
    expect(erroPermanente({ detalhe: "", http: 400, codigo: 100 })).toBe(false);
    expect(erroPermanente({ detalhe: "", http: 400, codigo: 190 })).toBe(false);
    expect(mensagemDoErroCapi({ detalhe: "", http: 400, codigo: 100, subcodigo: 33 })).toContain("META_DATASET_ID");
    expect(mensagemDoErroCapi({ detalhe: "", http: 400, codigo: 190 })).toContain("token da CAPI");
    expect(mensagemDoErroCapi({ detalhe: "x", http: 0 })).toContain("não respondeu");
    expect(mensagemDoErroCapi({ detalhe: "x", http: 503 })).toContain("fora do ar");
    // O texto para pessoas nunca carrega o erro técnico cru.
    expect(mensagemDoErroCapi({ detalhe: "(#100) Invalid parameter", http: 400, codigo: 100, subcodigo: 2804019 })).not.toContain("#100");
  });
});

// ---------------------------------------------------------------- a caixa de saída

const pedido = (extra: Partial<Parameters<typeof enviarParaMeta>[0]> = {}) => ({
  brand: "consorcio" as const,
  leadId: "LEAD-LP-111",
  eventName: "Schedule" as const,
  eventId: "schedule-LEAD-LP-111",
  eventTime: T0,
  actionSource: "system_generated" as const,
  user: { email: "a@exemplo.com", phone: "11987654321", externalId: "LEAD-LP-111" },
  ...extra,
});

describe("7.1 — caixa de saída: grava antes de postar, reenvia e esquece o IP depois", () => {
  it("deu certo de primeira: 'enviado', 1 tentativa, payload apagado", async () => {
    const { fn } = buscador();
    expect(await enviarParaMeta(pedido(), { agora: new Date(T0), buscar: fn })).toEqual({ estado: "enviado", teste: false });
    const e = mem.envios.get(ID)!;
    expect(e).toMatchObject({ status: "enviado", tentativas: 1, enviadoEm: T0, fbtraceId: "TRACE", teste: false });
    expect(e.payload).toBeNull();
    expect(e.proximaTentativa).toBeUndefined();
  });

  it("o mesmo fato de novo não entra na fila nem sai outra vez", async () => {
    const { fn } = buscador();
    await enviarParaMeta(pedido(), { agora: new Date(T0), buscar: fn });
    expect(await enviarParaMeta(pedido(), { agora: new Date(mais(T0, 1)), buscar: fn })).toEqual({ estado: "ja-na-fila" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("Meta fora do ar → pendente com o MESMO evento guardado; o reenvio manda igual (mesmo event_time) e fecha", async () => {
    const { fn, chamadas } = buscador(resposta(503, { error: { message: "Service unavailable", code: 2 } }));
    expect((await enviarParaMeta(pedido(), { agora: new Date(T0), buscar: fn })).estado).toBe("pendente");
    let e = mem.envios.get(ID)!;
    expect(e).toMatchObject({ status: "pendente", tentativas: 1, proximaTentativa: mais(T0, 5), ultimoErro: "A Meta estava fora do ar nesta tentativa." });
    expect(e.payload).not.toBeNull();

    expect(await reenviarPendentes({ agora: new Date(mais(T0, 4)), buscar: fn })).toMatchObject({ tentados: 0 });
    expect(await reenviarPendentes({ agora: new Date(mais(T0, 6)), buscar: fn })).toMatchObject({ tentados: 1, enviados: 1 });
    expect(chamadas[1].corpo.data).toEqual(chamadas[0].corpo.data);
    e = mem.envios.get(ID)!;
    expect(e).toMatchObject({ status: "enviado", tentativas: 2 });
    expect(e.ultimoErro).toBeUndefined();
    expect(e.payload).toBeNull();
  });

  it("dataset errado ou token sem acesso (100/33) NÃO desiste: corrigida a variável, o reenvio passa", async () => {
    const { fn } = buscador(resposta(400, { error: { message: "Unsupported post request", code: 100, error_subcode: 33 } }));
    expect((await enviarParaMeta(pedido(), { agora: new Date(T0), buscar: fn })).estado).toBe("pendente");
    expect(mem.envios.get(ID)?.ultimoErro).toContain("META_DATASET_ID");
    expect(mem.envios.get(ID)?.payload).not.toBeNull();
    expect(await reenviarPendentes({ agora: new Date(mais(T0, 10)), buscar: fn })).toMatchObject({ enviados: 1 });
  });

  it("recusa do próprio evento (100 + 2804xxx) desiste na hora, com o porquê e sem guardar o evento", async () => {
    const { fn } = buscador(resposta(400, { error: { message: "(#100) Invalid parameter", code: 100, error_subcode: 2804019 } }));
    expect((await enviarParaMeta(pedido(), { agora: new Date(T0), buscar: fn })).estado).toBe("nao-chegou");
    const e = mem.envios.get(ID)!;
    expect(e).toMatchObject({ status: "expirado", tentativas: 1, motivo: "recusado" });
    expect(e.payload).toBeNull();
    expect(e.ultimoErro).toContain("recusou um dado");
  });

  it("falhando até o fim da janela: a última tentativa é 30 min antes do fim, depois desiste e apaga o evento", async () => {
    const falhas = Array.from({ length: 30 }, () => resposta(500, { error: { message: "x" } }));
    const { fn } = buscador(...falhas);
    await enviarParaMeta(pedido(), { agora: new Date(T0), buscar: fn });
    const horarios: string[] = [];
    for (let i = 0; i < 30; i++) {
      const e = mem.envios.get(ID)!;
      if (e.status !== "pendente") break;
      horarios.push(e.proximaTentativa!);
      await reenviarPendentes({ agora: new Date(e.proximaTentativa!), buscar: fn });
    }
    const e = mem.envios.get(ID)!;
    expect(e).toMatchObject({ status: "expirado", motivo: "janela" });
    expect(e.payload).toBeNull();
    expect(horarios.at(-1)).toBe(mais(T0, JANELA_REENVIO_HORAS * H - MARGEM_FINAL_MINUTOS));
    // A ficha diz que foi a JANELA (a Meta estava fora do ar), não "daria o mesmo erro".
    const [linha] = entradasDaMeta([e], mais(T0, JANELA_REENVIO_HORAS * H));
    expect(linha.texto).toContain("Passou da janela de 48 h");
    expect(linha.texto).not.toContain("daria o mesmo erro");
  });

  it("pendente que só é visto depois das 48 h não é postado: vira 'não chegou'", async () => {
    const { fn } = buscador(resposta(500, {}));
    await enviarParaMeta(pedido(), { agora: new Date(T0), buscar: fn });
    const e = mem.envios.get(ID)!;
    expect((await tentarEnvio(e, { agora: new Date(mais(T0, 49 * H)), buscar: fn })).estado).toBe("nao-chegou");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("o botão força: reenvia o pendente sem esperar a vez dele (depois de trocar o token)", async () => {
    const { fn } = buscador(resposta(400, { error: { code: 190, message: "Invalid OAuth access token" } }));
    await enviarParaMeta(pedido(), { agora: new Date(T0), buscar: fn });
    expect(mem.envios.get(ID)?.proximaTentativa).toBe(mais(T0, 5));
    expect(await reenviarPendentes({ agora: new Date(mais(T0, 3)), buscar: fn })).toMatchObject({ tentados: 0 });
    expect(await reenviarPendentes({ agora: new Date(mais(T0, 3)), buscar: fn, forcar: true })).toMatchObject({ tentados: 1, enviados: 1 });
  });

  it("…mas nem forçando pega a linha que alguém está postando AGORA (reserva viva)", async () => {
    const { fn } = buscador(resposta(500, {}));
    await enviarParaMeta(pedido(), { agora: new Date(T0), buscar: fn });
    // A linha acabou de ser mexida (tentativa em T0): por 2 min ninguém mais a posta.
    expect(await reenviarPendentes({ agora: new Date(mais(T0, 1)), buscar: fn, forcar: true })).toMatchObject({ tentados: 0 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cron, carona e botão ao mesmo tempo: a reserva deixa UM só postar a linha", async () => {
    const { fn } = buscador(resposta(500, {}));
    await enviarParaMeta(pedido(), { agora: new Date(T0), buscar: fn });
    const agora = new Date(mais(T0, 6));
    const [a, b] = await Promise.all([reenviarPendentes({ agora, buscar: fn }), reenviarPendentes({ agora, buscar: fn })]);
    expect(a.tentados + b.tentados).toBe(1);
    expect(fn).toHaveBeenCalledTimes(2); // a 1ª tentativa e UM reenvio
  });

  it("uma desistência atrasada (foto velha da linha) não rebaixa um 'enviado'", async () => {
    const { fn } = buscador(resposta(500, {}));
    await enviarParaMeta(pedido(), { agora: new Date(T0), buscar: fn });
    const fotoVelha = structuredClone(mem.envios.get(ID)!);
    await reenviarPendentes({ agora: new Date(mais(T0, 6)), buscar: fn });
    expect(mem.envios.get(ID)?.status).toBe("enviado");
    await tentarEnvio(fotoVelha, { agora: new Date(mais(T0, 49 * H)), buscar: fn });
    expect(mem.envios.get(ID)?.status).toBe("enviado");
  });

  it("o modo fica o da ENTRADA: real enfileirado sai real mesmo com o teste ligado depois", async () => {
    const { fn, chamadas } = buscador(resposta(500, {}));
    await enviarParaMeta(pedido(), { agora: new Date(T0), buscar: fn });
    vi.stubEnv("META_CAPI_TEST_EVENT_CODE", "TEST123");
    await reenviarPendentes({ agora: new Date(mais(T0, 6)), buscar: fn });
    expect(chamadas[1].corpo).not.toHaveProperty("test_event_code");
    expect(mem.envios.get(ID)).toMatchObject({ status: "enviado", teste: false });
  });

  it("…e o de teste nunca vira produção: desligado o teste, ele desiste sem postar", async () => {
    vi.stubEnv("META_CAPI_TEST_EVENT_CODE", "TEST123");
    const { fn } = buscador(resposta(500, {}));
    await enviarParaMeta(pedido(), { agora: new Date(T0), buscar: fn });
    vi.stubEnv("META_CAPI_TEST_EVENT_CODE", "");
    await reenviarPendentes({ agora: new Date(mais(T0, 6)), buscar: fn });
    expect(fn).toHaveBeenCalledTimes(1);
    const e = mem.envios.get(ID)!;
    expect(e).toMatchObject({ status: "expirado", teste: true, motivo: "teste" });
    expect(e.payload).toBeNull();
    expect(e.ultimoErro).toContain("modo de teste");
    // Não é perda: nem "não chegou", nem alerta vermelho no go-live.
    const resumo = resumoDosEnvios([e], mais(T0, 7));
    expect(resumo).toMatchObject({ naoChegaram: 0, testesDescartados: 1 });
    expect(alertasDaCapi({ configurada: true, teste: false, producao: true, resumo })).toEqual([]);
    expect(entradasDaMeta([e], mais(T0, 7))[0].texto).toContain("Evento de teste descartado");
  });

  it("sem dataset e token nada é gravado — a fila não enche de envio que nunca sai", async () => {
    vi.stubEnv("META_CAPI_TOKEN", "");
    const { fn } = buscador();
    expect(await enviarParaMeta(pedido(), { buscar: fn })).toEqual({ estado: "nao-configurado" });
    expect(mem.envios.size).toBe(0);
    expect(await reenviarPendentes({ buscar: fn })).toMatchObject({ naoConfigurado: true, tentados: 0 });
  });

  it("LGPD: com a CAPI desligada, o pendente vencido fecha e o IP guardado some mesmo assim", async () => {
    const { fn } = buscador(resposta(500, {}));
    await enviarParaMeta(pedido(), { agora: new Date(T0), buscar: fn });
    vi.stubEnv("META_CAPI_TOKEN", "");
    const r = await reenviarPendentes({ agora: new Date(mais(T0, 49 * H)), buscar: fn });
    expect(r).toMatchObject({ naoConfigurado: true, vencidos: 1 });
    const e = mem.envios.get(ID)!;
    expect(e).toMatchObject({ status: "expirado", motivo: "janela" });
    expect(e.payload).toBeNull();
  });

  it("a limpeza dos vencidos não fecha a linha que alguém está postando agora", async () => {
    const { fn } = buscador(resposta(500, {}));
    await enviarParaMeta(pedido(), { agora: new Date(T0), buscar: fn });
    // Reservada por um processo que começou a postar (próxima tentativa no futuro).
    const e = mem.envios.get(ID)!;
    mem.envios.set(ID, { ...e, proximaTentativa: mais(T0, 49 * H + 2) });
    await reenviarPendentes({ agora: new Date(mais(T0, 49 * H)), buscar: fn });
    expect(mem.envios.get(ID)?.status).toBe("pendente");
  });

  it("o banco falhou ao enfileirar: nada lança, e uma tentativa direta ainda manda o fato", async () => {
    mem.falharFila = true;
    const { fn } = buscador();
    expect(await enviarParaMeta(pedido(), { agora: new Date(T0), buscar: fn })).toEqual({ estado: "enviado-sem-registro", teste: false });
    const { fn: cai } = buscador(resposta(500, {}));
    expect(await enviarParaMeta(pedido(), { agora: new Date(T0), buscar: cai })).toEqual({ estado: "falha-local" });
  });
});

// ---------------------------------------------------------------- os gatilhos

describe("7.1 — cada evento só na PRIMEIRA vez que o fato acontece (pelo marco)", () => {
  it("agendar manda Schedule; desistir e reagendar NÃO manda outro (o id seria o mesmo)", () => {
    expect(eventosDaMudanca(lead(), "agendado")).toEqual(["Schedule"]);
    const desistiu = lead({ status: "desistencia", bookedAt: "2026-10-13T15:00:00.000Z" });
    expect(eventosDaMudanca(desistiu, "agendado")).toEqual([]);
    // Lead antigo, agendado antes dos marcos existirem: o status já é o fato.
    expect(eventosDaMudanca(lead({ status: "agendado" }), "no_show")).toEqual([]);
  });

  it("compareceu → ReuniaoRealizada; fechou → Purchase; direto a cliente dispara os três fatos", () => {
    const agendado = lead({ status: "agendado", bookedAt: "2026-10-13T15:00:00.000Z" });
    expect(eventosDaMudanca(agendado, "reuniao_realizada")).toEqual(["ReuniaoRealizada"]);
    const realizada = lead({ status: "reuniao_realizada", bookedAt: "x", attendedAt: "y" });
    expect(eventosDaMudanca(realizada, "cliente")).toEqual(["Purchase"]);
    expect(eventosDaMudanca(lead(), "cliente")).toEqual(["Schedule", "ReuniaoRealizada", "Purchase"]);
    // Cliente reaberto e fechado de novo: o marco já existe.
    expect(eventosDaMudanca(lead({ status: "lead", bookedAt: "x", attendedAt: "y", closedAt: "z" }), "cliente")).toEqual([]);
  });

  it("aplicarStatus manda o Schedule COM e-mail e telefone em hash (antes iam só nome, fbc, fbp e id)", async () => {
    const { fn, chamadas } = buscador();
    vi.stubGlobal("fetch", fn);
    const r = await aplicarStatus(lead(), "agendado", { meetingFor: "2026-10-20T13:00:00.000Z" });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Schedule enviado à Meta");
    const metas = chamadas.filter((c) => c.url.includes("graph.facebook.com"));
    expect(metas).toHaveLength(1);
    const ev = (metas[0].corpo.data as Record<string, unknown>[])[0];
    expect(ev).toMatchObject({ event_name: "Schedule", event_id: "schedule-LEAD-LP-111", action_source: "system_generated" });
    const u = ev.user_data as Record<string, unknown>;
    expect(u.em).toEqual([sha("pessoa.exemplo@exemplo.com")]);
    expect(u.ph).toEqual([sha("5511987654321")]);
    expect(u.fn).toEqual([sha("pessoa")]);
    expect(u.fbc).toBe("fb.1.1700000000000.AbCdEf");
    expect(mem.envios.get(ID)?.status).toBe("enviado");
  });

  it("lead que entrou sem nome não manda o primeiro nome falso 'Lead'", async () => {
    const { fn, chamadas } = buscador();
    vi.stubGlobal("fetch", fn);
    await aplicarStatus(lead({ name: "Lead sem nome" }), "agendado", { meetingFor: "2026-10-20T13:00:00.000Z" });
    const u = (chamadas[0].corpo.data as Record<string, unknown>[])[0].user_data as Record<string, unknown>;
    expect(u).not.toHaveProperty("fn");
    expect(u.em).toBeDefined();
  });

  it("virar cliente manda Purchase com o valor; a reunião realizada vai como evento próprio", async () => {
    const { fn, chamadas } = buscador();
    vi.stubGlobal("fetch", fn);
    const agendado = lead({ status: "reuniao_realizada", bookedAt: "x", attendedAt: "y" });
    await aplicarStatus(agendado, "cliente", { value: 250000 });
    const evs = chamadas.map((c) => (c.corpo.data as Record<string, unknown>[])[0]);
    expect(evs.map((e) => e.event_name)).toEqual(["Purchase"]);
    expect(evs[0].custom_data).toMatchObject({ currency: "BRL", value: 250000 });
  });

  it("Meta fora do ar: o status é gravado mesmo assim e a tela diz que a nova tentativa é automática", async () => {
    const { fn } = buscador(resposta(500, {}));
    vi.stubGlobal("fetch", fn);
    const r = await aplicarStatus(lead(), "agendado", { meetingFor: "2026-10-20T13:00:00.000Z" });
    expect(r.ok).toBe(true);
    expect(mem.status).toHaveLength(1);
    expect(r.message).toContain("nova tentativa automática");
  });

  it("histórico falhando depois do status: o Schedule JÁ está na fila (o marco não fica sem evento)", async () => {
    mem.falharHistorico = true;
    const { fn } = buscador();
    vi.stubGlobal("fetch", fn);
    await expect(aplicarStatus(lead(), "agendado", { meetingFor: "2026-10-20T13:00:00.000Z" })).rejects.toThrow();
    expect(mem.status).toHaveLength(1);
    expect(mem.envios.get(ID)?.status).toBe("enviado");
  });

  it("banco fora ao enfileirar: aplicarStatus NÃO lança (o status já foi gravado) e a tela diz o que houve", async () => {
    mem.falharFila = true;
    const { fn } = buscador(resposta(500, {}));
    vi.stubGlobal("fetch", fn);
    const r = await aplicarStatus(lead(), "agendado", { meetingFor: "2026-10-20T13:00:00.000Z" });
    expect(r.ok).toBe(true);
    expect(mem.status).toHaveLength(1);
    expect(r.message).toContain("não conseguiu registrar o envio");
  });
});

// ---------------------------------------------------------------- telas

const envio = (extra: Partial<CapiEnvio>): CapiEnvio => ({
  id: "Lead:lp-1",
  brand: "consorcio",
  leadId: "L1",
  eventName: "Lead",
  eventId: "lp-1",
  eventTime: T0,
  status: "enviado",
  tentativas: 1,
  teste: false,
  criadoEm: T0,
  atualizadoEm: T0,
  enviadoEm: T0,
  ...extra,
});
const AGORA = mais(T0, 10);

describe("7.1 — o que a ficha, Integrações e os alertas dizem", () => {
  it("ficha: ✓ só com a Meta confirmando; modo de teste avisa que não conta; falha diz o porquê", () => {
    const [ok, teste, pend, perdido] = entradasDaMeta(
      [
        envio({}),
        envio({ id: "b", teste: true }),
        envio({ id: "c", eventName: "Schedule", status: "pendente", tentativas: 2, ultimoErro: "A Meta não respondeu (rede ou tempo esgotado).", proximaTentativa: mais(T0, 60) }),
        envio({ id: "d", eventName: "Purchase", status: "expirado", ultimoErro: "A Meta estava fora do ar nesta tentativa." }),
      ],
      AGORA,
    );
    expect(ok).toMatchObject({ tom: "ok", texto: "Enviado à Meta ✓ — Cadastro (Lead)" });
    expect(teste.texto).toContain("não conta nos relatórios");
    expect(pend).toMatchObject({ tom: "pendente" });
    expect(pend.texto).toContain("Ainda não chegou à Meta — Reunião agendada (Schedule) (2 tentativas)");
    expect(perdido).toMatchObject({ tom: "falha" });
    expect(perdido.texto).toContain("Não chegou à Meta — Venda (Purchase)");
    expect(perdido.texto).not.toContain("✓");
  });

  it("ficha: 'não chegou' diz se a Meta recusou o evento (na hora) ou se a janela de 48 h fechou", () => {
    const [recusado, janela] = entradasDaMeta(
      [
        envio({ status: "expirado", motivo: "recusado", ultimoErro: "A Meta recusou um dado do evento — o detalhe está no log do servidor.", atualizadoEm: mais(T0, 1) }),
        // A última tentativa ANTES do fim (47 h 30) falhou: o motivo gravado é a janela, não "recusado".
        envio({ id: "j", status: "expirado", motivo: "janela", ultimoErro: "A Meta estava fora do ar nesta tentativa.", atualizadoEm: mais(T0, JANELA_REENVIO_HORAS * H - 30) }),
      ],
      mais(T0, JANELA_REENVIO_HORAS * H + 10),
    );
    expect(recusado.texto).toContain("daria o mesmo erro");
    expect(recusado.texto).not.toContain("janela");
    expect(janela.texto).toContain("Passou da janela de 48 h");
  });

  it("ficha: com a vez já chegada (e o cron ainda não rodou) não imprime hora no passado", () => {
    const pendente = envio({ status: "pendente", tentativas: 1, ultimoErro: "A Meta estava fora do ar nesta tentativa.", proximaTentativa: mais(T0, 5) });
    const [linha] = entradasDaMeta([pendente], mais(T0, 10));
    expect(linha.texto).toContain("na próxima rodada do reenvio automático");
    expect(linha.texto).not.toContain("Nova tentativa automática em");
  });

  it("ficha: pendente lido com o relógio — vencido há muito diz que o reenvio não rodou; fora da janela é 'não chegou'", () => {
    const pendente = envio({ status: "pendente", tentativas: 1, ultimoErro: "A Meta estava fora do ar nesta tentativa.", proximaTentativa: mais(T0, 5) });
    const [atrasado] = entradasDaMeta([pendente], mais(T0, 3 * H));
    expect(atrasado.texto).toContain("não rodou");
    expect(atrasado.texto).not.toContain("Nova tentativa automática em");
    const [perdido] = entradasDaMeta([pendente], mais(T0, 64 * H));
    expect(perdido).toMatchObject({ tom: "falha" });
    expect(perdido.texto).toContain("Passou da janela");
  });

  it("Integrações: o selo sai dos envios lidos AGORA — perdido, atrasado, teste e sem chave", () => {
    const resumo = resumoDosEnvios([envio({}), envio({ id: "x", status: "expirado", ultimoErro: "erro humano", atualizadoEm: mais(T0, 5) })], AGORA);
    expect(resumo).toMatchObject({ enviados: 1, naoChegaram: 1, ultimoErroPerdido: { texto: "erro humano" } });
    expect(estadoDaCapi({ configurada: true, teste: false, resumo })).toMatchObject({ estado: "falhando", rotulo: "Eventos perdidos" });
    const limpo = resumoDosEnvios([envio({})], AGORA);
    expect(estadoDaCapi({ configurada: true, teste: false, resumo: limpo })).toMatchObject({ estado: "ativo", rotulo: "Conectado" });
    expect(estadoDaCapi({ configurada: true, teste: true, resumo: limpo })).toMatchObject({ rotulo: "Modo de teste" });
    expect(estadoDaCapi({ configurada: false, teste: false, resumo: limpo }).estado).toBe("nao-configurado");
    // O mesmo envio listado duas vezes (7 dias + pendentes de qualquer idade) conta uma.
    const p = envio({ id: "p", status: "pendente", tentativas: 1, proximaTentativa: mais(T0, 5) });
    expect(resumoDosEnvios([p, p], mais(T0, 3 * H))).toMatchObject({ pendentes: 1, atrasados: 1 });
    expect(estadoDaCapi({ configurada: true, teste: false, resumo: resumoDosEnvios([p], mais(T0, 3 * H)) }).rotulo).toBe("Reenvio parado");
    expect(resumoDosEnvios([p], mais(T0, 64 * H))).toMatchObject({ pendentes: 0, naoChegaram: 1 });
  });

  it("cron de reenvio: diz se RODA — nunca rodou, rodando, parado, sem chave", () => {
    const base = { capiConfigurada: true, cronSecret: true, agora: AGORA };
    expect(estadoDoCronCapi({ ...base, ultimaExecucao: null })).toMatchObject({ estado: "nunca", rotulo: "Nunca rodou" });
    expect(estadoDoCronCapi({ ...base, ultimaExecucao: mais(AGORA, -10) })).toMatchObject({ estado: "ativo", rotulo: "Rodando" });
    expect(estadoDoCronCapi({ ...base, ultimaExecucao: mais(AGORA, -3 * H)}).estado).toBe("falhando");
    expect(estadoDoCronCapi({ ...base, cronSecret: false }).estado).toBe("nao-configurado");
  });

  it("alertas: perdido é falha; reenvio parado e reenviando são aviso; modo de teste só em produção; sem CAPI, nada", () => {
    const perdido = resumoDosEnvios([envio({ status: "expirado", ultimoErro: "x" })], AGORA);
    expect(alertasDaCapi({ configurada: true, teste: false, producao: true, resumo: perdido }).map((a) => [a.id, a.nivel])).toEqual([
      ["capi-perdidos", "falha"],
    ]);
    const reenviando = resumoDosEnvios([envio({ status: "pendente", tentativas: 1, proximaTentativa: mais(T0, 15) })], AGORA);
    expect(alertasDaCapi({ configurada: true, teste: false, producao: true, resumo: reenviando })[0].id).toBe("capi-reenviando");
    const parado = resumoDosEnvios([envio({ status: "pendente", tentativas: 1, proximaTentativa: mais(T0, 5) })], mais(T0, 3 * H));
    expect(alertasDaCapi({ configurada: true, teste: false, producao: true, resumo: parado })[0].id).toBe("capi-reenvio-parado");
    // Pendente que ainda não tentou não é problema.
    expect(alertasDaCapi({ configurada: true, teste: false, producao: true, resumo: resumoDosEnvios([envio({ status: "pendente", tentativas: 0, proximaTentativa: mais(T0, 12) })], AGORA) })).toEqual([]);
    expect(alertasDaCapi({ configurada: true, teste: true, producao: false, resumo: resumoDosEnvios([], AGORA) })).toEqual([]);
    expect(alertasDaCapi({ configurada: true, teste: true, producao: true, resumo: resumoDosEnvios([], AGORA) })[0].id).toBe("capi-modo-teste");
    expect(alertasDaCapi({ configurada: false, teste: true, producao: true, resumo: perdido })).toEqual([]);
  });
});
