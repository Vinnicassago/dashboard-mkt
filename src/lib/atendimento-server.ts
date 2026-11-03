import "server-only";
import { proximaPelaCadencia } from "./contato";

/**
 * A cadência que vale para a próxima tentativa sem conversa. Carregada no
 * servidor porque vai depender do turno configurado em Configurações.
 */
export async function cadenciaDoAtendimento(): Promise<(ocorreuEm: string, n: number) => string | undefined> {
  return proximaPelaCadencia;
}
