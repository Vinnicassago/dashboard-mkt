/**
 * Fase 2b — identidade e higiene do lead (D2). Fixture sintética (sem dado real).
 */
import { describe, expect, it } from "vitest";
import {
  acharMesmaPessoa,
  emailSuspeito,
  gruposDuplicados,
  paraRevisar,
  pareceTeste,
  telefoneE164,
} from "../identidade";
import { etapaDoLead } from "../fila";
import type { Lead, LeadEvent } from "../types";

const lead = (id: string, extra: Partial<Lead> = {}): Lead => ({
  id,
  brand: "consorcio",
  createdAt: "2026-09-01T12:00:00.000Z",
  name: `Pessoa ${id}`,
  status: "lead",
  ...extra,
});

describe("formato do contato", () => {
  it("telefone vira E.164 com DDI; curto demais não", () => {
    expect(telefoneE164("(11) 99999-0000")).toBe("+5511999990000");
    expect(telefoneE164("+55 11 99999-0000")).toBe("+5511999990000");
    expect(telefoneE164("99999-0000")).toBeNull();
  });
  it("e-mail com domínio digitado errado é sinalizado, não corrigido", () => {
    expect(emailSuspeito("pessoa@gamil.com")).toMatch(/digitação/);
    expect(emailSuspeito("pessoa@gmail.con")).toMatch(/digitação/);
    expect(emailSuspeito("pessoa@gmail.com")).toBeNull();
    expect(emailSuspeito("email")).toMatch(/formato/);
  });
});

describe("cadastro de teste", () => {
  it("reconhece os padrões da auditoria", () => {
    expect(pareceTeste({ name: "nome", email: "email" })).toMatch(/nome/);
    expect(pareceTeste({ name: "Ana", email: "teste123@x.com" })).toMatch(/e-mail/);
    expect(pareceTeste({ name: "Ana", phone: "11 11111-1111" })).toMatch(/telefone/);
    expect(pareceTeste({ name: "Ana Souza", email: "ana@x.com", phone: "11 98765-4321" })).toBeNull();
  });
});

describe("mesma pessoa pelo contato", () => {
  const leads = [
    lead("A", { phone: "11 98765-4321" }),
    lead("B", { phone: "5511987654321", email: "b@x.com", createdAt: "2026-09-05T12:00:00.000Z" }),
    lead("C", { email: "B@X.com ", createdAt: "2026-09-07T12:00:00.000Z" }),
    lead("D", { phone: "21 91234-5678" }),
    lead("E", { phone: "abc" }),
    lead("F", { phone: "xyz" }),
  ];

  it("acha pelo telefone (com e sem DDI) e pelo e-mail (sem caixa)", () => {
    expect(acharMesmaPessoa({ phone: "(11) 98765-4321" }, leads, "consorcio")?.id).toBe("A");
    expect(acharMesmaPessoa({ email: "b@x.com" }, leads, "consorcio")?.id).toBe("B");
    expect(acharMesmaPessoa({ phone: "11 90000-0000" }, leads, "consorcio")).toBeUndefined();
  });
  it("outra marca e excluído não contam", () => {
    expect(acharMesmaPessoa({ phone: "11 98765-4321" }, leads, "krone")).toBeUndefined();
    const excluido = [lead("X", { phone: "11 98765-4321", deletedAt: "2026-09-02T00:00:00.000Z" })];
    expect(acharMesmaPessoa({ phone: "11 98765-4321" }, excluido, "consorcio")).toBeUndefined();
  });
  it("telefone sem dígitos não casa com nada (lixo não é contato)", () => {
    expect(acharMesmaPessoa({ phone: "abc" }, leads, "consorcio")).toBeUndefined();
  });
  it("agrupa transitivamente (A~B pelo telefone, B~C pelo e-mail)", () => {
    const grupos = gruposDuplicados(leads);
    expect(grupos).toHaveLength(1);
    const ids = [grupos[0].principal, ...grupos[0].duplicados].map((l) => l.id).sort();
    expect(ids).toEqual(["A", "B", "C"]);
    // Sem história em nenhum: fica o mais antigo.
    expect(grupos[0].principal.id).toBe("A");
    expect(grupos[0].conflito).toBe(false);
  });
  it("o principal é quem carrega mais história, e status diferente é conflito", () => {
    const g = gruposDuplicados([
      lead("velho", { phone: "11 98765-4321", status: "contato_invalido", lostAt: "2026-09-02T00:00:00.000Z" }),
      lead("novo", {
        phone: "11 98765-4321",
        status: "agendado",
        bookedAt: "2026-09-10T00:00:00.000Z",
        createdAt: "2026-09-09T00:00:00.000Z",
      }),
    ]);
    expect(g[0].principal.id).toBe("novo");
    expect(g[0].conflito).toBe(true);
  });
});

describe("lista Revisar", () => {
  it("separa teste, duplicado, desistência sem reunião e contato com problema", () => {
    const r = paraRevisar([
      lead("t1", { name: "nome", email: "email" }),
      lead("t2", { name: "teste", email: "email" }),
      lead("d1", { phone: "11 98765-4321" }),
      lead("d2", { phone: "11 98765-4321" }),
      lead("x1", { status: "desistencia", phone: "11 91111-2222" }),
      lead("x2", { status: "desistencia", bookedAt: "2026-09-03T00:00:00.000Z", phone: "11 93333-4444" }),
      lead("c1", { phone: "1234", email: "c@gamil.com" }),
    ]);
    expect(r.testes.map((t) => t.lead.id)).toEqual(["t1", "t2"]);
    // Os dois testes com e-mail "email" NÃO viram grupo de duplicados.
    expect(r.duplicados.map((g) => g.principal.id)).toEqual(["d1"]);
    expect(r.desistenciaSemReuniao.map((l) => l.id)).toEqual(["x1"]);
    expect(r.contatoComProblema.map((c) => c.lead.id)).toEqual(["c1"]);
    expect(r.contatoComProblema[0].problemas).toHaveLength(2);
  });
});

describe("lead reaberto recomeça o relógio da Fila", () => {
  const reaberto = (leadId: string, at: string): LeadEvent => ({
    id: `R-${leadId}`,
    leadId,
    leadName: "x",
    actor: "Landing page",
    action: "reaberto",
    fromStatus: "sem_resposta",
    toStatus: "lead",
    createdAt: at,
  });
  it("voltou hoje entra como novo de hoje, não de semanas atrás", () => {
    const l = lead("v", { createdAt: "2026-09-01T12:00:00.000Z" });
    const agora = "2026-10-08T14:30:00.000Z"; // quinta 11h30 em Brasília
    const e = etapaDoLead(l, [reaberto("v", "2026-10-08T14:00:00.000Z")], agora);
    expect(e?.nome).toBe("novo");
    expect(e?.desde).toBe("2026-10-08T14:00:00.000Z");
    expect(e?.horasUteis).toBeCloseTo(0.5, 5);
  });
});
