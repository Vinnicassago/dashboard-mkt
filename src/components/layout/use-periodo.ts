"use client";

import { useSearchParams } from "next/navigation";
import { comPeriodo } from "@/lib/range";

/**
 * O período escolhido acompanha a navegação.
 *
 * Os links da barra lateral apontavam para a rota pura: escolher "7 dias" na
 * home e clicar em Jornada voltava para a campanha inteira sem aviso — duas
 * páginas seguidas contando o mesmo fato em janelas diferentes.
 */
export function useComPeriodo(): (href: string) => string {
  const range = useSearchParams().get("range");
  return (href) => comPeriodo(href, range);
}
