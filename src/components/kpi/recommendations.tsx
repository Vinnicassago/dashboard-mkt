import type { Recommendation, Severity } from "@/lib/recommendations";

/** Lista priorizada de ações. Cor por severidade. Server component. */
const TONE: Record<Severity, string> = {
  alta: "var(--danger-text)",
  media: "var(--primary)",
  baixa: "var(--muted-foreground)",
};
const SEV_LABEL: Record<Severity, string> = {
  alta: "Agora",
  media: "Otimizar",
  baixa: "Oportunidade",
};

export function RecommendationsCard({
  recs,
  fallback,
}: {
  recs: Recommendation[];
  fallback?: string[];
}) {
  if (recs.length === 0) {
    const lines = fallback?.length
      ? fallback
      : ["Nenhuma ação urgente — os números estão dentro do esperado."];
    return (
      <ul className="space-y-2">
        {lines.map((t, i) => (
          <li key={i} className="flex gap-2 text-sm text-muted-foreground">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="space-y-3.5">
      {recs.map((r) => (
        <li key={r.id} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
              style={{
                color: TONE[r.severity],
                background: `color-mix(in srgb, ${TONE[r.severity]} 12%, transparent)`,
              }}
            >
              {SEV_LABEL[r.severity]}
            </span>
            <p className="min-w-0 text-sm font-medium">{r.title}</p>
          </div>
          <p className="text-sm text-muted-foreground">{r.detail}</p>
        </li>
      ))}
    </ul>
  );
}
