"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItemFromPath, vistasForBrand } from "./nav-items";
import { useComPeriodo } from "./use-periodo";
import type { BrandDef } from "@/lib/brands";
import { cn } from "@/lib/utils";

/**
 * As vistas de uma página, em abas no topo do conteúdo. Só aparece onde há mais
 * de uma — hoje, Conteúdo (Conta · Posts · Produção).
 */
export function SubNav({ brand }: { brand: BrandDef }) {
  const pathname = usePathname();
  const comPeriodo = useComPeriodo();
  const item = navItemFromPath(pathname);
  const vistas = item ? vistasForBrand(item, brand) : [];
  if (!item || vistas.length < 2) return null;

  return (
    <nav
      aria-label={`Vistas de ${item.label}`}
      className="-mt-1 mb-6 flex gap-1 overflow-x-auto border-b [scrollbar-width:none]"
    >
      {vistas.map((v) => {
        // A vista-raiz só é ativa na própria rota; as outras, também nas sub-rotas.
        const active =
          v.href === item.href
            ? pathname === v.href
            : pathname === v.href || pathname.startsWith(`${v.href}/`);
        return (
          <Link
            key={v.href}
            href={comPeriodo(v.href)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {v.label}
          </Link>
        );
      })}
    </nav>
  );
}
