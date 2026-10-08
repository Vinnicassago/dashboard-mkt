import "server-only";
import { getState, listSyncRuns } from "./data/store";
import { STATE_KEYS } from "./data/backend";
import { janelasCobertas, type Intervalo } from "./cobertura";
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

const CHAVE_LEGADA: Record<SyncFonte, string> = {
  ads: STATE_KEYS.lastSyncAds,
  instagram: STATE_KEYS.lastSyncInstagram,
};

export async function estadoDaFonte(source: SyncFonte, brand: string): Promise<EstadoFonte> {
  const runs = await listSyncRuns({ source, brand, limit: 60 });
  const iOk = runs.findIndex((r) => r.ok);
  // Sem nenhuma execução registrada (produção antes da 0016): o último sucesso
  // global continua valendo — melhor que dizer "nunca".
  const ultimoOk =
    iOk >= 0 ? runs[iOk].finishedAt : runs.length === 0 ? await getState<string>(CHAVE_LEGADA[source]) : null;
  const falhas = iOk >= 0 ? runs.slice(0, iOk) : runs;
  const falha =
    falhas.length > 0
      ? { desde: falhas.at(-1)!.finishedAt, erro: falhas[0].error ?? "erro sem detalhe" }
      : null;
  return { ultimoOk, falha };
}

/** Dias que syncs de anúncio bem-sucedidos cobriram para a marca (ADR-06). */
export async function coberturaDeAnuncios(brand: string): Promise<Intervalo[]> {
  return janelasCobertas(await listSyncRuns({ source: "ads", brand, limit: 0 }));
}
