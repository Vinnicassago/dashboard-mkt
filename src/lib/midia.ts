/**
 * Mídia (Fase 4, nov/26) — "o que faço com a verba esta semana?". Puro: tudo o
 * que a página /midia mostra sai de `montarMidiaDaTela`, e a página só carrega
 * (`carregarMidia`, `lib/midia-server.ts`) e renderiza. Os TIPOS da tela, as colunas
 * e os helpers que o client lê moram em `lib/midia-tela.ts` (reexportado aqui): os
 * clients nunca importam valor daqui.
 *
 * As peças, na ordem da tela:
 *   1. `montarMidiaDaTela` — a tela inteira, de uma entrada só;
 *   2. `linhaDoResumo` — o resumo em UMA linha, com os números do Início
 *      (`kpisDoPeriodo`, `fatoDoCustoPorReuniao`): o investimento de CONVERSÃO, o
 *      CPL e o fato do custo por reunião;
 *   3. `paraOndeVaiAVerba` — % da verba × % dos leads de conversão por conjunto NO
 *      AR, a live numa linha só, "Fora do ar" e "Fora das linhas" (a MESMA passada
 *      de `foraDasLinhasDeConversao`: D + n = leads de conversão por construção);
 *   4. os criativos no ar com o sinal (`criativosComSinal` — a ÚNICA montagem: a
 *      página, o motor e a IA chamam esta; o sinal sai de `lib/sinal-do-criativo.ts`
 *      e o "no ar" de `lib/veiculacao.ts`);
 *   5. os recolhidos — a live, "Pausados no período" e "Detalhes"
 *      (`separarPorVeiculacao`: uma linha pausada mora num lugar só).
 *
 * UMA regra de atribuição de reunião em toda a tela e no motor (relatório §7.3): a
 * reunião só entra num conjunto, num criativo ou numa ação quando o lead tem id de
 * anúncio (`lead.adId`, "nome|id" no utm_content ou o `adsetId` da UTM padrão).
 * Nome único ainda atribui o LEAD — nunca a reunião.
 *
 * Regras de exibição: custo com denominador zero é `null` ("—"); custo por reunião só
 * com `MIN_REUNIOES` na LINHA e a conta fora de quarentena; CPL de uma linha só com
 * 3+ leads (`textoDoCplDaLinha`); "Leads (painel)" e "Conversões Meta (Pixel)" são
 * colunas diferentes. O motor (M2, M4) lê `conjuntosPorId` daqui: a ação cita a linha
 * com o mesmo número e leva à âncora onde ela MORA na página (`ancoraDoConjunto`,
 * `ancoraDoCriativo`: no ar em Detalhes ou nos cartões, parada em Pausados, a live no
 * bloco dela).
 *
 * Um criativo que roda em conversão E em descoberta (o mesmo `creativeId`) vira duas
 * linhas, como o da live: a de descoberta tem a chave `desc|…` e fica fora do sinal e
 * da média. Na verba, o gasto de um conjunto é o de CONVERSÃO (`gastoConversao`): Σ das
 * linhas da verba = o investimento de conversão, também num conjunto misto.
 */

import {
  baldeDosLeads,
  bucketOfAd,
  computeFatigue,
  creativePerformance,
  dailySeries,
  filterAds,
  filterLeads,
  fimDoPeriodo,
  reunioesNoPeriodo,
  rotuloCriativo,
  trechosSemDado,
  trechosSemVeiculacao,
  REGRA_FADIGA,
  type CreativePerf,
  type DateRange,
  type ObjectiveBucket,
} from "./metrics";
import {
  custoExibivel,
  fatoDoCustoPorReuniao,
  kpisDoPeriodo,
  mostrar,
  reguaDoPeriodo,
  type KpisDoPeriodo,
  type LinhaDaRegua,
  type Medida,
  type OpcoesKpis,
} from "./kpis";
import { atribuidor, type TipoAtribuicao } from "./atribuicao";
import type { Intervalo } from "./cobertura";
import type { AvaliacaoMeta } from "./metas";
import { MIN_REUNIOES } from "./trust";
import { ultimasSemanas } from "./semana";
import { formatCurrency, formatCurrency0, formatDateTimeCurta, formatInt } from "./format";
import { diaDoLead } from "./horario-util";
import { dicaDoRecorteDoRobo, textoDaTaxa, trechoDoRoboPorLinha } from "./funil-processo";
import { ehDaLive, type CampanhaDaLive } from "./live";
import { criativosDaLive } from "./criativos-live";
import { alertaForaDasLinhas, alertaReunioesSoPorNome, alertasDeAtribuicao, alertasDeConfianca, type Alerta } from "./alertas";
import { linkDeConfiguracoes } from "./configuracoes";
import { comPeriodo, parseCustomRange } from "./range";
import { isAwareness } from "./brands";
import {
  AMOSTRA_DE_PESSOAS,
  ORDEM_DO_SINAL,
  leituraDaQualidade,
  mediaDosCriativos,
  porqueSemMedia,
  sinalDoCriativo,
  textoDaReguaDoSinal,
  type ContagemDoTrecho,
  type MediaDosCriativos,
  type TrechoPorLinha,
} from "./sinal-do-criativo";
import { janelaNoAr, noArTexto, refDaVeiculacao, veiculacaoNoFim, type Veiculacao } from "./veiculacao";
import { textoDoCplDaLinha } from "./midia-tela";
import type {
  CardDoCriativo,
  CriativosNoArDaTela,
  DetalhesDaTela,
  EntradaDosSinais,
  EntradaMidia,
  ForaDasLinhasDeConversao,
  LinhaCriativo,
  LinhaDaVerba,
  LinhaMidia,
  MidiaDaTela,
  MidiaParaIA,
  MotivoForaDaLinha,
  PausadosDaTela,
  QualidadeDaLinha,
  RoboNosCriativos,
  VerbaDaTela,
} from "./midia-tela";
import type { AdDaily, DashboardData, Lead } from "./types";

export * from "./midia-tela";

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const dm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const plural = (n: number, um: string, varios: string) => `${formatInt(n)} ${n === 1 ? um : varios}`;

// ---------------------------------------------------------------- 1. resumo

/**
 * As peças do resumo (sem status de meta: F4-D16 — a Mídia não mostra meta). A tela lê
 * o texto de `linhaDoResumo`; os testes do Início e da Mídia leem o CPL, o fato do
 * custo por reunião e o ritmo daqui.
 */
export interface ResumoMidia {
  /** Investimento total do período (conversão + descoberta), já com "≥" se for piso. */
  investimento: { texto: string; medida: Medida };
  conversao: number;
  descoberta: number;
  cpl: { texto: string; medida: Medida };
  /**
   * O custo por reunião quando se sustenta; senão o FATO (decisão 4.2,
   * `fatoDoCustoPorReuniao`): "R$ 160 investidos em conversão · 1 reunião de
   * conversão" — nunca a razão abaixo de `MIN_REUNIOES`.
   */
  custoPorReuniao: { exibivel: boolean; texto: string; n: number; medida: Medida };
  /**
   * Ritmo do período contra o orçamento de conversão (meta `investimento_conversao`).
   * `null` = sem orçamento cadastrado. A tela lê só `alvo` e `parcial` ("(orçamento
   * R$ X)" colado ao investimento de conversão, F4-D15); `gasto` e `avaliacao` ficam
   * para os testes do B9 (a M7, dormente, lê `reguaDoPeriodo` direto).
   */
  ritmo: {
    gasto: number;
    alvo: number;
    parcial: boolean;
    avaliacao?: AvaliacaoMeta;
  } | null;
}

export function resumoDaMidia(kp: KpisDoPeriodo, regua: LinhaDaRegua[]): ResumoMidia {
  // O MESMO fato do cartão de Reuniões do Início (`fatoDoCustoPorReuniao`): a razão
  // no número quando se sustenta, senão o investido e as reuniões de conversão.
  const custo = fatoDoCustoPorReuniao(kp);
  const ritmo = regua.find((l) => l.metrica === "investimento_conversao");
  return {
    investimento: { texto: mostrar(kp.investimento, "moeda0"), medida: kp.investimento },
    conversao: kp.investimentoConversao.valor,
    descoberta: kp.investimentoDescoberta.valor,
    cpl: { texto: mostrar(kp.cpl, "moeda"), medida: kp.cpl },
    custoPorReuniao: {
      exibivel: custo.exibivel,
      texto: custo.exibivel ? custo.valor : custo.fato,
      n: custo.n,
      medida: kp.custoPorReuniao,
    },
    ritmo:
      ritmo && ritmo.alvo != null
        ? { gasto: ritmo.medida.valor, alvo: ritmo.alvo, parcial: ritmo.parcial, avaliacao: ritmo.avaliacao }
        : null,
  };
}

/**
 * A linha do resumo (§2.2, caso 4): "{investido} investidos em conversão{ (orçamento
 * {alvo})} · CPL {cpl} · {custo}". O investimento é o MESMO texto do cartão do Início
 * (`mostrar(kp.investimentoConversao, "moeda0")`) e a 1ª metade de
 * `fatoDoCustoPorReuniao(kp).fato`; o custo leva o fato INTEIRO (as reuniões de
 * conversão), com o CPL entre as duas metades.
 */
export function linhaDoResumo(kp: KpisDoPeriodo, r: ResumoMidia): string {
  const c = fatoDoCustoPorReuniao(kp);
  const reunioes = c.fato.split(" · ")[1] ?? "";
  const custo = c.exibivel ? `${c.valor} por reunião · ${reunioes}` : reunioes;
  const orcamento = r.ritmo ? ` (orçamento ${formatCurrency0(r.ritmo.alvo)})` : "";
  return `${mostrar(kp.investimentoConversao, "moeda0")} investidos em conversão${orcamento} · CPL ${mostrar(kp.cpl, "moeda")} · ${custo}`;
}

// ---------------------------------------------------------------- 2. tendência semanal

export interface PontoSemanalMidia {
  /** Segunda-feira da semana (AAAA-MM-DD). */
  semana: string;
  from: string;
  to: string;
  /** Investimento total da semana (conversão + descoberta). */
  gasto: number;
  gastoConversao: number;
  /** Leads do painel que entraram na semana (pagos e orgânicos). */
  leads: number;
  leadsConversao: number;
  /** O CPL da semana (o mesmo `kpisDoPeriodo`); `null` quando não se sustenta. */
  cpl: number | null;
  /** A semana ainda não fechou. */
  incompleta: boolean;
  /** Nenhuma linha de anúncio na semana. */
  semLinha: boolean;
}

/** Quantas semanas a tendência mostra por padrão. */
export const SEMANAS_DA_TENDENCIA = 12;

/**
 * A tendência das últimas `semanas` semanas (segunda a domingo), terminando na
 * semana de `fim` (o fim do período da tela). Cada ponto é `kpisDoPeriodo`
 * daquela semana — o CPL da barra é o CPL do resumo quando o período é a semana.
 */
export function tendenciaSemanalMidia(
  data: DashboardData,
  opts: { fim: string; hoje: string; semanas?: number; kpis?: Omit<OpcoesKpis, "hoje" | "comparar"> },
): PontoSemanalMidia[] {
  const n = opts.semanas ?? SEMANAS_DA_TENDENCIA;
  return ultimasSemanas(opts.fim, n).map((s) => {
    const k = kpisDoPeriodo(data, { from: s.from, to: s.to }, { ...opts.kpis, hoje: opts.hoje });
    return {
      semana: s.semana,
      from: s.from,
      to: s.to,
      gasto: k.investimento.valor,
      gastoConversao: k.investimentoConversao.valor,
      leads: k.leads.valor,
      leadsConversao: k.leadsConversao.valor,
      cpl: custoExibivel(k.cpl) ? k.cpl.valor : null,
      incompleta: s.to >= opts.hoje,
      semLinha: filterAds(data.adDaily, { from: s.from, to: s.to }).length === 0,
    };
  });
}

// ---------------------------------------------------------------- 3. a qualidade de uma linha

const contagemVazia = (): ContagemDoTrecho => ({
  leads: 0,
  semTelefoneUtil: 0,
  fora: { antes: 0, semTelefone: 0, live: 0, recentes: 0, depoisDaLeitura: 0, reabertosNoPainel: 0 },
  testesECopias: 0,
  testesECopiasPorFato: { falou: 0, respondeu: 0, aceitou: 0 },
  noRobo: 0,
  falou: 0,
  respondeu: 0,
  aceitou: 0,
  semWhatsapp: 0,
  noPrazo: 0,
});

/** "6 de 9 · 67%" (base ≥ AMOSTRA_MINIMA) · "1 de 2" · "—" (base 0) · "≥ 6" (leitura parada). */
function textoDaContagem(n: number, base: number, parada: boolean): string {
  if (base <= 0) return "—";
  if (parada) return `≥ ${formatInt(n)}`;
  if (base >= MIN_REUNIOES) return `${formatInt(n)} de ${formatInt(base)} · ${textoDaTaxa(n / base)}`;
  return `${formatInt(n)} de ${formatInt(base)}`;
}

/**
 * A resposta ao robô de UMA linha, pronta para a tela — os textos das 3 colunas, as
 * razões exatas (para ordenar) e o ⓘ da célula. `null` sem o trecho do robô.
 */
export function qualidadeDaLinha(c: ContagemDoTrecho | undefined, t: TrechoPorLinha | undefined): QualidadeDaLinha | null {
  if (!t || !t.comRobo) return null;
  const x = c ?? contagemVazia();
  const parada = t.parada;
  const dica = [
    dicaDoRecorteDoRobo({ noRobo: x.noRobo + x.testesECopias, leads: x.leads, fora: x.fora, parada }),
    x.testesECopias > 0 ? `${plural(x.testesECopias, "teste ou cópia", "testes ou cópias")} fora da conta.` : "",
    x.noPrazo > 0 ? `${plural(x.noPrazo, "pessoa", "pessoas")} ainda nas 24 h.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    estado: leituraDaQualidade(c, t).estado,
    responderam: textoDaContagem(x.respondeu, x.falou, parada),
    aceitaram: textoDaContagem(x.aceitou, x.respondeu, parada),
    semWhatsapp: textoDaContagem(x.semWhatsapp, x.noRobo, parada),
    valores: { responderam: div(x.respondeu, x.falou), aceitaram: div(x.aceitou, x.respondeu), semWhatsapp: div(x.semWhatsapp, x.noRobo) },
    dica,
  };
}

/** A veiculação de um grupo a partir das veiculações das partes (a de maior `ultimoDia` decide; "no ar" vence). */
function veiculacaoDoGrupo(partes: readonly Veiculacao[]): Veiculacao {
  const noAr = partes.find((v) => v.estado === "no-ar");
  if (noAr) {
    const ultimo = partes.reduce<string | null>((m, v) => (v.ultimoDia && (!m || v.ultimoDia > m) ? v.ultimoDia : m), null);
    return { ...noAr, ultimoDia: ultimo };
  }
  let melhor: Veiculacao | undefined;
  for (const v of partes) if (!melhor || (v.ultimoDia ?? "") > (melhor.ultimoDia ?? "")) melhor = v;
  return melhor ?? { estado: "sem-leitura", ultimoDia: null, rotulo: "Sem leitura" };
}

// ---------------------------------------------------------------- 4. campanhas → conjuntos

export interface NaoAtribuidos {
  ambigua: number;
  macro: number;
  desconhecida: number;
  semOrigem: number;
  /** Atribuídos a um conjunto/anúncio sem linha no período (parado, mas o lead chegou). */
  semLinhaNoPeriodo: number;
  /**
   * REUNIÕES agendadas no período cujo lead chegou só com o NOME (único) do
   * anúncio: o lead entra na linha, a reunião não (só com id — §7.3).
   */
  reunioesSoPorNome: number;
}

export interface BlocoConjuntos {
  conversao: LinhaMidia[];
  descoberta: LinhaMidia[];
  /** Leads do período que ficaram fora das linhas, e por quê. */
  naoAtribuidos: NaoAtribuidos;
}

const vazio = (): NaoAtribuidos => ({ ambigua: 0, macro: 0, desconhecida: 0, semOrigem: 0, semLinhaNoPeriodo: 0, reunioesSoPorNome: 0 });

/**
 * As chaves de campanha e de conjunto de uma linha: o id da Meta quando a linha
 * (ou outra linha com o mesmo nome) o traz; o nome só como último recurso (CSV,
 * linhas anteriores à 0019). Resolvido sobre o histórico INTEIRO para uma linha
 * velha sem id cair na mesma chave que a linha nova com id.
 */
function resolvedorDeChaves(rows: AdDaily[]) {
  const campIdPorNome = new Map<string, string>();
  for (const r of rows) if (r.campaignId) campIdPorNome.set(r.campaign, r.campaignId);
  const chaveCampanha = (r: Pick<AdDaily, "campaign" | "campaignId">) =>
    r.campaignId ?? campIdPorNome.get(r.campaign) ?? `nome:${r.campaign}`;
  const adsetIdPorNome = new Map<string, string>();
  for (const r of rows) if (r.adsetId) adsetIdPorNome.set(`${chaveCampanha(r)}|${r.adset}`, r.adsetId);
  const chaveConjunto = (r: Pick<AdDaily, "campaign" | "campaignId" | "adset" | "adsetId">) =>
    r.adsetId ?? adsetIdPorNome.get(`${chaveCampanha(r)}|${r.adset}`) ?? `nome:${r.adset}`;
  return {
    chaveCampanha,
    chaveConjunto,
    chave: (r: AdDaily) => `${chaveCampanha(r)}|${chaveConjunto(r)}`,
  };
}

/**
 * Anúncio → chave do conjunto (a mesma `chave` das linhas de `conjuntosPorId`),
 * pelo histórico INTEIRO — a linha mais recente vence, então o lead de um
 * anúncio que parou continua sendo dele. O motor (M4) usa para saber em qual
 * linha de /midia#conjuntos um anúncio mora.
 */
export function chaveDoConjuntoPorAnuncio(rows: AdDaily[]): Map<string, string> {
  const chaves = resolvedorDeChaves(rows);
  const porAnuncio = new Map<string, string>();
  for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) porAnuncio.set(r.adId, chaves.chave(r));
  return porAnuncio;
}

/** "campanha › conjunto" — como a tabela nomeia a linha e como a ação a cita. */
export function rotuloConjunto(l: Pick<LinhaMidia, "campanha" | "nome">): string {
  return `${l.campanha} › ${l.nome}`;
}

const MOTIVO_DO_TIPO: Partial<Record<TipoAtribuicao, MotivoForaDaLinha>> = {
  ambigua: "ambigua",
  macro: "macro",
  desconhecida: "desconhecida",
  "sem-origem": "sem-origem",
};

/**
 * A atribuição lead → conjunto, montada uma vez por (dado, período): o `adsetId`
 * gravado no lead (UTM padrão, D6) e, sem ele, o anúncio que `atribuidor` reconhece
 * (id ou nome único) → o conjunto desse anúncio no histórico. O conjunto precisa ter
 * linha no período. `tipoDoAnuncio` = a atribuição de anúncio crua (a passada das
 * reuniões só aceita `id`).
 */
function montarAtribuicaoDeConjunto(data: DashboardData, range: DateRange | undefined) {
  const chaves = resolvedorDeChaves(data.adDaily);
  const comLinha = new Set(filterAds(data.adDaily, range).map((r) => chaves.chave(r)));
  const chavePorAnuncio = chaveDoConjuntoPorAnuncio(data.adDaily);
  const chavePorAdsetId = new Map<string, string>();
  for (const r of [...data.adDaily].sort((a, b) => a.date.localeCompare(b.date))) {
    if (r.adsetId) chavePorAdsetId.set(r.adsetId, chaves.chave(r));
  }
  const atribuir = atribuidor(data.creatives);
  const doLead = (l: Lead): { chave: string } | { motivo: MotivoForaDaLinha } => {
    let chave: string | undefined;
    if (l.adsetId && chavePorAdsetId.has(l.adsetId)) chave = chavePorAdsetId.get(l.adsetId);
    else {
      const a = atribuir(l);
      if (a.adId) chave = chavePorAnuncio.get(a.adId);
      if (!chave) {
        // O lead TEM id de anúncio, e o anúncio não está nas linhas desta marca (K16).
        if (a.adId) return { motivo: "anuncio-de-fora" };
        return { motivo: MOTIVO_DO_TIPO[a.tipo] ?? "desconhecida" };
      }
    }
    if (!chave || !comLinha.has(chave)) return { motivo: "sem-linha-no-periodo" };
    return { chave };
  };
  return { chaves, chavePorAdsetId, chavePorAnuncio, atribuir, doLead };
}

/** Lead → conjunto, a passada de LEADS de `conjuntosPorId` (id do conjunto do lead; senão o anúncio — id ou nome único — → o conjunto dele no histórico; o conjunto precisa ter linha no período). */
export function atribuirAoConjunto(data: DashboardData, range: DateRange | undefined): (l: Lead) => { chave: string } | { motivo: MotivoForaDaLinha } {
  return montarAtribuicaoDeConjunto(data, range).doLead;
}

export function chaveDoConjuntoDoLead(data: DashboardData, range: DateRange | undefined): (l: Lead) => string | null {
  const a = atribuirAoConjunto(data, range);
  return (l) => {
    const r = a(l);
    return "chave" in r ? r.chave : null;
  };
}

interface Acumulado {
  spend: number;
  /** Só as linhas de anúncio de CONVERSÃO (`bucketOfAd`): o gasto da verba (num conjunto misto, < `spend`). */
  gastoConversao: number;
  impressions: number;
  reach: number;
  clicks: number;
  conversoesPixel: number;
  leadsPainel: number;
  agendadas: number;
  contatoInvalido: number;
}

const acumuladoVazio = (): Acumulado => ({
  spend: 0,
  gastoConversao: 0,
  impressions: 0,
  reach: 0,
  clicks: 0,
  conversoesPixel: 0,
  leadsPainel: 0,
  agendadas: 0,
  contatoInvalido: 0,
});

function somarLinha(a: Acumulado, r: AdDaily) {
  a.spend += r.spend;
  if (bucketOfAd(r) === "conversao") a.gastoConversao += r.spend;
  a.impressions += r.impressions;
  a.reach += r.reach;
  a.clicks += r.clicks;
  a.conversoesPixel += r.leads;
}

/** As razões de uma linha, com "—" (null) onde o denominador é zero. */
function fecharRazoes(a: Acumulado, custoPorReuniaoExibivel: boolean) {
  return {
    ctr: a.impressions > 0 ? a.clicks / a.impressions : 0,
    cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null,
    custoPorMilAlcancados: a.reach > 0 ? (a.spend / a.reach) * 1000 : null,
    cplPainel: div(a.spend, a.leadsPainel),
    cplPixel: div(a.spend, a.conversoesPixel),
    // Quarentena por LINHA: uma reunião no conjunto é sorte, não custo — e a
    // régua é a mesma da conta (`MIN_REUNIOES`).
    custoPorAgendada: custoPorReuniaoExibivel && a.agendadas >= MIN_REUNIOES ? a.spend / a.agendadas : null,
    pctContatoInvalido: div(a.contatoInvalido, a.leadsPainel),
  };
}

/** Balde dominante (por gasto) de um conjunto de linhas. */
function baldeDominante(rows: AdDaily[]): ObjectiveBucket {
  let conv = 0;
  let disc = 0;
  for (const r of rows) {
    if (bucketOfAd(r) === "descoberta") disc += r.spend;
    else conv += r.spend;
  }
  return disc > conv ? "descoberta" : "conversao";
}

const ultimoDiaDe = (rows: readonly Pick<AdDaily, "date">[]): string | undefined => {
  let m: string | undefined;
  for (const r of rows) if (!m || r.date > m) m = r.date;
  return m;
};

/**
 * Campanhas → conjuntos do período, agrupados por ID (S20), com leads e
 * reuniões do painel atribuídos ao conjunto (`atribuirAoConjunto`). LEAD entra por
 * id ou por nome único; REUNIÃO só com id (`adsetId` do lead ou `tipo: "id"`) — a
 * mesma regra de `criativosAgregados`. Nome ambíguo, macro e sem origem ficam de
 * fora (e contados em `naoAtribuidos`: `anuncio-de-fora` e `desconhecida` caem os
 * dois em `desconhecida`, como sempre — a separação mora em
 * `ForaDasLinhasDeConversao`, K16).
 *
 * Cada linha ganha a veiculação (`veiculacaoNoFim` sobre o histórico inteiro dos
 * anúncios dela; na campanha, o grupo) e, com `trecho`, a resposta ao robô
 * (`qualidadeDaLinha`). Com `cfgLive`, cada conjunto ganha `daLive` (toda linha do
 * período é da live). `custoPorReuniaoExibivel` = o custo por reunião da CONTA se
 * sustenta; em quarentena nenhuma linha imprime custo por agendada.
 */
export function conjuntosPorId(
  data: DashboardData,
  range: DateRange | undefined,
  opts: {
    custoPorReuniaoExibivel?: boolean;
    /** O dia de referência do "no ar" (`refDaVeiculacao`); ausente = `range.to` ou o último dia com linha. */
    ref?: string;
    cobertura?: Intervalo[];
    /** `trechoDoRoboPorLinha(..., chaveDoConjuntoDoLead(data, range))`. */
    trecho?: TrechoPorLinha;
    cfgLive?: CampanhaDaLive;
  } = {},
): BlocoConjuntos {
  const exibivel = opts.custoPorReuniaoExibivel ?? true;
  const at = montarAtribuicaoDeConjunto(data, range);
  const { chaves } = at;
  const ref = opts.ref ?? range?.to ?? ultimoDiaDe(data.adDaily) ?? "";
  const cobertura = opts.cobertura ?? [];

  // O histórico inteiro de cada conjunto (para a veiculação).
  const historico = new Map<string, AdDaily[]>();
  for (const r of data.adDaily) {
    const k = chaves.chave(r);
    const l = historico.get(k);
    if (l) l.push(r);
    else historico.set(k, [r]);
  }

  // Conjuntos COM linha no período (a linha mais recente dá o nome).
  interface Grupo {
    chave: string;
    chaveCampanha: string;
    campanha: string;
    conjunto: string;
    campaignId?: string;
    adsetId?: string;
    rows: AdDaily[];
    acc: Acumulado;
  }
  const grupos = new Map<string, Grupo>();
  const ordenadas = [...filterAds(data.adDaily, range)].sort((a, b) => a.date.localeCompare(b.date));
  for (const r of ordenadas) {
    const chave = chaves.chave(r);
    const g = grupos.get(chave) ?? {
      chave,
      chaveCampanha: chaves.chaveCampanha(r),
      campanha: r.campaign,
      conjunto: r.adset,
      rows: [],
      acc: acumuladoVazio(),
    };
    g.campanha = r.campaign;
    g.conjunto = r.adset;
    g.campaignId = r.campaignId ?? g.campaignId;
    g.adsetId = r.adsetId ?? g.adsetId;
    g.rows.push(r);
    somarLinha(g.acc, r);
    grupos.set(chave, g);
  }

  const naoAtribuidos = vazio();
  for (const l of filterLeads(data.leads, range)) {
    const a = at.doLead(l);
    if ("motivo" in a) {
      if (a.motivo === "anuncio-de-fora" || a.motivo === "desconhecida") naoAtribuidos.desconhecida += 1;
      else if (a.motivo === "ambigua") naoAtribuidos.ambigua += 1;
      else if (a.motivo === "macro") naoAtribuidos.macro += 1;
      else if (a.motivo === "sem-origem") naoAtribuidos.semOrigem += 1;
      else naoAtribuidos.semLinhaNoPeriodo += 1;
      continue;
    }
    const g = grupos.get(a.chave)!;
    g.acc.leadsPainel += 1;
    if (l.status === "contato_invalido") g.acc.contatoInvalido += 1;
  }
  // A passada das REUNIÕES: só com id — `adsetId` do lead ou anúncio por `tipo: "id"` (relatório §7.3).
  for (const l of reunioesNoPeriodo(data.leads, range)) {
    let chave: string | undefined;
    const porAdset = Boolean(l.adsetId && at.chavePorAdsetId.has(l.adsetId));
    if (porAdset) chave = at.chavePorAdsetId.get(l.adsetId!);
    else {
      const a = at.atribuir(l);
      if (a.tipo === "id" && a.adId) chave = at.chavePorAnuncio.get(a.adId);
    }
    const g = chave ? grupos.get(chave) : undefined;
    if (g) g.acc.agendadas += 1;
    // Só com o nome do anúncio: a reunião fica fora de toda linha — e o ⓘ e o alerta dizem.
    else if (!porAdset && at.atribuir(l).tipo === "nome") naoAtribuidos.reunioesSoPorNome += 1;
  }

  // Linhas de conjunto, agrupadas por (balde, campanha).
  const campanhas = new Map<
    string,
    { chaveCampanha: string; campanha: string; campaignId?: string; bucket: ObjectiveBucket; acc: Acumulado; conjuntos: LinhaMidia[]; rows: AdDaily[] }
  >();
  for (const g of grupos.values()) {
    const bucket = baldeDominante(g.rows);
    const hist = historico.get(g.chave) ?? g.rows;
    const linha: LinhaMidia = {
      nivel: "conjunto",
      chave: g.chave,
      nome: g.conjunto,
      campanha: g.campanha,
      campaignId: g.campaignId,
      adsetId: g.adsetId,
      bucket,
      ...g.acc,
      ...fecharRazoes(g.acc, exibivel),
      veiculacao: veiculacaoNoFim(hist, { ref, cobertura }),
      qualidade: qualidadeDaLinha(opts.trecho?.porLinha.get(g.chave), opts.trecho),
      ...(opts.cfgLive ? { daLive: g.rows.every((r) => ehDaLive(r, opts.cfgLive!)) } : {}),
    };
    const k = `${bucket}|${g.chaveCampanha}`;
    const c = campanhas.get(k) ?? {
      chaveCampanha: g.chaveCampanha,
      campanha: g.campanha,
      campaignId: g.campaignId,
      bucket,
      acc: acumuladoVazio(),
      conjuntos: [],
      rows: [],
    };
    c.campaignId = c.campaignId ?? g.campaignId;
    for (const key of Object.keys(c.acc) as (keyof Acumulado)[]) c.acc[key] += g.acc[key];
    c.conjuntos.push(linha);
    c.rows.push(...hist);
    campanhas.set(k, c);
  }

  const porGasto = (a: LinhaMidia, b: LinhaMidia) => b.spend - a.spend;
  const linhas = [...campanhas.values()].map<LinhaMidia>((c) => ({
    nivel: "campanha",
    chave: `${c.bucket}|${c.chaveCampanha}`,
    nome: c.campanha,
    campanha: c.campanha,
    campaignId: c.campaignId,
    bucket: c.bucket,
    ...c.acc,
    ...fecharRazoes(c.acc, exibivel),
    veiculacao: veiculacaoNoFim(c.rows, { ref, cobertura }),
    qualidade: null,
    conjuntos: c.conjuntos.sort(porGasto),
  }));
  return {
    conversao: linhas.filter((l) => l.bucket === "conversao").sort(porGasto),
    descoberta: linhas.filter((l) => l.bucket === "descoberta").sort(porGasto),
    naoAtribuidos,
  };
}

/**
 * A regra de atribuição em duas frases (K36), para os ⓘ dos conjuntos e dos
 * criativos: por que a soma de "Agendadas" pode ficar abaixo das reuniões da conta.
 */
export const REGRA_ATRIBUICAO_REUNIAO =
  "Reunião entra na linha só com o id do anúncio ou do conjunto (o link padrão traz {{ad.id}}). Lead entra também pelo nome único do anúncio.";

// ---------------------------------------------------------------- 5. criativos

export interface BlocoCriativos {
  conversao: LinhaCriativo[];
  descoberta: LinhaCriativo[];
  /** A média dos criativos de conversão do período, sem a live (`mediaDosCriativos`); null sem base. */
  media: MediaDosCriativos | null;
  porqueSemMedia: "um-criativo" | "poucos-leads" | null;
}

/**
 * Anúncio → chave do criativo, só para anúncios em `data.creatives` com gasto > 0 no
 * período (os de `creativePerformance`): `creativeId ?? adId`; com `cfgLive`, o
 * anúncio de campanha da live vai para `live|${creativeId ?? adId}` (K20). Um criativo
 * que roda em anúncios de conversão E de descoberta (o mesmo `creativeId`, fora a live)
 * vira duas linhas: os anúncios de descoberta vão para `desc|${creativeId}` — senão a
 * verba de descoberta, que "não busca lead", entraria no sinal, na média e nas % do
 * cartão da linha de conversão (ou tiraria dos cartões um criativo de conversão). O
 * balde do anúncio é o dominante no período (o mesmo `baldeDominante` da linha).
 */
function chavesDosCriativosPorAnuncio(data: DashboardData, range: DateRange | undefined, cfgLive?: CampanhaDaLive): Map<string, string> {
  const gasto = new Map<string, number>();
  const porBalde = new Map<string, Record<ObjectiveBucket, number>>();
  const daLive = new Set<string>();
  for (const r of filterAds(data.adDaily, range)) {
    gasto.set(r.adId, (gasto.get(r.adId) ?? 0) + r.spend);
    const b = porBalde.get(r.adId) ?? { conversao: 0, descoberta: 0 };
    b[bucketOfAd(r)] += r.spend;
    porBalde.set(r.adId, b);
    if (cfgLive && ehDaLive(r, cfgLive)) daLive.add(r.adId);
  }
  const comGasto = data.creatives.filter((c) => (gasto.get(c.adId) ?? 0) > 0);
  const baldeDo = (adId: string): ObjectiveBucket => {
    const b = porBalde.get(adId);
    return b && b.descoberta > b.conversao ? "descoberta" : "conversao";
  };
  // Os criativos (fora a live) com anúncio nos DOIS baldes.
  const baldesPorBase = new Map<string, Set<ObjectiveBucket>>();
  for (const c of comGasto) {
    if (daLive.has(c.adId)) continue;
    const base = c.creativeId ?? c.adId;
    const s = baldesPorBase.get(base) ?? new Set<ObjectiveBucket>();
    s.add(baldeDo(c.adId));
    baldesPorBase.set(base, s);
  }
  const out = new Map<string, string>();
  for (const c of comGasto) {
    const base = c.creativeId ?? c.adId;
    if (daLive.has(c.adId)) out.set(c.adId, `live|${base}`);
    else if (baldeDo(c.adId) === "descoberta" && (baldesPorBase.get(base)?.size ?? 0) > 1) out.set(c.adId, `desc|${base}`);
    else out.set(c.adId, base);
  }
  return out;
}

/**
 * Lead → criativo: `atribuidor(data.creatives)(l).adId`, anúncio em `data.creatives` E com gasto > 0 no período →
 * `creativeId ?? adId`; com `cfgLive` e o anúncio numa campanha da live (`ehDaLive`), `live|${creativeId ?? adId}` (K20).
 */
export function chaveDoCriativoDoLead(data: DashboardData, range: DateRange | undefined, cfgLive?: CampanhaDaLive): (l: Lead) => string | null {
  const porAnuncio = chavesDosCriativosPorAnuncio(data, range, cfgLive);
  const atribuir = atribuidor(data.creatives);
  return (l) => {
    const adId = atribuir(l).adId;
    return (adId && porAnuncio.get(adId)) || null;
  };
}

/**
 * A régua da fadiga em palavras (era `textoRegraSaude`, sem o "sem resultado" e sem o
 * CPL alvo): o `title` do `<th>` "Saúde" (descoberta) e o "Regra:" da linha expandida.
 */
export function textoDaReguaDaFadiga(): string {
  const r = REGRA_FADIGA;
  return [
    `Fadigando = CTR dos últimos ${r.janelaDias} dias ≤ ${Math.round(r.quedaCtr * 100)}% do CTR dos ${r.janelaDias} dias anteriores E (frequência ≥ ${r.frequenciaAlta} OU CPL Meta (Pixel) ${r.janelaDias} d ≥ ${Math.round(r.altaCpl * 100)}% do anterior), com ≥ ${formatInt(r.impressoesMinimas)} impressões em cada janela; as janelas terminam no fim do período.`,
    `O CPL Meta (Pixel) ${r.janelaDias} d é gasto ÷ conversões do Pixel na janela — não é o CPL (painel); sem Pixel configurado esse lado da regra nunca dispara.`,
    `Atenção = só um dos lados da regra.`,
    `Parado = nenhuma impressão nos últimos ${r.janelaDias} dias do período, com veiculação antes, em dias que uma sincronização bem-sucedida confirmou (anúncio pausado).`,
    `Sem dados = a mesma janela vazia sem nenhum dia coberto por sincronização bem-sucedida: pode ter havido veiculação que o painel não viu.`,
    `Novo = menos de ${formatInt(r.impressoesMinimas)} impressões em alguma janela (amostra insuficiente).`,
    `A saúde aparece só para quem está no ar; os outros mostram a veiculação.`,
    `Criativos de descoberta são julgados por CPM e CTR, nunca por leads.`,
  ].join(" ");
}

/**
 * Criativos do período agregados por `creativeId` (sem ele, por `adId`; com `cfgLive`,
 * os anúncios da live com a chave `live|…`, K20; os de descoberta de um criativo que
 * também roda em conversão, com `desc|…`), com o detalhe por anúncio (um por
 * conjunto). Leads do painel pela junção única (`chaveDoCriativoDoLead`); reuniões só
 * com id de anúncio; nome ambíguo nunca atribui a ninguém — vira `ambiguos`.
 *
 * Na 2ª passada (depois do `rotuloCriativoAgregado`): a veiculação, `daLive`, o
 * contato inválido, a resposta ao robô (com `trecho`), a média dos criativos de
 * conversão sem a live e o sinal (`sinalDoCriativo`) SÓ para conversão, fora a live,
 * NO AR. A saúde é `computeFatigue` no período (sem "sem resultado", F4-D3).
 */
export function criativosAgregados(
  data: DashboardData,
  range: DateRange | undefined,
  opts: {
    /** Onde as janelas da saúde terminam: `fimDoPeriodo` = min(fim do período, hoje). */
    fim?: string;
    /** Dias cobertos por syncs bem-sucedidos: sem eles a janela vazia é "Sem dados", não "Parado" (ADR-06). */
    cobertura?: Intervalo[];
    /** O dia de referência do "no ar" (`refDaVeiculacao`); ausente = `range.to` ou o último dia com linha. */
    ref?: string;
    custoPorReuniaoExibivel?: boolean;
    /** kp.custoPorReuniao.valor com `custoExibivel`; senão null. */
    custoPorReuniaoDaConta?: number | null;
    /** kp.investimento.confianca?.nivel === "piso" (K13). */
    gastoIncompleto?: boolean;
    cfgLive?: CampanhaDaLive;
    /** `trechoDoRoboPorLinha(..., chaveDoCriativoDoLead(data, range, cfgLive))`. */
    trecho?: TrechoPorLinha;
  } = {},
): BlocoCriativos {
  const exibivel = opts.custoPorReuniaoExibivel ?? true;
  const ultimoDia = ultimoDiaDe(data.adDaily);
  // Sem `fim`, o último dia com linha da CONTA — nunca o de cada anúncio, que julgaria
  // o pausado pelos seus próprios últimos 14 dias.
  const fim = opts.fim ?? range?.to ?? ultimoDia;
  const ref = opts.ref ?? range?.to ?? ultimoDia ?? fim ?? "";
  const cobertura = opts.cobertura ?? [];
  const saude = (rows: AdDaily[]) => computeFatigue(rows, { fim, cobertura: opts.cobertura });
  const perf = creativePerformance(data, range, { fim, cobertura: opts.cobertura });
  const criativoPorAd = new Map(data.creatives.map((c) => [c.adId, c]));
  const chavePorAd = chavesDosCriativosPorAnuncio(data, range, opts.cfgLive);

  const todasPorAd = new Map<string, AdDaily[]>();
  for (const r of data.adDaily) {
    const l = todasPorAd.get(r.adId);
    if (l) l.push(r);
    else todasPorAd.set(r.adId, [r]);
  }
  const periodoPorAd = new Map<string, AdDaily[]>();
  for (const r of filterAds(data.adDaily, range)) {
    const l = periodoPorAd.get(r.adId);
    if (l) l.push(r);
    else periodoPorAd.set(r.adId, [r]);
  }

  // Reuniões agendadas no período, SÓ por id (relatório §7.3).
  const atribuir = atribuidor(data.creatives);
  const agendadasPorAd = new Map<string, number>();
  for (const l of reunioesNoPeriodo(data.leads, range)) {
    const a = atribuir(l);
    if (a.tipo === "id" && a.adId) agendadasPorAd.set(a.adId, (agendadasPorAd.get(a.adId) ?? 0) + 1);
  }
  // Leads do período: por criativo (a chave do lead) e, no detalhe, por anúncio; os
  // ambíguos pelo nome que trouxeram.
  const leadsPorChave = new Map<string, number>();
  const contatoPorChave = new Map<string, number>();
  const contatoPorAd = new Map<string, number>();
  const ambiguosPorNome = new Map<string, number>();
  for (const l of filterLeads(data.leads, range)) {
    const a = atribuir(l);
    if (a.tipo === "ambigua") {
      const nome = (l.utmContent ?? "").split("|")[0].trim().toLowerCase();
      ambiguosPorNome.set(nome, (ambiguosPorNome.get(nome) ?? 0) + 1);
    }
    const chave = a.adId ? chavePorAd.get(a.adId) : undefined;
    if (!chave) continue;
    leadsPorChave.set(chave, (leadsPorChave.get(chave) ?? 0) + 1);
    if (l.status === "contato_invalido") {
      contatoPorChave.set(chave, (contatoPorChave.get(chave) ?? 0) + 1);
      contatoPorAd.set(a.adId!, (contatoPorAd.get(a.adId!) ?? 0) + 1);
    }
  }

  const anuncio = (c: CreativePerf, daLive: boolean): LinhaCriativo => {
    const rowsPeriodo = periodoPorAd.get(c.adId) ?? [];
    const bucket = baldeDominante(rowsPeriodo);
    const criativo = criativoPorAd.get(c.adId);
    const agendadas = agendadasPorAd.get(c.adId) ?? 0;
    const reach = rowsPeriodo.reduce((s, r) => s + r.reach, 0);
    const contatoInvalido = contatoPorAd.get(c.adId) ?? 0;
    const hist = todasPorAd.get(c.adId) ?? [];
    return {
      nivel: "anuncio",
      chave: c.adId,
      creativeId: criativo?.creativeId,
      adId: c.adId,
      nome: rotuloCriativo(c, perf),
      nomeCru: c.name,
      formato: c.format,
      thumbnailUrl: criativo?.thumbnailUrl,
      bucket,
      conjunto: c.adset,
      campanha: rowsPeriodo.at(-1)?.campaign,
      anuncios: 1,
      spend: c.spend,
      impressions: c.impressions,
      reach,
      clicks: c.clicks,
      ctr: c.ctr,
      cpc: div(c.spend, c.clicks),
      cpm: c.impressions > 0 ? (c.spend / c.impressions) * 1000 : null,
      custoPorMilAlcancados: reach > 0 ? (c.spend / reach) * 1000 : null,
      leadsPainel: c.leadsPainel,
      conversoesPixel: c.leads,
      cplPainel: div(c.spend, c.leadsPainel),
      cplPixel: div(c.spend, c.leads),
      agendadas,
      custoPorAgendada: exibivel && agendadas >= MIN_REUNIOES ? c.spend / agendadas : null,
      ambiguos: ambiguosPorNome.get(c.name.trim().toLowerCase()) ?? 0,
      saude: saude(hist),
      veiculacao: veiculacaoNoFim(hist, { ref, cobertura }),
      contatoInvalido,
      pctContatoInvalido: div(contatoInvalido, c.leadsPainel),
      daLive,
      qualidade: null,
      sinal: null,
    };
  };

  const grupos = new Map<string, LinhaCriativo[]>();
  for (const c of perf) {
    const chave = chavePorAd.get(c.adId) ?? criativoPorAd.get(c.adId)?.creativeId ?? c.adId;
    const l = grupos.get(chave);
    const a = anuncio(c, chave.startsWith("live|"));
    if (l) l.push(a);
    else grupos.set(chave, [a]);
  }

  const linhas: LinhaCriativo[] = [];
  for (const [chave, anuncios] of grupos) {
    anuncios.sort((a, b) => b.spend - a.spend);
    const soma = (f: (a: LinhaCriativo) => number) => anuncios.reduce((s, a) => s + f(a), 0);
    const spend = soma((a) => a.spend);
    const impressions = soma((a) => a.impressions);
    const clicks = soma((a) => a.clicks);
    const conversoesPixel = soma((a) => a.conversoesPixel);
    const agendadas = soma((a) => a.agendadas);
    const reach = soma((a) => a.reach);
    const leadsPainel = leadsPorChave.get(chave) ?? 0;
    const contatoInvalido = contatoPorChave.get(chave) ?? 0;
    const principal = anuncios[0];
    const bucket = anuncios.some((a) => a.bucket === "descoberta") && !anuncios.some((a) => a.bucket === "conversao") ? "descoberta" : principal.bucket;
    const rowsTodas = anuncios.flatMap((a) => todasPorAd.get(a.adId!) ?? []);
    // Ambíguos contam uma vez por criativo, não por anúncio (o nome é o mesmo).
    const ambiguos = Math.max(0, ...anuncios.map((a) => a.ambiguos));
    const nomeCru = criativoPorAd.get(principal.adId!)?.name ?? principal.nome;
    linhas.push({
      nivel: "criativo",
      chave,
      creativeId: principal.creativeId,
      // Nome cru do criativo; vira `rotuloCriativoAgregado` depois, quando todas as
      // linhas existem e dá para ver quem é homônimo de quem.
      nome: nomeCru,
      nomeCru,
      formato: principal.formato,
      thumbnailUrl: anuncios.find((a) => a.thumbnailUrl)?.thumbnailUrl,
      bucket,
      anuncios: anuncios.length,
      spend,
      impressions,
      reach,
      clicks,
      ctr: impressions > 0 ? clicks / impressions : 0,
      cpc: div(spend, clicks),
      cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
      custoPorMilAlcancados: reach > 0 ? (spend / reach) * 1000 : null,
      leadsPainel,
      conversoesPixel,
      cplPainel: div(spend, leadsPainel),
      cplPixel: div(spend, conversoesPixel),
      agendadas,
      custoPorAgendada: exibivel && agendadas >= MIN_REUNIOES ? spend / agendadas : null,
      ambiguos,
      saude: anuncios.length === 1 ? principal.saude : saude(rowsTodas),
      veiculacao: veiculacaoNoFim(rowsTodas, { ref, cobertura }),
      contatoInvalido,
      pctContatoInvalido: div(contatoInvalido, leadsPainel),
      daLive: chave.startsWith("live|"),
      qualidade: null,
      sinal: null,
      anunciosDetalhe: anuncios,
    });
  }
  // Dois criativos podem se chamar "Carrossel -": o rótulo que a coluna Nome, o
  // cartão, o motor e a IA imprimem tem de dizer QUAL (CLAUDE.md).
  const rotulos = linhas.map((l) => rotuloCriativoAgregado(l, linhas));
  linhas.forEach((l, i) => {
    l.nome = rotulos[i];
  });
  linhas.sort((a, b) => b.spend - a.spend);
  const conversao = linhas.filter((l) => l.bucket === "conversao");
  const descoberta = linhas.filter((l) => l.bucket === "descoberta");

  // A resposta ao robô (nível criativo de conversão) e a média dos criativos (sem a live).
  const t = opts.trecho;
  for (const l of conversao) l.qualidade = qualidadeDaLinha(t?.porLinha.get(l.chave), t);
  const baseDaMedia = conversao.filter((l) => !l.daLive).map((l) => ({ gasto: l.spend, leads: l.leadsPainel }));
  const media = mediaDosCriativos(baseDaMedia);
  const semMedia = porqueSemMedia(baseDaMedia);
  const base = baseDaMedia.reduce((s, b) => (b.gasto > 0 ? { leads: s.leads + b.leads, criativos: s.criativos + 1 } : s), { leads: 0, criativos: 0 });

  // O sinal: só conversão, fora a live, NO AR.
  for (const l of conversao) {
    if (l.daLive || l.veiculacao.estado !== "no-ar") continue;
    const contagem = t?.comRobo ? t.porLinha.get(l.chave) : undefined;
    l.sinal = sinalDoCriativo(
      {
        gasto: l.spend,
        leads: l.leadsPainel,
        ambiguos: l.ambiguos,
        agendadas: l.agendadas,
        contatoInvalido: l.contatoInvalido,
        semTelefone: t?.porLinha.get(l.chave)?.semTelefoneUtil ?? 0,
        fadiga: l.saude,
        qualidade: t ? leituraDaQualidade(t.porLinha.get(l.chave), t) : { estado: "indisponivel", porque: "desligado" },
        robo: contagem,
      },
      {
        media,
        porqueSemMedia: semMedia,
        custoPorReuniaoDaConta: opts.custoPorReuniaoDaConta ?? null,
        gastoIncompleto: opts.gastoIncompleto ?? false,
        baseDaMedia: base,
      },
    );
  }

  return { conversao, descoberta, media, porqueSemMedia: semMedia };
}

/**
 * Nome que identifica UM criativo agregado — o `rotuloCriativo` do nível
 * criativo. Dois criativos com `creativeId` diferente podem ter o mesmo nome
 * ("Carrossel -"), e o nome sozinho manda pausar ou escalar o errado. Com um
 * anúncio só, vale o rótulo do anúncio (já desambiguado pelo conjunto); com
 * vários, entram os conjuntos em que roda e, se ainda colidir, o fim do
 * `creativeId`. Sem homônimo, o nome cru. Puro: `todos` são as linhas de
 * nível criativo ANTES de rotular (compara pelo nome cru).
 */
export function rotuloCriativoAgregado(
  c: Pick<LinhaCriativo, "chave" | "nome" | "creativeId" | "anunciosDetalhe">,
  todos: Pick<LinhaCriativo, "chave" | "nome" | "creativeId" | "anunciosDetalhe">[],
): string {
  const homonimos = todos.filter((o) => o.chave !== c.chave && o.nome === c.nome);
  if (homonimos.length === 0) return c.nome;
  const porConjuntos = (x: Pick<LinhaCriativo, "nome" | "anunciosDetalhe">): string => {
    const anuncios = x.anunciosDetalhe ?? [];
    if (anuncios.length === 1) return anuncios[0].nome;
    const conjuntos = [...new Set(anuncios.map((a) => a.conjunto).filter((s): s is string => Boolean(s)))]
      .map((s) => (s.length > 32 ? `${s.slice(0, 31)}…` : s))
      .join(", ");
    return conjuntos ? `${x.nome} · ${conjuntos}` : x.nome;
  };
  const rotulo = porConjuntos(c);
  const aindaColide = homonimos.some((o) => porConjuntos(o) === rotulo);
  return aindaColide ? `${rotulo} · ${(c.creativeId ?? c.chave).slice(-4)}` : rotulo;
}

/** A ÚNICA montagem dos criativos com sinal: a página, o motor e a IA chamam esta. */
export function criativosComSinal(e: EntradaDosSinais): { bloco: BlocoCriativos; trecho: TrechoPorLinha; ref: string } {
  const fim = fimDoPeriodo(e.range, e.hoje);
  const ref = refDaVeiculacao({ fim, ultimoSyncAds: e.ultimoSyncAds, rows: e.data.adDaily });
  const trecho = trechoDoRoboPorLinha(
    { data: e.data, range: e.range, eventos: e.eventos, robo: e.robo, agora: e.agora },
    chaveDoCriativoDoLead(e.data, e.range, e.cfgLive),
  );
  const cprExibivel = custoExibivel(e.kpis.custoPorReuniao);
  const bloco = criativosAgregados(e.data, e.range, {
    fim,
    cobertura: e.cobertura,
    ref,
    custoPorReuniaoExibivel: cprExibivel,
    custoPorReuniaoDaConta: cprExibivel ? e.kpis.custoPorReuniao.valor : null,
    gastoIncompleto: e.kpis.investimento.confianca?.nivel === "piso",
    cfgLive: e.cfgLive,
    trecho,
  });
  return { bloco, trecho, ref };
}

// ---------------------------------------------------------------- 6. verba, fora das linhas, pausados

/** O gasto de uma linha que entra na VERBA: só o das linhas de anúncio de conversão (o conjunto misto não leva a descoberta). */
export const gastoDaVerba = (l: Pick<LinhaMidia, "spend" | "gastoConversao">): number => l.gastoConversao ?? l.spend;

/**
 * Os conjuntos (nível conjunto) que entram na verba: os de conversão e — raro, um
 * conjunto de descoberta com linha de anúncio de conversão no período — os de descoberta
 * com gasto de conversão. Σ `gastoDaVerba` = o investimento de conversão (`kpisDoPeriodo`
 * soma por linha de anúncio); `foraDasLinhasDeConversao` conta os leads sobre os MESMOS.
 */
export function conjuntosDaVerba(conjuntos: Pick<BlocoConjuntos, "conversao" | "descoberta">): LinhaMidia[] {
  return [
    ...conjuntos.conversao.flatMap((c) => c.conjuntos ?? []),
    ...conjuntos.descoberta.flatMap((c) => c.conjuntos ?? []).filter((l) => (l.gastoConversao ?? 0) > 0),
  ];
}

/** Leads de conversão (`baldeDosLeads` = "conversao") do período sem conjunto de CONVERSÃO, por motivo — e, na MESMA passada, os leads de conversão de cada conjunto de conversão (K11). */
export function foraDasLinhasDeConversao(
  data: DashboardData,
  range: DateRange | undefined,
  kp: KpisDoPeriodo,
  conjuntos: BlocoConjuntos,
): ForaDasLinhasDeConversao {
  const atribuir = atribuirAoConjunto(data, range);
  const deConversao = new Set(conjuntosDaVerba(conjuntos).map((x) => x.chave));
  const balde = baldeDosLeads(data);
  const porMotivo: ForaDasLinhasDeConversao["porMotivo"] = {
    "anuncio-de-fora": 0,
    desconhecida: 0,
    "sem-origem": 0,
    ambigua: 0,
    macro: 0,
    "sem-linha-no-periodo": 0,
    "linha-de-descoberta": 0,
  };
  const porConjunto = new Map<string, number>();
  let organicos = 0;
  for (const l of filterLeads(data.leads, range)) {
    const b = balde(l);
    if (b === "organico") {
      organicos += 1;
      continue;
    }
    if (b !== "conversao") continue;
    const a = atribuir(l);
    if ("chave" in a) {
      if (deConversao.has(a.chave)) porConjunto.set(a.chave, (porConjunto.get(a.chave) ?? 0) + 1);
      else porMotivo["linha-de-descoberta"] += 1;
    } else porMotivo[a.motivo] += 1;
  }
  const n = Object.values(porMotivo).reduce((s, v) => s + v, 0);
  return { n, de: kp.leadsConversao.valor, porMotivo, porConjunto, organicos };
}

/** "Fora das linhas: 8 de 23 leads de conversão." + uma frase por motivo ≠ 0 (§2.3, item 7). O MESMO texto nos ⓘ da verba e dos conjuntos (K33). "" com n = 0. */
export function textoDosForaDasLinhas(fora: ForaDasLinhasDeConversao): string {
  if (fora.n <= 0) return "";
  const m = fora.porMotivo;
  const frases = [
    `Fora das linhas: ${formatInt(fora.n)} de ${plural(fora.de, "lead", "leads")} de conversão.`,
    m["anuncio-de-fora"] > 0 ? `${formatInt(m["anuncio-de-fora"])} de anúncio fora das linhas desta marca.` : "",
    m.desconhecida > 0 ? `${formatInt(m.desconhecida)} com origem desconhecida.` : "",
    m["sem-origem"] > 0 ? `${formatInt(m["sem-origem"])} sem UTM de anúncio.` : "",
    m.ambigua > 0 ? `${formatInt(m.ambigua)} com nome ambíguo.` : "",
    m.macro > 0 ? `${formatInt(m.macro)} com macro sem resolver.` : "",
    m["sem-linha-no-periodo"] > 0 ? `${formatInt(m["sem-linha-no-periodo"])} de anúncio sem gasto no período.` : "",
    m["linha-de-descoberta"] > 0 ? `${formatInt(m["linha-de-descoberta"])} em conjunto de descoberta.` : "",
  ];
  return frases.filter(Boolean).join(" ");
}

/** Inteiros pelo maior resto: somam 100 quando Σ > 0. */
export function porcentagensInteiras(valores: readonly number[]): number[] {
  const total = valores.reduce((s, v) => s + Math.max(0, v), 0);
  if (!(total > 0)) return valores.map(() => 0);
  const exatos = valores.map((v) => (Math.max(0, v) / total) * 100);
  const inteiros = exatos.map((x) => Math.floor(x));
  let falta = 100 - inteiros.reduce((s, v) => s + v, 0);
  const ordem = exatos
    .map((x, i) => ({ i, resto: x - Math.floor(x), v: valores[i] }))
    .sort((a, b) => b.resto - a.resto || b.v - a.v || a.i - b.i);
  for (const o of ordem) {
    if (falta <= 0) break;
    inteiros[o.i] += 1;
    falta -= 1;
  }
  return inteiros;
}

/**
 * "42%" · "< 1%" (valor exato > 0 e inteiro 0) · "> 99%" (inteiro 100 e o exato abaixo
 * de 100%: o maior resto daria "100%" ao lado de outra linha com "< 1%", e a coluna
 * passaria de 100) · "0%". `exato` é a fração (0 a 1).
 */
export function textoDaPorcentagem(inteiro: number, exato: number): string {
  if (inteiro === 0 && exato > 0) return "< 1%";
  if (inteiro >= 100 && exato < 1 - 1e-9) return "> 99%";
  return `${inteiro}%`;
}

/** Corta em `palavras` palavras ou `chars` caracteres, o que vier antes, e põe "…". */
function cortar(texto: string, palavras: number, chars: number): string {
  const t = texto.trim();
  const ws = t.split(/\s+/);
  let out = ws.length > palavras ? ws.slice(0, palavras).join(" ") : t;
  if (out.length > chars) {
    const corte = out.slice(0, chars);
    const espaco = corte.lastIndexOf(" ");
    out = espaco >= Math.floor(chars / 2) ? corte.slice(0, espaco) : corte;
  }
  if (out === t) return t;
  return `${out.replace(/[\s,;:·›\-–—]+$/u, "")}…`;
}

/**
 * "Para onde vai a verba" (§2.3): só conversão. Uma linha por conjunto NO AR fora a
 * live, a live numa linha só (fora do destaque, K19), "Fora do ar" e "Fora das
 * linhas" (n de N, fora dos 100%). Os leads de cada linha = `fora.porConjunto` (a
 * MESMA passada do "fora das linhas", K11), nunca o `leadsPainel` da linha. O título
 * dá a resposta (o destaque pelos INTEIROS exibidos, K12) e leva " ⚠" no fim quando
 * mais de 25% dos leads de conversão estão fora das linhas (K32).
 */
export function paraOndeVaiAVerba(
  conjuntos: BlocoConjuntos,
  kp: KpisDoPeriodo,
  fora: ForaDasLinhasDeConversao,
  o: { ref: string; hoje: string; cfgLive: CampanhaDaLive },
): VerbaDaTela {
  const noArTxt = noArTexto(o.ref, o.hoje);
  // O gasto de cada linha é o de CONVERSÃO (`gastoDaVerba`): num conjunto misto a
  // descoberta fica de fora, e Σ das linhas = o investimento de conversão.
  const todos = conjuntosDaVerba(conjuntos);
  const leadsDe = (l: LinhaMidia) => fora.porConjunto.get(l.chave) ?? 0;
  const noAr = todos.filter((l) => !l.daLive && l.veiculacao.estado === "no-ar").sort((a, b) => gastoDaVerba(b) - gastoDaVerba(a));
  const live = todos.filter((l) => l.daLive);
  const foraDoAr = todos.filter((l) => !l.daLive && l.veiculacao.estado !== "no-ar");
  const gastoLive = live.reduce((s, l) => s + gastoDaVerba(l), 0);
  const liveNoAr = live.some((l) => l.veiculacao.estado === "no-ar");
  const D = [...fora.porConjunto.values()].reduce((s, v) => s + v, 0);
  const conv = mostrar(kp.investimentoConversao, "moeda0");
  const aviso = fora.de > 0 && fora.n / fora.de > 0.25 ? " ⚠" : "";

  // ---- as linhas dentro dos 100% ----
  interface Bruta {
    chave: string;
    rotulo: string;
    tipo: LinhaDaVerba["tipo"];
    gasto: number;
    leads: number;
    linha?: LinhaMidia;
  }
  const nomes = new Map<string, number>();
  for (const l of noAr) nomes.set(l.nome, (nomes.get(l.nome) ?? 0) + 1);
  const rotuloDe = (l: LinhaMidia) => ((nomes.get(l.nome) ?? 0) > 1 ? rotuloConjunto(l) : l.nome);
  const brutas: Bruta[] = noAr.map((l) => ({ chave: l.chave, rotulo: rotuloDe(l), tipo: "no-ar", gasto: gastoDaVerba(l), leads: leadsDe(l), linha: l }));
  if (gastoLive > 0) {
    brutas.push({ chave: "live", rotulo: o.cfgLive.nome, tipo: "live", gasto: gastoLive, leads: live.reduce((s, l) => s + leadsDe(l), 0) });
  }
  if (foraDoAr.length > 0) {
    brutas.push({
      chave: "fora-do-ar",
      rotulo: "Fora do ar",
      tipo: "fora-do-ar",
      gasto: foraDoAr.reduce((s, l) => s + gastoDaVerba(l), 0),
      leads: foraDoAr.reduce((s, l) => s + leadsDe(l), 0),
    });
  }
  const totalGasto = brutas.reduce((s, b) => s + b.gasto, 0);
  const pV = porcentagensInteiras(brutas.map((b) => b.gasto));
  const pL = porcentagensInteiras(brutas.map((b) => b.leads));
  const linhas: LinhaDaVerba[] = brutas.map((b, i) => {
    const exV = totalGasto > 0 ? b.gasto / totalGasto : 0;
    const exL = D > 0 ? b.leads / D : 0;
    return {
      chave: b.chave,
      rotulo: b.rotulo,
      tipo: b.tipo,
      pctVerba: totalGasto > 0 ? textoDaPorcentagem(pV[i], exV) : "—",
      pctLeads: D > 0 ? textoDaPorcentagem(pL[i], exL) : "—",
      barraVerba: exV,
      barraLeads: exL,
    };
  });
  if (fora.n > 0) {
    linhas.push({
      chave: "fora-das-linhas",
      rotulo: "Fora das linhas",
      tipo: "fora-das-linhas",
      pctVerba: "—",
      pctLeads: `${formatInt(fora.n)} de ${plural(fora.de, "lead", "leads")}`,
      barraVerba: 0,
      barraLeads: 0,
    });
  }

  // ---- o ⓘ ----
  const { from, to } = janelaNoAr(o.ref);
  const dica = [
    kp.investimentoDescoberta.valor > 0
      ? `Só a verba de conversão (${conv}); a de descoberta (${mostrar(kp.investimentoDescoberta, "moeda0")}) não busca lead e está em Detalhes.`
      : `Só a verba de conversão (${conv}).`,
    `% da verba = gasto de conversão do conjunto ÷ ${conv}.`,
    `% dos leads = leads de conversão do conjunto ÷ ${plural(D, "lead", "leads")} de conversão com conjunto.`,
    `No ar = impressão ou gasto entre ${dm(from)} e ${dm(to)}; Fora do ar soma os outros.`,
    gastoLive > 0 ? `A ${o.cfgLive.nome} entra numa linha só, fora do destaque; os criativos dela estão no bloco próprio.` : "",
    "Destaque = o conjunto no ar com a maior diferença entre os dois %, a partir de 10 pontos.",
    textoDosForaDasLinhas(fora),
  ]
    .filter(Boolean)
    .join(" ");

  // ---- o título ----
  if (kp.investimentoConversao.valor === 0) return { titulo: "Sem verba de conversão no período", dica, linhas: [] };
  if (noAr.length === 0) {
    if (liveNoAr) return { titulo: `Só os conjuntos da live estão ${noArTxt}`, dica, linhas };
    const ultimo = todos.reduce<string | null>((m, l) => (l.veiculacao.ultimoDia && (!m || l.veiculacao.ultimoDia > m) ? l.veiculacao.ultimoDia : m), null);
    return { titulo: ultimo ? `Nenhum conjunto ${noArTxt} · último gasto em ${dm(ultimo)}` : `Nenhum conjunto ${noArTxt}`, dica, linhas: [] };
  }
  const leadsNoAr = noAr.reduce((s, l) => s + leadsDe(l), 0);
  if (leadsNoAr < AMOSTRA_DE_PESSOAS) {
    return { titulo: `${plural(noAr.length, "conjunto", "conjuntos")} ${noArTxt} · poucos leads para comparar${aviso}`, dica, linhas };
  }
  // Destaque (K12): a maior |l − v| pelos INTEIROS exibidos, entre os conjuntos no ar; empate = mais gasto.
  let destaque: { i: number; delta: number; gasto: number } | null = null;
  brutas.forEach((b, i) => {
    if (b.tipo !== "no-ar") return;
    const delta = Math.abs(pL[i] - pV[i]);
    if (delta < 10) return;
    if (!destaque || delta > destaque.delta || (delta === destaque.delta && b.gasto > destaque.gasto)) destaque = { i, delta, gasto: b.gasto };
  });
  if (destaque) {
    const d = destaque as { i: number };
    const nome = cortar(brutas[d.i].rotulo, 5, 32);
    return { titulo: `${nome} leva ${linhas[d.i].pctVerba} da verba e traz ${linhas[d.i].pctLeads} dos leads${aviso}`, dica, linhas };
  }
  return {
    titulo:
      noAr.length === 1
        ? `Leads acompanham a verba no único conjunto ${noArTxt}${aviso}`
        : `Leads acompanham a verba nos ${formatInt(noAr.length)} conjuntos ${noArTxt}${aviso}`,
    dica,
    linhas,
  };
}

/**
 * As campanhas de conversão repartidas entre os conjuntos NO AR e os FORA do ar (K39): cada lado
 * remonta a linha de campanha só com os conjuntos dele (somas + `fecharRazoes`, a veiculação do
 * grupo). Σ gasto dos dois lados = Σ gasto da entrada.
 */
export function separarPorVeiculacao(linhas: readonly LinhaMidia[], custoPorReuniaoExibivel: boolean): { noAr: LinhaMidia[]; foraDoAr: LinhaMidia[] } {
  const noAr: LinhaMidia[] = [];
  const foraDoAr: LinhaMidia[] = [];
  const remontar = (c: LinhaMidia, conjuntos: LinhaMidia[]): LinhaMidia => {
    const acc = acumuladoVazio();
    for (const x of conjuntos) for (const k of Object.keys(acc) as (keyof Acumulado)[]) acc[k] += k === "gastoConversao" ? gastoDaVerba(x) : x[k];
    return {
      ...c,
      ...acc,
      ...fecharRazoes(acc, custoPorReuniaoExibivel),
      veiculacao: veiculacaoDoGrupo(conjuntos.map((x) => x.veiculacao)),
      conjuntos: [...conjuntos].sort((a, b) => b.spend - a.spend),
    };
  };
  for (const c of linhas) {
    const filhos = c.conjuntos;
    if (!filhos) {
      (c.veiculacao.estado === "no-ar" ? noAr : foraDoAr).push(c);
      continue;
    }
    const a = filhos.filter((x) => x.veiculacao.estado === "no-ar");
    const b = filhos.filter((x) => x.veiculacao.estado !== "no-ar");
    if (a.length > 0) noAr.push(b.length === 0 ? c : remontar(c, a));
    if (b.length > 0) foraDoAr.push(a.length === 0 ? c : remontar(c, b));
  }
  const porGasto = (x: LinhaMidia, y: LinhaMidia) => y.spend - x.spend;
  return { noAr: noAr.sort(porGasto), foraDoAr: foraDoAr.sort(porGasto) };
}

// ---------------------------------------------------------------- 7. descoberta

export interface DescobertaMidia {
  temDescoberta: boolean;
  investimento: number;
  /** Alcance SOMADO por anúncio e por dia — conta a mesma pessoa mais de uma vez. */
  alcanceSomado: number;
  cpm: number | null;
  custoPorMilAlcancados: number | null;
  /** Seguidores líquidos da CONTA no período (orgânico + pago). */
  seguidores: number;
  /** Gasto em descoberta ÷ seguidores líquidos — estimativa, não atribuição. */
  custoPorSeguidorEst: number | null;
}

export function descobertaDaMidia(kp: KpisDoPeriodo): DescobertaMidia {
  const d = kp.objetivos.descoberta;
  return {
    temDescoberta: kp.objetivos.hasDiscovery,
    investimento: d.spend,
    alcanceSomado: d.reach,
    cpm: d.impressions > 0 ? d.cpm : null,
    custoPorMilAlcancados: d.reach > 0 ? d.costPerReach : null,
    seguidores: kp.objetivos.netNewFollowers,
    custoPorSeguidorEst: kp.objetivos.costPerFollowerEst,
  };
}

// ---------------------------------------------------------------- 8. helpers da tela

/**
 * A miniatura do criativo, se ainda vale: só `https:`; o parâmetro `oe` (validade em
 * hex de segundos da época, CDN da Meta) vencido → null; sem `oe` → a URL; URL
 * inválida → null.
 */
export function miniaturaValida(url: string | undefined, agoraMs: number): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const oe = u.searchParams.get("oe");
  if (oe && /^[0-9a-f]+$/i.test(oe)) {
    const validade = parseInt(oe, 16) * 1000;
    if (Number.isFinite(validade) && Number.isFinite(agoraMs) && validade <= agoraMs) return null;
  }
  return url;
}

/** O nome cru de uma linha de criativo (sem o rótulo de desambiguação). */
const nomeCruDe = (l: LinhaCriativo): string => l.nomeCru ?? l.nome;

/** Só com homônimo (outro criativo do período com o mesmo nome cru): "{conjunto} · {4 dígitos}" (§2.4, K30). */
export function desambiguacaoDoCriativo(l: LinhaCriativo, todas: readonly LinhaCriativo[]): string | null {
  const cru = nomeCruDe(l);
  if (!todas.some((o) => o.chave !== l.chave && nomeCruDe(o) === cru)) return null;
  const anuncios = l.anunciosDetalhe ?? [];
  const principal = anuncios[0]?.conjunto ?? "";
  const doisPrimeiros = principal.trim().split(/\s+/).slice(0, 2).join(" ");
  const conjunto = doisPrimeiros.length > 20 ? `${doisPrimeiros.slice(0, 20).trimEnd()}…` : doisPrimeiros;
  const outros = new Set(anuncios.map((a) => a.conjunto).filter((s): s is string => Boolean(s) && s !== principal)).size;
  const digitos = (l.creativeId ?? l.adId ?? anuncios[0]?.adId ?? l.chave.replace(/^(live|desc)\|/, "")).slice(-4);
  const parte = conjunto ? `${conjunto}${outros > 0 ? ` +${outros}` : ""}` : "";
  return parte ? `${parte} · ${digitos}` : digitos;
}

// ---------------------------------------------------------------- 9. alertas

export function alertasDaMidia(
  kp: KpisDoPeriodo,
  data: DashboardData,
  range: DateRange | undefined,
  fora: ForaDasLinhasDeConversao,
  reunioesSoPorNome: number,
): Alerta[] {
  return [
    ...alertasDeConfianca(kp.trust.travas),
    ...alertasDeAtribuicao(data, range),
    ...alertaForaDasLinhas(fora.n, fora.de),
    ...alertaReunioesSoPorNome(reunioesSoPorNome),
  ];
}

// ---------------------------------------------------------------- 10. a tela inteira

/** Quantos cartões de criativo a página desenha (o resto, em "Ver todos os N criativos →"). */
export const CARTOES_NO_AR = 5;

/** Os de conversão no ar, nesta ordem: Pausar → Trocar arte → Escalar → Candidato → Manter → Cedo, e por gasto. */
function ordenarPorSinal(linhas: LinhaCriativo[]): LinhaCriativo[] {
  return [...linhas].sort((a, b) => ORDEM_DO_SINAL[a.sinal!.sinal] - ORDEM_DO_SINAL[b.sinal!.sinal] || b.spend - a.spend);
}

/**
 * Onde uma linha de CONJUNTO mora em /midia — a âncora das ações do motor (M2, M4),
 * com a veiculação da MESMA régua da página (o `ref` de `criativosComSinal` e a
 * cobertura): de conversão no ar → `#conjuntos` (Detalhes, a live incluída); de
 * conversão fora do ar → `#pausados`; de descoberta → `#detalhes` (o sub-bloco da
 * descoberta, todas as linhas, sem âncora própria).
 */
export function ancoraDoConjunto(l: Pick<LinhaMidia, "bucket" | "veiculacao">): "#conjuntos" | "#pausados" | "#detalhes" {
  if (l.bucket !== "conversao") return "#detalhes";
  return l.veiculacao.estado === "no-ar" ? "#conjuntos" : "#pausados";
}

/**
 * Onde uma linha de CRIATIVO de conversão mora em /midia — a âncora das ações do motor
 * (M3, M4 por criativo, M6, M8, M9): a live → `#criativos-live`; fora do ar →
 * `#pausados`; no ar → `#criativos` se está entre os `CARTOES_NO_AR` cartões (a MESMA
 * ordem da página) e `cartao` é pedido, senão `#criativos-tabela` (Detalhes).
 * `conversao` = as linhas de conversão da MESMA montagem (`criativosComSinal`).
 */
export function ancoraDoCriativo(
  l: Pick<LinhaCriativo, "chave" | "daLive" | "veiculacao">,
  conversao: readonly LinhaCriativo[],
  o: { cartao?: boolean } = {},
): "#criativos" | "#criativos-tabela" | "#pausados" | "#criativos-live" {
  if (l.daLive) return "#criativos-live";
  if (l.veiculacao.estado !== "no-ar") return "#pausados";
  if (!o.cartao) return "#criativos-tabela";
  const cartoes = ordenarPorSinal(conversao.filter((x) => !x.daLive && x.sinal != null)).slice(0, CARTOES_NO_AR);
  return cartoes.some((x) => x.chave === l.chave) ? "#criativos" : "#criativos-tabela";
}

function comMiniatura(l: LinhaCriativo, agoraMs: number): LinhaCriativo {
  return {
    ...l,
    thumbnailUrl: miniaturaValida(l.thumbnailUrl, agoraMs) ?? undefined,
    ...(l.anunciosDetalhe ? { anunciosDetalhe: l.anunciosDetalhe.map((a) => comMiniatura(a, agoraMs)) } : {}),
  };
}

const pctUm = (exato: number) => textoDaPorcentagem(Math.round(exato * 100), exato);

export function montarMidiaDaTela(e: EntradaMidia): MidiaDaTela {
  const { data, range, rangeKey, hoje, agora, cfgLive, cobertura } = e;
  const kp = e.kpis;
  const fim = fimDoPeriodo(range, hoje);
  const cprExibivel = custoExibivel(kp.custoPorReuniao);
  const aw = isAwareness(e.marca);
  const piso = kp.investimento.confianca?.nivel === "piso";
  const agoraMs = Date.parse(agora);

  // ---- os criativos com sinal (a MESMA montagem do motor e da IA) e os conjuntos ----
  const { bloco: criativos, trecho: trechoCri, ref } = criativosComSinal({
    data,
    range,
    kpis: kp,
    eventos: e.eventos,
    robo: e.robo,
    cobertura,
    ultimoSyncAds: e.ultimoSyncAds,
    cfgLive,
    hoje,
    agora,
  });
  const trechoConj = trechoDoRoboPorLinha({ data, range, eventos: e.eventos, robo: e.robo, agora }, chaveDoConjuntoDoLead(data, range));
  const conjuntos = conjuntosPorId(data, range, { custoPorReuniaoExibivel: cprExibivel, ref, cobertura, trecho: trechoConj, cfgLive });
  const fora = foraDasLinhasDeConversao(data, range, kp, conjuntos);
  const noArTxt = noArTexto(ref, hoje);
  const janela = janelaNoAr(ref);

  // ---- o robô nos criativos (K23) ----
  const somaConv = criativos.conversao.reduce((s, l) => {
    const p = trechoCri.porLinha.get(l.chave);
    return s + (p ? p.noRobo + p.testesECopias : 0);
  }, 0);
  const colunasDoRobo = trechoCri.comRobo && somaConv > 0;
  const roboNosCriativos: RoboNosCriativos = !trechoCri.comRobo
    ? trechoCri.motivoSemRobo === "antes-do-robo"
      ? "antes-do-robo"
      : "robo-desligado"
    : trechoCri.parada
      ? "leitura-parada"
      : somaConv === 0
        ? "ninguem-no-robo"
        : "ok";

  // ---- 1. o resumo ----
  const resumo = (() => {
    const total = mostrar(kp.investimento, "moeda0");
    // Zero com buraco de cobertura não é "nenhum gasto" (ADR-06, K6) — nem na awareness.
    const semGasto = piso ? "Sem dados de gasto no período ⚠" : "Nenhum gasto no período";
    if (aw) {
      return {
        texto: kp.investimento.valor === 0 ? semGasto : `${total} investidos no período`,
        dica: "Marca de seguidores: sem captação de leads. Alcance, seguidores e as tabelas de descoberta estão em Detalhes.",
      };
    }
    const r = resumoDaMidia(kp, reguaDoPeriodo(kp, data, range, hoje));
    const texto =
      kp.investimento.valor === 0
        ? semGasto
        : kp.investimentoConversao.valor === 0
          ? `Nenhum gasto de conversão · ${mostrar(kp.investimentoDescoberta, "moeda0")} em descoberta`
          : linhaDoResumo(kp, r);
    const conv = mostrar(kp.investimentoConversao, "moeda0");
    const dica = [
      kp.investimentoDescoberta.valor > 0
        ? `Investimento total do período: ${total} (${conv} em conversão e ${mostrar(kp.investimentoDescoberta, "moeda0")} em descoberta).`
        : `Investimento total do período: ${total}, todo em conversão.`,
      "É o gasto que a conferência com o Gerenciador compara.",
      `CPL = investimento em conversão ÷ ${formatInt(kp.leadsConversao.valor)} ${kp.leadsConversao.valor === 1 ? "lead" : "leads"} de conversão, o mesmo do Início.`,
      `O custo por reunião aparece com ${MIN_REUNIOES} reuniões de conversão no período; abaixo disso, o fato.`,
      r.ritmo ? `Orçamento de conversão do período: ${formatCurrency0(r.ritmo.alvo)}${r.ritmo.parcial ? ", cadastrado só em parte do período" : ""}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return { texto, dica };
  })();

  // ---- 2. conferir ----
  const conferir = aw
    ? null
    : { href: comPeriodo(linkDeConfiguracoes("/configuracoes#conferir-gasto"), rangeKey), rotulo: "Conferir com o Gerenciador →" as const };

  // ---- 3. a verba ----
  const verba = aw || kp.investimento.valor === 0 ? null : paraOndeVaiAVerba(conjuntos, kp, fora, { ref, hoje, cfgLive });

  // ---- 4. os criativos no ar ----
  const criConv = criativos.conversao.filter((l) => !l.daLive);
  const noArComSinal = ordenarPorSinal(criConv.filter((l) => l.sinal != null));
  const foraDoArCri = criConv.filter((l) => l.veiculacao.estado !== "no-ar");
  const todasAsLinhas = [...criativos.conversao, ...criativos.descoberta];
  const baseGasto = criativos.conversao.reduce((s, l) => s + l.spend, 0);
  const baseLeads = criativos.conversao.reduce((s, l) => s + l.leadsPainel, 0);
  const liveNoPeriodo = criativos.conversao.filter((l) => l.daLive);

  const card = (l: LinhaCriativo): CardDoCriativo => {
    const s = l.sinal!;
    const exV = baseGasto > 0 ? l.spend / baseGasto : 0;
    const exL = baseLeads > 0 ? l.leadsPainel / baseLeads : 0;
    return {
      chave: l.chave,
      nome: cortar(nomeCruDe(l), 8, 60),
      desambiguacao: desambiguacaoDoCriativo(l, todasAsLinhas),
      nomeCompleto: l.nome,
      formato: l.formato,
      miniatura: miniaturaValida(l.thumbnailUrl, agoraMs),
      sinal: { id: s.sinal, rotulo: s.rotulo, tom: s.tom },
      motivo: s.motivo,
      ressalva: s.ressalva,
      linha: s.linha,
      dica: s.dica,
      numeros: {
        gasto: `${piso ? "≥ " : ""}${formatCurrency0(l.spend)}`,
        leads: formatInt(l.leadsPainel),
        cpl: textoDoCplDaLinha(l.spend, l.leadsPainel, { piso }),
        razao: s.razao != null && l.leadsPainel >= MIN_REUNIOES ? `${umaCasa(s.razao)}×` : null,
        pctVerba: baseGasto > 0 ? pctUm(exV) : "—",
        pctLeads: baseLeads > 0 ? pctUm(exL) : "—",
        barraVerba: exV,
        barraLeads: exL,
      },
      robo: colunasDoRobo && l.qualidade ? { responderam: l.qualidade.responderam, aceitaram: l.qualidade.aceitaram, semWhatsapp: l.qualidade.semWhatsapp } : null,
    };
  };

  const criativosNoAr: CriativosNoArDaTela | null = (() => {
    if (aw || !(kp.investimentoConversao.valor > 0)) return null;
    const todos = noArComSinal.map(card);
    const n = todos.length;
    const conta = (s: string) => noArComSinal.filter((l) => l.sinal!.sinal === s).length;
    let titulo: string;
    if (n === 0) {
      titulo = liveNoPeriodo.some((l) => l.veiculacao.estado === "no-ar")
        ? `Só os criativos da live estão ${noArTxt}`
        : `Nenhum criativo de conversão ${noArTxt}`;
    } else {
      const partes = [
        conta("pausar") > 0 ? `${formatInt(conta("pausar"))} para pausar` : "",
        conta("trocar-arte") > 0 ? `${formatInt(conta("trocar-arte"))} para trocar a arte` : "",
        conta("escalar") > 0 ? `${formatInt(conta("escalar"))} para escalar` : "",
        conta("candidato") > 0 ? `${plural(conta("candidato"), "candidato", "candidatos")} a escalar` : "",
      ]
        .filter(Boolean)
        .slice(0, 2);
      const base = `${plural(n, "criativo", "criativos")} ${noArTxt}`;
      titulo = partes.length > 0 ? `${base} · ${partes.join(" · ")}` : `${base} · nenhum para pausar ou escalar`;
    }

    // O ⓘ do título (§2.4), uma frase por item.
    const diaDoSync = e.ultimoSyncAds ? diaDoLead(e.ultimoSyncAds) : "";
    const entre = `No ar = impressão ou gasto entre ${dm(janela.from)} e ${dm(janela.to)}`;
    const frase1 = !e.ultimoSyncAds
      ? `${entre}; sem registro de sincronização, o fim é o último dia com dado.`
      : ref === diaDoSync
        ? `${entre}, até o último sync de anúncios (${formatDateTimeCurta(e.ultimoSyncAds)}).`
        : `${entre}, o fim do período.`;
    const m = criativos.media;
    // Com a leitura parada, o Funil escreve os degraus do robô como "≥ N", sem taxa: o
    // número citado aqui é o MESMO, com o "≥" (o da página que ele cita).
    const noFunil = (n: number) => `${trechoCri.parada ? "≥ " : ""}${formatInt(n)}`;
    const robo =
      colunasDoRobo
        ? [
            "Robô: responderam ÷ 1ª mensagem, aceitaram ÷ quem respondeu, sem WhatsApp ÷ quem está no robô.",
            trechoCri.parada
              ? `São leads do período, sem teste nem cópia; com a leitura parada, só o mínimo (≥): no Funil, ${noFunil(trechoCri.degraus.responderam)} de ${noFunil(trechoCri.degraus.primeiraMsg)} responderam.`
              : `São leads do período, sem teste nem cópia; no Funil, ${noFunil(trechoCri.degraus.responderam)} de ${noFunil(trechoCri.degraus.primeiraMsg)} responderam.`,
          ].join(" ")
        : `Sem as colunas do robô: ${
            roboNosCriativos === "robo-desligado"
              ? "robô desligado nesta marca"
              : roboNosCriativos === "antes-do-robo"
                ? "período antes do robô (29/10)"
                : roboNosCriativos === "leitura-parada"
                  ? "robô sem leitura recente"
                  : "nenhum lead dos criativos passou pelo robô"
          }.`;
    const leadsConv = kp.leadsConversao.valor;
    const dica = [
      frase1,
      "O sinal é sugestão: nada muda no Meta; a regra de cada um está no ⓘ do selo.",
      m
        ? `Média dos criativos: ${formatCurrency(m.porLead)} por lead (${formatInt(m.leads)} leads com criativo identificado, sem a live).`
        : criativos.porqueSemMedia === "um-criativo"
          ? "Sem média: um criativo só."
          : "Sem média: poucos leads com criativo na conta.",
      leadsConv === 0
        ? "Nenhum lead de conversão no período: o CPL do resumo fica em —."
        : leadsConv === 1
          ? "O CPL do resumo divide pelo único lead de conversão."
          : `O CPL do resumo divide por todos os ${formatInt(leadsConv)} leads de conversão.`,
      `% da verba e % dos leads: sobre todos os criativos de conversão do período (${formatCurrency0(baseGasto)}, ${plural(baseLeads, "lead", "leads")}), a live incluída.`,
      liveNoPeriodo.length > 0 ? `Os criativos da live estão no bloco próprio (${formatInt(liveNoPeriodo.length)}).` : "",
      piso ? "Há dias sem dado de gasto: gasto e CPL são pisos (≥) e não há candidato." : "",
      robo,
    ]
      .filter(Boolean)
      .join(" ");

    return {
      titulo,
      dica,
      leituraParada: trechoCri.comRobo && trechoCri.parada ? (trechoCri.leituraParada?.texto ?? null) : null,
      cards: todos.slice(0, CARTOES_NO_AR),
      todos,
      pausados: foraDoArCri.length,
      verTodos: n > CARTOES_NO_AR ? { texto: `Ver todos os ${formatInt(n)} criativos →`, href: "#criativos-tabela" as const } : null,
    };
  })();

  // ---- 5. a live (K8): período livre recorta; preset ou Campanha = a campanha da live até hoje ----
  const rLive = parseCustomRange(rangeKey) ? range : undefined;
  const rangeLive = {
    de: rLive?.from && rLive.from > cfgLive.periodo.de ? rLive.from : cfgLive.periodo.de,
    ate: [rLive?.to ?? hoje, cfgLive.periodo.ate, hoje].sort()[0],
  };
  const live =
    !aw && rangeLive.de <= rangeLive.ate
      ? {
          r: criativosDaLive(data, cfgLive, rangeLive, hoje),
          dica: [
            `Os anúncios das campanhas da live, por criativo, de ${dm(rangeLive.de)} a ${dm(rangeLive.ate)}.`,
            "Qualificado = classe A ou B; inscrito ligado ao anúncio pela mesma junção da Mídia.",
            "Num período livre ou num atalho da live, o recorte é o do período; nos outros, a campanha da live até hoje.",
          ].join(" "),
        }
      : null;

  // ---- 6. pausados (K39) ----
  const sep = separarPorVeiculacao(conjuntos.conversao, cprExibivel);
  const pausados: PausadosDaTela | null =
    !aw && (sep.foraDoAr.length > 0 || foraDoArCri.length > 0)
      ? {
          dica: [
            `Gastaram no período, mas sem impressão nem gasto entre ${dm(janela.from)} e ${dm(janela.to)}.`,
            "O painel não lê o status do Meta: pode ter sido pausado, reprovado ou ficado sem entrega.",
            "“Sem leitura” = nenhum sync confirmou os dias depois do último gasto.",
            "Fora do ar não recebe sinal; os criativos da live ficam no bloco próprio.",
          ].join(" "),
          conjuntos: sep.foraDoAr,
          criativos: foraDoArCri.map((l) => comMiniatura(l, agoraMs)),
        }
      : null;

  // ---- 7. detalhes ----
  const conjuntosForaDoAr = sep.foraDoAr.flatMap((c) => c.conjuntos ?? [c]);
  const reunioesSoPorNome = conjuntos.naoAtribuidos.reunioesSoPorNome;
  const organicos = fora.organicos;
  const dicaConjuntos = [
    "Onde a verba vira lead.",
    "Agrupado pelo id da Meta: dois conjuntos com o mesmo nome em campanhas diferentes são duas linhas.",
    REGRA_ATRIBUICAO_REUNIAO,
    cprExibivel
      ? `O custo por agendada aparece com ${MIN_REUNIOES} reuniões ou mais na linha.`
      : `O custo por agendada fica em — até ${MIN_REUNIOES} reuniões de conversão no período (hoje ${formatInt(kp.reunioesConversao.valor)}).`,
    textoDosForaDasLinhas(fora),
    organicos > 0
      ? organicos === 1
        ? "1 lead sem anúncio pago (orgânico ou direto) fica fora da mídia."
        : `${formatInt(organicos)} leads sem anúncio pago (orgânicos ou diretos) ficam fora da mídia.`
      : "",
    reunioesSoPorNome > 0
      ? reunioesSoPorNome === 1
        ? "1 reunião do período chegou só com o nome do anúncio, sem id. Conta nas reuniões da conta, mas em nenhum conjunto."
        : `${formatInt(reunioesSoPorNome)} reuniões do período chegaram só com o nome do anúncio, sem id. Contam nas reuniões da conta, mas em nenhum conjunto.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const serie = dailySeries(data, range, cobertura, hoje);
  const detalhes: DetalhesDaTela = {
    // Sem verba de conversão (a awareness, ou um período só de descoberta), Detalhes não
    // desenha as tabelas de conversão: dois vazios sem nada a dizer.
    comConversao: !aw && kp.investimentoConversao.valor > 0,
    dica: [
      "As linhas de conversão no ar, com todas as colunas; as que pararam estão em Pausados no período.",
      "Conjuntos pelo id da Meta; criativos por criativo, sem a live.",
      "A descoberta vem inteira.",
      piso ? "Há dias sem dado de gasto: os valores são pisos." : "",
    ]
      .filter(Boolean)
      .join(" "),
    tendencia: {
      pontos: tendenciaSemanalMidia(data, { fim, hoje, kpis: e.opcoesKpis }),
      dica: [
        "Gasto (barras), leads do painel (linha) e CPL (tracejado) por semana, de segunda a domingo.",
        `São as últimas ${SEMANAS_DA_TENDENCIA} semanas até o fim do período.`,
        "A semana em curso sai vazada; o CPL some quando não se sustenta.",
      ].join(" "),
    },
    conjuntos: {
      conversao: sep.noAr,
      descoberta: conjuntos.descoberta,
      dica: dicaConjuntos,
      // O que está em Pausados, a live incluída — e dito ("1 da live"): o "Fora do ar" da
      // verba é outro recorte (sem a live, que lá é uma linha própria).
      foraDoAr:
        conjuntosForaDoAr.length > 0
          ? {
              gasto: formatCurrency0(sep.foraDoAr.reduce((s, c) => s + c.spend, 0)),
              n: conjuntosForaDoAr.length,
              daLive: conjuntosForaDoAr.filter((l) => l.daLive).length,
            }
          : null,
    },
    criativos: {
      conversao: criConv.filter((l) => l.veiculacao.estado === "no-ar").map((l) => comMiniatura(l, agoraMs)),
      descoberta: criativos.descoberta.map((l) => comMiniatura(l, agoraMs)),
      dica: [
        "Agregados por criativo: o mesmo criativo roda em vários conjuntos.",
        "Expanda para ver anúncio a anúncio, CTR, CPC e o número do Pixel.",
        REGRA_ATRIBUICAO_REUNIAO,
        "Nome que existe em mais de um anúncio vira atribuição ambígua e não entra em nenhum.",
        "O ⓘ de cada selo diz o motivo e a regra do sinal.",
      ].join(" "),
      regras: { sinal: textoDaReguaDoSinal(), fadiga: textoDaReguaDaFadiga() },
      foraDoAr: foraDoArCri.length > 0 ? { gasto: formatCurrency0(foraDoArCri.reduce((s, l) => s + l.spend, 0)), n: foraDoArCri.length } : null,
      liveNoBloco: live != null,
    },
    descoberta: kp.temDescoberta
      ? {
          numeros: descobertaDaMidia(kp),
          dica: [
            "Estimativa: seguidores são da conta (orgânico + pago); a Meta não atribui seguidor por anúncio.",
            "O alcance é a soma diária por anúncio (conta a mesma pessoa mais de uma vez), não o alcance único.",
          ].join(" "),
          dicaAlcance: "Soma do alcance diário de cada anúncio: conta a mesma pessoa mais de uma vez. Não é o alcance único do período.",
          dicaCustoPorMil: "Gasto em descoberta ÷ alcance somado × 1.000. Como o alcance é somado, é um piso.",
        }
      : null,
    diario: {
      dados: serie.map((p) => ({ date: p.date, valor: p.spend, semDado: p.semDado, semVeiculacao: p.semVeiculacao })),
      faixas: [
        ...trechosSemVeiculacao(serie).map((t) => ({ ...t, tom: "pausa" as const })),
        ...trechosSemDado(serie).map((t) => ({ ...t, tom: "falha" as const })),
      ],
      dica: [
        "Uma barra por dia, todo dia do período no eixo.",
        "Faixa cinza “pausado” = um sync confirmou que não houve veiculação.",
        "Hachura âmbar “sem dados” = nenhuma sincronização cobriu o dia: pode ter havido gasto que o painel não viu.",
      ].join(" "),
    },
  };

  return {
    rangeKey,
    alertas: alertasDaMidia(kp, data, range, fora, reunioesSoPorNome),
    resumo,
    conferir,
    verba,
    criativos: criativosNoAr,
    live,
    pausados,
    detalhes,
    colunasDoRobo,
    pisoDeGasto: piso,
    roboNosCriativos,
  };
}

/** Uma casa, vírgula: "0,4". */
const umaCasa = (v: number) => (Math.round(v * 10) / 10).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** A Mídia como a tela a escreve, para a IA (§3.9): sem pessoa; a situação do robô sempre (K23). */
export function midiaParaIA(m: MidiaDaTela): MidiaParaIA {
  return {
    resumo: m.resumo.texto,
    verba: m.verba
      ? { titulo: m.verba.titulo, linhas: m.verba.linhas.map((l) => ({ conjunto: l.rotulo, pctVerba: l.pctVerba, pctLeads: l.pctLeads, tipo: l.tipo })) }
      : null,
    criativos: m.criativos
      ? {
          titulo: m.criativos.titulo,
          noAr: m.criativos.todos.map((c) => ({
            criativo: c.nomeCompleto,
            sinal: c.sinal.rotulo,
            motivo: c.motivo,
            ressalva: c.ressalva,
            gasto: c.numeros.gasto,
            leads: c.numeros.leads,
            cpl: c.numeros.cpl,
            robo: c.robo,
          })),
          pausados: m.criativos.pausados,
          regua: textoDaReguaDoSinal(),
        }
      : null,
    robo: { situacao: m.roboNosCriativos },
  };
}
