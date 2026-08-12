/**
 * Domain types for the marketing campaign dashboard.
 *
 * Field names follow the Meta 2026 vocabulary where it matters:
 * `views` replaces the deprecated `impressions` for Instagram organic;
 * paid `impressions` stays because the Ads/Marketing API still reports it.
 *
 * All dates are ISO strings: `yyyy-mm-dd` for daily rows, full ISO for events.
 */

// ------------------------- Marca / conta ----------------------------

/**
 * Marca/conta a que uma linha pertence — um slug estável e minúsculo
 * (`"consorcio"`, `"krone"`, …). TODA linha persistida carrega a marca para que
 * o painel separe contas que dividem o mesmo backend (ex.: consorcio.brunno,
 * lead-gen, vs. krone.capital, só seguidores). KPI nenhum deve misturar marcas.
 */
export type Brand = string;

/** Marca padrão: os dados já existentes (consorcio.brunno) recebem este slug. */
export const DEFAULT_BRAND: Brand = "consorcio";

// ------------------------- Campaign ---------------------------------

export type CampaignStatus = "ativa" | "pausada" | "encerrada";

export interface Campaign {
  id: string;
  brand: Brand;
  name: string;
  objective: string; // e.g. "Geração de cadastros (leads)"
  status: CampaignStatus;
  startDate: string; // yyyy-mm-dd
  endDate?: string;
  budgetTotal: number; // planned total budget (BRL)
  dailyBudget?: number; // BRL/day
}

// ------------------------- Instagram (organic) ----------------------

export interface IgAccountDaily {
  brand: Brand;
  date: string; // yyyy-mm-dd
  followers: number; // snapshot at end of day
  reach: number;
  views: number; // unified metric that replaced `impressions`
  profileLinkTaps: number;
  accountsEngaged: number;
  totalInteractions: number;
  profileViews: number; // visits to the profile
  reachFollowers?: number; // reach among existing followers
  reachNonFollowers?: number; // reach among non-followers (discovery)
  /** Conversas de DM iniciadas no dia — registro MANUAL (a API do Instagram não
   *  expõe DMs). É a métrica de negócio do perfil; semanal = soma dos dias. */
  dmConversations?: number;
  /** Crescimento BRUTO do dia (métrica follows_and_unfollows): quem começou a
   *  seguir vs quem deixou — o líquido esconde churn. Exige conta 100+. */
  followsDay?: number;
  unfollowsDay?: number;
  /** Cliques no link da bio por tipo de botão (breakdown contact_button_type). */
  linkTapsWebsite?: number;
  linkTapsWhatsApp?: number;
}

export type IgMediaType = "feed" | "carrossel" | "reel" | "story";

/** Tipo de chamada-para-ação pedida na legenda do post. */
export type CtaType = "dm" | "comentario" | "salvamento" | "marcacao" | "outro";

export interface IgPost {
  id: string;
  brand: Brand;
  publishedAt: string; // full ISO datetime
  type: IgMediaType;
  caption: string;
  permalink: string;
  reach: number;
  views: number;
  likes: number;
  comments: number;
  saved: number;
  shares: number;
  // avg watch time in seconds — reels only
  avgWatchTime?: number;
  // total seconds watched — reels only
  totalWatchTime?: number;
  /** Duração do vídeo em segundos — entrada MANUAL (a API não expõe a duração).
   *  Habilita a retenção real: avgWatchTime ÷ durationSec. Reels only. */
  durationSec?: number;
  /** Pilar/série de conteúdo (ex.: "Mito ou verdade", "Card de frase") — tag
   *  manual para comparar performance por categoria. */
  pillar?: string;
  /** CTA pedido na legenda — override manual; sem ele a heurística de caption
   *  (detectCta em metrics.ts) classifica na leitura. */
  ctaType?: CtaType;
  /** Visitas ao perfil atribuídas ao post (media insight; instável p/ contas pequenas). */
  profileVisits?: number;
  /** Seguidores ganhos atribuídos ao post (media insight; idem). */
  follows?: number;
  /** URLs do CDN da Meta — EXPIRAM em dias; o re-sync renova, a UI tolera 404. */
  mediaUrl?: string;
  thumbnailUrl?: string;
  /** Post de TESTE (validação de formato/gancho) — marcado manualmente; fica
   *  FORA da análise orgânica de performance (agregados, formatos, rankings).
   *  Conta para a cadência: é uma publicação real no perfil. */
  isTest?: boolean;
}

// ------------------------- Paid traffic (Meta Ads) ------------------

export interface AdDaily {
  brand: Brand;
  date: string; // yyyy-mm-dd
  campaign: string;
  adset: string;
  adId: string; // FK -> Creative.adId
  /**
   * Raw Meta objective of the campaign this ad belongs to, e.g. `OUTCOME_LEADS`
   * (conversão) or `OUTCOME_ENGAGEMENT` (descoberta/seguidores). Comes from the
   * insights `objective` field; may be undefined for legacy rows or CSVs that
   * don't carry it. Classified into a budget bucket by `objectiveBucket()` in
   * metrics.ts — never persist the derived bucket.
   */
  objective?: string;
  spend: number; // BRL
  impressions: number;
  reach: number;
  frequency: number;
  clicks: number; // link clicks
  leads: number;
}

export type CreativeFormat = "imagem" | "video" | "carrossel";

export interface Creative {
  adId: string;
  brand: Brand;
  name: string;
  format: CreativeFormat;
  thumbnailUrl?: string;
  // video engagement (for hook rate / retention study)
  videoPlays?: number; // 3s plays
  thruPlays?: number; // 15s / completed
  /** Mídia do IG por trás do anúncio (effective_instagram_media_id). Se casa com
   *  um IgPost da marca → post impulsionado; se não casa → dark post (anúncio
   *  sem post na grade). O permalink é o fallback de match entre superfícies. */
  instagramMediaId?: string;
  instagramPermalink?: string;
}

// ------------------------- Landing page -----------------------------

export interface LpDaily {
  brand: Brand;
  date: string; // yyyy-mm-dd
  visits: number; // landing page views / sessions
  clicks: number; // clicks on the page CTA
  formSubmits: number; // leads generated on the page
}

// ------------------------- Leads & meetings -------------------------

export type LeadStatus = "lead" | "agendou" | "compareceu" | "cliente" | "perdido";

export interface Lead {
  id: string;
  brand: Brand;
  createdAt: string; // full ISO datetime
  name: string;
  // Contact details — persisted for the sales team (LGPD: restrict access).
  email?: string;
  phone?: string;
  utmSource?: string;
  utmCampaign?: string;
  utmContent?: string; // maps to the creative/ad
  status: LeadStatus;
  meetingAt?: string; // full ISO datetime when scheduled
  /** Valor da carta/contrato (BRL), preenchido quando o lead vira cliente. */
  value?: number;
  /**
   * Pseudonymous identifiers captured on the landing page. Kept so a later
   * server-side event (Schedule) can still be matched to the same person.
   * No e-mail/phone is stored — those are hashed at ingest and discarded.
   */
  fbc?: string;
  fbp?: string;
  gaClientId?: string;
  gaSessionId?: string;
}

// ------------------------- Lead audit log ---------------------------

export type LeadEventAction = "created" | "status_changed";

/** One entry in the "quem alterou o lead" trail. */
export interface LeadEvent {
  id: string;
  leadId: string;
  leadName: string; // denormalised for display
  actor: string; // username, or "Landing page" for automated ingest
  action: LeadEventAction;
  fromStatus?: LeadStatus;
  toStatus?: LeadStatus;
  createdAt: string; // full ISO datetime
}

// ------------------------- Goals ------------------------------------

export type GoalMetric =
  | "leads"
  | "meetings"
  | "cpl"
  | "cpr"
  | "spend"
  | "followers"
  // ---- metas orgânicas do plano de 90 dias (diagnóstico do perfil) ----
  | "retencao_reels" // retenção média dos reels, em VALOR percentual (40 = 40%)
  | "alcance_base" // alcance sobre a base por post, em VALOR percentual (35 = 35%)
  | "saves_1k" // salvamentos por mil views
  | "comentarios_post" // comentários por post
  | "posts_semana" // posts por semana
  | "conversas_dm"; // conversas de DM iniciadas no período (registro manual)

export interface Goal {
  brand: Brand;
  metric: GoalMetric;
  period: "mes" | "campanha";
  target: number;
  // for cost goals, lower is better
  lowerIsBetter?: boolean;
}

// ------------------------- Dataset ----------------------------------

/** The full dataset the dashboard renders from. */
export interface DashboardData {
  campaign: Campaign;
  igAccountDaily: IgAccountDaily[];
  igPosts: IgPost[];
  adDaily: AdDaily[];
  creatives: Creative[];
  lpDaily: LpDaily[];
  leads: Lead[];
  goals: Goal[];
  /** When the data was last refreshed (ISO). */
  updatedAt: string;
  /** True while the dataset is the untouched example seed. */
  isSeed?: boolean;
}
