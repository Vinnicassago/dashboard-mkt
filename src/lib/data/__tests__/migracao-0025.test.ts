/**
 * Migração 0025 num Postgres de verdade (PGlite): só ACRESCENTA. Um banco no
 * estado de antes (o SCHEMA_SQL sem o bloco 0025), com leads e histórico, recebe
 * o SCHEMA_SQL inteiro — como no boot do EasyPanel, e de novo a cada boot. Nada do
 * que existia muda; as duas tabelas novas nascem vazias e o que for gravado nelas
 * sobrevive aos boots seguintes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite as TipoPGlite } from "@electric-sql/pglite";
import { SCHEMA_SQL } from "../../db/schema";

let db: TipoPGlite;

const MARCO = "-- 0025 —";
const ANTES = SCHEMA_SQL.slice(0, SCHEMA_SQL.indexOf(MARCO));

/** Tudo o que existia: as linhas de leads e lead_events (em texto, para comparar igual). */
async function foto() {
  const leads = await db.query("select * from leads order by id");
  const eventos = await db.query("select * from lead_events order by id");
  return JSON.stringify({ leads: leads.rows, eventos: eventos.rows });
}

const tabelas = async () =>
  (
    await db.query<{ t: string }>(
      "select table_name as t from information_schema.tables where table_schema = 'public' order by table_name",
    )
  ).rows.map((r) => r.t);

beforeAll(async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  db = await PGlite.create();
  await db.exec(ANTES);
  // A produção de hoje: um lead da campanha anterior com marcos, ficha e histórico.
  await db.query(
    `insert into leads (id, brand, created_at, name, phone, status, booked_at, comunidade_em, diagnostico)
     values ('LEAD-LP-antigo', 'consorcio', '2026-10-01T15:00:00Z', 'Pessoa Antiga', '5511987654321', 'agendado',
             '2026-10-03T12:00:00Z', '2026-10-02T10:00:00Z', '{"respostas":[{"resposta":"x"}],"perfil":"do n8n"}')`,
  );
  await db.query(
    `insert into lead_events (id, lead_id, action, actor, created_at, payload)
     values ('ev-1', 'LEAD-LP-antigo', 'created', 'Landing page', '2026-10-01T15:00:00Z', null),
            ('ev-2', 'LEAD-LP-antigo', 'ficha', 'n8n', '2026-10-02T10:00:00Z', '{"fato":"comunidade"}')`,
  );
  // Como a produção: esses dados já passaram por um boot com o schema de antes (os blocos
  // antigos têm reparos que rodam a cada boot — não são deste teste).
  await db.exec(ANTES);
}, 60_000);
afterAll(async () => db?.close());

describe("migração 0025 — só tabelas novas", () => {
  it("o bloco 0025 existe no SCHEMA_SQL e não tem DELETE, DROP, TRUNCATE, UPDATE nem ALTER de tabela antiga", () => {
    const bloco = SCHEMA_SQL.slice(SCHEMA_SQL.indexOf(MARCO));
    expect(SCHEMA_SQL.indexOf(MARCO)).toBeGreaterThan(0);
    const sql = bloco
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .toLowerCase();
    for (const proibido of ["delete ", "drop ", "truncate", "update ", "alter table leads", "alter table lead_events"]) {
      expect(sql, proibido).not.toContain(proibido);
    }
  });

  it("no boot (e em todo boot seguinte): o que existia fica igual; as tabelas novas nascem vazias", async () => {
    const antes = await foto();
    expect(await tabelas()).not.toContain("diagnosticos");

    await db.exec(SCHEMA_SQL);
    expect(await foto()).toBe(antes);
    expect(await tabelas()).toEqual(expect.arrayContaining(["diagnosticos", "comunidade_cliques"]));
    expect((await db.query("select count(*)::int as n from diagnosticos")).rows).toEqual([{ n: 0 }]);
    expect((await db.query("select count(*)::int as n from comunidade_cliques")).rows).toEqual([{ n: 0 }]);

    // o que chegar depois sobrevive aos boots seguintes
    await db.query(
      `insert into diagnosticos (tentativa, telefone, chave_telefone, etapa, iniciado_em, atualizado_em)
       values ('t-1', '5511987654321', '1187654321', 'inicio', now(), now())`,
    );
    await db.query(`insert into comunidade_cliques (event_id, primeiro_em, ultimo_em) values ('k3x9qa', now(), now())`);
    await db.exec(SCHEMA_SQL);
    await db.exec(SCHEMA_SQL);
    expect(await foto()).toBe(antes);
    expect((await db.query("select count(*)::int as n from diagnosticos")).rows).toEqual([{ n: 1 }]);
    expect((await db.query("select count(*)::int as n from comunidade_cliques")).rows).toEqual([{ n: 1 }]);
  });

  it("as duas tabelas ficam fechadas por RLS, como as demais", async () => {
    const r = await db.query<{ t: string; rls: boolean }>(
      "select relname as t, relrowsecurity as rls from pg_class where relname in ('diagnosticos', 'comunidade_cliques') order by relname",
    );
    expect(r.rows).toEqual([
      { t: "comunidade_cliques", rls: true },
      { t: "diagnosticos", rls: true },
    ]);
  });
});
