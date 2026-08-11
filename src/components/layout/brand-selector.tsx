"use client";

import { useTransition } from "react";
import { BRANDS, brandTheme } from "@/lib/brands";
import { setActiveBrand } from "@/app/(dashboard)/brand-actions";
import { cn } from "@/lib/utils";

/** startViewTransition é Baseline recente — tipamos de forma leve p/ feature-detect. */
type ViewTransition = { ready: Promise<void> };
type DocWithVT = Document & {
  startViewTransition?: (cb: () => void) => ViewTransition;
};

/**
 * Seletor de marca ativa (consorcio.brunno ↔ krone.capital). O TEMA é definido
 * pela marca (consorcio = escuro/âmbar, krone = claro/verde), então trocar de
 * marca troca o tema inteiro. Fluxo do clique:
 *   1. Aplica data-theme/data-brand OTIMISTA no <html> (sem esperar a rede).
 *   2. Envolve esse flip numa View Transition e anima um círculo (clip-path)
 *      expandindo do botão clicado — a nova identidade "se espalha" pela tela.
 *   3. Dispara a server action (grava cookie + revalidatePath) em paralelo; o
 *      re-render do servidor confirma os mesmos atributos (sem snap-back).
 * Sem suporte a View Transitions ou com prefers-reduced-motion, faz só o flip
 * (o crossfade de tokens em globals.css suaviza). Não usa `?brand=` de propósito
 * — searchParams não chegam ao layout.
 */
export function BrandSelector({ active }: { active: string }) {
  const [pending, start] = useTransition();

  if (BRANDS.length < 2) return null;

  function switchBrand(slug: string, e: React.MouseEvent) {
    if (slug === active || pending) return;

    const root = document.documentElement;
    const applyBrand = () => {
      root.dataset.theme = brandTheme(slug);
      root.dataset.brand = slug;
    };

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const startVT = (document as DocWithVT).startViewTransition;
    // A View Transition exige documento visível (aba em background/oculta a
    // aborta com InvalidStateError). Sem VT, o flip abaixo é instantâneo e o
    // crossfade de tokens (globals.css) suaviza.
    const canAnimate =
      !!startVT && !reduceMotion && document.visibilityState === "visible";

    if (canAnimate && startVT) {
      // Origem do círculo = ponto do clique; raio = canto mais distante da tela.
      const x = e.clientX;
      const y = e.clientY;
      const endRadius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );
      const transition = startVT.call(document, applyBrand);
      transition.ready
        .then(() => {
          root.animate(
            {
              clipPath: [
                `circle(0px at ${x}px ${y}px)`,
                `circle(${endRadius}px at ${x}px ${y}px)`,
              ],
            },
            {
              duration: 450,
              easing: "cubic-bezier(0.4, 0, 0.2, 1)",
              pseudoElement: "::view-transition-new(root)",
            },
          );
        })
        .catch(() => {});
    } else {
      applyBrand();
    }

    // Persiste a marca (cookie) e revalida o layout, fora da janela do snapshot.
    start(() => setActiveBrand(slug));
  }

  return (
    <div
      role="group"
      aria-label="Marca"
      className="flex h-9 items-center gap-0.5 rounded-lg border bg-card p-0.5"
    >
      {BRANDS.map((b) => {
        const isActive = b.slug === active;
        return (
          <button
            key={b.slug}
            type="button"
            disabled={pending || isActive}
            aria-pressed={isActive}
            aria-label={b.label}
            title={b.handle}
            onClick={(e) => switchBrand(b.slug, e)}
            className={cn(
              "flex h-full items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors disabled:cursor-default",
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
