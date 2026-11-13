/**
 * O contrato da tela do Conteúdo (Fase 5, nov/26) e o que o client lê: os tipos
 * do objeto que `montarConteudoDaTela` (`lib/conteudo.ts`) monta, as linhas da
 * tabela e de Registros, e os helpers de texto que mais de uma tela usa.
 *
 * Imports de VALOR só de `./format` — o resto é `import type`. Os clients
 * (`components/conteudo/*`, `components/tables/posts-table.tsx`,
 * `components/config/registros-forms.tsx`) importam valor daqui, nunca de
 * `lib/conteudo.ts`, `lib/metrics.ts` ou `lib/midia.ts` (o mesmo papel de
 * `midia-tela.ts` na Mídia).
 */

import { formatInt } from "./format";
import type { DateRange } from "./metrics";
import type { Creative, DashboardData, IgMediaType, PostDraft } from "./types";

/** Rótulo do tipo de mídia — fonte única da tela (cartões, tabela, Registros, variações) e de `metrics.ts` (formatPerformance). */
export const ROTULO_DO_TIPO: Record<IgMediaType, string> = {
  feed: "Feed",
  carrossel: "Carrossel",
  reel: "Reel",
  story: "Story",
};

/** O ícone de reserva da miniatura (`MiniaturaDoCriativo` espera o formato do criativo). */
export const FORMATO_DA_MINIATURA: Record<IgMediaType, Creative["format"]> = {
  reel: "video",
  carrossel: "carrossel",
  feed: "imagem",
  story: "imagem",
};

/**
 * "Último post há 3 dias" / "Último post hoje" / "Último post há 1 dia" /
 * "Nenhum post ainda" — o texto ÚNICO (placar do Conteúdo e rodapé do Início).
 * `dias` = `ultimoPostDaGrade` (histórico inteiro, dia de Brasília; `null` = nunca
 * houve post da grade). Movido de `inicio.ts`, que o reexporta.
 */
export function textoDoUltimoPost(dias: number | null): string {
  if (dias === null) return "Nenhum post ainda";
  if (dias === 0) return "Último post hoje";
  return `Último post há ${formatInt(dias)} ${dias === 1 ? "dia" : "dias"}`;
}

/** "1 interação" / "42 interações" (formatInt). */
export function textoDeInteracoes(n: number): string {
  return `${formatInt(n)} ${n === 1 ? "interação" : "interações"}`;
}

/** A conta que SOMA a lista de um período de posts: grade (= `aggregatePostPerformance(…).count`) + teste + impulsionado (não teste) = total. */
export interface ContagemDaGrade {
  grade: number;
  testes: number;
  impulsionados: number;
  total: number;
}

/** Título de Registros: "20 posts da grade · 3 de teste · 2 impulsionados" (partes t e b zeradas somem); total 0 → "Nenhum post no período". */
export function tituloDosRegistros(c: ContagemDaGrade): string {
  if (c.total === 0) return "Nenhum post no período";
  const partes = [`${formatInt(c.grade)} ${c.grade === 1 ? "post" : "posts"} da grade`];
  if (c.testes > 0) partes.push(`${formatInt(c.testes)} de teste`);
  if (c.impulsionados > 0) {
    partes.push(`${formatInt(c.impulsionados)} ${c.impulsionados === 1 ? "impulsionado" : "impulsionados"}`);
  }
  return partes.join(" · ");
}

export interface EntradaConteudo {
  /** `getData(marca)`: só a marca. */
  data: DashboardData;
  /** `listDrafts(marca)` com playbook; `[]` sem (as peças da Produção: só entram como contagem na grade da semana). */
  drafts: PostDraft[];
  range: DateRange | undefined;
  /** A chave resolvida (sem `?range=` = "30d"). */
  rangeKey: string;
  naoComecou: boolean;
  /** `isAwareness(marca)`: sem ações, sem gráfico, sem a frase dos leads. */
  marca: string;
  /** `hasPlaybook(marca)`: as ações levam "→ Produção". */
  comPlaybook: boolean;
  /** AAAA-MM-DD, Brasília. */
  hoje: string;
  /** ISO. */
  agora: string;
}

export interface PlacarDaTela {
  /** "21 posts no período" | "1 post no período" | "Nenhum post no período" */
  posts: string;
  /** textoDoUltimoPost(...) */
  ultimo: string;
  /** "Seguidores +312 (pago + orgânico)" | "Seguidores —" */
  seguidores: string;
  /** §2.2, frases separadas por espaço. */
  dica: string;
  /** Os números do placar, para a prova de paridade (nenhum componente os lê). */
  numeros: { posts: number; diasDesdeUltimoPost: number | null; seguidoresLiquido: number | null };
}

export interface PostDaVariacaoNaTela {
  id: string;
  /** ROTULO_DO_TIPO */
  tipo: string;
  /** "21:30", Brasília (horaDoPost) */
  hora: string;
  /** permalink (conteúdo público); "" → null */
  href: string | null;
  /** "grade" = selecionável (começa marcado); os outros só com selo. */
  estado: "grade" | "teste" | "impulsionado";
}
export interface VariacaoParaConferir {
  /** `${dia}|${id do 1º post do grupo}` — chave estável do grupo, SEM texto da legenda (a inteira nunca vai ao client, nem numa chave). */
  chave: string;
  /** "28/07" */
  diaTexto: string;
  /** legendaCurta */
  legenda: string;
  posts: PostDaVariacaoNaTela[];
  /** Ids com `estado: "grade"` (≥ 2): os que o botão pode marcar. */
  naGrade: string[];
}
export interface VariacoesDaTela {
  /** "13 grupos de posts iguais no mesmo dia para conferir" */
  linha: string;
  dica: string;
  lista: VariacaoParaConferir[];
  /** "/conteudo/registros?range=all#posts" */
  registrosHref: string;
  /** Grupos com 2+ posts na grade, no histórico (o k da linha). Não se chama `grupos`: a chave é proibida em `CHAVES_PROIBIDAS`. */
  total: number;
}

export interface CardDePost {
  id: string;
  /** legendaCurta */
  legenda: string;
  /** permalink; "" → null */
  href: string | null;
  /** miniaturaDoPost */
  miniatura: string | null;
  /** FORMATO_DA_MINIATURA[type] */
  formato: Creative["format"];
  /** "Reel · 08/11 · 3 salvos · 1 compart. · 42 interações" */
  linha: string;
}
export interface MelhoresDaTela {
  titulo: string;
  dica: string;
  cards: CardDePost[];
}

export interface AcaoDaGrade {
  id: string;
  /** Recommendation.linha (≤ 10 palavras) */
  linha: string;
  destino: { href: string; rotulo: "Produção" } | null;
  /** Recommendation.detail */
  dica: string;
  /** `Sobre a ação “${title}”` */
  rotulo: string;
}

export interface LinhaDePost {
  id: string;
  /** publishedAt (ordena a coluna Publicado) */
  iso: string;
  /** "dd/mm", dia de Brasília (diaDoPost) */
  data: string;
  tipo: IgMediaType;
  /** ROTULO_DO_TIPO */
  tipoTexto: string;
  /** legendaCurta */
  legenda: string;
  href: string | null;
  alcance: number;
  views: number;
  interacoes: number;
  salvos: number;
  compartilhamentos: number;
  /** interações ÷ alcance; null com alcance 0 */
  engajamento: number | null;
  teste: boolean;
  impulsionado: boolean;
}
export interface TodosOsPostsDaTela {
  linhas: LinhaDePost[];
  dica: string;
  producao: { href: string } | null;
}

export type IdDoNumeroDaConta = "alcance_conta" | "alcance_organico_posts" | "views" | "interacoes" | "visitas_perfil";
export interface NumeroDaConta {
  id: IdDoNumeroDaConta;
  rotulo: string;
  valor: string;
  dica: string;
}
export interface ContaDaTela {
  numeros: NumeroDaConta[];
  dica: string;
  /** Só na marca de conversão e com 2+ pontos; senão null. */
  serieDeSeguidores: { date: string; followers: number }[] | null;
  /** "Total de seguidores · 1.329" (com total) | "Total de seguidores"; null sem série. */
  tituloDoGrafico: string | null;
}

export interface ConteudoDaTela {
  placar: PlacarDaTela;
  variacoes: VariacoesDaTela | null;
  melhores: MelhoresDaTela | null;
  acoes: AcaoDaGrade[];
  todos: TodosOsPostsDaTela | null;
  conta: ContaDaTela | null;
}

/** Uma linha do formulário de Registros (substitui `PostMetaRow`, que morava no client). */
export interface LinhaDeRegistro {
  id: string;
  /** cru: o formulário testa `tipo === "reel"` para a duração */
  tipo: IgMediaType;
  /** ROTULO_DO_TIPO */
  tipoTexto: string;
  /** "dd/mm hh:mm", Brasília */
  quando: string;
  /** legendaCurta */
  legenda: string;
  /** permalink */
  href: string | null;
  durationSec?: number;
  pillar?: string;
  ctaType?: string;
  /** CTA da heurística da legenda (o "Auto (…)"), já com o rótulo. */
  detectedCta?: string;
  isTest: boolean;
  impulsionado: boolean;
}
export interface RegistrosDaTela {
  titulo: string;
  linhas: LinhaDeRegistro[];
}
