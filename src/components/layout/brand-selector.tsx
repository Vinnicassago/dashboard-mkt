"use client";

import { useTransition } from "react";
import { BRANDS } from "@/lib/brands";
import { setActiveBrand } from "@/app/(dashboard)/brand-actions";
import { cn } from "@/lib/utils";

/**
 * Seletor de marca ativa (consorcio.brunno ↔ krone.capital). Grava o cookie via
 * server action, que revalida o layout; as páginas re-renderizam recortadas pela
 * marca. Não usa `?brand=` de propósito — searchParams não chegam ao layout.
 */
export function BrandSelector({ active }: { active: string }) {
  const [pending, start] = useTransition();

  if (BRANDS.length < 2) return null;

  return (
    <div
      role="group"
      aria-label="Marca"
      className="flex items-center gap-0.5 rounded-lg border bg-card p-0.5"
    >
      {BRANDS.map((b) => {
        const isActive = b.slug === active;
        return (
          <button
            key={b.slug}
            type="button"
            disabled={pending || isActive}
            aria-pressed={isActive}
            title={b.handle}
            onClick={() => start(() => setActiveBrand(b.slug))}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:cursor-default",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
              pending && "opacity-70",
            )}
          >
            <span
              className={cn(
                "grid size-4 place-items-center rounded text-[10px] font-bold",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-foreground/10 text-foreground",
              )}
            >
              {b.initial}
            </span>
            <span className="hidden sm:inline">{b.short}</span>
          </button>
        );
      })}
    </div>
  );
}
