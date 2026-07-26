/**
 * Domain types for the marketing campaign dashboard.
 *
 * Field names follow the Meta 2026 vocabulary where it matters:
 * `views` replaces the deprecated `impressions` for Instagram organic;
 * paid `impressions` stays because the Ads/Marketing API still reports it.
 *
 * All dates are ISO strings: `yyyy-mm-dd` for daily rows, full ISO for events.
 */

// ------------------------- Campaign ---------------------------------

export type CampaignStatus = "ativa" | "pausada" | "encerrada";

export interface Campaign {
  id: string;
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
  date: string; // yyyy-mm-dd
  followers: number; // snapshot at end of day
  reach: number;
  views: number; // unified metric that replaced `impressions`
  profileLinkTaps: number;
  accountsEngaged: number;
  totalInteractions: number;
  profileViews: number; // visits to the profile
}

export type IgMediaType = "feed" | "carrossel" | "reel" | "story";

export interface IgPost {
  id: string;
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
}

// ------------------------- Paid traffic (Meta Ads) ------------------

export interface AdDaily {
  date: string; // yyyy-mm-dd
  campaign: string;
  adset: string;
  adId: string; // FK -> Creative.adId
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
  name: string;
  format: CreativeFormat;
  thumbnailUrl?: string;
  // video engagement (for hook rate / retention study)
  videoPlays?: number; // 3s plays
  thruPlays?: number; // 15s / completed
}

// ------------------------- Landing page -----------------------------

export interface LpDaily {
  date: string; // yyyy-mm-dd
  visits: number; // landing page views / sessions
  clicks: number; // clicks on the page CTA
  formSubmits: number; // leads generated on the page
}

// ------------------------- Leads & meetings -------------------------

export type LeadStatus = "lead" | "agendou" | "compareceu" | "perdido";

export interface Lead {
  id: string;
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
  | "followers";

export interface Goal {
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
