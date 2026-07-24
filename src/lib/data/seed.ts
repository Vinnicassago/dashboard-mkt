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
  startDay: number; // index within the date range
  weight: number; // share of daily budget
  cpm: number; // base cost per 1000 impressions (BRL)
  ctr: number; // base link CTR (ratio)
  conv: number; // base click -> lead rate on the landing page
}

const CREATIVE_DEFS: CreativeDef[] = [
  { adId: "AD-01", name: 'Vídeo — "Cansado de financiar?"', format: "video", adset: "Público Frio — Interesses", startDay: 0, weight: 1.2, cpm: 22, ctr: 0.019, conv: 0.04 },
  { adId: "AD-02", name: "Carrossel — Consórcio x Financiamento", format: "carrossel", adset: "Público Frio — Interesses", startDay: 0, weight: 1.0, cpm: 20, ctr: 0.014, conv: 0.034 },
  { adId: "AD-03", name: "Imagem — Prova social (cliente real)", format: "imagem", adset: "Público Frio — Interesses", startDay: 0, weight: 0.8, cpm: 18, ctr: 0.0098, conv: 0.026 },
  { adId: "AD-04", name: "Vídeo — Head explica em 30s", format: "video", adset: "Público Frio — Interesses", startDay: 3, weight: 1.1, cpm: 24, ctr: 0.021, conv: 0.045 },
  { adId: "AD-05", name: "Carrossel — 5 mitos do consórcio", format: "carrossel", adset: "Lookalike 1% — Compradores", startDay: 6, weight: 0.9, cpm: 21, ctr: 0.0132, conv: 0.031 },
  { adId: "AD-06", name: 'Imagem — "Agende sua reunião"', format: "imagem", adset: "Lookalike 1% — Compradores", startDay: 9, weight: 0.7, cpm: 19, ctr: 0.0082, conv: 0.048 },
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
    name: "Consórcio — Geração de Leads",
    objective: "Cadastros (leads) para agendamento de reunião",
    status: "ativa",
    startDate: START,
    budgetTotal: 9000,
    dailyBudget: 600,
  };

  const creatives: Creative[] = CREATIVE_DEFS.map((c) => ({
    adId: c.adId,
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
        date,
        campaign: campaign.name,
        adset: c.adset,
        adId: c.adId,
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
    lpDaily.push({ date, visits, clicks: pageClicks, formSubmits: dayLeads });
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

      // status distribution — better creatives book more meetings
      const r = rng();
      let status: LeadStatus;
      let meetingAt: string | undefined;
      const bookBias = def.conv > 0.13 ? 0.08 : 0; // stronger creatives convert to meetings a bit more
      if (r < 0.22 + bookBias) {
        status = "compareceu";
      } else if (r < 0.42 + bookBias) {
        status = "agendou";
      } else if (r < 0.6) {
        status = "perdido";
      } else {
        status = "lead";
      }
      if (status === "agendou" || status === "compareceu") {
        meetingAt = `${addDays(bucket.date, Math.floor(rand(1, 5)))}T${String(Math.floor(rand(9, 18))).padStart(2, "0")}:00:00`;
      }

      leads.push({
        id: `LEAD-${String(++leadSeq).padStart(4, "0")}`,
        createdAt,
        name: `${fn} ${ln}`,
        email,
        phone,
        utmSource: "instagram",
        utmCampaign: campaign.id,
        utmContent: bucket.adId,
        status,
        meetingAt,
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
    igAccountDaily.push({
      date,
      followers,
      reach,
      views,
      profileLinkTaps: Math.round(rand(6, 22) + i * 1.5),
      accountsEngaged: Math.round(reach * rand(0.06, 0.13)),
      totalInteractions: Math.round(rand(40, 160) + i * 12),
    });
  });

  // ---- Instagram posts ----------------------------------------------
  const POST_DEFS: { day: number; type: IgMediaType; caption: string }[] = [
    { day: 0, type: "reel", caption: "Consórcio é para quem não tem pressa? Mito." },
    { day: 1, type: "carrossel", caption: "3 diferenças entre consórcio e financiamento" },
    { day: 3, type: "feed", caption: "Conheça o head de consórcio do escritório" },
    { day: 5, type: "reel", caption: "Como a carta de crédito funciona na prática" },
    { day: 7, type: "carrossel", caption: "5 mitos do consórcio que te fazem perder dinheiro" },
    { day: 9, type: "reel", caption: "Cliente real: como ela conquistou o imóvel" },
    { day: 11, type: "feed", caption: "Agende uma reunião sem compromisso" },
    { day: 12, type: "reel", caption: "Consórcio contemplado: e agora?" },
    { day: 14, type: "carrossel", caption: "Passo a passo para começar hoje" },
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
    };
  });

  // ---- Goals (targets for "metas vs realizado") ---------------------
  const goals: Goal[] = [
    { metric: "leads", period: "campanha", target: 260 },
    { metric: "meetings", period: "campanha", target: 110 },
    { metric: "cpl", period: "campanha", target: 40, lowerIsBetter: true },
    { metric: "cpr", period: "campanha", target: 95, lowerIsBetter: true },
    { metric: "followers", period: "campanha", target: 600 },
  ];

  return {
    campaign,
    igAccountDaily,
    igPosts,
    adDaily,
    creatives,
    lpDaily,
    leads,
    goals,
    updatedAt: `${END}T09:00:00`,
    isSeed: true,
  };
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
