/**
 * Previsto × realizado — o loop que faz o sistema aprender (Etapa 4).
 *
 * Junta o rascunho validado com o post que ele virou e pergunta o que nenhuma
 * das etapas anteriores conseguia responder: **a régua do guia prediz
 * desempenho NESTE perfil?** Se violar "duração ≤25s" não muda nada no alcance,
 * a regra é dogma; se muda, é alavanca — e o guia v4 sai daqui, não da intuição.
 *
 * PURO — sem I/O. Honestidade estatística é requisito, não enfeite: com poucos
 * pares qualquer diferença é ruído, então `sampleOk` governa o que a UI mostra.
 */

import { RULE_LABEL } from "./playbook";
import { normalizeText, firstLine } from "./validator";
import { dayOf, postEngagementRate, reelRetention } from "../metrics";
import type { IgMediaType, IgPost, PostDraft } from "../types";

/**
 * Pares mínimos para tirar QUALQUER conclusão agregada. Abaixo disto a UI mostra
 * só a lista crua — melhor não dizer nada do que dizer algo que o próximo post
 * derruba. (O perfil tinha 13 posts no diagnóstico; 6 pares é o primeiro
 * patamar em que uma diferença começa a significar alguma coisa.)
 */
export const MIN_OUTCOME_PAIRS = 6;
/** Mínimo em CADA lado (violou / cumpriu) para comparar uma regra. */
const MIN_PER_SIDE = 2;

const div = (a: number, b: number) => (b > 0 ? a / b : 0);
const avg = (ns: number[]) => (ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : 0);

// ---- vínculo rascunho → post ---------------------------------------

export interface MatchCandidate {
  postId: string;
  publishedAt: string;
  caption: string;
  type: IgMediaType;
  confianca: "alta" | "media";
  motivo: string;
}

/**
 * Candidatos a "este rascunho virou este post". Alta confiança = a legenda bate
 * (o texto foi escrito aqui e colado lá). Média = mesmo dia e mesmo formato.
 * Nunca vincula sozinho: devolve sugestão para uma pessoa confirmar, porque um
 * vínculo errado envenena todo o aprendizado adiante.
 */
/** Só o que o casamento precisa — a UI passa um recorte, não o post inteiro. */
export type MatchablePost = Pick<IgPost, "id" | "publishedAt" | "caption" | "type">;

export function suggestMatches(
  draft: PostDraft,
  posts: MatchablePost[],
  jaVinculados: Set<string>,
): MatchCandidate[] {
  const out: MatchCandidate[] = [];
  const dCap = normalizeText(draft.caption).trim();
  const dL1 = normalizeText(firstLine(draft.caption)).trim();

  for (const p of posts) {
    if (jaVinculados.has(p.id)) continue;
    const pCap = normalizeText(p.caption).trim();
    const pL1 = normalizeText(firstLine(p.caption)).trim();

    if (dCap.length > 20 && pCap === dCap) {
      out.push({ ...base(p), confianca: "alta", motivo: "legenda idêntica" });
      continue;
    }
    if (dL1.length > 15 && pL1 === dL1) {
      out.push({ ...base(p), confianca: "alta", motivo: "1ª linha idêntica" });
      continue;
    }
    if (draft.plannedFor && dayOf(p.publishedAt) === draft.plannedFor && p.type === draft.type) {
      out.push({ ...base(p), confianca: "media", motivo: "mesmo dia e formato" });
    }
  }

  // Alta confiança primeiro; dentro do mesmo nível, o post mais recente.
  return out.sort((a, b) =>
    a.confianca === b.confianca
      ? b.publishedAt.localeCompare(a.publishedAt)
      : a.confianca === "alta"
        ? -1
        : 1,
  );

  function base(p: MatchablePost) {
    return { postId: p.id, publishedAt: p.publishedAt, caption: p.caption, type: p.type };
  }
}

// ---- o relatório ----------------------------------------------------

export interface DraftOutcome {
  draftId: string;
  postId: string;
  publishedAt: string;
  hookText: string;
  type: IgMediaType;
  pillar?: string;
  // previsto
  score: number;
  failed: string[];
  aiVeredito?: string;
  // realizado
  reach: number;
  views: number;
  engagementRate: number;
  savesPer1k: number;
  retention?: number;
}

export interface ScoreBand {
  faixa: string;
  n: number;
  alcanceMedio: number;
  engajamentoMedio: number;
  salvos1kMedio: number;
}

export interface RuleLift {
  ruleId: string;
  label: string;
  nViolou: number;
  nCumpriu: number;
  alcanceMedioViolou: number;
  alcanceMedioCumpriu: number;
  /** cumpriu ÷ violou. >1 = cumprir a regra rendeu mais alcance. */
  lift: number;
  /** Há pares suficientes dos DOIS lados para a comparação valer? */
  sampleOk: boolean;
}

export interface OutcomeReport {
  pairs: DraftOutcome[];
  /** Pares suficientes para as agregações abaixo significarem algo. */
  sampleOk: boolean;
  minSample: number;
  porFaixaDeNota: ScoreBand[];
  porRegra: RuleLift[];
  /** Pearson entre nota e alcance. `null` com amostra pequena. */
  correlacaoNotaAlcance: number | null;
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = avg(xs);
  const my = avg(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  // Variância zero de um dos lados (todas as notas iguais, por exemplo): não há
  // correlação a calcular — devolver 0 aqui seria afirmar "não há relação".
  return den > 0 ? num / den : null;
}

/**
 * Monta o relatório a partir dos rascunhos vinculados. Só entram pares em que o
 * rascunho tem nota gravada — sem previsto não há o que comparar.
 */
export function buildOutcomeReport(drafts: PostDraft[], posts: IgPost[]): OutcomeReport {
  const byId = new Map(posts.map((p) => [p.id, p]));

  const pairs: DraftOutcome[] = [];
  for (const d of drafts) {
    if (!d.publishedPostId || d.score == null) continue;
    const p = byId.get(d.publishedPostId);
    if (!p) continue;
    pairs.push({
      draftId: d.id,
      postId: p.id,
      publishedAt: p.publishedAt,
      hookText: d.hookText,
      type: p.type,
      pillar: d.pillar ?? p.pillar,
      score: d.score,
      failed: d.validationFailed ?? [],
      aiVeredito: d.aiReview?.veredito,
      reach: p.reach,
      views: p.views,
      engagementRate: postEngagementRate(p),
      savesPer1k: div(p.saved, p.views) * 1000,
      retention: reelRetention(p) ?? undefined,
    });
  }
  pairs.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  const sampleOk = pairs.length >= MIN_OUTCOME_PAIRS;

  // ---- por faixa de nota ----
  const bands: { faixa: string; test: (s: number) => boolean }[] = [
    { faixa: "90–100", test: (s) => s >= 90 },
    { faixa: "70–89", test: (s) => s >= 70 && s < 90 },
    { faixa: "abaixo de 70", test: (s) => s < 70 },
  ];
  const porFaixaDeNota = bands
    .map(({ faixa, test }) => {
      const list = pairs.filter((p) => test(p.score));
      return {
        faixa,
        n: list.length,
        alcanceMedio: Math.round(avg(list.map((p) => p.reach))),
        engajamentoMedio: avg(list.map((p) => p.engagementRate)),
        salvos1kMedio: avg(list.map((p) => p.savesPer1k)),
      };
    })
    .filter((b) => b.n > 0);

  // ---- por regra ----
  const regras = [...new Set(pairs.flatMap((p) => p.failed))];
  const porRegra = regras
    .map((ruleId) => {
      const violou = pairs.filter((p) => p.failed.includes(ruleId));
      const cumpriu = pairs.filter((p) => !p.failed.includes(ruleId));
      const aV = avg(violou.map((p) => p.reach));
      const aC = avg(cumpriu.map((p) => p.reach));
      return {
        ruleId,
        label: RULE_LABEL[ruleId] ?? ruleId,
        nViolou: violou.length,
        nCumpriu: cumpriu.length,
        alcanceMedioViolou: Math.round(aV),
        alcanceMedioCumpriu: Math.round(aC),
        lift: aV > 0 ? aC / aV : 0,
        sampleOk:
          sampleOk && violou.length >= MIN_PER_SIDE && cumpriu.length >= MIN_PER_SIDE,
      };
    })
    .sort((a, b) => b.lift - a.lift);

  return {
    pairs,
    sampleOk,
    minSample: MIN_OUTCOME_PAIRS,
    porFaixaDeNota,
    porRegra,
    correlacaoNotaAlcance: sampleOk
      ? pearson(pairs.map((p) => p.score), pairs.map((p) => p.reach))
      : null,
  };
}

// ---- rotina diária de presença -------------------------------------

export interface PresenceRoutine {
  /** Dias da janela com algum registro manual. */
  diasComRegistro: number;
  /** Dias ÚTEIS da janela (a rotina do guia é de dias úteis). */
  diasUteis: number;
  storiesPorDia: number;
  /** Dias úteis sem nenhum story — é um "Nunca mais" do guia. */
  diasUteisSemStory: number;
  comentariosPorDia: number;
  seguidasPorDia: number;
  /** Fração dos dias registrados em que respondeu tudo. */
  respondeuTudoPct: number;
  /** Sem nenhum registro não há o que cobrar — a UI esconde o bloco. */
  temDados: boolean;
}

/** É dia útil? (segunda a sexta, em UTC — mesma convenção do resto do painel.) */
function isWeekday(day: string): boolean {
  const d = new Date(`${day}T00:00:00Z`).getUTCDay();
  return d >= 1 && d <= 5;
}

/**
 * Aderência à rotina diária do guia: 3–5 stories (≥1 interativo), 20 comentários
 * no nicho, responder 100%, seguir 10–15 contas. Tudo registro manual — a API do
 * Instagram não expõe nada disto.
 */
export function presenceRoutine(
  rows: { date: string; storiesPosted?: number; storiesInteractive?: number; nicheComments?: number; accountsFollowed?: number; repliedAll?: boolean }[],
): PresenceRoutine {
  const comRegistro = rows.filter(
    (r) =>
      r.storiesPosted != null ||
      r.nicheComments != null ||
      r.accountsFollowed != null ||
      r.repliedAll != null,
  );
  const uteis = comRegistro.filter((r) => isWeekday(r.date));
  return {
    diasComRegistro: comRegistro.length,
    diasUteis: uteis.length,
    storiesPorDia: avg(comRegistro.map((r) => r.storiesPosted ?? 0)),
    diasUteisSemStory: uteis.filter((r) => (r.storiesPosted ?? 0) === 0).length,
    comentariosPorDia: avg(comRegistro.map((r) => r.nicheComments ?? 0)),
    seguidasPorDia: avg(comRegistro.map((r) => r.accountsFollowed ?? 0)),
    respondeuTudoPct: div(comRegistro.filter((r) => r.repliedAll).length, comRegistro.length),
    temDados: comRegistro.length > 0,
  };
}
