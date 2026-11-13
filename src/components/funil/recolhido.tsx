import type { ReactNode } from "react";
import { Info } from "@/components/ui/info";
import { cn } from "@/lib/utils";

/**
 * Um bloco RECOLHIDO do Funil (Fase 3, §2.4): `<details>` fechado; o `<summary>`
 * é rótulo de navegação, sem número (os números já estão no funil — um fato, um
 * lugar; exceção declarada à régua do título, F3-D26). O ⓘ fica DENTRO do corpo
 * aberto, no canto, e não no `<summary>`: o clique nele não abre nem fecha o bloco.
 *
 * Com `id` (a Mídia, Fase 4), o `<details>` vira âncora e ganha `scroll-mt-24`: o
 * cabeçalho é sticky e o alvo não pode ficar embaixo dele (K37). Sem `id` (o Funil),
 * o HTML não muda.
 *
 * `suppressHydrationWarning`: com a âncora na URL (`/midia#criativos-tabela`), o
 * próprio navegador abre o `<details>` antes de o React hidratar; o `open` a mais é
 * o que se quer, não um erro (não muda o HTML do servidor).
 */
export function Recolhido({
  resumo,
  dica,
  rotulo,
  children,
  className,
  id,
}: {
  /** O texto do `<summary>` ("Semana a semana", "Coorte por semana de entrada"). */
  resumo: string;
  /** O ⓘ do bloco, pronto. */
  dica: string;
  /** O nome do ⓘ para leitor de tela ("Sobre …"). */
  rotulo: string;
  children: ReactNode;
  className?: string;
  /** A âncora do bloco (`/midia#detalhes`); com ela, também `scroll-mt-24`. */
  id?: string;
}) {
  return (
    <details
      id={id}
      suppressHydrationWarning
      data-parte="recolhido"
      className={cn("min-w-0 rounded-xl border bg-card text-card-foreground shadow-sm", id && "scroll-mt-24", className)}
    >
      <summary className="cursor-pointer rounded-xl px-5 py-4 text-sm font-semibold tracking-tight select-none hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none">
        {resumo}
      </summary>
      <div className="min-w-0 px-5 pb-5">
        <div className="flex justify-end">
          <Info texto={dica} rotulo={rotulo} />
        </div>
        {children}
      </div>
    </details>
  );
}
