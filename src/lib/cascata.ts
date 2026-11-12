/**
 * A CASCATA — o topo do funil (Meta → LP → Leads), com as duas âncoras e o selo.
 *
 * De Leads para baixo o funil é o do PROCESSO (`lib/funil-processo.ts`: robô,
 * agendamento, reunião, venda — a coorte lida do lead). Aqui ficam só os três
 * degraus de cima, que vêm de outros sistemas:
 *
 * 1. DUAS ÂNCORAS. Acima de Leads, a base são as impressões e cada degrau é "% da
 *    anterior"; de Leads para baixo, Leads = 100%. Com uma âncora só, oito linhas
 *    seguidas imprimiam "0,0% do topo" — mentira por arredondamento, não
 *    informação.
 *
 * 2. SELO DE FONTE em cada degrau, e junta tracejada onde o dado troca de
 *    sistema. Quando dois números não batem, saber que vieram de bancos
 *    diferentes é metade do diagnóstico.
 *
 * 3. CLIQUES NÃO É DEGRAU. `meta/ads.ts` faz `inline_link_clicks || clicks`:
 *    nos conjuntos de descoberta (posts impulsionados, sem link) o inline é 0 e
 *    o painel conta curtida, comentário e toque no perfil como clique. Somar
 *    duas definições incompatíveis e chamar de etapa produzia a maior "perda"
 *    do funil, que não existe.
 *
 * `Degrau.valor` é `number`: no topo não há duas fontes para o mesmo fato. Quando
 * houver (o Calendly, 2ª fonte de reuniões), a regra é `valor: null` + nota —
 * nunca escolher um lado em silêncio.
 *
 * Função PURA.
 */

import { bucketOfAd, filterAds, lpParouNoPeriodo } from "./metrics";
import type { DateRange } from "./metrics";
import type { DashboardData } from "./types";
import { MIN_REUNIOES } from "./trust";
import type { KpisDoPeriodo } from "./kpis";

// ---------------------------------------------------------------- vocabulário

export type Fonte = "meta" | "lp" | "crm" | "robo";

/**
 * Abaixo disto um número não sustenta taxa nem custo: "1 de 1" imprime "100,0%" e
 * "R$ 1.925,56 cada" com cara de medição. É a mesma régua da quarentena do custo
 * por reunião.
 */
export const AMOSTRA_MINIMA = MIN_REUNIOES;

export const FONTE_META: Record<Fonte, { label: string; sistema: string }> = {
  meta: { label: "Meta Ads", sistema: "Meta" },
  lp: { label: "Landing page", sistema: "LP" },
  crm: { label: "Painel", sistema: "Painel" },
  robo: { label: "Robô (WhatsApp)", sistema: "Robô" },
};

export interface Degrau {
  key: "impressoes" | "visitas" | "leads";
  label: string;
  valor: number;
  fonte: Fonte;
  /** Conversão a partir do degrau anterior (0–1): só com base ≥ `AMOSTRA_MINIMA` e valor ≤ base. */
  daAnterior?: number;
  /** Por que não há "% da anterior" quando HÁ um degrau de base. */
  semTaxa?: "amostra" | "nao-aninhada" | "lp-sem-dado";
  /** O dado troca de sistema ANTES deste degrau — junta tracejada. */
  trocaDeSistema?: boolean;
}

export interface CascataInput {
  data: DashboardData;
  range?: DateRange;
  /**
   * Os KPIs do período (`kpisDoPeriodo`). A cascata não recalcula leads: lê daqui,
   * para o degrau "Leads" ser o mesmo número do resto do painel. O CPL e a verba da
   * linha Leads são os de `kpisDoPeriodo`, escritos pela tela (`montarFunilDaTela`,
   * com `custoExibivel` + `mostrar`) — um texto por fato, não um 2º aqui.
   */
  kpis: Pick<KpisDoPeriodo, "leads">;
}

export interface CascataResult {
  degraus: Degrau[];
  /** Impressões de descoberta do período — fora da coluna (o ⓘ de Impressões diz quantas). */
  impressoesDescoberta: number;
}

// ---------------------------------------------------------------- montagem

/**
 * "% da anterior" só entre populações ANINHADAS e com amostra: abaixo de
 * `AMOSTRA_MINIMA` na base não é taxa; mais gente que na base é outra população.
 */
function taxaAninhada(d: Degrau, base: number): void {
  if (base < AMOSTRA_MINIMA) d.semTaxa = "amostra";
  else if (d.valor > base) d.semTaxa = "nao-aninhada";
  else d.daAnterior = d.valor / base;
}

export function montarCascata(input: CascataInput): CascataResult {
  const { data, range, kpis } = input;
  const todosAds = filterAds(data.adDaily, range);
  // Escopo de CONVERSÃO no topo (S16): impressões de alcance/engajamento contra
  // verba e leads de conversão misturavam dois funis numa coluna só.
  const impressoes = todosAds.filter((r) => bucketOfAd(r) === "conversao").reduce((s, r) => s + r.impressions, 0);
  const impressoesDescoberta = todosAds.filter((r) => bucketOfAd(r) === "descoberta").reduce((s, r) => s + r.impressions, 0);
  const visitas = (data.lpDaily ?? [])
    .filter((r) => !range || (r.date >= range.from && r.date <= range.to))
    .reduce((s, r) => s + r.visits, 0);

  const degraus: Degrau[] = [];

  // ---- topo: âncora nas impressões (só com impressões de conversão) ----
  if (impressoes > 0) {
    degraus.push({ key: "impressoes", label: "Impressões", valor: impressoes, fonte: "meta" });
  }

  if (visitas > 0) {
    const visita: Degrau = {
      key: "visitas",
      label: "Visitas na LP",
      valor: visitas,
      fonte: "lp",
      trocaDeSistema: impressoes > 0,
    };
    if (impressoes > 0) taxaAninhada(visita, impressoes);
    degraus.push(visita);
  }

  // ---- LEADS: a segunda âncora. Daqui para baixo, Leads = 100% ----------
  const leads: Degrau = {
    key: "leads",
    label: "Leads",
    valor: kpis.leads.valor,
    fonte: "crm",
    trocaDeSistema: degraus.length > 0,
  };
  // A base de Leads: as visitas, senão as impressões. A landing page que PAROU no
  // período (há histórico, nenhuma linha agora) não troca a base em silêncio para
  // as impressões: sem taxa, e o alerta `lp-sem-dado` diz por quê (K13).
  const base = visitas > 0 ? visitas : impressoes > 0 ? impressoes : 0;
  if (lpParouNoPeriodo(data, range)) leads.semTaxa = "lp-sem-dado";
  else if (base > 0) taxaAninhada(leads, base);
  degraus.push(leads);

  return { degraus, impressoesDescoberta };
}
