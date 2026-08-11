/** pt-BR formatters used across the dashboard. */

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const brl0 = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

const compact = new Intl.NumberFormat("pt-BR", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** R$ 1.234,56 */
export function formatCurrency(n: number | null | undefined): string {
  return brl.format(n ?? 0);
}

/** R$ 1.235 (no cents) */
export function formatCurrency0(n: number | null | undefined): string {
  return brl0.format(n ?? 0);
}

/**
 * Custo que pode ser indefinido (ex.: custo por seguidor com 0 seguidores
 * ganhos): mostra "—" em vez de "R$ 0,00", que se leria como "de graça".
 */
export function formatCurrencyOrDash(n: number | null | undefined): string {
  return n == null ? "—" : formatCurrency(n);
}

/** 1.234 */
export function formatInt(n: number | null | undefined): string {
  return int.format(Math.round(n ?? 0));
}

/** 12,3 mil */
export function formatCompact(n: number | null | undefined): string {
  return compact.format(n ?? 0);
}

/**
 * Percentage from a 0–1 ratio: 0.1234 -> "12,3%".
 * Pass `digits` to control decimals (default 1).
 */
export function formatPercent(
  ratio: number | null | undefined,
  digits = 1,
): string {
  const v = (ratio ?? 0) * 100;
  return `${v.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

/** A number that is already a percentage value: 12.3 -> "12,3%". */
export function formatPercentValue(
  value: number | null | undefined,
  digits = 1,
): string {
  return `${(value ?? 0).toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

/**
 * Data-pura ("yyyy-mm-dd") parseia como meia-noite LOCAL — `new Date("2026-07-22")`
 * seria UTC e, em UTC-3, renderizaria 21/07 (um dia a menos).
 */
const toLocalDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00` : iso);

/** 23/07 */
export function formatDateShort(iso: string): string {
  return toLocalDate(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** 23 jul */
export function formatDateMonth(iso: string): string {
  return toLocalDate(iso)
    .toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
    .replace(".", "");
}

/** 23 jul 2026, 14:30 */
export function formatDateTime(iso: string): string {
  return new Date(iso)
    .toLocaleString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(".", "");
}

/** Decimal with fixed digits, pt-BR: 1,23 */
export function formatDecimal(
  n: number | null | undefined,
  digits = 2,
): string {
  return (n ?? 0).toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * Duração em segundos legível: 3.4 -> "3,4s" · 45 -> "45s" · 92 -> "1m 32s".
 * Abaixo de 10s mantém uma casa decimal (retenção de reel vive nessa faixa).
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const s = Math.max(0, seconds);
  // 9.95+ arredondaria para "10,0s" — muda de faixa antes.
  if (s < 9.95) return `${formatDecimal(s, 1)}s`;
  // Arredonda o TOTAL antes de fatiar em min/seg — senão 119,5 vira "1m 60s".
  const total = Math.round(s);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const rest = total % 60;
  return rest > 0 ? `${m}m ${rest}s` : `${m}m`;
}

/**
 * Serializable format kind — passed as a string prop from Server Components to
 * client chart components (functions can't cross the RSC boundary).
 */
export type NumFmt =
  | "currency"
  | "currency0"
  | "int"
  | "compact"
  | "percent"
  | "decimal"
  | "duration";

export function formatBy(kind: NumFmt, v: number): string {
  switch (kind) {
    case "currency":
      return formatCurrency(v);
    case "currency0":
      return formatCurrency0(v);
    case "int":
      return formatInt(v);
    case "compact":
      return formatCompact(v);
    case "percent":
      return formatPercent(v);
    case "decimal":
      return formatDecimal(v);
    case "duration":
      return formatDuration(v);
  }
}
