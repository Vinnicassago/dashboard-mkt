/**
 * O plano do aviso de resgate ao n8n — PURO, sem I/O (quem envia e grava é
 * `lib/robo/avisar-resgate.ts`).
 *
 * Regras (§5 + 11.14):
 *  - `naFila` = as entradas no resgate PELO ROBÔ que a MESMA `montarFila` dá
 *    (`entradasDeResgate`), só os motivos avisáveis — inclusive quem a cadência
 *    humana escondeu do grupo agora (isso não é saída do resgate);
 *  - a chave do avisado é a ENTRADA no resgate: `<leadId>:<motivo>:<desde>`. Cada
 *    entrada gera UM aviso; sair e voltar (respondeu e esfriou de novo, mudou de
 *    motivo, foi reaberto) é entrada nova = aviso novo;
 *  - `avisados` é podado para ∩ naFila a cada rodada (inclusive fora do horário):
 *    só some quando a entrada não existe mais;
 *  - envia só se há novos, no horário comercial (seg–sex 9h–18h, Brasília) e com
 *    ≥ 15 min desde o último envio (com a folga de `FOLGA_JANELA_AVISO_MIN`: uma
 *    rodada do cron por envio, nunca uma sim, outra não); fora do horário acumula
 *    e sai tudo junto na 1ª rodada do expediente;
 *  - ordem envia → marca: falha no envio não marca ninguém (repete na janela
 *    seguinte) e guarda `ultimaFalha`.
 */
import { noHorarioComercial, type HorarioComercial } from "../horario-util";
import { MOTIVOS_AVISAVEIS, type ResgateMotivo } from "./situacao";

/** Intervalo mínimo entre dois envios. */
export const JANELA_AVISO_RESGATE_MIN = 15;
/**
 * Folga da janela: o cron também roda a cada 15 min e o envio é medido pelo FIM de
 * cada sync — um sync mais curto que o anterior (ou o cron-job.org adiantado uns
 * segundos) dava 14 min 57 s e pulava a rodada, e o aviso saía de 30 em 30 min.
 */
export const FOLGA_JANELA_AVISO_MIN = 2;
/** Pessoas por aviso (o resto vai no `total`, a Fila tem todas). */
export const MAX_ITENS_AVISO_RESGATE = 20;

/** Uma pessoa que entrou no resgate — sem telefone, e-mail, classe ou conversa. */
export interface ItemResgate {
  /** O id do lead. */
  id: string;
  primeiroNome: string | null;
  motivo: ResgateMotivo;
  /** Quando entrou no resgate. */
  desde: string;
}

/** O estado gravado em `app_state` (`STATE_KEYS.avisoResgate`). Pequeno: só chaves e datas. */
export interface EstadoAvisoResgate {
  /** chave da entrada (`chaveDoAviso`) → quando foi avisada. */
  avisados: Record<string, string>;
  /** O último envio que deu certo (ISO). */
  ultimoEnvio: string | null;
  /** A última vez que o envio falhou (limpa no próximo envio que der certo). */
  ultimaFalha?: { em: string; detalhe: string } | null;
}

export const ESTADO_AVISO_VAZIO: EstadoAvisoResgate = { avisados: {}, ultimoEnvio: null, ultimaFalha: null };

/** A chave de uma entrada no resgate (11.14). */
export const chaveDoAviso = (i: Pick<ItemResgate, "id" | "motivo" | "desde">) => `${i.id}:${i.motivo}:${i.desde}`;

/** Lê o estado gravado com tolerância (vazio, formato velho, lixo → vazio). */
export function lerEstadoAvisoResgate(v: unknown): EstadoAvisoResgate {
  if (!v || typeof v !== "object") return { ...ESTADO_AVISO_VAZIO, avisados: {} };
  const o = v as Record<string, unknown>;
  const avisados: Record<string, string> = {};
  if (o.avisados && typeof o.avisados === "object") {
    for (const [k, em] of Object.entries(o.avisados as Record<string, unknown>)) if (typeof em === "string") avisados[k] = em;
  }
  const falha = o.ultimaFalha as { em?: unknown; detalhe?: unknown } | null | undefined;
  return {
    avisados,
    ultimoEnvio: typeof o.ultimoEnvio === "string" && o.ultimoEnvio ? o.ultimoEnvio : null,
    ultimaFalha:
      falha && typeof falha.em === "string" ? { em: falha.em, detalhe: typeof falha.detalhe === "string" ? falha.detalhe : "" } : null,
  };
}

export type EsperaDoAviso = "nada-novo" | "fora-do-horario" | "janela";

export interface PlanoAvisoResgate {
  /** Quem avisar agora (as entradas novas, a mais antiga primeiro). Vazio = não envia. */
  enviar: ItemResgate[];
  /**
   * Quantas entradas avisáveis existem agora (inclusive as que a cadência escondeu
   * do grupo). NÃO é o número do corpo do aviso: lá vai o total do grupo Resgate da
   * Fila, o número da página que o link abre (`avisar-resgate.ts`).
   */
  total: number;
  /** Por que não envia (quando `enviar` está vazio). */
  espera: EsperaDoAviso | null;
  /** O estado depois da poda — o que gravar quando não há envio. */
  estado: EstadoAvisoResgate;
}

export function planejarAvisoResgate({
  naFila,
  estado,
  agora,
  cfg,
}: {
  naFila: readonly ItemResgate[];
  estado: EstadoAvisoResgate;
  agora: string;
  cfg?: HorarioComercial;
}): PlanoAvisoResgate {
  const avisaveis = naFila.filter((i) => MOTIVOS_AVISAVEIS.includes(i.motivo));
  const chaves = new Set(avisaveis.map(chaveDoAviso));
  // Poda: só fica quem ainda está naquela MESMA entrada.
  const avisados: Record<string, string> = {};
  for (const [k, em] of Object.entries(estado.avisados)) if (chaves.has(k)) avisados[k] = em;
  const podado: EstadoAvisoResgate = { ...estado, avisados };

  const novos = avisaveis
    .filter((i) => !(chaveDoAviso(i) in avisados))
    .sort((a, b) => a.desde.localeCompare(b.desde) || a.id.localeCompare(b.id));
  const base = { total: avisaveis.length, estado: podado };
  if (novos.length === 0) return { ...base, enviar: [], espera: "nada-novo" };
  if (!noHorarioComercial(agora, cfg)) return { ...base, enviar: [], espera: "fora-do-horario" };
  const ultimo = estado.ultimoEnvio ? Date.parse(estado.ultimoEnvio) : NaN;
  if (Number.isFinite(ultimo) && Date.parse(agora) - ultimo < (JANELA_AVISO_RESGATE_MIN - FOLGA_JANELA_AVISO_MIN) * 60_000) {
    return { ...base, enviar: [], espera: "janela" };
  }
  return { ...base, enviar: novos, espera: null };
}

/**
 * O estado depois de tentar enviar `plano.enviar`. Deu certo: todos os enviados
 * ficam avisados (mesmo os que passaram do teto de itens do corpo — o `total`
 * contou), `ultimoEnvio` = agora e a falha some. Falhou: ninguém é marcado (a
 * próxima rodada tenta de novo) e a falha fica guardada.
 */
export function estadoDepoisDoAviso(
  plano: PlanoAvisoResgate,
  r: { ok: boolean; agora: string; detalhe?: string },
): EstadoAvisoResgate {
  if (!r.ok) {
    return { ...plano.estado, ultimaFalha: { em: r.agora, detalhe: r.detalhe ?? "o n8n não confirmou o recebimento" } };
  }
  const avisados = { ...plano.estado.avisados };
  for (const i of plano.enviar) avisados[chaveDoAviso(i)] = r.agora;
  return { avisados, ultimoEnvio: r.agora, ultimaFalha: null };
}
