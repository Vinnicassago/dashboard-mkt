/**
 * Migração 0024 num Postgres de verdade (PGlite): a coluna `inscrito_live_em` e o
 * reparo do que chegou ANTES do código (captação aberta em 16/11). O SCHEMA_SQL roda
 * a cada boot — rodar de novo não pode mudar nada, nem com o lead mudando depois.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite as TipoPGlite } from "@electric-sql/pglite";
import { SCHEMA_SQL } from "../../db/schema";

let db: TipoPGlite;

beforeAll(async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  db = await PGlite.create();
  await db.exec(SCHEMA_SQL);
}, 60_000);
afterAll(async () => db?.close());

let n = 0;
const lead = (id: string, criado: string, ficha: Record<string, string> = {}) => {
  const cols = ["id", "brand", "created_at", "name", "status", ...Object.keys(ficha)];
  const vals = [id, "consorcio", criado, "Pessoa Teste", "em_contato", ...Object.values(ficha)];
  return db.query(`insert into leads (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, vals);
};
const evento = (leadId: string, action: string, em: string, actor = "", payload: Record<string, string> | null = null) =>
  db.query(`insert into lead_events (id, lead_id, action, actor, created_at, payload) values ($1, $2, $3, $4, $5, $6)`, [
    `${leadId}-${action}-${(n += 1)}`,
    leadId,
    action,
    actor,
    em,
    payload ? JSON.stringify(payload) : null,
  ]);
const inscricao = async (id: string) =>
  (
    await db.query<{ v: string | null }>(
      `select to_char(inscrito_live_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') as v from leads where id = $1`,
      [id],
    )
  ).rows[0]?.v ?? null;
const payloads = async (id: string) =>
  (
    await db.query<{ p: Record<string, string> | null }>(
      `select payload as p from lead_events where lead_id = $1 and action = 'reenvio' order by created_at`,
      [id],
    )
  ).rows.map((r) => r.p);

describe("migração 0024 — reparo do que chegou antes do código", () => {
  it("quem já era lead e se inscreveu (n8n, ou a página com as respostas) ganha a hora da 1ª inscrição e o texto na linha do tempo", async () => {
    // O caso real: entrou em outubro, se inscreveu na live pelo n8n em 16/11.
    await lead("REINSCRITO", "2026-10-27T15:00:00Z", { classe: "A" });
    await evento("REINSCRITO", "tentativa", "2026-10-27T16:00:00Z", "Eduardo");
    await evento("REINSCRITO", "reenvio", "2026-11-16T19:00:00Z", "n8n", { pelo: "telefone", origem: "n8n" });
    await evento("REINSCRITO", "reenvio", "2026-11-16T18:30:00Z", "n8n", { pelo: "telefone", origem: "n8n" });
    // Pela página com as respostas: o reenvio seguido da ficha gravada pela página.
    await lead("PAGINA", "2026-10-27T15:00:00Z", { bem: "imovel" });
    await evento("PAGINA", "reenvio", "2026-11-16T20:00:00Z", "Landing page", { pelo: "telefone" });
    await evento("PAGINA", "ficha", "2026-11-16T20:00:01Z", "Landing page", { fato: "respostas" });
    // A página achou pelo e-mail, com OUTRO número: a pessoa da live é a do número (o n8n cria por ele).
    await lead("POR-EMAIL", "2026-10-27T15:00:00Z", { bem: "imovel" });
    await evento("POR-EMAIL", "reenvio", "2026-11-16T20:00:00Z", "Landing page", { pelo: "e-mail", telefoneNovo: "11988887777" });
    await evento("POR-EMAIL", "ficha", "2026-11-16T20:00:01Z", "Landing page", { fato: "respostas" });
    // A página de sempre (sem respostas) e uma ficha que o comercial preencheu: não é inscrição na live.
    await lead("COMERCIAL", "2026-10-27T15:00:00Z", { classe: "A" });
    await evento("COMERCIAL", "reenvio", "2026-11-16T18:30:00Z", "Landing page", { pelo: "telefone" });
    await evento("COMERCIAL", "ficha", "2026-11-16T21:00:00Z", "Ana", { fato: "respostas" });
    // Reenvio do n8n fora da janela (depois dela o código grava) ou antes da captação: nada.
    await lead("DEPOIS", "2026-10-20T15:00:00Z", { finalidade: "morar" });
    await evento("DEPOIS", "reenvio", "2026-11-18T12:00:00Z", "n8n", { origem: "n8n" });
    await lead("ANTES", "2026-10-20T15:00:00Z", { classe_n8n: "B" });
    await evento("ANTES", "reenvio", "2026-11-10T12:00:00Z", "n8n", { origem: "n8n" });
    // Já tinha a data: fica.
    await lead("JA-TINHA", "2026-10-20T15:00:00Z", { classe: "B" });
    await db.query(`update leads set inscrito_live_em = '2026-11-16T10:00:00Z' where id = 'JA-TINHA'`);
    await evento("JA-TINHA", "reenvio", "2026-11-16T18:30:00Z", "n8n", { origem: "n8n" });

    await db.exec(SCHEMA_SQL); // o próximo boot

    expect(await inscricao("REINSCRITO")).toBe("2026-11-16T18:30");
    expect(await inscricao("PAGINA")).toBe("2026-11-16T20:00");
    expect(await inscricao("COMERCIAL")).toBeNull();
    expect(await inscricao("POR-EMAIL")).toBeNull();
    expect(await inscricao("DEPOIS")).toBeNull();
    expect(await inscricao("ANTES")).toBeNull();
    expect(await inscricao("JA-TINHA")).toBe("2026-11-16T10:00");
    // A entrada não muda.
    const entrada = (await db.query<{ v: string }>(`select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as v from leads where id = 'REINSCRITO'`)).rows[0].v;
    expect(entrada).toBe("2026-10-27");
    // Só o reenvio que É a inscrição ganha o texto da live; o resto do payload fica.
    expect(await payloads("REINSCRITO")).toEqual([
      { pelo: "telefone", origem: "n8n", inscricaoLive: "Live 01/12", leadDesde: "2026-10-27T15:00:00.000Z" },
      { pelo: "telefone", origem: "n8n" },
    ]);
    expect(await payloads("COMERCIAL")).toEqual([{ pelo: "telefone" }]);
  });

  it("quem entrou já na captação pela live ganha a própria entrada (a 2ª inscrição depois não troca a data)", async () => {
    await lead("NOVO-N8N", "2026-11-16T20:00:00Z", { classe: "A" });
    await evento("NOVO-N8N", "created", "2026-11-16T20:00:00Z", "n8n", { origem: "n8n" });
    await lead("NOVO-PAGINA", "2026-11-16T21:00:00Z", { bem: "carro" });
    await evento("NOVO-PAGINA", "created", "2026-11-16T21:00:00Z", "Landing page");
    await evento("NOVO-PAGINA", "ficha", "2026-11-16T21:00:01Z", "Landing page", { fato: "respostas" });
    // A página de sempre, na captação: não é da live.
    await lead("NOVO-COMUM", "2026-11-16T21:30:00Z");
    await evento("NOVO-COMUM", "created", "2026-11-16T21:30:00Z", "Landing page");

    await db.exec(SCHEMA_SQL);

    expect(await inscricao("NOVO-N8N")).toBe("2026-11-16T20:00");
    expect(await inscricao("NOVO-PAGINA")).toBe("2026-11-16T21:00");
    expect(await inscricao("NOVO-COMUM")).toBeNull();
  });

  it("rodar de novo a cada boot não muda nada — nem com uma ficha preenchida depois", async () => {
    await evento("REINSCRITO", "reenvio", "2026-11-16T17:00:00Z", "n8n", { origem: "n8n" }); // um reenvio mais antigo aparecendo depois
    await db.query(`update leads set classe = 'A' where id = 'NOVO-COMUM'`); // o comercial preenche a ficha depois
    await db.exec(SCHEMA_SQL);
    await db.exec(SCHEMA_SQL);
    expect(await inscricao("REINSCRITO")).toBe("2026-11-16T18:30");
    expect(await inscricao("COMERCIAL")).toBeNull();
    expect(await inscricao("NOVO-COMUM")).toBeNull();
    expect((await payloads("REINSCRITO"))[1]).toEqual({ pelo: "telefone", origem: "n8n", inscricaoLive: "Live 01/12", leadDesde: "2026-10-27T15:00:00.000Z" });
  });
});
