/**
 * De qual anúncio veio o lead — puro, fonte ÚNICA da junção lead → anúncio.
 *
 * O utm_content chega de quatro jeitos, e cada um pede uma resposta diferente:
 *   • "nome|123456789" ou só o id — o id do anúncio decide (o caso bom);
 *   • só o nome — vale se UM anúncio da marca tem esse nome; se dois têm
 *     ("Carrossel -"), a origem é AMBÍGUA e não se atribui a nenhum (atribuir ao
 *     primeiro mandaria pausar o errado);
 *   • "{{ad.name}}" literal — a Meta não resolveu a macro do link: origem
 *     DESCONHECIDA, com alerta, nunca o texto cru como se fosse um criativo.
 */

import type { Creative, Lead } from "./types";

export type TipoAtribuicao =
  | "id"
  | "nome"
  | "macro"
  | "ambigua"
  | "desconhecida"
  | "sem-origem";

export interface Atribuicao {
  /** Anúncio a que o lead foi atribuído, quando dá para afirmar. */
  adId?: string;
  tipo: TipoAtribuicao;
  /** Quantos anúncios têm o nome (só em `ambigua`). */
  candidatos?: number;
}

const MACRO_RE = /\{\{[^}]*\}\}/;

export function temMacro(utmContent?: string | null): boolean {
  return Boolean(utmContent && MACRO_RE.test(utmContent));
}

/**
 * Extrai o id do anúncio embutido no utm_content ("nome do criativo|123456789"
 * → "123456789"). Ids da Meta são numéricos longos; sem id embutido, undefined.
 */
export function adIdFromUtmContent(utmContent?: string | null): string | undefined {
  if (!utmContent) return undefined;
  const last = utmContent.split("|").pop()?.trim();
  return last && /^\d{5,}$/.test(last) ? last : undefined;
}

/** Monta a função de atribuição para os criativos de UMA marca. */
export function atribuidor(
  creatives: Pick<Creative, "adId" | "name">[],
): (lead: Pick<Lead, "utmContent">) => Atribuicao {
  const ids = new Set(creatives.map((c) => c.adId));
  const porNome = new Map<string, string[]>();
  for (const c of creatives) {
    const k = c.name.trim().toLowerCase();
    if (!k) continue;
    porNome.set(k, [...(porNome.get(k) ?? []), c.adId]);
  }
  return (lead) => {
    const uc = lead.utmContent?.trim();
    if (!uc) return { tipo: "sem-origem" };
    if (temMacro(uc)) return { tipo: "macro" };
    const id = adIdFromUtmContent(uc);
    if (id) return { adId: id, tipo: "id" };
    // Dado em que o utm_content já é o próprio id do anúncio (seed, CSV antigo).
    if (ids.has(uc)) return { adId: uc, tipo: "id" };
    const nome = uc.split("|")[0].trim().toLowerCase();
    const candidatos = porNome.get(nome) ?? [];
    if (candidatos.length === 1) return { adId: candidatos[0], tipo: "nome" };
    if (candidatos.length > 1) return { tipo: "ambigua", candidatos: candidatos.length };
    return { tipo: "desconhecida" };
  };
}

const PAID_SOURCE_RE = /ads|paid|cpc|ppc|meta|facebook|^fb$/;
const PAID_MEDIUM_RE = /paid|cpc|ppc|ads|social_paid/;

/**
 * O lead veio de tráfego pago? Pela fonte (metaads, facebook, fb…) OU pelo meio
 * (paid_social, cpc). O gerador de UTM emitia `utm_source=instagram` com
 * `utm_medium=paid_social` — pela fonte sozinha, anúncio pago contava como
 * orgânico e saía do CPL.
 */
export function isPaidSource(src?: string | null, medium?: string | null): boolean {
  if (src && PAID_SOURCE_RE.test(src.trim().toLowerCase())) return true;
  return Boolean(medium && PAID_MEDIUM_RE.test(medium.trim().toLowerCase()));
}
