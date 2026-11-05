import "server-only";
import { comTravaDaPessoa, getState, listLeadEvents, listLeads, setState } from "../data/store";
import { STATE_KEYS } from "../data/backend";
import { DEFAULT_BRAND } from "../types";
import { avisarResgate, avisoDeResgateConfigurado } from "../avisos";
import { montarFila } from "../fila";
import { estadoDoRoboAgora } from "./estado";
import {
  estadoDepoisDoAviso,
  lerEstadoAvisoResgate,
  planejarAvisoResgate,
  type EsperaDoAviso,
} from "./aviso-resgate";

/**
 * O aviso de resgate ao n8n, de verdade: lê o estado, monta a Fila com a MESMA
 * `montarFila` e o MESMO `estadoDoRoboAgora` da página, planeja
 * (`planejarAvisoResgate`, puro), envia e só então marca quem foi avisado.
 *
 * Chamado no fim de um sync do robô que DEU CERTO, de origem cron ou manual (a
 * carona nunca avisa) — `lib/robo/sync.ts`. Serializado entre processos com
 * `comTravaDaPessoa("aviso:resgate")`: o cron e o "Sincronizar agora" juntos não
 * avisam duas vezes. Sem `N8N_RESGATE_WEBHOOK_URL`, não faz nada (nem toca o
 * store). NUNCA lança: o sync já gravou o que importava.
 */
export interface ResultadoAvisoResgate {
  /** Avisou o n8n agora? */
  enviado: boolean;
  /** Quantas entradas novas foram (ou seriam) avisadas. */
  novos: number;
  /** Quantas pessoas estão no grupo Resgate da Fila agora (o número do corpo do aviso). */
  total: number;
  /** Por que não enviou. */
  espera?: EsperaDoAviso | "desligado" | "falhou";
}

export async function avisarResgateSePreciso(agora: string = new Date().toISOString()): Promise<ResultadoAvisoResgate> {
  const nada: ResultadoAvisoResgate = { enviado: false, novos: 0, total: 0, espera: "desligado" };
  if (!avisoDeResgateConfigurado()) return nada;
  try {
    return await comTravaDaPessoa("aviso:resgate", async () => {
      const robo = await estadoDoRoboAgora(DEFAULT_BRAND, new Date(agora));
      if (!robo.ligado) return nada;
      const [leads, eventos, bruto] = await Promise.all([
        listLeads(DEFAULT_BRAND),
        listLeadEvents({ brand: DEFAULT_BRAND, limit: 0 }),
        getState<unknown>(STATE_KEYS.avisoResgate),
      ]);
      const antes = lerEstadoAvisoResgate(bruto);
      const fila = montarFila({ nowIso: agora, leads, eventos, robo });
      const plano = planejarAvisoResgate({ naFila: fila.entradasDeResgate, estado: antes, agora });
      // O número do corpo é o do grupo que o link abre (um fato, um número): o
      // Resgate da MESMA Fila — com "não compareceu" e "retorno", sem quem a
      // cadência escondeu agora.
      const noResgate = fila.grupos.find((g) => g.etapa === "resgate")?.total ?? 0;

      let enviado = false;
      let depois = plano.estado;
      if (plano.enviar.length > 0) {
        // Envia → marca: uma falha no envio não marca ninguém (repete na próxima rodada).
        enviado = await avisarResgate({ marca: DEFAULT_BRAND, itens: plano.enviar, total: noResgate, agora });
        depois = estadoDepoisDoAviso(plano, { ok: enviado, agora });
      }
      // Só grava o que mudou (o cron roda a cada 15 min; `app_state` vai inteiro no getData do Postgres).
      if (JSON.stringify(depois) !== JSON.stringify(antes)) {
        try {
          await setState(STATE_KEYS.avisoResgate, depois);
        } catch (e) {
          // Enviado e não marcado: a próxima rodada avisa de novo (melhor que perder).
          console.error("[aviso] não consegui gravar o estado do aviso de resgate:", e instanceof Error ? e.message : e);
        }
      }
      return {
        enviado,
        novos: plano.enviar.length,
        total: noResgate,
        espera: plano.enviar.length === 0 ? (plano.espera ?? undefined) : enviado ? undefined : "falhou",
      };
    });
  } catch (e) {
    console.warn("[aviso] o aviso de resgate falhou:", e instanceof Error ? e.message : e);
    return { ...nada, espera: "falhou" };
  }
}
