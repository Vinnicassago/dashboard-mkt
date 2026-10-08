/**
 * Horas ÚTEIS entre dois instantes — o relógio do SLA do comercial. Puro.
 *
 * Um lead que entra sexta às 20h e é contatado segunda às 9h10 esperou 10
 * minutos úteis, não 61 horas. Sem isso, todo fim de semana vira "fora do prazo"
 * e o prazo de 1 hora perde o sentido.
 *
 * Brasília não tem horário de verão desde 2019: UTC−3 fixo. Feriados ainda não
 * entram (v1).
 */

export interface HorarioComercial {
  /** Hora de início e de fim do expediente (0–24), horário de Brasília. */
  inicio: number;
  fim: number;
  /** Dias úteis: 0 = domingo … 6 = sábado. */
  dias: number[];
}

/** Padrão: segunda a sexta, 9h às 18h. */
export const HORARIO_COMERCIAL: HorarioComercial = { inicio: 9, fim: 18, dias: [1, 2, 3, 4, 5] };

const OFFSET_BRT_MS = -3 * 3_600_000;
const DIA_MS = 86_400_000;

/** Instante → "relógio de parede" de Brasília, expresso como ms UTC. */
const paraBrt = (ms: number) => ms + OFFSET_BRT_MS;

/** Horas úteis entre `inicioIso` e `fimIso` (0 se o fim vier antes). */
export function horasUteisEntre(
  inicioIso: string,
  fimIso: string,
  cfg: HorarioComercial = HORARIO_COMERCIAL,
): number {
  const a = Date.parse(inicioIso);
  const b = Date.parse(fimIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  const ini = paraBrt(a);
  const fim = paraBrt(b);
  let total = 0;
  // Dia a dia (no relógio de Brasília): soma a interseção com o expediente.
  for (let dia = Math.floor(ini / DIA_MS) * DIA_MS; dia < fim; dia += DIA_MS) {
    const semana = new Date(dia).getUTCDay();
    if (!cfg.dias.includes(semana)) continue;
    const abre = dia + cfg.inicio * 3_600_000;
    const fecha = dia + cfg.fim * 3_600_000;
    const de = Math.max(abre, ini);
    const ate = Math.min(fecha, fim);
    if (ate > de) total += ate - de;
  }
  return total / 3_600_000;
}

/** O instante que fica `horas` úteis depois de `inicioIso` (para "vence às…"). */
export function somarHorasUteis(
  inicioIso: string,
  horas: number,
  cfg: HorarioComercial = HORARIO_COMERCIAL,
): string {
  let resta = horas * 3_600_000;
  let t = paraBrt(Date.parse(inicioIso));
  for (let guarda = 0; guarda < 3700 && resta > 0; guarda++) {
    const dia = Math.floor(t / DIA_MS) * DIA_MS;
    const semana = new Date(dia).getUTCDay();
    const abre = dia + cfg.inicio * 3_600_000;
    const fecha = dia + cfg.fim * 3_600_000;
    if (!cfg.dias.includes(semana) || t >= fecha) {
      t = dia + DIA_MS + cfg.inicio * 3_600_000;
      continue;
    }
    if (t < abre) t = abre;
    const cabe = fecha - t;
    if (resta <= cabe) {
      t += resta;
      resta = 0;
    } else {
      resta -= cabe;
      t = dia + DIA_MS + cfg.inicio * 3_600_000;
    }
  }
  return new Date(t - OFFSET_BRT_MS).toISOString();
}

/** Dia (AAAA-MM-DD) de um instante no calendário de Brasília. */
export function diaBrt(iso: string): string {
  return new Date(paraBrt(Date.parse(iso))).toISOString().slice(0, 10);
}
