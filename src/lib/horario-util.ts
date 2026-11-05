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

/**
 * O instante cai dentro do expediente (seg–sex, 9h–18h em Brasília)? O fim é
 * aberto: 18:00 já está fora. Feriados não entram (v1). É a régua do aviso de
 * resgate ao n8n: fora do horário ele acumula e sai na 1ª rodada do expediente.
 */
export function noHorarioComercial(iso: string, cfg: HorarioComercial = HORARIO_COMERCIAL): boolean {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return false;
  const t = paraBrt(ms);
  const dia = Math.floor(t / DIA_MS) * DIA_MS;
  if (!cfg.dias.includes(new Date(dia).getUTCDay())) return false;
  return t >= dia + cfg.inicio * 3_600_000 && t < dia + cfg.fim * 3_600_000;
}

/**
 * Dia (AAAA-MM-DD) de um instante no calendário de Brasília. LANÇA com entrada
 * vazia ou inválida — para dia de lead, evento ou post use `diaDoLead`.
 */
export function diaBrt(iso: string): string {
  return new Date(paraBrt(Date.parse(iso))).toISOString().slice(0, 10);
}

/** "AAAA-MM-DD" sozinho: já é um dia. */
const DIA_PURO = /^\d{4}-\d{2}-\d{2}$/;
/** Data e hora SEM fuso (seed, datetime-local, CSV antigo): é o relógio de Brasília. */
const SEM_FUSO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
/** Data e hora com fuso só em horas (`+00`, `-03`). */
const FUSO_CURTO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?[+-]\d{2}$/;
const cacheDoDia = new Map<string, string>();
const CACHE_DO_DIA_MAX = 50_000;

/**
 * O DIA (AAAA-MM-DD) de um lead, evento ou post no calendário de Brasília — a
 * régua do período (`range.ts` conta os presets a partir de hoje em Brasília).
 * Antes o dia era o prefixo UTC (`dayOf`): o lead das 22h de quinta caía na
 * sexta e ficava fora de um período que terminava na quinta (2.8).
 *
 * - `""`/`undefined` → `""`;
 * - dia puro (`2026-10-08`) → ele mesmo;
 * - data e hora sem fuso (`2026-10-08T23:30[:00[.000]]`, também com espaço) →
 *   `slice(0, 10)`: é relógio de Brasília, e assim o resultado não depende do
 *   fuso do processo (o `Date.parse` leria no fuso da máquina);
 * - com fuso (`Z`, `±hh:mm`, `±hhmm`, `±hh`) → o dia em Brasília (UTC−3 fixo, como
 *   `diaBrt`), SEM exceção de meia-noite: `T00:00:00.000Z` é 21:00 em Brasília,
 *   hora real de reunião, e cai no dia anterior;
 * - inválido → `slice(0, 10)` (nunca lança; `diaBrt` lança).
 *
 * Risco conhecido: lead antigo importado por CSV só com a data virou meia-noite
 * UTC no banco e recua um dia; o importador agora grava `T12:00:00-03:00`.
 * UTC−3 fixo e `hojeEmBrasilia` (Intl) só concordam enquanto o Brasil não tiver
 * horário de verão. Puro; o cache por string é só desempenho (`filterLeads`
 * roda dezenas de vezes por render).
 */
export function diaDoLead(iso?: string | null): string {
  if (!iso) return "";
  const guardado = cacheDoDia.get(iso);
  if (guardado !== undefined) return guardado;
  let dia: string;
  if (DIA_PURO.test(iso) || SEM_FUSO.test(iso)) dia = iso.slice(0, 10);
  else {
    // Fuso curto (`+00`, `-03`, como o Postgres imprime `timestamptz`): o V8 não lê
    // "T…+00" (NaN) mas lê " …+00" — completa os minutos para o separador não
    // mudar o dia do mesmo instante.
    const ms = Date.parse(FUSO_CURTO.test(iso) ? `${iso}:00` : iso);
    dia = Number.isFinite(ms) ? new Date(paraBrt(ms)).toISOString().slice(0, 10) : iso.slice(0, 10);
  }
  if (cacheDoDia.size >= CACHE_DO_DIA_MAX) cacheDoDia.clear();
  cacheDoDia.set(iso, dia);
  return dia;
}
