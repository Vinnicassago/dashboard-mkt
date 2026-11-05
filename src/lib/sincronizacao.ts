import "server-only";
import { getState, listSyncRuns } from "./data/store";
import { STATE_KEYS } from "./data/backend";
import { janelasCobertas, type Intervalo } from "./cobertura";
import type { ResumoLeituraRobo } from "./robo/casar";
import type { SyncFonte } from "./types";

/**
 * Estado de cada fonte sincronizada, por marca (ADR-04), lido do registro de
 * execuções (`sync_runs`). Antes o painel só guardava o último SUCESSO, global:
 * uma marca podia falhar todo dia enquanto a outra mantinha o cabeçalho verde.
 */
export interface EstadoFonte {
  /** Fim do último sync que deu certo (ISO), ou `null` se nunca deu. */
  ultimoOk: string | null;
  /** O sync está falhando: desde quando (a 1ª falha depois do último sucesso) e por quê. */
  falha: { desde: string; erro: string } | null;
}

/** O último sucesso global de antes da 0016. O robô não tem: nasceu com `sync_runs`. */
const CHAVE_LEGADA: Partial<Record<SyncFonte, string>> = {
  ads: STATE_KEYS.lastSyncAds,
  instagram: STATE_KEYS.lastSyncInstagram,
};

/** Execuções lidas: com o cron diário são 60 dias; com o robô (15 min), 15 h. */
const JANELA_DE_EXECUCOES = 60;

export async function estadoDaFonte(source: SyncFonte, brand: string): Promise<EstadoFonte> {
  const runs = await listSyncRuns({ source, brand, limit: JANELA_DE_EXECUCOES });
  const iOk = runs.findIndex((r) => r.ok);
  // Sem nenhuma execução registrada (produção antes da 0016): o último sucesso
  // global continua valendo — melhor que dizer "nunca".
  const legada = CHAVE_LEGADA[source];
  let ultimoOk =
    iOk >= 0 ? runs[iOk].finishedAt : runs.length === 0 && legada ? await getState<string>(legada) : null;
  const falhas = iOk >= 0 ? runs.slice(0, iOk) : runs;
  let falha =
    falhas.length > 0
      ? { desde: falhas.at(-1)!.finishedAt, erro: falhas[0].error ?? "erro sem detalhe" }
      : null;

  if (source === "robo") {
    // A cada 15 min, 60 execuções são só 15 h: se todas falharam, o último ok
    // saiu da janela — a última leitura gravada no sucesso faz o papel da chave
    // legada (senão o cabeçalho diria "nunca"). E o "desde" é o gravado na 1ª
    // falha depois do último ok: o da janela andaria a cada execução. Só vale o
    // gravado DEPOIS do último ok — um que sobrou de um episódio antigo (a limpeza
    // falhou) diria "falhando desde" antes do último ok, e o id da B1 repetiria.
    if (ultimoOk == null) {
      ultimoOk = (await getState<ResumoLeituraRobo>(STATE_KEYS.roboUltimaLeitura))?.em ?? null;
    }
    if (falha) {
      const desde = await getState<string>(STATE_KEYS.roboFalhaDesde);
      const t = typeof desde === "string" && desde ? Date.parse(desde) : NaN;
      if (Number.isFinite(t) && (ultimoOk == null || t > Date.parse(ultimoOk))) falha = { ...falha, desde: desde! };
    }
  }
  return { ultimoOk, falha };
}

/** Dias que syncs de anúncio bem-sucedidos cobriram para a marca (ADR-06). */
export async function coberturaDeAnuncios(brand: string): Promise<Intervalo[]> {
  return janelasCobertas(await listSyncRuns({ source: "ads", brand, limit: 0 }));
}
