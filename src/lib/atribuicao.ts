/**
 * De qual anúncio veio o lead — puro, fonte ÚNICA da junção lead → anúncio.
 *
 * O utm_content chega de quatro jeitos, e cada um pede uma resposta diferente:
 *   • com o id — "nome|123456789" (a página antiga), "nome__ad_123456789" (o link
 *     da Meta desde nov/26: `{{ad.name}}__ad_{{ad.id}}`) ou só o id — o id do
 *     anúncio decide (o caso bom);
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
 * O id no FIM do utm_content: sozinho ("123456789"), depois de "|" ("nome do
 * criativo|123456789") ou depois de "__ad_" ("nome do criativo__ad_123456789", o
 * link da Meta desde nov/26). Ids da Meta são numéricos longos; número colado ao
 * nome ("Post 12345", "nome|abc12345") não é id.
 */
const ID_NO_UTM_CONTENT = /(?:^|\||__ad_)\s*(\d{5,})$/i;

/** O id da campanha no fim do utm_campaign do link da Meta desde nov/26 (`{{campaign.name}}__cid_{{campaign.id}}`). */
const ID_NO_UTM_CAMPAIGN = /__cid_\s*(\d{5,})$/i;

/** Extrai o id do anúncio embutido no utm_content ("nome|123456789" ou "nome__ad_123456789" → "123456789"); sem id embutido, undefined. */
export function adIdFromUtmContent(utmContent?: string | null): string | undefined {
  if (!utmContent) return undefined;
  return ID_NO_UTM_CONTENT.exec(utmContent.trim())?.[1];
}

/**
 * O NOME do anúncio no utm_content, sem o id embutido ("nome|123" e
 * "nome__ad_123" → "nome"). É por ele que se casa por nome e que a origem se
 * escreve quando o id não diz — nunca com o "__ad_…" colado.
 */
export function nomeDoUtmContent(utmContent?: string | null): string {
  return (utmContent ?? "").split("|")[0].split(/__ad_/i)[0].trim();
}

/** Id numérico da Meta (anúncio, conjunto, campanha): só dígitos, 5 ou mais. */
const ID_META = /^\d{5,}$/;

/**
 * Os ids que o UTM padrão (D6) traz: `utm_campaign={{campaign.id}}`,
 * `utm_term={{adset.id}}`, `utm_content={{ad.id}}`. Só vira id o que é número
 * (macro literal ou nome ficam de fora). Também o id embutido: no `utm_content`,
 * "nome|id" e "nome__ad_id"; no `utm_campaign`, "nome__cid_id" (o link da Meta
 * desde nov/26, cujo `utm_term` é o posicionamento — nunca vira id).
 */
export function idsDoUtm(attr: {
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
}): { adId?: string; adsetId?: string; campaignId?: string } {
  const id = (v?: string | null) => {
    const s = v?.trim();
    return s && ID_META.test(s) ? s : undefined;
  };
  return {
    adId: id(attr.utm_content) ?? adIdFromUtmContent(attr.utm_content),
    adsetId: id(attr.utm_term),
    campaignId: id(attr.utm_campaign) ?? ID_NO_UTM_CAMPAIGN.exec(attr.utm_campaign?.trim() ?? "")?.[1],
  };
}

/**
 * Monta a função de atribuição para os criativos de UMA marca. O id gravado na
 * entrada (`lead.adId`, D6) vence; sem ele, vale o `utm_content`.
 */
export function atribuidor(
  creatives: Pick<Creative, "adId" | "name">[],
): (lead: Pick<Lead, "utmContent"> & { adId?: string }) => Atribuicao {
  const ids = new Set(creatives.map((c) => c.adId));
  const porNome = new Map<string, string[]>();
  for (const c of creatives) {
    const k = c.name.trim().toLowerCase();
    if (!k) continue;
    porNome.set(k, [...(porNome.get(k) ?? []), c.adId]);
  }
  return (lead) => {
    if (lead.adId) return { adId: lead.adId, tipo: "id" };
    const uc = lead.utmContent?.trim();
    if (!uc) return { tipo: "sem-origem" };
    if (temMacro(uc)) return { tipo: "macro" };
    const id = adIdFromUtmContent(uc);
    if (id) return { adId: id, tipo: "id" };
    // Dado em que o utm_content já é o próprio id do anúncio (seed, CSV antigo).
    if (ids.has(uc)) return { adId: uc, tipo: "id" };
    const nome = nomeDoUtmContent(uc).toLowerCase();
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
