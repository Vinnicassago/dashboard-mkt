/**
 * Fixtures da Fase 4 — a Mídia (fora da coleta do vitest, que só pega `*.test.ts`).
 *
 * A FORMA da produção de 12/11/2026 (marca Consórcio, 7 dias), com nomes e números
 * FICTÍCIOS — o repositório é público. É DADO: monta linhas de anúncio, criativos,
 * leads, o registro de sincronizações e o robô (as colunas `robo_*` que o sync
 * grava no lead, nunca o banco do robô). Nenhuma função daqui chama a lib nova da
 * Fase 4; `periodoDa`/`entradaDoProcessoDa` só usam o que já existia (`pageRange`,
 * `kpisDoPeriodo`), como `fixtures-robo.ts`.
 *
 * `producaoSemana()` (§5.0 da spec):
 *   • conversão: 1 campanha, 4 conjuntos — Aurora e Boreal no ar, Cerrado no ar com
 *     pouco gasto, Delta parou em 08/11 — + o conjunto MISTO Mirante (K11): um
 *     anúncio de conversão (o 2º "Carrossel -") e um de descoberta SEM gasto que
 *     trouxe 1 lead de balde descoberta (entra no "Leads (painel)" da linha, nunca
 *     na verba: com gasto 0, Σ gasto dos conjuntos de conversão = o investimento de
 *     conversão em qualquer período);
 *   • 5 criativos de conversão: nomes de 8, 6 e 4 palavras + dois "Carrossel -"
 *     homônimos em conjuntos diferentes (Aurora e Mirante, os dois no ar); o de 6
 *     palavras é o que parou em 08/11, com gasto e 0 lead. O nome de 3 palavras é o
 *     do criativo de descoberta que também roda no conjunto misto;
 *   • descoberta: 3 campanhas, 5 criativos;
 *   • 23 leads de conversão na semana: 15 atribuídos (11 no Carrossel da Aurora, 3 no
 *     post de 8 palavras, 1 no de 4 palavras pelo NOME único) e 8 fora das linhas —
 *     6 com `adId` de anúncio que não está nas linhas da marca (`anuncio-de-fora`,
 *     K16), 1 macro `{{ad.name}}` e 1 ambíguo ("Carrossel -"); + 1 lead de
 *     descoberta (o do conjunto misto) e 1 orgânico (sem UTM pago, o "9º" do retrato
 *     de produção). 0 reunião na semana, nenhum orçamento;
 *   • antes da semana: 1 reunião agendada em 04/11 (Aurora), 1 contato inválido
 *     (Boreal) e 1 lead de antes do robô (27/10);
 *   • cobertura: um sync de anúncios OK às 06:02 de 12/11 (`ULTIMO_SYNC_ADS`), que
 *     cobre até 10/11 (a Meta atrasa 2 dias);
 *   • robô ligado e em dia: 1ª mensagem, resposta, convite aceito e "sem WhatsApp";
 *     três leads do Carrossel da Aurora estão nas últimas 24 h.
 *
 * Os leads se chamam "Pessoa-midia-NN-zq" (K26): `conferirLgpd(…, { semNomes })`
 * procura o nome como SUBSTRING do payload; nenhum nome de criativo, conjunto ou
 * campanha contém "pessoa" nem "-zq". Todo lead tem nome, telefone e e-mail
 * próprios (menos os de `comSemTelefone`, que é o ponto da variação).
 *
 * ATENÇÃO: o golden `fase4-paridade-midia.test.ts` roda sobre estas entradas. NÃO
 * mude as que existem (números, datas, nomes, ids) — acrescente variações novas.
 */
import { janelasCobertas, type Intervalo } from "@/lib/cobertura";
import type { EntradaDoProcesso } from "@/lib/funil-processo";
import { kpisDoPeriodo, type KpisDoPeriodo } from "@/lib/kpis";
import { LIVE_PADRAO, type CampanhaDaLive } from "@/lib/live";
import type { DateRange } from "@/lib/metrics";
import { pageRange } from "@/lib/page-range";
import type { RoboAgora } from "@/lib/robo/situacao";
import type { AdDaily, Creative, CreativeFormat, DashboardData, Lead, LeadEvent, Meta, SyncRun } from "@/lib/types";
import { roboFalhando, roboLido } from "./fixtures-funil";
import { base, brt } from "./fixtures-robo";

// ---------------------------------------------------------------- relógio

/** Quinta, 12/11/2026 — o dia do retrato de produção. */
export const HOJE = "2026-11-12";
/** 15:00 em Brasília. */
export const AGORA = brt(HOJE, "15:00");
/** O último sync de anúncios que deu certo: 06:02 de 12/11 em Brasília (cobre até 10/11). */
export const ULTIMO_SYNC_ADS = "2026-11-12T09:02:00Z";
/** A campanha da live já no ar (captação desde 16/11). */
export const HOJE_LIVE = "2026-11-20";
export const AGORA_LIVE = brt(HOJE_LIVE, "15:00");
export const MARCA = "consorcio";

/** O dia `n` dias depois de `dia` (AAAA-MM-DD). */
export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const maisMin = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString();

// ---------------------------------------------------------------- nomes e ids (fictícios)

export const NOMES = {
  campanha: {
    conversao: "[ACM] CP7 - Leads",
    bastidores: "Impulsionar: Post bastidores",
    dicas: "Impulsionar: Post dicas de lance",
    engajamento: "[ACM] CP - Engajamento",
    live: "[LIVE] Captação",
  },
  conjunto: {
    aurora: "Aurora Interesses 30-55",
    boreal: "Boreal Aberto 25-60",
    cerrado: "Cerrado Remarketing 30 dias",
    delta: "Delta Semelhantes 1%",
    mirante: "Mirante Misto Engajamento",
    envolvimento: "Público envolvimento",
    semelhantes: "Seguidores semelhantes",
    amplo: "Engajamento amplo",
    imovelAberto: "Imóvel Aberto",
    persona: "Persona Investidor",
  },
  criativo: {
    /** Os dois homônimos (Aurora e Mirante) e, na live, o anúncio misto. */
    carrossel: "Carrossel -",
    /** 8 palavras. */
    post8: "Post Quanto rende uma carta de 300 mil",
    /** 6 palavras — o que parou em 08/11. */
    post6: "Post Planejar a casa própria hoje",
    /** 4 palavras — o lead dele chega só com o nome (único). */
    post4: "Post Carta ou financiamento?",
    /** 3 palavras — descoberta (também o anúncio sem gasto do conjunto misto). */
    video3: "Vídeo bastidores equipe",
    reels: "Reels Três dicas para dar lance",
    contemplado: "Post Quem já foi contemplado",
    mitos: "Reels Mitos do consórcio",
    agenda: "Story Agenda da semana",
    c4a: "C4A Planejar a casa com carta",
    c4b: "C4B Investir com carta de crédito",
  },
} as const;

export const IDS = {
  campanha: { conversao: "71000001", bastidores: "71000002", dicas: "71000003", engajamento: "71000004", live: "71000009" },
  conjunto: {
    aurora: "72000001",
    boreal: "72000002",
    cerrado: "72000003",
    delta: "72000004",
    mirante: "72000005",
    envolvimento: "72000006",
    semelhantes: "72000007",
    amplo: "72000008",
    imovelAberto: "72000011",
    persona: "72000012",
  },
  anuncio: {
    carrosselAurora: "73000001",
    post8: "73000002",
    post4: "73000003",
    post6: "73000004",
    carrosselMirante: "73000005",
    /** O anúncio de DESCOBERTA do conjunto misto (sem gasto). */
    videoMirante: "73000006",
    video3: "73000011",
    reels: "73000012",
    contemplado: "73000013",
    mitos: "73000014",
    agenda: "73000015",
    c4a: "73000021",
    c4b: "73000022",
    /** Na live, com o MESMO criativo do Carrossel da Aurora (K20). */
    carrosselLive: "73000023",
  },
  criativo: {
    carrosselAurora: "74004411",
    post8: "74005520",
    post4: "74006630",
    post6: "74007740",
    carrosselMirante: "74008850",
    video3: "74009960",
    reels: "74001102",
    contemplado: "74001203",
    mitos: "74001304",
    agenda: "74001405",
    c4a: "74002101",
    c4b: "74002202",
  },
  /** Anúncios que NÃO estão nas linhas da marca (o lead tem o id, a linha não existe). */
  anuncioDeFora: ["73999001", "73999002"],
} as const;

// ---------------------------------------------------------------- tipos

/** O que cada entrada devolve: a forma de §5.0 (`data`, `cobertura`, `ultimoSyncAds`, `cfgLive`, `eventos`, `robo`) + o registro de syncs e o relógio. */
export interface SemanaDaMidia {
  data: DashboardData;
  cobertura: Intervalo[];
  /** O registro de sincronizações de anúncios (de onde sai `cobertura`). */
  syncRuns: SyncRun[];
  /** `estadoDaFonte("ads", marca).ultimoOk`. */
  ultimoSyncAds: string | null;
  cfgLive: CampanhaDaLive;
  eventos: LeadEvent[];
  /** `estadoDoRoboAgora` — desligado = `{ ligado: false, … }`, como em produção. */
  robo: RoboAgora;
  hoje: string;
  agora: string;
}

interface AnuncioSpec {
  adId: string;
  campanha: string;
  campaignId: string;
  conjunto: string;
  adsetId: string;
  objective: string;
  /** Gasto por dia: `[deslocamento em relação a hoje, gasto]` (0 = hoje). */
  gasto: [number, number][];
  /** Impressões por real gasto (CPM = 1000 ÷ isto). */
  impressoesPorReal: number;
  /** Impressões fixas por dia quando o gasto do dia é 0. */
  impressoesSemGasto?: number;
  ctr: number;
  frequencia: number;
  /** Conversões do Pixel por real (arredondadas por dia). */
  pixelPorReal: number;
}

interface CriativoSpec {
  adId: string;
  name: string;
  format: CreativeFormat;
  creativeId?: string;
  thumbnailUrl?: string;
  videoPlays?: number;
  thruPlays?: number;
}

type Origem =
  /** O link padrão (D6): `adId` gravado na entrada (+ conjunto e campanha com `conjunto`). */
  | { tipo: "id"; adId: string; conjunto?: boolean }
  /** Página antiga: "nome|id" no utm_content, sem `adId` gravado. */
  | { tipo: "id-no-conteudo"; adId: string; nome: string }
  /** Só o NOME do anúncio no utm_content. */
  | { tipo: "nome"; nome: string }
  | { tipo: "macro" }
  | { tipo: "fora"; adId: string }
  | { tipo: "organico" };

type EstadoRobo = "nada" | "saudado" | "conversou" | "aceitou" | "semWhatsapp";

interface LeadSpec {
  nn: number;
  /** Deslocamento do dia de entrada em relação a hoje… */
  d: number;
  hora: string;
  /** …ou o dia ABSOLUTO (não desloca com `hoje`). */
  dia?: string;
  origem: Origem;
  robo: EstadoRobo;
  extra?: (hoje: string) => Partial<Lead>;
}

interface Especificacao {
  hoje: string;
  agora: string;
  anuncios: AnuncioSpec[];
  criativos: CriativoSpec[];
  leads: LeadSpec[];
  syncRuns: SyncRun[];
  robo: RoboAgora;
  metas: Meta[];
  eventos: LeadEvent[];
}

// ---------------------------------------------------------------- montagem

/** Telefone celular com DDD, único por `nn` (13 dígitos; nenhum dígito repetido 7 vezes). */
export const telefoneDa = (nn: number) => `55219${String(87650000 + nn)}`;

/** O lead "Pessoa-midia-NN-zq" (nome, e-mail e telefone próprios). */
export function pessoa(nn: number, createdAt: string, over: Partial<Lead> = {}): Lead {
  const n = String(nn).padStart(2, "0");
  return {
    id: `lead-midia-${n}`,
    brand: MARCA,
    createdAt,
    name: `Pessoa-midia-${n}-zq`,
    email: `pessoa.midia.${n}@exemplo.com.br`,
    phone: telefoneDa(nn),
    status: "lead",
    ...over,
  };
}

/** As colunas `robo_*` (como o sync grava) de um lead que entrou em `criado`. */
function colunasDoRobo(estado: EstadoRobo, criado: string): Partial<Lead> {
  if (estado === "nada") return {};
  if (estado === "semWhatsapp") {
    return {
      roboVistoEm: maisMin(criado, 3),
      roboRecebidoEm: maisMin(criado, 1),
      roboSemWhatsappEm: maisMin(criado, 2),
      roboEtapa: "sem_whatsapp",
    };
  }
  const saudado: Partial<Lead> = {
    roboVistoEm: maisMin(criado, 3),
    roboRecebidoEm: maisMin(criado, 1),
    roboSaudacaoEm: maisMin(criado, 2),
    roboEtapa: "nao_respondeu",
  };
  if (estado === "saudado") return saudado;
  const conversou: Partial<Lead> = {
    ...saudado,
    roboRespondeuEm: maisMin(criado, 20),
    roboUltimaMsgClienteEm: maisMin(criado, 40),
    roboUltimaInteracaoEm: maisMin(criado, 41),
    roboEtapa: "em_conversa",
  };
  if (estado === "conversou") return conversou;
  return {
    ...conversou,
    roboConviteEm: maisMin(criado, 60),
    roboAceitouEm: maisMin(criado, 75),
    roboUltimaInteracaoEm: maisMin(criado, 75),
    roboEtapa: "transferido",
  };
}

const PAGO = { utmSource: "meta", utmMedium: "paid_social" } as const;

function utmDa(o: Origem, anuncios: readonly AnuncioSpec[]): Partial<Lead> {
  switch (o.tipo) {
    case "id": {
      const a = anuncios.find((x) => x.adId === o.adId);
      return {
        ...PAGO,
        adId: o.adId,
        utmContent: o.adId,
        ...(o.conjunto && a ? { adsetId: a.adsetId, campaignId: a.campaignId, utmTerm: a.adsetId, utmCampaign: a.campaignId } : {}),
      };
    }
    case "id-no-conteudo":
      return { ...PAGO, utmContent: `${o.nome}|${o.adId}` };
    case "nome":
      return { ...PAGO, utmContent: o.nome };
    case "macro":
      return { ...PAGO, utmContent: "{{ad.name}}" };
    case "fora":
      return { ...PAGO, adId: o.adId, utmContent: o.adId };
    case "organico":
      return {};
  }
}

function linhasDe(a: AnuncioSpec, hoje: string): AdDaily[] {
  return a.gasto.map(([d, spend]) => {
    const impressions = spend > 0 ? Math.round(spend * a.impressoesPorReal) : (a.impressoesSemGasto ?? 0);
    const reach = Math.round(impressions / a.frequencia);
    return {
      brand: MARCA,
      date: somarDias(hoje, d),
      campaign: a.campanha,
      campaignId: a.campaignId,
      adset: a.conjunto,
      adsetId: a.adsetId,
      adId: a.adId,
      objective: a.objective,
      spend,
      impressions,
      reach,
      frequency: reach > 0 ? Math.round((impressions / reach) * 100) / 100 : 0,
      clicks: Math.round(impressions * a.ctr),
      leads: Math.round(spend * a.pixelPorReal),
    };
  });
}

function materializar(e: Especificacao): SemanaDaMidia {
  const adDaily = e.anuncios.flatMap((a) => linhasDe(a, e.hoje)).sort((x, y) => x.date.localeCompare(y.date) || x.adId.localeCompare(y.adId));
  const creatives: Creative[] = e.criativos.map((c) => ({ brand: MARCA, ...c }));
  const leads = e.leads.map((s) => {
    const createdAt = brt(s.dia ?? somarDias(e.hoje, s.d), s.hora);
    return pessoa(s.nn, createdAt, { ...utmDa(s.origem, e.anuncios), ...colunasDoRobo(s.robo, createdAt), ...(s.extra?.(e.hoje) ?? {}) });
  });
  const data = base({ adDaily, creatives, leads, metas: e.metas, updatedAt: e.agora });
  const ok = e.syncRuns.filter((r) => r.ok).map((r) => r.finishedAt).sort();
  return {
    data,
    cobertura: janelasCobertas(e.syncRuns),
    syncRuns: e.syncRuns,
    ultimoSyncAds: ok.at(-1) ?? null,
    cfgLive: structuredClone(LIVE_PADRAO),
    eventos: e.eventos,
    robo: e.robo,
    hoje: e.hoje,
    agora: e.agora,
  };
}

/** Um sync de anúncios OK que terminou em `finishedAt` e pediu `de..ate` à Meta. */
export function syncDeAnuncios(id: string, finishedAt: string, de: string, ate: string, ok = true): SyncRun {
  return {
    id,
    source: "ads",
    brand: MARCA,
    startedAt: maisMin(finishedAt, -2),
    finishedAt,
    ok,
    dateFrom: de,
    dateTo: ate,
    rows: 0,
    ...(ok ? {} : { error: "Falha na sincronização." }),
  };
}

/** `[d, gasto]` de `de` em diante, um por dia. */
const dias = (de: number, gastos: number[]): [number, number][] => gastos.map((g, i) => [de + i, g]);

const conv = (o: Pick<AnuncioSpec, "adId" | "conjunto" | "adsetId" | "gasto" | "ctr" | "pixelPorReal">): AnuncioSpec => ({
  campanha: NOMES.campanha.conversao,
  campaignId: IDS.campanha.conversao,
  objective: "OUTCOME_LEADS",
  impressoesPorReal: 40,
  frequencia: 1.3,
  ...o,
});

const desc = (o: Pick<AnuncioSpec, "adId" | "campanha" | "campaignId" | "conjunto" | "adsetId" | "objective" | "gasto">): AnuncioSpec => ({
  impressoesPorReal: 120,
  frequencia: 1.6,
  ctr: 0.006,
  pixelPorReal: 0,
  ...o,
});

/** Miniatura com a validade da CDN (`oe`, hex de segundos): até 31/12/2026, vencida em 01/11/2026, ou sem `oe`. */
const miniatura = (arq: string, oe: "valida" | "vencida" | "sem") =>
  `https://scontent.xx.fbcdn.net/v/t45.1600-4/fixture-${arq}.jpg${oe === "sem" ? "" : `?oe=${oe === "valida" ? "6B359B00" : "6AE68100"}`}`;

/** A semana de produção relativa a `hoje` (a base de `producaoSemana` e de `comLive`). */
function especificacaoDaSemana(hoje: string, agora: string): Especificacao {
  const anuncios: AnuncioSpec[] = [
    // ---- conversão
    conv({
      adId: IDS.anuncio.carrosselAurora,
      conjunto: NOMES.conjunto.aurora,
      adsetId: IDS.conjunto.aurora,
      gasto: [...dias(-16, [25, 26, 24, 26, 25, 27, 26, 25, 26, 27]), ...dias(-6, [28, 27, 26, 27, 28, 30, 14])],
      ctr: 0.015,
      pixelPorReal: 1 / 13,
    }),
    conv({
      adId: IDS.anuncio.post8,
      conjunto: NOMES.conjunto.boreal,
      adsetId: IDS.conjunto.boreal,
      gasto: [...dias(-16, [24, 25, 26, 25, 24, 25, 26, 25, 24, 26]), ...dias(-6, [26, 25, 25, 24, 26, 30, 14])],
      ctr: 0.012,
      pixelPorReal: 1 / 20,
    }),
    conv({
      adId: IDS.anuncio.post4,
      conjunto: NOMES.conjunto.cerrado,
      adsetId: IDS.conjunto.cerrado,
      gasto: [...dias(-11, [5, 5, 4, 5, 6]), ...dias(-6, [6, 6, 5, 6, 6, 7, 4])],
      ctr: 0.01,
      pixelPorReal: 0,
    }),
    conv({
      adId: IDS.anuncio.post6,
      conjunto: NOMES.conjunto.delta,
      adsetId: IDS.conjunto.delta,
      // Parou em 08/11 (d = −4): nenhuma linha depois.
      gasto: [...dias(-16, [44, 46, 45, 43, 47, 45, 44, 46, 45, 44]), ...dias(-6, [50, 50, 40])],
      ctr: 0.009,
      pixelPorReal: 0,
    }),
    conv({
      adId: IDS.anuncio.carrosselMirante,
      conjunto: NOMES.conjunto.mirante,
      adsetId: IDS.conjunto.mirante,
      gasto: [...dias(-9, [9, 9, 9]), ...dias(-6, [10, 10, 10, 10, 10, 12, 8])],
      ctr: 0.011,
      pixelPorReal: 0,
    }),
    // O anúncio de DESCOBERTA do conjunto misto: impressões sem gasto (K11).
    {
      adId: IDS.anuncio.videoMirante,
      campanha: NOMES.campanha.conversao,
      campaignId: IDS.campanha.conversao,
      conjunto: NOMES.conjunto.mirante,
      adsetId: IDS.conjunto.mirante,
      objective: "OUTCOME_ENGAGEMENT",
      gasto: dias(-6, [0, 0, 0, 0, 0, 0, 0]),
      impressoesPorReal: 0,
      impressoesSemGasto: 200,
      ctr: 0.005,
      frequencia: 1.3,
      pixelPorReal: 0,
    },
    // ---- descoberta: 3 campanhas
    desc({
      adId: IDS.anuncio.video3,
      campanha: NOMES.campanha.bastidores,
      campaignId: IDS.campanha.bastidores,
      conjunto: NOMES.conjunto.envolvimento,
      adsetId: IDS.conjunto.envolvimento,
      objective: "OUTCOME_ENGAGEMENT",
      gasto: [...dias(-13, [6, 6, 6, 6, 6, 6, 6]), ...dias(-6, [8, 7, 7, 7, 7, 8, 6])],
    }),
    desc({
      adId: IDS.anuncio.reels,
      campanha: NOMES.campanha.dicas,
      campaignId: IDS.campanha.dicas,
      conjunto: NOMES.conjunto.semelhantes,
      adsetId: IDS.conjunto.semelhantes,
      objective: "POST_ENGAGEMENT",
      gasto: [...dias(-13, [5, 5, 5, 5, 5, 5, 5]), ...dias(-6, [7, 6, 6, 7, 6, 8, 5])],
    }),
    desc({
      adId: IDS.anuncio.contemplado,
      campanha: NOMES.campanha.engajamento,
      campaignId: IDS.campanha.engajamento,
      conjunto: NOMES.conjunto.amplo,
      adsetId: IDS.conjunto.amplo,
      objective: "OUTCOME_AWARENESS",
      gasto: [...dias(-13, [4, 4, 4, 4, 4, 4, 4]), ...dias(-6, [5, 5, 5, 5, 5, 6, 4])],
    }),
    desc({
      adId: IDS.anuncio.mitos,
      campanha: NOMES.campanha.engajamento,
      campaignId: IDS.campanha.engajamento,
      conjunto: NOMES.conjunto.amplo,
      adsetId: IDS.conjunto.amplo,
      objective: "OUTCOME_AWARENESS",
      gasto: dias(-6, [4, 4, 4, 4, 5, 5, 4]),
    }),
    desc({
      adId: IDS.anuncio.agenda,
      campanha: NOMES.campanha.engajamento,
      campaignId: IDS.campanha.engajamento,
      conjunto: NOMES.conjunto.amplo,
      adsetId: IDS.conjunto.amplo,
      objective: "OUTCOME_AWARENESS",
      gasto: dias(-6, [4, 3, 4, 3, 4, 4, 3]),
    }),
  ];

  const criativos: CriativoSpec[] = [
    { adId: IDS.anuncio.carrosselAurora, name: NOMES.criativo.carrossel, format: "carrossel", creativeId: IDS.criativo.carrosselAurora, thumbnailUrl: miniatura("carrossel-aurora", "valida") },
    { adId: IDS.anuncio.post8, name: NOMES.criativo.post8, format: "imagem", creativeId: IDS.criativo.post8, thumbnailUrl: miniatura("post8", "valida") },
    { adId: IDS.anuncio.post4, name: NOMES.criativo.post4, format: "imagem", creativeId: IDS.criativo.post4, thumbnailUrl: miniatura("post4", "vencida") },
    { adId: IDS.anuncio.post6, name: NOMES.criativo.post6, format: "video", creativeId: IDS.criativo.post6, videoPlays: 5400, thruPlays: 410 },
    { adId: IDS.anuncio.carrosselMirante, name: NOMES.criativo.carrossel, format: "carrossel", creativeId: IDS.criativo.carrosselMirante, thumbnailUrl: miniatura("carrossel-mirante", "sem") },
    { adId: IDS.anuncio.videoMirante, name: NOMES.criativo.video3, format: "video", creativeId: IDS.criativo.video3 },
    // A forma do bug do Gancho (F4-D14): reproduções da janela do sync ÷ impressões do período passa de 100%.
    { adId: IDS.anuncio.video3, name: NOMES.criativo.video3, format: "video", creativeId: IDS.criativo.video3, videoPlays: 31000, thruPlays: 1900, thumbnailUrl: miniatura("video3", "valida") },
    { adId: IDS.anuncio.reels, name: NOMES.criativo.reels, format: "video", creativeId: IDS.criativo.reels, videoPlays: 24000, thruPlays: 2300 },
    { adId: IDS.anuncio.contemplado, name: NOMES.criativo.contemplado, format: "imagem", creativeId: IDS.criativo.contemplado },
    { adId: IDS.anuncio.mitos, name: NOMES.criativo.mitos, format: "video", creativeId: IDS.criativo.mitos, videoPlays: 3500, thruPlays: 120 },
    { adId: IDS.anuncio.agenda, name: NOMES.criativo.agenda, format: "imagem", creativeId: IDS.criativo.agenda },
  ];

  const a = IDS.anuncio;
  const [fora1, fora2] = IDS.anuncioDeFora;
  const leads: LeadSpec[] = [
    // Carrossel da Aurora: 11 (10 com a 1ª mensagem, 3 nas últimas 24 h, 3 responderam, 1 aceitou, 1 sem WhatsApp).
    { nn: 1, d: -6, hora: "10:00", origem: { tipo: "id", adId: a.carrosselAurora, conjunto: true }, robo: "aceitou" },
    { nn: 2, d: -6, hora: "14:00", origem: { tipo: "id-no-conteudo", adId: a.carrosselAurora, nome: NOMES.criativo.carrossel }, robo: "conversou" },
    { nn: 3, d: -5, hora: "09:00", origem: { tipo: "id", adId: a.carrosselAurora }, robo: "saudado" },
    { nn: 4, d: -4, hora: "11:00", origem: { tipo: "id", adId: a.carrosselAurora, conjunto: true }, robo: "conversou" },
    { nn: 5, d: -4, hora: "16:00", origem: { tipo: "id", adId: a.carrosselAurora }, robo: "saudado" },
    { nn: 6, d: -3, hora: "10:00", origem: { tipo: "id", adId: a.carrosselAurora, conjunto: true }, robo: "semWhatsapp" },
    { nn: 7, d: -2, hora: "09:30", origem: { tipo: "id", adId: a.carrosselAurora }, robo: "saudado" },
    { nn: 8, d: -2, hora: "15:00", origem: { tipo: "id", adId: a.carrosselAurora, conjunto: true }, robo: "saudado" },
    { nn: 9, d: -1, hora: "17:00", origem: { tipo: "id", adId: a.carrosselAurora }, robo: "saudado" },
    { nn: 10, d: 0, hora: "10:00", origem: { tipo: "id", adId: a.carrosselAurora, conjunto: true }, robo: "saudado" },
    { nn: 11, d: 0, hora: "14:00", origem: { tipo: "id", adId: a.carrosselAurora }, robo: "saudado" },
    // Post de 8 palavras (Boreal): 3.
    { nn: 12, d: -5, hora: "11:00", origem: { tipo: "id", adId: a.post8, conjunto: true }, robo: "conversou" },
    { nn: 13, d: -3, hora: "15:00", origem: { tipo: "id", adId: a.post8 }, robo: "saudado" },
    { nn: 14, d: -1, hora: "09:00", origem: { tipo: "id", adId: a.post8, conjunto: true }, robo: "saudado" },
    // Post de 4 palavras (Cerrado): 1, pelo NOME único do anúncio.
    { nn: 15, d: -2, hora: "12:00", origem: { tipo: "nome", nome: NOMES.criativo.post4 }, robo: "conversou" },
    // Fora das linhas: 6 de anúncio de fora (K16), 1 macro, 1 ambíguo.
    { nn: 16, d: -6, hora: "11:00", origem: { tipo: "fora", adId: fora1 }, robo: "conversou" },
    { nn: 17, d: -5, hora: "10:00", origem: { tipo: "fora", adId: fora1 }, robo: "saudado" },
    { nn: 18, d: -4, hora: "09:00", origem: { tipo: "fora", adId: fora1 }, robo: "aceitou" },
    { nn: 19, d: -3, hora: "12:00", origem: { tipo: "fora", adId: fora2 }, robo: "saudado" },
    { nn: 20, d: -2, hora: "10:00", origem: { tipo: "fora", adId: fora2 }, robo: "conversou" },
    { nn: 21, d: -1, hora: "11:00", origem: { tipo: "fora", adId: fora1 }, robo: "saudado" },
    { nn: 22, d: -4, hora: "13:00", origem: { tipo: "macro" }, robo: "saudado" },
    { nn: 23, d: -3, hora: "16:00", origem: { tipo: "nome", nome: NOMES.criativo.carrossel }, robo: "conversou" },
    // O lead de DESCOBERTA do conjunto misto (K11) e o orgânico.
    { nn: 24, d: -2, hora: "11:00", origem: { tipo: "id", adId: a.videoMirante }, robo: "saudado" },
    { nn: 25, d: -1, hora: "10:00", origem: { tipo: "organico" }, robo: "saudado" },
    // Antes da semana: uma reunião (Aurora), um contato inválido (Boreal) e um lead de antes do robô.
    {
      nn: 26,
      d: -9,
      hora: "10:00",
      origem: { tipo: "id", adId: a.carrosselAurora, conjunto: true },
      robo: "aceitou",
      extra: (h) => ({ status: "agendado", bookedAt: brt(somarDias(h, -8), "10:00"), meetingFor: brt(somarDias(h, -6), "15:00") }),
    },
    {
      nn: 27,
      d: -8,
      hora: "10:00",
      origem: { tipo: "id", adId: a.post8, conjunto: true },
      robo: "saudado",
      extra: (h) => ({ status: "contato_invalido", lostAt: brt(somarDias(h, -7), "10:00") }),
    },
    { nn: 28, d: 0, dia: "2026-10-27", hora: "10:00", origem: { tipo: "id", adId: a.post8 }, robo: "nada" },
  ];

  return {
    hoje,
    agora,
    anuncios,
    criativos,
    leads,
    syncRuns: [syncDeAnuncios("sync-ads-1", `${hoje}T09:02:00Z`, somarDias(hoje, -16), hoje)],
    robo: roboLido(brt(hoje, "14:55")),
    metas: [],
    eventos: [],
  };
}

// ---------------------------------------------------------------- as entradas

/** A semana de produção de 12/11 (7 dias = 06/11 a 12/11). */
export function producaoSemana(): SemanaDaMidia {
  return materializar(especificacaoDaSemana(HOJE, AGORA));
}

/** Leitura do robô falhando desde 12:30 (o último ok às 12:00): "Robô sem leitura desde …" e "≥ N". */
export function comLeituraParada(): SemanaDaMidia {
  const e = especificacaoDaSemana(HOJE, AGORA);
  return materializar({ ...e, robo: roboFalhando(brt(HOJE, "12:00"), brt(HOJE, "12:30")) });
}

/** O robô desligado (sem credencial, desativado ou outra marca) — a forma de `estadoDoRoboAgora`. */
export function comRoboDesligado(): SemanaDaMidia {
  const e = especificacaoDaSemana(HOJE, AGORA);
  return materializar({ ...e, robo: { ligado: false, lidoAte: null, confiavel: false, sync: { ultimoOk: null, falha: null } } });
}

/** Os leads da semana do Carrossel da Aurora (nn 1–11) trocados por `novos`. */
function trocarAurora(e: Especificacao, novos: LeadSpec[]): Especificacao {
  return { ...e, leads: [...e.leads.filter((l) => l.nn < 1 || l.nn > 11), ...novos] };
}

/** Os `nn` dos leads da Aurora: 1–11, depois 31 em diante. */
const nnDaAurora = (i: number) => (i < 11 ? i + 1 : 31 + (i - 11));

/** Um dia e uma hora "maduros" (1ª mensagem há ≥ 24 h contra a leitura de 12/11 14:55): 06/11–10/11, das 09:00 em diante. */
const maduro = (i: number): Pick<LeadSpec, "d" | "hora"> => ({ d: -6 + (i % 5), hora: `${String(9 + Math.floor(i / 5)).padStart(2, "0")}:00` });
/** Ainda nas 24 h: hoje, de 09:00 a 14:00, de meia em meia hora. */
const nasUltimas24h = (j: number): Pick<LeadSpec, "d" | "hora"> => ({
  d: 0,
  hora: `${String(9 + Math.floor(j / 2)).padStart(2, "0")}:${j % 2 ? "30" : "00"}`,
});

/** O Carrossel da Aurora com 12 maduros e 8 respondendo (≥ 50%): o Candidato pelo robô. */
export function comCandidatoPeloRobo(): SemanaDaMidia {
  const e = especificacaoDaSemana(HOJE, AGORA);
  const novos: LeadSpec[] = Array.from({ length: 12 }, (_, i) => ({
    nn: nnDaAurora(i),
    ...maduro(i),
    origem: { tipo: "id", adId: IDS.anuncio.carrosselAurora, conjunto: i % 2 === 0 },
    robo: i < 8 ? "conversou" : "saudado",
  }));
  return materializar(trocarAurora(e, novos));
}

/**
 * O Carrossel da Aurora (barato, ≥ 10 leads) com `n` maduros e NENHUMA resposta; os
 * outros (até 11) ainda nas 24 h. K4: com 9 maduros, Manter ("CPL baixo, mas 0 de 11
 * responderam ao robô" — a fração da tabela do cartão, ÷ 1ª mensagem; a trava decide
 * com os 9 maduros); com 10+, a qualidade é ruim. `n` ≤ 40.
 */
export function comNaoResponde(n: number): SemanaDaMidia {
  const e = especificacaoDaSemana(HOJE, AGORA);
  const total = Math.max(11, n);
  const novos: LeadSpec[] = Array.from({ length: total }, (_, i) => ({
    nn: nnDaAurora(i),
    ...(i < n ? maduro(i) : nasUltimas24h(i - n)),
    origem: { tipo: "id", adId: IDS.anuncio.carrosselAurora, conjunto: i % 2 === 0 },
    robo: "saudado",
  }));
  return materializar(trocarAurora(e, novos));
}

/** O Carrossel da Aurora (barato) com os 11 leads SEM telefone (nem o robô os alcança) — K4. */
export function comSemTelefone(): SemanaDaMidia {
  const e = especificacaoDaSemana(HOJE, AGORA);
  const novos: LeadSpec[] = Array.from({ length: 11 }, (_, i) => ({
    nn: nnDaAurora(i),
    ...maduro(i),
    origem: { tipo: "id", adId: IDS.anuncio.carrosselAurora, conjunto: i % 2 === 0 },
    robo: "nada",
    extra: () => ({ phone: undefined }),
  }));
  return materializar(trocarAurora(e, novos));
}

/**
 * `n` reuniões agendadas na semana (11/11) por id no Carrossel da Aurora, e a conta
 * EXIBÍVEL: com n < 3, os leads de anúncio de fora completam 3 reuniões de conversão
 * (contam na conta, em nenhuma linha).
 */
export function comReunioes(n: number): SemanaDaMidia {
  const e = especificacaoDaSemana(HOJE, AGORA);
  const agendou = (h: string): Partial<Lead> => ({
    status: "agendado",
    bookedAt: brt(somarDias(h, -1), "12:00"),
    meetingFor: brt(somarDias(h, 2), "10:00"),
  });
  const extras: LeadSpec[] = Array.from({ length: Math.max(0, n - 11) }, (_, i) => ({
    nn: 31 + i,
    ...maduro(i),
    origem: { tipo: "id", adId: IDS.anuncio.carrosselAurora, conjunto: true },
    robo: "aceitou",
  }));
  const aurora = e.leads.filter((l) => l.nn >= 1 && l.nn <= 11).map((l) => l.nn);
  const naAurora = new Set([...aurora, ...extras.map((l) => l.nn)].slice(0, n));
  const deFora = new Set(e.leads.filter((l) => l.origem.tipo === "fora").map((l) => l.nn).slice(0, Math.max(0, 3 - n)));
  const leads = [...e.leads, ...extras].map((l) =>
    naAurora.has(l.nn) || deFora.has(l.nn) ? { ...l, robo: "aceitou" as const, extra: agendou } : l,
  );
  return materializar({ ...e, leads });
}

/**
 * `r` reuniões agendadas na semana de leads que chegaram SÓ com o nome do anúncio
 * (o post de 8 palavras, nome único): o lead entra na linha, a reunião não (K41).
 */
export function comReunioesSoPorNome(r: number): SemanaDaMidia {
  const e = especificacaoDaSemana(HOJE, AGORA);
  const novos: LeadSpec[] = Array.from({ length: r }, (_, i) => ({
    nn: 51 + i,
    ...maduro(i),
    origem: { tipo: "nome", nome: NOMES.criativo.post8 },
    robo: "aceitou",
    extra: (h) => ({ status: "agendado", bookedAt: brt(somarDias(h, -1), "12:00"), meetingFor: brt(somarDias(h, 2), "10:00") }),
  }));
  return materializar({ ...e, leads: [...e.leads, ...novos] });
}

/**
 * Dias do período sem linha e sem cobertura, > 10% (K13): nenhuma linha em 09/11 e
 * 10/11; o sync de 10/11 cobriu até 08/11 e o de 12/11 pediu só 11–12/11 (não cobre
 * nada: a Meta atrasa 2 dias). Em 7 dias, 2 de 6 dias sem dado → piso. Com o período
 * livre `2026-11-09..2026-11-10`, investimento 0 com piso (K6).
 */
export function comPisoDeGasto(): SemanaDaMidia {
  const e = especificacaoDaSemana(HOJE, AGORA);
  const anuncios = e.anuncios.map((a) => ({ ...a, gasto: a.gasto.filter(([d]) => d !== -3 && d !== -2) }));
  const syncRuns = [
    syncDeAnuncios("sync-ads-1", `${somarDias(HOJE, -2)}T09:02:00Z`, somarDias(HOJE, -16), somarDias(HOJE, -2)),
    syncDeAnuncios("sync-ads-2", ULTIMO_SYNC_ADS, somarDias(HOJE, -1), HOJE),
  ];
  return materializar({ ...e, anuncios, syncRuns });
}

/**
 * A live no ar: 20/11 (`HOJE_LIVE`), a semana de produção deslocada para 14–20/11,
 * a campanha `[LIVE] Captação` com 2 conjuntos (16–20/11, ≈ R$ 250/dia), 12
 * inscritos com classe (A/B, imóvel) e um criativo MISTO: o MESMO `creativeId` do
 * Carrossel da Aurora num anúncio da live (K20). `cfgLive` = `LIVE_PADRAO`.
 */
export function comLive(): SemanaDaMidia {
  const e = especificacaoDaSemana(HOJE_LIVE, AGORA_LIVE);
  const live = (adId: string, conjunto: string, adsetId: string, gasto: number[]): AnuncioSpec => ({
    adId,
    campanha: NOMES.campanha.live,
    campaignId: IDS.campanha.live,
    conjunto,
    adsetId,
    objective: "OUTCOME_LEADS",
    gasto: dias(-4, gasto),
    impressoesPorReal: 35,
    ctr: 0.013,
    frequencia: 1.2,
    pixelPorReal: 1 / 18,
  });
  const anuncios = [
    ...e.anuncios,
    live(IDS.anuncio.c4a, NOMES.conjunto.imovelAberto, IDS.conjunto.imovelAberto, [100, 105, 98, 102, 60]),
    live(IDS.anuncio.c4b, NOMES.conjunto.persona, IDS.conjunto.persona, [90, 88, 92, 95, 50]),
    live(IDS.anuncio.carrosselLive, NOMES.conjunto.imovelAberto, IDS.conjunto.imovelAberto, [60, 62, 58, 61, 30]),
  ];
  const criativos: CriativoSpec[] = [
    ...e.criativos,
    { adId: IDS.anuncio.c4a, name: NOMES.criativo.c4a, format: "video", creativeId: IDS.criativo.c4a, videoPlays: 8800, thruPlays: 600 },
    { adId: IDS.anuncio.c4b, name: NOMES.criativo.c4b, format: "imagem", creativeId: IDS.criativo.c4b },
    // O criativo MISTO (K20): o mesmo `creativeId` do Carrossel da Aurora.
    { adId: IDS.anuncio.carrosselLive, name: NOMES.criativo.carrossel, format: "carrossel", creativeId: IDS.criativo.carrosselAurora },
  ];
  const anuncioDoInscrito = (i: number) => (i < 5 ? IDS.anuncio.c4a : i < 9 ? IDS.anuncio.c4b : IDS.anuncio.carrosselLive);
  const inscritos: LeadSpec[] = Array.from({ length: 12 }, (_, i) => ({
    nn: 61 + i,
    d: -4 + (i % 5),
    hora: `${String(10 + Math.floor(i / 5)).padStart(2, "0")}:15`,
    origem: { tipo: "id", adId: anuncioDoInscrito(i), conjunto: true },
    robo: "nada",
    extra: () => ({ classe: i % 3 === 2 ? "B" : "A", bem: "imovel" }),
  }));
  return materializar({ ...e, anuncios, criativos, leads: [...e.leads, ...inscritos] });
}

// ---------------------------------------------------------------- pior caso de texto

/**
 * O pior caso do orçamento de palavras (§2.7): 7 criativos de conversão no ar, cada
 * um em 2 conjuntos (" +1" na desambiguação) e TODOS com homônimo (nomes de 8+
 * palavras); 3 candidatos (D9, 12 leads a ≈ 0,6× a média) com 1 reunião cada (a
 * conta fica com 3 reuniões: custo por reunião exibível); 2 fadigados (CTR caiu
 * pela metade com frequência 2,4: "Trocar arte"); 1 Manter, 1 Cedo e 1 que parou
 * em 06/11 (Pausados). A leitura do robô parada, o último sync de anúncios OK em
 * 11/11 (título "no ar em 11/11"), orçamento de conversão cadastrado e 20 leads
 * de anúncio de fora (> 25%: o " ⚠" do título da verba). O conjunto "Engajados…"
 * leva ≈ 20% da verba e ≈ 4% dos leads (o destaque).
 */
export function piorCasoDeTexto(): SemanaDaMidia {
  const hoje = HOJE;
  const camp = "[ACM] CP9 - Leads Imóveis Planejados";
  const campId = "71000101";
  const S = {
    s1: ["Imóveis Planejados Interesses 30-55 Brasil", "72000101"],
    s2: ["Investidores Renda Complementar Capitais", "72000102"],
    s3: ["Remarketing Visitantes Página 30 dias", "72000103"],
    s4: ["Semelhantes Compradores Carta 1%", "72000104"],
    s5: ["Interesses Amplos Financiamento Casa", "72000105"],
    s6: ["Aberto Nacional Faixa 25-60", "72000106"],
    s7: ["Engajados Instagram Últimos 90 Dias Capitais", "72000107"],
  } as const;
  const NOME_A = "Vídeo depoimento cliente contemplado no primeiro mês do grupo";
  const NOME_B = "Carrossel seis motivos para planejar a compra do imóvel";
  const NOME_C = "Imagem simulação de parcela para carta de crédito imobiliário";

  interface K {
    k: number;
    nome: string;
    formato: CreativeFormat;
    creativeId: string;
    /** [conjunto, gasto por dia no período, leads] por anúncio. */
    ads: [keyof typeof S, number, number][];
    fadigado?: boolean;
    reuniao?: boolean;
    parou?: boolean;
  }
  const ks: K[] = [
    { k: 1, nome: NOME_A, formato: "video", creativeId: "74100011", ads: [["s1", 16, 7], ["s2", 14, 5]], reuniao: true },
    { k: 2, nome: NOME_A, formato: "video", creativeId: "74100022", ads: [["s3", 17, 7], ["s4", 14, 5]], reuniao: true },
    { k: 3, nome: NOME_B, formato: "carrossel", creativeId: "74100033", ads: [["s5", 18, 7], ["s6", 14, 5]], reuniao: true },
    { k: 4, nome: NOME_C, formato: "imagem", creativeId: "74100044", ads: [["s7", 33, 2], ["s1", 17, 6]], fadigado: true },
    { k: 5, nome: NOME_C, formato: "imagem", creativeId: "74100055", ads: [["s2", 26, 4], ["s3", 22, 3]], fadigado: true },
    { k: 6, nome: NOME_B, formato: "carrossel", creativeId: "74100066", ads: [["s4", 11, 2], ["s5", 9, 1]] },
    { k: 7, nome: NOME_B, formato: "carrossel", creativeId: "74100077", ads: [["s6", 6, 1], ["s7", 4, 0]] },
    { k: 8, nome: "Imagem lance embutido explicado em três passos simples", formato: "imagem", creativeId: "74100088", ads: [["s7", 48, 0]], parou: true },
  ];

  const anuncios: AnuncioSpec[] = [];
  const criativos: CriativoSpec[] = [];
  const leads: LeadSpec[] = [];
  let nn = 101;
  for (const c of ks) {
    c.ads.forEach(([s, porDia, nLeads], i) => {
      const adId = `7310${c.k}${i}0${c.k}`;
      const [conjunto, adsetId] = S[s];
      // Período (06–11/11; o sync de ontem não trouxe 12/11) e os 7 dias anteriores, para as janelas da fadiga.
      const gasto: [number, number][] = c.parou
        ? [...dias(-13, [40, 40, 40, 40, 40, 40, 40]), [-6, porDia]]
        : [...dias(-13, Array<number>(7).fill(porDia)), ...dias(-6, Array<number>(6).fill(porDia))];
      const base: AnuncioSpec = {
        adId,
        campanha: camp,
        campaignId: campId,
        conjunto,
        adsetId,
        objective: "OUTCOME_LEADS",
        gasto,
        impressoesPorReal: 40,
        ctr: 0.012,
        frequencia: 1.3,
        pixelPorReal: 0,
      };
      if (c.fadigado) {
        // CTR 2% nos 7 dias anteriores e 1% no período, com frequência 2,4: fadigado.
        anuncios.push({ ...base, gasto: gasto.filter(([d]) => d < -6), ctr: 0.02 });
        anuncios.push({ ...base, gasto: gasto.filter(([d]) => d >= -6), ctr: 0.01, frequencia: 2.4 });
      } else anuncios.push(base);
      criativos.push({ adId, name: c.nome, format: c.formato, creativeId: c.creativeId, thumbnailUrl: miniatura(`pior-${c.k}-${i}`, "valida") });
      for (let j = 0; j < nLeads; j++) {
        const reuniao = c.reuniao && i === 0 && j === 0;
        leads.push({
          nn: nn++,
          ...maduro(j + i * 3),
          origem: { tipo: "id", adId, conjunto: j % 2 === 0 },
          robo: j % 3 === 0 ? "conversou" : "saudado",
          ...(reuniao
            ? { extra: (h: string) => ({ status: "agendado" as const, bookedAt: brt(somarDias(h, -2), "12:00"), meetingFor: brt(somarDias(h, 3), "10:00") }) }
            : {}),
        });
      }
    });
  }
  // 20 leads de anúncio de fora das linhas: 20 de 75 > 25%.
  for (let i = 0; i < 20; i++) {
    leads.push({ nn: nn++, ...maduro(i), origem: { tipo: "fora", adId: IDS.anuncioDeFora[i % 2] }, robo: "saudado" });
  }

  const orcamento: Meta = {
    id: "meta-orcamento-conversao",
    brand: MARCA,
    metrica: "investimento_conversao",
    periodo: "semana",
    alvo: 1500,
    vigenteDesde: "2026-10-01",
    provisoria: false,
    origem: "manual",
    criadaEm: "2026-10-01T12:00:00.000Z",
    criadaPor: "fixture",
  };

  return materializar({
    hoje,
    agora: AGORA,
    anuncios,
    criativos,
    leads,
    // O último sync OK foi ontem às 06:02: cobre até 09/11, e não há linha de 12/11.
    syncRuns: [syncDeAnuncios("sync-ads-1", "2026-11-11T09:02:00Z", somarDias(hoje, -20), somarDias(hoje, -1))],
    robo: roboFalhando(brt(hoje, "12:00"), brt(hoje, "12:30")),
    metas: [orcamento],
    eventos: [],
  });
}

// ---------------------------------------------------------------- o carregador (K22)

/** O relógio fixo de `fase4-midia-carregador` (o lead de 05/11 fica nos 30 dias). */
export const AGORA_DO_CARREGADOR = "2026-11-06T15:00:00.000Z";

/**
 * O que o carregador grava pelo store no `beforeAll` (K22): o seed só tem anúncios
 * de 09/07 a 23/07. Uma linha de conversão em 05/11, o criativo dela e um lead de
 * 05/11 com o `adId` dela, telefone utilizável e as colunas do robô (visto e
 * saudado, como a Fase 3 grava por `updateLeadsRobo`).
 */
export function dadosDoCarregador(): { adDaily: AdDaily[]; creative: Creative; lead: Lead } {
  const adId = "73000091";
  const criado = brt("2026-11-05", "10:00");
  return {
    adDaily: [
      {
        brand: MARCA,
        date: "2026-11-05",
        campaign: NOMES.campanha.conversao,
        campaignId: IDS.campanha.conversao,
        adset: NOMES.conjunto.aurora,
        adsetId: IDS.conjunto.aurora,
        adId,
        objective: "OUTCOME_LEADS",
        spend: 42,
        impressions: 1680,
        reach: 1292,
        frequency: 1.3,
        clicks: 25,
        leads: 2,
      },
    ],
    creative: { adId, brand: MARCA, name: "Post Simule sua carta agora", format: "imagem", creativeId: "74000091" },
    lead: pessoa(90, criado, {
      ...PAGO,
      adId,
      utmContent: adId,
      roboVistoEm: maisMin(criado, 3),
      roboRecebidoEm: maisMin(criado, 1),
      roboSaudacaoEm: maisMin(criado, 2),
      roboEtapa: "nao_respondeu",
    }),
  };
}

// ---------------------------------------------------------------- período e entrada do processo

/** O período de uma chave sobre uma entrada (a mesma conta da página: `pageRange` + `kpisDoPeriodo`). */
export function periodoDa(
  p: SemanaDaMidia,
  chave = "7d",
): { range: DateRange | undefined; rangeKey: string; naoComecou: boolean; kpis: KpisDoPeriodo } {
  const { range, rangeKey, naoComecou } = pageRange(p.data, chave, p.hoje);
  const kpis = kpisDoPeriodo(p.data, range, { hoje: p.hoje, agora: p.agora, cobertura: p.cobertura });
  return { range, rangeKey, naoComecou, kpis };
}

/** A entrada de `funilDoProcesso` (e do trecho do robô por linha) sobre uma entrada da Mídia. */
export function entradaDoProcessoDa(p: SemanaDaMidia, chave = "7d"): EntradaDoProcesso {
  const { range, kpis } = periodoDa(p, chave);
  return { data: p.data, range, kpis, eventos: p.eventos, robo: p.robo, agora: p.agora };
}
