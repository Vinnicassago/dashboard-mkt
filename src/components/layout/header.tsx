"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { navItemFromPath } from "./nav-items";
import { PeriodSelector } from "./period-selector";
import { BrandSelector } from "./brand-selector";
import { UserMenu } from "./user-menu";
import type { Frescor } from "@/lib/frescor";
import { cn } from "@/lib/utils";

const COR_FRESCOR: Record<Frescor["nivel"], string> = {
  ok: "text-muted-foreground",
  velho: "text-[var(--warning-text)]",
  "muito-velho": "text-[var(--danger-text)]",
};

export function Header({
  frescor,
  username,
  brand,
}: {
  /** De quando é o dado de cada fonte — já formatado no servidor. */
  frescor: Frescor[];
  username: string | null;
  brand: string;
}) {
  const pathname = usePathname();
  const item = navItemFromPath(pathname);

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b bg-background/85 px-4 shadow-sm backdrop-blur md:px-6 dark:shadow-none">
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold md:text-lg">{item?.label ?? "Dashboard"}</h1>
        {/* A pergunta da página fica colada ao título: é ela que diz o que
            procurar aqui — e, por exclusão, o que procurar em outra aba. */}
        {/* A pergunta pode ser cortada; a data do dado, nunca (B3). */}
        <p className="hidden min-w-0 items-baseline gap-1.5 text-xs sm:flex">
          {item ? <span className="truncate text-muted-foreground">{item.pergunta}</span> : null}
          {frescor.length ? (
            <span className="shrink-0 whitespace-nowrap">
              {frescor.map((f, i) => (
                <span key={f.fonte} title={f.detalhe} className={COR_FRESCOR[f.nivel]}>
                  {i > 0 || item ? " · " : ""}
                  {f.fonte} {f.quando}
                </span>
              ))}
            </span>
          ) : null}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <BrandSelector active={brand} />
        <Suspense fallback={null}>
          <PeriodSelector />
        </Suspense>
        {username ? <UserMenu username={username} /> : null}
      </div>
    </header>
  );
}
