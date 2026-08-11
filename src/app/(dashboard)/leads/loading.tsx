import { Card } from "@/components/ui/card";

/** Skeleton da rota Leads (co-locado): cards com linhas de tabela, sem KPIs. */
export default function LeadsLoading() {
  return (
    <div className="space-y-6" aria-hidden>
      {Array.from({ length: 2 }).map((_, i) => (
        <Card key={i} className="p-5">
          <div className="h-4 w-48 animate-pulse rounded bg-foreground/[0.08]" />
          <div className="mt-2 h-3 w-72 animate-pulse rounded bg-foreground/[0.06]" />
          <div className="mt-4 space-y-2.5">
            {Array.from({ length: 5 }).map((_, r) => (
              <div
                key={r}
                className="h-8 w-full animate-pulse rounded bg-foreground/[0.05]"
              />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
