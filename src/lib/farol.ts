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
  kpis: { cpr: number; cpl: number; leads: number; meetings: number };
  /** Meta de custo por reunião, se cadastrada. */
  metaCpr?: number;
  /** Pessoas paradas agora, somadas de todas as juntas. */
  parados: number;
  /** Mídia já paga pelas pessoas paradas. */
  midiaParada: number;
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
  if (kpis.leads <= 0 || kpis.cpl <= 0) return null;
  return `A mídia está entregando: ${kpis.leads} leads a ${brl(kpis.cpl)}`;
}

export function montarFarol(input: FarolInput): Farol {
  const { trust, kpis } = input;
  const cprQuarentena = trust.porMetrica.cpr;
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
    if (kpis.meetings > 0 && kpis.meetings < MIN_AMOSTRA) {
      partes.push(
        `Custo por reunião ${piso ? "≥ " : ""}${brl(kpis.cpr)} é ${kpis.meetings} reunião só — ` +
          "ele cai atendendo essas pessoas, não trocando o anúncio",
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
      acao: { label: `Abrir a fila (${input.parados})`, href: "/fila" },
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
  let valor: number | null = kpis.cpr;
  let rotulo = "custo por reunião";
  let base: string | undefined = `${kpis.meetings} reunião(ões) · verba de conversão`;
  let porQue: string | undefined;

  if (cprQuarentena?.nivel === "quarentena") {
    const sub = degrauMaisFundoConfiavel(input.degraus);
    if (sub) {
      valor = sub.custoUnitario ?? null;
      rotulo = `custo por ${sub.label.toLowerCase()}`;
      base = `${sub.valor} ${sub.label.toLowerCase()} · verba de conversão`;
      porQue = `${cprQuarentena.motivo} — este é o ponto mais fundo do funil que ainda sustenta um custo.`;
    } else {
      valor = null;
      base = undefined;
      porQue = cprQuarentena.motivo;
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
export function contarParados(degraus: Degrau[]): { parados: number; midiaParada: number } {
  let parados = 0;
  let midiaParada = 0;
  for (const d of degraus) {
    if (!d.parados) continue;
    parados += d.parados;
    midiaParada += d.midiaParada ?? 0;
  }
  return { parados, midiaParada };
}
