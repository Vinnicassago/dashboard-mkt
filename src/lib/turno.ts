/**
 * O relógio do atendimento da live: o turno de quem liga (por dia da semana),
 * os feriados e as faixas de horário que o inscrito escolhe. Puro — o prazo da
 * tentativa, a Fila, a API do n8n e a aba Live calculam com ele.
 *
 * Vale para os leads da ficha da live (com classe). Os prazos antigos da Fila
 * (`lib/horario-util.ts`, seg–sex 9h–18h) continuam para quem entrou sem as
 * respostas — os números de antes não mudam de régua.
 *
 * Brasília é UTC−3 fixo (sem horário de verão desde 2019), como em horario-util.
 */
import type { Classe, HorarioPreferido } from "./qualificacao";

/** "HH:MM" no relógio de Brasília. */
export type Hora = string;

export interface Janela {
  inicio: Hora;
  fim: Hora;
}

export type DiaDaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const DIA_LABEL: Record<DiaDaSemana, string> = {
  0: "Domingo",
  1: "Segunda",
  2: "Terça",
  3: "Quarta",
  4: "Quinta",
  5: "Sexta",
  6: "Sábado",
};
export const DIAS_DA_SEMANA: DiaDaSemana[] = [1, 2, 3, 4, 5, 6, 0];

export interface Expediente {
  /** O turno de cada dia da semana; ausente = sem expediente nesse dia. */
  dias: Partial<Record<DiaDaSemana, Janela>>;
  /** Dias sem expediente (AAAA-MM-DD). */
  feriados: string[];
  /** As faixas que o inscrito escolhe no formulário. */
  faixas: Record<HorarioPreferido, Janela>;
  /** Classe A sem horário escolhido: horas DO TURNO até a 1ª tentativa ("até 1 hora útil"). */
  prazoAHoras: number;
  /** Classe A com horário escolhido: o prazo é o início da faixa mais esta folga (horas corridas). */
  folgaDoHorarioHoras: number;
  /** A cadência depois de uma tentativa sem conversa. */
  cadencia: {
    /** Da 1ª para a 2ª (o áudio): horas do turno. */
    segundaHorasDoTurno: number;
    /** Da 2ª para a 3ª (a ligação): horas corridas — cai no turno seguinte se estiver fora. */
    terceiraHoras: number;
    /** Sem contato válido depois disto desde a inscrição: "Sem resposta". */
    semRespostaHoras: number;
  };
  atualizadoEm?: string;
  atualizadoPor?: string;
}

const TURNO_PADRAO: Janela = { inicio: "16:00", fim: "22:00" };

/** O padrão do briefing: turno ainda indefinido (16h–22h), sem expediente sáb, dom e 20/11. */
export const EXPEDIENTE_PADRAO: Expediente = {
  dias: { 1: TURNO_PADRAO, 2: TURNO_PADRAO, 3: TURNO_PADRAO, 4: TURNO_PADRAO, 5: TURNO_PADRAO },
  feriados: ["2026-11-20"],
  faixas: {
    manha: { inicio: "09:00", fim: "12:00" },
    tarde: { inicio: "12:00", fim: "18:00" },
    noite: { inicio: "18:00", fim: "22:00" },
  },
  prazoAHoras: 1,
  folgaDoHorarioHoras: 1,
  cadencia: { segundaHorasDoTurno: 4, terceiraHoras: 24, semRespostaHoras: 48 },
};

// ---------------------------------------------------------------- relógio

const OFFSET_BRT_MS = -3 * 3_600_000;
const DIA_MS = 86_400_000;
const MIN_MS = 60_000;

/** "16:30" → 990 minutos. Inválido → null. */
export function minutosDe(h: Hora): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(h.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 24 || mm > 59 || (hh === 24 && mm > 0)) return null;
  return hh * 60 + mm;
}

/** Instante → "relógio de parede" de Brasília em ms (UTC fingido). */
const paraBrt = (ms: number) => ms + OFFSET_BRT_MS;
const deBrt = (ms: number) => ms - OFFSET_BRT_MS;
const diaIso = (brtMs: number) => new Date(brtMs).toISOString().slice(0, 10);

/** O turno de um dia (meia-noite de Brasília em ms fingido); null = sem expediente. */
function turnoDoDia(diaBrtMs: number, cfg: Expediente): { abre: number; fecha: number } | null {
  if (cfg.feriados.includes(diaIso(diaBrtMs))) return null;
  const j = cfg.dias[new Date(diaBrtMs).getUTCDay() as DiaDaSemana];
  if (!j) return null;
  const a = minutosDe(j.inicio);
  const f = minutosDe(j.fim);
  if (a == null || f == null || f <= a) return null;
  return { abre: diaBrtMs + a * MIN_MS, fecha: diaBrtMs + f * MIN_MS };
}

const inicioDoDia = (brtMs: number) => Math.floor(brtMs / DIA_MS) * DIA_MS;
/** Quantos dias procurar adiante antes de desistir (expediente vazio = sem prazo). */
const HORIZONTE_DIAS = 60;

/** O dia (AAAA-MM-DD) tem expediente? */
export function diaUtil(dia: string, cfg: Expediente): boolean {
  return turnoDoDia(Date.parse(`${dia}T00:00:00Z`), cfg) !== null;
}

/** O instante está dentro do turno? */
export function dentroDoTurno(iso: string, cfg: Expediente): boolean {
  const t = paraBrt(Date.parse(iso));
  const j = turnoDoDia(inicioDoDia(t), cfg);
  return Boolean(j && t >= j.abre && t < j.fecha);
}

/** Horas do turno entre dois instantes (0 se o fim vier antes). */
export function horasDoTurnoEntre(inicioIso: string, fimIso: string, cfg: Expediente): number {
  const a = paraBrt(Date.parse(inicioIso));
  const b = paraBrt(Date.parse(fimIso));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  let total = 0;
  for (let dia = inicioDoDia(a); dia < b; dia += DIA_MS) {
    const j = turnoDoDia(dia, cfg);
    if (!j) continue;
    const de = Math.max(j.abre, a);
    const ate = Math.min(j.fecha, b);
    if (ate > de) total += ate - de;
  }
  return total / 3_600_000;
}

/** O instante `horas` do turno depois de `inicioIso`. Sem expediente no horizonte, undefined. */
export function somarHorasDoTurno(inicioIso: string, horas: number, cfg: Expediente): string | undefined {
  let resta = horas * 3_600_000;
  let t = paraBrt(Date.parse(inicioIso));
  const limite = t + HORIZONTE_DIAS * DIA_MS;
  while (t < limite) {
    const dia = inicioDoDia(t);
    const j = turnoDoDia(dia, cfg);
    if (!j || t >= j.fecha) {
      t = dia + DIA_MS;
      continue;
    }
    if (t < j.abre) t = j.abre;
    const cabe = j.fecha - t;
    if (resta <= cabe) return new Date(deBrt(t + resta)).toISOString();
    resta -= cabe;
    t = dia + DIA_MS;
  }
  return undefined;
}

/** O instante, ou a próxima abertura do turno se ele estiver fora. */
export function noTurno(iso: string, cfg: Expediente): string | undefined {
  return dentroDoTurno(iso, cfg) ? iso : somarHorasDoTurno(iso, 0, cfg);
}

/**
 * O fim do turno do mesmo dia — se o instante é num dia de expediente e antes do
 * fim do turno —, senão o fim do turno do próximo dia útil.
 */
export function fimDoTurno(iso: string, cfg: Expediente): string | undefined {
  const t = paraBrt(Date.parse(iso));
  for (let dia = inicioDoDia(t), n = 0; n < HORIZONTE_DIAS; dia += DIA_MS, n++) {
    const j = turnoDoDia(dia, cfg);
    if (j && t < j.fecha) return new Date(deBrt(j.fecha)).toISOString();
  }
  return undefined;
}

/**
 * O próximo início da faixa escolhida num dia útil, a partir do instante (o de
 * hoje, se ainda não começou).
 */
export function inicioDaFaixa(iso: string, faixa: HorarioPreferido, cfg: Expediente): string | undefined {
  const t = paraBrt(Date.parse(iso));
  const a = minutosDe(cfg.faixas[faixa]?.inicio ?? "");
  if (a == null) return undefined;
  for (let dia = inicioDoDia(t), n = 0; n < HORIZONTE_DIAS; dia += DIA_MS, n++) {
    if (!turnoDoDia(dia, cfg)) continue;
    const comeca = dia + a * MIN_MS;
    if (comeca >= t) return new Date(deBrt(comeca)).toISOString();
  }
  return undefined;
}

// ---------------------------------------------------------------- prazos

export interface ParaPrazo {
  createdAt: string;
  classe?: Classe;
  horarioPreferido?: HorarioPreferido;
}

/**
 * O prazo da 1ª tentativa (prazo_tentativa):
 *   • A — 1 hora do turno depois da inscrição (fora do turno, conta da abertura
 *     seguinte); com horário escolhido, o início dessa faixa no próximo dia útil
 *     (o de hoje, se ainda não começou) mais a folga;
 *   • B — o fim do turno do dia (ou do próximo dia útil);
 *   • C, X e sem classe — sem prazo (fora da Fila da live).
 */
export function prazoDaPrimeiraTentativa(l: ParaPrazo, cfg: Expediente): string | undefined {
  if (l.classe === "A") {
    if (l.horarioPreferido) {
      const inicio = inicioDaFaixa(l.createdAt, l.horarioPreferido, cfg);
      return inicio ? new Date(Date.parse(inicio) + cfg.folgaDoHorarioHoras * 3_600_000).toISOString() : undefined;
    }
    return somarHorasDoTurno(l.createdAt, cfg.prazoAHoras, cfg);
  }
  if (l.classe === "B") return fimDoTurno(l.createdAt, cfg);
  return undefined;
}

/**
 * Quando tentar de novo depois de uma tentativa sem conversa: a 2ª (o áudio)
 * algumas horas do turno depois; a 3ª (a ligação) horas corridas depois da 2ª,
 * empurrada para o turno seguinte se cair fora. Depois da 3ª, undefined — a
 * régua já permite "Sem resposta".
 */
export function proximaTentativaDoTurno(ocorreuEm: string, n: number, cfg: Expediente): string | undefined {
  if (n === 1) return somarHorasDoTurno(ocorreuEm, cfg.cadencia.segundaHorasDoTurno, cfg);
  if (n === 2) return noTurno(new Date(Date.parse(ocorreuEm) + cfg.cadencia.terceiraHoras * 3_600_000).toISOString(), cfg);
  return undefined;
}

/** O fim da janela de contato válido (inscrição + 48 h): depois, "Sem resposta". */
export function fimDaJanelaDeContato(createdAt: string, cfg: Expediente): string {
  return new Date(Date.parse(createdAt) + cfg.cadencia.semRespostaHoras * 3_600_000).toISOString();
}

// ---------------------------------------------------------------- leitura do banco

const janelaValida = (j: unknown): j is Janela => {
  if (!j || typeof j !== "object") return false;
  const { inicio, fim } = j as Janela;
  const a = typeof inicio === "string" ? minutosDe(inicio) : null;
  const f = typeof fim === "string" ? minutosDe(fim) : null;
  return a != null && f != null && f > a;
};
const numeroValido = (n: unknown, min: number, max: number): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;

/** Lê o expediente gravado: o que vier torto cai no padrão, campo a campo. */
export function lerExpediente(v: unknown): Expediente {
  const e = (v && typeof v === "object" ? v : {}) as Partial<Expediente>;
  const dias: Expediente["dias"] = {};
  if (e.dias && typeof e.dias === "object") {
    for (const d of DIAS_DA_SEMANA) {
      const j = (e.dias as Record<string, unknown>)[d];
      if (janelaValida(j)) dias[d] = { inicio: j.inicio, fim: j.fim };
    }
  }
  const faixas = { ...EXPEDIENTE_PADRAO.faixas };
  for (const f of Object.keys(faixas) as HorarioPreferido[]) {
    const j = (e.faixas as Record<string, unknown> | undefined)?.[f];
    if (janelaValida(j)) faixas[f] = { inicio: j.inicio, fim: j.fim };
  }
  const c = (e.cadencia ?? {}) as Partial<Expediente["cadencia"]>;
  return {
    dias: e.dias && typeof e.dias === "object" ? dias : EXPEDIENTE_PADRAO.dias,
    feriados: Array.isArray(e.feriados)
      ? [...new Set(e.feriados.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort()
      : EXPEDIENTE_PADRAO.feriados,
    faixas,
    prazoAHoras: numeroValido(e.prazoAHoras, 0.25, 24) ? e.prazoAHoras : EXPEDIENTE_PADRAO.prazoAHoras,
    folgaDoHorarioHoras: numeroValido(e.folgaDoHorarioHoras, 0, 12) ? e.folgaDoHorarioHoras : EXPEDIENTE_PADRAO.folgaDoHorarioHoras,
    cadencia: {
      segundaHorasDoTurno: numeroValido(c.segundaHorasDoTurno, 0.25, 72) ? c.segundaHorasDoTurno : EXPEDIENTE_PADRAO.cadencia.segundaHorasDoTurno,
      terceiraHoras: numeroValido(c.terceiraHoras, 1, 168) ? c.terceiraHoras : EXPEDIENTE_PADRAO.cadencia.terceiraHoras,
      semRespostaHoras: numeroValido(c.semRespostaHoras, 1, 336) ? c.semRespostaHoras : EXPEDIENTE_PADRAO.cadencia.semRespostaHoras,
    },
    atualizadoEm: typeof e.atualizadoEm === "string" ? e.atualizadoEm : undefined,
    atualizadoPor: typeof e.atualizadoPor === "string" ? e.atualizadoPor : undefined,
  };
}

/** Faixas de horário que não cruzam turno nenhum — a tela avisa (o prazo cai fora do turno). */
export function faixasForaDoTurno(cfg: Expediente): HorarioPreferido[] {
  const turnos = Object.values(cfg.dias).filter(Boolean) as Janela[];
  return (Object.keys(cfg.faixas) as HorarioPreferido[]).filter((f) => {
    const a = minutosDe(cfg.faixas[f].inicio)!;
    const b = minutosDe(cfg.faixas[f].fim)!;
    return !turnos.some((t) => a < minutosDe(t.fim)! && b > minutosDe(t.inicio)!);
  });
}
