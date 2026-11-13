import type { DateRange } from "./metrics";

/** Period presets shown in the header selector. */
export const RANGE_PRESETS = [
  { key: "all", label: "Campanha" },
  { key: "90d", label: "90 dias" },
  { key: "30d", label: "30 dias" },
  { key: "14d", label: "14 dias" },
  { key: "7d", label: "7 dias" },
] as const;

export type RangeKey = (typeof RANGE_PRESETS)[number]["key"];

/**
 * Sem `?range=`, o Início olha a semana (7 dias contra os 7 anteriores). Fonte
 * ÚNICA: a navegação (`nav-items`, que o seletor e os links leem) e o carregador
 * do Início (`PERIODO_PADRAO_DA_BUSSOLA`) leem daqui — eram duas constantes.
 */
export const PERIODO_PADRAO_DO_INICIO: RangeKey = "7d";

/** Sem `?range=`, a Mídia olha a semana: "o que faço com a verba ESTA semana?". */
export const PERIODO_PADRAO_DA_MIDIA: RangeKey = "7d";

/**
 * O período que cada rota abre sem `?range=`. A FONTE do comportamento:
 * `periodoPadraoDe` (nav-items) delega a `periodoPadraoDaRota`, e o 3º argumento
 * padrão de `comPeriodo` também sai daqui — inclusive nos links montados no servidor.
 */
export const PERIODO_PADRAO_POR_ROTA: Readonly<Record<string, RangeKey>> = {
  "/": PERIODO_PADRAO_DO_INICIO,
  "/midia": PERIODO_PADRAO_DA_MIDIA,
};

/**
 * O padrão do DESTINO de um link. A rota = `href.split(/[?#]/)[0] || "/"` (a MESMA
 * conta de `comPeriodoDaTela`): "/#topo" e "/?x=1" são "/". "/" só exato; as outras
 * rotas por prefixo com fronteira ("/midia/x" é "/midia"; "/midiax" não é). Sem
 * entrada: "all" (a campanha inteira).
 */
export function periodoPadraoDaRota(href: string): RangeKey {
  const rota = href.split(/[?#]/)[0] || "/";
  for (const [prefixo, padrao] of Object.entries(PERIODO_PADRAO_POR_ROTA)) {
    if (prefixo === "/") {
      if (rota === "/") return padrao;
      continue;
    }
    if (rota === prefixo || rota.startsWith(`${prefixo}/`)) return padrao;
  }
  return "all";
}

const PRESET_DAYS: Record<string, number> = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 };

/**
 * Período livre viaja na MESMA chave `range`, no formato "de..ate":
 *   2026-08-01..2026-08-27   entre duas datas
 *   2026-08-01..             daquela data em diante
 *   ..2026-08-27             até aquela data
 * Assim toda página que já lê `?range=` ganha o período livre de graça.
 */
const CUSTOM = /^(\d{4}-\d{2}-\d{2})?\.\.(\d{4}-\d{2}-\d{2})?$/;

export interface CustomRange {
  from?: string;
  to?: string;
}

export function parseCustomRange(key: string | undefined): CustomRange | null {
  if (!key) return null;
  const m = CUSTOM.exec(key);
  if (!m) return null;
  const [, from, to] = m;
  if (!from && !to) return null;
  if (from && to && from > to) return { from: to, to: from };
  return { from, to };
}

export function buildCustomKey(from: string, to: string): string {
  return `${from}..${to}`;
}

export function isRangeKey(v: string | undefined): boolean {
  // Object.hasOwn: a chave vem crua da URL — `in` deixaria "toString" etc. passarem.
  if (v === "all") return true;
  if (v === undefined) return false;
  return Object.hasOwn(PRESET_DAYS, v) || parseCustomRange(v) !== null;
}

/** dd/mm — rótulo curto para o botão e para o texto da análise de IA. */
function curto(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** Rótulo legível de qualquer chave de período. */
export function rangeLabel(key: string | undefined): string {
  const preset = RANGE_PRESETS.find((p) => p.key === (key ?? "all"));
  if (preset) return preset.label;
  const custom = parseCustomRange(key);
  if (!custom) return "o período";
  if (custom.from && custom.to) return `${curto(custom.from)} a ${curto(custom.to)}`;
  if (custom.from) return `desde ${curto(custom.from)}`;
  return `até ${curto(custom.to as string)}`;
}

/** "Hoje" no calendário de quem usa o painel (Brasília), não no do servidor (UTC). */
export function hojeEmBrasilia(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

/**
 * Resolve a preset key or a custom "from..to" into a concrete DateRange.
 * `undefined` means "all data" — e SÓ para `all`, sem chave ou chave inválida
 * (Fase 2, C9): um período pedido nunca vira "tudo" em silêncio.
 *
 * Os presets contam a partir de HOJE, não do último dia com anúncio: ancorar no
 * dado fazia "7 dias" mostrar, sem aviso, uma semana velha sempre que o sync
 * parava (e todo preset virava "tudo" numa marca sem anúncio). Os dias sem
 * dado no fim do período aparecem — é a confiança (`trust.ts`) que diz o que
 * eles significam. `hoje` vem de fora para o cálculo seguir puro.
 *
 * Período livre: `from = max(pedido.from, span.from)`, `to = min(pedido.to, hoje)`.
 * Quando isso inverte (`from > to`):
 *   - período que ainda não começou (`pedido.from > hoje`) → o 1º dia pedido,
 *     `{from: pedido.from, to: pedido.from}` (vazio; a página sabe pelo
 *     `naoComecou` de `pageRange`) — antes virava "tudo";
 *   - período inteiro antes do 1º dado → o pedido sem o clamp do span,
 *     `{from: pedido.from, to: min(pedido.to, hoje)}` (vazio de verdade).
 */
export function resolveRange(
  key: string | undefined,
  span: { from: string; to: string },
  hoje: string = span.to,
): DateRange | undefined {
  if (!key || key === "all") return undefined;
  const fim = hoje || span.to;

  const custom = parseCustomRange(key);
  if (custom) {
    let to = custom.to ?? fim;
    if (fim && to && to > fim) to = fim;
    let from = custom.from ?? span.from;
    if (span.from && from && from < span.from) from = span.from;
    // Sem dado e sem "hoje" de um dos lados: o período é a ponta que existe.
    if (!from) from = to;
    if (!to) to = from;
    if (from <= to) return { from, to };
    // Ainda não começou: o 1º dia pedido, vazio — nunca "tudo".
    if (custom.from && fim && custom.from > fim) return { from: custom.from, to: custom.from };
    // Antes do 1º dado: o que foi pedido, sem o clamp do span (vazio de verdade).
    const de = custom.from && custom.from <= to ? custom.from : to;
    return { from: de, to };
  }

  const days = Object.hasOwn(PRESET_DAYS, key) ? PRESET_DAYS[key] : 0;
  if (!days || !fim) return undefined;
  const fromD = new Date(fim + "T00:00:00Z");
  fromD.setUTCDate(fromD.getUTCDate() - (days - 1));
  let from = fromD.toISOString().slice(0, 10);
  // O clamp no 1º dado nunca inverte o período (dado que só começa depois de hoje).
  if (span.from && from < span.from && span.from <= fim) from = span.from;
  return { from, to: fim };
}

/**
 * Leva o período escolhido num link interno — trocar de página não pode trocar
 * de período em silêncio. Respeita a query e a âncora que o link já tiver — e o
 * período que ele já tiver: o link que leva `range=` de propósito (a B1 e a barra
 * do robô abrem Leads com `range=all`, 11.5) sai intacto, sem um 2º `range`.
 *
 * `padraoDoDestino`: o período que o DESTINO abre sem `?range=` — o padrão do
 * destino sai de `periodoPadraoDaRota` (pelo caminho do href). "Campanha" (`all`)
 * sai do link só quando é também o padrão do destino; para o Início e a Mídia
 * (padrão = a semana) ela vai explícita — senão Funil (Campanha) → Início ou Mídia
 * abria em 7 dias sem ninguém ter escolhido.
 */
export function comPeriodo(
  href: string,
  rangeKey?: string | null,
  padraoDoDestino: string = periodoPadraoDaRota(href),
): string {
  if (!rangeKey || (rangeKey === "all" && padraoDoDestino === "all")) return href;
  const [base, hash] = href.split("#");
  if (/[?&]range=/.test(base)) return href;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}range=${encodeURIComponent(rangeKey)}${hash ? `#${hash}` : ""}`;
}
