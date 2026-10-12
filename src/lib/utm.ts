/**
 * O padrão de UTM dos anúncios (D6 do relatório) — puro, fonte única do gerador
 * e dos testes. As macros são da Meta: ela as troca pelos ids no clique.
 */

export const UTM_PADRAO = {
  utm_source: "meta",
  utm_medium: "paid_social",
  utm_campaign: "{{campaign.id}}",
  utm_term: "{{adset.id}}",
  utm_content: "{{ad.id}}",
} as const;

/**
 * A URL com os parâmetros. As macros `{{…}}` NÃO são codificadas: a Meta as
 * procura literais na URL (um `%7B%7Bad.id%7D%7D` chegaria sem resolver).
 */
export function urlComUtm(base: string, params: Record<string, string | undefined>): string {
  if (!base.trim()) return "";
  let url: URL;
  try {
    url = new URL(base.trim());
  } catch {
    return "URL base inválida";
  }
  const partes: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    const val = v?.trim();
    if (!val) continue;
    partes.push(`${encodeURIComponent(k)}=${/^\{\{.*\}\}$/.test(val) ? val : encodeURIComponent(val)}`);
  }
  const existente = url.search.replace(/^\?/, "");
  // A âncora (#form) precisa ficar DEPOIS da query: o navegador não manda nada
  // após "#", e a LP ficaria sem UTM nenhum.
  const hash = url.hash;
  url.search = "";
  url.hash = "";
  const query = [existente, ...partes].filter(Boolean).join("&");
  return `${url.toString()}${query ? `?${query}` : ""}${hash}`;
}
