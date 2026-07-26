/**
 * Chart colors reference the CSS custom properties from globals.css, so they
 * follow the light/dark theme automatically (SVG fill/stroke accept var()).
 * Palette source: the validated data-viz reference instance.
 */
export const CHART = {
  grid: "var(--grid)",
  axis: "var(--muted)",
  primary: "var(--primary)",
  good: "var(--good)",
  critical: "var(--critical)",
  // A marca é âmbar (var(--primary)); a série lidera com ela e evita azul (chart-1),
  // laranja (chart-2, vizinho do âmbar) e amarelo (chart-4, duplicaria), usando
  // cores bem separadas para preservar a distinção entre séries.
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
