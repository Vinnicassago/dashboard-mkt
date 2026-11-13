/**
 * O CONTRATO DA TELA DA MÍDIA e o que o client lê (Fase 4, nov/26, K24): os tipos
 * que `montarMidiaDaTela` (`lib/midia.ts`) devolve, as colunas das tabelas e os
 * helpers que os componentes client usam.
 *
 * Imports de VALOR só de `./format`, `./dicionario` e `./trust` — o resto é
 * `import type`. Assim o bundle de `/midia` não arrasta a Fila, a identidade, o
 * contato, a live e o robô (que `midia.ts` importa), e um `server-only` futuro nesse
 * grafo não quebra o build. Os clients (`creatives-table.tsx`, `conjuntos-table.tsx`,
 * `miniatura.tsx`) importam valor SÓ daqui (mais `format` e `trust`); `midia.ts`
 * reexporta tudo (`export * from "./midia-tela"`) para o servidor.
 */

import { dica, type MetricaId } from "./dicionario";
import { formatCurrency } from "./format";
import { MIN_REUNIOES } from "./trust";
import type { Alerta } from "./alertas";
import type { Intervalo } from "./cobertura";
import type { CriativosDaLive } from "./criativos-live";
import type { KpisDoPeriodo, OpcoesKpis } from "./kpis";
import type { CampanhaDaLive } from "./live";
import type { DateRange, Fatigue, ObjectiveBucket } from "./metrics";
import type { DescobertaMidia, PontoSemanalMidia } from "./midia";
import type { RoboAgora } from "./robo/situacao";
import type { LeituraDaQualidade, MediaDosCriativos, Sinal, SinalDoCriativo, TomDoSinal } from "./sinal-do-criativo";
import type { Creative, DashboardData, LeadEvent } from "./types";
import type { Veiculacao } from "./veiculacao";

// ---------------------------------------------------------------- as linhas

/** A qualidade pelo robô, pronta para a tela (sem contagem crua: o client não recebe `fora`, que tem a chave `live`). */
export interface QualidadeDaLinha {
  estado: LeituraDaQualidade["estado"];
  /** "6 de 9 · 67%" (base ≥ AMOSTRA_MINIMA) · "1 de 2" · "—" (base 0) · "≥ 6" (leitura parada). */
  responderam: string;
  /** Base = quem respondeu. */
  aceitaram: string;
  /** Base = no robô. */
  semWhatsapp: string;
  /** A razão exata de cada coluna, para o `sortValue` do DataTable (K24); null com base 0. Nunca é exibida. */
  valores: { responderam: number | null; aceitaram: number | null; semWhatsapp: number | null };
  /** O `title` da célula (dentro da tabela): dicaDoRecorteDoRobo da linha + "{t} teste ou cópia fora da conta" + "{p} ainda nas 24 h". */
  dica: string;
}

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
  /**
   * O gasto das linhas de anúncio de CONVERSÃO (`bucketOfAd`) — a verba. Num conjunto
   * misto (um anúncio de descoberta com gasto), menor que `spend`; Σ nas linhas da verba
   * = o investimento de conversão. Ausente só em linha montada à mão (= `spend`).
   */
  gastoConversao?: number;
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
  /** No ar, parou ou sem leitura (`veiculacaoNoFim`); na campanha, a do grupo de conjuntos. */
  veiculacao: Veiculacao;
  /** A resposta ao robô da linha; null sem o trecho do robô. */
  qualidade: QualidadeDaLinha | null;
  /** Só no nível conjunto, com `cfgLive`: toda linha do período é `ehDaLive` (a live vira UMA linha na verba, K19). */
  daLive?: boolean;
  /** Só no nível campanha: os conjuntos, do maior gasto ao menor. */
  conjuntos?: LinhaMidia[];
}

export interface LinhaCriativo {
  nivel: "criativo" | "anuncio";
  /**
   * `creativeId` (ou `adId` sem ele) no nível criativo — com `live|` na frente para os
   * anúncios da live (K20) e `desc|` para os de descoberta de um criativo que também roda
   * em conversão; `adId` no nível anúncio.
   */
  chave: string;
  creativeId?: string;
  adId?: string;
  /** Nome do criativo (`rotuloCriativoAgregado`); no anúncio, o `rotuloCriativo` (desambiguado pelo conjunto). */
  nome: string;
  /** O nome CRU (`Creative.name` do anúncio principal), antes da desambiguação — o cartão e a desambiguação leem daqui. */
  nomeCru?: string;
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
  /** Reuniões AGENDADAS no período atribuídas SÓ por id do anúncio. */
  agendadas: number;
  custoPorAgendada: number | null;
  /** Leads do período cujo utm_content é um NOME que bate com este e com outro criativo. */
  ambiguos: number;
  /** A fadiga (`computeFatigue` no período) — a tela só a mostra para quem está no ar (F4-D29). */
  saude: Fatigue;
  /** No ar, parou ou sem leitura — do criativo (todos os anúncios dele) ou do anúncio. */
  veiculacao: Veiculacao;
  /** Leads do período desta linha com status "Contato inválido". */
  contatoInvalido: number;
  pctContatoInvalido: number | null;
  /** Linha de anúncios da live (chave `live|…`, K20). Sem sinal, sem cartão, fora da média. */
  daLive: boolean;
  /** Só nível criativo de conversão, com o trecho do robô. */
  qualidade: QualidadeDaLinha | null;
  /** Só conversão, fora a live, NO AR. */
  sinal: SinalDoCriativo | null;
  /** Só no nível criativo: um anúncio por conjunto, do maior gasto ao menor. */
  anunciosDetalhe?: LinhaCriativo[];
}

// ---------------------------------------------------------------- fora das linhas

export type MotivoForaDaLinha =
  | "anuncio-de-fora" // o lead TEM id de anúncio, e o anúncio não está nas linhas desta marca (K16)
  | "desconhecida" // sem id; o nome não bate com nenhum anúncio
  | "sem-origem" // sem UTM de anúncio
  | "ambigua"
  | "macro"
  | "sem-linha-no-periodo"; // conjunto ou anúncio conhecido, sem gasto no período

export interface ForaDasLinhasDeConversao {
  /** Leads de conversão do período (baldeDosLeads = "conversao") sem conjunto de conversão. */
  n: number;
  /** = kp.leadsConversao.valor. */
  de: number;
  porMotivo: Record<MotivoForaDaLinha | "linha-de-descoberta", number>;
  /** Chave do conjunto de CONVERSÃO → leads de conversão dele, da MESMA passada (K11). Interno: nunca vai para client. */
  porConjunto: Map<string, number>;
  /** Leads do período com balde "organico" (fora da mídia): só o ⓘ dos conjuntos (K33). */
  organicos: number;
}

// ---------------------------------------------------------------- a verba

export interface LinhaDaVerba {
  /** Chave do conjunto, "live", "fora-do-ar" ou "fora-das-linhas". */
  chave: string;
  rotulo: string;
  tipo: "no-ar" | "live" | "fora-do-ar" | "fora-das-linhas";
  /** "42%" · "< 1%" · "—". */
  pctVerba: string;
  /** "73%" · "—" · "8 de 23 leads". */
  pctLeads: string;
  /** 0..1, fração exata (0 em fora-das-linhas). */
  barraVerba: number;
  barraLeads: number;
}

/** `linhas` = [] nas regras 1 e 2 sem a Live. */
export interface VerbaDaTela {
  titulo: string;
  dica: string;
  linhas: LinhaDaVerba[];
}

// ---------------------------------------------------------------- os cartões

export interface CardDoCriativo {
  chave: string;
  /** O nome CRU do criativo, ≤ 8 palavras ou 60 caracteres + "…" (K30). */
  nome: string;
  /** Só com homônimo: "{conjunto} · {4 dígitos}", ≤ 4 palavras; numa linha própria, sem clamp. */
  desambiguacao: string | null;
  /** O rotuloCriativoAgregado inteiro (= o nome na tabela de Detalhes; a IA; o `rotulo` do ⓘ). */
  nomeCompleto: string;
  formato: Creative["format"];
  /** `miniaturaValida(...)`. */
  miniatura: string | null;
  sinal: { id: Sinal; rotulo: string; tom: TomDoSinal };
  /** = SinalDoCriativo.motivo */
  motivo: string;
  /** = SinalDoCriativo.ressalva */
  ressalva: string | null;
  /** = SinalDoCriativo.linha */
  linha: string | null;
  /** = SinalDoCriativo.dica */
  dica: string;
  /** Textos prontos; "≥ " no gasto e no CPL com o gasto em piso (K13). `razao` = "0,4×" só com razão e ≥ 3 leads. */
  numeros: {
    gasto: string;
    leads: string;
    cpl: string;
    razao: string | null;
    pctVerba: string;
    pctLeads: string;
    barraVerba: number;
    barraLeads: number;
  };
  robo: { responderam: string; aceitaram: string; semWhatsapp: string } | null;
}

export interface CriativosNoArDaTela {
  titulo: string;
  dica: string;
  /** "Robô sem leitura desde 05/11 12:30 ⚠" — só com o trecho do robô e a leitura parada. */
  leituraParada: string | null;
  /** ≤ 5 (os que a tela desenha). */
  cards: CardDoCriativo[];
  /** TODOS os de conversão no ar (fora a live), na mesma ordem — `midiaParaIA` e o N do "Ver todos"; a página não o desenha. */
  todos: CardDoCriativo[];
  /** Quantos criativos de conversão (fora a live) estão fora do ar no período. */
  pausados: number;
  /** N = todos.length = detalhes.criativos.conversao.length (K34). */
  verTodos: { texto: string; href: "#criativos-tabela" } | null;
}

// ---------------------------------------------------------------- os recolhidos

/** As MESMAS linhas das DataTable de Detalhes, as de conversão fora do ar (K39). */
export interface PausadosDaTela {
  dica: string;
  conjuntos: LinhaMidia[];
  criativos: LinhaCriativo[];
}

export interface DiaDaMidia {
  date: string;
  valor: number;
  semDado: boolean;
  semVeiculacao: boolean;
}

export interface DetalhesDaTela {
  /**
   * Há verba de conversão no período (não awareness): só então Detalhes desenha as
   * tabelas de conversão (`#conjuntos`, `#criativos-tabela`). Sem ela, `#conjuntos` é o
   * sub-bloco da descoberta (o destino do "abrir →" de vanity-objective).
   */
  comConversao: boolean;
  dica: string;
  tendencia: { pontos: PontoSemanalMidia[]; dica: string };
  /**
   * conversao = só os NO AR (campanhas remontadas, a live incluída); descoberta = todas.
   * `foraDoAr` = o que está em Pausados, a live incluída (`daLive` deles são da live: o
   * "Fora do ar" da verba não tem a live, que lá é uma linha própria).
   */
  conjuntos: { conversao: LinhaMidia[]; descoberta: LinhaMidia[]; dica: string; foraDoAr: { gasto: string; n: number; daLive: number } | null };
  /** conversao = os no ar sem a live (= m.criativos.todos); descoberta = todas. */
  criativos: {
    conversao: LinhaCriativo[];
    descoberta: LinhaCriativo[];
    dica: string;
    regras: { sinal: string; fadiga: string };
    foraDoAr: { gasto: string; n: number } | null;
    liveNoBloco: boolean;
  };
  descoberta: { numeros: DescobertaMidia; dica: string; dicaAlcance: string; dicaCustoPorMil: string } | null;
  diario: { dados: DiaDaMidia[]; faixas: { from: string; to: string; tom: "pausa" | "falha" }[]; dica: string };
}

// ---------------------------------------------------------------- a tela

/** A situação do robô nos criativos de conversão (K23): sai SEMPRE do trecho dos criativos, com ou sem `criativos`. */
export type RoboNosCriativos = "ok" | "leitura-parada" | "robo-desligado" | "antes-do-robo" | "ninguem-no-robo";

export interface MidiaDaTela {
  rangeKey: string;
  alertas: Alerta[];
  resumo: { texto: string; dica: string };
  /** null na awareness. */
  conferir: { href: string; rotulo: "Conferir com o Gerenciador →" } | null;
  verba: VerbaDaTela | null;
  criativos: CriativosNoArDaTela | null;
  /** Vai para um SERVER component. */
  live: { r: CriativosDaLive; dica: string } | null;
  pausados: PausadosDaTela | null;
  detalhes: DetalhesDaTela;
  /** As colunas do robô (cartões, Detalhes e Pausados) — UM valor para a página inteira (K23, K24). */
  colunasDoRobo: boolean;
  /**
   * Há dias sem dado de gasto (`kp.investimento` em piso, K13): todo gasto de linha e o
   * que sai dele (CPL, custo por agendada, o R$ do motivo do sinal) leva "≥" — nos
   * cartões, em Detalhes e em Pausados. UM valor para a página inteira.
   */
  pisoDeGasto: boolean;
  /** Interno (só `midiaParaIA` e o ⓘ): renomeado de `situacaoDoRobo` para não colidir com a fonte única `situacaoDoRobo()` (K23). */
  roboNosCriativos: RoboNosCriativos;
}

export interface EntradaMidia {
  data: DashboardData;
  range: DateRange | undefined;
  /** Resolvida (sem ?range= = "7d"). O recorte da live decide pela chave (K8): não há `periodoExplicito`. */
  rangeKey: string;
  naoComecou: boolean;
  kpis: KpisDoPeriodo;
  /** As opções de kpis da página (brandRules, campanhasDaConta, cobertura) — para a tendência semanal. */
  opcoesKpis: Omit<OpcoesKpis, "hoje" | "comparar" | "agora">;
  eventos: readonly LeadEvent[];
  robo?: RoboAgora;
  cobertura: Intervalo[];
  /** `estadoDaFonte("ads", marca).ultimoOk` (ISO) — o dia de referência do "no ar". */
  ultimoSyncAds: string | null;
  cfgLive: CampanhaDaLive;
  marca: string;
  hoje: string;
  agora: string;
}

export interface EntradaDosSinais {
  data: DashboardData;
  range: DateRange | undefined;
  kpis: KpisDoPeriodo;
  eventos: readonly LeadEvent[];
  robo?: RoboAgora;
  cobertura: Intervalo[];
  ultimoSyncAds: string | null;
  /** Sem ele, a live não é separada (só os testes do motor; §3.8). */
  cfgLive?: CampanhaDaLive;
  hoje: string;
  agora: string;
}

/** A Mídia como a tela a escreve, para a IA (§3.9). Sem pessoa. */
export interface MidiaParaIA {
  /** m.resumo.texto */
  resumo: string;
  verba: { titulo: string; linhas: { conjunto: string; pctVerba: string; pctLeads: string; tipo: LinhaDaVerba["tipo"] }[] } | null;
  criativos: {
    titulo: string;
    /** TODOS os de conversão no ar (fora a live), na ordem dos cartões — não só os 5 (`m.criativos.todos`). */
    noAr: {
      criativo: string;
      sinal: string;
      motivo: string;
      ressalva: string | null;
      gasto: string;
      leads: string;
      cpl: string;
      robo: { responderam: string; aceitaram: string; semWhatsapp: string } | null;
    }[];
    /** m.criativos.pausados */
    pausados: number;
    /** textoDaReguaDoSinal() */
    regua: string;
  } | null;
  /** Sempre presente (K23): sai de `m.roboNosCriativos`, que existe mesmo sem `m.criativos`. */
  robo: { situacao: RoboNosCriativos };
}

/** Os tipos do sinal e da média que a tela também lê (reexportados só como tipo). */
export type { MediaDosCriativos, Sinal, SinalDoCriativo, TomDoSinal, Veiculacao };

// ---------------------------------------------------------------- colunas

/** De onde vem o número da coluna — o teste confere que "Leads" nunca é do Pixel. */
export type FonteColuna = "meta" | "painel" | "pixel" | "misto" | "robo";

export interface ColunaMidia {
  key: string;
  header: string;
  fonte: FonteColuna;
  /** Entrada do dicionário para o ⓘ, quando existe. */
  dica?: MetricaId;
  /** Vai para a linha expandida (B13: a tabela cabe no card a 1366 px). */
  secundaria?: boolean;
}

/** As 3 colunas do robô (somem quando `colunasDoRobo` é falso; quem decide é o componente). */
const COLUNAS_DO_ROBO: ColunaMidia[] = [
  { key: "roboResponderam", header: "Responderam (robô)", fonte: "robo", dica: "responderam" },
  { key: "roboAceitaram", header: "Aceitaram (robô)", fonte: "robo", dica: "convite_aceito" },
  { key: "roboSemWhatsapp", header: "Sem WhatsApp (robô)", fonte: "robo", dica: "sem_whatsapp" },
];

const VEICULACAO: ColunaMidia = { key: "veiculacao", header: "Veiculação", fonte: "meta" };

export const COLUNAS_CONJUNTOS_CONVERSAO: ColunaMidia[] = [
  { key: "nome", header: "Campanha › conjunto", fonte: "meta" },
  VEICULACAO,
  { key: "spend", header: "Gasto", fonte: "meta", dica: "investimento" },
  { key: "leadsPainel", header: "Leads (painel)", fonte: "painel", dica: "leads" },
  { key: "conversoesPixel", header: "Conversões Meta (Pixel)", fonte: "pixel", dica: "conversoes_pixel" },
  { key: "cplPainel", header: "CPL (painel)", fonte: "misto", dica: "cpl" },
  { key: "agendadas", header: "Agendadas", fonte: "painel", dica: "reunioes_agendadas" },
  { key: "custoPorAgendada", header: "Custo por agendada", fonte: "misto", dica: "custo_por_reuniao" },
  { key: "pctContatoInvalido", header: "% contato inválido", fonte: "painel" },
  ...COLUNAS_DO_ROBO,
];

export const COLUNAS_CONJUNTOS_DESCOBERTA: ColunaMidia[] = [
  { key: "nome", header: "Campanha › conjunto", fonte: "meta" },
  VEICULACAO,
  { key: "spend", header: "Gasto", fonte: "meta", dica: "investimento_descoberta" },
  { key: "impressions", header: "Impressões", fonte: "meta" },
  { key: "reach", header: "Alcance somado", fonte: "meta" },
  { key: "cpm", header: "CPM", fonte: "meta" },
  { key: "custoPorMilAlcancados", header: "Custo / mil alcançados", fonte: "meta" },
  { key: "ctr", header: "CTR", fonte: "meta" },
];

export const COLUNAS_CRIATIVOS_CONVERSAO: ColunaMidia[] = [
  { key: "nome", header: "Criativo", fonte: "meta" },
  VEICULACAO,
  { key: "spend", header: "Gasto", fonte: "meta", dica: "investimento" },
  { key: "leadsPainel", header: "Leads (painel)", fonte: "painel", dica: "leads" },
  { key: "cplPainel", header: "CPL (painel)", fonte: "misto", dica: "cpl" },
  { key: "agendadas", header: "Agendadas", fonte: "painel", dica: "reunioes_agendadas" },
  { key: "custoPorAgendada", header: "Custo por agendada", fonte: "misto", dica: "custo_por_reuniao" },
  { key: "sinal", header: "Sinal", fonte: "misto", dica: "sinal_do_criativo" },
  ...COLUNAS_DO_ROBO,
  { key: "ctr", header: "CTR", fonte: "meta", secundaria: true },
  { key: "cpc", header: "CPC", fonte: "meta", secundaria: true },
  { key: "cpm", header: "CPM", fonte: "meta", secundaria: true },
  { key: "conversoesPixel", header: "Conversões Meta (Pixel)", fonte: "pixel", dica: "conversoes_pixel", secundaria: true },
  { key: "cplPixel", header: "CPL Meta (Pixel)", fonte: "pixel", dica: "conversoes_pixel", secundaria: true },
];

export const COLUNAS_CRIATIVOS_DESCOBERTA: ColunaMidia[] = [
  { key: "nome", header: "Criativo", fonte: "meta" },
  VEICULACAO,
  { key: "spend", header: "Gasto", fonte: "meta", dica: "investimento_descoberta" },
  { key: "impressions", header: "Impressões", fonte: "meta" },
  { key: "cpm", header: "CPM", fonte: "meta" },
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

/**
 * A dica (ⓘ) do CABEÇALHO de uma coluna de Mídia: a régua do sinal na coluna Sinal
 * (conversão), a da fadiga na coluna Saúde (descoberta), a definição do dicionário
 * onde a métrica tem uma, nada nas demais. O selo da célula fica com o motivo, e o
 * cabeçalho com a régua.
 */
export function tituloDoCabecalho(coluna: Pick<ColunaMidia, "key" | "dica">, regras?: { sinal: string; fadiga: string }): string | undefined {
  if (coluna.key === "sinal") return regras?.sinal ?? (coluna.dica ? dica(coluna.dica) : undefined);
  if (coluna.key === "saude") return regras?.fadiga;
  return coluna.dica ? dica(coluna.dica) : undefined;
}

// ---------------------------------------------------------------- helpers do client

/** "—" quando não há denominador, nunca "R$ 0,00". */
export const moedaOuTraco = (v: number | null | undefined): string => (v == null ? "—" : formatCurrency(v));

/** O prefixo de um valor que sai do GASTO quando há dias sem dado de gasto (`MidiaDaTela.pisoDeGasto`, K13): "≥ ". */
export const prefixoDoPiso = (piso: boolean | undefined): string => (piso ? "≥ " : "");

/**
 * O CPL de UMA linha (F4-D23): impresso só com ≥ 3 leads (a régua `AMOSTRA_MINIMA` =
 * `MIN_REUNIOES`); 0 → "—"; 1–2 → "— (n = 1)". Com `piso` (dias sem dado de gasto,
 * K13), "≥ " na frente do valor. Nos cartões, em Pausados e nas tabelas de Detalhes.
 */
export function textoDoCplDaLinha(gasto: number, leads: number, o?: { piso?: boolean }): string {
  if (leads <= 0) return "—";
  if (leads < MIN_REUNIOES) return `— (n = ${leads})`;
  return `${prefixoDoPiso(o?.piso)}${formatCurrency(gasto / leads)}`;
}
