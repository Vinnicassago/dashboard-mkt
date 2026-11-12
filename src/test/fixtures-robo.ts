/**
 * Fixtures do Início e do Funil (fora da coleta do vitest, que só pega `*.test.ts`).
 * Movidos de `fase2-inicio-tela.test.ts` (Fase 3, §8.0) para as duas telas rodarem
 * sobre a MESMA base:
 *
 *   • o robô de fixture — as colunas `robo_*` que o sync grava no lead (nunca o
 *     banco do robô): `LEADS_DO_ROBO`, `ROBO` (leitura em dia), `PARADO` (falhando),
 *     `ATRASADO` (parada há 90 min, ainda "confiável"), `NUNCA_LIDO`;
 *   • o seed da marca consorcio (`entradaDoSeed`), com o robô desligado.
 *
 * Todo lead tem nome ÚNICO (`Fulano-<id>-zq`): a busca por "nenhum nome no payload"
 * não colide com texto da tela. "Fulano" sozinho é nome de teste (`pareceTeste`);
 * "Fulano-<id>-zq" não é.
 *
 * ATENÇÃO: `fase3-paridade-inicio.test.ts` (o golden do Início) roda sobre estes
 * fixtures. Não mude os que existem — acrescente novos.
 */
import { buildSeedData, buildSeedLeadEvents } from "@/lib/data/seed";
import { montarFilaDaLive } from "@/lib/fila-live";
import type { EntradaInicio } from "@/lib/inicio";
import { kpisDoPeriodo } from "@/lib/kpis";
import type { DateRange } from "@/lib/metrics";
import { pageRange } from "@/lib/page-range";
import type { RoboAgora } from "@/lib/robo/situacao";
import { EXPEDIENTE_PADRAO } from "@/lib/turno";
import type { Intervalo } from "@/lib/cobertura";
import type { AdDaily, DashboardData, Lead, LeadEvent } from "@/lib/types";

/** O instante ISO de `dia` às `hhmm` em Brasília (UTC−3). */
export const brt = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();

export function base(over: Partial<DashboardData> = {}): DashboardData {
  return {
    campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-09-01", budgetTotal: 0 },
    igAccountDaily: [],
    igPosts: [],
    adDaily: [],
    creatives: [],
    lpDaily: [],
    leads: [],
    goals: [],
    metas: [],
    updatedAt: "2026-10-08T12:00:00.000Z",
    ...over,
  };
}

export const ad = (date: string, adId: string, spend: number, extra: Partial<AdDaily> = {}): AdDaily => ({
  brand: "consorcio",
  date,
  campaign: "Campanha",
  adset: "Conjunto",
  adId,
  objective: "OUTCOME_LEADS",
  spend,
  impressions: 1000,
  reach: 800,
  frequency: 1.25,
  clicks: 10,
  leads: 1,
  ...extra,
});

export function porMarca(d: DashboardData, brand: string): DashboardData {
  return {
    ...d,
    campaign: { ...d.campaign, brand },
    igAccountDaily: d.igAccountDaily.filter((r) => r.brand === brand),
    igPosts: d.igPosts.filter((r) => r.brand === brand),
    adDaily: d.adDaily.filter((r) => r.brand === brand),
    creatives: d.creatives.filter((r) => r.brand === brand),
    lpDaily: d.lpDaily.filter((r) => r.brand === brand),
    leads: d.leads.filter((r) => r.brand === brand && !r.deletedAt),
    goals: d.goals.filter((r) => r.brand === brand),
  };
}

// ---------------------------------------------------------------- o robô de fixture

export const HOJE = "2026-11-04"; // quarta
export const ONTEM = "2026-11-03";
export const AGORA = brt(HOJE, "15:00");
export const LIDO = brt(HOJE, "14:55");
/** Leitura em dia (5 min atrás). */
export const ROBO: RoboAgora = { ligado: true, lidoAte: LIDO, confiavel: true, sync: { ultimoOk: LIDO, falha: null } };
/** Leitura falhando desde 12:30 (o último ok às 12:00). */
export const PARADO: RoboAgora = {
  ligado: true,
  lidoAte: brt(HOJE, "12:00"),
  confiavel: false,
  sync: { ultimoOk: brt(HOJE, "12:00"), falha: { desde: brt(HOJE, "12:30"), erro: "timeout" } },
};
/** Leitura parada há 90 min (> 45 min), sem falha, ainda "confiável" (≤ 2 h): a régua mede contra ela. */
export const ATRASADO: RoboAgora = {
  ligado: true,
  lidoAte: brt(HOJE, "13:30"),
  confiavel: true,
  sync: { ultimoOk: brt(HOJE, "13:30"), falha: null },
};
/** Ligado e nunca lido. */
export const NUNCA_LIDO: RoboAgora = { ligado: true, lidoAte: null, confiavel: false, sync: { ultimoOk: null, falha: null } };
export const SEMANA: DateRange = { from: "2026-10-29", to: HOJE };

let seq = 0;
/** Um lead com nome único, e-mail e um telefone por pessoa (a Fila junta quem tem o mesmo telefone). */
export const lead = (id: string, over: Partial<Lead> = {}): Lead => ({
  id,
  brand: "consorcio",
  createdAt: brt(HOJE, "09:00"),
  name: `Fulano-${id}-zq`,
  email: `pessoa.${id}@exemplo.com.br`,
  phone: `55119888${String(++seq).padStart(5, "0")}`,
  status: "lead",
  utmSource: "meta",
  utmContent: "Anúncio com um nome bem comprido para a coluna de origem truncar",
  ...over,
});
/** Visto e saudado pelo robô às 09:00 de `dia`. */
export const saudado = (dia: string, over: Partial<Lead> = {}): Partial<Lead> => ({
  createdAt: brt(dia, "09:00"),
  roboVistoEm: brt(dia, "09:05"),
  roboRecebidoEm: brt(dia, "09:00"),
  roboSaudacaoEm: brt(dia, "09:00"),
  roboEtapa: "nao_respondeu",
  ...over,
});
/** O evento `reaberto` de um lead (`actor`: `ATOR_LP`/`ATOR_N8N` = inscrição nova; outro = o painel). */
export const reaberto = (leadId: string, quando: string, actor: string): LeadEvent => ({
  id: `R-${leadId}`,
  leadId,
  leadName: "x",
  actor,
  action: "reaberto",
  createdAt: quando,
});

export const LEADS_DO_ROBO: Lead[] = [
  lead("conversa", {
    ...saudado(HOJE),
    roboRespondeuEm: brt(HOJE, "09:30"),
    roboUltimaMsgClienteEm: brt(HOJE, "12:00"),
    roboUltimaInteracaoEm: brt(HOJE, "12:00"),
    roboEtapa: "em_conversa",
  }),
  lead("esperando", saudado(HOJE)),
  lead("semresposta", saudado(ONTEM)),
  lead("aceitou", {
    ...saudado(ONTEM),
    roboRespondeuEm: brt(ONTEM, "09:10"),
    roboUltimaMsgClienteEm: brt(HOJE, "13:00"),
    roboUltimaInteracaoEm: brt(HOJE, "13:00"),
    roboConviteEm: brt(HOJE, "12:00"),
    roboAceitouEm: brt(HOJE, "13:00"),
    roboEtapa: "transferido",
  }),
  lead("naofalou", { createdAt: brt(HOJE, "11:00") }),
  lead("naorecebeu", { createdAt: brt(HOJE, "14:30") }),
  lead("novinho", { createdAt: brt(HOJE, "14:50") }),
  lead("semtel", { createdAt: brt(HOJE, "10:00"), phone: undefined }),
  lead("liveA", { createdAt: brt(HOJE, "10:00"), classe: "A", bem: "imovel" }),
  lead("liveB", { createdAt: brt(ONTEM, "16:00"), classe: "B", bem: "imovel" }),
  lead("agendado", {
    ...saudado("2026-11-01"),
    roboRespondeuEm: brt("2026-11-01", "09:10"),
    roboAceitouEm: brt("2026-11-01", "10:00"),
    roboEtapa: "transferido",
    status: "agendado",
    bookedAt: brt("2026-11-02", "10:00"),
    meetingFor: brt("2026-11-05", "10:00"),
  }),
  // Teste pelo e-mail (`pareceTeste`): o nome é o único da base, como todos.
  lead("teste", { createdAt: brt(HOJE, "13:00"), email: "teste@teste.com" }),
  lead("antes", { createdAt: brt("2026-10-20", "10:00") }),
];

export const ADS_DA_SEMANA = [ad("2026-10-30", "100001", 80), ad("2026-11-01", "100001", 100), ad("2026-11-02", "100001", 100), ad(ONTEM, "100001", 100), ad(HOJE, "100001", 50)];

/**
 * A semana ANTERIOR (22–28/10) com verba, leads e uma reunião: todos os cartões
 * ganham a seta — o pior caso do orçamento de palavras, junto com o fato do custo.
 */
export const ADS_DA_ANTERIOR = ["2026-10-22", "2026-10-24", "2026-10-26", "2026-10-28"].map((d) => ad(d, "100001", 90));
export const LEADS_DA_ANTERIOR: Lead[] = [
  lead("ant1", { createdAt: brt("2026-10-23", "10:00") }),
  lead("ant2", { createdAt: brt("2026-10-24", "10:00") }),
  lead("ant3", { createdAt: brt("2026-10-25", "10:00"), status: "agendado", bookedAt: brt("2026-10-26", "10:00"), meetingFor: brt("2026-10-30", "10:00") }),
];

/** `robo: null` = o robô desligado (sem credencial, desativado ou outra marca). */
export function entradaDoRobo(
  robo: RoboAgora | null = ROBO,
  range: DateRange | null = SEMANA,
  over: { leads?: Lead[]; adDaily?: AdDaily[]; eventos?: LeadEvent[] } = {},
): EntradaInicio {
  const data = base({ leads: over.leads ?? LEADS_DO_ROBO, adDaily: over.adDaily ?? ADS_DA_SEMANA });
  const eventos: LeadEvent[] = over.eventos ?? [];
  return {
    data,
    range: range ?? undefined,
    rangeKey: range ? `${range.from}..${range.to}` : "all",
    kpis: kpisDoPeriodo(data, range ?? undefined, { hoje: HOJE, agora: AGORA, comparar: true }),
    eventos,
    robo: robo ?? undefined,
    cobertura: [{ from: "2026-10-01", to: ONTEM }],
    expediente: EXPEDIENTE_PADRAO,
    filaLive: montarFilaDaLive(data.leads, eventos, AGORA, EXPEDIENTE_PADRAO),
    agora: AGORA,
    hoje: HOJE,
  };
}

// ---------------------------------------------------------------- o seed (robô desligado)

export const SEED = porMarca(buildSeedData(), "consorcio");
export const SEED_EVENTOS = buildSeedLeadEvents(SEED.leads);
export const SEED_HOJE = "2026-07-23";
export const SEED_AGORA = brt(SEED_HOJE, "15:00");
export const SEED_COBERTURA: Intervalo[] = [{ from: "2026-07-09", to: "2026-07-21" }];

export function entradaDoSeed(chave: string): EntradaInicio {
  const { range, rangeKey } = pageRange(SEED, chave, SEED_HOJE);
  return {
    data: SEED,
    range,
    rangeKey,
    kpis: kpisDoPeriodo(SEED, range, { cobertura: SEED_COBERTURA, hoje: SEED_HOJE, agora: SEED_AGORA, comparar: true }),
    eventos: SEED_EVENTOS,
    cobertura: SEED_COBERTURA,
    expediente: EXPEDIENTE_PADRAO,
    filaLive: montarFilaDaLive(SEED.leads, SEED_EVENTOS, SEED_AGORA, EXPEDIENTE_PADRAO),
    agora: SEED_AGORA,
    hoje: SEED_HOJE,
  };
}
