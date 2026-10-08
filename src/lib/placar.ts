/**
 * O PLACAR — o veredito da Bússola, em uma linha. Puro.
 *
 * Substitui o farol como primeiro bloco da home (decisão 4.3): a north star é
 * REUNIÕES AGENDADAS (contagem), e o veredito é o número contra a meta que vale
 * no período — "FORA DO RITMO — 0 de 7 reuniões agendadas na semana". O que o
 * farol fazia com "gente parada" virou a regra de ordem do motor de ações (C1
 * vem primeiro); o que ele fazia com o custo por reunião virou o FATO ao lado do
 * placar (decisão 4.2): "R$ 160 investidos em conversão · 0 reuniões", nunca a
 * razão com uma reunião só.
 *
 * Quatro saídas, e só quatro: o estado (cor + texto), a frase, o gargalo e a
 * linha de proteção (comparecimento). Sem meta não há cor — há "SEM META" e o
 * link para cadastrar. Sem leitura (fontes divergem) há "SEM LEITURA", nunca
 * "no ritmo" por silêncio.
 */

import type { Dono } from "./dono";
import { textoDoImpacto, type Gargalo } from "./gargalo";
import { custoExibivel, type KpisDoPeriodo, type LinhaDaRegua, type Medida } from "./kpis";
import { formatarAlvo, type AvaliacaoMeta } from "./metas";
import type { DateRange } from "./metrics";
import { diasDoPeriodo } from "./semana";
import { formatCurrency, formatCurrency0, formatDateShort, formatInt, formatPercent } from "./format";

export type PlacarEstado = "ok" | "perto" | "fora" | "sem-meta" | "sem-dado";

export interface Placar {
  estado: PlacarEstado;
  /** Em caixa alta: NO RITMO · PERTO DO RITMO · FORA DO RITMO · SEM META · SEM LEITURA. */
  verbo: string;
  /** "3 de 7 reuniões agendadas na semana". */
  frase: string;
  reunioes: Medida;
  /** O alvo do PERÍODO (contagem soma dia a dia) — é o da frase. */
  alvo?: number;
  /** A meta POR SEMANA vigente hoje — a linha tracejada do minigráfico semanal. */
  alvoSemanal?: number;
  avaliacao?: AvaliacaoMeta;
  provisoria?: boolean;
  /** A meta não cobre o período inteiro: desde quando ela vale. */
  metaDesde?: string;
  /** Por que não há leitura. */
  motivo?: string;
  gargalo?: {
    rotulo: string;
    dono: Dono;
    origem: "meta" | "media8s";
    /** "+3 reuniões por semana se batesse a meta". */
    impactoTexto?: string;
    href: string;
  };
  /** Linha de proteção: comparecimento. */
  comparecimento: { texto: string; avaliacao?: AvaliacaoMeta; motivo?: string };
  /** O custo por reunião como FATO (decisão 4.2). */
  custo: string;
  /** O acumulado da campanha, sempre com o n (princípio 11). */
  campanha: string;
  acao?: { label: string; href: string };
}

export interface EntradaPlacar {
  kpis: KpisDoPeriodo;
  /** `kpisDoPeriodo(data, undefined)`: a campanha inteira. */
  campanha: KpisDoPeriodo;
  regua: Map<string, LinhaDaRegua>;
  gargalo: Gargalo | null;
  range: DateRange | undefined;
  /** Meta semanal de reuniões vigente hoje (já convertida de "mês" quando for o caso). */
  alvoSemanal?: number;
}

const VERBO: Record<PlacarEstado, string> = {
  ok: "NO RITMO",
  perto: "PERTO DO RITMO",
  fora: "FORA DO RITMO",
  "sem-meta": "SEM META",
  "sem-dado": "SEM LEITURA",
};

function periodoTexto(range: DateRange | undefined): string {
  if (!range) return "na campanha";
  const dias = diasDoPeriodo(range);
  if (dias === 7) return "na semana";
  if (dias === 1) return "no dia";
  return `em ${formatInt(dias)} dias`;
}

const reun = (n: number) => `${formatInt(n)} ${n === 1 ? "reunião agendada" : "reuniões agendadas"}`;

/** "R$ 160 investidos em conversão · 0 reuniões", ou o custo quando ele se sustenta. */
function fatoDoCusto(k: KpisDoPeriodo, prefixo = ""): string {
  const n = k.reunioesConversao.valor;
  if (custoExibivel(k.custoPorReuniao)) {
    const piso = k.custoPorReuniao.confianca?.nivel === "piso" ? "≥ " : k.custoPorReuniao.confianca ? "≤ " : "";
    return `${prefixo}${piso}${formatCurrency(k.custoPorReuniao.valor)} por reunião (n = ${formatInt(n)})`;
  }
  const piso = k.investimentoConversao.confianca?.nivel === "piso" ? "≥ " : "";
  return `${prefixo}${piso}${formatCurrency0(k.investimentoConversao.valor)} investidos em conversão · ${formatInt(n)} ${n === 1 ? "reunião" : "reuniões"} de conversão`;
}

export function montarPlacar(e: EntradaPlacar): Placar {
  const { kpis, range } = e;
  const linha = e.regua.get("reunioes_agendadas");
  const reunioes = kpis.reunioesAgendadas;
  const quando = periodoTexto(range);

  let estado: PlacarEstado;
  let frase: string;
  let motivo: string | undefined;
  let acao: Placar["acao"];
  if (reunioes.confianca?.nivel === "quarentena") {
    estado = "sem-dado";
    frase = `não dá para afirmar quantas reuniões foram agendadas ${quando}`;
    motivo = reunioes.confianca.motivo;
    acao = { label: "Ver as integrações", href: "/config#integracoes" };
  } else if (!linha?.alvo) {
    estado = "sem-meta";
    frase = `${reun(reunioes.valor)} ${quando} — sem meta para comparar`;
    acao = { label: "Cadastrar a meta", href: "/config#metas" };
  } else if (linha.parcial || !linha.avaliacao) {
    estado = "sem-meta";
    frase = `${reun(reunioes.valor)} ${quando}`;
    motivo = linha.parcial
      ? `a meta vale só a partir de ${formatDateShort(linha.meta!.vigenteDesde)} — não cobre o período inteiro`
      : "a meta não se aplica a este período";
  } else {
    estado = linha.avaliacao.status === "verde" ? "ok" : linha.avaliacao.status === "ambar" ? "perto" : "fora";
    frase = `${formatInt(reunioes.valor)} de ${formatarAlvo("reunioes_agendadas", linha.alvo)} reuniões agendadas ${quando}`;
  }

  const comp = kpis.comparecimento;
  const compLinha = e.regua.get("comparecimento");
  const comparecimento =
    comp.n > 0
      ? { texto: `${formatPercent(comp.valor, 0)} (${formatInt(comp.n)} ${comp.n === 1 ? "reunião" : "reuniões"} com data passada)`, avaliacao: compLinha?.avaliacao }
      : { texto: "—", motivo: "nenhuma reunião com data passada no período" };

  const g = e.gargalo;
  return {
    estado,
    verbo: VERBO[estado],
    frase,
    reunioes,
    alvo: linha?.alvo,
    alvoSemanal: e.alvoSemanal,
    avaliacao: linha?.avaliacao,
    provisoria: linha?.meta?.provisoria,
    metaDesde: linha?.parcial ? linha.meta?.vigenteDesde : undefined,
    motivo,
    gargalo: g
      ? {
          rotulo: g.transicao.rotulo,
          dono: g.transicao.dono,
          origem: g.transicao.referencia?.origem ?? "media8s",
          impactoTexto: textoDoImpacto(g),
          href: g.transicao.href,
        }
      : undefined,
    comparecimento,
    custo: fatoDoCusto(kpis),
    campanha: range ? fatoDoCusto(e.campanha, "Campanha: ").replace("investidos em conversão", "investidos") + (custoExibivel(e.campanha.custoPorReuniao) ? "" : ` · ${formatInt(e.campanha.reunioesAgendadas.valor)} agendadas`) : "",
    acao,
  };
}
