import { kpisDoPeriodo } from "./kpis";
import { pageRange } from "./page-range";
import { isRangeKey, parseCustomRange, rangeLabel } from "./range";
import type { DashboardData } from "./types";

/**
 * O período e o gasto que a conferência com o Gerenciador compara (Fase 4,
 * Configurações → Integrações `#conferir-gasto`). Puro: sem I/O, fora do bundle do
 * client (só a página e a action de Configurações o importam).
 *
 * Uma conta só: estava repetida na action da conferência e na página da Mídia.
 */

export interface GastoParaConferir {
  /** O gasto TOTAL do período (conversão + descoberta). */
  gasto: number;
  /** AAAA-MM-DD. */
  de: string;
  /** AAAA-MM-DD. */
  ate: string;
  /** "7 dias, 06/11/2026 a 12/11/2026" · "06/11/2026 a 12/11/2026" (período livre) · "campanha inteira". */
  rotulo: string;
  /** A chave resolvida ("all" sem chave ou com uma chave inválida). */
  rangeKey: string;
}

const dataBr = (iso: string) => iso.split("-").reverse().join("/");

/**
 * O gasto TOTAL do período = `kpisDoPeriodo(data, range).investimento.valor` — o
 * "Investimento total" do ⓘ do resumo da Mídia (o Gerenciador mostra o total; não
 * depende de regra de marca nem de cobertura). Chave inválida cai em "all".
 */
export function gastoDoPeriodoParaConferir(
  data: DashboardData,
  rangeKey: string | undefined,
  hoje: string,
): GastoParaConferir {
  const rk = rangeKey && isRangeKey(rangeKey) ? rangeKey : undefined;
  const { range, rangeKey: resolvida } = pageRange(data, rk, hoje);
  const de = range?.from ?? data.adDaily[0]?.date ?? data.campaign.startDate ?? hoje;
  const ate = range?.to ?? hoje;
  const rotulo = range
    ? `${parseCustomRange(rk) ? "" : `${rangeLabel(rk)}, `}${dataBr(de)} a ${dataBr(ate)}`
    : "campanha inteira";
  return {
    gasto: kpisDoPeriodo(data, range, { hoje }).investimento.valor,
    de,
    ate,
    rotulo,
    rangeKey: resolvida,
  };
}
