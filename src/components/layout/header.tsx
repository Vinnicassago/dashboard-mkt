"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { sectionFromPath } from "./nav-items";
import { PeriodSelector } from "./period-selector";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export function Header({
  updatedAt,
  username,
}: {
  updatedAt: string;
  username: string | null;
}) {
  const pathname = usePathname();
  const section = sectionFromPath(pathname);
  const updated = new Date(updatedAt).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b bg-background/85 px-4 backdrop-blur md:px-6">
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold md:text-lg">{section}</h1>
        <p className="hidden text-xs text-muted-foreground sm:block">
          Atualizado em {updated}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Suspense fallback={null}>
          <PeriodSelector />
        </Suspense>
        <ThemeToggle />
        {username ? <UserMenu username={username} /> : null}
      </div>
    </header>
  );
}
