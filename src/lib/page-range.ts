import { dataDateRange, type DateRange } from "./metrics";
import { hojeEmBrasilia, resolveRange } from "./range";
import type { DashboardData } from "./types";

/**
 * Resolve the active period for a page from the `range` search param.
 *
 * `naoComecou`: o período pedido ainda não começou (`range.from > hoje`) — o
 * `resolveRange` devolve o 1º dia dele, vazio (C9), e a página pode dizer isso
 * em vez de mostrar zeros como se o período tivesse passado. `hoje` vem de fora
 * só para teste; o padrão é o dia de Brasília.
 */
export function pageRange(
  data: DashboardData,
  rangeKey?: string,
  hoje: string = hojeEmBrasilia(),
): { range: DateRange | undefined; span: DateRange; rangeKey: string; naoComecou: boolean } {
  const span = dataDateRange(data);
  const range = resolveRange(rangeKey, span, hoje);
  return { range, span, rangeKey: rangeKey ?? "all", naoComecou: Boolean(range && hoje && range.from > hoje) };
}
