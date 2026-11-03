import "server-only";
import { isSupabaseConfigured } from "../supabase/client";
import { BRANDS } from "../brands";
import { DEFAULT_BRAND } from "../types";
import { getState, listCampanhasDaConta } from "../data/store";
import { STATE_KEYS, type CampanhaDaConta } from "../data/backend";
import { CURINGA, NAO_CLASSIFICADO, marcaDaCampanha } from "../regra-de-marca";

/**
 * Meta API configuration.
 *
 * The version is PINNED on purpose — Meta ships a new version roughly every
 * quarter and retires old ones, so we never rely on the default. Bump
 * META_API_VERSION deliberately after checking the changelog.
 */
export const META_API_VERSION = process.env.META_API_VERSION ?? "v25.0";

/** Marketing API (ads) + Facebook-side Graph. */
export const GRAPH_FB = `https://graph.facebook.com/${META_API_VERSION}`;
/** Instagram API with Instagram Login (no Facebook Page required). */
export const GRAPH_IG = `https://graph.instagram.com/${META_API_VERSION}`;

export const igUserId = () => process.env.IG_USER_ID?.trim() || undefined;
export const igTokenFromEnv = () => process.env.IG_ACCESS_TOKEN?.trim() || undefined;

/** Ad account id, normalised to the `act_<id>` form the API expects. */
export function adAccountId(): string | undefined {
  const raw = process.env.META_AD_ACCOUNT_ID?.trim();
  if (!raw) return undefined;
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

export const adsToken = () => process.env.META_ADS_ACCESS_TOKEN?.trim() || undefined;

// ---- credenciais Meta POR MARCA (multimarca) -----------------------

/**
 * Credenciais/roteamento da Meta de UMA marca. Env por convenção: a marca padrão
 * (consorcio) usa os nomes base (IG_USER_ID, META_AD_ACCOUNT_ID, …); as demais
 * usam o sufixo do slug em maiúsculas (IG_USER_ID_KRONE, KRONE_CAMPAIGN_MATCH…).
 * Ad account/token sem valor próprio HERDAM os da conta compartilhada (o mesmo
 * ad account que a consorcio) — é o caso da krone, distinguida por `campaignMatch`.
 */
export interface BrandMeta {
  slug: string;
  igUserId?: string;
  igToken?: string;
  adAccountId?: string; // normalizado para act_<id>
  adsToken?: string;
  /**
   * Tokens para atribuir as campanhas desta marca DENTRO de um ad account
   * compartilhado: um fragmento (case-insensitive) do nome da campanha, ou um id
   * numérico de campanha. Vazio = marca "catch-all" da conta (a consorcio recebe
   * tudo que não casa com outra marca). Ex.: KRONE_CAMPAIGN_MATCH="krone,KR -".
   */
  campaignMatch: string[];
}

const envBrand = (base: string, slug: string): string | undefined => {
  const key = slug === DEFAULT_BRAND ? base : `${base}_${slug.toUpperCase()}`;
  return process.env[key]?.trim() || undefined;
};

const normalizeAct = (raw?: string): string | undefined => {
  if (!raw) return undefined;
  return raw.startsWith("act_") ? raw : `act_${raw}`;
};

export function metaBrandConfig(slug: string): BrandMeta {
  // Conta/token de anúncios: valor próprio da marca, senão herda a conta compartilhada.
  const adAccountId = normalizeAct(envBrand("META_AD_ACCOUNT_ID", slug) ?? process.env.META_AD_ACCOUNT_ID?.trim());
  const adsToken = envBrand("META_ADS_ACCESS_TOKEN", slug) ?? (process.env.META_ADS_ACCESS_TOKEN?.trim() || undefined);
  const match = (process.env[`${slug.toUpperCase()}_CAMPAIGN_MATCH`] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    slug,
    igUserId: envBrand("IG_USER_ID", slug),
    igToken: envBrand("IG_ACCESS_TOKEN", slug),
    adAccountId,
    adsToken,
    campaignMatch: match,
  };
}

/** Config de Meta de todas as marcas do registro (brands.ts). */
export function metaBrands(): BrandMeta[] {
  return BRANDS.map((b) => metaBrandConfig(b.slug));
}

/**
 * Como `metaBrands()`, mas sobrepõe o `campaignMatch` de cada marca com a regra
 * configurada pela UI (guardada no state bag), se houver. Assim o usuário ajusta
 * quais campanhas são de cada marca SEM redeploy — o env vira só o padrão.
 */
export async function resolveMetaBrands(): Promise<BrandMeta[]> {
  const base = metaBrands();
  const overrides =
    (await getState<Record<string, string[]>>(STATE_KEYS.brandCampaignMatch)) ?? {};
  return base.map((b) => {
    const ov = overrides[b.slug];
    return Array.isArray(ov) && ov.length ? { ...b, campaignMatch: ov } : b;
  });
}

/**
 * O que as travas de marca precisam para julgar a regra: a regra resolvida e as
 * campanhas da conta INTEIRA (todas as marcas, todo o histórico). Só com as
 * linhas da marca aberta, uma regra que funciona — e por isso tirou daqui as
 * campanhas da outra marca — era lida como "não pega nada", e o "≤" não saía.
 */
export async function contextoDeMarcas(): Promise<{
  brandRules: BrandMeta[];
  campanhasDaConta: CampanhaDaConta[];
}> {
  const [brandRules, campanhasDaConta] = await Promise.all([resolveMetaBrands(), listCampanhasDaConta()]);
  return { brandRules, campanhasDaConta };
}

/** Balde do que nenhuma regra reivindica e o curinga "o resto da conta" (fonte: regra-de-marca.ts). */
export { CURINGA, NAO_CLASSIFICADO };

/**
 * A marca de uma linha de anúncio pela campanha — `marcaDaCampanha`
 * (regra-de-marca.ts), com a marca padrão do painel. É a mesma função que a
 * prévia de Configurações → Marcas roda no navegador.
 */
export function brandForCampaign(
  campaignName: string | undefined,
  campaignId: string | undefined,
  brands: BrandMeta[],
): string {
  return marcaDaCampanha(campaignName, campaignId, brands, DEFAULT_BRAND);
}

/** Conversions API: the dataset id is what used to be called the Pixel id. */
export const datasetId = () => process.env.META_DATASET_ID?.trim() || undefined;
export const capiToken = () => process.env.META_CAPI_TOKEN?.trim() || undefined;
export const capiTestEventCode = () =>
  process.env.META_CAPI_TEST_EVENT_CODE?.trim() || undefined;

export const ga4MeasurementId = () => process.env.GA4_MEASUREMENT_ID?.trim() || undefined;
export const ga4ApiSecret = () => process.env.GA4_API_SECRET?.trim() || undefined;

export interface IntegrationStatus {
  supabase: boolean;
  instagram: boolean;
  ads: boolean;
  cronSecret: boolean;
  capi: boolean;
  ga4: boolean;
  lpTracking: boolean;
}

/** Whether each integration has its credentials present (never exposes values). */
export function integrationStatus(): IntegrationStatus {
  return {
    supabase: isSupabaseConfigured(),
    instagram: Boolean(igUserId() && igTokenFromEnv()),
    ads: Boolean(adAccountId() && adsToken()),
    cronSecret: Boolean(process.env.CRON_SECRET),
    capi: Boolean(datasetId() && capiToken()),
    ga4: Boolean(ga4MeasurementId() && ga4ApiSecret()),
    lpTracking: Boolean(process.env.TRACK_INGEST_KEY),
  };
}
