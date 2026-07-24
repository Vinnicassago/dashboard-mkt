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
  series: [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ],
  funnel: [
    "var(--funnel-1)",
    "var(--funnel-2)",
    "var(--funnel-3)",
    "var(--funnel-4)",
    "var(--funnel-5)",
  ],
} as const;
