import { Card } from "@/components/ui/card";

/**
 * Skeleton específico da rota Config (co-locado): cards de formulário em coluna
 * estreita (max-w-3xl), sem a linha de KPIs do loading genérico do grupo — que
 * piscaria 4 KPIs falsos que nunca viram conteúdo aqui.
 */
export default function ConfigLoading() {
  return (
    <div className="max-w-3xl space-y-6" aria-hidden>
      <div className="h-4 w-2/3 animate-pulse rounded bg-foreground/[0.08]" />
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="p-5">
          <div className="h-4 w-40 animate-pulse rounded bg-foreground/[0.08]" />
          <div className="mt-2 h-3 w-64 animate-pulse rounded bg-foreground/[0.06]" />
          <div className="mt-4 space-y-2">
            <div className="h-9 w-full animate-pulse rounded-lg bg-foreground/[0.06]" />
            <div className="h-9 w-full animate-pulse rounded-lg bg-foreground/[0.06]" />
          </div>
        </Card>
      ))}
    </div>
  );
}
