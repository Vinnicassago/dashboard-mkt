"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * Fronteira de erro do grupo (dashboard): uma exceção em qualquer página cai aqui
 * (dados de getData/sync podem falhar) em vez de derrubar o usuário na tela de
 * erro crua do Next, fora do shell/tema. Client component (requisito do Next).
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[320px] items-center justify-center">
      <Card className="max-w-md p-8 text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-[var(--critical)]/12 text-[var(--danger-text)]">
          <AlertTriangle className="size-5" />
        </div>
        <h2 className="mt-4 text-base font-semibold">Algo deu errado ao carregar</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Não foi possível montar esta tela. Costuma ser temporário — tente de novo.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          <RotateCw className="size-4" />
          Tentar de novo
        </button>
      </Card>
    </div>
  );
}
