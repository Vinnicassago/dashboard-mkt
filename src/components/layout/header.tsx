"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { navItemFromPath } from "./nav-items";
import { PeriodSelector } from "./period-selector";
import { BrandSelector } from "./brand-selector";
import { UserMenu } from "./user-menu";

export function Header({
  updatedAt,
  username,
  brand,
}: {
  updatedAt: string;
  username: string | null;
  brand: string;
}) {
  const pathname = usePathname();
  const item = navItemFromPath(pathname);
  const updated = new Date(updatedAt).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b bg-background/85 px-4 shadow-sm backdrop-blur md:px-6 dark:shadow-none">
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold md:text-lg">{item?.label ?? "Dashboard"}</h1>
        {/* A pergunta da página fica colada ao título: é ela que diz o que
            procurar aqui — e, por exclusão, o que procurar em outra aba. */}
        <p className="hidden truncate text-xs text-muted-foreground sm:block">
          {item ? `${item.pergunta} · atualizado em ${updated}` : `Atualizado em ${updated}`}
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
