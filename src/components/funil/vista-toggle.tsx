"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { VISTAS_DO_FUNIL, type VistaFunil } from "@/lib/funil";
import { cn } from "@/lib/utils";

/**
 * Alternância "Por período (eventos)" × "Por coorte (semana de entrada)". A vista
 * viaja na URL (`?vista=coorte`) e o período (`?range=`) fica como está: trocar
 * a leitura do funil não pode trocar a janela em silêncio.
 */
export function VistaToggle({ vista }: { vista: VistaFunil }) {
  const pathname = usePathname();
  const params = useSearchParams();

  const href = (v: VistaFunil) => {
    const p = new URLSearchParams(params.toString());
    if (v === "periodo") p.delete("vista");
    else p.set("vista", v);
    const q = p.toString();
    return q ? `${pathname}?${q}` : pathname;
  };

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Vista do funil">
      <div className="inline-flex rounded-lg border p-0.5 text-xs">
        {VISTAS_DO_FUNIL.map((v) => {
          const ativa = v.key === vista;
          return (
            <Link
              key={v.key}
              href={href(v.key)}
              scroll={false}
              aria-current={ativa ? "page" : undefined}
              title={v.hint}
              className={cn(
                "rounded-md px-3 py-1.5 font-medium transition-colors",
                ativa ? "bg-foreground/[0.08] text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v.label}
            </Link>
          );
        })}
      </div>
      <span className="text-xs text-muted-foreground">{VISTAS_DO_FUNIL.find((v) => v.key === vista)?.hint}</span>
    </div>
  );
}
