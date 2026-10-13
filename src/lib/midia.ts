/**
 * Mídia (relatório §7.3) — "onde a verba vira reunião, e o que escalar ou
 * pausar?". Puro: tudo o que a página /midia calcula mora aqui, e a página só
 * exibe.
 *
 * Cinco peças, na ordem da tela:
 *   1. `resumoDaMidia` — investimento, conversão × descoberta, CPL, custo por
 *      reunião e ritmo contra o orçamento, TODOS de `kpisDoPeriodo` (ADR-03: o
 *      CPL daqui é o da Bússola);
 *   2. `tendenciaSemanalMidia` — gasto, leads e CPL por semana (seg–dom), cada
 *      ponto um `kpisDoPeriodo` da semana;
 *   3. `conjuntosPorId` — campanhas → conjuntos agrupados por ID (S20: dois
 *      "Interesses 25-45" em campanhas diferentes eram uma linha só), com
 *      leads atribuídos pelo `adsetId` do lead ou pelo anúncio (id ou nome
 *      único) e REUNIÕES só com id (`adsetId` do lead ou id de anúncio);
 *   4. `criativosAgregados` — o mesmo criativo roda em vários anúncios (um por
 *      conjunto): agrega por `creativeId`, detalha por anúncio, e a saúde sai
 *      da regra explícita de `computeFatigue` calculada no período (S13/B17);
 *   5. `rankingsDeCriativos` — "melhor CPL" e "maior CTR" só com volume mínimo.
 *
 * UMA regra de atribuição de reunião em toda a tela e no motor (relatório
 * §7.3): a reunião só entra num conjunto, num criativo ou numa ação (M2, M6)
 * quando o lead tem id de anúncio (`lead.adId`, "nome|id" no utm_content ou o
 * `adsetId` da UTM padrão). Nome único ainda atribui o LEAD — nunca a reunião:
 * era o que fazia o mesmo agendamento contar no conjunto e não no criativo.
 *
 * Regras de exibição que a tela obedece lendo daqui: custo com denominador
 * zero é `null` (a tela imprime "—"); custo por reunião só com `MIN_REUNIOES`
 * na LINHA e com a conta fora de quarentena; "Leads (painel)" e "Conversões
 * Meta (Pixel)" são colunas diferentes com nomes diferentes — nunca uma coluna
 * "Leads" com dado do Pixel. O motor (M2, M4) lê `conjuntosPorId` daqui: a
 * ação cita a linha que /midia#conjuntos abre, com o mesmo número.
 */

import {
  REGRA_FADIGA,
  bucketOfAd,
  computeFatigue,
  creativePerformance,
  filterAds,
  filterLeads,
  reunioesNoPeriodo,
  rotuloCriativo,
  type CreativePerf,
  type DateRange,
  type Fatigue,
  type ObjectiveBucket,
} from "./metrics";
import {
  custoExibivel,
  kpisDoPeriodo,
  mostrar,
  type KpisDoPeriodo,
  type LinhaDaRegua,
  type Medida,
  type OpcoesKpis,
} from "./kpis";
import { atribuidor, type TipoAtribuicao } from "./atribuicao";
import type { Intervalo } from "./cobertura";
import { formatarAlvo, metaVigente, type AvaliacaoMeta } from "./metas";
import { MIN_REUNIOES } from "./trust";
import { ultimasSemanas } from "./semana";
import { formatCurrency, formatCurrency0, formatInt, formatPercent } from "./format";
import { dica, type MetricaId } from "./dicionario";
import type { AdDaily, Creative, DashboardData, Lead } from "./types";

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);

// ---------------------------------------------------------------- 1. resumo

/** Meta já em texto, no formato que o `StatusMetaBadge` exibe. */
export interface MetaDoResumo {
  alvoTexto?: string;
  avaliacao?: AvaliacaoMeta;
  provisoria?: boolean;
}

export interface ResumoMidia {
  /** Investimento total do período (conversão + descoberta), já com "≥" se for piso. */
  investimento: { texto: string; medida: Medida };
  conversao: number;
  descoberta: number;
  cpl: { texto: string; medida: Medida; meta?: MetaDoResumo };
  /**
   * O custo por reunião quando se sustenta; senão o FATO (decisão 4.2):
   * "R$ 160 investidos em conversão · 1 reunião" — nunca a razão abaixo de
   * `MIN_REUNIOES`.
   */
  custoPorReuniao: { exibivel: boolean; texto: string; n: number; medida: Medida; meta?: MetaDoResumo };
  /**
   * Ritmo do período contra o orçamento de conversão (meta `investimento_conversao`).
   * `null` = sem orçamento cadastrado: a tela convida a cadastrar, e NUNCA mostra o
   * gasto como se fosse o orçamento (B9).
   */
  ritmo: {
    gasto: number;
    gastoTexto: string;
    alvo: number;
    alvoTexto: string;
    parcial: boolean;
    avaliacao?: AvaliacaoMeta;
  } | null;
}

function metaDaLinha(linha: LinhaDaRegua | undefined, prefixo: string): MetaDoResumo | undefined {
  if (!linha || linha.alvo == null) return undefined;
  return {
    alvoTexto: `${prefixo} ${formatarAlvo(linha.metrica, linha.alvo)}`,
    avaliacao: linha.avaliacao,
    provisoria: linha.meta?.provisoria,
  };
}

export function resumoDaMidia(kp: KpisDoPeriodo, regua: LinhaDaRegua[]): ResumoMidia {
  const linha = (m: LinhaDaRegua["metrica"]) => regua.find((l) => l.metrica === m);
  const n = kp.reunioesConversao.valor;
  const exibivel = custoExibivel(kp.custoPorReuniao);
  const pisoInvest = kp.investimentoConversao.confianca?.nivel === "piso" ? "≥ " : "";
  const fato = `${pisoInvest}${formatCurrency0(kp.investimentoConversao.valor)} investidos em conversão · ${formatInt(n)} ${n === 1 ? "reunião" : "reuniões"}`;
  const ritmo = linha("investimento_conversao");
  return {
    investimento: { texto: mostrar(kp.investimento, "moeda0"), medida: kp.investimento },
    conversao: kp.investimentoConversao.valor,
    descoberta: kp.investimentoDescoberta.valor,
    cpl: { texto: mostrar(kp.cpl, "moeda"), medida: kp.cpl, meta: metaDaLinha(linha("cpl"), "alvo") },
    custoPorReuniao: {
      exibivel,
      texto: exibivel ? mostrar(kp.custoPorReuniao, "moeda") : fato,
      n,
      medida: kp.custoPorReuniao,
      meta: exibivel ? metaDaLinha(linha("custo_por_reuniao"), "alvo") : undefined,
    },
    ritmo:
      ritmo && ritmo.alvo != null
        ? {
            gasto: ritmo.medida.valor,
            gastoTexto: mostrar(ritmo.medida, "moeda0"),
            alvo: ritmo.alvo,
            alvoTexto: formatarAlvo("investimento_conversao", ritmo.alvo),
            parcial: ritmo.parcial,
            avaliacao: ritmo.avaliacao,
          }
        : null,
  };
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

// ---------------------------------------------------------------- 3. campanhas → conjuntos

export interface LinhaMidia {
  nivel: "campanha" | "conjunto";
  /** Chave única dentro do bloco (id da Meta ou, sem id, o nome). */
  chave: string;
  nome: string;
  campanha: string;
  campaignId?: string;
  adsetId?: string;
  bucket: ObjectiveBucket;
  spend: number;
  impressions: number;
  /** Alcance SOMADO por anúncio e por dia — conta a mesma pessoa mais de uma vez. */
  reach: number;
  clicks: number;
  ctr: number;
  cpm: number | null;
  custoPorMilAlcancados: number | null;
  /** Leads do PAINEL que entraram no período, atribuídos a este conjunto. */
  leadsPainel: number;
  /** O que o Pixel da Meta contou — número-sombra. */
  conversoesPixel: number;
  /** Gasto ÷ leads do painel; `null` sem lead. */
  cplPainel: number | null;
  /** Gasto ÷ conversões do Pixel; `null` sem conversão. */
  cplPixel: number | null;
  /** Reuniões AGENDADAS no período (data do agendamento) atribuídas ao conjunto. */
  agendadas: number;
  /** Gasto ÷ agendadas, só com `MIN_REUNIOES` na linha e a conta fora de quarentena. */
  custoPorAgendada: number | null;
  /** Leads do período (deste conjunto) encerrados como "Contato inválido". */
  contatoInvalido: number;
  pctContatoInvalido: number | null;
  /** Só no nível campanha: os conjuntos, do maior gasto ao menor. */
  conjuntos?: LinhaMidia[];
}

export interface NaoAtribuidos {
  ambigua: number;
  macro: number;
  desconhecida: number;
  semOrigem: number;
  /** Atribuídos a um conjunto/anúncio sem linha no período (parado, mas o lead chegou). */
  semLinhaNoPeriodo: number;
  /**
   * REUNIÕES agendadas no período cujo lead chegou só com o NOME (único) do
   * anúncio: o lead entra na linha, a reunião não (só com id — §7.3). Sem esta
   * conta a soma de "Agendadas" dos conjuntos fica abaixo das reuniões da conta
   * sem explicação no bloco.
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

function contarNaoAtribuido(n: NaoAtribuidos, tipo: TipoAtribuicao) {
  if (tipo === "ambigua") n.ambigua += 1;
  else if (tipo === "macro") n.macro += 1;
  else if (tipo === "desconhecida") n.desconhecida += 1;
  else if (tipo === "sem-origem") n.semOrigem += 1;
}

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

interface Acumulado {
  spend: number;
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

/**
 * Campanhas → conjuntos do período, agrupados por ID (S20), com leads e
 * reuniões do painel atribuídos ao conjunto: pelo `adsetId` gravado no lead
 * (UTM padrão, D6) e, sem ele, pelo anúncio que `atribuidor` reconhece → o
 * conjunto desse anúncio no histórico. LEAD entra por id ou por nome único;
 * REUNIÃO só com id (`adsetId` do lead ou `tipo: "id"`) — a mesma regra de
 * `criativosAgregados` e de `creativePerformance`, senão a mesma reunião
 * imprime "3" no conjunto e "0" no criativo dele. Nome ambíguo, macro e sem
 * origem ficam de fora (e contados em `naoAtribuidos`).
 *
 * `custoPorReuniaoExibivel` = o custo por reunião da CONTA se sustenta
 * (`custoExibivel(kp.custoPorReuniao)`); em quarentena nenhuma linha imprime
 * custo por agendada, mesmo com 3 reuniões nela.
 */
export function conjuntosPorId(
  data: DashboardData,
  range: DateRange | undefined,
  opts: { custoPorReuniaoExibivel?: boolean } = {},
): BlocoConjuntos {
  const exibivel = opts.custoPorReuniaoExibivel ?? true;
  const chaves = resolvedorDeChaves(data.adDaily);

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

  // Anúncio → conjunto e adsetId → conjunto, pelo histórico inteiro (a linha
  // mais recente vence): o lead de um anúncio que parou continua sendo dele.
  const chavePorAnuncio = chaveDoConjuntoPorAnuncio(data.adDaily);
  const chavePorAdsetId = new Map<string, string>();
  for (const r of [...data.adDaily].sort((a, b) => a.date.localeCompare(b.date))) {
    if (r.adsetId) chavePorAdsetId.set(r.adsetId, chaves.chave(r));
  }
  const atribuir = atribuidor(data.creatives);
  const naoAtribuidos = vazio();
  /**
   * `contar` = é a passada dos LEADS do período (conta os não atribuídos e
   * aceita nome único); `false` = é a passada das REUNIÕES, que só entram com
   * id — `adsetId` do lead ou anúncio por `tipo: "id"` (relatório §7.3).
   */
  const conjuntoDoLead = (l: Lead, contar: boolean): Grupo | undefined => {
    let chave: string | undefined;
    if (l.adsetId && chavePorAdsetId.has(l.adsetId)) chave = chavePorAdsetId.get(l.adsetId);
    else {
      const a = atribuir(l);
      if (!contar && a.tipo !== "id") return undefined;
      if (a.adId) chave = chavePorAnuncio.get(a.adId);
      if (!chave && contar) {
        if (a.adId) naoAtribuidos.desconhecida += 1;
        else contarNaoAtribuido(naoAtribuidos, a.tipo);
        return undefined;
      }
    }
    const g = chave ? grupos.get(chave) : undefined;
    if (!g && contar) naoAtribuidos.semLinhaNoPeriodo += 1;
    return g;
  };

  for (const l of filterLeads(data.leads, range)) {
    const g = conjuntoDoLead(l, true);
    if (!g) continue;
    g.acc.leadsPainel += 1;
    if (l.status === "contato_invalido") g.acc.contatoInvalido += 1;
  }
  for (const l of reunioesNoPeriodo(data.leads, range)) {
    const g = conjuntoDoLead(l, false);
    if (g) g.acc.agendadas += 1;
    // Só com o nome do anúncio: a reunião fica fora de toda linha — e a nota diz.
    else if (!(l.adsetId && chavePorAdsetId.has(l.adsetId)) && atribuir(l).tipo === "nome") naoAtribuidos.reunioesSoPorNome += 1;
  }

  // Linhas de conjunto, agrupadas por (balde, campanha).
  const campanhas = new Map<string, { chaveCampanha: string; campanha: string; campaignId?: string; bucket: ObjectiveBucket; acc: Acumulado; conjuntos: LinhaMidia[] }>();
  for (const g of grupos.values()) {
    const bucket = baldeDominante(g.rows);
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
    };
    const k = `${bucket}|${g.chaveCampanha}`;
    const c = campanhas.get(k) ?? {
      chaveCampanha: g.chaveCampanha,
      campanha: g.campanha,
      campaignId: g.campaignId,
      bucket,
      acc: acumuladoVazio(),
      conjuntos: [],
    };
    c.campaignId = c.campaignId ?? g.campaignId;
    for (const key of Object.keys(c.acc) as (keyof Acumulado)[]) c.acc[key] += g.acc[key];
    c.conjuntos.push(linha);
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
    conjuntos: c.conjuntos.sort(porGasto),
  }));
  return {
    conversao: linhas.filter((l) => l.bucket === "conversao").sort(porGasto),
    descoberta: linhas.filter((l) => l.bucket === "descoberta").sort(porGasto),
    naoAtribuidos,
  };
}

/**
 * A regra de atribuição em uma frase, para a descrição dos blocos de conjuntos
 * e de criativos: o leitor vê ANTES da tabela por que a soma de "Agendadas"
 * pode ficar abaixo das reuniões da conta.
 */
export const REGRA_ATRIBUICAO_REUNIAO =
  "Reunião entra na linha só com o id do anúncio ou do conjunto (o link padrão traz {{ad.id}}); lead entra também pelo nome único do anúncio.";

/** O texto da nota abaixo da tabela de conjuntos — `null` = nada ficou de fora. */
export interface NotaDeNaoAtribuidos {
  /** Leads do período fora das linhas, por motivo. */
  leads: string | null;
  /** Reuniões do período que chegaram só com o nome do anúncio. */
  reunioes: string | null;
  /** Mostrar o atalho para gerar o link com {{ad.id}} (o que resolve os casos acima). */
  linkUtm: boolean;
}

/**
 * Leads E reuniões do período que não entraram em nenhuma linha, e por quê. As
 * reuniões que chegaram só com o nome do anúncio contam no total da conta mas
 * não em "Agendadas" de conjunto nenhum (só com id, §7.3) — a nota diz quantas,
 * senão a diferença entre a soma das linhas e o resumo fica sem explicação.
 */
export function notaDeNaoAtribuidos(n: NaoAtribuidos): NotaDeNaoAtribuidos | null {
  const partes: string[] = [];
  if (n.ambigua > 0) partes.push(`${formatInt(n.ambigua)} com nome ambíguo`);
  if (n.macro > 0) partes.push(`${formatInt(n.macro)} com macro {{…}} sem resolver`);
  if (n.desconhecida > 0) partes.push(`${formatInt(n.desconhecida)} com origem desconhecida`);
  if (n.semOrigem > 0) partes.push(`${formatInt(n.semOrigem)} sem origem (orgânico ou direto)`);
  if (n.semLinhaNoPeriodo > 0) partes.push(`${formatInt(n.semLinhaNoPeriodo)} de conjunto sem veiculação no período`);
  const leads = partes.length ? `Fora das linhas: ${partes.join(" · ")}. Esses leads contam no total, mas não no custo por conjunto.` : null;
  const r = n.reunioesSoPorNome;
  const reunioes =
    r > 0
      ? `${r === 1 ? "1 reunião do período chegou" : `${formatInt(r)} reuniões do período chegaram`} só com o nome do anúncio, sem id: ${r === 1 ? "conta" : "contam"} nas reuniões da conta, mas não em “Agendadas” de nenhum conjunto (reunião só entra com id).`
      : null;
  if (!leads && !reunioes) return null;
  return { leads, reunioes, linkUtm: n.ambigua > 0 || n.macro > 0 || r > 0 };
}

// ---------------------------------------------------------------- 4. criativos

export interface LinhaCriativo {
  nivel: "criativo" | "anuncio";
  /** `creativeId` (ou `adId` sem ele) no nível criativo; `adId` no nível anúncio. */
  chave: string;
  creativeId?: string;
  adId?: string;
  /** Nome do criativo; no anúncio, o `rotuloCriativo` (desambiguado pelo conjunto). */
  nome: string;
  formato: Creative["format"];
  thumbnailUrl?: string;
  bucket: ObjectiveBucket;
  /** Só no nível anúncio: onde ele roda. */
  conjunto?: string;
  campanha?: string;
  /** Quantos anúncios compõem o criativo (nível criativo). */
  anuncios: number;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number | null;
  cpm: number | null;
  custoPorMilAlcancados: number | null;
  /** Leads do PAINEL do período atribuídos (id ou nome único — o mesmo número do motor). */
  leadsPainel: number;
  conversoesPixel: number;
  cplPainel: number | null;
  cplPixel: number | null;
  /**
   * Reuniões AGENDADAS no período atribuídas SÓ por id do anúncio (`lead.adId`
   * ou id no utm_content) — regra do relatório §7.3 para atribuir reunião.
   */
  agendadas: number;
  custoPorAgendada: number | null;
  /** Leads do período cujo utm_content é um NOME que bate com este e com outro criativo. */
  ambiguos: number;
  hookRate?: number;
  holdRate?: number;
  saude: Fatigue;
  /** Só no nível criativo: um anúncio por conjunto, do maior gasto ao menor. */
  anunciosDetalhe?: LinhaCriativo[];
}

export interface BlocoCriativos {
  conversao: LinhaCriativo[];
  descoberta: LinhaCriativo[];
}

/** O CPL alvo da regra "sem resultado": a meta vigente ou, sem meta, o CPL do período. */
export function cplAlvoDaMidia(
  data: DashboardData,
  kp: KpisDoPeriodo,
  dia: string,
): { alvo: number | null; origem: "meta" | "periodo" | null } {
  const meta = metaVigente(data.metas, "cpl", dia);
  if (meta?.alvo != null && meta.alvo > 0) return { alvo: meta.alvo, origem: "meta" };
  if (custoExibivel(kp.cpl) && kp.cpl.valor > 0) return { alvo: kp.cpl.valor, origem: "periodo" };
  return { alvo: null, origem: null };
}

/** A regra da saúde em palavras — a dica (ⓘ) da coluna Saúde lê daqui. */
export function textoRegraSaude(cplAlvo: { alvo: number | null; origem: "meta" | "periodo" | null }): string {
  const r = REGRA_FADIGA;
  const alvo =
    cplAlvo.alvo != null
      ? `${formatCurrency(cplAlvo.alvo)} (${cplAlvo.origem === "meta" ? "meta de CPL" : "CPL do período, sem meta cadastrada"})`
      : "— (sem meta de CPL nem CPL do período: a regra fica desligada)";
  return [
    `Fadigando = CTR dos últimos ${r.janelaDias} dias ≤ ${Math.round(r.quedaCtr * 100)}% do CTR dos ${r.janelaDias} dias anteriores E (frequência ≥ ${r.frequenciaAlta} OU CPL Meta (Pixel) ${r.janelaDias} d ≥ ${Math.round(r.altaCpl * 100)}% do anterior), com ≥ ${formatInt(r.impressoesMinimas)} impressões em cada janela; as janelas terminam no fim do período.`,
    `O CPL Meta (Pixel) ${r.janelaDias} d é gasto ÷ conversões do Pixel na janela — não é o CPL (painel) da coluna ao lado; sem Pixel configurado esse lado da regra nunca dispara.`,
    `Atenção = só um dos lados da regra.`,
    `Sem resultado (só conversão) = gasto no período ≥ ${r.multiploSemResultado} × o CPL alvo com 0 leads do painel. CPL alvo: ${alvo}.`,
    `Parado = nenhuma impressão nos últimos ${r.janelaDias} dias do período, com veiculação antes, em dias que uma sincronização bem-sucedida confirmou (anúncio pausado).`,
    `Sem dados = a mesma janela vazia sem nenhum dia coberto por sincronização bem-sucedida: pode ter havido veiculação que o painel não viu.`,
    `Novo = menos de ${formatInt(r.impressoesMinimas)} impressões em alguma janela (amostra insuficiente).`,
    `Criativos de descoberta são julgados por CPM e retenção, nunca por leads.`,
  ].join(" ");
}

/**
 * A dica (ⓘ) do CABEÇALHO de uma coluna de Mídia: a regra da saúde na coluna
 * Saúde, a definição do dicionário onde a métrica tem uma, nada nas demais.
 * As duas tabelas leem daqui — o selo da célula fica com o motivo, e o
 * cabeçalho com a régua, senão o título mais interno engole a regra.
 */
export function tituloDoCabecalho(coluna: Pick<ColunaMidia, "key" | "dica">, regraSaude?: string): string | undefined {
  if (coluna.key === "saude") return regraSaude;
  return coluna.dica ? dica(coluna.dica) : undefined;
}

function saudeDe(
  rows: AdDaily[],
  bucket: ObjectiveBucket,
  gasto: number,
  leadsPainel: number,
  opts: { fim?: string; cobertura?: Intervalo[]; cplAlvo: number | null },
): Fatigue {
  return computeFatigue(rows, {
    fim: opts.fim,
    cobertura: opts.cobertura,
    semResultado: bucket === "conversao" ? { gastoPeriodo: gasto, leadsPainel, cplAlvo: opts.cplAlvo } : undefined,
  });
}

/**
 * Criativos do período agregados por `creativeId` (sem ele, por `adId`), com o
 * detalhe por anúncio (um por conjunto). Leads do painel pela junção única
 * (`atribuidor`); reuniões só com id de anúncio; nome ambíguo nunca atribui a
 * ninguém — vira `ambiguos`, que a tela mostra como "atribuição ambígua".
 */
export function criativosAgregados(
  data: DashboardData,
  range: DateRange | undefined,
  opts: {
    /** Fim do período (hoje na vista padrão): onde as janelas da saúde terminam. */
    fim?: string;
    /** Dias cobertos por syncs bem-sucedidos: sem eles a janela vazia é "Sem dados", não "Parado" (ADR-06). */
    cobertura?: Intervalo[];
    cplAlvo: number | null;
    custoPorReuniaoExibivel?: boolean;
  },
): BlocoCriativos {
  const exibivel = opts.custoPorReuniaoExibivel ?? true;
  // Sem `fim` (chamador antigo), o último dia com linha da CONTA — nunca o de
  // cada anúncio, que julgaria o pausado pelos seus próprios últimos 14 dias.
  const fim = opts.fim ?? range?.to ?? data.adDaily.reduce<string | undefined>((m, r) => (!m || r.date > m ? r.date : m), undefined);
  const saudeOpts = { fim, cobertura: opts.cobertura, cplAlvo: opts.cplAlvo };
  const perf = creativePerformance(data, range, { fim, cobertura: opts.cobertura });
  const criativoPorAd = new Map(data.creatives.map((c) => [c.adId, c]));

  const todasPorAd = new Map<string, AdDaily[]>();
  for (const r of data.adDaily) todasPorAd.set(r.adId, [...(todasPorAd.get(r.adId) ?? []), r]);
  const periodoPorAd = new Map<string, AdDaily[]>();
  for (const r of filterAds(data.adDaily, range)) periodoPorAd.set(r.adId, [...(periodoPorAd.get(r.adId) ?? []), r]);

  // Reuniões agendadas no período, SÓ por id (relatório §7.3).
  const atribuir = atribuidor(data.creatives);
  const agendadasPorAd = new Map<string, number>();
  for (const l of reunioesNoPeriodo(data.leads, range)) {
    const a = atribuir(l);
    if (a.tipo === "id" && a.adId) agendadasPorAd.set(a.adId, (agendadasPorAd.get(a.adId) ?? 0) + 1);
  }
  // Leads ambíguos do período, pelo nome que trouxeram.
  const ambiguosPorNome = new Map<string, number>();
  for (const l of filterLeads(data.leads, range)) {
    if (atribuir(l).tipo !== "ambigua") continue;
    const nome = (l.utmContent ?? "").split("|")[0].trim().toLowerCase();
    ambiguosPorNome.set(nome, (ambiguosPorNome.get(nome) ?? 0) + 1);
  }

  const anuncio = (c: CreativePerf): LinhaCriativo => {
    const rowsPeriodo = periodoPorAd.get(c.adId) ?? [];
    const bucket = baldeDominante(rowsPeriodo);
    const criativo = criativoPorAd.get(c.adId);
    const agendadas = agendadasPorAd.get(c.adId) ?? 0;
    const reach = rowsPeriodo.reduce((s, r) => s + r.reach, 0);
    return {
      nivel: "anuncio",
      chave: c.adId,
      creativeId: criativo?.creativeId,
      adId: c.adId,
      nome: rotuloCriativo(c, perf),
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
      hookRate: c.hookRate,
      holdRate: c.holdRate,
      saude: saudeDe(todasPorAd.get(c.adId) ?? [], bucket, c.spend, c.leadsPainel, saudeOpts),
    };
  };

  const grupos = new Map<string, LinhaCriativo[]>();
  for (const c of perf) {
    const chave = criativoPorAd.get(c.adId)?.creativeId ?? c.adId;
    grupos.set(chave, [...(grupos.get(chave) ?? []), anuncio(c)]);
  }

  const linhas: LinhaCriativo[] = [];
  for (const [chave, anuncios] of grupos) {
    anuncios.sort((a, b) => b.spend - a.spend);
    const soma = (f: (a: LinhaCriativo) => number) => anuncios.reduce((s, a) => s + f(a), 0);
    const spend = soma((a) => a.spend);
    const impressions = soma((a) => a.impressions);
    const clicks = soma((a) => a.clicks);
    const leadsPainel = soma((a) => a.leadsPainel);
    const conversoesPixel = soma((a) => a.conversoesPixel);
    const agendadas = soma((a) => a.agendadas);
    const reach = soma((a) => a.reach);
    const principal = anuncios[0];
    const bucket = anuncios.some((a) => a.bucket === "descoberta") && !anuncios.some((a) => a.bucket === "conversao") ? "descoberta" : principal.bucket;
    // Vídeo: gancho e retenção somados sobre os anúncios que têm os campos.
    const cri = anuncios.map((a) => criativoPorAd.get(a.adId!)).filter((c): c is Creative => Boolean(c));
    const plays = cri.reduce((s, c) => s + (c.videoPlays ?? 0), 0);
    const thru = cri.reduce((s, c) => s + (c.thruPlays ?? 0), 0);
    const rowsTodas = anuncios.flatMap((a) => todasPorAd.get(a.adId!) ?? []);
    // Ambíguos contam uma vez por criativo, não por anúncio (o nome é o mesmo).
    const ambiguos = Math.max(0, ...anuncios.map((a) => a.ambiguos));
    linhas.push({
      nivel: "criativo",
      chave,
      creativeId: principal.creativeId,
      // Nome cru do criativo; vira `rotuloCriativoAgregado` depois, quando
      // todas as linhas existem e dá para ver quem é homônimo de quem.
      nome: criativoPorAd.get(principal.adId!)?.name ?? principal.nome,
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
      hookRate: plays > 0 && impressions > 0 ? plays / impressions : undefined,
      holdRate: plays > 0 ? thru / plays : undefined,
      saude: anuncios.length === 1 ? principal.saude : saudeDe(rowsTodas, bucket, spend, leadsPainel, saudeOpts),
      anunciosDetalhe: anuncios,
    });
  }
  // Dois criativos podem se chamar "Carrossel -": o rótulo que a faixa, os
  // rankings e a coluna Nome imprimem tem de dizer QUAL (CLAUDE.md).
  const rotulos = linhas.map((l) => rotuloCriativoAgregado(l, linhas));
  linhas.forEach((l, i) => {
    l.nome = rotulos[i];
  });
  linhas.sort((a, b) => b.spend - a.spend);
  return {
    conversao: linhas.filter((l) => l.bucket === "conversao"),
    descoberta: linhas.filter((l) => l.bucket === "descoberta"),
  };
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

/** Uma frase da faixa de saúde: o rótulo em negrito e a lista, já em texto. */
export interface FraseDaFaixa {
  rotulo: string;
  texto: string;
}

/**
 * A faixa acima dos criativos: quem está fadigando (conversão e descoberta) e
 * quem gastou sem resultado (só conversão). Cita cada criativo pelo `nome` de
 * `criativosAgregados`, que já é o `rotuloCriativoAgregado` — dois "Carrossel -"
 * nunca saem como "Carrossel -, Carrossel -" (CLAUDE.md: o nome sozinho manda
 * pausar o errado). Parado não entra: anúncio pausado não fadiga. `null` = nada
 * a dizer.
 */
export function faixaDeSaude(bloco: BlocoCriativos): { fadigando: FraseDaFaixa | null; semResultado: FraseDaFaixa | null } {
  const fadigados = [...bloco.conversao, ...bloco.descoberta].filter((c) => c.saude.level === "fadigado");
  const semResultado = bloco.conversao.filter((c) => c.saude.level === "sem-resultado");
  return {
    fadigando: fadigados.length
      ? {
          rotulo: fadigados.length === 1 ? "1 criativo fadigando:" : `${fadigados.length} criativos fadigando:`,
          texto: `${fadigados.map((c) => c.nome).join(", ")}. Renove a arte antes que o custo dispare.`,
        }
      : null,
    semResultado: semResultado.length
      ? {
          rotulo: semResultado.length === 1 ? "1 criativo sem resultado:" : `${semResultado.length} criativos sem resultado:`,
          texto: `${semResultado.map((c) => `${c.nome} (${formatCurrency0(c.spend)})`).join(", ")} — gasto de pelo menos ${REGRA_FADIGA.multiploSemResultado} × o CPL alvo e nenhum lead do painel.`,
        }
      : null,
  };
}

// ---------------------------------------------------------------- 5. rankings

/**
 * Volume mínimo para um criativo entrar num ranking: ≥ 10 leads do painel OU
 * ≥ R$ 100 de gasto. Sem isso, 1 lead a R$ 10 "vence" 40 a R$ 35.
 */
export const VOLUME_MINIMO_RANKING = { leads: 10, gasto: 100 } as const;

export function temVolumeParaRanking(c: Pick<LinhaCriativo, "leadsPainel" | "spend">): boolean {
  return c.leadsPainel >= VOLUME_MINIMO_RANKING.leads || c.spend >= VOLUME_MINIMO_RANKING.gasto;
}

export interface Rankings {
  melhorCpl: LinhaCriativo | null;
  maiorCtr: LinhaCriativo | null;
  /** Quantos criativos tinham volume para concorrer. */
  elegiveis: number;
  /** Quantos ficaram fora por volume baixo. */
  descartados: number;
}

/** "n" visível do ranking: a amostra que sustenta a razão. */
export function amostraDoRanking(c: Pick<LinhaCriativo, "leadsPainel" | "spend" | "impressions">): string {
  return `n = ${formatInt(c.leadsPainel)} ${c.leadsPainel === 1 ? "lead" : "leads"} · ${formatCurrency0(c.spend)} · ${formatInt(c.impressions)} impressões`;
}

export function rankingsDeCriativos(criativos: LinhaCriativo[]): Rankings {
  const elegiveis = criativos.filter(temVolumeParaRanking);
  const comLead = elegiveis.filter((c) => c.leadsPainel > 0 && c.cplPainel != null);
  const comImpressao = elegiveis.filter((c) => c.impressions > 0);
  return {
    melhorCpl: [...comLead].sort((a, b) => a.cplPainel! - b.cplPainel!)[0] ?? null,
    maiorCtr: [...comImpressao].sort((a, b) => b.ctr - a.ctr)[0] ?? null,
    elegiveis: elegiveis.length,
    descartados: criativos.length - elegiveis.length,
  };
}

// ---------------------------------------------------------------- colunas

/** De onde vem o número da coluna — o teste confere que "Leads" nunca é do Pixel. */
export type FonteColuna = "meta" | "painel" | "pixel" | "misto";

export interface ColunaMidia {
  key: string;
  header: string;
  fonte: FonteColuna;
  /** Entrada do dicionário para o ⓘ, quando existe. */
  dica?: MetricaId;
  /** Vai para a linha expandida (B13: a tabela cabe no card a 1366 px). */
  secundaria?: boolean;
}

export const COLUNAS_CONJUNTOS_CONVERSAO: ColunaMidia[] = [
  { key: "nome", header: "Campanha › conjunto", fonte: "meta" },
  { key: "spend", header: "Gasto", fonte: "meta", dica: "investimento" },
  { key: "leadsPainel", header: "Leads (painel)", fonte: "painel", dica: "leads" },
  { key: "conversoesPixel", header: "Conversões Meta (Pixel)", fonte: "pixel", dica: "conversoes_pixel" },
  { key: "cplPainel", header: "CPL (painel)", fonte: "misto", dica: "cpl" },
  { key: "agendadas", header: "Agendadas", fonte: "painel", dica: "reunioes_agendadas" },
  { key: "custoPorAgendada", header: "Custo por agendada", fonte: "misto", dica: "custo_por_reuniao" },
  { key: "pctContatoInvalido", header: "% contato inválido", fonte: "painel" },
];

export const COLUNAS_CONJUNTOS_DESCOBERTA: ColunaMidia[] = [
  { key: "nome", header: "Campanha › conjunto", fonte: "meta" },
  { key: "spend", header: "Gasto", fonte: "meta", dica: "investimento_descoberta" },
  { key: "impressions", header: "Impressões", fonte: "meta" },
  { key: "reach", header: "Alcance somado", fonte: "meta" },
  { key: "cpm", header: "CPM", fonte: "meta" },
  { key: "custoPorMilAlcancados", header: "Custo / mil alcançados", fonte: "meta" },
  { key: "ctr", header: "CTR", fonte: "meta" },
];

export const COLUNAS_CRIATIVOS_CONVERSAO: ColunaMidia[] = [
  { key: "nome", header: "Criativo", fonte: "meta" },
  { key: "spend", header: "Gasto", fonte: "meta", dica: "investimento" },
  { key: "leadsPainel", header: "Leads (painel)", fonte: "painel", dica: "leads" },
  { key: "cplPainel", header: "CPL (painel)", fonte: "misto", dica: "cpl" },
  { key: "agendadas", header: "Agendadas", fonte: "painel", dica: "reunioes_agendadas" },
  { key: "custoPorAgendada", header: "Custo por agendada", fonte: "misto", dica: "custo_por_reuniao" },
  { key: "saude", header: "Saúde", fonte: "meta" },
  { key: "ctr", header: "CTR", fonte: "meta", secundaria: true },
  { key: "cpc", header: "CPC", fonte: "meta", secundaria: true },
  { key: "cpm", header: "CPM", fonte: "meta", secundaria: true },
  { key: "conversoesPixel", header: "Conversões Meta (Pixel)", fonte: "pixel", dica: "conversoes_pixel", secundaria: true },
  { key: "cplPixel", header: "CPL Meta (Pixel)", fonte: "pixel", dica: "conversoes_pixel", secundaria: true },
  { key: "holdRate", header: "Retenção", fonte: "meta", secundaria: true },
];

export const COLUNAS_CRIATIVOS_DESCOBERTA: ColunaMidia[] = [
  { key: "nome", header: "Criativo", fonte: "meta" },
  { key: "spend", header: "Gasto", fonte: "meta", dica: "investimento_descoberta" },
  { key: "impressions", header: "Impressões", fonte: "meta" },
  { key: "cpm", header: "CPM", fonte: "meta" },
  { key: "hookRate", header: "Gancho (3 s)", fonte: "meta" },
  { key: "holdRate", header: "Retenção", fonte: "meta" },
  { key: "saude", header: "Saúde", fonte: "meta" },
  { key: "ctr", header: "CTR", fonte: "meta", secundaria: true },
  { key: "reach", header: "Alcance somado", fonte: "meta", secundaria: true },
  { key: "custoPorMilAlcancados", header: "Custo / mil alcançados", fonte: "meta", secundaria: true },
];

export const TODAS_AS_COLUNAS: ColunaMidia[][] = [
  COLUNAS_CONJUNTOS_CONVERSAO,
  COLUNAS_CONJUNTOS_DESCOBERTA,
  COLUNAS_CRIATIVOS_CONVERSAO,
  COLUNAS_CRIATIVOS_DESCOBERTA,
];

// ---------------------------------------------------------------- 6. descoberta

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

/** "—" quando não há denominador, nunca "R$ 0,00". */
export const moedaOuTraco = (v: number | null | undefined): string => (v == null ? "—" : formatCurrency(v));
export const pctOuTraco = (v: number | null | undefined): string => (v == null ? "—" : formatPercent(v));
