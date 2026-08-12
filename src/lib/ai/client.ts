import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { isAiConfigured } from "./config";

/**
 * Cliente da API da Claude. Instância única por processo (o SDK já cuida de
 * keep-alive e retries: 2 tentativas em 429/5xx por padrão).
 *
 * A chave vem de `ANTHROPIC_API_KEY` no ambiente — o SDK a lê sozinho; nunca
 * passe a chave por parâmetro nem a registre em log.
 */
let cached: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!isAiConfigured()) {
    throw new Error("ANTHROPIC_API_KEY não configurada — a revisão por IA está desligada.");
  }
  if (!cached) cached = new Anthropic();
  return cached;
}

/** Erro da API traduzido para uma frase que cabe na UI, sem vazar detalhe interno. */
export function aiErrorMessage(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) {
    return "Chave da API inválida — confira ANTHROPIC_API_KEY no .env.local.";
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return "A chave não tem permissão para este modelo.";
  }
  if (e instanceof Anthropic.RateLimitError) {
    return "Limite de uso atingido — tente de novo em alguns instantes.";
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return "Não consegui falar com a API da Claude (rede). Tente de novo.";
  }
  // APIConnectionError estende APIError no SDK TS, por isso vem antes.
  if (e instanceof Anthropic.APIError) {
    // Falta de crédito chega como 400/403 com mensagem própria — vale mostrar.
    return `A API recusou a chamada (${e.status ?? "sem status"}): ${e.message}`;
  }
  return e instanceof Error ? e.message : "Falha inesperada na revisão por IA.";
}
