"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { navItemFromPath } from "./nav-items";
import { PeriodSelector } from "./period-selector";
import { BrandSelector } from "./brand-selector";
import { UserMenu } from "./user-menu";
import { IndicadorAlertas } from "./alertas";
import type { Frescor } from "@/lib/frescor";

/** Depois disso na mesma tela, o número pode já não ser o do banco. */
const MINUTOS_ATE_AVISAR = 10;

/**
 * "Dados de 12 min atrás — Atualizar" (D4). A aba que ficou aberta mostrava o
 * que o servidor mandou quando ela abriu — a Fila mostrou 62 esperando quando
 * já era 1. O relógio recomeça a cada navegação e a cada atualização.
 */
function AvisoDadosAntigos({ geradoEm }: { geradoEm: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const busca = useSearchParams().toString();
  // O relógio anda por intervalo; a "hora em que a tela foi montada" é a do
  // tique em que a navegação/atualização aconteceu (precisão de 30 s basta).
  const chave = `${pathname}?${busca}#${geradoEm}`;
  const [agora, setAgora] = useState<number | null>(null);
  const [marca, setMarca] = useState<{ chave: string; t: number | null }>({ chave, t: null });
  if (marca.chave !== chave || (marca.t == null && agora != null)) setMarca({ chave, t: agora });
  useEffect(() => {
    const tique = () => setAgora(Date.now());
    const primeiro = setTimeout(tique, 0);
    const relogio = setInterval(tique, 30_000);
    return () => {
      clearTimeout(primeiro);
      clearInterval(relogio);
    };
  }, []);
  const desde = marca.t;
  if (desde == null || agora == null) return null;
  const minutos = Math.floor((agora - desde) / 60_000);
  if (minutos < MINUTOS_ATE_AVISAR) return null;
  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--warning)]/40 px-2.5 text-xs font-medium text-[var(--warning-text)]"
      title="A tela está aberta há algum tempo — os números podem ter mudado no banco"
    >
      <RefreshCw className="size-3.5" />
      <span className="hidden sm:inline">dados de {minutos} min atrás —</span> Atualizar
    </button>
  );
}

const COR_FRESCOR: Record<Frescor["nivel"], string> = {
  ok: "text-muted-foreground",
  velho: "text-[var(--warning-text)]",
  "muito-velho": "text-[var(--danger-text)]",
};

export function Header({
  frescor,
  username,
  brand,
  geradoEm,
}: {
  /** De quando é o dado de cada fonte — já formatado no servidor. */
  frescor: Frescor[];
  username: string | null;
  brand: string;
  /** Quando o servidor montou esta tela (muda a cada atualização). */
  geradoEm: string;
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
                <span
                  key={f.fonte}
                  title={f.detalhe}
                  className={f.falhando ? "text-[var(--danger-text)]" : COR_FRESCOR[f.nivel]}
                >
                  {i > 0 || item ? " · " : ""}
                  {f.fonte} {f.quando}
                  {f.falhando ? " (falhando)" : ""}
                </span>
              ))}
            </span>
          ) : null}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Suspense fallback={null}>
          <AvisoDadosAntigos geradoEm={geradoEm} />
          <IndicadorAlertas />
        </Suspense>
        <BrandSelector active={brand} />
        <Suspense fallback={null}>
          <PeriodSelector />
        </Suspense>
        {username ? <UserMenu username={username} /> : null}
      </div>
    </header>
  );
}
