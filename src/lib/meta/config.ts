import "server-only";
import { isSupabaseConfigured } from "../supabase/client";

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
