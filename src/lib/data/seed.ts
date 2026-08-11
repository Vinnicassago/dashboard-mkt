/**
 * Deterministic example ("seed") dataset so the dashboard renders "alive"
 * before any real data is imported. Numbers are internally consistent across
 * the funnel: ad clicks feed landing-page visits, leads come from those
 * clicks, and meetings are derived from the leads list.
 *
 * Everything is generated from a fixed PRNG seed, so the values are stable
 * across renders and builds. Replace this with real imports / API data later.
 */

import type {
  AdDaily,
  Campaign,
  Creative,
  CreativeFormat,
  DashboardData,
  Goal,
  IgAccountDaily,
  IgMediaType,
  IgPost,
  Lead,
  LeadEvent,
  LeadStatus,
  LpDaily,
} from "../types";
import { DEFAULT_BRAND } from "../types";

// ---- deterministic PRNG (mulberry32) ------------------------------
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START = "2026-07-09";
const END = "2026-07-23"; // "today" in the scenario

function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  const last = new Date(end + "T00:00:00Z");
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface CreativeDef {
  adId: string;
  name: string;
  format: CreativeFormat;
  adset: string;
  objective: string; // objetivo cru da Meta (OUTCOME_LEADS, OUTCOME_ENGAGEMENT, …)
  startDay: number; // index within the date range
  weight: number; // share of daily budget
  cpm: number; // base cost per 1000 impressions (BRL)
  ctr: number; // base link CTR (ratio)
  conv: number; // base click -> lead rate on the landing page
}

const CREATIVE_DEFS: CreativeDef[] = [
  // Conversão — geração de leads
  { adId: "AD-01", name: 'Vídeo — "Cansado de financiar?"', format: "video", adset: "Público Frio — Interesses", objective: "OUTCOME_LEADS", startDay: 0, weight: 1.2, cpm: 22, ctr: 0.019, conv: 0.04 },
  { adId: "AD-02", name: "Carrossel — Consórcio x Financiamento", format: "carrossel", adset: "Público Frio — Interesses", objective: "OUTCOME_LEADS", startDay: 0, weight: 1.0, cpm: 20, ctr: 0.014, conv: 0.034 },
  { adId: "AD-03", name: "Imagem — Prova social (cliente real)", format: "imagem", adset: "Público Frio — Interesses", objective: "OUTCOME_LEADS", startDay: 0, weight: 0.8, cpm: 18, ctr: 0.0098, conv: 0.026 },
  { adId: "AD-04", name: "Vídeo — Head explica em 30s", format: "video", adset: "Público Frio — Interesses", objective: "OUTCOME_LEADS", startDay: 3, weight: 1.1, cpm: 24, ctr: 0.021, conv: 0.045 },
  { adId: "AD-05", name: "Carrossel — 5 mitos do consórcio", format: "carrossel", adset: "Lookalike 1% — Compradores", objective: "OUTCOME_LEADS", startDay: 6, weight: 0.9, cpm: 21, ctr: 0.0132, conv: 0.031 },
  { adId: "AD-06", name: 'Imagem — "Agende sua reunião"', format: "imagem", adset: "Lookalike 1% — Compradores", objective: "OUTCOME_LEADS", startDay: 9, weight: 0.7, cpm: 19, ctr: 0.0082, conv: 0.048 },
  // Descoberta — alcance/engajamento p/ ganho de seguidores (CPM baixo, quase sem lead)
  { adId: "AD-07", name: "Reel — Bastidores do escritório", format: "video", adset: "Descoberta — Seguidores", objective: "OUTCOME_ENGAGEMENT", startDay: 2, weight: 0.9, cpm: 9, ctr: 0.004, conv: 0 },
  { adId: "AD-08", name: "Reel — Dica rápida de consórcio", format: "video", adset: "Descoberta — Alcance", objective: "OUTCOME_AWARENESS", startDay: 5, weight: 0.8, cpm: 8, ctr: 0.003, conv: 0 },
];

const FIRST_NAMES = [
  "Ana", "Bruno", "Carla", "Daniel", "Eduarda", "Felipe", "Gabriela", "Henrique",
  "Isabela", "João", "Karina", "Lucas", "Mariana", "Nícolas", "Otávio", "Patrícia",
  "Rafael", "Sabrina", "Thiago", "Vanessa", "William", "Beatriz", "Caio", "Débora",
  "Emerson", "Fernanda", "Gustavo", "Helena", "Igor", "Juliana",
];
const LAST_NAMES = [
  "Silva", "Santos", "Oliveira", "Souza", "Costa", "Pereira", "Almeida", "Ferreira",
  "Rodrigues", "Gomes", "Martins", "Araújo", "Barbosa", "Ribeiro", "Carvalho",
  "Lima", "Correia", "Teixeira", "Moreira", "Nunes",
];
const EMAIL_DOMAINS = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com.br"];
const DDDS = ["11", "21", "31", "41", "51", "19", "27", "62"];

/** Strip accents + non-letters for building an e-mail local part. */
function slug(s: string): string {
  return s
    .normalize("NFD")
    .split("")
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c < 0x0300 || c > 0x036f;
    })
    .join("")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function buildSeedData(): DashboardData {
  const rng = mulberry32(20260723);
  const rand = (min: number, max: number) => min + (max - min) * rng();
  const dates = dateRange(START, END);

  const campaign: Campaign = {
    id: "CAMP-CONSORCIO-2026-07",
    brand: DEFAULT_BRAND,
    name: "Consórcio — Geração de Leads",
    objective: "Cadastros (leads) para agendamento de reunião",
    status: "ativa",
    startDate: START,
    budgetTotal: 9000,
    dailyBudget: 600,
  };

  const creatives: Creative[] = CREATIVE_DEFS.map((c) => ({
    adId: c.adId,
    brand: DEFAULT_BRAND,
    name: c.name,
    format: c.format,
    videoPlays: 0,
    thruPlays: 0,
  }));
  const creativeById = new Map(creatives.map((c) => [c.adId, c]));

  const adDaily: AdDaily[] = [];
  const lpDaily: LpDaily[] = [];
  // leads per (date, adId) so we can materialise a consistent leads list
  const leadBuckets: { date: string; adId: string; count: number }[] = [];

  dates.forEach((date, i) => {
    const active = CREATIVE_DEFS.filter((c) => c.startDay <= i);
    const weightSum = active.reduce((s, c) => s + c.weight, 0);
    // budget ramps up over the first days, then paces near the daily cap
    const ramp = Math.min(1, 0.55 + i * 0.05);
    const daySpend = (campaign.dailyBudget ?? 600) * ramp * rand(0.9, 1.05);

    let dayClicks = 0;
    let dayLeads = 0;

    for (const c of active) {
      const spend = (daySpend * c.weight) / weightSum;
      const cpm = c.cpm * rand(0.9, 1.12);
      const impressions = Math.round((spend / cpm) * 1000);
      const frequency = rand(1.15, 1.6);
      const reach = Math.round(impressions / frequency);
      const ctr = c.ctr * rand(0.85, 1.15);
      const clicks = Math.max(1, Math.round(impressions * ctr));
      const conv = c.conv * rand(0.8, 1.2);
      const leads = Math.round(clicks * conv);

      adDaily.push({
        brand: DEFAULT_BRAND,
        date,
        campaign: campaign.name,
        adset: c.adset,
        adId: c.adId,
        objective: c.objective,
        spend: Math.round(spend * 100) / 100,
        impressions,
        reach,
        frequency: Math.round(frequency * 100) / 100,
        clicks,
        leads,
      });

      // accumulate video engagement for video/carousel creatives
      const cr = creativeById.get(c.adId)!;
      if (c.format !== "imagem") {
        cr.videoPlays = (cr.videoPlays ?? 0) + Math.round(impressions * rand(0.28, 0.4));
        cr.thruPlays = (cr.thruPlays ?? 0) + Math.round(impressions * rand(0.06, 0.12));
      }

      dayClicks += clicks;
      dayLeads += leads;
      if (leads > 0) leadBuckets.push({ date, adId: c.adId, count: leads });
    }

    // landing page: visits ≈ link clicks minus small bounce; CTA clicks between; leads = form submits
    const visits = Math.round(dayClicks * rand(0.9, 0.98));
    const pageClicks = Math.round(visits * rand(0.5, 0.72));
    lpDaily.push({ brand: DEFAULT_BRAND, date, visits, clicks: pageClicks, formSubmits: dayLeads });
  });

  // ---- materialise individual leads (consistent with adDaily) ------
  const leads: Lead[] = [];
  let leadSeq = 0;
  for (const bucket of leadBuckets) {
    const def = CREATIVE_DEFS.find((c) => c.adId === bucket.adId)!;
    for (let k = 0; k < bucket.count; k++) {
      const fn = FIRST_NAMES[Math.floor(rand(0, FIRST_NAMES.length))];
      const ln = LAST_NAMES[Math.floor(rand(0, LAST_NAMES.length))];
      const domain = EMAIL_DOMAINS[Math.floor(rand(0, EMAIL_DOMAINS.length))];
      const emailTail = rng() < 0.5 ? String(Math.floor(rand(1, 99))) : "";
      const email = `${slug(fn)}.${slug(ln)}${emailTail}@${domain}`;
      const ddd = DDDS[Math.floor(rand(0, DDDS.length))];
      const phone = `(${ddd}) 9${Math.floor(rand(1000, 9999))}-${Math.floor(rand(1000, 9999))}`;
      const hour = Math.floor(rand(8, 21));
      const minute = Math.floor(rand(0, 60));
      const createdAt = `${bucket.date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;

      // status distribution — better creatives book more meetings; alguns
      // comparecimentos viram cliente (com valor de carta) para demonstrar receita.
      const r = rng();
      let status: LeadStatus;
      let meetingAt: string | undefined;
      let value: number | undefined;
      const bookBias = def.conv > 0.13 ? 0.08 : 0; // stronger creatives convert to meetings a bit more
      if (r < 0.09 + bookBias) {
        status = "cliente";
        value = Math.round(rand(80, 260)) * 1000; // carta de R$80k–260k
      } else if (r < 0.22 + bookBias) {
        status = "compareceu";
      } else if (r < 0.42 + bookBias) {
        status = "agendou";
      } else if (r < 0.6) {
        status = "perdido";
      } else {
        status = "lead";
      }
      if (status === "agendou" || status === "compareceu" || status === "cliente") {
        meetingAt = `${addDays(bucket.date, Math.floor(rand(1, 5)))}T${String(Math.floor(rand(9, 18))).padStart(2, "0")}:00:00`;
      }

      leads.push({
        id: `LEAD-${String(++leadSeq).padStart(4, "0")}`,
        brand: DEFAULT_BRAND,
        createdAt,
        name: `${fn} ${ln}`,
        email,
        phone,
        utmSource: "instagram",
        utmCampaign: campaign.id,
        utmContent: bucket.adId,
        status,
        meetingAt,
        value,
      });
    }
  }

  // ---- Instagram organic --------------------------------------------
  const igAccountDaily: IgAccountDaily[] = [];
  let followers = 38;
  dates.forEach((date, i) => {
    const gain = Math.round(rand(12, 34) + i * 1.6); // growth accelerates
    followers += gain;
    const reach = Math.round(rand(380, 900) + i * 140 + rand(0, 400));
    const views = Math.round(reach * rand(1.4, 2.2));
    const reachFollowers = Math.round(reach * (0.7 - Math.min(i, 14) * 0.012));
    const profileLinkTaps = Math.round(rand(6, 22) + i * 1.5);
    igAccountDaily.push({
      brand: DEFAULT_BRAND,
      date,
      followers,
      reach,
      views,
      profileLinkTaps,
      accountsEngaged: Math.round(reach * rand(0.06, 0.13)),
      totalInteractions: Math.round(rand(40, 160) + i * 12),
      profileViews: Math.round(rand(40, 140) + i * 6),
      reachFollowers,
      reachNonFollowers: Math.max(0, reach - reachFollowers),
      // registro manual de conversas de DM — derivado (sem novo rand, p/ não
      // deslocar a sequência determinística das demais métricas)
      dmConversations: Math.max(0, Math.round(profileLinkTaps * 0.4) - 2),
    });
  });

  // ---- Instagram posts ----------------------------------------------
  // durationSec só nos reels (entrada manual na vida real); pillar/série em
  // parte dos posts, como ficaria após o tagueamento manual.
  const POST_DEFS: {
    day: number;
    type: IgMediaType;
    caption: string;
    durationSec?: number;
    pillar?: string;
  }[] = [
    { day: 0, type: "reel", caption: "Consórcio é para quem não tem pressa? Mito.", durationSec: 41, pillar: "Mito ou verdade" },
    { day: 1, type: "carrossel", caption: "3 diferenças entre consórcio e financiamento" },
    { day: 3, type: "feed", caption: "Conheça o head de consórcio do escritório", pillar: "Bastidor" },
    { day: 5, type: "reel", caption: "Como a carta de crédito funciona na prática", durationSec: 38 },
    { day: 7, type: "carrossel", caption: "5 mitos do consórcio que te fazem perder dinheiro", pillar: "Mito ou verdade" },
    { day: 9, type: "reel", caption: "Cliente real: como ela conquistou o imóvel", durationSec: 26, pillar: "Prova social" },
    { day: 11, type: "feed", caption: "Agende uma reunião sem compromisso" },
    { day: 12, type: "reel", caption: "Consórcio contemplado: e agora? Me chama na DM.", durationSec: 22 },
    { day: 14, type: "carrossel", caption: "Passo a passo para começar hoje — salva pra depois" },
  ];
  const igPosts: IgPost[] = POST_DEFS.map((p, idx) => {
    const base = 300 + p.day * 90;
    const reach = Math.round(base * rand(0.8, 2.4));
    const views = Math.round(reach * (p.type === "reel" ? rand(1.8, 3.2) : rand(1.1, 1.7)));
    const likes = Math.round(reach * rand(0.03, 0.09));
    const comments = Math.round(likes * rand(0.05, 0.2));
    const saved = Math.round(reach * rand(0.01, 0.05));
    const shares = Math.round(reach * rand(0.008, 0.03));
    return {
      id: `POST-${String(idx + 1).padStart(2, "0")}`,
      brand: DEFAULT_BRAND,
      publishedAt: `${dates[p.day]}T${String(Math.floor(rand(9, 20))).padStart(2, "0")}:00:00`,
      type: p.type,
      caption: p.caption,
      permalink: `https://instagram.com/p/seed-${idx + 1}`,
      reach,
      views,
      likes,
      comments,
      saved,
      shares,
      avgWatchTime: p.type === "reel" ? Math.round(rand(6, 18) * 10) / 10 : undefined,
      totalWatchTime: p.type === "reel" ? Math.round(views * rand(3, 9)) : undefined,
      durationSec: p.durationSec,
      pillar: p.pillar,
    };
  });

  // ---- Goals (targets for "metas vs realizado") ---------------------
  const goals: Goal[] = [
    { brand: DEFAULT_BRAND, metric: "leads", period: "campanha", target: 260 },
    { brand: DEFAULT_BRAND, metric: "meetings", period: "campanha", target: 110 },
    { brand: DEFAULT_BRAND, metric: "cpl", period: "campanha", target: 40, lowerIsBetter: true },
    { brand: DEFAULT_BRAND, metric: "cpr", period: "campanha", target: 95, lowerIsBetter: true },
    { brand: DEFAULT_BRAND, metric: "followers", period: "campanha", target: 600 },
    // metas orgânicas do plano de 90 dias (retencao_reels/alcance_base em valor %)
    { brand: DEFAULT_BRAND, metric: "retencao_reels", period: "campanha", target: 40 },
    { brand: DEFAULT_BRAND, metric: "saves_1k", period: "campanha", target: 8 },
    { brand: DEFAULT_BRAND, metric: "posts_semana", period: "campanha", target: 4 },
    { brand: DEFAULT_BRAND, metric: "conversas_dm", period: "campanha", target: 60 },
  ];

  // ---- segunda marca: krone.capital (awareness — só seguidores) ------
  const krone = buildKroneSeed(dates);

  return {
    campaign,
    igAccountDaily: [...igAccountDaily, ...krone.igAccountDaily],
    igPosts: [...igPosts, ...krone.igPosts],
    adDaily: [...adDaily, ...krone.adDaily],
    creatives: [...creatives, ...krone.creatives],
    lpDaily,
    leads,
    goals: [...goals, ...krone.goals],
    updatedAt: `${END}T09:00:00`,
    isSeed: true,
  };
}

const KRONE = "krone";

/**
 * Dataset de exemplo da @krone.capital (marca awareness): crescimento de perfil +
 * campanhas pagas de seguidores/descoberta. Sem leads nem landing page — só o que
 * uma marca de awareness mostra. Determinístico (PRNG próprio, não perturba o da
 * consorcio). As linhas vão para os MESMOS arrays; getData("krone") as recorta.
 */
function buildKroneSeed(dates: string[]): {
  igAccountDaily: IgAccountDaily[];
  igPosts: IgPost[];
  adDaily: AdDaily[];
  creatives: Creative[];
  goals: Goal[];
} {
  const rng = mulberry32(20260724);
  const rand = (min: number, max: number) => min + (max - min) * rng();

  const CREATIVE_DEFS: {
    adId: string;
    name: string;
    format: CreativeFormat;
    adset: string;
    objective: string;
    cpm: number;
  }[] = [
    { adId: "KR-01", name: "Reel — 3 erros que corroem seu patrimônio", format: "video", adset: "Descoberta — Interesses (investir)", objective: "OUTCOME_ENGAGEMENT", cpm: 7 },
    { adId: "KR-02", name: "Carrossel — Diversificação de verdade", format: "carrossel", adset: "Descoberta — Lookalike", objective: "OUTCOME_AWARENESS", cpm: 6 },
  ];
  const creatives: Creative[] = CREATIVE_DEFS.map((c) => ({
    adId: c.adId,
    brand: KRONE,
    name: c.name,
    format: c.format,
    videoPlays: 0,
    thruPlays: 0,
  }));
  const creativeById = new Map(creatives.map((c) => [c.adId, c]));

  const adDaily: AdDaily[] = [];
  dates.forEach((date, i) => {
    const daySpend = rand(50, 85) * Math.min(1, 0.6 + i * 0.05);
    for (const c of CREATIVE_DEFS) {
      const spend = (daySpend / CREATIVE_DEFS.length) * rand(0.85, 1.15);
      const cpm = c.cpm * rand(0.9, 1.15);
      const impressions = Math.round((spend / cpm) * 1000);
      const frequency = rand(1.1, 1.5);
      const reach = Math.round(impressions / frequency);
      const clicks = Math.max(1, Math.round(impressions * rand(0.002, 0.006)));
      adDaily.push({
        brand: KRONE,
        date,
        campaign: "KRONE — Ganho de Seguidores",
        adset: c.adset,
        adId: c.adId,
        objective: c.objective,
        spend: Math.round(spend * 100) / 100,
        impressions,
        reach,
        frequency: Math.round(frequency * 100) / 100,
        clicks,
        leads: 0,
      });
      const cr = creativeById.get(c.adId)!;
      cr.videoPlays = (cr.videoPlays ?? 0) + Math.round(impressions * rand(0.3, 0.45));
      cr.thruPlays = (cr.thruPlays ?? 0) + Math.round(impressions * rand(0.08, 0.15));
    }
  });

  // Instagram orgânico — conta em crescimento, muita descoberta (não-seguidores).
  const igAccountDaily: IgAccountDaily[] = [];
  let followers = 820;
  dates.forEach((date, i) => {
    const gain = Math.round(rand(8, 22) + i * 1.2);
    followers += gain;
    const reach = Math.round(rand(900, 2200) + i * 180 + rand(0, 500));
    const views = Math.round(reach * rand(1.6, 2.6));
    const reachNon = Math.round(reach * (0.62 + Math.min(i, 14) * 0.006));
    igAccountDaily.push({
      brand: KRONE,
      date,
      followers,
      reach,
      views,
      profileLinkTaps: Math.round(rand(3, 12) + i * 0.6),
      accountsEngaged: Math.round(reach * rand(0.05, 0.1)),
      totalInteractions: Math.round(rand(30, 110) + i * 8),
      profileViews: Math.round(rand(30, 100) + i * 5),
      reachFollowers: Math.max(0, reach - reachNon),
      reachNonFollowers: reachNon,
    });
  });

  const POST_DEFS: { day: number; type: IgMediaType; caption: string; durationSec?: number }[] = [
    { day: 1, type: "reel", caption: "3 erros que corroem seu patrimônio sem você perceber", durationSec: 28 },
    { day: 3, type: "carrossel", caption: "Diversificar não é ter muitos ativos — é ter os certos" },
    { day: 6, type: "reel", caption: "O custo invisível de deixar dinheiro parado", durationSec: 24 },
    { day: 9, type: "feed", caption: "Inteligência patrimonial: por onde começar" },
    { day: 12, type: "reel", caption: "Como blindar seu patrimônio da inflação", durationSec: 21 },
  ];
  const igPosts: IgPost[] = POST_DEFS.map((p, idx) => {
    const base = 500 + p.day * 110;
    const reach = Math.round(base * rand(0.9, 2.2));
    const views = Math.round(reach * (p.type === "reel" ? rand(1.9, 3.3) : rand(1.1, 1.6)));
    const likes = Math.round(reach * rand(0.03, 0.08));
    const comments = Math.round(likes * rand(0.05, 0.18));
    const saved = Math.round(reach * rand(0.015, 0.06));
    const shares = Math.round(reach * rand(0.01, 0.04));
    return {
      id: `KPOST-${String(idx + 1).padStart(2, "0")}`,
      brand: KRONE,
      publishedAt: `${dates[p.day]}T${String(Math.floor(rand(9, 20))).padStart(2, "0")}:00:00`,
      type: p.type,
      caption: p.caption,
      permalink: `https://instagram.com/p/krone-seed-${idx + 1}`,
      reach,
      views,
      likes,
      comments,
      saved,
      shares,
      avgWatchTime: p.type === "reel" ? Math.round(rand(7, 20) * 10) / 10 : undefined,
      totalWatchTime: p.type === "reel" ? Math.round(views * rand(4, 10)) : undefined,
      durationSec: p.durationSec,
    };
  });

  const goals: Goal[] = [{ brand: KRONE, metric: "followers", period: "campanha", target: 1500 }];

  return { igAccountDaily, igPosts, adDaily, creatives, goals };
}

/**
 * Seed the audit trail from the example leads: a "created" event (from the
 * landing page) for every lead, plus a "status_changed" for those that already
 * moved past "lead". Real user actions log the real username at runtime.
 */
function buildSeedLeadEvents(leads: Lead[]): LeadEvent[] {
  const events: LeadEvent[] = [];
  let seq = 0;
  for (const l of leads) {
    events.push({
      id: `EVT-S-${++seq}`,
      leadId: l.id,
      leadName: l.name,
      actor: "Landing page",
      action: "created",
      toStatus: "lead",
      createdAt: l.createdAt,
    });
    if (l.status !== "lead") {
      events.push({
        id: `EVT-S-${++seq}`,
        leadId: l.id,
        leadName: l.name,
        actor: "Equipe comercial",
        action: "status_changed",
        fromStatus: "lead",
        toStatus: l.status,
        createdAt: l.meetingAt ?? l.createdAt,
      });
    }
  }
  return events;
}

export { buildSeedData, buildSeedLeadEvents };
