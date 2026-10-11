/**
 * Conteúdo (Fase 6.5) — o que a tela de Conteúdo mostra e que NÃO é KPI do
 * funil: o alcance orgânico dos posts separado do alcance da conta (B11), as
 * variações de anúncio (mesma legenda no mesmo dia), os seguidores com a série
 * parcial explicada (B10/S14), a meta dos registros manuais e as definições do
 * ⓘ das métricas da conta.
 *
 * Puro: sem I/O e sem relógio. Leads, CPL e reuniões continuam saindo SÓ de
 * `kpisDoPeriodo` (lib/kpis.ts); aqui ficam as métricas da conta e dos posts.
 */

import { diaBrt } from "./horario-util";
import { formatDateShort, formatInt, formatIntComSinal } from "./format";
import { inRange, postPerformance, type DateRange } from "./metrics";
import { statusContraMeta, type AvaliacaoMeta } from "./metas";
import type { Creative, Goal, IgAccountDaily, IgMediaType, IgPost } from "./types";

// ---------------------------------------------------------------- definições (ⓘ)

/**
 * As métricas da conta têm definição própria porque não são KPI do funil (o
 * dicionário de `lib/dicionario.ts` é a porta dos números de lead → reunião).
 * Mesmo formato, para migrarem para lá quando a Mídia fechar o alcance real.
 */
export type MetricaConteudo =
  | "seguidores"
  | "cliques_link_bio"
  | "conversas_dm"
  | "alcance_conta"
  | "alcance_organico_posts"
  | "views"
  | "interacoes"
  | "visitas_perfil";

export interface DefinicaoConteudo {
  id: MetricaConteudo;
  nome: string;
  /** Uma linha, para o ⓘ. */
  definicao: string;
  fonte: string;
  inclui: string;
  exclui: string;
}

export const DEFINICOES_CONTEUDO: Record<MetricaConteudo, DefinicaoConteudo> = {
  seguidores: {
    id: "seguidores",
    nome: "Seguidores",
    definicao: "Total de seguidores no último dia do período; o líquido é fim − início.",
    fonte: "Instagram (followers_count no sync; follows_and_unfollows para ganhos e perdas)",
    inclui: "ganhos e perdas do período, quando a API fornece a série (100+ seguidores)",
    exclui: "nada — é o total da conta",
  },
  cliques_link_bio: {
    id: "cliques_link_bio",
    nome: "Cliques no link da bio",
    definicao: "Toques nos links do perfil (site e WhatsApp) somados dia a dia no período.",
    fonte: "Instagram (profile_links_taps)",
    inclui: "site e botão de WhatsApp",
    exclui: "cliques em anúncios (ficam na Mídia)",
  },
  conversas_dm: {
    id: "conversas_dm",
    nome: "Conversas de DM",
    definicao: "Conversas de DM iniciadas no período — registro manual em Registros; a API não expõe DMs.",
    fonte: "Registro manual (Conteúdo → Registros)",
    inclui: "só os dias com registro",
    exclui: "dias sem registro — não viram zero, viram “—”",
  },
  alcance_conta: {
    id: "alcance_conta",
    nome: "Alcance da conta (pago + orgânico)",
    definicao:
      "Soma do alcance diário da conta no período, incluindo o que os anúncios entregaram — a Meta não separa o pago aqui.",
    fonte: "Instagram (reach da conta, por dia)",
    inclui: "orgânico e pago; feed, reels e stories",
    exclui: "nada — e a mesma conta alcançada em dias diferentes conta de novo",
  },
  alcance_organico_posts: {
    id: "alcance_organico_posts",
    nome: "Alcance orgânico dos posts",
    definicao: "Soma do alcance dos posts publicados no período que não são teste nem impulsionados.",
    fonte: "Instagram (reach por mídia)",
    inclui: "feed, carrossel e reels da grade",
    exclui: "posts de teste e impulsionados (um criativo de anúncio aponta para a mídia)",
  },
  views: {
    id: "views",
    nome: "Views",
    definicao: "Vezes que o conteúdo da conta foi exibido no período (pago + orgânico).",
    fonte: "Instagram (views da conta, por dia)",
    inclui: "feed, reels e stories",
    exclui: "nada",
  },
  interacoes: {
    id: "interacoes",
    nome: "Interações",
    definicao: "Curtidas, comentários, salvamentos e compartilhamentos na conta no período.",
    fonte: "Instagram (total_interactions)",
    inclui: "todas as superfícies",
    exclui: "cliques no link e visitas ao perfil",
  },
  visitas_perfil: {
    id: "visitas_perfil",
    nome: "Visitas ao perfil",
    definicao: "Vezes que o perfil foi aberto no período.",
    fonte: "Instagram (profile_views)",
    inclui: "quem veio de post, anúncio ou busca",
    exclui: "nada",
  },
};

export function dicaConteudo(id: MetricaConteudo): string {
  const d = DEFINICOES_CONTEUDO[id];
  return `${d.nome}: ${d.definicao}`;
}

// ---------------------------------------------------------------- variações de anúncio

/** Legenda comparável: sem espaços nas pontas, minúscula, espaços repetidos viram um. */
export function normalizarLegenda(legenda: string): string {
  return legenda.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Posts sem legenda não são "a mesma legenda" — seriam variação por acidente. */
const SEM_LEGENDA = new Set(["", "(sem legenda)"]);

export interface PostDaVariacao {
  id: string;
  type: IgMediaType;
  publishedAt: string;
  isTest: boolean;
}

export interface GrupoDeVariacao {
  /** Dia da publicação no calendário de Brasília (AAAA-MM-DD). */
  dia: string;
  /** A legenda como está no primeiro post do grupo. */
  legenda: string;
  /** Em ordem de publicação. */
  posts: PostDaVariacao[];
  /** Ids ainda não marcados como teste — os que o botão "marcar como teste" marca. */
  pendentes: string[];
}

/**
 * Variações de anúncio: 2+ posts com a mesma legenda (normalizada) publicados
 * no mesmo dia em Brasília. São quase sempre os cortes de um teste de gancho ou
 * as versões de um anúncio — e, contados como posts da grade, derrubam as médias
 * e inflam a cadência. Quem confirma é uma pessoa: o grupo vira sugestão; grupo
 * já todo marcado como teste não volta a aparecer.
 */
export function variacoesDeAnuncio(posts: IgPost[], range?: DateRange): GrupoDeVariacao[] {
  const grupos = new Map<string, { dia: string; legenda: string; posts: PostDaVariacao[] }>();
  for (const p of posts) {
    const chave = normalizarLegenda(p.caption ?? "");
    if (SEM_LEGENDA.has(chave)) continue;
    const dia = diaBrt(p.publishedAt);
    if (!inRange(dia, range)) continue;
    const k = `${dia}\u0000${chave}`;
    const g = grupos.get(k) ?? { dia, legenda: p.caption.trim(), posts: [] };
    g.posts.push({ id: p.id, type: p.type, publishedAt: p.publishedAt, isTest: p.isTest === true });
    grupos.set(k, g);
  }
  const out: GrupoDeVariacao[] = [];
  for (const g of grupos.values()) {
    if (g.posts.length < 2) continue;
    g.posts.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
    const pendentes = g.posts.filter((p) => !p.isTest).map((p) => p.id);
    if (pendentes.length === 0) continue; // já confirmado: nada a sugerir
    out.push({ dia: g.dia, legenda: g.legenda, posts: g.posts, pendentes });
  }
  return out.sort((a, b) => b.dia.localeCompare(a.dia) || a.legenda.localeCompare(b.legenda));
}

// ---------------------------------------------------------------- alcance orgânico dos posts

export interface AlcanceOrganicoDosPosts {
  /** Σ alcance dos posts orgânicos do período. */
  alcance: number;
  /** Quantos posts entraram na soma. */
  posts: number;
  /** Quantos ficaram de fora, por motivo. */
  testes: number;
  impulsionados: number;
}

/**
 * B11: o alcance da conta soma pago e orgânico (a Meta não separa). O alcance
 * ORGÂNICO é o dos posts da grade — sem teste e sem impulsionado, a mesma regra
 * de `aggregatePostPerformance`. Impulsionado = um criativo de anúncio aponta
 * para a mídia (id ou permalink), como em `postPerformance`.
 */
export function alcanceOrganicoDosPosts(
  posts: IgPost[],
  range: DateRange | undefined,
  creatives: Creative[],
): AlcanceOrganicoDosPosts {
  let alcance = 0;
  let n = 0;
  let testes = 0;
  let impulsionados = 0;
  for (const p of postPerformance(posts, range, undefined, creatives)) {
    if (p.isTest) {
      testes += 1;
      continue;
    }
    if (p.boosted) {
      impulsionados += 1;
      continue;
    }
    alcance += p.reach;
    n += 1;
  }
  return { alcance, posts: n, testes, impulsionados };
}

// ---------------------------------------------------------------- seguidores (B10 / S14)

export const NOTA_SERIE_100 = "a API só fornece com 100+ seguidores";

export interface ResumoSeguidores {
  fim: number;
  inicio: number;
  /** fim − início. */
  liquido: number;
  /** O líquido com sinal: "+12", "−5", "0" — nunca "+-12". */
  liquidoTexto: string;
  /** Ganhos e perdas brutos dos dias do período que têm os DOIS lados. */
  ganhos: number;
  perdas: number;
  temSerie: boolean;
  /** Primeiro dia, em todo o histórico, com ganhos E perdas registrados. */
  serieDesde?: string;
  /** Todos os dias do período têm os dois lados. */
  serieCompleta: boolean;
  /** A frase que fica ao lado do líquido: ganhos e perdas, e desde quando. */
  nota: string;
}

const temOsDoisLados = (r: IgAccountDaily) => r.followsDay != null && r.unfollowsDay != null;

/**
 * "+N no período" e, ao lado, ganhos e perdas com a origem da série explicada:
 * a Meta só fornece `follows_and_unfollows` com 100+ seguidores, então a série
 * costuma começar depois do histórico — e dizer "0 perdas" num dia sem dado
 * seria inventar. O sinal vem SEMPRE de `formatIntComSinal` (S14).
 */
export function resumoSeguidores(rows: IgAccountDaily[], range?: DateRange): ResumoSeguidores {
  const ordenadas = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const serieDesde = ordenadas.find(temOsDoisLados)?.date;
  const noPeriodo = ordenadas.filter((r) => inRange(r.date, range));
  const fim = noPeriodo.at(-1)?.followers ?? 0;
  const inicio = noPeriodo[0]?.followers ?? 0;
  const liquido = fim - inicio;
  const dias = noPeriodo.filter(temOsDoisLados);
  const ganhos = dias.reduce((s, r) => s + (r.followsDay ?? 0), 0);
  const perdas = dias.reduce((s, r) => s + (r.unfollowsDay ?? 0), 0);
  const temSerie = dias.length > 0;
  const serieCompleta = temSerie && dias.length === noPeriodo.length;
  const desde = serieDesde ? formatDateShort(serieDesde) : undefined;
  const brutos = `${formatIntComSinal(ganhos)} / ${formatIntComSinal(-perdas)}`;

  let nota: string;
  if (temSerie && serieCompleta) {
    nota = `ganhos e perdas: ${brutos}`;
  } else if (temSerie) {
    // A série começou antes do período mas tem buraco, ou começou no meio dele.
    const comecouAntes = range !== undefined && serieDesde !== undefined && serieDesde <= range.from;
    nota = comecouAntes
      ? `ganhos e perdas: ${brutos} · série incompleta no período (${NOTA_SERIE_100})`
      : `ganhos e perdas: ${brutos} · série disponível desde ${desde} (${NOTA_SERIE_100})`;
  } else if (desde) {
    nota = `ganhos e perdas: série disponível desde ${desde} (${NOTA_SERIE_100})`;
  } else {
    nota = `ganhos e perdas: sem série (${NOTA_SERIE_100})`;
  }

  return {
    fim,
    inicio,
    liquido,
    liquidoTexto: formatIntComSinal(liquido),
    ganhos,
    perdas,
    temSerie,
    serieDesde,
    serieCompleta,
    nota,
  };
}

export interface EntradaReconstrucao {
  /** Dias do sync, em ordem crescente; o último é o dia de "agora". */
  dias: string[];
  /** followers_count do perfil — só existe para AGORA. */
  seguidoresAgora: number;
  /** follows_and_unfollows por dia: quem começou a seguir (bruto). */
  ganhosPorDia: ReadonlyMap<string, number>;
  /** follows_and_unfollows por dia: quem deixou de seguir (bruto). */
  perdasPorDia: ReadonlyMap<string, number>;
  /** Totais já gravados por dia (0 = desconhecido). */
  snapshots: ReadonlyMap<string, number>;
}

/**
 * S14: reconstrói o total de seguidores por dia a partir de AGORA, andando para
 * trás com o LÍQUIDO do dia (ganhos − perdas) — e só enquanto os dois lados
 * existem. `follower_count` da Meta é quem COMEÇOU a seguir no dia (bruto, 100+
 * seguidores); subtraí-lo como se fosse variação líquida inflava o passado em
 * exatamente as perdas de cada dia. Onde a série acaba, vale o snapshot já
 * gravado, carregando o valor conhecido mais próximo — nunca um 0 perdido.
 */
export function reconstruirSeguidores(e: EntradaReconstrucao): Map<string, number> {
  const out = new Map<string, number>();
  let emCurso = e.seguidoresAgora; // total no fim do dia que está sendo visitado
  let reconstruindo = true;
  let vizinho = e.seguidoresAgora; // valor conhecido mais próximo, para os buracos
  for (let i = e.dias.length - 1; i >= 0; i--) {
    const dia = e.dias[i];
    if (reconstruindo) {
      out.set(dia, emCurso);
      vizinho = emCurso;
      const ganhos = e.ganhosPorDia.get(dia);
      const perdas = e.perdasPorDia.get(dia);
      if (ganhos == null || perdas == null) {
        // Sem os dois lados não há líquido: daqui para trás, só o que foi gravado.
        reconstruindo = false;
        continue;
      }
      emCurso -= ganhos - perdas;
    } else {
      const gravado = e.snapshots.get(dia) ?? 0;
      const valor = gravado > 0 ? gravado : vizinho;
      out.set(dia, valor);
      vizinho = valor;
    }
  }
  return out;
}

// ---------------------------------------------------------------- metas de conteúdo

/** O que o card mostra de meta: alvo em texto e, quando dá para comparar, o status. */
export interface MetaDeConteudo {
  alvoTexto?: string;
  avaliacao?: AvaliacaoMeta;
}

/** Princípio 2 do relatório: sem meta, o card diz "sem meta" (e mostra o Δ). */
export const SEM_META: MetaDeConteudo = { alvoTexto: "sem meta" };

/**
 * A meta de conversas de DM (`goals`, período "campanha") só vira status quando
 * o período da tela é a campanha inteira e há registro: comparar 7 dias com a
 * meta da campanha, ou um "0" de dias sem registro, seria cor sobre nada.
 */
export function metaDeConversasDm(
  goals: Goal[],
  conversas: number,
  temRegistro: boolean,
  periodoInteiro: boolean,
): MetaDeConteudo {
  const g = goals.find((x) => x.metric === "conversas_dm");
  if (!g) return SEM_META;
  const alvo = formatInt(g.target);
  if (!temRegistro || !periodoInteiro) return { alvoTexto: `meta ${alvo} na campanha` };
  return { alvoTexto: `meta ${alvo}`, avaliacao: statusContraMeta(conversas, g.target, "maior") };
}

/** A meta de seguidores é um total, então compara em qualquer período. */
export function metaDeSeguidores(goals: Goal[], seguidores: number, temDado: boolean): MetaDeConteudo {
  const g = goals.find((x) => x.metric === "followers");
  if (!g) return SEM_META;
  const alvoTexto = `meta ${formatInt(g.target)}`;
  if (!temDado) return { alvoTexto };
  return { alvoTexto, avaliacao: statusContraMeta(seguidores, g.target, "maior") };
}
