/**
 * Live 01/12 — etapa 8 (E2-23): conferência do gasto com o Gerenciador. Puro.
 */
import { describe, expect, it } from "vitest";
import { conferenciaBate, diferencaDoGasto, lerValorEmReais, textoDaDiferenca } from "../conferencia";

describe("conferência com o Gerenciador", () => {
  it("diferença sobre o Gerenciador; até 5% bate, acima não", () => {
    expect(diferencaDoGasto(3607.16, 3612.4)).toBeCloseTo(-0.00145, 5);
    expect(conferenciaBate(diferencaDoGasto(105, 100))).toBe(true); // 5% exato
    expect(conferenciaBate(diferencaDoGasto(106, 100))).toBe(false);
    expect(conferenciaBate(diferencaDoGasto(94, 100))).toBe(false);
  });

  it("Gerenciador em zero: com gasto no painel não há base (e não bate); os dois zero batem", () => {
    expect(diferencaDoGasto(50, 0)).toBeNull();
    expect(conferenciaBate(null)).toBe(false);
    expect(diferencaDoGasto(0, 0)).toBe(0);
    expect(textoDaDiferenca(null)).toContain("sem base");
  });

  it("texto com sinal e vírgula", () => {
    expect(textoDaDiferenca(0.023)).toBe("+2,3%");
    expect(textoDaDiferenca(-0.06)).toBe("−6,0%");
    expect(textoDaDiferenca(0)).toBe("0,0%");
  });

  it("o valor digitado em qualquer grafia de real", () => {
    expect(lerValorEmReais("3.612,40")).toBe(3612.4);
    expect(lerValorEmReais("3612,40")).toBe(3612.4);
    expect(lerValorEmReais("3612.40")).toBe(3612.4);
    expect(lerValorEmReais("R$ 3.612")).toBe(3612);
    expect(lerValorEmReais("1.234.567")).toBe(1234567);
    expect(lerValorEmReais("abc")).toBeNaN();
  });
});
