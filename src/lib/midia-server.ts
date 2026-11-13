import "server-only";
import { getData, listLeadEvents } from "./data/store";
import { kpisDoPeriodo } from "./kpis";
import { campanhaDaLive } from "./live-server";
import { contextoDeMarcas } from "./meta/config";
import { montarMidiaDaTela, type MidiaDaTela } from "./midia";
import { pageRange } from "./page-range";
import { PERIODO_PADRAO_DA_MIDIA, hojeEmBrasilia } from "./range";
import { estadoDoRoboAgora } from "./robo/estado";
import { coberturaDeAnuncios, estadoDaFonte } from "./sincronizacao";

/**
 * O carregador da Mídia (Fase 4, nov/26) — o I/O da página num lugar só; a tela sai
 * INTEIRA da função pura `montarMidiaDaTela` (`lib/midia.ts`).
 *
 * O robô entra pelo store: `estadoDoRoboAgora` (o MESMO da Fila, do Início e do
 * Funil) e as colunas `robo_*` que o sync gravou no lead. Nenhuma leitura do banco do
 * robô — este arquivo não importa `robo/client` nem `robo/sync`.
 *
 * Sem `?range=` vale a semana (`PERIODO_PADRAO_DA_MIDIA`, F4-D1): "o que faço com a
 * verba ESTA semana?". O recorte da live decide pela chave resolvida (K8). Sem Δ
 * (`comparar: false`). Não lê conferências nem `can()`: a conferência mora em
 * Configurações → Integrações.
 */
export interface MidiaCarregada {
  /** A chave do período resolvida (sem `?range=` = "7d"). */
  rangeKey: string;
  midia: MidiaDaTela;
}

export async function carregarMidia(brandSlug: string, rangeKeyParam?: string): Promise<MidiaCarregada> {
  const agoraDate = new Date();
  const agora = agoraDate.toISOString();
  const hoje = hojeEmBrasilia(agoraDate);

  const [data, { brandRules, campanhasDaConta }, cobertura, ads, eventos, robo, cfgLive] = await Promise.all([
    getData(brandSlug),
    contextoDeMarcas(),
    coberturaDeAnuncios(brandSlug),
    estadoDaFonte("ads", brandSlug),
    listLeadEvents({ brand: brandSlug, limit: 0 }),
    estadoDoRoboAgora(brandSlug, agoraDate),
    campanhaDaLive(),
  ]);

  const { range, rangeKey, naoComecou } = pageRange(data, rangeKeyParam ?? PERIODO_PADRAO_DA_MIDIA, hoje);
  const kpis = kpisDoPeriodo(data, range, { brandRules, campanhasDaConta, cobertura, comparar: false, hoje, agora });

  return {
    rangeKey,
    midia: montarMidiaDaTela({
      data,
      range,
      rangeKey,
      naoComecou,
      kpis,
      opcoesKpis: { brandRules, campanhasDaConta, cobertura },
      eventos,
      robo,
      cobertura,
      ultimoSyncAds: ads.ultimoOk,
      cfgLive,
      marca: brandSlug,
      hoje,
      agora,
    }),
  };
}
