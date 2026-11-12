import "server-only";
import { getData, listLeadEvents } from "./data/store";
import { montarFunilDaTela, type FunilDaTela } from "./funil";
import { kpisDoPeriodo } from "./kpis";
import { contextoDeMarcas } from "./meta/config";
import { pageRange } from "./page-range";
import { hojeEmBrasilia } from "./range";
import { estadoDoRoboAgora } from "./robo/estado";
import { coberturaDeAnuncios } from "./sincronizacao";

/**
 * O carregador do Funil (Fase 3, nov/26) — o I/O da página num lugar só; a tela
 * sai INTEIRA da função pura `montarFunilDaTela` (`lib/funil.ts`).
 *
 * O robô entra pelo store: `estadoDoRoboAgora` (o MESMO da Fila e do Início) e as
 * colunas `robo_*` que o sync gravou no lead. Nenhuma leitura do banco do robô —
 * este arquivo não importa `robo/client` nem `robo/sync`.
 *
 * Sem `?range=` vale a campanha inteira ("all", F3-D12): coorte curta é imatura.
 * Sem Δ (`comparar: false`): o Funil não compara períodos (F3-D11).
 */
export interface FunilCarregado {
  /** A chave do período resolvida (sem `?range=` = "all"). */
  rangeKey: string;
  funil: FunilDaTela;
}

export async function carregarFunil(brandSlug: string, rangeKeyParam?: string): Promise<FunilCarregado> {
  const agoraDate = new Date();
  const agora = agoraDate.toISOString();
  const hoje = hojeEmBrasilia(agoraDate);

  const [data, { brandRules, campanhasDaConta }, cobertura, eventos, robo] = await Promise.all([
    getData(brandSlug),
    contextoDeMarcas(),
    coberturaDeAnuncios(brandSlug),
    listLeadEvents({ brand: brandSlug, limit: 0 }),
    estadoDoRoboAgora(brandSlug, agoraDate),
  ]);

  const { range, rangeKey } = pageRange(data, rangeKeyParam, hoje);
  const kpis = kpisDoPeriodo(data, range, { brandRules, campanhasDaConta, cobertura, comparar: false, hoje, agora });

  return {
    rangeKey,
    funil: montarFunilDaTela({ data, range, rangeKey, kpis, eventos, robo, cobertura, agora, hoje }),
  };
}
