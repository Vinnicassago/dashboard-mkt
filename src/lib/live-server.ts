import "server-only";
import { getState } from "./data/store";
import { STATE_KEYS } from "./data/backend";
import { lerCampanhaDaLive, type CampanhaDaLive } from "./live";

/** A campanha da live como está salva (Configurações → Metas e orçamento); sem nada salvo, o briefing. */
export async function campanhaDaLive(): Promise<CampanhaDaLive> {
  return lerCampanhaDaLive(await getState<unknown>(STATE_KEYS.campanhaDaLive));
}
