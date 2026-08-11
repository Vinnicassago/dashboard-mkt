import { Card } from "@/components/ui/card";

/**
 * Skeleton de carregamento compartilhado por TODAS as rotas do dashboard
 * (App Router: um loading.tsx no grupo cobre as páginas filhas). As páginas são
 * dinâmicas (getData/sync podem demorar), então isto dá feedback imediato em vez
 * de tela em branco. O `animate-pulse` é neutralizado por prefers-reduced-motion
 * (bloco reduce em globals.css). Aria-hidden: é decorativo; o leitor de tela
 * anuncia o conteúdo real quando chega.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-hidden>
      {/* Linha de KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-5">
            <div className="h-4 w-24 animate-pulse rounded bg-foreground/[0.08]" />
            <div className="mt-3 h-8 w-32 animate-pulse rounded bg-foreground/[0.08]" />
            <div className="mt-2.5 h-3 w-20 animate-pulse rounded bg-foreground/[0.06]" />
          </Card>
        ))}
      </div>

      {/* Bloco de gráfico / tabela */}
      <Card className="p-5">
        <div className="h-4 w-40 animate-pulse rounded bg-foreground/[0.08]" />
        <div className="mt-4 h-64 w-full animate-pulse rounded-lg bg-foreground/[0.06]" />
      </Card>
    </div>
  );
}
