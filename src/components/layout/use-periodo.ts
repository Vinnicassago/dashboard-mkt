"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { comPeriodo } from "@/lib/range";
import { periodoPadraoDe } from "./nav-items";

/**
 * O período escolhido acompanha a navegação.
 *
 * Os links da barra lateral apontavam para a rota pura: escolher "7 dias" na
 * home e clicar em Jornada voltava para a campanha inteira sem aviso — duas
 * páginas seguidas contando o mesmo fato em janelas diferentes.
 *
 * Sem `?range=`, vale o padrão da página (a Bússola olha a semana): o link leva
 * o período que a tela está MOSTRANDO, não o que a URL omitiu.
 */
export function useComPeriodo(): (href: string) => string {
  const pathname = usePathname();
  const range = useSearchParams().get("range") ?? periodoPadraoDe(pathname);
  return (href) => comPeriodo(href, range);
}
