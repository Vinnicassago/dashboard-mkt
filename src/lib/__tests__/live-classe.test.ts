/**
 * Live 01/12 — etapa 3: a classe A/B/C/X pelas regras do briefing, na ordem, e a
 * tabela de parcela provisória linha a linha. Fixture sintética.
 */
import { describe, expect, it } from "vitest";
import { TABELA_PROVISORIA, calcularClasse, lerTabela, parcelaCompativel, type RespostasParaClasse } from "../classe";
import { alertaDeClasse } from "../alertas";

const base: RespostasParaClasse = {
  bem: "imovel",
  faixaValor: "300k_500k",
  finalidade: "morar",
  faixaParcela: "1500_3000",
  prazoCompra: "ate_1_ano",
};
const classe = (over: Partial<RespostasParaClasse>) => calcularClasse({ ...base, ...over }).classe;

describe("classe — a ordem das regras", () => {
  it("1. X: quitar dívidas decide sozinho, mesmo com o resto faltando ou C", () => {
    expect(classe({ finalidade: "quitar_dividas" })).toBe("X");
    expect(calcularClasse({ finalidade: "quitar_dividas" }).classe).toBe("X");
    expect(classe({ finalidade: "quitar_dividas", faixaValor: "ate_50k" })).toBe("X");
  });

  it("2. C: valor abaixo do mínimo — imóvel até R$ 300 mil, carro/empresa até R$ 50 mil", () => {
    for (const v of ["ate_50k", "50k_150k", "150k_300k"] as const) expect(classe({ faixaValor: v })).toBe("C");
    expect(classe({ bem: "carro", faixaValor: "ate_50k" })).toBe("C");
    expect(classe({ bem: "empresa", faixaValor: "ate_50k" })).toBe("C");
    expect(classe({ bem: "outro", faixaValor: "ate_50k" })).toBe("C");
  });

  it("2. C ganha de B: valor abaixo do mínimo com prazo 'Preciso agora' continua C", () => {
    expect(classe({ faixaValor: "150k_300k", prazoCompra: "agora" })).toBe("C");
  });

  it("3. B: bem Outro, ou prazo 'Preciso agora' ou 'Mais de 3 anos'", () => {
    expect(classe({ bem: "outro", faixaValor: "50k_150k", faixaParcela: "ate_1500" })).toBe("B");
    expect(classe({ prazoCompra: "agora" })).toBe("B");
    expect(classe({ prazoCompra: "mais_3_anos" })).toBe("B");
  });

  it("4. A: o resto", () => {
    expect(classe({})).toBe("A");
    expect(classe({ prazoCompra: "1_3_anos" })).toBe("A");
    expect(classe({ bem: "carro", faixaValor: "50k_150k", faixaParcela: "ate_1500" })).toBe("A");
  });

  it("faltando resposta, não decide (e diz o que falta)", () => {
    const r = calcularClasse({ bem: "imovel", faixaValor: "300k_500k" });
    expect(r.classe).toBeUndefined();
    expect(r.falta).toEqual(["finalidade", "faixaParcela", "prazoCompra"]);
    expect(r.motivo).toContain("finalidade");
  });
});

describe("classe — tabela de parcela provisória (o briefing, linha a linha)", () => {
  const casos: [RespostasParaClasse["bem"], RespostasParaClasse["faixaValor"], RespostasParaClasse["faixaParcela"], "A" | "C"][] = [
    // Imóvel R$ 300–500 mil: a partir de R$ 1.500–3.000
    ["imovel", "300k_500k", "ate_1500", "C"],
    ["imovel", "300k_500k", "1500_3000", "A"],
    ["imovel", "300k_500k", "acima_6000", "A"],
    // Imóvel R$ 500 mil–1 milhão: a partir de R$ 3.000–6.000
    ["imovel", "500k_1m", "1500_3000", "C"],
    ["imovel", "500k_1m", "3000_6000", "A"],
    // Imóvel acima de R$ 1 milhão: acima de R$ 6.000
    ["imovel", "acima_1m", "3000_6000", "C"],
    ["imovel", "acima_1m", "acima_6000", "A"],
    // Carro ou empresa R$ 50–150 mil: qualquer faixa
    ["carro", "50k_150k", "ate_1500", "A"],
    ["empresa", "50k_150k", "ate_1500", "A"],
    // R$ 150–300 mil: a partir de R$ 1.500–3.000
    ["carro", "150k_300k", "ate_1500", "C"],
    ["carro", "150k_300k", "1500_3000", "A"],
    // Acima de R$ 300 mil: a partir de R$ 3.000–6.000 (as três faixas de cima)
    ["carro", "300k_500k", "1500_3000", "C"],
    ["empresa", "500k_1m", "3000_6000", "A"],
    ["carro", "acima_1m", "1500_3000", "C"],
  ];
  it.each(casos)("%s, %s, parcela %s → %s", (bem, faixaValor, faixaParcela, esperado) => {
    expect(classe({ bem, faixaValor, faixaParcela })).toBe(esperado);
  });

  it("'Outro' usa a regra de carro — e depois vira B", () => {
    expect(classe({ bem: "outro", faixaValor: "150k_300k", faixaParcela: "ate_1500" })).toBe("C");
    expect(classe({ bem: "outro", faixaValor: "150k_300k", faixaParcela: "1500_3000" })).toBe("B");
  });

  it("parcela compatível compara a posição da faixa", () => {
    expect(parcelaCompativel("qualquer", "ate_1500")).toBe(true);
    expect(parcelaCompativel("minimo", "acima_6000")).toBe(false);
    expect(parcelaCompativel("3000_6000", "acima_6000")).toBe(true);
    expect(parcelaCompativel("3000_6000", "1500_3000")).toBe(false);
  });

  it("tabela editada vale na hora; célula torta no banco cai na provisória", () => {
    const t = lerTabela({ celulas: { imovel: { "150k_300k": "qualquer", "300k_500k": "lixo" } } });
    expect(t.celulas.imovel["150k_300k"]).toBe("qualquer");
    expect(t.celulas.imovel["300k_500k"]).toBe(TABELA_PROVISORIA.celulas.imovel["300k_500k"]);
    expect(calcularClasse({ ...base, faixaValor: "150k_300k", faixaParcela: "ate_1500" }, t).classe).toBe("A");
    expect(lerTabela(null)).toEqual({ ...TABELA_PROVISORIA, atualizadaEm: undefined, atualizadaPor: undefined });
  });
});

describe("aviso de classe divergente", () => {
  it("conta só leads em aberto com as duas classes diferentes", () => {
    const a = alertaDeClasse([
      { classe: "B", classeN8n: "A", status: "lead" },
      { classe: "B", classeN8n: "A", status: "sem_interesse" },
      { classe: "A", classeN8n: "A", status: "lead" },
      { classeN8n: "A", status: "lead" },
    ]);
    expect(a).toHaveLength(1);
    expect(a[0].titulo).toBe("1 lead tem a classe do n8n diferente da do painel");
    expect(alertaDeClasse([{ classe: "A", classeN8n: "A", status: "lead" }])).toEqual([]);
  });
});
