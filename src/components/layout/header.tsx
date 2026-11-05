"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { navItemFromPath } from "./nav-items";
import { PeriodSelector } from "./period-selector";
import { BrandSelector } from "./brand-selector";
import { UserMenu } from "./user-menu";
import { IndicadorAlertas } from "./alertas";
import type { AtalhoDoSeletor } from "./periodo-do-seletor";
import { Info } from "@/components/ui/info";
import type { Frescor } from "@/lib/frescor";

/** Depois disso na mesma tela, o número pode já não ser o do banco. */
const MINUTOS_ATE_AVISAR = 10;

/**
 * "Dados de 12 min atrás — Atualizar" (D4). A aba que ficou aberta mostrava o
 * que o servidor mandou quando ela abriu — a Fila mostrou 62 esperando quando
 * já era 1. O relógio recomeça a cada navegação e a cada atualização.
 *
 * Encolhe com a tela (o grupo da direita do cabeçalho não encolhe): no celular só
 * o ícone (com o `aria-label`), de `sm` o "Atualizar" e só a partir de 1.800 px o
 * "dados de N min atrás —" (que está sempre no `title`) — com o texto inteiro, a
 * 375 px o cabeçalho passava da tela (410 px) e, com o seletor em linha (`2xl`),
 * cobria a data do dado do cabeçalho.
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
      title={`Dados de ${minutos} min atrás — a tela está aberta há algum tempo e os números podem ter mudado no banco`}
      aria-label={`Atualizar: dados de ${minutos} min atrás`}
    >
      <RefreshCw className="size-3.5" aria-hidden />
      <span className="hidden sm:inline" aria-hidden>
        <span className="hidden min-[1800px]:inline">dados de {minutos} min atrás — </span>
        Atualizar
      </span>
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
  atalhoLive = null,
  chavesDaLive = [],
}: {
  /** De quando é o dado de cada fonte — já formatado no servidor. */
  frescor: Frescor[];
  username: string | null;
  brand: string;
  /** Quando o servidor montou esta tela (muda a cada atualização). */
  geradoEm: string;
  /** O atalho "Live 01/12" do seletor (`atalhoDaLive`); `null` sem régua. */
  atalhoLive?: AtalhoDoSeletor | null;
  /** As três chaves da régua da live (o popover "Escolher" abre vazio com elas). */
  chavesDaLive?: string[];
}) {
  const pathname = usePathname();
  const item = navItemFromPath(pathname);

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b bg-background/85 px-4 shadow-sm backdrop-blur md:px-6 dark:shadow-none">
      <div className="min-w-0">
        {/* A pergunta da página é o ⓘ do título (D10/T2): diz o que procurar
            aqui — e, por exclusão, o que procurar em outra aba — sem ocupar a
            linha de baixo, que é da data do dado. */}
        <div className="flex min-w-0 items-center gap-0.5">
          <h1 className="truncate text-base font-semibold md:text-lg">{item?.label ?? "Dashboard"}</h1>
          {item ? <Info texto={item.pergunta} rotulo={`Sobre ${item.label}`} /> : null}
        </div>
        {/* A data do dado nunca é cortada (B3). */}
        {frescor.length ? (
          <p className="hidden min-w-0 text-xs whitespace-nowrap sm:block">
            {frescor.map((f, i) => (
              <span
                key={f.fonte}
                title={f.detalhe}
                className={f.falhando ? "text-[var(--danger-text)]" : COR_FRESCOR[f.nivel]}
              >
                {i > 0 ? " · " : ""}
                {f.fonte} {f.quando}
                {f.falhando ? " (falhando)" : ""}
              </span>
            ))}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Suspense fallback={null}>
          <AvisoDadosAntigos geradoEm={geradoEm} />
          <IndicadorAlertas />
        </Suspense>
        <BrandSelector active={brand} />
        <Suspense fallback={null}>
          <PeriodSelector atalho={atalhoLive} chavesDaLive={chavesDaLive} />
        </Suspense>
        {username ? <UserMenu username={username} /> : null}
      </div>
    </header>
  );
}
