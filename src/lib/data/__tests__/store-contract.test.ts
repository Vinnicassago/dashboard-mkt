/**
 * Contrato do store — a MESMA suíte roda contra o JSON local e contra um
 * Postgres de verdade (PGlite, Postgres compilado para WASM, servido pelo
 * protocolo do Postgres para o driver `pg` usar como usaria o da produção).
 *
 * O que se prova aqui é o que a Fase 0 promete: nenhum lead se perde.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DataBackend } from "../backend";
import type { AdDaily, Creative, Lead, LeadEvent } from "../../types";

const ad = (brand: string, date: string, adId: string, spend: number): AdDaily => ({
  brand,
  date,
  adId,
  campaign: "Campanha X",
  adset: "Conjunto X",
  spend,
  impressions: 1000,
  reach: 800,
  frequency: 1.25,
  clicks: 10,
  leads: 1,
});
const criativo = (brand: string, adId: string): Creative => ({ adId, brand, name: `Anúncio ${adId}`, format: "imagem" });
const evento = (leadId: string, id: string, action: LeadEvent["action"], brand = "consorcio"): LeadEvent => ({
  id,
  leadId,
  brand,
  leadName: "Pessoa Teste",
  actor: "teste",
  action,
  createdAt: new Date().toISOString(),
});

function contrato(nome: string, abrir: () => Promise<{ backend: DataBackend; fechar: () => Promise<void> }>) {
  describe(`store — ${nome}`, () => {
    let b: DataBackend;
    let fechar: () => Promise<void>;
    const sfx = `${nome}-${Date.now()}`;

    beforeAll(async () => {
      ({ backend: b, fechar } = await abrir());
    }, 60_000);
    afterAll(async () => fechar?.());

    it("reenvio NÃO zera status, entrada, marcos nem reunião — só preenche contato vazio", async () => {
      const id = `LEAD-LP-reenvio-${sfx}`;
      const original: Lead = {
        id,
        brand: "consorcio",
        createdAt: "2026-09-01T10:00:00.000Z",
        name: "Pessoa Teste",
        phone: "11999990000",
        status: "lead",
      };
      expect(await b.addLead(original)).toEqual({ created: true });
      await b.setLeadStatus(id, "agendado", {
        bookedAt: "2026-09-02T15:00:00.000Z",
        meetingAt: "2026-09-02T15:00:00.000Z",
      });

      const reenvio = await b.addLead({
        ...original,
        createdAt: "2026-09-20T10:00:00.000Z",
        name: "Outro Nome",
        phone: "21988887777",
        email: "pessoa@teste.invalid",
        status: "lead",
      });
      expect(reenvio).toEqual({ created: false });

      const l = await b.getLead(id);
      expect(l?.status).toBe("agendado");
      expect(l?.createdAt).toBe("2026-09-01T10:00:00.000Z");
      expect(l?.bookedAt).toBe("2026-09-02T15:00:00.000Z");
      expect(l?.meetingAt).toBe("2026-09-02T15:00:00.000Z");
      expect(l?.name).toBe("Pessoa Teste"); // nome gravado não é trocado
      expect(l?.phone).toBe("11999990000"); // contato gravado não é trocado
      expect(l?.email).toBe("pessoa@teste.invalid"); // contato vazio é preenchido
    });

    it("exclusão é reversível e o histórico do lead fica", async () => {
      const id = `LEAD-LP-excluir-${sfx}`;
      await b.addLead({ id, brand: "consorcio", createdAt: new Date().toISOString(), name: "Pessoa Teste", status: "lead" });
      await b.addLeadEvent(evento(id, `EVT-c-${sfx}`, "created"));

      await b.softDeleteLead(id, { at: new Date().toISOString(), by: "admin", reason: "teste" });
      expect((await b.getData("consorcio")).leads.some((l) => l.id === id)).toBe(false);
      const excluidos = await b.listDeletedLeads("consorcio");
      expect(excluidos.find((l) => l.id === id)).toMatchObject({ deletedBy: "admin", deletedReason: "teste" });
      expect((await b.listLeadEvents({ leadId: id })).map((e) => e.id)).toContain(`EVT-c-${sfx}`);

      await b.restoreLead(id);
      expect((await b.getData("consorcio")).leads.some((l) => l.id === id)).toBe(true);
      expect((await b.getLead(id))?.deletedAt).toBeUndefined();
    });

    it("histórico filtra por marca (eventos antigos sem marca aparecem em todas) e limit 0 = tudo", async () => {
      await b.addLeadEvent(evento(`L-k-${sfx}`, `EVT-k-${sfx}`, "created", "krone"));
      await b.addLeadEvent({ ...evento(`L-n-${sfx}`, `EVT-n-${sfx}`, "created"), brand: undefined });
      const consorcio = (await b.listLeadEvents({ brand: "consorcio", limit: 0 })).map((e) => e.id);
      expect(consorcio).not.toContain(`EVT-k-${sfx}`);
      expect(consorcio).toContain(`EVT-n-${sfx}`);
      const krone = (await b.listLeadEvents({ brand: "krone", limit: 0 })).map((e) => e.id);
      expect(krone).toContain(`EVT-k-${sfx}`);
    });

    it("replaceAdData troca só o recorte e limpa criativo órfão", async () => {
      await b.replaceAdData(
        [ad("consorcio", "2026-08-01", "100", 10), ad("consorcio", "2026-09-01", "200", 20), ad("krone", "2026-09-01", "300", 30)],
        [criativo("consorcio", "100"), criativo("consorcio", "200"), criativo("krone", "300"), criativo("consorcio", "csv-nome")],
      );
      // refaz setembro do consórcio: a linha de agosto e a da krone ficam
      await b.replaceAdData([ad("consorcio", "2026-09-01", "201", 21)], [criativo("consorcio", "201")], {
        brands: ["consorcio"],
        since: "2026-09-01",
        until: "2026-09-30",
      });
      const c = await b.getData("consorcio");
      expect(c.adDaily.map((r) => `${r.date}:${r.adId}`).sort()).toEqual(["2026-08-01:100", "2026-09-01:201"]);
      expect(c.creatives.map((x) => x.adId).sort()).toEqual(["100", "201"]); // "200" e "csv-nome" sem linha
      const k = await b.getData("krone");
      expect(k.adDaily.map((r) => r.adId)).toEqual(["300"]);
    });

    it("restaurar o exemplo preserva o histórico dos leads", async () => {
      await b.addLeadEvent(evento(`L-r-${sfx}`, `EVT-r-${sfx}`, "status_changed"));
      await b.resetToSeed();
      await b.resetToSeed(); // repetir não duplica nem falha
      const ids = (await b.listLeadEvents({ limit: 0 })).map((e) => e.id);
      expect(ids).toContain(`EVT-r-${sfx}`);
      expect(ids.filter((x) => x === "EVT-S-1")).toHaveLength(1);
    });

    it("registro de auditoria", async () => {
      await b.addAuditEntry({ id: `AUD-${sfx}`, at: new Date().toISOString(), actor: "admin", action: "teste", detail: "x" });
      const lista = await b.listAuditEntries(5);
      expect(lista[0]).toMatchObject({ id: `AUD-${sfx}`, actor: "admin", action: "teste", detail: "x" });
    });
  });
}

contrato("local", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dash-store-"));
  process.env.LOCAL_DATA_DIR = dir;
  const { localBackend } = await import("../local-store");
  return {
    backend: localBackend,
    fechar: async () => fs.rmSync(dir, { recursive: true, force: true }),
  };
});

contrato("postgres", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");
  const db = await PGlite.create();
  const port = 54000 + Math.floor(Math.random() * 900);
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 5 });
  await server.start();
  process.env.DATABASE_URL = `postgres://postgres@127.0.0.1:${port}/postgres`;
  const { postgresBackend } = await import("../postgres-store");
  const { pg } = await import("../../db/pg");
  return {
    backend: postgresBackend,
    fechar: async () => {
      await pg().end();
      await server.stop();
      await db.close();
    },
  };
});
