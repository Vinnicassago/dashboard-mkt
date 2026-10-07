import "server-only";
import { addAuditEntry } from "./data/store";
import { currentActor, newEventId } from "./auth/actor";

/**
 * Registra quem apertou um botão que mexe em muitos dados de uma vez. Falha
 * aqui não desfaz a ação (que já aconteceu) — vai para o log do servidor.
 */
export async function registrarAuditoria(action: string, detail?: string): Promise<void> {
  try {
    await addAuditEntry({
      id: newEventId(),
      at: new Date().toISOString(),
      actor: await currentActor(),
      action,
      detail,
    });
  } catch (e) {
    console.error(`[auditoria] não registrei "${action}":`, e);
  }
}
