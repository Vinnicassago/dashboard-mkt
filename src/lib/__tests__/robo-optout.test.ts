/**
 * Fase 1 (nov/26), 11.12 — opt-out (LGPD): quem pediu ao robô para não receber
 * mensagens não recebe WhatsApp do comercial. A tela tira o botão e o canal; o
 * SERVIDOR confere de novo: `registrarContato` (o caminho único da Fila, da ficha e
 * da API do n8n) recusa a tentativa por WhatsApp, com frase humana, sem gravar nada.
 * Roda sobre um JSON local temporário.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "robo-optout-"));
const envAntes = { ...process.env };

type Mods = {
  store: typeof import("@/lib/data/store");
  contato: typeof import("@/lib/leads/registrar-contato");
  n8n: typeof import("@/app/api/n8n/leads/[chave]/route");
};
const TOKEN = "token-de-teste-optout";
let m: Mods;

beforeAll(async () => {
  process.env.LOCAL_DATA_DIR = dir;
  process.env.N8N_API_TOKEN = TOKEN;
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.resetModules();
  m = {
    store: await import("@/lib/data/store"),
    contato: await import("@/lib/leads/registrar-contato"),
    n8n: await import("@/app/api/n8n/leads/[chave]/route"),
  };
}, 60_000);

afterAll(() => {
  process.env = envAntes;
  fs.rmSync(dir, { recursive: true, force: true });
});

const agora = new Date().toISOString();
const novo = (id: string) => ({
  id,
  brand: "consorcio",
  createdAt: agora,
  name: `Pessoa ${id}`,
  phone: { "OPT-1": "5511977770001", "OPT-2": "5511977770002", "OPT-3": "5511977770003" }[id] ?? "5511977770009",
  status: "lead" as const,
});

describe("opt-out: o servidor recusa a tentativa por WhatsApp", () => {
  it("com `roboOptOutEm`: WhatsApp é recusado (nada gravado); ligação passa", async () => {
    await m.store.addLead(novo("OPT-1"));
    await m.store.updateLeadsRobo([{ id: "OPT-1", patch: { roboVistoEm: agora, roboOptOutEm: agora, roboEtapa: "opt_out" } }]);

    const recusada = await m.contato.registrarContato("OPT-1", { canal: "whatsapp", resultado: "nao_atendeu", actor: "ana" });
    expect(recusada.ok).toBe(false);
    expect(recusada.message).toContain("pediu para não receber mensagens");
    expect(recusada.eventoId).toBeUndefined();
    // Nada gravado: nem a tentativa, nem o "Em contato", nem o marco do 1º contato.
    expect((await m.store.listLeadEvents({ leadId: "OPT-1", limit: 0 })).filter((e) => e.action === "tentativa")).toEqual([]);
    const depois = await m.store.getLead("OPT-1");
    expect(depois?.status).toBe("lead");
    expect(depois?.firstContactAt).toBeUndefined();

    const ligacao = await m.contato.registrarContato("OPT-1", { canal: "ligacao", resultado: "nao_atendeu", actor: "ana" });
    expect(ligacao.ok).toBe(true);
    expect((await m.store.getLead("OPT-1"))?.status).toBe("em_contato");
  });

  it("sem opt-out, WhatsApp vale como sempre", async () => {
    await m.store.addLead(novo("OPT-2"));
    const r = await m.contato.registrarContato("OPT-2", { canal: "whatsapp", resultado: "nao_atendeu", actor: "ana" });
    expect(r.ok).toBe(true);
  });
});

/*
 * Etapa C (achado): a recusa vale também para o PATCH da API do n8n (`audio` vira
 * `whatsapp`). Ela é conferida ANTES de qualquer passo: o envio inteiro volta com
 * 409 e nada é gravado — nem a ficha, nem a reunião do mesmo envio (docs/api-n8n.md §2).
 */
describe("opt-out: a API do n8n recusa o envio inteiro (409, nada gravado)", () => {
  const patch = (chave: string, body: unknown) =>
    m.n8n.PATCH(
      new Request(`http://localhost/api/n8n/leads/${chave}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ chave }) },
    );

  it("tentativa por áudio com “Agendou” de quem deu opt-out: 409, sem ficha, sem tentativa, sem reunião", async () => {
    await m.store.addLead(novo("OPT-3"));
    await m.store.updateLeadsRobo([{ id: "OPT-3", patch: { roboVistoEm: agora, roboOptOutEm: agora, roboEtapa: "opt_out" } }]);
    const reuniao = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const res = await patch("5511977770003", {
      horario_preferido: "Noite",
      tentativa: { canal: "audio", resultado: "Agendou" },
      reuniao_em: reuniao,
    });
    expect(res.status).toBe(409);
    const corpo = await res.json();
    expect(corpo.erro).toContain("pediu para não receber mensagens");
    expect(corpo.aplicado).toEqual([]);
    const depois = await m.store.getLead("OPT-3");
    expect(depois?.status).toBe("lead");
    expect(depois?.horarioPreferido).toBeUndefined();
    expect((await m.store.listLeadEvents({ leadId: "OPT-3", limit: 0 })).filter((e) => e.action === "tentativa")).toEqual([]);

    // Por ligação, o mesmo envio passa inteiro.
    const ok = await patch("5511977770003", {
      horario_preferido: "Noite",
      tentativa: { canal: "ligacao", resultado: "Agendou" },
      reuniao_em: reuniao,
    });
    expect(ok.status).toBe(200);
    expect((await m.store.getLead("OPT-3"))?.status).toBe("agendado");
  });
});
