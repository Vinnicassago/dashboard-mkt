/**
 * Helpers da Fase 4 que CHAMAM a lib nova da Mídia (fora da coleta do vitest, que só
 * pega `*.test.ts`). `fixtures-midia.ts` é só DADO — o golden do D0 roda sobre ele e
 * ele não importa a lib nova; daqui saem as entradas montadas sobre aquele dado:
 *
 *   • `entradaMidiaDa` — a `EntradaMidia` de `montarMidiaDaTela`, a MESMA conta do
 *     carregador (`pageRange` + `kpisDoPeriodo` com a cobertura da semana);
 *   • `entradaDosSinaisDa` — a `EntradaDosSinais` de `criativosComSinal` (tela, motor, IA);
 *   • `entradaInicioDa` — a `EntradaInicio` da MESMA semana, para comparar a Mídia com o
 *     Início ("um número por métrica");
 *   • `semanaDoSeed` — o seed de uma marca na forma de `SemanaDaMidia`, SEM registro de
 *     sincronização (como no preview: o "no ar" ancora no último dia com linha).
 */
import { buildSeedData, buildSeedLeadEvents } from "@/lib/data/seed";
import type { Intervalo } from "@/lib/cobertura";
import { montarFilaDaLive } from "@/lib/fila-live";
import type { EntradaInicio } from "@/lib/inicio";
import { kpisDoPeriodo } from "@/lib/kpis";
import { LIVE_PADRAO } from "@/lib/live";
import { montarMidiaDaTela } from "@/lib/midia";
import type { EntradaDosSinais, EntradaMidia, MidiaDaTela } from "@/lib/midia-tela";
import { pageRange } from "@/lib/page-range";
import type { RoboAgora } from "@/lib/robo/situacao";
import { EXPEDIENTE_PADRAO } from "@/lib/turno";
import { brt, porMarca } from "./fixtures-robo";
import { HOJE, type SemanaDaMidia } from "./fixtures-midia";

/** O robô desligado, na forma de `estadoDoRoboAgora` (sem credencial, desativado ou outra marca). */
export const ROBO_DESLIGADO: RoboAgora = { ligado: false, lidoAte: null, confiavel: false, sync: { ultimoOk: null, falha: null } };

/** A marca de uma semana: a da campanha (`porMarca` a grava; as fixtures são "consorcio"). */
const marcaDa = (p: SemanaDaMidia) => p.data.campaign.brand || "consorcio";

/**
 * O seed de uma marca como `SemanaDaMidia`: sem `sync_runs` (o "no ar" ancora no
 * último dia com linha, 23/07) e com o robô desligado. `hoje` padrão = 12/11 (o seed
 * fica em julho: 7 dias é o vazio); passe `SEED_HOJE` para olhar julho "ao vivo".
 */
export function semanaDoSeed(marca = "consorcio", hoje = HOJE, cobertura: Intervalo[] = []): SemanaDaMidia {
  const data = porMarca(buildSeedData(), marca);
  return {
    data,
    cobertura,
    syncRuns: [],
    ultimoSyncAds: null,
    cfgLive: structuredClone(LIVE_PADRAO),
    eventos: buildSeedLeadEvents(data.leads),
    robo: ROBO_DESLIGADO,
    hoje,
    agora: brt(hoje, "15:00"),
  };
}

/** A `EntradaMidia` de uma semana numa chave de período (a conta de `carregarMidia`). */
export function entradaMidiaDa(p: SemanaDaMidia, chave = "7d", marca = marcaDa(p)): EntradaMidia {
  const { range, rangeKey, naoComecou } = pageRange(p.data, chave, p.hoje);
  const kpis = kpisDoPeriodo(p.data, range, { hoje: p.hoje, agora: p.agora, cobertura: p.cobertura, comparar: false });
  return {
    data: p.data,
    range,
    rangeKey,
    naoComecou,
    kpis,
    opcoesKpis: { cobertura: p.cobertura },
    eventos: p.eventos,
    robo: p.robo,
    cobertura: p.cobertura,
    ultimoSyncAds: p.ultimoSyncAds,
    cfgLive: p.cfgLive,
    marca,
    hoje: p.hoje,
    agora: p.agora,
  };
}

/** `montarMidiaDaTela` sobre uma semana. */
export const midiaDa = (p: SemanaDaMidia, chave = "7d", marca = marcaDa(p)): MidiaDaTela => montarMidiaDaTela(entradaMidiaDa(p, chave, marca));

/** A `EntradaDosSinais` da MESMA semana e chave (`criativosComSinal`). `semLive`: sem `cfgLive` (o motor antigo). */
export function entradaDosSinaisDa(p: SemanaDaMidia, chave = "7d", o: { semLive?: boolean } = {}): EntradaDosSinais {
  const e = entradaMidiaDa(p, chave);
  return {
    data: e.data,
    range: e.range,
    kpis: e.kpis,
    eventos: e.eventos,
    robo: e.robo,
    cobertura: e.cobertura,
    ultimoSyncAds: e.ultimoSyncAds,
    ...(o.semLive ? {} : { cfgLive: e.cfgLive }),
    hoje: e.hoje,
    agora: e.agora,
  };
}

/** A `EntradaInicio` da MESMA semana e chave — o Início que a Mídia tem de repetir. */
export function entradaInicioDa(p: SemanaDaMidia, chave = "7d"): EntradaInicio {
  const e = entradaMidiaDa(p, chave);
  return {
    data: e.data,
    range: e.range,
    rangeKey: e.rangeKey,
    kpis: e.kpis,
    eventos: p.eventos,
    robo: e.robo,
    cobertura: e.cobertura,
    expediente: EXPEDIENTE_PADRAO,
    filaLive: montarFilaDaLive(e.data.leads, p.eventos, e.agora, EXPEDIENTE_PADRAO),
    agora: e.agora,
    hoje: e.hoje,
  };
}
