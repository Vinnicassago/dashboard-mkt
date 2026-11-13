/**
 * O "NO AR" da Mídia (Fase 4, nov/26) — puro, sem o status do Meta (o painel não o
 * lê: F4-D2, "Depois (G)").
 *
 * No ar = impressão OU gasto > 0 nos `JANELA_NO_AR_DIAS` dias (os 2 que a Meta ainda
 * pode revisar + o último coberto) até o dia de referência `ref` = min(fim do período,
 * dia em Brasília do último sync de anúncios que DEU CERTO); sem sync registrado (seed,
 * CSV), o último dia com linha. Fora da janela:
 *   • "parou" — algum dia depois do último gasto foi coberto por sync bem-sucedido
 *     (ADR-06: a falta de linha só prova "sem veiculação" em dia coberto);
 *   • "sem leitura" — senão.
 *
 * Por que "parou" segue a ADR-06 por construção (K17): `janelasCobertas` corta a
 * cobertura no dia UTC de `finishedAt` − 2, e o dia UTC nunca é anterior ao de
 * Brasília; logo a cobertura vai pelo menos até `ref − 2`. Quem não teve impressão nem
 * gasto em [ref − 2, ref] tem o dia `ref − 2` coberto depois do último gasto.
 *
 * O custo: um anúncio pausado ontem aparece no ar por até 2 dias (dito no ⓘ e no
 * dicionário, `no_ar`). Quando `ref` é anterior a hoje (período no passado, sync
 * atrasado, dado sem sync), a tela diz "no ar em dd/mm" (`noArTexto`, K7).
 *
 * A saúde (`computeFatigue`) NÃO lê daqui: a fadiga tem a janela de 7 dias dela.
 */

import { DIAS_DE_ATRASO_DA_META, type Intervalo } from "./cobertura";
import { diaDoLead } from "./horario-util";
import type { AdDaily } from "./types";

/** Os dias que a cobertura ainda não fecha + o último coberto: 3. */
export const JANELA_NO_AR_DIAS = DIAS_DE_ATRASO_DA_META + 1;

export type EstadoDaVeiculacao = "no-ar" | "parou" | "sem-leitura";

export interface Veiculacao {
  estado: EstadoDaVeiculacao;
  /** Último dia (AAAA-MM-DD) ≤ ref com impressão OU gasto > 0 nas linhas dadas; null = nenhum. */
  ultimoDia: string | null;
  /** Pronto para a tela: "No ar" · "Último gasto em 08/11" · "Sem leitura depois de 20/07" ("Sem leitura" sem ultimoDia). */
  rotulo: string;
}

const dm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * O dia de referência do "no ar": min(fim, dia em Brasília de `ultimoSyncAds`). Sem sync
 * registrado: min(fim, último dia com linha em `rows`). Sem linha nenhuma: fim.
 */
export function refDaVeiculacao(o: {
  fim: string;
  ultimoSyncAds: string | null;
  rows: readonly Pick<AdDaily, "date">[];
}): string {
  const doSync = o.ultimoSyncAds ? diaDoLead(o.ultimoSyncAds) : "";
  if (doSync) return doSync < o.fim ? doSync : o.fim;
  let ultimo: string | null = null;
  for (const r of o.rows) if (!ultimo || r.date > ultimo) ultimo = r.date;
  if (!ultimo) return o.fim;
  return ultimo < o.fim ? ultimo : o.fim;
}

/** A janela do "no ar": [ref − (JANELA_NO_AR_DIAS − 1), ref]. */
export function janelaNoAr(ref: string): { from: string; to: string } {
  return { from: somarDias(ref, -(JANELA_NO_AR_DIAS - 1)), to: ref };
}

/** "no ar" quando ref = hoje; "no ar em dd/mm" quando ref < hoje (período no passado, sync atrasado, dado sem sync). */
export function noArTexto(ref: string, hoje: string): string {
  return ref < hoje ? `no ar em ${dm(ref)}` : "no ar";
}

/**
 * A veiculação de UM anúncio ou de um GRUPO (passe as linhas do histórico inteiro de
 * todos os anúncios do grupo: o conjunto ou o criativo).
 *  - no-ar: alguma linha em janelaNoAr(ref) com impressões > 0 ou gasto > 0;
 *  - parou: senão, e algum dia em (ultimoDia, ref] está coberto por sync bem-sucedido
 *    (`diaCoberto`) — ADR-06: a falta de linha só prova "sem veiculação" em dia coberto;
 *  - sem-leitura: senão.
 */
export function veiculacaoNoFim(rows: readonly AdDaily[], o: { ref: string; cobertura: readonly Intervalo[] }): Veiculacao {
  const { from } = janelaNoAr(o.ref);
  let ultimoDia: string | null = null;
  let noAr = false;
  for (const r of rows) {
    if (r.date > o.ref) continue;
    if (!(r.impressions > 0 || r.spend > 0)) continue;
    if (!ultimoDia || r.date > ultimoDia) ultimoDia = r.date;
    if (r.date >= from) noAr = true;
  }
  if (noAr) return { estado: "no-ar", ultimoDia, rotulo: "No ar" };
  if (!ultimoDia) return { estado: "sem-leitura", ultimoDia: null, rotulo: "Sem leitura" };
  // Algum dia em (ultimoDia, ref] coberto por sync bem-sucedido (`diaCoberto` dia a dia
  // = um intervalo que começa até `ref` e termina depois do último gasto).
  const depois = somarDias(ultimoDia, 1);
  const coberto = depois <= o.ref && o.cobertura.some((j) => j.to >= depois && j.from <= o.ref);
  if (coberto) return { estado: "parou", ultimoDia, rotulo: `Último gasto em ${dm(ultimoDia)}` };
  return { estado: "sem-leitura", ultimoDia, rotulo: `Sem leitura depois de ${dm(ultimoDia)}` };
}
