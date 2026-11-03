import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * A API do n8n só aceita chamadas com o token de `N8N_API_TOKEN` (variável de
 * ambiente — nunca no código). Vai no cabeçalho `Authorization: Bearer <token>`
 * (ou `x-api-key`). Sem a variável, a API fica desligada (503), não aberta.
 */
export type Autorizacao = "ok" | "desligada" | "negada";

const digest = (s: string) => createHash("sha256").update(s).digest();

export function autorizarN8n(request: Request): Autorizacao {
  const esperado = process.env.N8N_API_TOKEN?.trim();
  if (!esperado) return "desligada";
  const bearer = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]?.trim();
  const recebido = bearer || request.headers.get("x-api-key")?.trim() || "";
  if (!recebido) return "negada";
  // Comparação em tempo constante sobre o hash (mesmo tamanho dos dois lados).
  return timingSafeEqual(digest(recebido), digest(esperado)) ? "ok" : "negada";
}
