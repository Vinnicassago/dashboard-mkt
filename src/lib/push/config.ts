import "server-only";

/**
 * As chaves dos avisos de lead novo (Web Push). Separado de `enviar.ts` para o layout
 * e Integrações lerem a configuração sem carregar a biblioteca de envio.
 *   • VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY — `npx web-push generate-vapid-keys`; a
 *     pública vai ao navegador (para ele se inscrever), a privada assina cada envio
 *     e nunca sai do servidor;
 *   • VAPID_SUBJECT — contato do painel para o serviço de push (`https://…` ou
 *     `mailto:…`); sem ela, o PAINEL_URL quando é https.
 * Sem as duas chaves, nada acontece (o sino nem aparece).
 */

export interface ConfigDoPush {
  publica: string;
  privada: string;
  assunto: string;
}

function assuntoDoPush(): string {
  const assunto = process.env.VAPID_SUBJECT?.trim();
  if (assunto) return assunto;
  const painel = process.env.PAINEL_URL?.trim().replace(/\/$/, "");
  if (painel?.startsWith("https://")) return painel;
  // Só para desenvolvimento: em produção, defina VAPID_SUBJECT (a Apple confere o formato).
  return "mailto:avisos@example.com";
}

export function configDoPush(): ConfigDoPush | null {
  const publica = process.env.VAPID_PUBLIC_KEY?.trim();
  const privada = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publica || !privada) return null;
  return { publica, privada, assunto: assuntoDoPush() };
}

/** Há chaves VAPID? (Integrações, a rota da inscrição e o sino do cabeçalho.) */
export const pushConfigurado = (): boolean => configDoPush() !== null;

/** A chave PÚBLICA (vai ao navegador); `null` sem configuração. */
export const chavePublicaDoPush = (): string | null => configDoPush()?.publica ?? null;
