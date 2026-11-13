/**
 * A miniatura da Meta (criativo de anúncio ou post do Instagram) — puro, sem
 * imports. Mora fora de `lib/midia.ts` para o Conteúdo poder usá-la sem arrastar
 * a Mídia (e, com ela, Fila, identidade, contato e live) para o grafo do sync do
 * Instagram, que importa `lib/conteudo.ts`. A Mídia a reexporta.
 */

/**
 * A miniatura da Meta, se ainda vale: só `https:`; o parâmetro `oe` (validade em
 * hex de segundos da época, CDN da Meta) vencido → null; sem `oe` → a URL; URL
 * inválida → null.
 */
export function miniaturaValida(url: string | undefined, agoraMs: number): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const oe = u.searchParams.get("oe");
  if (oe && /^[0-9a-f]+$/i.test(oe)) {
    const validade = parseInt(oe, 16) * 1000;
    if (Number.isFinite(validade) && Number.isFinite(agoraMs) && validade <= agoraMs) return null;
  }
  return url;
}
