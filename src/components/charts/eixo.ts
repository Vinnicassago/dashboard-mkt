/**
 * O eixo X das barras diárias com um TETO de datas (puro: o teste de texto do
 * Início conta quantos rótulos o gráfico desenha). O `interval` numérico do
 * Recharts mostra uma data a cada `intervalo + 1` dias, a partir da primeira —
 * determinístico, ao contrário do "preserveStartEnd", que depende da largura.
 */
export function intervaloDoEixo(dias: number, maxDatas: number): number {
  if (!(dias > 0) || !(maxDatas > 0)) return 0;
  return Math.max(0, Math.ceil(dias / maxDatas) - 1);
}

/** Quantas datas o eixo desenha com esse `interval` (≤ `maxDatas`). */
export function datasNoEixo(dias: number, maxDatas: number): number {
  if (!(dias > 0)) return 0;
  return Math.ceil(dias / (intervaloDoEixo(dias, maxDatas) + 1));
}
