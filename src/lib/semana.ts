/**
 * Semanas da Bússola — puro.
 *
 * A semana começa na SEGUNDA (Brasília): é quando a head lê o painel, quando o
 * resumo da IA sai (08:00) e quando o estado das ações é reavaliado do zero.
 * Toda conta de "esta semana" / "semana passada" / "últimas N semanas" sai daqui,
 * para o estado da ação, o resumo e a tendência concordarem sobre qual é a
 * segunda-feira de um dia.
 */

import type { DateRange } from "./metrics";

/** Soma `n` dias a um AAAA-MM-DD. */
export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A segunda-feira da semana de um dia (AAAA-MM-DD). */
export function segundaDaSemana(dia: string): string {
  const d = new Date(`${dia.slice(0, 10)}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // seg=0 … dom=6
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** A semana FECHADA mais recente antes de `hoje`: segunda a domingo anteriores. */
export function semanaAnteriorFechada(hoje: string): DateRange & { semana: string } {
  const segundaDestaSemana = segundaDaSemana(hoje);
  const semana = somarDias(segundaDestaSemana, -7);
  return { semana, from: semana, to: somarDias(semana, 6) };
}

/**
 * As últimas `n` semanas (segunda a domingo), da mais antiga à mais recente,
 * terminando na semana de `hoje` (que pode estar incompleta — a tendência mostra
 * a semana corrente como está, e a UI diz que ela ainda não fechou).
 */
export function ultimasSemanas(hoje: string, n: number): (DateRange & { semana: string })[] {
  const ultima = segundaDaSemana(hoje);
  const out: (DateRange & { semana: string })[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const semana = somarDias(ultima, -7 * i);
    out.push({ semana, from: semana, to: somarDias(semana, 6) });
  }
  return out;
}

/** Dias de um período (inclusivo). */
export function diasDoPeriodo(range: DateRange): number {
  const a = new Date(`${range.from}T00:00:00Z`).getTime();
  const b = new Date(`${range.to}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

/** As `n` semanas (ou `dias`) imediatamente ANTES de um período — a base de comparação. */
export function janelaAnterior(range: DateRange, dias: number): DateRange {
  return { from: somarDias(range.from, -dias), to: somarDias(range.from, -1) };
}
