import "server-only";
import { getState } from "./data/store";
import { STATE_KEYS } from "./data/backend";
import { proximaPelaCadencia } from "./contato";
import { classeDoLead } from "./qualificacao";
import { lerExpediente, proximaTentativaDoTurno, type Expediente } from "./turno";
import type { Lead } from "./types";

/** O expediente que vale agora (Configurações → Atendimento); sem nada salvo, o padrão do briefing. */
export async function expedienteAtual(): Promise<Expediente> {
  return lerExpediente(await getState<unknown>(STATE_KEYS.expediente));
}

/**
 * A cadência da próxima tentativa sem conversa para ESTE lead: os da ficha da
 * live (com classe) seguem o turno; os de antes, a cadência de sempre.
 */
export async function cadenciaPara(lead: Lead): Promise<(ocorreuEm: string, n: number) => string | undefined> {
  if (!classeDoLead(lead)) return proximaPelaCadencia;
  const cfg = await expedienteAtual();
  return (ocorreuEm, n) => proximaTentativaDoTurno(ocorreuEm, n, cfg);
}
