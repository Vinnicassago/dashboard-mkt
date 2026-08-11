/**
 * Sparkline minimalista (SVG puro, server component — sem Recharts, sem client).
 * Desenha a tendência de uma série diária como um fio + área sutil. Pensado para
 * ficar ATRÁS do conteúdo do KpiCard (absoluto, opacidade baixa), então não muda
 * a altura do card nem desalinha a fileira. Decorativo → aria-hidden.
 */
export function KpiSparkline({
  data,
  color = "var(--primary)",
  className,
}: {
  data: number[];
  color?: string;
  className?: string;
}) {
  const n = data.length;
  if (n < 2) return null;

  const w = 100;
  const h = 32;
  const pad = 1;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (n - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);

  const line = data
    .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)} ${h} L${x(0).toFixed(1)} ${h} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={area} fill={color} fillOpacity={0.08} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeOpacity={0.5}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
