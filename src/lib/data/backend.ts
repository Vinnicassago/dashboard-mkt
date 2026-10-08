import type {
  AdDaily,
  AuditEntry,
  Creative,
  DashboardData,
  Goal,
  IgAccountDaily,
  IgPost,
  Lead,
  LeadEvent,
  LeadStatus,
  Meta,
  PostDraft,
  SyncFonte,
  SyncRun,
} from "../types";
import type { Role } from "../auth/roles";

/**
 * The contract every storage backend implements. The app only ever talks to
 * this shape (via `store.ts`), so swapping JSON ⇄ Supabase changes nothing else.
 */
/**
 * O que muda num lead junto com o status.
 *
 * Os marcos (`bookedAt`/`attendedAt`/`closedAt`) são gravados UMA vez: o backend
 * preserva o valor que já existir, para que uma transição posterior — inclusive
 * uma perda — não apague o fato de a reunião ter acontecido. `lostAt` é o
 * oposto: descreve o estado atual e é limpo quando o lead sai da perda.
 */
/** Orçamento da campanha. Campo opcional ausente = mantém o que já está gravado. */
export interface CampaignBudget {
  budgetTotal: number;
  dailyBudget?: number;
  endDate?: string;
}

export interface LeadStatusPatch {
  meetingAt?: string;
  /** Data da reunião — sobrescreve (remarcar troca a data). */
  meetingFor?: string;
  /**
   * Marco da 1ª tentativa de contato — gravado uma vez, como os outros marcos.
   * `null` limpa: só quando a única tentativa foi desfeita (o fato não aconteceu).
   */
  firstContactAt?: string | null;
  /** Detalhe do motivo de perda. `null` limpa (lead saiu da perda). */
  lostReasonDetail?: string | null;
  value?: number;
  bookedAt?: string;
  attendedAt?: string;
  closedAt?: string;
  /** `null` limpa a marca (lead voltou ao caminho feliz). */
  lostAt?: string | null;
  roboSessionId?: string;
}

/** Recorte de linhas de anúncio substituído por `replaceAdData`. */
export interface AdScope {
  brands: string[];
  since: string;
  until: string;
}

/**
 * Campos de contato que um reenvio pode PREENCHER (nunca sobrescrever). Status,
 * data de entrada, marcos, reunião, valor e pareamento com o robô ficam fora:
 * um reenvio do formulário não muda o que aconteceu com o lead.
 */
export const LEAD_CONTACT_FIELDS = [
  "email",
  "phone",
  "utmSource",
  "utmCampaign",
  "utmContent",
  "utmMedium",
  "utmTerm",
  "fbclid",
  "fbc",
  "fbp",
  "gaClientId",
  "gaSessionId",
] as const;

/** Motivo gravado nos leads que `resetToSeed` exclui (reversível). */
export const MOTIVO_EXCLUSAO_RESET = "restaurar exemplo";

/**
 * O evento `excluido` de um lead que o reset tirou de cena — o mesmo formato da
 * exclusão manual, para a ficha dizer por que ele sumiu. Id derivado do lead e
 * do instante: um reset grava um evento por lead, nunca dois.
 */
export function eventoExclusaoReset(lead: Pick<Lead, "id" | "brand" | "name">, by: string, at: string): LeadEvent {
  return {
    id: `EVT-reset-${lead.id}-${Date.parse(at).toString(36)}`,
    leadId: lead.id,
    brand: lead.brand,
    leadName: lead.name,
    actor: by,
    action: "excluido",
    payload: { motivo: MOTIVO_EXCLUSAO_RESET },
    createdAt: at,
  };
}

export interface DataBackend {
  readonly name: "local" | "supabase" | "postgres";

  /**
   * Read the dataset for a single brand/account (todas as linhas dessa marca).
   * Leads excluídos (`deletedAt`) ficam de fora — ver `listDeletedLeads`.
   */
  getData(brand: string): Promise<DashboardData>;
  /**
   * Volta os dados de campanha ao exemplo. Nenhum lead é apagado: quem não é do
   * exemplo e ainda estava ativo é excluído de forma reversível
   * (`MOTIVO_EXCLUSAO_RESET`, por `by`, com o evento `excluido` de
   * `eventoExclusaoReset`) e aparece em Pessoas → Excluídos; os
   * leads do exemplo (ids `LEAD-0001`…, que nenhuma entrada real usa) voltam ao
   * estado do exemplo. `lead_events` e o registro de auditoria ficam intactos.
   */
  resetToSeed(by?: string): Promise<DashboardData>;

  upsertAdDaily(rows: AdDaily[]): Promise<number>;
  upsertCreatives(rows: Creative[]): Promise<number>;
  /**
   * Troca as linhas de anúncio de um recorte numa operação só: apaga o que
   * estiver em `scope` (marcas × datas) — ou tudo, sem `scope` — grava `rows` e
   * `creatives` e remove criativos que ficaram sem nenhuma linha. Quem chama já
   * tem os dados novos em mãos: nada é apagado antes de existir o substituto.
   */
  replaceAdData(rows: AdDaily[], creatives: Creative[], scope?: AdScope): Promise<void>;
  upsertIgAccountDaily(rows: IgAccountDaily[]): Promise<number>;
  upsertIgPosts(rows: IgPost[]): Promise<number>;

  // ---- produção (peças antes de publicar) ----
  /** Rascunhos de uma marca, mais recentes primeiro. `descartado` inclusive. */
  listDrafts(brand: string): Promise<PostDraft[]>;
  getDraft(id: string): Promise<PostDraft | null>;
  upsertDraft(draft: PostDraft): Promise<void>;
  deleteDraft(id: string): Promise<void>;

  /**
   * Grava um lead NOVO. Se o id já existir, só preenche campos de contato vazios
   * (`LEAD_CONTACT_FIELDS`, e o nome quando era "Lead sem nome") — status,
   * entrada, marcos, reunião, valor, marca e exclusão nunca são tocados.
   * `created` diz qual dos dois aconteceu.
   */
  addLead(lead: Lead): Promise<{ created: boolean }>;
  /** Um lead pelo id, inclusive excluído. */
  getLead(id: string): Promise<Lead | null>;
  setLeadStatus(id: string, status: LeadStatus, patch?: LeadStatusPatch): Promise<void>;
  /** Corrige a data de entrada (reparo de leads zerados por reenvio). */
  setLeadCreatedAt(id: string, createdAt: string): Promise<void>;
  /** Exclusão reversível: o lead some das listas e métricas, a linha fica. */
  softDeleteLead(id: string, info: { at: string; by: string; reason: string }): Promise<void>;
  restoreLead(id: string): Promise<void>;
  listDeletedLeads(brand: string): Promise<Lead[]>;
  /**
   * Leads da marca, sem os excluídos, mais recentes primeiro — só os leads, sem
   * carregar o resto de `getData` (a entrada da LP procura a mesma pessoa aqui).
   */
  listLeads(brand: string): Promise<Lead[]>;
  upsertGoal(goal: Goal): Promise<void>;
  /**
   * Grava uma meta NOVA (nunca altera nem apaga uma anterior: a vigência é que
   * diz qual vale em cada dia). As metas da marca chegam em `getData().metas`.
   */
  addMeta(meta: Meta): Promise<void>;
  /** Grava o orçamento da campanha da marca, criando a linha da campanha se o
   *  banco ainda não tiver uma (produção nunca rodou o seed). */
  setCampaignBudget(brand: string, budget: CampaignBudget): Promise<void>;

  // ---- lead audit log ----
  addLeadEvent(event: LeadEvent): Promise<void>;
  /**
   * Mais recentes primeiro. `brand` filtra pela marca (eventos antigos sem
   * marca entram em todas); `limit` 0 = sem limite.
   */
  listLeadEvents(opts?: ListEventsOpts): Promise<LeadEvent[]>;

  // ---- ações administrativas ----
  addAuditEntry(entry: AuditEntry): Promise<void>;
  listAuditEntries(limit: number): Promise<AuditEntry[]>;

  // ---- sincronizações (ADR-04) ----
  addSyncRun(run: SyncRun): Promise<void>;
  /** Mais recentes primeiro (por `finishedAt`). `limit` 0 = sem limite. */
  listSyncRuns(opts?: ListSyncRunsOpts): Promise<SyncRun[]>;

  /** Accumulate landing-page counters for a brand's day (read-modify-write). */
  bumpLpDaily(brand: string, date: string, delta: LpDelta): Promise<void>;

  /** Small key/value bag: last sync timestamps, refreshed tokens, flags. */
  getState<T>(key: string): Promise<T | null>;
  setState(key: string, value: unknown): Promise<void>;

  // ---- auth users ----
  countUsers(): Promise<number>;
  getUser(username: string): Promise<StoredUser | null>;
  listUsers(): Promise<PublicUser[]>;
  createUser(user: StoredUser): Promise<void>;
  deleteUser(username: string): Promise<void>;
  setUserRole(username: string, role: Role): Promise<void>;
}

/** A user with its (hashed) credentials — never sent to the client. */
export interface StoredUser {
  username: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
}

/** Safe-to-display user info (no hash). */
export interface PublicUser {
  username: string;
  role: Role;
  createdAt: string;
}

export interface ListSyncRunsOpts {
  source?: SyncFonte;
  brand?: string;
  limit?: number;
}

export interface ListEventsOpts {
  leadId?: string;
  brand?: string;
  limit?: number;
}

/** Deltas applied to a day's landing-page counters. */
export interface LpDelta {
  visits?: number;
  clicks?: number;
  formSubmits?: number;
}

/** Keys used in the state bag. */
export const STATE_KEYS = {
  lastSyncAds: "last_sync_ads",
  lastSyncInstagram: "last_sync_instagram",
  igToken: "ig_token",
  /** Regras de campanha→marca configuradas pela UI: Record<slug, string[]>.
   *  Sobrepõem o env (<SLUG>_CAMPAIGN_MATCH) quando presentes. */
  brandCampaignMatch: "brand_campaign_match",
} as const;

/**
 * Chave da última análise de IA de uma marca. Fica no state bag (não numa tabela
 * própria): é UM registro por marca, sobrescrito a cada rodada — histórico de
 * análises não é requisito, e uma tabela para isso seria peso morto.
 */
export const aiAnalysisKey = (brand: string) => `ai_analysis_${brand}`;

export interface StoredToken {
  token: string;
  /** ISO timestamp when the long-lived token expires. */
  expiresAt: string;
}
