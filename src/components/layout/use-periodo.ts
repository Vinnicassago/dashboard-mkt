"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { periodoPadraoDe, comPeriodoDaTela } from "./nav-items";

/**
 * O período escolhido acompanha a navegação.
 *
 * Os links da barra lateral apontavam para a rota pura: escolher "7 dias" na
 * home e clicar em Funil voltava para a campanha inteira sem aviso — duas
 * páginas seguidas contando o mesmo fato em janelas diferentes.
 *
 * Sem `?range=`, vale o padrão da página (o Início olha a semana): o link leva
 * o período que a tela está MOSTRANDO, não o que a URL omitiu. Com a chave da
 * live na URL, os links levam a chave (Funil e Mídia no período da live).
 * "Campanha" vai explícita para o destino cujo padrão é outro (o Início):
 * `comPeriodoDaTela`.
 */
export function useComPeriodo(): (href: string) => string {
  const pathname = usePathname();
  const range = useSearchParams().get("range") ?? periodoPadraoDe(pathname);
  return (href) => comPeriodoDaTela(href, range);
}
