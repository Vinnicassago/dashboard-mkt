/**
 * Validador de peça — o "Checklist antes de publicar" do guia, em código.
 *
 * PURO: recebe o rascunho e um contexto já resolvido, devolve bloqueios e
 * avisos. Sem I/O, sem IA, sem rede — roda no servidor e no cliente (validação
 * ao vivo enquanto se digita) e é trivial de testar.
 *
 * Divisão de responsabilidade que sustenta a Etapa 2:
 *   • AQUI mora tudo que é verificável mecanicamente (contagem, limite, regex,
 *     posição no ciclo de CTA). Nunca alucina, custa zero, responde na hora.
 *   • Na IA fica só o julgamento que regex não faz: o gancho cria tensão ou
 *     anuncia o tema? Soa como locutor de anúncio? A promessa é concreta?
 *
 * `bloqueio` = falhou item do checklist ou um "Nunca mais" → não publica.
 * `aviso`    = fora do padrão recomendado → publica, mas o guia pede atenção.
 */

import type { CtaType, PostDraft } from "../types";
import {
  ABERTURAS_PROIBIDAS,
  CARROSSEL,
  CTA_CYCLE,
  LEGENDA,
  PILARES_PROIBIDOS,
  PLAYBOOK_VERSION,
  REEL,
  SEO_TERMS,
  nextCtaInCycle,
  slotForWeekday,
  weekdayOf,
} from "./playbook";

export type IssueSeverity = "bloqueio" | "aviso";

export interface ValidationIssue {
  /** Casa com `CHECKLIST[].id` do playbook quando é item do checklist. */
  id: string;
  severity: IssueSeverity;
  /** A regra do guia, curta — para a UI citar a fonte. */
  rule: string;
  /** O que fazer para resolver. */
  message: string;
}

export interface ValidationResult {
  /** 0–100. Só orienta prioridade; quem decide publicar é `ready`. */
  score: number;
  /** Zero bloqueios. */
  ready: boolean;
  issues: ValidationIssue[];
  /** Ids do checklist cumpridos (a UI marca em verde). */
  passed: string[];
  /** O CTA que o ciclo de 4 pede para esta peça. */
  ctaExpected: CtaType;
  playbookVersion: string;
}

export interface ValidationContext {
  /**
   * CTAs das últimas peças (publicadas + agendadas), do mais RECENTE para o
   * mais antigo. É o que permite dizer "o CTA da vez é salvamento" em vez de só
   * medir a média do período.
   */
  recentCtas: (CtaType | undefined)[];
  /** Dias (yyyy-mm-dd) já ocupados por OUTRA peça — publicada ou agendada. */
  occupiedDays: string[];
}

// ---- helpers de texto -----------------------------------------------

/** Minúsculas e sem acento — só para COMPARAR (o texto exibido nunca muda). */
export const normalizeText = (v: string) =>
  v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const words = (v: string) => v.trim().split(/\s+/).filter(Boolean);

const isBlank = (v?: string) => !v || v.trim() === "";

/**
 * Tem número ou comparação concreta? Aceita valor em reais, percentual, prazo,
 * múltiplo ("3x") ou qualquer número de 3+ dígitos. Um "1" solto não conta —
 * o guia pede uma CONTA, não um dígito.
 */
const CONCRETE_NUMBER =
  /(r\$\s*[\d.,]+)|([\d.,]+\s*(mil|milh|reais|%|anos?|meses|parcelas?|vezes|x\b))|(\d{3,})/i;

/** Primeira linha da legenda — a que sobrevive ao corte do "… mais". */
export function firstLine(caption: string): string {
  return caption.split(/\r?\n/)[0]?.trim() ?? "";
}

/** Termo de busca do nicho presente na legenda (SEO). */
export function seoTermIn(caption: string): string | undefined {
  const c = normalizeText(caption);
  return SEO_TERMS.find((t) => c.includes(normalizeText(t)));
}

/** Abertura de introdução disfarçada no gancho falado. */
export function bannedOpeningIn(spoken: string): string | undefined {
  const s = normalizeText(spoken);
  return ABERTURAS_PROIBIDAS.find((a) => s.startsWith(normalizeText(a)) || s.includes(normalizeText(a)));
}

// ---- o validador ----------------------------------------------------

/** Peso de cada severidade na nota. Bloqueio pesa ~3× um aviso. */
const PESO: Record<IssueSeverity, number> = { bloqueio: 18, aviso: 6 };

export function validateDraft(draft: PostDraft, ctx: ValidationContext): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (i: ValidationIssue) => issues.push(i);

  const isReel = draft.type === "reel";
  const isCarrossel = draft.type === "carrossel";
  // Story não passa pelo checklist de feed do guia (a grade trata story como
  // rotina de presença, não como peça) — validação mínima.
  const isStory = draft.type === "story";

  const ctaExpected = nextCtaInCycle(ctx.recentCtas);

  // ---- 1. Gancho (teste do áudio) ----------------------------------
  if (isBlank(draft.hookText)) {
    add({
      id: "gancho",
      severity: "bloqueio",
      rule: "Gancho falado + escrito nos 2 primeiros segundos",
      message: "Escreva o texto de tela do gancho (máx. 7 palavras).",
    });
  } else {
    const n = words(draft.hookText).length;
    if (n > REEL.hookMaxWords) {
      add({
        id: "gancho",
        severity: "bloqueio",
        rule: `Texto de tela do gancho: máx. ${REEL.hookMaxWords} palavras`,
        message: `O texto de tela tem ${n} palavras. Corte para ${REEL.hookMaxWords} — quem assiste no mudo lê em 1 segundo.`,
      });
    }
  }

  if (isBlank(draft.hookSpoken)) {
    if (!isStory) {
      add({
        id: "gancho",
        severity: "bloqueio",
        rule: "1ª frase = gancho",
        message: "Escreva o gancho falado — é ele que passa (ou não) no teste do áudio.",
      });
    }
  } else {
    const banned = bannedOpeningIn(draft.hookSpoken);
    if (banned) {
      add({
        id: "gancho",
        severity: "bloqueio",
        rule: "Sem introdução, sem “oi, pessoal”",
        message: `O gancho começa com “${banned}” — isso é introdução, não gancho. Entre direto no conflito.`,
      });
    }
  }

  if (isReel && isBlank(draft.promise)) {
    add({
      id: "gancho",
      severity: "aviso",
      rule: "Seg. 2–5: promessa do que a pessoa leva",
      message: "Falta a 2ª frase — diga em uma linha o que a pessoa leva se ficar até o fim.",
    });
  }

  // ---- 2. Duração ---------------------------------------------------
  if (isReel) {
    if (draft.durationSec == null) {
      add({
        id: "duracao",
        severity: "aviso",
        rule: "≤25 segundos",
        message: "Informe a duração planejada — sem ela não dá para acompanhar a retenção real depois.",
      });
    } else if (draft.durationSec > REEL.hardMaxDurationSec) {
      add({
        id: "duracao",
        severity: "bloqueio",
        rule: `Nunca mais: reel acima de ${REEL.hardMaxDurationSec}s`,
        message: `${draft.durationSec}s. Corte para no máximo ${REEL.maxDurationSec}s — formato longo só quando a retenção média passar de 40%.`,
      });
    } else if (draft.durationSec > REEL.maxDurationSec) {
      add({
        id: "duracao",
        severity: "aviso",
        rule: `≤${REEL.maxDurationSec} segundos`,
        message: `${draft.durationSec}s está acima do teto de ${REEL.maxDurationSec}s. Corte a introdução.`,
      });
    }

    // A série do dia tem alvo próprio, mais apertado que o teto geral.
    const slot = draft.plannedFor ? slotForWeekday(weekdayOf(draft.plannedFor)) : undefined;
    if (slot?.targetSec && draft.durationSec != null && draft.durationSec > slot.targetSec) {
      add({
        id: "duracao",
        severity: "aviso",
        rule: `${slot.pillar}: ${slot.targetSec}s`,
        message: `A série “${slot.pillar}” roda em ${slot.targetSec}s; esta peça tem ${draft.durationSec}s.`,
      });
    }
  }

  // ---- 3. Número ou comparação concreta -----------------------------
  const corpo = [draft.hookText, draft.hookSpoken, draft.promise, draft.script, draft.caption]
    .filter(Boolean)
    .join("\n");
  if (!isStory && !CONCRETE_NUMBER.test(corpo)) {
    add({
      id: "numero",
      severity: "bloqueio",
      rule: "Tem número ou comparação concreta?",
      message: "Nenhum valor, prazo ou comparação na peça. Traga a conta — é ela que segura o espectador.",
    });
  }

  // ---- 4. Legenda embutida + palavra-chave --------------------------
  if (isReel && !draft.hasBurnedCaptions) {
    add({
      id: "legenda-embutida",
      severity: "bloqueio",
      rule: "Legenda embutida no vídeo inteiro",
      message: "85% assistem no mudo. Marque a legenda embutida antes de publicar.",
    });
  }

  // "Nunca mais: post sem palavra-chave na legenda" — aqui é o termo de BUSCA
  // (SEO), distinto da palavra-chave do CTA de comentário, tratada adiante.
  if (!isStory) {
    if (isBlank(draft.caption)) {
      add({
        id: "legenda-embutida",
        severity: "bloqueio",
        rule: "Nunca mais: post sem palavra-chave na legenda",
        message: "Escreva a legenda com pelo menos um termo de busca do nicho.",
      });
    } else if (!seoTermIn(draft.caption)) {
      add({
        id: "legenda-embutida",
        severity: "bloqueio",
        rule: "Nunca mais: post sem palavra-chave na legenda",
        message: `Nenhum termo de busca na legenda. Use um destes: ${SEO_TERMS.slice(0, 4).join(", ")}.`,
      });
    }
  }

  // ---- 5. CTA da vez ------------------------------------------------
  if (!isStory) {
    if (!draft.ctaType) {
      add({
        id: "cta-da-vez",
        severity: "bloqueio",
        rule: "Rotação de CTA",
        message: `Defina o CTA. Pelo ciclo, o da vez é “${ctaExpected}”.`,
      });
    } else {
      if (draft.ctaType !== ctaExpected && CTA_CYCLE.includes(draft.ctaType)) {
        add({
          id: "cta-da-vez",
          severity: "aviso",
          rule: "Rotação de CTA (ciclo de 4)",
          message: `O CTA da vez é “${ctaExpected}”, não “${draft.ctaType}”. Sair do ciclo concentra o pedido num tipo só.`,
        });
      }
      // "Nunca mais: pedir DM em todo post" — o teto é 1 a cada 4.
      if (draft.ctaType === "dm") {
        const janela = ctx.recentCtas.slice(0, CTA_CYCLE.length - 1);
        const dmRecentes = janela.filter((c) => c === "dm").length;
        if (dmRecentes > 0) {
          const quantos = dmRecentes === 1 ? "1 pedido" : `${dmRecentes} pedidos`;
          const quando = janela.length === 1 ? "na peça anterior" : `nas últimas ${janela.length} peças`;
          add({
            id: "cta-da-vez",
            severity: "bloqueio",
            rule: "Nunca mais: pedir DM em todo post",
            message: `Já houve ${quantos} de DM ${quando}. DM no máximo 1 a cada ${CTA_CYCLE.length} posts.`,
          });
        }
      }
      // Sem palavra-chave, o CTA de comentário não vira fila de leads nem
      // automação de DM (Fase 3 do plano).
      if (draft.ctaType === "comentario" && isBlank(draft.ctaKeyword)) {
        add({
          id: "cta-da-vez",
          severity: "bloqueio",
          rule: "Comentário com palavra-chave",
          message: "Defina a palavra-chave do comentário (ex.: SIMULA) — é o gatilho da automação de DM.",
        });
      }
      if (draft.ctaKeyword && !normalizeText(draft.caption).includes(normalizeText(draft.ctaKeyword))) {
        add({
          id: "cta-da-vez",
          severity: "bloqueio",
          rule: "Comentário com palavra-chave",
          message: `A palavra-chave “${draft.ctaKeyword}” não aparece na legenda. Sem ela, ninguém sabe o que comentar.`,
        });
      }
    }
  }

  // ---- 6. 1ª linha sobrevive ao "… mais" ----------------------------
  if (!isStory && !isBlank(draft.caption)) {
    const l1 = firstLine(draft.caption);
    if (l1.length > LEGENDA.primeiraLinhaMaxChars) {
      add({
        id: "primeira-linha",
        severity: "bloqueio",
        rule: "1ª linha sobrevive ao corte do “… mais”",
        message: `A 1ª linha tem ${l1.length} caracteres. Corte para ${LEGENDA.primeiraLinhaMaxChars} — o resto some atrás do “… mais”.`,
      });
    }
  }

  // ---- 7. Única peça do dia -----------------------------------------
  if (draft.plannedFor && ctx.occupiedDays.includes(draft.plannedFor)) {
    add({
      id: "unica-do-dia",
      severity: "bloqueio",
      rule: "Nunca mais: publicar 2+ peças no mesmo dia",
      message: "Já existe outra peça neste dia. Duas peças disputam a mesma janela de teste do algoritmo.",
    });
  }

  // ---- extras do guia (fora dos 7 itens) ----------------------------

  // Card de frase: o pior formato do perfil, com folga.
  if (draft.pillar && PILARES_PROIBIDOS.test(draft.pillar)) {
    add({
      id: "pilar",
      severity: "bloqueio",
      rule: "Nunca mais: card de frase motivacional",
      message: "Troque por carrossel de método ou prova social (bastidor).",
    });
  }

  // Aderência à grade semanal.
  if (draft.plannedFor) {
    const slot = slotForWeekday(weekdayOf(draft.plannedFor));
    if (slot && slot.type === null) {
      add({
        id: "grade",
        severity: "aviso",
        rule: `${slot.label}: sem feed`,
        message: `${slot.note}. Publicar feed neste dia sai da grade.`,
      });
    } else if (slot && slot.type !== draft.type) {
      add({
        id: "grade",
        severity: "aviso",
        rule: `Grade semanal — ${slot.label}`,
        message: `A grade pede ${slot.type}${slot.pillar ? ` (${slot.pillar})` : ""} neste dia; esta peça é ${draft.type}.`,
      });
    } else if (slot?.pillar && draft.pillar && draft.pillar !== slot.pillar) {
      add({
        id: "grade",
        severity: "aviso",
        rule: `Grade semanal — ${slot.label}`,
        message: `A série do dia é “${slot.pillar}”; esta peça está marcada como “${draft.pillar}”.`,
      });
    }
  }

  // Roteiro/slides.
  if (isBlank(draft.script) && !isStory) {
    add({
      id: "roteiro",
      severity: "bloqueio",
      rule: "Corpo: método direto, sem enrolar",
      message: isCarrossel ? "Escreva os slides (um por linha)." : "Escreva o roteiro do reel.",
    });
  }

  // Carrossel: o último slide fecha em salvamento + palavra-chave.
  if (isCarrossel && draft.ctaType && draft.ctaType !== CARROSSEL.ctaFinal) {
    add({
      id: "carrossel",
      severity: "aviso",
      rule: "Carrossel: último slide = CTA de salvamento",
      message: `O padrão de carrossel fecha em salvamento; esta peça pede “${draft.ctaType}”.`,
    });
  }

  // ---- resultado ----------------------------------------------------
  const bloqueios = issues.filter((i) => i.severity === "bloqueio");
  const penalidade = issues.reduce((sum, i) => sum + PESO[i.severity], 0);
  const score = Math.max(0, Math.min(100, 100 - penalidade));
  const failed = new Set(issues.map((i) => i.id));

  return {
    score,
    ready: bloqueios.length === 0,
    issues: issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "bloqueio" ? -1 : 1)),
    passed: CHECKLIST_IDS.filter((id) => !failed.has(id)),
    ctaExpected,
    playbookVersion: PLAYBOOK_VERSION,
  };
}

/** Ids do checklist do guia, na ordem — usado para o "passou / falta". */
const CHECKLIST_IDS = [
  "gancho",
  "duracao",
  "numero",
  "legenda-embutida",
  "cta-da-vez",
  "primeira-linha",
  "unica-do-dia",
];

/**
 * Monta o contexto de validação a partir do que já existe no painel: os CTAs das
 * últimas peças (publicadas e agendadas, em ordem cronológica reversa) e os dias
 * já ocupados. Puro — quem busca os dados é a página.
 */
export function buildValidationContext(input: {
  /** Peças publicadas, mais recente primeiro: `{ day, cta }`. */
  published: { day: string; cta?: CtaType }[];
  /** Outros rascunhos agendados (exclui o que está sendo validado). */
  drafts: { day?: string; cta?: CtaType; status: PostDraft["status"] }[];
}): ValidationContext {
  const agendados = input.drafts.filter((d) => d.status !== "descartado");

  // Ordem cronológica reversa juntando os dois universos: o "CTA da vez" tem de
  // considerar o que está na fila, não só o que já foi ao ar.
  const linha = [
    ...agendados.filter((d) => d.day).map((d) => ({ day: d.day!, cta: d.cta })),
    ...input.published.map((p) => ({ day: p.day, cta: p.cta })),
  ].sort((a, b) => b.day.localeCompare(a.day));

  return {
    recentCtas: linha.map((l) => l.cta),
    occupiedDays: [
      ...new Set([
        ...input.published.map((p) => p.day),
        ...agendados.filter((d) => d.day).map((d) => d.day!),
      ]),
    ],
  };
}
