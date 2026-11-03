/**
 * Como a regra de marca compara um token com o nome da campanha. Puro — roda no
 * sync, na reclassificação, na prévia de Configurações → Marcas e nas travas de
 * confiança, que precisam concordar sobre o que "casar" quer dizer.
 *
 * O match continua sendo uma substring do nome, mas sem as diferenças que um
 * olho não vê: maiúsculas, espaço repetido ou não separável, espaço dentro do
 * colchete ("[ KRN ]") e colchete de largura cheia ("［KRN］"). Um token quase
 * certo que casava com zero campanhas deixava o gasto da outra marca inflando
 * esta em silêncio.
 */

/** Token que declara uma marca como "o resto da conta" — nunca casa com um nome. */
export const CURINGA = "*";

/** Nome de campanha (ou token) na forma em que a regra compara. */
export function normalizarCampanha(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\[\s+/g, "[")
    .replace(/\s+\]/g, "]")
    .trim();
}

/** Token só de dígitos é id de campanha, não fragmento do nome. */
export const ehIdDeCampanha = (token: string) => /^\d+$/.test(token.trim());

/**
 * A campanha casa com o token? Id numérico compara com o id da campanha; o resto,
 * substring do nome normalizado. Token vazio nunca casa.
 */
export function casaToken(nome: string | undefined, campaignId: string | undefined, token: string): boolean {
  const t = token.trim();
  if (!t || t === CURINGA) return false;
  if (ehIdDeCampanha(t)) return Boolean(campaignId) && campaignId === t;
  const alvo = normalizarCampanha(t);
  return alvo.length > 0 && normalizarCampanha(nome ?? "").includes(alvo);
}

/** O primeiro token (dos dados) que casa com a campanha, ou `undefined`. */
export function tokenQueCasa(
  nome: string | undefined,
  campaignId: string | undefined,
  tokens: string[],
): string | undefined {
  return tokens.find((t) => casaToken(nome, campaignId, t));
}

/**
 * Balde das linhas de anúncio que NENHUMA regra reivindica numa conta
 * compartilhada. Não é marca: fica fora de todos os números, com alerta, até
 * alguém dizer de quem é. Antes elas caíam em silêncio na marca padrão — e um
 * erro de atribuição era indistinguível de um acerto.
 */
export const NAO_CLASSIFICADO = "nao-classificado";

/** A regra de UMA marca: os tokens que reivindicam campanhas para ela. */
export interface RegraDeMarca {
  slug: string;
  campaignMatch: string[];
}

/** O texto do campo da regra ("[KRN], krn -") como a lista que é gravada. */
export const tokensDoCampo = (raw: string): string[] =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Escolhe a marca de uma linha de anúncio dentro de um ad account compartilhado,
 * pela campanha: casa por id numérico ou por trecho do nome. Sem casar:
 *   • conta de uma marca só → essa marca (não há o que classificar);
 *   • uma marca com o token `*` → ela (o "resto" declarado);
 *   • NENHUMA marca com regra → a padrão (ninguém começou a classificar; a trava
 *     "separação nunca configurada" avisa) — sem isso a conta inteira viraria
 *     "não classificado" no dia do deploy;
 *   • exatamente uma marca SEM regra → ela (o resto implícito de antes da 0016);
 *   • senão → `NAO_CLASSIFICADO`.
 * Pura: o sync, a reclassificação e a prévia da tela usam esta mesma função.
 */
export function marcaDaCampanha(
  campaignName: string | undefined,
  campaignId: string | undefined,
  regras: RegraDeMarca[],
  padrao: string,
): string {
  for (const b of regras) {
    for (const token of b.campaignMatch) {
      if (casaToken(campaignName, campaignId, token)) return b.slug;
    }
  }
  if (regras.length <= 1) return regras[0]?.slug ?? padrao;
  const resto = regras.find((b) => b.campaignMatch.includes(CURINGA));
  if (resto) return resto.slug;
  const semRegra = regras.filter((b) => b.campaignMatch.length === 0);
  if (semRegra.length === regras.length) {
    return (regras.find((b) => b.slug === padrao) ?? regras[0]).slug;
  }
  if (semRegra.length === 1) return semRegra[0].slug;
  return NAO_CLASSIFICADO;
}
