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

    it("listLeads: só a marca, sem excluídos, mais recentes primeiro — e devolve cópia", async () => {
      const velho = `LEAD-LP-lista-v-${sfx}`;
      const novo = `LEAD-LP-lista-n-${sfx}`;
      const fora = `LEAD-LP-lista-x-${sfx}`;
      const outraMarca = `LEAD-LP-lista-k-${sfx}`;
      await b.addLead({ id: velho, brand: "consorcio", createdAt: "2030-01-01T10:00:00.000Z", name: "Pessoa Teste", status: "lead" });
      await b.addLead({ id: novo, brand: "consorcio", createdAt: "2030-01-02T10:00:00.000Z", name: "Pessoa Teste", status: "lead" });
      await b.addLead({ id: fora, brand: "consorcio", createdAt: "2030-01-03T10:00:00.000Z", name: "Pessoa Teste", status: "lead" });
      await b.addLead({ id: outraMarca, brand: "krone", createdAt: "2030-01-04T10:00:00.000Z", name: "Pessoa Teste", status: "lead" });
      await b.softDeleteLead(fora, { at: new Date().toISOString(), by: "admin", reason: "teste" });

      const ids = (await b.listLeads("consorcio")).map((l) => l.id);
      expect(ids).not.toContain(fora);
      expect(ids).not.toContain(outraMarca);
      expect(ids.indexOf(novo)).toBeLessThan(ids.indexOf(velho));

      const [primeiro] = (await b.listLeads("consorcio")).filter((l) => l.id === novo);
      primeiro.status = "cliente";
      expect((await b.getLead(novo))?.status).toBe("lead");
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

    it("restaurar o exemplo não apaga lead: quem não é do exemplo fica excluído (reversível), com marcos e histórico", async () => {
      const id = `LEAD-LP-reset-${sfx}`;
      const jaExcluido = `LEAD-LP-reset-x-${sfx}`;
      await b.addLead({ id, brand: "consorcio", createdAt: "2026-10-01T10:00:00.000Z", name: "Pessoa Teste", phone: "11977776666", status: "lead" });
      await b.setLeadStatus(id, "agendado", { bookedAt: "2026-10-02T15:00:00.000Z", meetingFor: "2026-10-05T14:00:00.000Z" });
      await b.addLeadEvent(evento(id, `EVT-reset-${sfx}`, "created"));
      await b.addLead({ id: jaExcluido, brand: "consorcio", createdAt: "2026-10-01T11:00:00.000Z", name: "Pessoa Teste", status: "lead" });
      await b.softDeleteLead(jaExcluido, { at: "2026-10-03T10:00:00.000Z", by: "admin", reason: "duplicado" });

      const seed = await b.resetToSeed("admin");
      const doExemplo = seed.leads.filter((l) => l.brand === "consorcio").map((l) => l.id);
      expect((await b.getData("consorcio")).leads.map((l) => l.id).sort()).toEqual([...doExemplo].sort());

      const excluido = (await b.listDeletedLeads("consorcio")).find((l) => l.id === id);
      expect(excluido).toMatchObject({
        status: "agendado",
        bookedAt: "2026-10-02T15:00:00.000Z",
        phone: "11977776666",
        deletedBy: "admin",
        deletedReason: "restaurar exemplo",
      });
      // quem já estava excluído guarda o próprio motivo e não ganha evento
      expect((await b.getLead(jaExcluido))?.deletedReason).toBe("duplicado");
      const exclusoes = async (leadId: string) =>
        (await b.listLeadEvents({ leadId, limit: 0 })).filter((e) => e.action === "excluido");
      expect(await exclusoes(jaExcluido)).toHaveLength(0);
      // o histórico fica e ganha o porquê, no instante da exclusão
      expect((await b.listLeadEvents({ leadId: id })).map((e) => e.id)).toContain(`EVT-reset-${sfx}`);
      expect(await exclusoes(id)).toEqual([
        expect.objectContaining({
          actor: "admin",
          leadName: "Pessoa Teste",
          brand: "consorcio",
          payload: { motivo: "restaurar exemplo" },
          createdAt: excluido?.deletedAt,
        }),
      ]);

      // lead do exemplo excluído à mão volta; repetir o reset não regrava a exclusão
      await b.softDeleteLead(doExemplo[0], { at: new Date().toISOString(), by: "admin", reason: "teste" });
      await b.resetToSeed("outro");
      expect((await b.getLead(doExemplo[0]))?.deletedAt).toBeUndefined();
      expect(await b.getLead(id)).toMatchObject({ deletedAt: excluido?.deletedAt, deletedBy: "admin" });
      expect(await exclusoes(id)).toHaveLength(1);

      await b.restoreLead(id);
      expect((await b.getData("consorcio")).leads.find((l) => l.id === id)).toMatchObject({ status: "agendado" });
    });

    it("1º contato é marco (grava uma vez; só o desfazer limpa) e o evento guarda quando aconteceu", async () => {
      const id = `LEAD-LP-contato-${sfx}`;
      await b.addLead({ id, brand: "consorcio", createdAt: "2026-10-08T12:00:00.000Z", name: "Pessoa Teste", status: "lead" });
      await b.setLeadStatus(id, "em_contato", { firstContactAt: "2026-10-08T12:30:00.000Z" });
      await b.setLeadStatus(id, "em_contato", { firstContactAt: "2026-10-08T15:00:00.000Z" });
      expect((await b.getLead(id))?.firstContactAt).toBe("2026-10-08T12:30:00.000Z");
      await b.setLeadStatus(id, "lead", { firstContactAt: null });
      expect((await b.getLead(id))?.firstContactAt).toBeUndefined();

      await b.addLeadEvent({
        ...evento(id, `EVT-t-${sfx}`, "tentativa"),
        occurredAt: "2026-10-08T12:30:00.000Z",
        payload: { canal: "whatsapp", falou: "nao" },
      });
      const ev = (await b.listLeadEvents({ leadId: id })).find((e) => e.id === `EVT-t-${sfx}`);
      expect(ev?.occurredAt).toBe("2026-10-08T12:30:00.000Z");
      expect(ev?.payload).toEqual({ canal: "whatsapp", falou: "nao" });
    });

    it("motivo da perda é gravado e limpo quando o lead sai da perda", async () => {
      const id = `LEAD-LP-motivo-${sfx}`;
      await b.addLead({ id, brand: "consorcio", createdAt: new Date().toISOString(), name: "Pessoa Teste", status: "lead" });
      await b.setLeadStatus(id, "contato_invalido", { lostAt: new Date().toISOString(), lostReasonDetail: "Sem WhatsApp" });
      expect((await b.getLead(id))?.lostReasonDetail).toBe("Sem WhatsApp");
      await b.setLeadStatus(id, "lead", { lostAt: null, lostReasonDetail: null });
      expect((await b.getLead(id))?.lostReasonDetail).toBeUndefined();
    });

    it("getLead devolve uma cópia: escrever depois não muda o que já foi lido", async () => {
      const id = `LEAD-LP-copia-${sfx}`;
      await b.addLead({ id, brand: "consorcio", createdAt: new Date().toISOString(), name: "Pessoa Teste", status: "lead" });
      const lido = await b.getLead(id);
      await b.setLeadStatus(id, "em_contato", {});
      expect(lido?.status).toBe("lead");
      expect((await b.getLead(id))?.status).toBe("em_contato");
    });

    it("sincronizações: guarda a janela coberta, filtra por fonte e marca, mais recente primeiro", async () => {
      const base = { source: "ads" as const, startedAt: "2030-02-01T09:00:00.000Z" };
      await b.addSyncRun({ ...base, id: `SR1-${sfx}`, brand: `m-${sfx}`, finishedAt: "2030-02-01T09:01:00.000Z", ok: true, dateFrom: "2030-01-02", dateTo: "2030-02-01", rows: 12 });
      await b.addSyncRun({ ...base, id: `SR2-${sfx}`, brand: `m-${sfx}`, finishedAt: "2030-02-02T09:01:00.000Z", ok: false, error: "A Meta recusou o token." });
      await b.addSyncRun({ ...base, id: `SR3-${sfx}`, brand: `m-${sfx}`, source: "instagram", finishedAt: "2030-02-03T09:01:00.000Z", ok: true });
      await b.addSyncRun({ ...base, id: `SR4-${sfx}`, brand: `outra-${sfx}`, finishedAt: "2030-02-04T09:01:00.000Z", ok: true });

      const ads = await b.listSyncRuns({ source: "ads", brand: `m-${sfx}`, limit: 0 });
      expect(ads.map((r) => r.id)).toEqual([`SR2-${sfx}`, `SR1-${sfx}`]);
      expect(ads[1]).toMatchObject({ ok: true, dateFrom: "2030-01-02", dateTo: "2030-02-01", rows: 12 });
      expect(ads[0]).toMatchObject({ ok: false, error: "A Meta recusou o token." });
      expect(ads[0].dateFrom).toBeUndefined();
    });

    it("metas: só se insere (vigência nova não apaga a antiga), por marca, com as entradas", async () => {
      const base = {
        brand: "consorcio",
        metrica: "cpl" as const,
        periodo: "semana" as const,
        provisoria: false,
        origem: "calculadora" as const,
        criadaPor: "admin",
      };
      await b.addMeta({ ...base, id: `MT1-${sfx}`, alvo: 20, vigenteDesde: "2031-01-01", criadaEm: "2031-01-01T12:00:00.000Z", entradas: { V: 200000, c: 0.02, m: 0.3, f: 0.2, s: 0.7, a: 0.1, N: 4 } });
      await b.addMeta({ ...base, id: `MT2-${sfx}`, alvo: null, vigenteDesde: "2031-02-01", criadaEm: "2031-02-01T12:00:00.000Z", origem: "manual" });
      await b.addMeta({ ...base, id: `MT3-${sfx}`, brand: "krone", alvo: 5, vigenteDesde: "2031-01-01", criadaEm: "2031-01-01T12:00:00.000Z" });

      const metas = (await b.getData("consorcio")).metas ?? [];
      const minhas = metas.filter((m) => m.id.endsWith(sfx));
      expect(minhas.map((m) => m.id).sort()).toEqual([`MT1-${sfx}`, `MT2-${sfx}`]);
      expect(minhas.find((m) => m.id === `MT1-${sfx}`)).toMatchObject({ alvo: 20, vigenteDesde: "2031-01-01", entradas: { V: 200000, a: 0.1 } });
      expect(minhas.find((m) => m.id === `MT2-${sfx}`)?.alvo).toBeNull();
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
