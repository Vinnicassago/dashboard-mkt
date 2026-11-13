/**
 * Conteúdo (Fase 5, nov/26) — a tela inteira (`montarConteudoDaTela`), Registros
 * (`registrosDoPeriodo`) e as peças: as variações de anúncio, o alcance orgânico dos
 * posts (B11), os seguidores com a série parcial explicada (B10/S14). Puro: sem I/O e
 * sem relógio (`agora`/`hoje` na entrada). Os tipos da tela e o que o client lê moram
 * em `conteudo-tela.ts`. Importado também pelo sync do Instagram
 * (`reconstruirSeguidores`): nada de `server-only` nem store aqui.
 *
 * Leads, CPL e reuniões continuam saindo SÓ de `kpisDoPeriodo` (lib/kpis.ts); aqui
 * ficam as métricas da conta e dos posts.
 */

import { formatDateShort, formatInt, formatIntComSinal } from "./format";
import { DICIONARIO, dica } from "./dicionario";
import {
  CTA_LABEL,
  aggregatePostPerformance,
  detectCta,
  diaDoPost,
  filtroDaGrade,
  followerSeries,
  igAccountTotals,
  inRange,
  pontosDoTotalDeSeguidores,
  postPerformance,
  rankingDaGrade,
  seguidoresDoPeriodo,
  ultimoPostDaGrade,
  type DateRange,
  type FunnelStage,
  type PostPerf,
} from "./metrics";
import { statusContraMeta, type AvaliacaoMeta } from "./metas";
import { miniaturaValida } from "./miniatura";
import { isAwareness } from "./brands";
import { comPeriodo } from "./range";
import { somarDias } from "./semana";
import { IDS_DE_CONTEUDO, buildRecommendations, type Recommendation } from "./recommendations";
import {
  FORMATO_DA_MINIATURA,
  ROTULO_DO_TIPO,
  textoDeInteracoes,
  textoDoUltimoPost,
  tituloDosRegistros,
  type AcaoDaGrade,
  type CardDePost,
  type ContaDaTela,
  type ContagemDaGrade,
  type ConteudoDaTela,
  type EntradaConteudo,
  type IdDoNumeroDaConta,
  type LinhaDePost,
  type LinhaDeRegistro,
  type MelhoresDaTela,
  type NumeroDaConta,
  type PlacarDaTela,
  type RegistrosDaTela,
  type TodosOsPostsDaTela,
  type VariacoesDaTela,
} from "./conteudo-tela";
import type { Creative, DashboardData, Goal, IgAccountDaily, IgMediaType, IgPost } from "./types";

/** O contrato da tela (tipos e helpers de texto) — o servidor lê tudo daqui. */
export * from "./conteudo-tela";

// ---------------------------------------------------------------- definições (ⓘ)

/**
 * As métricas da conta moram no dicionário (`lib/dicionario.ts`) com as do
 * funil — o ⓘ da tela (`dica(id)` em `montarConteudoDaTela`) e o briefing da IA
 * leem de um lugar só. Aqui ficam só os ids desta tela.
 */
export type MetricaConteudo =
  | "seguidores"
  | "alcance_conta"
  | "alcance_organico_posts"
  | "views"
  | "interacoes"
  | "visitas_perfil";

export const METRICAS_DE_CONTEUDO: MetricaConteudo[] = [
  "seguidores",
  "alcance_conta",
  "alcance_organico_posts",
  "views",
  "interacoes",
  "visitas_perfil",
];

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
    // O dia de Brasília do post (`diaDoPost`), o MESMO do período, do placar e da
    // tabela: sem fuso na string é o relógio escrito; "+00" não lança.
    const dia = diaDoPost(p);
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
  /** Último total CONHECIDO do período (0 = nenhum: snapshot sem o campo). */
  fim: number;
  /** Dia de `fim` — quando o último snapshot veio sem o total, é um dia antes do fim do período. */
  fimEm?: string;
  /** `fim` é do último dia com snapshot no período (não ficou para trás num campo em branco). */
  fimNoUltimoDia: boolean;
  /** Total no fim do dia ANTERIOR ao período — o chão de onde o líquido parte. */
  inicio: number;
  /** Algum dia do período tem o total (followers > 0). Sem ele, não há valor nem status. */
  temTotal: boolean;
  /** Variação no período: ganhos − perdas com a série completa; senão fim − início. */
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
 *
 * Total, início e líquido são os de `seguidoresDoPeriodo` (metrics.ts), a regra
 * ÚNICA — a mesma de `igAccountTotals`, que o Início da marca de seguidores
 * (cards) e a IA leem: um fato, um número. Líquido e ganhos/perdas
 * cobrem os MESMOS dias (o início é a véspera do período), e com a série
 * completa o líquido É ganhos − perdas. Total 0 é desconhecido: `fim` é o
 * último total CONHECIDO e `temTotal` diz se há algum.
 */
export function resumoSeguidores(rows: IgAccountDaily[], range?: DateRange): ResumoSeguidores {
  const ordenadas = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const serieDesde = ordenadas.find(temOsDoisLados)?.date;
  const noPeriodo = ordenadas.filter((r) => inRange(r.date, range));
  const { fim, fimEm, inicio, liquido, temTotal, serieCompleta } = seguidoresDoPeriodo(rows, range);
  const dias = noPeriodo.filter(temOsDoisLados);
  const ganhos = dias.reduce((s, r) => s + (r.followsDay ?? 0), 0);
  const perdas = dias.reduce((s, r) => s + (r.unfollowsDay ?? 0), 0);
  const temSerie = dias.length > 0;
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
    fimEm,
    fimNoUltimoDia: fimEm !== undefined && fimEm === noPeriodo.at(-1)?.date,
    inicio,
    temTotal,
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
// Sem leitor de tela desde a Fase 5 de nov/26 (o placar não tem régua); os testes
// de `fase6-conteudo` continuam.

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

/**
 * A meta de seguidores é um total, então compara em qualquer período — mas só
 * com um total de verdade: 0 é "desconhecido" (snapshot manual sem o campo), e
 * cor sobre ele seria "Abaixo da meta (0%)" em vermelho por um campo em branco.
 * Quem chama passa o último total CONHECIDO (`resumoSeguidores().fim`).
 */
export function metaDeSeguidores(goals: Goal[], seguidores: number, temDado: boolean): MetaDeConteudo {
  const g = goals.find((x) => x.metric === "followers");
  if (!g) return SEM_META;
  const alvoTexto = `meta ${formatInt(g.target)}`;
  if (!temDado || !(seguidores > 0)) return { alvoTexto };
  return { alvoTexto, avaliacao: statusContraMeta(seguidores, g.target, "maior") };
}

// ---------------------------------------------------------------- funil do perfil
// Sem leitor de tela desde a Fase 5 de nov/26; os testes de `fase6-conteudo` continuam.

const div = (a: number, b: number) => (b > 0 ? a / b : 0);

/**
 * Funil do perfil: alcance da conta → visitas ao perfil → novos seguidores.
 * O alcance aqui é o da CONTA, pago + orgânico (a Meta não separa; B11), e o
 * rótulo diz isso — na mesma tela, "Alcance orgânico dos posts" separa os dois,
 * e chamar isto de "funil orgânico" fazia 200 mil de alcance de anúncio virar
 * "gancho fraco". Os novos seguidores são o líquido de `seguidoresDoPeriodo`
 * (via `netNew`): os mesmos dias da nota do card Seguidores, e o mesmo número
 * do Início da marca de seguidores.
 */
export function funilDoPerfil(rows: IgAccountDaily[], range?: DateRange): FunnelStage[] {
  const t = igAccountTotals(rows, range);
  const novos = Math.max(0, t.netNew);
  return [
    { key: "alcance", label: "Alcance da conta (pago + orgânico)", value: t.reach },
    {
      key: "visitas",
      label: "Visitas ao perfil",
      value: t.profileViews,
      fromPrev: div(t.profileViews, t.reach),
    },
    {
      key: "seguidores",
      label: "Novos seguidores (líquido)",
      value: novos,
      fromPrev: div(novos, t.profileViews),
    },
  ];
}

// ---------------------------------------------------------------- legenda, hora e miniatura do post

/** Token que conta como palavra (a régua de `palavras` dos testes de tela): tem letra ou algarismo. */
const TEM_PALAVRA = /[\p{L}\p{N}]/u;
const LEGENDA_MAX_PALAVRAS = 8;
const LEGENDA_MAX_CARACTERES = 60;

/**
 * A legenda em UMA linha: a 1ª linha não vazia (`\r?\n`), espaços colapsados, cortada
 * no fim do token em ≤ 8 PALAVRAS (a régua de `palavras`: token com letra ou algarismo)
 * ou ≤ 60 caracteres, o que vier antes, + "…" (sem espaço) quando cortou. Um token
 * sozinho com mais de 60 caracteres (URL) é cortado em 60 + "…". Vazia ou "(sem
 * legenda)" → "Sem legenda". A completa NUNCA vai ao DOM: abre no post (permalink).
 */
export function legendaCurta(caption: string | undefined): string {
  const linha =
    (caption ?? "")
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+/g, " ").trim())
      .find((l) => l.length > 0) ?? "";
  if (SEM_LEGENDA.has(linha.toLowerCase())) return "Sem legenda";

  const tokens = linha.split(" ");
  const fica: string[] = [];
  let palavras = 0;
  let tamanho = 0;
  let cortou = false;
  for (const t of tokens) {
    const ehPalavra = TEM_PALAVRA.test(t);
    const novoTamanho = fica.length > 0 ? tamanho + 1 + t.length : t.length;
    if ((ehPalavra && palavras + 1 > LEGENDA_MAX_PALAVRAS) || novoTamanho > LEGENDA_MAX_CARACTERES) {
      cortou = true;
      break;
    }
    fica.push(t);
    tamanho = novoTamanho;
    if (ehPalavra) palavras += 1;
  }
  if (!cortou) return linha;
  // Um token sozinho maior que o teto (uma URL): corta no meio dele.
  if (fica.length === 0) return `${tokens[0].slice(0, LEGENDA_MAX_CARACTERES)}…`;
  // Não termina num "—" ou num emoji solto antes do "…".
  while (fica.length > 1 && !TEM_PALAVRA.test(fica[fica.length - 1])) fica.pop();
  return `${fica.join(" ")}…`;
}

/** Data e hora SEM fuso (seed, CSV antigo): a hora escrita é a de Brasília. */
const HORA_SEM_FUSO = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})(:\d{2}(\.\d+)?)?$/;
/** Fuso só em horas (`+00`, `-03`), como o Postgres imprime `timestamptz`. */
const HORA_FUSO_CURTO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?[+-]\d{2}$/;
/** UTC−3 fixo, como `diaBrt`/`diaDoLead` (o Brasil não tem horário de verão desde 2019). */
const OFFSET_BRT_MS = -3 * 3_600_000;

/**
 * "21:30" — a hora de Brasília do post; sem fuso na string (seed, CSV antigo) = a hora
 * escrita, como `diaDoLead` faz com o dia. Dia puro ou instante inválido → "".
 */
export function horaDoPost(p: Pick<IgPost, "publishedAt">): string {
  const iso = p.publishedAt ?? "";
  const semFuso = HORA_SEM_FUSO.exec(iso);
  if (semFuso) return `${semFuso[1]}:${semFuso[2]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const ms = Date.parse(HORA_FUSO_CURTO.test(iso) ? `${iso}:00` : iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + OFFSET_BRT_MS).toISOString().slice(11, 16);
}

/** "dd/mm hh:mm" de Brasília — o dia de `diaDoPost` e a hora de `horaDoPost`. */
function quandoDoPost(p: Pick<IgPost, "publishedAt">): string {
  return [formatDateShort(diaDoPost(p)), horaDoPost(p)].filter(Boolean).join(" ");
}

const EH_VIDEO = /\.(mp4|mov|m4v)$/i;

function caminhoDaUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

/**
 * A imagem que serve de miniatura: reel → só `thumbnailUrl` (a `mediaUrl` de reel é o
 * vídeo); feed/carrossel/story → `thumbnailUrl` se houver, senão a `mediaUrl` que não
 * termine em vídeo (`/\.(mp4|mov|m4v)$/i` no caminho da URL). Passa por `miniaturaValida`
 * (`lib/miniatura.ts`): vencida, ausente, não-https ou inválida → null.
 */
export function miniaturaDoPost(p: IgPost, agoraMs: number): string | null {
  if (p.type === "reel") return miniaturaValida(p.thumbnailUrl, agoraMs);
  const url =
    p.thumbnailUrl ||
    (p.mediaUrl && !EH_VIDEO.test(caminhoDaUrl(p.mediaUrl)) ? p.mediaUrl : undefined);
  return miniaturaValida(url, agoraMs);
}

// ---------------------------------------------------------------- variações na grade

export interface GrupoNaGrade extends GrupoDeVariacao {
  /** Ids do grupo ainda na GRADE (sem teste nem impulsionado), ≥ 2. */
  naGrade: string[];
  /** Ids do grupo impulsionados por anúncio (já fora da grade). */
  impulsionados: string[];
}

/**
 * Os grupos de `variacoesDeAnuncio(posts, range)` com 2 ou mais posts na GRADE
 * (`filtroDaGrade(creatives)`, a régua de `postPerformance`). Um post que sobra sozinho
 * é a peça do dia, não duplicata; o impulsionado já está fora. Mesma ordem.
 */
export function variacoesNaGrade(posts: IgPost[], creatives: Creative[], range?: DateRange): GrupoNaGrade[] {
  const daGrade = filtroDaGrade(creatives);
  const porId = new Map(posts.map((p) => [p.id, p]));
  const out: GrupoNaGrade[] = [];
  for (const g of variacoesDeAnuncio(posts, range)) {
    const naGrade: string[] = [];
    const impulsionados: string[] = [];
    for (const v of g.posts) {
      const p = porId.get(v.id);
      if (!p) continue;
      if (daGrade(p)) naGrade.push(v.id);
      else if (!v.isTest) impulsionados.push(v.id);
    }
    if (naGrade.length >= 2) out.push({ ...g, naGrade, impulsionados });
  }
  return out;
}

// ---------------------------------------------------------------- a contagem da grade e Registros

/** grade = `aggregatePostPerformance(posts).count`; testes = `isTest`; impulsionados = não teste e `boosted`; total = `posts.length`. */
export function contagemDaGrade(posts: PostPerf[]): ContagemDaGrade {
  return {
    grade: aggregatePostPerformance(posts).count,
    testes: posts.filter((p) => p.isTest).length,
    impulsionados: posts.filter((p) => !p.isTest && p.boosted).length,
    total: posts.length,
  };
}

/**
 * Registros (§2.11): os posts do período (`postPerformance(data.igPosts, range, undefined,
 * data.creatives)`, dia de Brasília), do mais recente ao mais antigo, como
 * `LinhaDeRegistro` (`quando` = "dd/mm hh:mm"; `detectedCta` = `CTA_LABEL[detectCta(caption)]`),
 * e o título `tituloDosRegistros(contagemDaGrade(posts))`.
 */
export function registrosDoPeriodo(data: DashboardData, range: DateRange | undefined): RegistrosDaTela {
  const posts = postPerformance(data.igPosts, range, undefined, data.creatives);
  const linhas: LinhaDeRegistro[] = posts.map((p) => {
    // Sempre a heurística pura: o "Auto (…)" mostra o que valeria ao voltar para
    // Auto, mesmo com o CTA manual ativo.
    const detectado = detectCta(p.caption ?? "");
    return {
      id: p.id,
      tipo: p.type,
      tipoTexto: ROTULO_DO_TIPO[p.type] ?? p.type,
      quando: quandoDoPost(p),
      legenda: legendaCurta(p.caption),
      href: p.permalink || null,
      durationSec: p.durationSec,
      pillar: p.pillar,
      ctaType: p.ctaType,
      detectedCta: detectado ? CTA_LABEL[detectado] : undefined,
      isTest: p.isTest === true,
      impulsionado: p.boosted === true,
    };
  });
  return { titulo: tituloDosRegistros(contagemDaGrade(posts)), linhas };
}

// ---------------------------------------------------------------- as ações da tela

/**
 * As ações da tela: as regras de `IDS_DE_CONTEUDO` com `linha`, na ordem de
 * `buildRecommendations` (severidade), sem `same-day-pileup` quando
 * `gruposPendentesNoPeriodo > 0` (F5-D32), cortadas em 2. Destino: "Produção" quando
 * o `href` da regra é `/conteudo/producao` (com `comPeriodo(href, rangeKey)`); senão
 * null (nunca um link para a própria página).
 */
export function acoesDaGrade(
  recs: Recommendation[],
  rangeKey: string,
  gruposPendentesNoPeriodo: number,
): AcaoDaGrade[] {
  const daTela = new Set<string>(IDS_DE_CONTEUDO);
  return recs
    .filter((r) => daTela.has(r.id) && !!r.linha)
    .filter((r) => !(r.id === "same-day-pileup" && gruposPendentesNoPeriodo > 0))
    .slice(0, 2)
    .map((r) => ({
      id: r.id,
      linha: r.linha as string,
      destino:
        r.href === "/conteudo/producao"
          ? { href: comPeriodo("/conteudo/producao", rangeKey), rotulo: "Produção" as const }
          : null,
      dica: r.detail,
      rotulo: `Sobre a ação “${r.title}”`,
    }));
}

// ---------------------------------------------------------------- a tela

const plural = (n: number, um: string, varios: string) => `${formatInt(n)} ${n === 1 ? um : varios}`;

/**
 * Quem ficou fora da grade: "2 de teste e 1 impulsionado" (as partes com zero somem;
 * sem nenhuma, null), com o verbo que concorda com o total — "ficou" com 1 post só,
 * "ficaram" com 2 ou mais.
 */
function foraDaGrade(testes: number, impulsionados: number): { quem: string; um: boolean } | null {
  const partes: string[] = [];
  if (testes > 0) partes.push(`${formatInt(testes)} de teste`);
  if (impulsionados > 0) partes.push(plural(impulsionados, "impulsionado", "impulsionados"));
  if (partes.length === 0) return null;
  return { quem: partes.join(" e "), um: testes + impulsionados === 1 };
}

const capitalizar = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

const DICA_DAS_VARIACOES = [
  "Posts com a mesma legenda publicados no mesmo dia, em todo o histórico: quase sempre cortes de um teste ou versões de um anúncio.",
  "O grupo aparece enquanto 2 ou mais deles contam como posts da grade: no placar, na cadência, nos melhores e nas ações.",
  "Desmarque o post que fica na grade; os marcados saem dessas contas.",
  "Um impulsionado já está fora da grade; nada muda sem alguém confirmar.",
  "Para desmarcar um post, use Registros.",
].join(" ");

const DICA_DOS_MELHORES_FIXA = [
  "Depois vêm as interações: curtidas, comentários, salvos e compartilhamentos somados.",
  "Em número, não em taxa: com o alcance pequeno de cada post, a taxa exagera o acaso.",
  "Empate: o de mais alcance, depois o mais recente.",
  "Ficam fora os de teste, os impulsionados por anúncio e os posts sem nenhuma interação.",
  "Um post de menos de 2 dias ainda está acumulando interações.",
  "O resumo da IA usa esta mesma régua na semana fechada.",
  "A legenda abre o post no Instagram; o alcance está em Todos os posts.",
];

const DICA_DE_TODOS_OS_POSTS = [
  "Todos os posts do período: os de teste e os impulsionados aparecem com selo.",
  "A legenda abre o post no Instagram.",
  "O sync renova os números só dos 25 posts mais recentes; os mais antigos ficam com o último número lido.",
  "Para marcar ou desmarcar um teste, use Registros.",
].join(" ");

const DICA_DA_CONTA = [
  "Números da conta inteira no período, pago + orgânico.",
  "O alcance orgânico dos posts é outra soma: a diferença entre os dois não é o pago.",
  "Toques nos botões do perfil e conversas de DM saíram: a API não mede o link da bio, e as DMs não eram registradas.",
].join(" ");

/** salvos + compartilhamentos: a 1ª chave de `rankingDaGrade`. */
const sc = (p: PostPerf) => p.saved + p.shares;

function tituloDosMelhores(n: number, ranking: PostPerf[]): string {
  const k = Math.min(ranking.length, 3);
  if (k === 0) return "Nenhum post da grade teve interação no período";
  const r0 = ranking[0];
  if (n === 1) return `1 post da grade, com ${textoDeInteracoes(r0.interactions)}`;
  const r1 = ranking[1];
  const empata = (p: PostPerf) => sc(p) === sc(r0) && p.interactions === r0.interactions;
  if (k >= 2 && empata(r1)) {
    const m = ranking.filter(empata).length;
    return `${formatInt(m)} posts empatam com ${textoDeInteracoes(r0.interactions)}`;
  }
  const quem = `${ROTULO_DO_TIPO[r0.type] ?? r0.type} de ${formatDateShort(diaDoPost(r0))}`;
  if (sc(r0) >= 1 && (k === 1 || sc(r0) > sc(r1))) {
    const partes: string[] = [];
    if (r0.saved > 0) partes.push(plural(r0.saved, "salvo", "salvos"));
    if (r0.shares > 0) partes.push(plural(r0.shares, "compartilhamento", "compartilhamentos"));
    return `${quem} lidera: ${partes.join(", ")}`;
  }
  return `${quem} lidera com ${textoDeInteracoes(r0.interactions)}`;
}

function cardDePost(p: PostPerf, agoraMs: number): CardDePost {
  return {
    id: p.id,
    legenda: legendaCurta(p.caption),
    href: p.permalink || null,
    miniatura: miniaturaDoPost(p, agoraMs),
    formato: FORMATO_DA_MINIATURA[p.type] ?? "imagem",
    linha: [
      ROTULO_DO_TIPO[p.type] ?? p.type,
      formatDateShort(diaDoPost(p)),
      plural(p.saved, "salvo", "salvos"),
      `${formatInt(p.shares)} compart.`,
      textoDeInteracoes(p.interactions),
    ].join(" · "),
  };
}

function linhaDePost(p: PostPerf): LinhaDePost {
  return {
    id: p.id,
    iso: p.publishedAt,
    data: formatDateShort(diaDoPost(p)),
    tipo: p.type,
    tipoTexto: ROTULO_DO_TIPO[p.type] ?? p.type,
    legenda: legendaCurta(p.caption),
    href: p.permalink || null,
    alcance: p.reach,
    views: p.views,
    interacoes: p.interactions,
    salvos: p.saved,
    compartilhamentos: p.shares,
    engajamento: p.reach > 0 ? p.engagementRate : null,
    teste: p.isTest === true,
    impulsionado: p.boosted === true,
  };
}

/** A tela do Conteúdo (§2), pura. */
export function montarConteudoDaTela(e: EntradaConteudo): ConteudoDaTela {
  const { data, range } = e;
  const conversao = !isAwareness(e.marca);
  const agoraMs = Date.parse(e.agora);

  // 1. Os posts do período (dia de Brasília) e a conta que soma a lista.
  const posts = postPerformance(data.igPosts, range, data.igAccountDaily, data.creatives);
  const c = contagemDaGrade(posts);
  const n = c.grade;

  // 2. O último post da grade: os MESMOS argumentos do rodapé do Início.
  const dias = ultimoPostDaGrade(data.igPosts, data.creatives, e.agora);

  // 3. Instagram do período e seguidores.
  const rows = data.igAccountDaily
    .filter((r) => inRange(r.date, range))
    .sort((a, b) => a.date.localeCompare(b.date));
  const temIg = rows.length > 0;
  const seg = resumoSeguidores(data.igAccountDaily, range);
  const comTotal = temIg && seg.temTotal;
  const temVespera = !!range && data.igAccountDaily.some((r) => r.date < range.from && r.followers > 0);
  const primeiraLeitura = rows.find((r) => r.followers > 0)?.date;

  // 5 (antes do placar: o item 3 do ⓘ lê o kp). Variações: histórico inteiro × período.
  const historico = variacoesNaGrade(data.igPosts, data.creatives, undefined);
  const kp = variacoesNaGrade(data.igPosts, data.creatives, range).length;

  // 4. Placar.
  const dicaDoPlacar: string[] = [
    "Posts da grade: os publicados no período, no dia de Brasília, sem os de teste e os impulsionados por anúncio.",
  ];
  const fora = foraDaGrade(c.testes, c.impulsionados);
  if (fora) {
    dicaDoPlacar.push(
      fora.um
        ? `No período, ${fora.quem} ficou de fora; ele está em Todos os posts.`
        : `No período, ${fora.quem} ficaram de fora; eles estão em Todos os posts.`,
    );
  }
  if (kp > 0) {
    dicaDoPlacar.push(
      kp === 1
        ? "1 grupo de posts iguais no mesmo dia do período ainda conta como posts da grade."
        : `${formatInt(kp)} grupos de posts iguais no mesmo dia do período ainda contam como posts da grade.`,
    );
  }
  dicaDoPlacar.push(
    dias === null
      ? "Nenhum post da grade em todo o histórico."
      : `Último post da grade, em todo o histórico: ${formatDateShort(somarDias(e.hoje, -dias))}, no dia de Brasília.`,
  );
  if (!temIg) {
    dicaDoPlacar.push("Sem dados do Instagram no período.");
  } else if (!seg.temTotal) {
    dicaDoPlacar.push("Os snapshots do período vieram sem o total de seguidores.");
  } else {
    dicaDoPlacar.push(`Seguidores no fim do período: ${formatInt(seg.fim)}.`);
    dicaDoPlacar.push(
      seg.serieCompleta || temVespera || !primeiraLeitura
        ? "A variação conta desde a véspera do período."
        : `Sem leitura do total antes de ${formatDateShort(primeiraLeitura)}: a variação conta a partir desse dia.`,
    );
    if (!seg.fimNoUltimoDia && seg.fimEm) {
      dicaDoPlacar.push(`O último snapshot veio sem o total: vale o de ${formatDateShort(seg.fimEm)}.`);
    }
  }
  if (comTotal) {
    dicaDoPlacar.push(`${capitalizar(seg.nota)}.`);
    dicaDoPlacar.push("Pago + orgânico: a Meta não separa quem passou a seguir por causa de um anúncio.");
  }
  if (conversao) {
    dicaDoPlacar.push("Leads sem anúncio pago do período estão no ⓘ do cartão Leads do Início.");
  }
  const placar: PlacarDaTela = {
    posts: n === 0 ? "Nenhum post no período" : n === 1 ? "1 post no período" : `${formatInt(n)} posts no período`,
    ultimo: textoDoUltimoPost(dias),
    seguidores: comTotal ? `Seguidores ${seg.liquidoTexto} (pago + orgânico)` : "Seguidores —",
    dica: dicaDoPlacar.join(" "),
    numeros: { posts: n, diasDesdeUltimoPost: dias, seguidoresLiquido: comTotal ? seg.liquido : null },
  };

  // 5. Variações (a linha e o recolhido): histórico inteiro, só grupos com 2+ na grade.
  let variacoes: VariacoesDaTela | null = null;
  if (historico.length > 0) {
    const porId = new Map(data.igPosts.map((p) => [p.id, p]));
    const k = historico.length;
    variacoes = {
      linha:
        k === 1
          ? "1 grupo de posts iguais no mesmo dia para conferir"
          : `${formatInt(k)} grupos de posts iguais no mesmo dia para conferir`,
      dica: DICA_DAS_VARIACOES,
      lista: historico.map((g) => {
        const impulsionados = new Set(g.impulsionados);
        return {
          // Sem texto da legenda (ela nunca vai inteira ao client): o dia e o 1º post do grupo.
          chave: `${g.dia}|${g.posts[0].id}`,
          diaTexto: formatDateShort(g.dia),
          legenda: legendaCurta(g.legenda),
          posts: g.posts.map((v) => {
            const p = porId.get(v.id);
            return {
              id: v.id,
              tipo: ROTULO_DO_TIPO[v.type] ?? v.type,
              hora: horaDoPost(v),
              href: p?.permalink || null,
              estado: v.isTest ? ("teste" as const) : impulsionados.has(v.id) ? ("impulsionado" as const) : ("grade" as const),
            };
          }),
          naGrade: g.naGrade,
        };
      }),
      registrosHref: comPeriodo("/conteudo/registros#posts", "all"),
      total: k,
    };
  }

  // 6. Os posts que mais funcionaram (a MESMA ordem que a IA lê).
  let melhores: MelhoresDaTela | null = null;
  if (n > 0) {
    const ranking = rankingDaGrade(posts).filter((p) => p.interactions > 0);
    const top = ranking.slice(0, 3);
    const k = top.length;
    melhores = {
      titulo: tituloDosMelhores(n, ranking),
      dica: [
        k === 1
          ? "O post da grade com mais salvos e compartilhamentos no período, os sinais que o guia pede."
          : k === 0
            ? "Os posts da grade com mais salvos e compartilhamentos no período, os sinais que o guia pede."
            : `Os ${formatInt(k)} posts da grade com mais salvos e compartilhamentos no período, os sinais que o guia pede.`,
        ...DICA_DOS_MELHORES_FIXA,
      ].join(" "),
      cards: top.map((p) => cardDePost(p, agoraMs)),
    };
  }

  // 7. Ações: só na marca de conversão. `naoComecou` NÃO esvazia (F5-D34): as do
  //    agora aparecem; as do período não disparam (o período é um dia vazio).
  const acoes = conversao
    ? acoesDaGrade(buildRecommendations(data, range, e.agora, e.drafts), e.rangeKey, kp)
    : [];

  // 8. Todos os posts do período (com teste e impulsionado, com selo).
  const todos: TodosOsPostsDaTela | null =
    posts.length === 0
      ? null
      : {
          linhas: posts.map(linhaDePost),
          dica: DICA_DE_TODOS_OS_POSTS,
          producao: e.comPlaybook ? { href: comPeriodo("/conteudo/producao", e.rangeKey) } : null,
        };

  // 9. A conta do Instagram.
  let conta: ContaDaTela | null = null;
  if (temIg) {
    const ig = igAccountTotals(data.igAccountDaily, range);
    const org = alcanceOrganicoDosPosts(data.igPosts, range, data.creatives);
    const foraDoOrganico = foraDaGrade(org.testes, org.impulsionados);
    const fraseDoOrganico = foraDoOrganico
      ? `${plural(org.posts, "post", "posts")}; ${foraDoOrganico.quem} ${foraDoOrganico.um ? "ficou" : "ficaram"} de fora.`
      : `${plural(org.posts, "post", "posts")}.`;
    const numero = (id: IdDoNumeroDaConta, valor: number, extra?: string): NumeroDaConta => ({
      id,
      rotulo: DICIONARIO[id].nome,
      valor: formatInt(valor),
      dica: extra ? `${dica(id)} ${extra}` : dica(id),
    });
    const pontos = conversao
      ? pontosDoTotalDeSeguidores(followerSeries(data.igAccountDaily, range)).map(({ date, followers }) => ({
          date,
          followers,
        }))
      : [];
    const serieDeSeguidores = pontos.length >= 2 ? pontos : null;
    conta = {
      numeros: [
        numero("alcance_conta", ig.reach),
        numero("alcance_organico_posts", org.alcance, fraseDoOrganico),
        numero("views", ig.views),
        numero("interacoes", ig.interactions),
        numero("visitas_perfil", ig.profileViews),
      ],
      dica: DICA_DA_CONTA,
      serieDeSeguidores,
      tituloDoGrafico: serieDeSeguidores
        ? seg.temTotal
          ? `Total de seguidores · ${formatInt(seg.fim)}`
          : "Total de seguidores"
        : null,
    };
  }

  return { placar, variacoes, melhores, acoes, todos, conta };
}
