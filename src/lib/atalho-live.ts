/**
 * O atalho "Live 01/12" do seletor de período e o modo live do Início (Fase 2,
 * C10). Puro e importável no cliente: só lê a régua (`CampanhaDaLive`, que vem
 * do store pelo servidor) e as chaves de período de `range.ts`.
 *
 * A chave na URL é o período livre da régua (`buildCustomKey(de, ate)`), então
 * toda tela que já lê `?range=` entende a live sem saber dela. O modo live casa
 * SÓ pela chave, sem data: depois do fim as três chaves continuam abrindo o
 * painel (balanço do pós-live, números manuais); só o BOTÃO some. Chave antiga
 * (a régua foi editada depois) é período livre comum.
 */
import type { BrandType } from "./brands";
import type { CampanhaDaLive, Intervalo } from "./live";
import { buildCustomKey, parseCustomRange } from "./range";

/** Qual das três janelas da régua a chave abre. */
export type PeriodoDaLive = "campanha" | "captacao" | "posLive";

/** Ordem fixa: a de checagem e a dos sub-atalhos do painel. */
const ORDEM: readonly PeriodoDaLive[] = ["campanha", "captacao", "posLive"];

/** Rótulos dos sub-atalhos do painel da live (os mesmos da antiga `/live`). */
export const ROTULO_DO_PERIODO_DA_LIVE: Record<PeriodoDaLive, string> = {
  campanha: "Campanha da live",
  captacao: "Captação",
  posLive: "Pós-live",
};

/** As três chaves de período da régua da live. */
export function chavesDaLive(cfg: CampanhaDaLive): Record<PeriodoDaLive, string> {
  return {
    campanha: buildCustomKey(cfg.periodo.de, cfg.periodo.ate),
    captacao: buildCustomKey(cfg.captacao.de, cfg.captacao.ate),
    posLive: buildCustomKey(cfg.posLive.de, cfg.posLive.ate),
  };
}

/** Os sub-atalhos do painel (Campanha da live · Captação · Pós-live), na ordem. */
export function subAtalhosDaLive(cfg: CampanhaDaLive): { id: PeriodoDaLive; rotulo: string; chave: string }[] {
  const chaves = chavesDaLive(cfg);
  return ORDEM.map((id) => ({ id, rotulo: ROTULO_DO_PERIODO_DA_LIVE[id], chave: chaves[id] }));
}

/**
 * A chave do `?range=` é uma das três janelas da régua? Só IGUALDADE de chave,
 * sem olhar a data (depois do fim continua casando). Duas janelas com as mesmas
 * datas: vale a primeira na ordem campanha → captação → pós-live.
 */
export function periodoDaLive(rangeKey: string | null | undefined, cfg: CampanhaDaLive): PeriodoDaLive | null {
  if (!rangeKey) return null;
  const chaves = chavesDaLive(cfg);
  return ORDEM.find((p) => chaves[p] === rangeKey) ?? null;
}

export interface AtalhoDaLive {
  /** A chave da campanha inteira (`cfg.periodo`). */
  chave: string;
  /** O nome da régua (`cfg.nome`) — só o botão do seletor o usa; `rangeLabel` segue com datas. */
  rotulo: string;
  /** O botão aparece? Não para marca awareness nem depois de max(periodo.ate, posLive.ate). */
  visivel: boolean;
}

/**
 * O atalho do seletor do cabeçalho. Visível até o último dia da régua
 * (`max(periodo.ate, posLive.ate)`: as janelas são editadas uma a uma e o
 * pós-live pode passar do período), só em marca que não é awareness. Com o
 * botão escondido a chave continua valendo (o seletor ainda mostra o nome se
 * `current === chave`).
 */
export function atalhoDaLive(cfg: CampanhaDaLive, hoje: string, brandType: BrandType): AtalhoDaLive {
  const ultimoDia = cfg.periodo.ate > cfg.posLive.ate ? cfg.periodo.ate : cfg.posLive.ate;
  return {
    chave: chavesDaLive(cfg).campanha,
    rotulo: cfg.nome,
    visivel: brandType !== "awareness" && hoje <= ultimoDia,
  };
}

/**
 * Para onde a antiga `/live` manda (`/?range=<chave>`): o `?range=` recebido só
 * se ele é uma das três janelas da régua; qualquer outro (preset, `all`,
 * período livre comum, chave antiga, inválido, ausente) → a campanha inteira.
 * Os links antigos mais comuns da `/live` levavam `7d` (o padrão da home) ou um
 * preset do cabeçalho, que a página já ignorava.
 */
export function destinoDaLive(rangeParam: string | null | undefined, cfg: CampanhaDaLive): string {
  return periodoDaLive(rangeParam, cfg) !== null ? (rangeParam as string) : chavesDaLive(cfg).campanha;
}

export interface RangeDoPainelLive {
  /** AAAA-MM-DD, inclusivos — o `range` de `montarPainelLive`. */
  de: string;
  ate: string;
  /** O período ainda não começou (`de > hoje`): `ate === de` e o painel diz quando começa. */
  naoComecou: boolean;
}

/**
 * O `range` que o painel da live recebe — EXATAMENTE a conta da antiga
 * `live/page.tsx`: `parseCustomRange` da chave SEM o clamp no 1º dado (o
 * `resolveRange` encosta no 1º anúncio; o painel congelado nunca encostou), fim
 * limitado a hoje e, se ainda não começou, `{de, ate: de}`. `padrao` é o
 * `cfg.periodo` que a página usava quando a chave não era período livre ou não
 * tinha uma das pontas; sem ele, a ponta que falta vira a outra (ou hoje).
 */
export function rangeDoPainelLive(chave: string, hoje: string, padrao?: Intervalo): RangeDoPainelLive {
  const livre = parseCustomRange(chave);
  const de = livre ? (livre.from ?? padrao?.de ?? livre.to ?? hoje) : (padrao?.de ?? hoje);
  const ateBruto = livre ? (livre.to ?? padrao?.ate ?? hoje) : (padrao?.ate ?? hoje);
  const ate = ateBruto > hoje ? hoje : ateBruto;
  const naoComecou = de > hoje;
  return naoComecou ? { de, ate: de, naoComecou } : { de, ate, naoComecou };
}
