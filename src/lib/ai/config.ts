import "server-only";

/**
 * Configuração da camada de IA. Mesma disciplina do `meta/config.ts`: sem
 * credencial o recurso simplesmente não existe — o painel funciona igual e os
 * botões de IA não aparecem, em vez de quebrar na cara de quem usa.
 *
 * Tudo é lido em tempo de chamada (não no import) para o env valer sem rebuild.
 */

/** A camada de IA está ligada? */
export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/**
 * Modelo do revisor de peça. Opus 5 por padrão: julgar gancho é a parte cara do
 * trabalho e o volume é baixo (~6 peças/semana). Trocar por `claude-sonnet-5`
 * via env corta custo se o volume crescer.
 */
export function reviewModel(): string {
  return process.env.AI_MODEL_REVIEW?.trim() || "claude-opus-5";
}

/** Modelo do analista semanal (Etapa 3). */
export function analystModel(): string {
  return process.env.AI_MODEL_ANALYST?.trim() || "claude-opus-5";
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

function effortFrom(raw: string | undefined, fallback: Effort): Effort {
  const v = raw?.trim() as Effort | undefined;
  return v && EFFORTS.includes(v) ? v : fallback;
}

/**
 * Esforço do revisor. `medium` é o padrão: é um julgamento único e bem
 * delimitado (não é raciocínio longo nem agente), e nesse patamar o modelo
 * responde rápido e barato sem perder qualidade no que importa aqui.
 */
export function reviewEffort(): Effort {
  return effortFrom(process.env.AI_EFFORT_REVIEW, "medium");
}

export function analystEffort(): Effort {
  return effortFrom(process.env.AI_EFFORT_ANALYST, "high");
}
