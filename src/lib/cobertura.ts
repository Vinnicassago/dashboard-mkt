/**
 * Cobertura de sincronização (ADR-06) — pura.
 *
 * Um dia sem linha de anúncio é ambíguo: a campanha parou (não houve gasto) ou o
 * sync falhou (houve gasto que o painel não viu). A diferença está no registro
 * de sincronizações: se um sync que DEU CERTO pediu esse dia à Meta e não veio
 * linha, o dia foi SEM VEICULAÇÃO. Se nenhum sync bem-sucedido o cobriu, é SEM
 * DADOS — e todo custo do período vira piso ("≥").
 *
 * Os insights da Meta atrasam até 48 h: um sync de hoje que não trouxe ontem não
 * prova que ontem ficou parado. Por isso um sync só cobre os dias até dois dias
 * antes de terminar.
 */

import type { SyncRun } from "./types";

export interface Intervalo {
  /** AAAA-MM-DD, inclusivo. */
  from: string;
  to: string;
}

/** Quantos dias a Meta pode demorar para fechar os números de um dia. */
export const DIAS_DE_ATRASO_DA_META = 2;

function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Janelas que syncs BEM-SUCEDIDOS cobriram de fato, fundidas e em ordem. */
export function janelasCobertas(runs: SyncRun[]): Intervalo[] {
  const brutas: Intervalo[] = [];
  for (const r of runs) {
    if (!r.ok || !r.dateFrom || !r.dateTo) continue;
    const limite = somarDias(r.finishedAt.slice(0, 10), -DIAS_DE_ATRASO_DA_META);
    const to = r.dateTo < limite ? r.dateTo : limite;
    if (to >= r.dateFrom) brutas.push({ from: r.dateFrom, to });
  }
  brutas.sort((a, b) => a.from.localeCompare(b.from));
  const out: Intervalo[] = [];
  for (const j of brutas) {
    const ultimo = out.at(-1);
    if (ultimo && j.from <= somarDias(ultimo.to, 1)) {
      if (j.to > ultimo.to) ultimo.to = j.to;
    } else {
      out.push({ ...j });
    }
  }
  return out;
}

export function diaCoberto(janelas: Intervalo[], dia: string): boolean {
  return janelas.some((j) => dia >= j.from && dia <= j.to);
}
