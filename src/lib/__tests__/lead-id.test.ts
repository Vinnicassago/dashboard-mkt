import { describe, expect, it } from "vitest";
import {
  candidatosIdLead,
  idLeadLp,
  idLeadLpLegado,
  pessoaDiferente,
  resolverIdLead,
  type ContatoLead,
} from "../lead-id";

const sufixo = () => "x1";
const banco = (linhas: Record<string, ContatoLead>) => (id: string) => linhas[id];

describe("id do lead da LP", () => {
  it("usa o event_id inteiro; o formato antigo cortava em 8 caracteres", () => {
    expect(idLeadLp("lead_d9de70b9-e60a-4ce5")).toBe("LEAD-LP-lead_d9de70b9-e60a-4ce5");
    expect(idLeadLpLegado("lead_d9de70b9-e60a-4ce5")).toBe("LEAD-LP-lead_d9d");
  });

  it("código curto da LP do Brunno (4 caracteres) dá o mesmo id nos dois esquemas", () => {
    expect(idLeadLp("k3x9")).toBe(idLeadLpLegado("k3x9"));
    expect(candidatosIdLead("k3x9")).toEqual(["LEAD-LP-k3x9"]);
  });

  it("limpa caracteres estranhos e limita o tamanho", () => {
    expect(idLeadLp(" ab/c d ")).toBe("LEAD-LP-abcd");
    expect(idLeadLp("a".repeat(100))).toHaveLength("LEAD-LP-".length + 64);
  });
});

describe("pessoaDiferente", () => {
  it("só afirma com contato comparável", () => {
    expect(pessoaDiferente({}, { phone: "11999990000" })).toBe(false);
    expect(pessoaDiferente({ phone: "11999990000" }, { email: "a@b.com" })).toBe(false);
  });
  it("mesmo telefone em grafias diferentes é a mesma pessoa", () => {
    expect(pessoaDiferente({ phone: "(11) 99999-0000" }, { phone: "+55 11 999990000" })).toBe(false);
  });
  it("e-mail igual salva mesmo com telefone diferente", () => {
    expect(
      pessoaDiferente({ phone: "11999990000", email: "A@b.com" }, { phone: "21988887777", email: "a@b.com" }),
    ).toBe(false);
  });
  it("mesmo nome (sem acento/caixa) = mesma pessoa corrigindo o telefone", () => {
    expect(
      pessoaDiferente({ name: "José  Silva", phone: "11999990000" }, { name: "jose silva", phone: "21988887777" }),
    ).toBe(false);
  });
  it("o nome genérico não conta como prova", () => {
    expect(
      pessoaDiferente({ name: "Lead sem nome", phone: "11999990000" }, { name: "Lead sem nome", phone: "21988887777" }),
    ).toBe(true);
  });
  it("telefones e e-mails diferentes = pessoas diferentes", () => {
    expect(
      pessoaDiferente({ phone: "11999990000", email: "a@b.com" }, { phone: "21988887777", email: "c@d.com" }),
    ).toBe(true);
  });
});

describe("resolverIdLead", () => {
  it("ninguém com o id: lead novo com o id inteiro", () => {
    expect(resolverIdLead("lead_abc12345-zz", { phone: "11999990000" }, banco({}), sufixo)).toEqual({
      tipo: "novo",
      id: "LEAD-LP-lead_abc12345-zz",
    });
  });

  it("mesmo id, mesma pessoa: reenvio (não é lead novo)", () => {
    const r = resolverIdLead(
      "k3x9",
      { phone: "11999990000" },
      banco({ "LEAD-LP-k3x9": { phone: "+5511999990000" } }),
      sufixo,
    );
    expect(r).toEqual({ tipo: "reenvio", id: "LEAD-LP-k3x9" });
  });

  it("mesmo id, outra pessoa: colisão vira lead novo com id próprio", () => {
    const r = resolverIdLead(
      "k3x9",
      { phone: "21988887777", email: "c@d.com" },
      banco({ "LEAD-LP-k3x9": { phone: "11999990000", email: "a@b.com" } }),
      sufixo,
    );
    expect(r).toEqual({ tipo: "colisao", id: "LEAD-LP-k3x9-x1", idOcupado: "LEAD-LP-k3x9" });
  });

  it("lead gravado no esquema antigo e mesma pessoa: reenvio no id antigo", () => {
    const r = resolverIdLead(
      "lead_d9de70b9-e60a",
      { email: "fabio@x.com" },
      banco({ "LEAD-LP-lead_d9d": { email: "FABIO@x.com" } }),
      sufixo,
    );
    expect(r).toEqual({ tipo: "reenvio", id: "LEAD-LP-lead_d9d" });
  });

  it("LP B (consorcio_b_<uuid>): prefixo antigo compartilhado sem prova não vira reenvio", () => {
    const eventId = "consorcio_b_3f9c2a10-1111-4aaa-9bbb-123456789abc";
    const ocupado = banco({ "LEAD-LP-consorci": { name: "Pessoa Atual", phone: "11999990000" } });
    // sem contato nenhum: antes caía como "reenvio" e sumia dentro do lead de outra pessoa
    expect(resolverIdLead(eventId, { name: "Outra Pessoa" }, ocupado, sufixo)).toEqual({
      tipo: "novo",
      id: `LEAD-LP-${eventId}`,
    });
    // mesma pessoa reenviando pelo esquema antigo continua sendo reenvio
    expect(resolverIdLead(eventId, { name: "pessoa atual" }, ocupado, sufixo).tipo).toBe("reenvio");
  });

  it("prefixo antigo de outra pessoa: lead novo no id inteiro, sem sobrescrever ninguém", () => {
    const r = resolverIdLead(
      "lead_d9de70b9-e60a",
      { phone: "21988887777" },
      banco({ "LEAD-LP-lead_d9d": { phone: "11999990000" } }),
      sufixo,
    );
    expect(r).toEqual({ tipo: "novo", id: "LEAD-LP-lead_d9de70b9-e60a" });
  });
});
