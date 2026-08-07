import type { Recommendation, Severity } from "@/lib/recommendations";

/** Lista priorizada de ações. Cor por severidade. Server component. */
const TONE: Record<Severity, string> = {
  alta: "var(--critical)",
  media: "var(--primary)",
  baixa: "var(--muted)",
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
        <li key={r.id} className="flex gap-3">
          <span
            className="mt-1.5 size-2 shrink-0 rounded-full"
            style={{ background: TONE[r.severity] }}
            title={SEV_LABEL[r.severity]}
          />
          <div className="min-w-0">
            <p className="text-sm font-medium">{r.title}</p>
            <p className="text-sm text-muted-foreground">{r.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
