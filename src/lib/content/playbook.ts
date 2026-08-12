/**
 * O "Guia de Produção" como CÓDIGO — fonte única da verdade editorial.
 *
 * Tudo que o documento define (grade semanal, padrão de reel/carrossel, ciclo de
 * CTA, termos de busca, "Nunca mais", metas de 90 dias, régua do nicho) mora
 * aqui, tipado e versionado. Quem lê este arquivo:
 *   • `content/validator.ts` — valida a peça ANTES de publicar
 *   • `recommendations.ts`   — alertas sobre o que JÁ foi publicado
 *   • (Etapa 2) o prompt do revisor de IA
 *
 * O guia mudar = este arquivo mudar, e nada mais. Suba `PLAYBOOK_VERSION` junto:
 * a versão fica gravada em cada validação, para saber contra qual régua a peça
 * foi aprovada quando o guia evoluir.
 *
 * PURO — sem I/O, sem `server-only`: o editor de rascunho (client component)
 * importa daqui para validar enquanto se digita.
 */

import type { CtaType, IgMediaType } from "../types";

export const PLAYBOOK_VERSION = "v3";
/** Data do documento que originou esta régua (dd/mmm/aaaa do cabeçalho). */
export const PLAYBOOK_DATE = "2026-08-12";

/**
 * Marcas que têm guia de produção. O documento v3 é do @consorcio.brunno — a
 * krone.capital tem outra tese de conteúdo e ainda não tem guia, então a página
 * de Produção não aparece para ela em vez de validar contra uma régua alheia.
 * Quando a krone ganhar guia próprio, este módulo passa a exportar um playbook
 * por marca e o resto do código não muda.
 */
const BRANDS_COM_PLAYBOOK = new Set(["consorcio"]);

export function hasPlaybook(brand: string): boolean {
  return BRANDS_COM_PLAYBOOK.has(brand);
}

// ------------------------- grade semanal ----------------------------

/** Um dia da grade. `type: null` = dia sem feed (só stories). */
export interface WeekSlot {
  /** 0=Dom … 6=Sáb (mesma convenção de `Date.getUTCDay`). */
  weekday: number;
  label: string;
  type: IgMediaType | null;
  /** Série fixa esperada no dia, quando houver. */
  pillar?: string;
  /** Duração-alvo da série (segundos) — mais apertada que o teto geral. */
  targetSec?: number;
  note: string;
}

export const WEEK_SLOTS: WeekSlot[] = [
  { weekday: 1, label: "Seg", type: "carrossel", pillar: "Método", note: "Carrossel de método" },
  { weekday: 2, label: "Ter", type: "reel", pillar: "Simulação da semana", targetSec: 20, note: "Caso real numérico no quadro branco/flipchart" },
  { weekday: 3, label: "Qua", type: null, note: "Sem feed — stories + rotina de presença" },
  { weekday: 4, label: "Qui", type: "reel", pillar: "Mito ou verdade", targetSec: 15, note: "Uma objeção por vez, resposta em uma frase" },
  { weekday: 5, label: "Sex", type: "reel", pillar: "Bastidor", note: "Evento, reunião, contemplação, cliente — prova social" },
  { weekday: 6, label: "Sáb", type: "reel", note: "Reel livre — reteste de ângulo vencedor" },
  { weekday: 0, label: "Dom", type: "carrossel", note: "2º carrossel ou repost do melhor da semana" },
];

/** Grade na ordem em que se lê a semana (segunda → domingo). */
export const WEEK_ORDER: WeekSlot[] = [...WEEK_SLOTS].sort(
  (a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7),
);

/** O slot da grade para um dia da semana (0=Dom … 6=Sáb). */
export function slotForWeekday(weekday: number): WeekSlot | undefined {
  return WEEK_SLOTS.find((s) => s.weekday === weekday);
}

/**
 * Dia da semana de uma data pura `yyyy-mm-dd`, em UTC. Usar UTC (e não o fuso
 * local) mantém a leitura estável no servidor e no cliente — mesma convenção de
 * `weekdayPerformance` em metrics.ts.
 */
export function weekdayOf(day: string): number {
  return new Date(`${day.slice(0, 10)}T00:00:00Z`).getUTCDay();
}

/** Composição semanal esperada: 4 reels + 2 carrosséis, nunca 2 peças no mesmo dia. */
export const WEEKLY_MIX = {
  reels: 4,
  carrosseis: 2,
  total: 6,
  maxPorDia: 1,
} as const;

// ------------------------- padrão de reel ---------------------------

export const REEL = {
  /** Teto do guia enquanto a retenção não passa de 40%. */
  maxDurationSec: 25,
  /** "Nunca mais": reel acima de 30s. Acima disto é bloqueio, não aviso. */
  hardMaxDurationSec: 30,
  /** Formato longo liberado só quando a retenção média passar deste patamar. */
  longFormUnlockRetention: 0.4,
  /** Texto de tela do gancho: máximo de palavras. */
  hookMaxWords: 7,
  /** Janela em que o gancho (falado + escrito) tem de acontecer. */
  hookWindowSec: 2,
  /** Gancho que passa disto já é introdução disfarçada. */
  hookLatestSec: 4,
} as const;

// ------------------------- padrão de carrossel ----------------------

export const CARROSSEL = {
  /** Slide 1: promessa numérica específica. */
  requerPromessaNumerica: true,
  /** Último slide: CTA de salvamento + palavra-chave. */
  ctaFinal: "salvamento" as CtaType,
} as const;

// ------------------------- rotação de CTA ---------------------------

/**
 * O ciclo de 4 do guia, em ordem. A posição importa: o validador olha os CTAs
 * das últimas peças (publicadas + agendadas) e diz qual é o "CTA da vez" —
 * é isso que garante "DM no máximo 1 a cada 4 posts" na prática, e não só na
 * média do período.
 */
export const CTA_CYCLE: CtaType[] = ["comentario", "salvamento", "marcacao", "dm"];

/** Fração máxima de posts pedindo DM (1 a cada 4). */
export const DM_MAX_SHARE = 1 / CTA_CYCLE.length;

/**
 * Próximo CTA do ciclo, dado o histórico do mais RECENTE para o mais antigo.
 * Sem histórico reconhecível, começa no início do ciclo (comentário — o CTA de
 * menor atrito, que é onde o guia manda começar).
 */
export function nextCtaInCycle(recentFirst: (CtaType | undefined)[]): CtaType {
  const last = recentFirst.find((c): c is CtaType => c != null && CTA_CYCLE.includes(c));
  if (!last) return CTA_CYCLE[0];
  return CTA_CYCLE[(CTA_CYCLE.indexOf(last) + 1) % CTA_CYCLE.length];
}

// ------------------------- legenda / SEO ----------------------------

export const LEGENDA = {
  /**
   * A 1ª linha tem de sobreviver ao corte do "… mais". O Instagram corta por
   * volta de 125 caracteres — teto conservador para não perder a promessa.
   */
  primeiraLinhaMaxChars: 125,
} as const;

/** Termos de busca do nicho (SEO da legenda) — pelo menos um por post. */
export const SEO_TERMS = [
  "consórcio imobiliário",
  "carta contemplada",
  "lance embutido",
  "financiamento",
  "consórcio",
  "contemplação",
  "parcela",
  "amortização",
];

/**
 * Aberturas que denunciam introdução em vez de gancho. O guia é explícito:
 * "sem introdução, sem 'oi, pessoal'".
 */
export const ABERTURAS_PROIBIDAS = [
  "oi pessoal",
  "oi gente",
  "olá pessoal",
  "ola pessoal",
  "e aí pessoal",
  "e ai pessoal",
  "fala galera",
  "fala pessoal",
  "bom dia pessoal",
  "boa tarde pessoal",
  "boa noite pessoal",
  "sejam bem-vindos",
  "seja bem-vindo",
  "tudo bem com vocês",
  "hoje eu vou falar sobre",
  "hoje vou falar sobre",
  "nesse vídeo eu vou",
  "neste vídeo eu vou",
  "nesse vídeo vou",
  "antes de começar",
  "se inscreve no canal",
];

// ------------------------- banco de ganchos -------------------------

export interface HookMold {
  key: string;
  label: string;
  example: string;
}

/**
 * Os 5 moldes do guia. São MOLDES — troque pelo caso e pelo número da semana.
 * (Etapa 2) O revisor de IA reescreve o gancho usando estes moldes, para as
 * alternativas saírem na voz do perfil e não numa voz genérica.
 */
export const HOOK_MOLDS: HookMold[] = [
  {
    key: "caso-cliente",
    label: "Caso de cliente",
    example:
      "Ontem um cliente me mostrou o financiamento que ele ia assinar hoje. Tinha um custo de R$ 180 mil que ninguém mostrou pra ele.",
  },
  {
    key: "pergunta-real",
    label: "Pergunta real",
    example:
      "Me perguntaram essa semana: “Brunno, se eu já tenho os 500 mil, por que não comprar à vista?” Deixa eu te mostrar a conta.",
  },
  {
    key: "confissao-insider",
    label: "Confissão de insider",
    example: "Eu trabalho com consórcio — e vou te falar quando consórcio NÃO vale a pena.",
  },
  {
    key: "conta-na-tela",
    label: "A conta na tela",
    example: "O banco não faz essa conta na sua frente. Então eu vou fazer agora, na planilha.",
  },
  {
    key: "numero-falado",
    label: "Número como se fala",
    example:
      "Financiar 500 mil hoje é devolver quase 1 milhão e cem pro banco. Refiz essa conta com um cliente e ele não acreditou.",
  },
];

// ------------------------- séries fixas -----------------------------

export interface Serie {
  pillar: string;
  weekday: number;
  descricao: string;
}

export const SERIES: Serie[] = [
  { pillar: "Simulação da semana", weekday: 2, descricao: "Caso real numérico — bem de R$ X, três caminhos, custo total de cada um, no quadro branco." },
  { pillar: "Mito ou verdade", weekday: 4, descricao: "Uma objeção por vez, resposta em uma frase. Desenhado para retenção e comentário." },
  { pillar: "Bastidor", weekday: 5, descricao: "Evento, reunião, contemplação, cliente. Prova social." },
];

// ------------------------- "Nunca mais" -----------------------------

export interface Ban {
  id: string;
  label: string;
}

/** Os 8 itens da faixa vermelha do guia. Todos são bloqueio, nunca aviso. */
export const BANS: Ban[] = [
  { id: "publico-amplo", label: "Impulsionar com público amplo / comprar seguidor" },
  { id: "card-frase", label: "Card de frase motivacional" },
  { id: "reel-longo", label: "Reel acima de 30s (até a retenção subir)" },
  { id: "dm-sempre", label: "Pedir DM em todo post" },
  { id: "misturar-pago-organico", label: "Ler o painel com pago e orgânico juntos" },
  { id: "duas-pecas-dia", label: "Publicar 2+ peças no mesmo dia" },
  { id: "sem-palavra-chave", label: "Post sem palavra-chave na legenda" },
  { id: "dia-sem-story", label: "Dia útil sem story" },
];

/** Pilares proibidos na grade (o card de frase é o pior formato do perfil). */
export const PILARES_PROIBIDOS = /frase|motivacional/i;

// ------------------------- checklist de publicação ------------------

/**
 * Os 7 itens do "Checklist antes de publicar". Cada `id` casa com o `id` de uma
 * checagem do validador, para a UI marcar o item como cumprido ou apontar o que
 * falta. Ordem = ordem do guia.
 */
export const CHECKLIST: { id: string; label: string }[] = [
  { id: "gancho", label: "Gancho passou no teste do áudio?" },
  { id: "duracao", label: "≤25 segundos?" },
  { id: "numero", label: "Tem número ou comparação concreta?" },
  { id: "legenda-embutida", label: "Legenda embutida + palavra-chave?" },
  { id: "cta-da-vez", label: "CTA da vez (DM só 1 a cada 4)?" },
  { id: "primeira-linha", label: "1ª linha da legenda sobrevive ao “… mais”?" },
  { id: "unica-do-dia", label: "É a única peça do dia?" },
];

/**
 * Rótulo legível de cada regra do validador (os `id` das issues). Usado no
 * relatório de previsto×realizado, que pergunta "violar ESTA regra custou
 * alcance?" — sem rótulo, a tabela seria uma lista de slugs.
 */
export const RULE_LABEL: Record<string, string> = {
  gancho: "Gancho (7 palavras, sem introdução)",
  duracao: "Duração ≤25s",
  numero: "Número ou comparação concreta",
  "legenda-embutida": "Legenda embutida + palavra-chave",
  "cta-da-vez": "CTA da vez (ciclo de 4)",
  "primeira-linha": "1ª linha sobrevive ao “… mais”",
  "unica-do-dia": "Única peça do dia",
  pilar: "Pilar permitido (sem card de frase)",
  grade: "Aderência à grade semanal",
  roteiro: "Roteiro preenchido",
  carrossel: "Padrão de carrossel",
};

// ------------------------- painel semanal ---------------------------

/**
 * As metas de 90 dias do guia, na unidade em que `actualForGoal` devolve o
 * realizado. Serve de sugestão no formulário de metas e de referência quando a
 * marca ainda não gravou meta nenhuma.
 */
export const METAS_90D: { metric: string; label: string; hoje: string; alvo: number }[] = [
  { metric: "retencao_reels", label: "Retenção média dos reels", hoje: "~3s (≤16%)", alvo: 40 },
  { metric: "alcance_base", label: "Alcance sobre a base de seguidores", hoje: "5–22%", alvo: 35 },
  { metric: "saves_1k", label: "Salvamentos / 1.000 views", hoje: "~0,4", alvo: 8 },
  { metric: "comentarios_post", label: "Comentários por post", hoje: "0", alvo: 8 },
  { metric: "compartilhamentos_post", label: "Compartilhamentos por post", hoje: "~0,4", alvo: 5 },
  { metric: "conversas_dm", label: "Conversas de DM iniciadas / semana", hoje: "sem registro", alvo: 10 },
];

// ------------------------- régua do nicho ---------------------------

/**
 * Expectativa honesta de alcance orgânico, para o painel não ler todo post como
 * fracasso: líderes do nicho com ~40 mil seguidores rodam 700–1.500 views por
 * reel. Viral é exceção (produção + collab + mídia), não meta semanal.
 */
export const BENCHMARK = {
  reelViewsMin: 700,
  reelViewsMax: 1500,
  seguidoresReferencia: 40_000,
  nota: "Viral é exceção (produção + collab + mídia), não meta semanal.",
} as const;

// ------------------------- rotina diária ----------------------------

export const ROTINA_DIARIA = {
  storiesMin: 3,
  storiesMax: 5,
  storiesInterativosMin: 1,
  comentariosNoNicho: 20,
  seguirPorDia: [10, 15] as const,
  metaSeguindo: [150, 300] as const,
  minutosPorDia: [15, 20] as const,
} as const;
