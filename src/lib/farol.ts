/**
 * O FAROL — um número, um veredito, uma ação.
 *
 * O problema que ele resolve: a Visão Geral abria com seis KPIs do mesmo
 * tamanho e o único bloco que diz o que fazer ("Próximas ações") ficava no
 * rodapé, depois de dez blocos. A ordem da tela era o inverso da ordem de
 * utilidade — e seis números empatados não são hierarquia, são empate.
 *
 * Duas regras que fazem ele não virar mais um KPI:
 *
 * 1. O NÚMERO É ESCOLHIDO, NÃO FIXO. O North Star é o custo por reunião; mas
 *    quando ele está em quarentena (amostra pequena, fontes divergentes, gasto
 *    contaminado), o farol desce para o degrau mais fundo da cascata que ainda
 *    é confiável e DIZ que desceu. Farol que mostra número furado é pior que
 *    farol nenhum.
 *
 * 2. O VEREDITO OLHA O FUNIL INTEIRO. "CPL de R$ 27" isolado parece ótimo; com
 *    nove pessoas paradas depois dele, a leitura correta é que a mídia está
 *    barata e o dinheiro está empacado adiante. É a comparação entre o topo e o
 *    fundo que produz direção — nenhum dos dois sozinho.
 *
 * Função PURA. Recebe o que as outras camadas já calcularam.
 */

import type { Degrau } from "./cascata";
import type { TrustReport } from "./trust";
import { custoExibivel, type KpisDoPeriodo } from "./kpis";

export type FarolEstado = "pare" | "atencao" | "ok" | "sem-dado";

export interface FarolAcao {
  label: string;
  href: string;
}

export interface Farol {
  estado: FarolEstado;
  /** Uma palavra, em caixa alta — o que fazer com a atenção agora. */
  verbo: string;
  /** O número bruto — quem formata é o componente. */
  valor: number | null;
  /** Como formatar: dinheiro ou contagem de pessoas. */
  formato: "moeda" | "pessoas";
  rotulo: string;
  /** Como o número foi obtido, em meia linha. */
  base?: string;
  /** O real é maior (falta dado de gasto). */
  piso: boolean;
  /** Por que não é o custo por reunião. Vazio quando é. */
  porQueEsteNumero?: string;
  /** O veredito, em uma ou duas frases. */
  veredito: string;
  acao?: FarolAcao;
}

export interface FarolInput {
  /** Degraus da cascata, na ordem. */
  degraus: Degrau[];
  trust: TrustReport;
  /** Os KPIs do período — o farol imprime ESTES números, não os seus. */
  kpis: Pick<
    KpisDoPeriodo,
    "leads" | "leadsConversao" | "cpl" | "custoPorReuniao" | "reunioesConversao" | "investimentoConversao"
  >;
  /** Meta de custo por reunião, se cadastrada. */
  metaCpr?: number;
  /** Pessoas paradas agora, somadas de todas as juntas. */
  parados: number;
  /** Mídia já paga pelas pessoas paradas. */
  midiaParada: number;
  /** Onde a Fila mostra essas pessoas (o número do botão é o da página). */
  filaHref?: string;
  /**
   * As fontes do fundo do funil (robô e atendimento) foram lidas com sucesso?
   *
   * Sem isto o farol tem um modo de falha caríssimo: a leitura do robô cai, a
   * contagem de parados zera, e a tela escreve "no ritmo" justamente quando
   * ninguém está sendo atendido. Silêncio por falta de dado não é boa notícia.
   */
  fontesOk: boolean;
}

/** Amostra mínima para um degrau servir de farol. */
const MIN_AMOSTRA = 3;

/**
 * O degrau mais fundo que ainda sustenta um custo unitário: tem valor, tem
 * amostra e tem custo. É o substituto natural do CPR — o ponto mais próximo do
 * dinheiro sobre o qual ainda dá para afirmar alguma coisa.
 */
function degrauMaisFundoConfiavel(degraus: Degrau[]): Degrau | undefined {
  for (let i = degraus.length - 1; i >= 0; i--) {
    const d = degraus[i];
    if (d.valor != null && d.valor >= MIN_AMOSTRA && d.custoUnitario !== undefined) return d;
  }
  return undefined;
}

const brl = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;

/**
 * A frase que descreve a saúde da mídia. Sempre a primeira do veredito, porque
 * é a comparação entre ela e o fundo que produz a leitura correta: "lead a
 * R$ 27" sozinho parece ótimo, e com nove pessoas paradas atrás dele quer dizer
 * que o dinheiro está empacando depois da mídia, não antes.
 */
function fraseDaMidia(kpis: FarolInput["kpis"]): string | null {
  if (kpis.leads.valor <= 0 || !custoExibivel(kpis.cpl)) return null;
  const sobre =
    kpis.leadsConversao.valor !== kpis.leads.valor ? ` (CPL sobre os ${kpis.leadsConversao.valor} de conversão)` : "";
  return `A mídia está entregando: ${kpis.leads.valor} leads a ${brl(kpis.cpl.valor)}${sobre}`;
}

/** O FATO, quando a razão não pode ser impressa (decisão 4.2): verba e reuniões, sem dividir. */
function fatoDoCusto(kpis: FarolInput["kpis"]): string {
  const n = kpis.reunioesConversao.valor;
  return `${brl(kpis.investimentoConversao.valor)} investidos em conversão para ${n} ${n === 1 ? "reunião" : "reuniões"} no período`;
}

export function montarFarol(input: FarolInput): Farol {
  const { trust, kpis } = input;
  // A régua é a do custo por reunião em TODA a tela (`custoExibivel`): trava de
  // confiança OU menos de MIN_REUNIOES reuniões de conversão. Um piso/teto não
  // pode mascarar a falta de amostra — senão "R$ 0 por reunião" volta ao farol.
  const nConv = kpis.reunioesConversao.valor;
  const cprQuarentena = custoExibivel(kpis.custoPorReuniao)
    ? trust.porMetrica.cpr
    : trust.porMetrica.cpr?.nivel === "quarentena"
      ? trust.porMetrica.cpr
      : {
          nivel: "quarentena" as const,
          motivo:
            nConv === 0
              ? "Nenhuma reunião de conversão no período"
              : `Só ${nConv} ${nConv === 1 ? "reunião" : "reuniões"} de conversão no período`,
        };
  const piso =
    trust.porMetrica.cpr?.nivel === "piso" || trust.porMetrica.spend?.nivel === "piso";

  /*
   * GENTE PARADA VENCE QUALQUER OUTRO NÚMERO.
   *
   * O North Star declarado é o custo por reunião, mas ele é o placar de ontem:
   * já aconteceu, e não tem botão. As pessoas paradas são o custo por reunião
   * de amanhã — a mídia já pagou por elas, ainda dá para recuperá-las, e
   * destravá-las não custa verba nova. É a única coisa da tela que o gestor
   * resolve esta semana, então é ela que ocupa o farol.
   */
  if (input.parados > 0) {
    const partes = [fraseDaMidia(kpis)].filter(Boolean) as string[];
    partes.push(
      `O dinheiro morre depois dela: ${input.parados} pessoa${input.parados > 1 ? "s" : ""} ` +
        `${input.parados > 1 ? "estão paradas" : "está parada"} esperando contato` +
        (input.midiaParada > 0 ? `, e a mídia já pagou ${brl(input.midiaParada)} por elas` : ""),
    );
    // Com menos de 3 reuniões o custo por reunião está em quarentena em toda a
    // tela — o farol, o bloco mais lido, não pode ser a exceção que imprime o valor.
    const n = kpis.reunioesConversao.valor;
    if (n > 0 && !custoExibivel(kpis.custoPorReuniao)) {
      partes.push(
        `Com ${n} ${n === 1 ? "reunião" : "reuniões"} de conversão, o custo por reunião ainda não é medida — ` +
          "ele só cai atendendo essas pessoas, não trocando o anúncio",
      );
    }
    return {
      estado: "pare",
      verbo: "PARE",
      valor: input.parados,
      formato: "pessoas",
      rotulo: `pessoa${input.parados > 1 ? "s" : ""} esperando contato agora`,
      base: input.midiaParada > 0 ? `${brl(input.midiaParada)} de mídia já paga` : undefined,
      piso: false,
      veredito: partes.join(". ") + ".",
      acao: { label: `Abrir a fila (${input.parados})`, href: input.filaHref ?? "/fila?etapa=quentes" },
    };
  }

  // Sem leitura do fundo do funil, "ninguém parado" não é uma afirmação.
  if (!input.fontesOk) {
    return {
      estado: "sem-dado",
      verbo: "SEM LEITURA",
      valor: null,
      formato: "moeda",
      rotulo: "não sei quantas pessoas estão esperando",
      piso: false,
      veredito:
        "Não consegui ler o robô nem o atendimento. Sem eles, o fundo do funil está invisível — e ausência de leitura não é a mesma coisa que ninguém esperando.",
      acao: { label: "Ver as integrações", href: "/config" },
    };
  }

  // ---- ninguém parado: o farol volta a ser o custo ----------------------
  const nReunioes = kpis.reunioesConversao.valor;
  let valor: number | null = kpis.custoPorReuniao.valor;
  let rotulo = "custo por reunião";
  let base: string | undefined = `${nReunioes} ${nReunioes === 1 ? "reunião" : "reuniões"} de conversão agendadas · verba de conversão`;
  let porQue: string | undefined;

  if (cprQuarentena?.nivel === "quarentena") {
    const sub = degrauMaisFundoConfiavel(input.degraus);
    if (sub) {
      valor = sub.custoUnitario ?? null;
      // O degrau Leads carrega o CPL do dicionário: o nome é o dele.
      rotulo = sub.key === "leads" ? "CPL (custo por lead)" : `custo por ${sub.label.toLowerCase()}`;
      base =
        sub.key === "leads"
          ? `${kpis.leadsConversao.valor} leads de conversão · verba de conversão`
          : `${sub.valor} ${sub.label.toLowerCase()} · verba de conversão`;
      porQue = `${cprQuarentena.motivo} (${fatoDoCusto(kpis)}) — este é o ponto mais fundo do funil que ainda sustenta um custo.`;
    } else {
      valor = null;
      base = undefined;
      porQue = `${cprQuarentena.motivo} (${fatoDoCusto(kpis)}).`;
    }
  }

  const partes = [fraseDaMidia(kpis)].filter(Boolean) as string[];
  let estado: FarolEstado;
  let verbo: string;
  let acao: FarolAcao | undefined;

  if (valor == null) {
    estado = "sem-dado";
    verbo = "SEM LEITURA";
    partes.push("Não dá para dizer quanto custa uma reunião com os dados de hoje");
    acao = { label: "Ver o que falta", href: "/config" };
  } else if (input.metaCpr && valor > input.metaCpr) {
    estado = "atencao";
    verbo = "OLHE AQUI";
    partes.push(`Acima da meta de ${brl(input.metaCpr)}`);
    acao = { label: "Ver onde o dinheiro para", href: "/jornada" };
  } else if (!input.metaCpr) {
    estado = "atencao";
    verbo = "SEM ALVO";
    partes.push("Sem meta cadastrada, não dá para dizer se este número é bom");
    acao = { label: "Cadastrar a meta", href: "/config" };
  } else {
    estado = "ok";
    verbo = "NO RITMO";
    partes.push("Dentro da meta, e ninguém parado no funil");
  }

  return {
    estado,
    verbo,
    valor,
    formato: "moeda",
    rotulo,
    base,
    piso,
    porQueEsteNumero: porQue,
    veredito: partes.join(". ") + ".",
    acao,
  };
}

/** Soma as pessoas paradas e a mídia já paga por elas, a partir da cascata. */
export function contarParados(degraus: Degrau[]): {
  parados: number;
  midiaParada: number;
  /** Link da Fila que mostra EXATAMENTE essas pessoas. */
  filaHref: string;
} {
  let parados = 0;
  let midiaParada = 0;
  const etapas = new Set<string>();
  for (const d of degraus) {
    if (!d.parados) continue;
    parados += d.parados;
    midiaParada += d.midiaParada ?? 0;
    if (d.etapaFila) etapas.add(d.etapaFila);
  }
  // Uma etapa só (ex.: "novo", sem robô) abre direto nela; as do robô juntas
  // abrem em "quentes", o filtro que soma as duas.
  const filaHref = etapas.size === 1 ? `/fila?etapa=${[...etapas][0]}` : "/fila?etapa=quentes";
  return { parados, midiaParada, filaHref };
}
