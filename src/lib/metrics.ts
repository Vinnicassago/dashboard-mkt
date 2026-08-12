/**
 * Pure KPI functions. No I/O — everything takes data in and returns numbers,
 * so it's trivial to reason about and test.
 *
 * Cost vocabulary:
 *   CPM = custo por mil impressões · CPC = custo por clique
 *   CPL = custo por lead · CPR = custo por reunião agendada (North Star)
 */

import type {
  AdDaily,
  Creative,
  CtaType,
  DashboardData,
  Goal,
  IgAccountDaily,
  IgPost,
  Lead,
} from "./types";
import { isAwareness } from "./brands";

// ---- date helpers ---------------------------------------------------

export interface DateRange {
  from: string; // yyyy-mm-dd (inclusive)
  to: string; // yyyy-mm-dd (inclusive)
}

const div = (a: number, b: number) => (b > 0 ? a / b : 0);

/** Extract the yyyy-mm-dd part of an ISO string. */
export function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

export function inRange(day: string, range?: DateRange): boolean {
  if (!range) return true;
  return day >= range.from && day <= range.to;
}

export function filterAds(rows: AdDaily[], range?: DateRange): AdDaily[] {
  return range ? rows.filter((r) => inRange(r.date, range)) : rows;
}

export function filterLeads(leads: Lead[], range?: DateRange): Lead[] {
  return range ? leads.filter((l) => inRange(dayOf(l.createdAt), range)) : leads;
}

/** The equal-length window immediately before `range` (for period-over-period). */
export function previousRange(range: DateRange): DateRange {
  const from = new Date(range.from + "T00:00:00Z");
  const to = new Date(range.to + "T00:00:00Z");
  const days = Math.round((+to - +from) / 86400000) + 1;
  const prevTo = new Date(from);
  prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (days - 1));
  return {
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
  };
}

// ---- ad aggregation -------------------------------------------------

export interface AdKpis {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
  ctr: number; // clicks / impressions
  cpc: number; // spend / clicks
  cpm: number; // spend / impressions * 1000
  cpl: number; // spend / leads
  frequency: number; // impressions / reach
}

export function adKpis(rows: AdDaily[]): AdKpis {
  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const reach = rows.reduce((s, r) => s + r.reach, 0);
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const leads = rows.reduce((s, r) => s + r.leads, 0);
  return {
    spend,
    impressions,
    reach,
    clicks,
    leads,
    ctr: div(clicks, impressions),
    cpc: div(spend, clicks),
    cpm: div(spend, impressions) * 1000,
    cpl: div(spend, leads),
    frequency: div(impressions, reach),
  };
}

// ---- objective classification (conversão vs descoberta) ------------

/**
 * Two budget buckets, by ad objective:
 *   `conversao`  — ads meant to generate leads/meetings (feed CPL/CPR).
 *   `descoberta` — ads meant for reach/engagement/followers (profile growth).
 * Everything here is pure: the raw Meta `objective` string lives on AdDaily and
 * is classified on the fly, so retuning the taxonomy never needs a re-migration.
 */
export type ObjectiveBucket = "conversao" | "descoberta";

export const OBJECTIVE_LABEL: Record<ObjectiveBucket, string> = {
  conversao: "Conversão",
  descoberta: "Descoberta",
};

// Valores de reach/engajamento/seguidores — objectives (ODAX/legado) E
// optimization_goals de conjunto (PROFILE_VISIT, POST_ENGAGEMENT, …).
const DISCOVERY_OBJECTIVES = new Set([
  // objectives de campanha
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_AWARENESS",
  "POST_ENGAGEMENT",
  "PAGE_LIKES",
  "PROFILE_VISITS",
  "REACH",
  "BRAND_AWARENESS",
  "VIDEO_VIEWS",
  "EVENT_RESPONSES",
  // optimization_goals de conjunto
  "PROFILE_VISIT",
  "VISIT_INSTAGRAM_PROFILE", // "Visitas ao perfil do Instagram"
  "PROFILE_AND_PAGE_ENGAGEMENT",
  "PAGE_ENGAGEMENT",
  "PAGE_LIKE",
  "IMPRESSIONS",
  "AD_RECALL_LIFT",
  "THRUPLAY",
  "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS",
  "ENGAGED_USERS",
  "SOCIAL_IMPRESSIONS",
]);

// Valores que empurram uma ação de fundo de funil (lead/venda/visita ao site) —
// objectives de campanha E optimization_goals de conjunto.
const CONVERSION_OBJECTIVES = new Set([
  // objectives de campanha
  "OUTCOME_LEADS",
  "OUTCOME_SALES",
  "OUTCOME_TRAFFIC", // envia para a LP no nosso funil → conversão (mude aqui se usar tráfego p/ perfil)
  "OUTCOME_APP_PROMOTION",
  "LEAD_GENERATION",
  "CONVERSIONS",
  "MESSAGES",
  "LINK_CLICKS",
  "TRAFFIC",
  "PRODUCT_CATALOG_SALES",
  "STORE_VISITS",
  // optimization_goals de conjunto
  "OFFSITE_CONVERSIONS",
  "QUALITY_LEAD",
  "QUALITY_CALL",
  "LEAD",
  "LANDING_PAGE_VIEWS",
  "VALUE",
  "PURCHASE",
  "COMPLETE_REGISTRATION",
  "CONVERSATIONS",
  "DERIVED_EVENTS",
]);

/**
 * Classify a raw Meta objective into a budget bucket. Missing objective (legacy
 * rows, CSV sem a coluna) cai em "conversao" para preservar o CPL/CPR histórico
 * até um re-sync popular o campo — anúncios de descoberta só saem do denominador
 * depois de reconhecidos.
 */
export function objectiveBucket(raw?: string | null): ObjectiveBucket {
  if (!raw) return "conversao";
  const key = raw.trim().toUpperCase();
  if (DISCOVERY_OBJECTIVES.has(key)) return "descoberta";
  if (CONVERSION_OBJECTIVES.has(key)) return "conversao";
  // Fallback por palavra-chave para objetivos/metas ainda não catalogados.
  if (/ENGAGEMENT|AWARENESS|REACH|VIDEO|PROFILE|LIKE|FOLLOW|THRUPLAY|IMPRESSION/.test(key))
    return "descoberta";
  return "conversao";
}

export const bucketOfAd = (row: AdDaily): ObjectiveBucket => objectiveBucket(row.objective);

/**
 * Extrai o id do anúncio embutido no utm_content ("nome do criativo|123456789"
 * → "123456789"). Ids da Meta são numéricos longos; sem id embutido, undefined.
 */
export function adIdFromUtmContent(utmContent?: string | null): string | undefined {
  if (!utmContent) return undefined;
  const last = utmContent.split("|").pop()?.trim();
  return last && /^\d{5,}$/.test(last) ? last : undefined;
}

/**
 * Chave de junção lead→anúncio: o id extraído do utm_content, senão o próprio
 * utm_content (compat. com dados onde o utm_content já é o adId, ex. seed).
 */
export function leadAdKey(lead: Lead): string | undefined {
  return adIdFromUtmContent(lead.utmContent) ?? lead.utmContent ?? undefined;
}

const PAID_SOURCE_RE = /ads|paid|cpc|ppc|meta|facebook|^fb$/;

/**
 * O utm_source indica tráfego pago? (metaads, facebook, fb, …). Fontes orgânicas
 * como "ig"/"instagram"/"link_in_bio" retornam false — usado para separar leads
 * orgânicos (sem custo) do denominador do CPL pago.
 */
export function isPaidSource(src?: string | null): boolean {
  return src ? PAID_SOURCE_RE.test(src.trim().toLowerCase()) : false;
}

export interface ObjectiveKpis {
  bucket: ObjectiveBucket;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number; // leads atribuídos (via utmContent) a anúncios deste balde
  meetings: number; // reuniões atribuídas a este balde
  ctr: number;
  cpm: number; // spend / impressions * 1000
  costPerReach: number; // spend / reach * 1000 (custo por mil alcançados)
  cpl: number; // spend / leads
  cpr: number; // spend / meetings
}

function emptyObjectiveKpis(bucket: ObjectiveBucket): ObjectiveKpis {
  return {
    bucket,
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    leads: 0,
    meetings: 0,
    ctr: 0,
    cpm: 0,
    costPerReach: 0,
    cpl: 0,
    cpr: 0,
  };
}

export interface ObjectiveBreakdown {
  conversao: ObjectiveKpis;
  descoberta: ObjectiveKpis;
  totalSpend: number;
  conversaoShare: number; // 0–1 do gasto
  descobertaShare: number; // 0–1 do gasto
  hasDiscovery: boolean; // há gasto de descoberta no período?
  /** leads sem atribuição a anúncio pago (orgânico/direto) — contam no total,
   *  mas ficam FORA do CPL/CPR pago. */
  organicLeads: number;
  organicMeetings: number;
  /** seguidores líquidos ganhos no período (conta inteira: orgânico + pago) */
  netNewFollowers: number;
  /** custo por seguidor ESTIMADO = gasto em descoberta ÷ seguidores líquidos.
   *  Estimativa: a Meta não atribui seguidores por anúncio; o crescimento é da
   *  conta (orgânico + pago). Serve como eficiência de topo, não atribuição exata.
   *  `null` quando não houve ganho — a UI mostra "—" em vez de "R$ 0" (de graça). */
  costPerFollowerEst: number | null;
}

/**
 * Split ad spend + attributed leads/meetings by objective bucket, and pair the
 * discovery bucket with the account-level follower gain for an estimated
 * cost-per-follower. This is the faithful budget view: conversion CPL/CPR no
 * longer carry the discovery budget.
 */
export function objectiveBreakdown(data: DashboardData, range?: DateRange): ObjectiveBreakdown {
  const ads = filterAds(data.adDaily, range);
  const leads = filterLeads(data.leads, range);

  // ad → bucket (o objetivo de um anúncio é estável; usa a primeira linha vista)
  const adBucket = new Map<string, ObjectiveBucket>();
  for (const r of ads) {
    if (!adBucket.has(r.adId)) adBucket.set(r.adId, bucketOfAd(r));
  }

  const acc: Record<ObjectiveBucket, ObjectiveKpis> = {
    conversao: emptyObjectiveKpis("conversao"),
    descoberta: emptyObjectiveKpis("descoberta"),
  };
  for (const r of ads) {
    const a = acc[bucketOfAd(r)];
    a.spend += r.spend;
    a.impressions += r.impressions;
    a.reach += r.reach;
    a.clicks += r.clicks;
  }
  let organicLeads = 0;
  let organicMeetings = 0;
  for (const l of leads) {
    const key = leadAdKey(l);
    const joined = key ? adBucket.get(key) : undefined;
    // Junta pelo anúncio; se não junta mas a fonte é paga, assume conversão;
    // senão é orgânico/direto (sem custo pago) e fica fora do CPL/CPR.
    const b: ObjectiveBucket | "organico" =
      joined ?? (isPaidSource(l.utmSource) ? "conversao" : "organico");
    if (b === "organico") {
      organicLeads += 1;
      if (isBooked(l)) organicMeetings += 1;
    } else {
      acc[b].leads += 1;
      if (isBooked(l)) acc[b].meetings += 1;
    }
  }
  for (const b of ["conversao", "descoberta"] as ObjectiveBucket[]) {
    const a = acc[b];
    a.ctr = div(a.clicks, a.impressions);
    a.cpm = div(a.spend, a.impressions) * 1000;
    a.costPerReach = div(a.spend, a.reach) * 1000;
    a.cpl = div(a.spend, a.leads);
    a.cpr = div(a.spend, a.meetings);
  }

  const totalSpend = acc.conversao.spend + acc.descoberta.spend;
  const netNewFollowers = igAccountTotals(data.igAccountDaily, range).netNew;
  return {
    conversao: acc.conversao,
    descoberta: acc.descoberta,
    totalSpend,
    conversaoShare: div(acc.conversao.spend, totalSpend),
    descobertaShare: div(acc.descoberta.spend, totalSpend),
    hasDiscovery: acc.descoberta.spend > 0,
    organicLeads,
    organicMeetings,
    netNewFollowers,
    costPerFollowerEst: netNewFollowers > 0 ? acc.descoberta.spend / netNewFollowers : null,
  };
}

// ---- meetings (from the leads list) --------------------------------

/** Teve reunião marcada (agendou, compareceu ou já virou cliente). */
export function isBooked(l: Lead): boolean {
  return l.status === "agendou" || l.status === "compareceu" || l.status === "cliente";
}

/** Compareceu à reunião (inclui quem virou cliente). */
export function isAttended(l: Lead): boolean {
  return l.status === "compareceu" || l.status === "cliente";
}

export function isClient(l: Lead): boolean {
  return l.status === "cliente";
}

export function countMeetings(leads: Lead[]): number {
  return leads.filter(isBooked).length;
}

export function countAttended(leads: Lead[]): number {
  return leads.filter(isAttended).length;
}

export function countClients(leads: Lead[]): number {
  return leads.filter(isClient).length;
}

/** Receita atribuída = soma do valor das cartas dos clientes. */
export function sumRevenue(leads: Lead[]): number {
  return leads.filter(isClient).reduce((s, l) => s + (l.value ?? 0), 0);
}

/** custo por reunião agendada (North Star) */
export function cpr(spend: number, meetings: number): number {
  return div(spend, meetings);
}

// ---- funnel ---------------------------------------------------------

export interface FunnelStage {
  key: string;
  label: string;
  value: number;
  /** conversion from the previous stage (ratio), undefined for the first. */
  fromPrev?: number;
}

export function buildFunnel(data: DashboardData, range?: DateRange): FunnelStage[] {
  const ads = filterAds(data.adDaily, range);
  const leads = filterLeads(data.leads, range);
  const impressions = ads.reduce((s, r) => s + r.impressions, 0);
  const clicks = ads.reduce((s, r) => s + r.clicks, 0);
  const leadCount = leads.length;
  const meetings = countMeetings(leads);
  const attended = countAttended(leads);
  const clients = countClients(leads);

  const stages: FunnelStage[] = [
    { key: "impressoes", label: "Impressões", value: impressions },
    { key: "cliques", label: "Cliques", value: clicks, fromPrev: div(clicks, impressions) },
    { key: "leads", label: "Leads", value: leadCount, fromPrev: div(leadCount, clicks) },
    { key: "reunioes", label: "Reuniões", value: meetings, fromPrev: div(meetings, leadCount) },
    { key: "compareceu", label: "Compareceu", value: attended, fromPrev: div(attended, meetings) },
    { key: "clientes", label: "Clientes", value: clients, fromPrev: div(clients, attended) },
  ];
  return stages;
}

// ---- headline KPI bundle for the overview --------------------------

export interface OverviewKpis {
  spend: number; // investimento total (blended) — todos os objetivos
  spendConversao: number; // parcela de conversão
  spendDescoberta: number; // parcela de descoberta
  leads: number;
  cpl: number; // FIEL: gasto de conversão ÷ leads de conversão
  cplBlended: number; // gasto total ÷ leads (legado, para referência)
  meetings: number;
  attended: number;
  cpr: number; // FIEL (North Star): gasto de conversão ÷ reuniões de conversão
  cprBlended: number; // gasto total ÷ reuniões (legado, para referência)
  ctr: number;
  clicks: number;
  impressions: number;
  leadToMeeting: number; // ratio
  showRate: number; // compareceu / booked
  hasDiscovery: boolean; // há orçamento de descoberta no período?
  organicLeads: number; // leads orgânicos/diretos (fora do CPL/CPR pago)
  // ---- do lead à receita (Fase 3) ----
  clients: number; // leads que viraram cliente
  revenue: number; // receita atribuída (soma do valor das cartas)
  cac: number; // custo de aquisição = gasto de conversão ÷ clientes
  roas: number; // receita ÷ gasto total
  ticket: number; // ticket médio = receita ÷ clientes
  valuePerMeeting: number; // receita ÷ reuniões
  meetingToClient: number; // clientes ÷ reuniões
}

export function overviewKpis(data: DashboardData, range?: DateRange): OverviewKpis {
  const ads = filterAds(data.adDaily, range);
  const leads = filterLeads(data.leads, range);
  const k = adKpis(ads);
  const meetings = countMeetings(leads);
  const attended = countAttended(leads);
  const obj = objectiveBreakdown(data, range);
  const clients = countClients(leads);
  const revenue = sumRevenue(leads);
  return {
    spend: k.spend,
    spendConversao: obj.conversao.spend,
    spendDescoberta: obj.descoberta.spend,
    leads: leads.length,
    cpl: obj.conversao.cpl,
    cplBlended: div(k.spend, leads.length),
    meetings,
    attended,
    cpr: obj.conversao.cpr,
    cprBlended: cpr(k.spend, meetings),
    ctr: k.ctr,
    clicks: k.clicks,
    impressions: k.impressions,
    leadToMeeting: div(meetings, leads.length),
    showRate: div(attended, meetings),
    hasDiscovery: obj.hasDiscovery,
    organicLeads: obj.organicLeads,
    clients,
    revenue,
    cac: div(obj.conversao.spend, clients),
    roas: div(revenue, k.spend),
    ticket: div(revenue, clients),
    valuePerMeeting: div(revenue, meetings),
    meetingToClient: div(clients, meetings),
  };
}

// ---- time series ----------------------------------------------------

export interface DailyPoint {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl: number;
}

export function dailySeries(data: DashboardData, range?: DateRange): DailyPoint[] {
  const ads = filterAds(data.adDaily, range);
  const byDate = new Map<string, DailyPoint>();
  for (const r of ads) {
    const p =
      byDate.get(r.date) ??
      { date: r.date, spend: 0, impressions: 0, clicks: 0, leads: 0, cpl: 0 };
    p.spend += r.spend;
    p.impressions += r.impressions;
    p.clicks += r.clicks;
    p.leads += r.leads;
    byDate.set(r.date, p);
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({ ...p, cpl: div(p.spend, p.leads) }));
}

export interface FollowerPoint {
  date: string;
  followers: number;
  gain: number;
  reach: number;
  views: number;
}

export function followerSeries(rows: IgAccountDaily[], range?: DateRange): FollowerPoint[] {
  const sorted = [...rows]
    .filter((r) => inRange(r.date, range))
    .sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((r, i) => ({
    date: r.date,
    followers: r.followers,
    gain: i === 0 ? 0 : r.followers - sorted[i - 1].followers,
    reach: r.reach,
    views: r.views,
  }));
}

// ---- fadiga de criativo --------------------------------------------

export type FatigueLevel = "novo" | "saudavel" | "atencao" | "fadigado";

export interface Fatigue {
  level: FatigueLevel;
  frequency: number; // frequência média/dia recente
  reason: string; // por que está fadigando (ou "amostra insuficiente")
}

/**
 * Sinal de fadiga por anúncio: compara os ~3 dias mais recentes com os 3 dias
 * anteriores. CTR caindo + CPL subindo + frequência alta = criativo queimando —
 * renove ANTES do CPR subir (o alerta oficial da Meta só vem quando o custo já
 * dobrou). Puro: usa as últimas datas presentes no próprio anúncio.
 */
export function computeFatigue(rows: AdDaily[]): Fatigue {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const recent = sorted.slice(-3);
  const prior = sorted.slice(-6, -3);
  const agg = (rs: AdDaily[]) => {
    const spend = rs.reduce((s, r) => s + r.spend, 0);
    const impr = rs.reduce((s, r) => s + r.impressions, 0);
    const clicks = rs.reduce((s, r) => s + r.clicks, 0);
    const leadCount = rs.reduce((s, r) => s + r.leads, 0);
    const freq = rs.length ? rs.reduce((s, r) => s + r.frequency, 0) / rs.length : 0;
    return { ctr: div(clicks, impr), cpl: div(spend, leadCount), freq, impr };
  };
  const r = agg(recent);
  const p = agg(prior);
  if (recent.length < 2 || prior.length < 2 || r.impr < 500) {
    return { level: "novo", frequency: r.freq, reason: "amostra insuficiente" };
  }
  const ctrDown = p.ctr > 0 && r.ctr < p.ctr * 0.85;
  const cplUp = p.cpl > 0 && r.cpl > p.cpl * 1.25;
  const freqHigh = r.freq >= 1.8;
  const reasons: string[] = [];
  if (ctrDown) reasons.push("CTR caindo");
  if (cplUp) reasons.push("CPL subindo");
  if (freqHigh) reasons.push(`frequência ${formatFreq(r.freq)}`);
  const flags = [ctrDown, cplUp, freqHigh].filter(Boolean).length;
  const level: FatigueLevel = flags >= 2 ? "fadigado" : flags === 1 ? "atencao" : "saudavel";
  return {
    level,
    frequency: r.freq,
    reason: reasons.length ? reasons.join(" · ") : "estável",
  };
}

const formatFreq = (n: number) => n.toFixed(1).replace(".", ",");

// ---- per-creative ---------------------------------------------------

export interface CreativePerf {
  adId: string;
  name: string;
  format: Creative["format"];
  adset: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  meetings: number;
  clients: number; // reuniões que viraram cliente
  revenue: number; // receita atribuída ao criativo
  cac: number; // gasto ÷ clientes
  ctr: number;
  cpc: number;
  cpl: number;
  cpr: number;
  fatigue: Fatigue;
  hookRate?: number; // 3s plays / impressions (gancho: prende no 1º instante?)
  thruPlayRate?: number; // thruplays / impressions
  holdRate?: number; // thruPlays / 3s plays (retenção: segura quem começou a ver?)
}

export function creativePerformance(
  data: DashboardData,
  range?: DateRange,
): CreativePerf[] {
  const ads = filterAds(data.adDaily, range);
  const leads = filterLeads(data.leads, range);
  const byAd = new Map<string, AdDaily[]>();
  for (const r of ads) {
    const list = byAd.get(r.adId) ?? [];
    list.push(r);
    byAd.set(r.adId, list);
  }

  // Fadiga usa os dias recentes ABSOLUTOS (independe do range selecionado).
  const allByAd = new Map<string, AdDaily[]>();
  for (const r of data.adDaily) {
    const list = allByAd.get(r.adId) ?? [];
    list.push(r);
    allByAd.set(r.adId, list);
  }

  // Atribui reuniões/clientes/receita ao criativo pelo id do anúncio embutido no
  // utm_content (ou pelo utm_content cru, quando ele já é o adId, ex. seed).
  const meetingsByAd = new Map<string, number>();
  const clientsByAd = new Map<string, number>();
  const revenueByAd = new Map<string, number>();
  for (const l of leads) {
    const key = leadAdKey(l);
    if (!key) continue;
    if (isBooked(l)) meetingsByAd.set(key, (meetingsByAd.get(key) ?? 0) + 1);
    if (isClient(l)) {
      clientsByAd.set(key, (clientsByAd.get(key) ?? 0) + 1);
      revenueByAd.set(key, (revenueByAd.get(key) ?? 0) + (l.value ?? 0));
    }
  }

  const result: CreativePerf[] = [];
  for (const creative of data.creatives) {
    const rows = byAd.get(creative.adId) ?? [];
    if (rows.length === 0 && !range) {
      // keep creatives with no rows out of the table entirely
    }
    const k = adKpis(rows);
    const meetings = meetingsByAd.get(creative.adId) ?? 0;
    const clients = clientsByAd.get(creative.adId) ?? 0;
    const revenue = revenueByAd.get(creative.adId) ?? 0;
    const adset = rows[0]?.adset ?? "—";
    result.push({
      adId: creative.adId,
      name: creative.name,
      format: creative.format,
      adset,
      spend: k.spend,
      impressions: k.impressions,
      clicks: k.clicks,
      leads: k.leads,
      meetings,
      clients,
      revenue,
      cac: div(k.spend, clients),
      ctr: k.ctr,
      cpc: k.cpc,
      cpl: k.cpl,
      cpr: div(k.spend, meetings),
      fatigue: computeFatigue(allByAd.get(creative.adId) ?? []),
      hookRate: creative.videoPlays ? div(creative.videoPlays, k.impressions) : undefined,
      thruPlayRate: creative.thruPlays ? div(creative.thruPlays, k.impressions) : undefined,
      holdRate: creative.videoPlays ? div(creative.thruPlays ?? 0, creative.videoPlays) : undefined,
    });
  }
  return result
    .filter((c) => c.spend > 0)
    .sort((a, b) => b.spend - a.spend);
}

// ---- per-adset / per-campaign --------------------------------------

export interface GroupPerf {
  key: string;
  bucket: ObjectiveBucket; // balde dominante (por gasto) do grupo
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  ctr: number;
  cpl: number;
}

/** Balde de objetivo dominante (por gasto) de um conjunto de linhas. */
function dominantBucket(rows: AdDaily[]): ObjectiveBucket {
  let conv = 0;
  let disc = 0;
  for (const r of rows) {
    if (bucketOfAd(r) === "descoberta") disc += r.spend;
    else conv += r.spend;
  }
  return disc > conv ? "descoberta" : "conversao";
}

export function groupBy(
  rows: AdDaily[],
  pick: (r: AdDaily) => string,
): GroupPerf[] {
  const map = new Map<string, AdDaily[]>();
  for (const r of rows) {
    const key = pick(r);
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([key, list]) => {
      const k = adKpis(list);
      return {
        key,
        bucket: dominantBucket(list),
        spend: k.spend,
        impressions: k.impressions,
        clicks: k.clicks,
        leads: k.leads,
        ctr: k.ctr,
        cpl: k.cpl,
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

// ---- per-adset (com reuniões e CPR reais) --------------------------

export interface AdsetPerf {
  adset: string;
  bucket: ObjectiveBucket;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number; // pixel (AdDaily.leads) — número completo por conjunto
  meetings: number; // atribuídas pelo id do anúncio → conjunto
  clients: number;
  revenue: number;
  ctr: number;
  cpl: number; // spend / leads
  cpr: number; // spend / meetings (custo por reunião do conjunto)
}

/**
 * Desempenho por conjunto com REUNIÕES e CPR — a decisão de budget deve olhar o
 * custo por reunião, não só por lead. Reuniões vêm da lista de leads, atribuídas
 * ao conjunto pelo id do anúncio no utm_content.
 */
export function adsetPerformance(data: DashboardData, range?: DateRange): AdsetPerf[] {
  const ads = filterAds(data.adDaily, range);
  const leads = filterLeads(data.leads, range);

  const adToAdset = new Map<string, string>();
  for (const r of ads) if (!adToAdset.has(r.adId)) adToAdset.set(r.adId, r.adset);

  const byAdset = new Map<string, AdDaily[]>();
  for (const r of ads) {
    const list = byAdset.get(r.adset) ?? [];
    list.push(r);
    byAdset.set(r.adset, list);
  }

  const meetingsByAdset = new Map<string, number>();
  const clientsByAdset = new Map<string, number>();
  const revenueByAdset = new Map<string, number>();
  for (const l of leads) {
    const adId = leadAdKey(l);
    const adset = adId ? adToAdset.get(adId) : undefined;
    if (!adset) continue;
    if (isBooked(l)) meetingsByAdset.set(adset, (meetingsByAdset.get(adset) ?? 0) + 1);
    if (isClient(l)) {
      clientsByAdset.set(adset, (clientsByAdset.get(adset) ?? 0) + 1);
      revenueByAdset.set(adset, (revenueByAdset.get(adset) ?? 0) + (l.value ?? 0));
    }
  }

  return [...byAdset.entries()]
    .map(([adset, list]) => {
      const k = adKpis(list);
      const meetings = meetingsByAdset.get(adset) ?? 0;
      return {
        adset,
        bucket: dominantBucket(list),
        spend: k.spend,
        impressions: k.impressions,
        clicks: k.clicks,
        leads: k.leads,
        meetings,
        clients: clientsByAdset.get(adset) ?? 0,
        revenue: revenueByAdset.get(adset) ?? 0,
        ctr: k.ctr,
        cpl: k.cpl,
        cpr: div(k.spend, meetings),
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

// ---- pacing do orçamento da campanha -------------------------------

export type PacingStatus = "sub" | "on" | "over" | "unknown";

export interface CampaignPacing {
  spent: number;
  budget: number;
  pct: number; // consumido 0–1
  runRatePerDay: number;
  daysElapsed: number;
  daysTotal?: number;
  daysLeft?: number;
  projectedSpend?: number; // gasto projetado até o fim, no ritmo atual
  status: PacingStatus; // vs orçamento planejado até o fim
  exhaustInDays?: number; // dias até esgotar o orçamento no ritmo atual
}

const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b.slice(0, 10) + "T00:00:00Z").getTime() - new Date(a.slice(0, 10) + "T00:00:00Z").getTime()) / 86_400_000);

/** Ritmo de gasto vs orçamento/tempo da campanha. `nowIso` torna a função pura. */
export function campaignPacing(data: DashboardData, nowIso: string): CampaignPacing {
  const c = data.campaign;
  const spent = data.adDaily.reduce((s, r) => s + r.spend, 0);
  const budget = c.budgetTotal;
  const today = nowIso.slice(0, 10);
  const daysElapsed = Math.max(1, daysBetween(c.startDate || today, today) + 1);
  const runRatePerDay = spent / daysElapsed;
  const pct = budget > 0 ? spent / budget : 0;

  const out: CampaignPacing = { spent, budget, pct, runRatePerDay, daysElapsed, status: "unknown" };

  if (runRatePerDay > 0 && budget > 0) {
    out.exhaustInDays = Math.max(0, Math.round((budget - spent) / runRatePerDay));
  }
  if (c.endDate) {
    const daysTotal = Math.max(1, daysBetween(c.startDate || today, c.endDate) + 1);
    out.daysTotal = daysTotal;
    out.daysLeft = Math.max(0, daysBetween(today, c.endDate));
    const projected = runRatePerDay * daysTotal;
    out.projectedSpend = projected;
    if (budget > 0) {
      out.status = projected > budget * 1.1 ? "over" : projected < budget * 0.9 ? "sub" : "on";
    }
  }
  return out;
}

/** Projeção linear de um valor acumulado do período inteiro pelo ritmo até agora. */
export function projectLinear(current: number, elapsedDays: number, totalDays: number): number {
  if (elapsedDays <= 0) return current;
  return (current / elapsedDays) * totalDays;
}

// ---- coorte semanal do funil ---------------------------------------

export interface Cohort {
  week: string; // yyyy-mm-dd da segunda-feira
  label: string; // "dd/mm"
  leads: number;
  meetings: number;
  attended: number;
  clients: number;
  revenue: number;
  leadToMeeting: number;
  immature: boolean; // coorte recente ainda maturando (não comparar direto)
}

/** Segunda-feira (UTC) da semana de uma data ISO. */
function weekStart(iso: string): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * Funil por semana de ENTRADA do lead. Ler conversão sem misturar coortes novas
 * (ainda maturando) com maduras — e comparar se a qualidade melhora semana a semana.
 */
export function cohortWeekly(
  data: DashboardData,
  range: DateRange | undefined,
  nowIso: string,
): Cohort[] {
  const leads = filterLeads(data.leads, range);
  const byWeek = new Map<string, Lead[]>();
  for (const l of leads) {
    const w = weekStart(l.createdAt);
    const list = byWeek.get(w) ?? [];
    list.push(l);
    byWeek.set(w, list);
  }
  const nowMs = new Date(nowIso).getTime();
  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, ls]) => {
      const meetings = countMeetings(ls);
      const startMs = new Date(week + "T00:00:00Z").getTime();
      return {
        week,
        label: `${week.slice(8, 10)}/${week.slice(5, 7)}`,
        leads: ls.length,
        meetings,
        attended: countAttended(ls),
        clients: countClients(ls),
        revenue: sumRevenue(ls),
        leadToMeeting: div(meetings, ls.length),
        immature: nowMs - startMs < 7 * 86_400_000,
      };
    });
}

// ---- posts ----------------------------------------------------------

export function postEngagementRate(p: IgPost): number {
  return div(p.likes + p.comments + p.saved + p.shares, p.reach);
}

// ---- CTA da legenda -------------------------------------------------

export const CTA_LABEL: Record<CtaType, string> = {
  dm: "DM",
  comentario: "Comentário",
  salvamento: "Salvamento",
  marcacao: "Marcação",
  outro: "Outro",
};

/**
 * Classifica o CTA pedido na legenda por heurística de texto. Ordem: DM (o CTA
 * de maior atrito, que o diagnóstico manda racionar) tem precedência, depois os
 * de baixo atrito. Sem match, undefined (post sem CTA claro).
 */
export function detectCta(caption: string): CtaType | undefined {
  const c = caption.toLowerCase();
  if (/\b(dm|direct)\b|me chama|chama (no|na|aqui)|manda (uma )?mensagem|fale comigo/.test(c))
    return "dm";
  // "comenta/comente" imperativo, ou menção com contexto de CTA ("nos comentários");
  // o substantivo solto ("os comentários dizem…") não conta.
  if (/\bcoment[ae]\b|nos coment[áa]rios|responde aqui|deixa (seu|sua) coment|escreve aqui/.test(c))
    return "comentario";
  // exige complemento ("salva esse/pra depois") — "Salve, investidor!" (saudação)
  // e "salvação" não são CTA (\b é ASCII: o "ç" cria fronteira falsa).
  if (/salv[ae] (ess[ae]|est[ae]|o post|o v[íi]deo|o conte[úu]do|a[íi]|aqui|pra|para|depois)|guarda (ess[ae]|est[ae]|a[íi])/.test(c))
    return "salvamento";
  // exige marcação DE ALGUÉM — "a marca Krone" (substantivo) e "marque uma
  // reunião" (agendamento → "outro") não são marcação.
  if (/\bmarc(?:a|que) (quem|um amigo|uma amiga|algu[ée]m|aqui|nos coment)/.test(c))
    return "marcacao";
  if (/link na bio|toca no link|clica no link|agend[ae]|\bmarque\b.*\b(reuni[ãa]o|convers|hor[áa]rio)|acesse/.test(c))
    return "outro";
  return undefined;
}

/** CTA efetivo do post: override manual quando existe, senão a heurística. */
export function ctaOf(p: IgPost): CtaType | undefined {
  return p.ctaType ?? detectCta(p.caption);
}

/**
 * Retenção real do reel = tempo médio assistido ÷ duração do vídeo.
 * `null` quando não dá para calcular (não é reel, sem watch time, ou sem a
 * duração — que é entrada manual; a API não a fornece).
 */
export function reelRetention(p: IgPost): number | null {
  if (p.type !== "reel" || p.avgWatchTime == null || !p.durationSec || p.durationSec <= 0)
    return null;
  return Math.min(1, p.avgWatchTime / p.durationSec);
}

export interface PostPerf extends IgPost {
  interactions: number;
  engagementRate: number;
  /** salvamentos por mil views — o sinal nº1 de valor p/ o algoritmo em conteúdo educacional */
  savesPer1k: number;
  /** interações ÷ views — engajamento de quem realmente viu */
  interactionsPerView: number;
  /** alcance ÷ seguidores na data da publicação — quanto da própria base o post ativou */
  reachOnBase?: number;
  /** retenção real (0–1): avgWatchTime ÷ durationSec — só com a duração manual */
  retention?: number;
  /** CTA efetivo (override manual ou heurística da legenda) */
  cta?: CtaType;
  /** post IMPULSIONADO: um criativo de anúncio aponta para esta mídia — as
   *  métricas do post podem incluir entrega paga (fora dos agregados orgânicos) */
  boosted?: boolean;
}

/**
 * `igDaily` (opcional) habilita `reachOnBase`: usa o snapshot de seguidores do
 * dia da publicação (ou o último anterior) como denominador.
 * `creatives` (opcional) habilita `boosted`: post cuja mídia aparece em um
 * criativo de anúncio (match por effective_instagram_media_id, com o permalink
 * como fallback — o id pode divergir entre superfícies da API).
 * Posts de TESTE entram na lista (flagados) — quem agrega/rankeia os exclui.
 */
export function postPerformance(
  posts: IgPost[],
  range?: DateRange,
  igDaily?: IgAccountDaily[],
  creatives?: Creative[],
): PostPerf[] {
  const boostedIds = new Set<string>();
  const boostedPermalinks = new Set<string>();
  for (const c of creatives ?? []) {
    if (c.instagramMediaId) boostedIds.add(c.instagramMediaId);
    if (c.instagramPermalink) boostedPermalinks.add(c.instagramPermalink);
  }
  const daily = igDaily ? [...igDaily].sort((a, b) => a.date.localeCompare(b.date)) : [];
  const followersAt = (day: string): number | undefined => {
    let found: number | undefined;
    for (const r of daily) {
      if (r.date > day) break;
      found = r.followers;
    }
    // Sem snapshot até o dia do post: undefined ("—" na UI) — usar a base de uma
    // data futura subestimaria o alcance sobre a base de posts antigos.
    return found;
  };
  return posts
    .filter((p) => inRange(dayOf(p.publishedAt), range))
    .map((p) => {
      const interactions = p.likes + p.comments + p.saved + p.shares;
      const base = followersAt(dayOf(p.publishedAt));
      return {
        ...p,
        interactions,
        engagementRate: postEngagementRate(p),
        savesPer1k: div(p.saved, p.views) * 1000,
        interactionsPerView: div(interactions, p.views),
        reachOnBase: base && base > 0 ? p.reach / base : undefined,
        retention: reelRetention(p) ?? undefined,
        cta: ctaOf(p),
        boosted:
          boostedIds.has(p.id) || (p.permalink !== "" && boostedPermalinks.has(p.permalink))
            ? true
            : undefined,
      };
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

// ---- posts: agregado do período ------------------------------------

export interface PostAggregate {
  count: number;
  reach: number;
  avgReach: number;
  avgEr: number; // média das taxas de engajamento por post
  /** Σ salvos ÷ Σ views × 1000 — POOLED: posts com mais views pesam mais
   *  (a coluna "Salvos/1k" da tabela é por post; aqui é o agregado da janela) */
  savesPer1k: number;
  sharesPerPost: number;
  commentsPerPost: number;
  /** média do alcance/base dos posts com snapshot de seguidores disponível */
  avgReachOnBase?: number;
  /** média do tempo assistido dos reels (segundos) */
  avgWatchTime?: number;
  /** retenção média real (0–1) dos reels COM duração manual preenchida */
  avgRetention?: number;
  /** fração dos posts do período pedindo DM — o diagnóstico manda ≤ 1 a cada 4 */
  dmCtaShare: number;
}

export function aggregatePostPerformance(input: PostPerf[]): PostAggregate {
  // Análise ORGÂNICA: posts de teste (validação de gancho) e impulsionados
  // (entrega paga misturada) ficam fora — é exatamente a leitura enganosa
  // que o diagnóstico mandou matar.
  const list = input.filter((p) => !p.isTest && !p.boosted);
  const reach = list.reduce((s, p) => s + p.reach, 0);
  const views = list.reduce((s, p) => s + p.views, 0);
  const saved = list.reduce((s, p) => s + p.saved, 0);
  const shares = list.reduce((s, p) => s + p.shares, 0);
  const comments = list.reduce((s, p) => s + p.comments, 0);
  const n = list.length;
  const withBase = list.filter((p) => p.reachOnBase != null);
  const reels = list.filter((p) => p.type === "reel" && p.avgWatchTime != null);
  return {
    count: n,
    reach,
    avgReach: div(reach, n),
    avgEr: div(
      list.reduce((s, p) => s + p.engagementRate, 0),
      n,
    ),
    savesPer1k: div(saved, views) * 1000,
    sharesPerPost: div(shares, n),
    commentsPerPost: div(comments, n),
    avgReachOnBase: withBase.length
      ? div(
          withBase.reduce((s, p) => s + (p.reachOnBase ?? 0), 0),
          withBase.length,
        )
      : undefined,
    avgWatchTime: reels.length
      ? div(
          reels.reduce((s, p) => s + (p.avgWatchTime ?? 0), 0),
          reels.length,
        )
      : undefined,
    avgRetention: (() => {
      const withRet = list.filter((p) => p.retention != null);
      return withRet.length
        ? div(
            withRet.reduce((s, p) => s + (p.retention ?? 0), 0),
            withRet.length,
          )
        : undefined;
    })(),
    dmCtaShare: div(list.filter((p) => p.cta === "dm").length, n),
  };
}

/** Distribuição de CTA dos posts (para ver o excesso de "me chama na DM"). */
export function ctaDistribution(
  list: PostPerf[],
): { cta: CtaType | "nenhum"; label: string; count: number }[] {
  const counts = new Map<CtaType | "nenhum", number>();
  for (const p of list) {
    const key = p.cta ?? "nenhum";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([cta, count]) => ({
      cta,
      label: cta === "nenhum" ? "Sem CTA" : CTA_LABEL[cta],
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

// ---- posts: performance por pilar/série ----------------------------

export interface PillarPerf {
  pillar: string;
  count: number;
  avgReach: number;
  avgEngagement: number;
  saveRate: number; // Σ salvos ÷ Σ alcance
  sampleOk: boolean;
}

/** Compara os pilares/séries taggeados manualmente (posts sem tag ficam fora). */
export function pillarPerformance(posts: IgPost[], range?: DateRange): PillarPerf[] {
  const byPillar = new Map<string, IgPost[]>();
  for (const p of posts.filter(
    (p) => p.pillar && !p.isTest && inRange(dayOf(p.publishedAt), range),
  )) {
    const list = byPillar.get(p.pillar!) ?? [];
    list.push(p);
    byPillar.set(p.pillar!, list);
  }
  return [...byPillar.entries()]
    .map(([pillar, list]) => {
      const n = list.length;
      const totReach = list.reduce((s, p) => s + p.reach, 0);
      return {
        pillar,
        count: n,
        avgReach: div(totReach, n),
        avgEngagement: div(
          list.reduce((s, p) => s + postEngagementRate(p), 0),
          n,
        ),
        saveRate: div(
          list.reduce((s, p) => s + p.saved, 0),
          totReach,
        ),
        sampleOk: n >= MIN_SAMPLE_POSTS,
      };
    })
    .sort((a, b) => b.avgEngagement - a.avgEngagement);
}

// ---- reels: tendência de retenção ----------------------------------

export interface ReelWatchPoint {
  /** ISO completo da publicação — único por reel (dois reels no mesmo dia não
   *  podem dividir a categoria do eixo X, senão o chart colapsa os pontos). */
  date: string;
  caption: string;
  avgWatchTime: number; // segundos
  movingAvg: number; // média móvel dos últimos 3 reels (inclusive)
}

/**
 * Série de tempo médio assistido por reel, em ordem de publicação, com média
 * móvel — responde "a retenção está subindo?" mesmo sem a duração do vídeo
 * (a API não fornece duração; retenção percentual entra com dado manual).
 */
export function reelWatchSeries(posts: IgPost[], range?: DateRange): ReelWatchPoint[] {
  const reels = posts
    .filter(
      (p) =>
        p.type === "reel" &&
        !p.isTest &&
        p.avgWatchTime != null &&
        inRange(dayOf(p.publishedAt), range),
    )
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  return reels.map((p, i) => {
    const window = reels.slice(Math.max(0, i - 2), i + 1);
    return {
      date: p.publishedAt,
      caption: p.caption,
      avgWatchTime: p.avgWatchTime ?? 0,
      movingAvg: div(
        window.reduce((s, r) => s + (r.avgWatchTime ?? 0), 0),
        window.length,
      ),
    };
  });
}

// ---- cadência de publicação ----------------------------------------

export interface PostingCadence {
  count: number;
  days: number; // extensão da janela analisada (inclusiva)
  postsPerWeek: number;
  maxGapDays: number; // maior buraco entre publicações consecutivas
  daysSinceLast: number; // dias desde o último post até `nowIso`
  /** máximo de posts num mesmo dia — 2+ já é canibalização (competem entre si) */
  maxSameDay: number;
  busiestDay?: string; // yyyy-mm-dd do dia com mais posts
  /** quantos DIAS da janela tiveram 2+ peças (o guia proíbe qualquer um) */
  daysWithPileup: number;
  /** composição por formato, normalizada por semana — o guia pede 4 reels + 2 carrosséis */
  reelsPerWeek: number;
  carrosseisPerWeek: number;
}

/**
 * Consistência de publicação da janela. `nowIso` como parâmetro mantém a função
 * pura (mesmo padrão de campaignPacing/leadQueue). Sem range, usa o intervalo
 * entre o primeiro e o último post.
 */
export function postingCadence(
  posts: IgPost[],
  range: DateRange | undefined,
  nowIso: string,
): PostingCadence {
  // Cadência conta TODO post publicado (inclusive testes): mede o ritmo físico
  // da grade — a exclusão de teste vale para performance, não para frequência.
  const sorted = posts
    .filter((p) => inRange(dayOf(p.publishedAt), range))
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  const first = sorted[0] ? dayOf(sorted[0].publishedAt) : undefined;
  const last = sorted.at(-1) ? dayOf(sorted.at(-1)!.publishedAt) : undefined;
  const from = range?.from ?? first;
  // Sem range, a janela vai até HOJE (não até o último post) — senão uma grade
  // parada há 30 dias ainda pareceria ter a cadência da época em que postava.
  const nowDay = nowIso.slice(0, 10);
  const to = range?.to ?? (last && nowDay > last ? nowDay : last);
  const days = from && to ? daysBetween(from, to) + 1 : 0;

  let maxGapDays = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = daysBetween(dayOf(sorted[i - 1].publishedAt), dayOf(sorted[i].publishedAt));
    if (gap > maxGapDays) maxGapDays = gap;
  }

  const byDay = new Map<string, number>();
  for (const p of sorted) {
    const d = dayOf(p.publishedAt);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  let maxSameDay = 0;
  let busiestDay: string | undefined;
  let daysWithPileup = 0;
  for (const [d, n] of byDay) {
    if (n > maxSameDay) {
      maxSameDay = n;
      busiestDay = d;
    }
    if (n >= 2) daysWithPileup += 1;
  }

  // janela mínima de 7 dias: 1 post num dia só não vira "7 posts/semana"
  const weeks = Math.max(days, 7) / 7;
  const daysSinceLast = last ? Math.max(0, daysBetween(last, nowDay)) : 0;
  return {
    count: sorted.length,
    days,
    postsPerWeek: div(sorted.length, weeks),
    maxGapDays,
    daysSinceLast,
    maxSameDay,
    busiestDay,
    daysWithPileup,
    reelsPerWeek: div(sorted.filter((p) => p.type === "reel").length, weeks),
    carrosseisPerWeek: div(sorted.filter((p) => p.type === "carrossel").length, weeks),
  };
}

// ---- instagram: account totals (period-over-period ready) ----------

export interface IgAccountTotals {
  followersEnd: number;
  followersStart: number;
  netNew: number;
  reach: number;
  views: number;
  interactions: number;
  profileLinkTaps: number;
  profileViews: number;
  accountsEngaged: number;
  engagementRate: number; // interactions / reach
  linkTapRate: number; // profile link taps / profile views
  reachFollowers: number;
  reachNonFollowers: number;
  discoveryRate: number; // non-follower reach / total split reach
  hasReachSplit: boolean; // whether the follow_type breakdown was available
  days: number; // dias com dado na janela
  /** alcance médio diário ÷ base de seguidores — perfis saudáveis: 30–60%/dia */
  reachRateOnBase: number;
  /** interações médias diárias ÷ base de seguidores — "a base está esquentando?"
   *  Normalizado por dia (como reachRateOnBase) p/ não crescer com a janela. */
  engagementOnBase: number;
  /** conversas de DM iniciadas no período (registro manual; 0 se nunca preenchido) */
  dmConversations: number;
  /** algum dia da janela tem registro manual de DMs? (sem isso, 0 = "sem dado") */
  hasDmData: boolean;
  /** crescimento BRUTO no período (follows_and_unfollows): ganho vs churn */
  followsTotal: number;
  unfollowsTotal: number;
  hasFollowSplit: boolean;
  /** cliques na bio por destino (breakdown contact_button_type) */
  linkTapsWebsite: number;
  linkTapsWhatsApp: number;
  hasLinkTapSplit: boolean;
}

/** Sum an Instagram account window, reusable for the current and previous period. */
export function igAccountTotals(rows: IgAccountDaily[], range?: DateRange): IgAccountTotals {
  const sorted = [...rows]
    .filter((r) => inRange(r.date, range))
    .sort((a, b) => a.date.localeCompare(b.date));
  const sum = (pick: (r: IgAccountDaily) => number) => sorted.reduce((s, r) => s + pick(r), 0);
  const reach = sum((r) => r.reach);
  const interactions = sum((r) => r.totalInteractions);
  const profileLinkTaps = sum((r) => r.profileLinkTaps);
  const profileViews = sum((r) => r.profileViews ?? 0);
  /**
   * Split de alcance seguidor/não-seguidor: só entram os dias com AS DUAS
   * dimensões. A Meta OMITE a dimensão quando o valor é zero ou pequeno demais
   * para expor (o log de produção mostrou rodadas devolvendo só NON_FOLLOWER);
   * somar o lado ausente como 0 faria a taxa de descoberta virar 100% — uma
   * afirmação forte tirada de um dado que não temos. Sem par completo, o painel
   * declara "sem dado" via `hasReachSplit: false`.
   */
  const diasComSplit = sorted.filter(
    (r) => r.reachFollowers != null && r.reachNonFollowers != null,
  );
  const reachFollowers = diasComSplit.reduce((s, r) => s + (r.reachFollowers ?? 0), 0);
  const reachNonFollowers = diasComSplit.reduce((s, r) => s + (r.reachNonFollowers ?? 0), 0);
  const hasReachSplit = diasComSplit.length > 0;
  // Mesmo critério para os outros dois breakdowns da Meta.
  const diasComFollowSplit = sorted.filter(
    (r) => r.followsDay != null && r.unfollowsDay != null,
  );
  const diasComLinkSplit = sorted.filter(
    (r) => r.linkTapsWebsite != null && r.linkTapsWhatsApp != null,
  );
  const followersEnd = sorted.at(-1)?.followers ?? 0;
  const followersStart = sorted[0]?.followers ?? 0;
  const days = sorted.length;
  return {
    followersEnd,
    followersStart,
    netNew: followersEnd - followersStart,
    reach,
    views: sum((r) => r.views),
    interactions,
    profileLinkTaps,
    profileViews,
    accountsEngaged: sum((r) => r.accountsEngaged),
    engagementRate: div(interactions, reach),
    linkTapRate: div(profileLinkTaps, profileViews),
    reachFollowers,
    reachNonFollowers,
    discoveryRate: div(reachNonFollowers, reachFollowers + reachNonFollowers),
    hasReachSplit,
    days,
    reachRateOnBase: div(div(reach, days), followersEnd),
    engagementOnBase: div(div(interactions, days), followersEnd),
    dmConversations: sum((r) => r.dmConversations ?? 0),
    hasDmData: sorted.some((r) => r.dmConversations != null),
    // Mesma regra dos dias com split: sem os dois lados, "0 deixaram de seguir"
    // seria uma afirmação inventada a partir de dimensão omitida pela Meta.
    followsTotal: diasComFollowSplit.reduce((s, r) => s + (r.followsDay ?? 0), 0),
    unfollowsTotal: diasComFollowSplit.reduce((s, r) => s + (r.unfollowsDay ?? 0), 0),
    hasFollowSplit: diasComFollowSplit.length > 0,
    linkTapsWebsite: diasComLinkSplit.reduce((s, r) => s + (r.linkTapsWebsite ?? 0), 0),
    linkTapsWhatsApp: diasComLinkSplit.reduce((s, r) => s + (r.linkTapsWhatsApp ?? 0), 0),
    hasLinkTapSplit: diasComLinkSplit.length > 0,
  };
}

// ---- conversas de DM por semana ------------------------------------

export interface DmWeekPoint {
  week: string; // yyyy-mm-dd da segunda-feira
  label: string; // "dd/mm"
  conversations: number;
}

/** Conversas de DM (registro manual) somadas por semana ISO. */
export function weeklyDmSeries(rows: IgAccountDaily[], range?: DateRange): DmWeekPoint[] {
  const byWeek = new Map<string, number>();
  for (const r of rows.filter((r) => inRange(r.date, range))) {
    if (r.dmConversations == null) continue;
    const w = weekStart(r.date);
    byWeek.set(w, (byWeek.get(w) ?? 0) + r.dmConversations);
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, conversations]) => ({
      week,
      label: `${week.slice(8, 10)}/${week.slice(5, 7)}`,
      conversations,
    }));
}

// ---- instagram: série diária orgânica ------------------------------

export interface IgDailyPoint {
  date: string;
  reach: number;
  views: number;
  interactions: number;
  profileViews: number;
  linkTaps: number;
  engagementRate: number; // interações ÷ alcance do dia
  /** interações ÷ seguidores do dia — tendência de aquecimento da base */
  warmth: number;
}

/** Série diária p/ tendência de engajamento e do funil de perfil (orgânico). */
export function igEngagementSeries(rows: IgAccountDaily[], range?: DateRange): IgDailyPoint[] {
  return [...rows]
    .filter((r) => inRange(r.date, range))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({
      date: r.date,
      reach: r.reach,
      views: r.views,
      interactions: r.totalInteractions,
      profileViews: r.profileViews,
      linkTaps: r.profileLinkTaps,
      engagementRate: div(r.totalInteractions, r.reach),
      warmth: div(r.totalInteractions, r.followers),
    }));
}

// ---- awareness: North Star de marca de seguidores ------------------

/**
 * Pacote de KPIs para marcas do tipo `awareness` (krone.capital) — campanhas de
 * ganho de seguidores, sem funil de lead. A North Star aqui é o CUSTO POR
 * SEGUIDOR e o CUSTO POR 1K ALCANCE, não o CPR. Como todo o gasto pago de uma
 * marca awareness é para crescimento, casamos o gasto total do período com o
 * ganho líquido de seguidores da própria conta.
 *
 * `costPerFollower`/`costPerReach` são `null` (não 0) quando o denominador é 0 —
 * para a UI exibir "—" em vez de "R$ 0,00" (que se lê como "de graça").
 * Pressupõe `data` JÁ recortado por marca (via getData(brand)).
 */
export interface AwarenessKpis {
  spend: number; // gasto pago no período (todo para crescimento)
  followersEnd: number;
  netNewFollowers: number; // seguidores líquidos ganhos no período
  costPerFollower: number | null; // spend ÷ seguidores ganhos
  reach: number;
  costPerReach: number | null; // spend ÷ alcance × 1000 (custo por mil)
  views: number;
  interactions: number;
  engagementRate: number; // interações ÷ alcance
  reachFollowers: number;
  reachNonFollowers: number;
  discoveryRate: number; // alcance de não-seguidores ÷ alcance com split
  hasReachSplit: boolean;
  profileViews: number;
  profileLinkTaps: number;
}

export function awarenessKpis(data: DashboardData, range?: DateRange): AwarenessKpis {
  const ads = filterAds(data.adDaily, range);
  const spend = ads.reduce((s, r) => s + r.spend, 0);
  const t = igAccountTotals(data.igAccountDaily, range);
  return {
    spend,
    followersEnd: t.followersEnd,
    netNewFollowers: t.netNew,
    costPerFollower: t.netNew > 0 ? spend / t.netNew : null,
    reach: t.reach,
    costPerReach: t.reach > 0 ? (spend / t.reach) * 1000 : null,
    views: t.views,
    interactions: t.interactions,
    engagementRate: t.engagementRate,
    reachFollowers: t.reachFollowers,
    reachNonFollowers: t.reachNonFollowers,
    discoveryRate: t.discoveryRate,
    hasReachSplit: t.hasReachSplit,
    profileViews: t.profileViews,
    profileLinkTaps: t.profileLinkTaps,
  };
}

// ---- instagram: performance by post format -------------------------

const IG_TYPE_LABEL: Record<IgPost["type"], string> = {
  feed: "Feed",
  carrossel: "Carrossel",
  reel: "Reel",
  story: "Story",
};

/** Amostra mínima para coroar um "melhor formato"/"melhor dia" sem enganar. */
export const MIN_SAMPLE_POSTS = 2;

export interface FormatPerf {
  type: IgPost["type"];
  label: string;
  count: number;
  avgReach: number;
  avgEngagement: number; // mean of per-post engagement rate
  saveRate: number; // total saved / total reach
  shareRate: number; // total shares / total reach
  avgWatchTime?: number; // reels only (seconds)
  totalWatchTime?: number; // reels only (sum of seconds watched)
  /** false = amostra pequena (< MIN_SAMPLE_POSTS) — a UI não deve coroar campeão */
  sampleOk: boolean;
}

/** Group posts by format so the planner can compare reel vs carousel vs feed. */
export function formatPerformance(posts: IgPost[], range?: DateRange): FormatPerf[] {
  const byType = new Map<IgPost["type"], IgPost[]>();
  for (const p of posts.filter((p) => !p.isTest && inRange(dayOf(p.publishedAt), range))) {
    const list = byType.get(p.type) ?? [];
    list.push(p);
    byType.set(p.type, list);
  }
  const out: FormatPerf[] = [];
  for (const [type, list] of byType) {
    const n = list.length;
    const totReach = list.reduce((s, p) => s + p.reach, 0);
    const totSaved = list.reduce((s, p) => s + p.saved, 0);
    const totShares = list.reduce((s, p) => s + p.shares, 0);
    const watch = list.filter((p) => typeof p.avgWatchTime === "number");
    const totWatch = list.reduce((s, p) => s + (p.totalWatchTime ?? 0), 0);
    out.push({
      type,
      label: IG_TYPE_LABEL[type],
      count: n,
      avgReach: div(totReach, n),
      avgEngagement: div(
        list.reduce((s, p) => s + postEngagementRate(p), 0),
        n,
      ),
      saveRate: div(totSaved, totReach),
      shareRate: div(totShares, totReach),
      avgWatchTime: watch.length
        ? div(
            watch.reduce((s, p) => s + (p.avgWatchTime ?? 0), 0),
            watch.length,
          )
        : undefined,
      totalWatchTime: totWatch > 0 ? totWatch : undefined,
      sampleOk: n >= MIN_SAMPLE_POSTS,
    });
  }
  // best-engaging format first (the "champion" to double down on)
  return out.sort((a, b) => b.avgEngagement - a.avgEngagement);
}

// ---- instagram: best weekday to post -------------------------------

const WEEKDAY_LABEL = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export interface WeekdayPerf {
  weekday: number; // 0=Sun … 6=Sat
  label: string;
  count: number;
  avgReach: number;
  avgEngagement: number;
  /** false = amostra pequena (< MIN_SAMPLE_POSTS) — não tratar como "melhor dia" */
  sampleOk: boolean;
}

/** Average engagement/reach per weekday, to hint the best publishing days. */
export function weekdayPerformance(posts: IgPost[], range?: DateRange): WeekdayPerf[] {
  const byDay = new Map<number, IgPost[]>();
  for (const p of posts.filter((p) => !p.isTest && inRange(dayOf(p.publishedAt), range))) {
    const wd = new Date(p.publishedAt).getUTCDay();
    const list = byDay.get(wd) ?? [];
    list.push(p);
    byDay.set(wd, list);
  }
  const out: WeekdayPerf[] = [];
  for (let wd = 0; wd < 7; wd++) {
    const list = byDay.get(wd);
    if (!list?.length) continue;
    out.push({
      weekday: wd,
      label: WEEKDAY_LABEL[wd],
      count: list.length,
      avgReach: div(
        list.reduce((s, p) => s + p.reach, 0),
        list.length,
      ),
      avgEngagement: div(
        list.reduce((s, p) => s + postEngagementRate(p), 0),
        list.length,
      ),
      sampleOk: list.length >= MIN_SAMPLE_POSTS,
    });
  }
  return out;
}

// ---- landing page ---------------------------------------------------

export interface LpKpis {
  visits: number;
  clicks: number;
  formSubmits: number;
  visitToLead: number; // formSubmits / visits
  ctaRate: number; // clicks / visits
}

export function lpKpis(data: DashboardData, range?: DateRange): LpKpis {
  const rows = range
    ? data.lpDaily.filter((r) => inRange(r.date, range))
    : data.lpDaily;
  const visits = rows.reduce((s, r) => s + r.visits, 0);
  const clicks = rows.reduce((s, r) => s + r.clicks, 0);
  const formSubmits = rows.reduce((s, r) => s + r.formSubmits, 0);
  return {
    visits,
    clicks,
    formSubmits,
    visitToLead: div(formSubmits, visits),
    ctaRate: div(clicks, visits),
  };
}

// ---- deltas (period over period) -----------------------------------

export interface Delta {
  abs: number;
  pct: number; // ratio vs previous
  direction: "up" | "down" | "flat";
}

export function delta(current: number, previous: number): Delta {
  const abs = current - previous;
  const pct = previous !== 0 ? abs / previous : 0;
  const direction = abs > 0 ? "up" : abs < 0 ? "down" : "flat";
  return { abs, pct, direction };
}

// ---- goals ----------------------------------------------------------

export interface GoalProgress {
  metric: Goal["metric"];
  target: number;
  actual: number;
  pct: number; // 0–1+ progress toward the target
  onTrack: boolean;
  lowerIsBetter: boolean;
}

export function goalProgress(goal: Goal, actual: number): GoalProgress {
  const lower = goal.lowerIsBetter ?? false;
  // For "lower is better" (cost) goals, progress = target/actual.
  const pct = lower ? div(goal.target, actual) : div(actual, goal.target);
  const onTrack = lower ? actual <= goal.target : actual >= goal.target;
  return { metric: goal.metric, target: goal.target, actual, pct, onTrack, lowerIsBetter: lower };
}

/**
 * Resolve the actual value for a goal metric from the current dataset.
 * `null` = sem dado para medir (ex.: retenção sem nenhuma duração preenchida) —
 * a UI mostra "sem dado" em vez de um 0 que se leria como "0% da meta".
 */
export function actualForGoal(goal: Goal, data: DashboardData, range?: DateRange): number | null {
  const k = overviewKpis(data, range);
  switch (goal.metric) {
    case "leads":
      return k.leads;
    case "meetings":
      return k.meetings;
    case "cpl":
      return k.cpl;
    case "cpr":
      return k.cpr;
    case "spend":
      return k.spend;
    case "followers": {
      const last = [...data.igAccountDaily].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
      return last?.followers ?? 0;
    }
    // ---- metas orgânicas (plano de 90 dias) ----
    // As percentuais devolvem VALOR percentual (40 = 40%) — o alvo é gravado
    // na mesma unidade no GoalsForm, e a exibição usa formatPercentValue.
    // data.creatives habilita a exclusão de posts impulsionados — mesmas contas
    // da página Posts, senão a meta leria um universo diferente do painel.
    case "retencao_reels": {
      const agg = aggregatePostPerformance(
        postPerformance(data.igPosts, range, undefined, data.creatives),
      );
      return agg.avgRetention == null ? null : agg.avgRetention * 100;
    }
    case "alcance_base": {
      const agg = aggregatePostPerformance(
        postPerformance(data.igPosts, range, data.igAccountDaily, data.creatives),
      );
      return agg.avgReachOnBase == null ? null : agg.avgReachOnBase * 100;
    }
    case "saves_1k":
      return aggregatePostPerformance(
        postPerformance(data.igPosts, range, undefined, data.creatives),
      ).savesPer1k;
    case "comentarios_post":
      return aggregatePostPerformance(
        postPerformance(data.igPosts, range, undefined, data.creatives),
      ).commentsPerPost;
    case "compartilhamentos_post":
      return aggregatePostPerformance(
        postPerformance(data.igPosts, range, undefined, data.creatives),
      ).sharesPerPost;
    case "posts_semana":
      // updatedAt como "agora": mantém a função pura (só afeta daysSinceLast, não usado aqui)
      return data.igPosts.length === 0
        ? null
        : postingCadence(data.igPosts, range, data.updatedAt || "1970-01-01T00:00:00Z")
            .postsPerWeek;
    case "conversas_dm": {
      const t = igAccountTotals(data.igAccountDaily, range);
      return t.hasDmData ? t.dmConversations : null;
    }
    default:
      return 0;
  }
}

// ---- funil orgânico do Instagram -----------------------------------

/**
 * Funil de crescimento do perfil: Alcance → Visitas ao perfil → Novos
 * seguidores. Mostra ONDE o perfil vaza — muito alcance e pouca visita = gancho
 * fraco; muita visita e poucos seguidores = feed/prova social fraca. (A perda
 * visita→clique no link já aparece como "Taxa de clique no link".)
 */
export function buildOrganicFunnel(rows: IgAccountDaily[], range?: DateRange): FunnelStage[] {
  const t = igAccountTotals(rows, range);
  const netNew = Math.max(0, t.netNew);
  return [
    { key: "alcance", label: "Alcance", value: t.reach },
    { key: "visitas", label: "Visitas ao perfil", value: t.profileViews, fromPrev: div(t.profileViews, t.reach) },
    { key: "seguidores", label: "Novos seguidores", value: netNew, fromPrev: div(netNew, t.profileViews) },
  ];
}

/**
 * O braço de CONVERSÃO do perfil: Views → Visitas ao perfil → Cliques no link.
 * Complementa o funil de crescimento (alcance→seguidor) mostrando onde o
 * tráfego vaza antes de virar clique na bio (CTR baixo = bio/oferta fraca).
 */
export function buildProfileClickFunnel(rows: IgAccountDaily[], range?: DateRange): FunnelStage[] {
  const t = igAccountTotals(rows, range);
  return [
    { key: "views", label: "Views", value: t.views },
    { key: "visitas", label: "Visitas ao perfil", value: t.profileViews, fromPrev: div(t.profileViews, t.views) },
    { key: "link", label: "Cliques no link", value: t.profileLinkTaps, fromPrev: div(t.profileLinkTaps, t.profileViews) },
  ];
}

// ---- fila do comercial (SLA de contato) ----------------------------

export type LeadAgeBucket = "novo" | "atencao" | "atrasado"; // <24h, 24–48h, >48h

export interface AgingLead {
  id: string;
  name: string;
  phone?: string;
  createdAt: string;
  ageHours: number;
  bucket: LeadAgeBucket;
}

export interface LeadQueue {
  open: AgingLead[]; // status "lead" (ainda sem contato registrado), mais antigos primeiro
  counts: Record<LeadAgeBucket, number>;
}

/**
 * Leads ainda em "lead" (sem avanço), envelhecidos por tempo desde a entrada.
 * Speed-to-lead é a alavanca nº1 de agendamento — responder rápido converte
 * muito mais os MESMOS leads já pagos, derrubando o CPR sem gastar mais.
 */
export function leadQueue(leads: Lead[], nowIso: string): LeadQueue {
  const now = new Date(nowIso).getTime();
  const open = leads
    .filter((l) => l.status === "lead")
    .map((l) => {
      const ageHours = Math.max(0, (now - new Date(l.createdAt).getTime()) / 3_600_000);
      const bucket: LeadAgeBucket = ageHours > 48 ? "atrasado" : ageHours > 24 ? "atencao" : "novo";
      return { id: l.id, name: l.name, phone: l.phone, createdAt: l.createdAt, ageHours, bucket };
    })
    .sort((a, b) => b.ageHours - a.ageHours);
  const counts: Record<LeadAgeBucket, number> = { novo: 0, atencao: 0, atrasado: 0 };
  for (const l of open) counts[l.bucket] += 1;
  return { open, counts };
}

// ---- qualidade de dados (guardrail de decisão) ---------------------

export interface DataWarning {
  level: "warn" | "info";
  message: string;
}

/**
 * Checagens de confiança do painel: dado atrasado/quebrado leva a decisão
 * errada. Roda sobre o dataset inteiro (saúde global), não sobre o período.
 */
export function dataQualityChecks(
  data: DashboardData,
  opts: { nowIso: string; lastSyncAds?: string | null },
): DataWarning[] {
  const out: DataWarning[] = [];
  // Marcas de awareness (só seguidores) não têm funil de lead/LP — os checks de
  // "gasto sem lead", "LP sem submit" e "objetivo distorce o CPL" não se aplicam
  // e virariam falso positivo permanente.
  const awareness = isAwareness(data.campaign.brand);

  if (opts.lastSyncAds) {
    const hrs = (new Date(opts.nowIso).getTime() - new Date(opts.lastSyncAds).getTime()) / 3_600_000;
    if (hrs > 36) {
      out.push({ level: "warn", message: `Anúncios sincronizados há ${Math.round(hrs)}h — os números podem estar defasados. Rode "Sincronizar agora".` });
    }
  }

  if (!awareness) {
    const noObjective = data.adDaily.filter((r) => !r.objective && r.spend > 0).length;
    if (noObjective > 0) {
      out.push({ level: "warn", message: `${noObjective} linha(s) de anúncio sem objetivo — caem em conversão e distorcem o CPL fiel. Ressincronize os anúncios.` });
    }

    const totalSpend = data.adDaily.reduce((s, r) => s + r.spend, 0);
    if (totalSpend > 0 && data.leads.length === 0) {
      out.push({ level: "warn", message: "Há gasto em anúncios mas nenhum lead registrado — o rastreio da landing page pode estar quebrado ou faltando importar." });
    }

    const totalVisits = data.lpDaily.reduce((s, r) => s + r.visits, 0);
    const totalSubmits = data.lpDaily.reduce((s, r) => s + r.formSubmits, 0);
    if (totalVisits > 0 && totalSubmits === 0) {
      out.push({ level: "warn", message: "A landing page tem visitas mas nenhum envio de formulário registrado — verifique o rastreio de leads (/api/track)." });
    }
  }

  // Buracos na série diária de anúncios (dias sem dado dentro do intervalo).
  const dates = [...new Set(data.adDaily.map((r) => r.date))].sort();
  if (dates.length >= 2) {
    const first = new Date(dates[0] + "T00:00:00Z").getTime();
    const last = new Date(dates.at(-1)! + "T00:00:00Z").getTime();
    const expected = Math.round((last - first) / 86_400_000) + 1;
    const missing = expected - dates.length;
    if (missing > 0) {
      out.push({ level: "info", message: `${missing} dia(s) sem dados de anúncios no intervalo — a série pode ter lacunas (insights da Meta atrasam até 48h).` });
    }
  }

  return out;
}

// ---- convenience: full date span of the dataset --------------------

export function dataDateRange(data: DashboardData): DateRange {
  const dates = data.adDaily.map((r) => r.date).sort();
  return { from: dates[0] ?? "", to: dates.at(-1) ?? "" };
}
