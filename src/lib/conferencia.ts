/**
 * Conferência do gasto do painel com o Gerenciador de Anúncios (E2-23). Puro.
 *
 * A diferença é sobre o Gerenciador (a fonte que cobra): (painel − Gerenciador) ÷
 * Gerenciador. Até 5% para mais ou para menos é normal (a Meta revisa números
 * por até 48 h e o sync cobre até 2 dias antes de terminar); acima disso, vale
 * olhar: sync falhando, marca trocada, campanha fora da regra.
 */
export const TOLERANCIA_CONFERENCIA = 0.05;

/** A diferença relativa; null quando o Gerenciador é 0 e o painel não (não há base). */
export function diferencaDoGasto(painel: number, gerenciador: number): number | null {
  if (gerenciador === 0) return painel === 0 ? 0 : null;
  return (painel - gerenciador) / gerenciador;
}

/** Dentro da tolerância? Sem base (Gerenciador 0 com gasto no painel), não bate. */
export function conferenciaBate(diferenca: number | null): boolean {
  return diferenca != null && Math.abs(diferenca) <= TOLERANCIA_CONFERENCIA + 1e-9;
}

/**
 * O valor digitado, em reais: "3.612,40" (pt-BR), "3612,40", "3612.40" e
 * "R$ 3.612" valem. Com vírgula, ela é o decimal e o ponto é milhar; sem vírgula,
 * ponto seguido de 1 ou 2 dígitos no fim é decimal. Lixo → NaN.
 */
export function lerValorEmReais(s: string): number {
  const t = s.replace(/[R$\s]/g, "");
  if (!/^[\d.,]+$/.test(t)) return Number.NaN;
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/\.\d{1,2}$/.test(t) && t.split(".").length === 2) return Number(t);
  return Number(t.replace(/\./g, ""));
}

/** "+2,3%" / "−6,0%" / "sem base". */
export function textoDaDiferenca(diferenca: number | null): string {
  if (diferenca == null) return "sem base (Gerenciador em R$ 0)";
  const pct = Math.abs(diferenca * 100).toFixed(1).replace(".", ",");
  return `${diferenca > 0 ? "+" : diferenca < 0 ? "−" : ""}${pct}%`;
}
