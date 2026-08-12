import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./client";
import { reviewEffort, reviewModel } from "./config";
import { reviewSystemPrompt } from "./playbook-prompt";
import { PLAYBOOK_VERSION } from "../content/playbook";
import type { ValidationResult } from "../content/validator";
import { CTA_LABEL } from "../metrics";
import type { AiReview, PostDraft } from "../types";

/**
 * Revisor de peça (Etapa 2). Recebe o rascunho + o veredito mecânico e devolve
 * o JULGAMENTO que regex não faz, em JSON validado pela própria API.
 *
 * Princípios que não mudam:
 *   • O modelo não calcula nada. Nenhum KPI, nenhuma contagem — isso é do
 *     validador. Ele interpreta texto.
 *   • Nenhum dado de lead (nome/e-mail/telefone) entra no prompt. Só a peça.
 *   • O conselho volta marcado com modelo e data: a UI mostra que é IA.
 */

const JUDGEMENT = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    porque: { type: "string" },
  },
  required: ["ok", "porque"],
  additionalProperties: false,
} as const;

/**
 * Structured outputs garante a forma. Sem `minItems`/`maxItems` (a API não
 * suporta restrição numérica de array) — a quantidade é pedida no prompt e
 * cortada no código.
 */
const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    veredito: { type: "string", enum: ["aprova", "ajusta", "refaz"] },
    resumo: { type: "string" },
    testeDoAudio: JUDGEMENT,
    ganchoCriaTensao: JUDGEMENT,
    promessaConcreta: JUDGEMENT,
    numeroEspecifico: JUDGEMENT,
    fechaEmReplay: JUDGEMENT,
    ganchosAlternativos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          molde: { type: "string" },
          textoDeTela: { type: "string" },
          falado: { type: "string" },
        },
        required: ["molde", "textoDeTela", "falado"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "veredito",
    "resumo",
    "testeDoAudio",
    "ganchoCriaTensao",
    "promessaConcreta",
    "numeroEspecifico",
    "fechaEmReplay",
    "ganchosAlternativos",
  ],
  additionalProperties: false,
} as const;

/** A peça, delimitada. Só campos editoriais — nada de id, marca ou métrica. */
function draftAsText(draft: PostDraft): string {
  const linhas = [
    `formato: ${draft.type}`,
    draft.pillar ? `série: ${draft.pillar}` : null,
    draft.durationSec ? `duração planejada: ${draft.durationSec}s` : null,
    draft.ctaType ? `CTA: ${CTA_LABEL[draft.ctaType]}` : null,
    draft.ctaKeyword ? `palavra-chave: ${draft.ctaKeyword}` : null,
    "",
    `TEXTO DE TELA DO GANCHO: ${draft.hookText || "(vazio)"}`,
    `GANCHO FALADO: ${draft.hookSpoken || "(vazio)"}`,
    `PROMESSA (2ª frase): ${draft.promise || "(vazio)"}`,
    "",
    `ROTEIRO:\n${draft.script || "(vazio)"}`,
    "",
    `LEGENDA:\n${draft.caption || "(vazio)"}`,
  ].filter((l) => l !== null);
  return linhas.join("\n");
}

/** O que o validador já apontou — para a IA não repetir nem contradizer. */
function validationAsText(v: ValidationResult): string {
  if (v.issues.length === 0) return "Nenhum problema mecânico. Nota 100/100.";
  return [
    `Nota mecânica: ${v.score}/100 · ${v.ready ? "sem bloqueios" : "com bloqueios"}.`,
    ...v.issues.map((i) => `- [${i.severity}] ${i.rule}: ${i.message}`),
  ].join("\n");
}

export async function reviewDraft(
  draft: PostDraft,
  validation: ValidationResult,
): Promise<AiReview> {
  const model = reviewModel();

  const message = await anthropic().messages.create({
    model,
    max_tokens: 4000,
    system: [
      {
        type: "text",
        text: reviewSystemPrompt(),
        // O playbook é idêntico em toda chamada — cacheia e o custo do prefixo
        // cai ~10× a partir da segunda revisão dentro da janela.
        cache_control: { type: "ephemeral" },
      },
    ],
    output_config: {
      effort: reviewEffort(),
      format: { type: "json_schema", schema: REVIEW_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: `<peca>\n${draftAsText(draft)}\n</peca>\n\n<validacao-mecanica>\n${validationAsText(
          validation,
        )}\n</validacao-mecanica>\n\nRevise a peça acima e devolva o JSON no formato pedido. Exatamente 3 reescritas de gancho, cada uma com um molde diferente.`,
      },
    ],
  });

  // Classificadores de segurança podem recusar (HTTP 200 + stop_reason). Sem
  // este ramo, o parse abaixo estouraria com um erro sem sentido para quem usa.
  if (message.stop_reason === "refusal") {
    throw new Error(
      "A API recusou revisar esta peça por política de conteúdo. Revise o texto e tente de novo.",
    );
  }

  const json = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  if (!json.trim()) {
    throw new Error(
      message.stop_reason === "max_tokens"
        ? "A resposta foi cortada por tamanho. Encurte o roteiro e tente de novo."
        : "A API devolveu uma resposta vazia.",
    );
  }

  let parsed: Omit<AiReview, "modelo" | "criadoEm" | "playbookVersion">;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Não consegui interpretar a resposta da IA.");
  }

  return {
    ...parsed,
    // No máximo 3 — a API não impõe tamanho de array, o prompt pede e aqui corta.
    ganchosAlternativos: (parsed.ganchosAlternativos ?? []).slice(0, 3),
    modelo: message.model || model,
    criadoEm: new Date().toISOString(),
    playbookVersion: PLAYBOOK_VERSION,
  };
}
