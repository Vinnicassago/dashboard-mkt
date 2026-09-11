"use client";

import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive, navForBrand } from "./nav-items";
import { useComPeriodo } from "./use-periodo";
import type { BrandDef } from "@/lib/brands";
import { cn } from "@/lib/utils";

type HrefFor = (href: string) => string;
const semPeriodo: HrefFor = (href) => href;

/** Subtítulo da identidade da marca conforme o tipo. */
function brandSubtitle(brand: BrandDef): string {
  return brand.type === "awareness" ? "Ganho de seguidores" : "Campanha de Leads";
}

function SideLinks({ brand, hrefFor }: { brand: BrandDef; hrefFor: HrefFor }) {
  const pathname = usePathname();
  return (
    <>
      {navForBrand(brand).map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={hrefFor(item.href)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary before:absolute before:top-1/2 before:left-0 before:h-5 before:w-1 before:-translate-y-1/2 before:rounded-r before:bg-primary before:content-['']"
                : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
            )}
          >
            <item.Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

function SideLinksComPeriodo({ brand }: { brand: BrandDef }) {
  const hrefFor = useComPeriodo();
  return <SideLinks brand={brand} hrefFor={hrefFor} />;
}

export function Sidebar({ brand }: { brand: BrandDef }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-card md:flex">
      <div className="flex h-16 items-center gap-2 border-b px-5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          {brand.initial}
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold">{brand.short}</p>
          <p className="text-xs text-muted-foreground">{brandSubtitle(brand)}</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 p-3">
        {/* useSearchParams pede Suspense; o fallback é a mesma lista, sem o período. */}
        <Suspense fallback={<SideLinks brand={brand} hrefFor={semPeriodo} />}>
          <SideLinksComPeriodo brand={brand} />
        </Suspense>
      </nav>

      <div className="border-t p-4 text-xs text-muted-foreground">
        Dashboard interno · uso do time de marketing
      </div>
    </aside>
  );
}

function MobileLinks({ brand, hrefFor }: { brand: BrandDef; hrefFor: HrefFor }) {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Rola o item ativo para o centro — os do fim da lista ficariam escondidos
  // até serem selecionados. No-op no desktop (nav é display:none).
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [pathname]);

  return (
    <>
      {navForBrand(brand).map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={hrefFor(item.href)}
            ref={active ? activeRef : undefined}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
            )}
          >
            <item.Icon className="size-3.5" />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

function MobileLinksComPeriodo({ brand }: { brand: BrandDef }) {
  const hrefFor = useComPeriodo();
  return <MobileLinks brand={brand} hrefFor={hrefFor} />;
}

/** Horizontal scrollable nav shown on mobile (md:hidden). */
export function MobileNav({ brand }: { brand: BrandDef }) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b bg-card px-3 py-2 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden">
      <Suspense fallback={<MobileLinks brand={brand} hrefFor={semPeriodo} />}>
        <MobileLinksComPeriodo brand={brand} />
      </Suspense>
    </nav>
  );
}
