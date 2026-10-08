"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { RANGE_PRESETS, buildCustomKey, hojeEmBrasilia, parseCustomRange, rangeLabel } from "@/lib/range";
import { periodoPadraoDe } from "./nav-items";
import { cn } from "@/lib/utils";

export function PeriodSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Sem `?range=`, cada página tem o seu padrão (a Bússola olha a semana): o
  // preset marcado é o que a página está mostrando, não "Campanha" por reflexo.
  const padrao = periodoPadraoDe(pathname);
  const current = params.get("range") ?? padrao;
  const custom = parseCustomRange(current);

  const [aberto, setAberto] = useState(false);
  // A página inteira é recalculada no servidor; sem isto o clique parecia não ter efeito.
  const [carregando, startTransition] = useTransition();
  const [de, setDe] = useState(custom?.from ?? "");
  const [ate, setAte] = useState(custom?.to ?? "");
  const caixa = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora ou apertar Esc — o popover não tem overlay próprio.
  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  function irPara(key: string | null) {
    const next = new URLSearchParams(params.toString());
    // "Campanha" numa página cujo padrão é outro precisa ir explícito na URL —
    // sem o parâmetro, a página voltaria ao padrão dela.
    if (!key || key === "all") {
      if (padrao === "all") next.delete("range");
      else next.set("range", "all");
    } else if (key === padrao) next.delete("range");
    else next.set("range", key);
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function aplicar() {
    if (!de && !ate) return;
    irPara(buildCustomKey(de, ate));
    setAberto(false);
  }

  const hoje = hojeEmBrasilia();

  return (
    <div className="relative inline-flex" ref={caixa} aria-busy={carregando}>
      <div
        className={cn(
          "inline-flex h-9 items-center gap-0.5 rounded-lg border bg-card p-0.5 transition-opacity",
          carregando && "pointer-events-none animate-pulse opacity-60",
        )}
      >
        {RANGE_PRESETS.map((preset) => {
          const active = current === preset.key;
          return (
            <button
              key={preset.key}
              type="button"
              aria-pressed={active}
              disabled={carregando}
              onClick={() => irPara(preset.key)}
              className={cn(
                "flex h-full items-center rounded-md px-2 text-xs font-medium transition-colors sm:px-2.5",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
              )}
            >
              {preset.label}
            </button>
          );
        })}

        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={aberto}
          onClick={() => setAberto((v) => !v)}
          className={cn(
            "flex h-full items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors sm:px-2.5",
            custom
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
          )}
        >
          <CalendarRange className="size-3.5" />
          {custom ? rangeLabel(current) : "Escolher"}
        </button>
      </div>

      {aberto ? (
        <div
          role="dialog"
          aria-label="Escolher período"
          className="absolute right-0 top-11 z-50 w-64 rounded-xl border bg-card p-4 shadow-lg"
        >
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">De</span>
              <input
                type="date"
                value={de}
                max={ate || hoje}
                onChange={(e) => setDe(e.target.value)}
                className="h-8 rounded-md border bg-background px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Até</span>
              <input
                type="date"
                value={ate}
                min={de || undefined}
                max={hoje}
                onChange={(e) => setAte(e.target.value)}
                className="h-8 rounded-md border bg-background px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              />
            </label>

            <p className="text-[11px] text-muted-foreground">
              Preencha só o &ldquo;De&rdquo; para ver daquela data em diante.
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={aplicar}
                disabled={!de && !ate}
                className="h-8 flex-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-40"
              >
                Aplicar
              </button>
              {custom ? (
                <button
                  type="button"
                  onClick={() => {
                    setDe("");
                    setAte("");
                    irPara(null);
                    setAberto(false);
                  }}
                  className="h-8 rounded-md border px-3 text-xs text-muted-foreground hover:text-foreground"
                >
                  Limpar
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
