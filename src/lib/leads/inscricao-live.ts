import "server-only";
import { marcarInscricaoNaLive } from "../data/store";
import { campanhaDaLive } from "../live-server";
import { inicioDaLive, type CampanhaDaLive } from "../live";

/**
 * Grava a inscrição na live de um lead que JÁ EXISTIA (a API do n8n e a página com
 * as respostas — o cadastro novo já nasce com `inscritoLiveEm`): vazia ou de antes
 * do período da live → a hora desta inscrição; dentro do período, vale a 1ª.
 * `createdAt` nunca muda. Devolve se gravou e a campanha (o nome vai no histórico).
 */
export async function registrarInscricaoNaLive(
  leadId: string,
  em: string,
): Promise<{ marcou: boolean; cfg: CampanhaDaLive }> {
  const cfg = await campanhaDaLive();
  const marcou = await marcarInscricaoNaLive(leadId, new Date(em).toISOString(), inicioDaLive(cfg));
  return { marcou, cfg };
}

/**
 * O histórico do reenvio que É a inscrição na live de quem já era lead: a linha do
 * tempo diz "Inscreveu-se na live 01/12 (já era lead desde DD/MM)".
 */
export const payloadDaReinscricao = (cfg: Pick<CampanhaDaLive, "nome">, leadDesde: string) => ({
  inscricaoLive: cfg.nome,
  leadDesde,
});
