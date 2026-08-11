/**
 * Chart colors reference the CSS custom properties from globals.css, so they
 * follow the light/dark theme automatically (SVG fill/stroke accept var()).
 * Palette source: the validated data-viz reference instance.
 */
export const CHART = {
  grid: "var(--grid)",
  // --muted (#898781) é o mesmo tom nos dois temas e fica ~2.8:1 no claro; os
  // rótulos de eixo pedem --muted-foreground (legível nos dois temas).
  axis: "var(--muted-foreground)",
  primary: "var(--primary)",
  good: "var(--good)",
  critical: "var(--critical)",
  // A série lidera com o accent da MARCA (var(--primary): âmbar no consorcio,
  // verde na krone) e evita azul (chart-1), laranja (chart-2, vizinho do âmbar)
  // e amarelo (chart-4, duplicaria). Na krone, --chart-6 (verde) é reapontado
  // para azul em globals.css p/ não colidir com o líder verde.
  series: [
    "var(--primary)",
    "var(--chart-3)",
    "var(--chart-5)",
    "var(--chart-6)",
    "var(--chart-7)",
  ],
  funnel: [
    "var(--funnel-1)",
    "var(--funnel-2)",
    "var(--funnel-3)",
    "var(--funnel-4)",
    "var(--funnel-5)",
  ],
} as const;
