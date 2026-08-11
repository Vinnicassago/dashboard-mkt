import { Card } from "@/components/ui/card";

/** Skeleton da rota UTM (co-locado): um card único em max-w-4xl, sem KPIs. */
export default function UtmLoading() {
  return (
    <div className="max-w-4xl space-y-6" aria-hidden>
      <Card className="p-5">
        <div className="h-4 w-40 animate-pulse rounded bg-foreground/[0.08]" />
        <div className="mt-2 h-3 w-72 animate-pulse rounded bg-foreground/[0.06]" />
        <div className="mt-5 space-y-3">
          <div className="h-10 w-full animate-pulse rounded-lg bg-foreground/[0.06]" />
          <div className="h-10 w-full animate-pulse rounded-lg bg-foreground/[0.06]" />
          <div className="h-24 w-full animate-pulse rounded-lg bg-foreground/[0.06]" />
        </div>
      </Card>
    </div>
  );
}
