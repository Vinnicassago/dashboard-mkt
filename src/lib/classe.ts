/**
 * A classe do inscrito — A, B, C ou X — a partir das respostas do formulário.
 * Puro: roda no servidor (toda escrita de resposta), na tela (prévia da tabela)
 * e nos testes.
 *
 * As regras, nesta ordem (a primeira que casa decide):
 *   1. X — finalidade "Quitar dívidas ou ter dinheiro na mão".
 *   2. C — valor abaixo do mínimo do bem, ou parcela incompatível com o valor
 *          (a TABELA DE PARCELA diz as duas coisas).
 *   3. B — bem "Outro", ou prazo "Preciso agora" ou "Mais de 3 anos".
 *   4. A — o resto.
 *
 * A tabela é provisória (vai ser trocada pela da administradora): fica editável
 * em Configurações → Atendimento, e salvar recalcula a classe dos leads.
 */
import {
  FAIXAS_PARCELA,
  FAIXAS_VALOR,
  type Bem,
  type Classe,
  type FaixaParcela,
  type FaixaValor,
  type Finalidade,
  type PrazoCompra,
} from "./qualificacao";

/** Imóvel tem a sua linha; carro, bem para a empresa e "Outro" usam a mesma (a de carro). */
export type GrupoDoBem = "imovel" | "carro";
export const GRUPO_LABEL: Record<GrupoDoBem, string> = {
  imovel: "Imóvel",
  carro: "Carro, empresa ou outro",
};
export const grupoDoBem = (bem: Bem): GrupoDoBem => (bem === "imovel" ? "imovel" : "carro");

/**
 * Uma célula da tabela: para este bem e esta faixa de valor, qual a parcela
 * mínima marcada. `minimo` = a faixa está abaixo do valor mínimo (classe C);
 * `qualquer` = qualquer parcela serve.
 */
export type CelulaDeParcela = "minimo" | "qualquer" | FaixaParcela;

export interface TabelaDeParcela {
  celulas: Record<GrupoDoBem, Record<FaixaValor, CelulaDeParcela>>;
  /** Quando e por quem foi salva (a provisória não tem). */
  atualizadaEm?: string;
  atualizadaPor?: string;
}

/** A tabela do briefing da live (provisória). */
export const TABELA_PROVISORIA: TabelaDeParcela = {
  celulas: {
    imovel: {
      ate_50k: "minimo",
      "50k_150k": "minimo",
      "150k_300k": "minimo",
      "300k_500k": "1500_3000",
      "500k_1m": "3000_6000",
      acima_1m: "acima_6000",
    },
    carro: {
      ate_50k: "minimo",
      "50k_150k": "qualquer",
      "150k_300k": "1500_3000",
      "300k_500k": "3000_6000",
      "500k_1m": "3000_6000",
      acima_1m: "3000_6000",
    },
  },
};

const ORDEM_PARCELA = Object.keys(FAIXAS_PARCELA) as FaixaParcela[];
export const FAIXAS_VALOR_ORDEM = Object.keys(FAIXAS_VALOR) as FaixaValor[];

/** A parcela marcada é pelo menos a mínima da célula? */
export function parcelaCompativel(celula: CelulaDeParcela, parcela: FaixaParcela): boolean {
  if (celula === "minimo") return false;
  if (celula === "qualquer") return true;
  return ORDEM_PARCELA.indexOf(parcela) >= ORDEM_PARCELA.indexOf(celula);
}

export interface RespostasParaClasse {
  bem?: Bem;
  faixaValor?: FaixaValor;
  finalidade?: Finalidade;
  faixaParcela?: FaixaParcela;
  prazoCompra?: PrazoCompra;
}

export interface ClasseCalculada {
  /** `undefined` = faltam respostas para decidir. */
  classe?: Classe;
  /** Por que esta classe (para a ficha e a prévia da tabela). */
  motivo: string;
  /** As respostas que faltaram, quando não deu para decidir. */
  falta?: (keyof RespostasParaClasse)[];
}

const NOME_DO_CAMPO: Record<keyof RespostasParaClasse, string> = {
  bem: "bem",
  faixaValor: "valor",
  finalidade: "finalidade",
  faixaParcela: "parcela",
  prazoCompra: "prazo",
};

export function calcularClasse(r: RespostasParaClasse, tabela: TabelaDeParcela = TABELA_PROVISORIA): ClasseCalculada {
  // 1. X decide sozinho — o resto das respostas não muda nada.
  if (r.finalidade === "quitar_dividas") return { classe: "X", motivo: "quer quitar dívidas ou dinheiro na mão" };

  const falta = (Object.keys(NOME_DO_CAMPO) as (keyof RespostasParaClasse)[]).filter((k) => !r[k]);
  if (falta.length) {
    return { motivo: `faltam respostas: ${falta.map((k) => NOME_DO_CAMPO[k]).join(", ")}`, falta };
  }
  const bem = r.bem!;
  const valor = r.faixaValor!;
  const parcela = r.faixaParcela!;

  // 2. C — abaixo do mínimo, ou parcela que não cabe no valor.
  const celula = (tabela.celulas[grupoDoBem(bem)] ?? TABELA_PROVISORIA.celulas[grupoDoBem(bem)])[valor] ?? "minimo";
  if (celula === "minimo") return { classe: "C", motivo: "valor abaixo do mínimo para o bem" };
  if (!parcelaCompativel(celula, parcela)) return { classe: "C", motivo: "parcela incompatível com o valor" };

  // 3. B — bem "Outro" ou prazo fora da janela boa.
  if (bem === "outro") return { classe: "B", motivo: "bem “Outro”" };
  if (r.prazoCompra === "agora") return { classe: "B", motivo: "precisa agora" };
  if (r.prazoCompra === "mais_3_anos") return { classe: "B", motivo: "prazo de mais de 3 anos" };

  // 4. A.
  return { classe: "A", motivo: "valor e parcela compatíveis, prazo de até 3 anos" };
}

/** Lê uma tabela gravada (estado do banco): o que vier torto cai na provisória, célula a célula. */
export function lerTabela(v: unknown): TabelaDeParcela {
  const t = (v && typeof v === "object" ? v : {}) as Partial<TabelaDeParcela>;
  const celulas = {} as TabelaDeParcela["celulas"];
  for (const g of Object.keys(GRUPO_LABEL) as GrupoDoBem[]) {
    celulas[g] = {} as Record<FaixaValor, CelulaDeParcela>;
    for (const f of FAIXAS_VALOR_ORDEM) {
      const c = (t.celulas as Record<string, Record<string, unknown>> | undefined)?.[g]?.[f];
      celulas[g][f] = celulaValida(c) ? c : TABELA_PROVISORIA.celulas[g][f];
    }
  }
  return { celulas, atualizadaEm: t.atualizadaEm, atualizadaPor: t.atualizadaPor };
}

export function celulaValida(c: unknown): c is CelulaDeParcela {
  return c === "minimo" || c === "qualquer" || (typeof c === "string" && Object.hasOwn(FAIXAS_PARCELA, c));
}

/** Como a célula aparece na tela. */
export function rotuloCelula(c: CelulaDeParcela): string {
  if (c === "minimo") return "abaixo do mínimo (C)";
  if (c === "qualquer") return "qualquer parcela";
  return `a partir de ${FAIXAS_PARCELA[c]}`;
}
