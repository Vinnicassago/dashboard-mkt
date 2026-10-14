import "server-only";
import {
  addCapiEnvio,
  expirarCapiVencidos,
  listCapiEnvios,
  reservarCapiEnvio,
  updateCapiEnvio,
} from "../data/store";
import type { CapiEnvioPatch } from "../data/backend";
import {
  capiConfigurada,
  capiEmModoTeste,
  montarEventoCapi,
  postarEventoCapi,
  type CapiActionSource,
  type CapiUser,
} from "./capi";
import {
  JANELA_REENVIO_HORAS,
  RESERVA_MINUTOS,
  erroPermanente,
  expirouJanela,
  mensagemDoErroCapi,
  proximaTentativaCapi,
} from "../capi-politica";
import type { Brand, CapiEnvio, CapiEventName, CapiMotivoFim } from "../types";

/**
 * A caixa de saída da CAPI (Fase 7, D9). Todo evento que o painel manda à Meta
 * passa por aqui:
 *
 * 1. monta o evento (PII em hash) e GRAVA em `capi_envios` como pendente, já
 *    reservado para esta tentativa — o mesmo (evento, event_id) não entra duas
 *    vezes, e o modo (real ou teste) fica fixado na linha;
 * 2. tenta enviar na hora; deu certo → "enviado" e o payload guardado é apagado;
 * 3. falhou → próxima tentativa pela política (`capi-politica.ts`), até 48 h
 *    depois do fato; passou disso → "não chegou", com o porquê.
 *
 * Nunca lança: o fato (status, marco, lead) já foi gravado por quem chamou, e um
 * erro aqui não pode derrubar a tela nem a resposta da LP. Sem conseguir gravar
 * na fila, ainda tenta UMA vez direto — o marco já existe, e sem envio o fato
 * nunca mais seria mandado.
 *
 * A nova tentativa sai de `reenviarPendentes` — cron (`/api/capi/retentar`),
 * botão em Integrações e, de carona, cada lead novo. Cada linha é RESERVADA
 * antes de postar (atômico no store), e só linha pendente é atualizada: dois
 * processos nunca postam a mesma linha e um "não chegou" atrasado nunca
 * sobrescreve um "enviado".
 */

export interface PedidoDeEnvio {
  brand: Brand;
  leadId: string;
  eventName: CapiEventName;
  /** Lead: o `eventID` do Pixel. Os do painel: `<evento>-<leadId>`, estável. */
  eventId: string;
  /** Quando o fato aconteceu (ISO). */
  eventTime: string;
  eventSourceUrl?: string;
  user: CapiUser;
  customData?: Record<string, unknown>;
  actionSource?: CapiActionSource;
}

export type EstadoDoEnvio =
  | "enviado"
  | "pendente"
  | "nao-chegou"
  | "ja-na-fila"
  | "nao-configurado"
  /** A fila falhou (banco), mas a tentativa direta chegou. */
  | "enviado-sem-registro"
  /** A fila falhou e a tentativa direta também — o detalhe está no log. */
  | "falha-local";

export interface ResultadoDoEnvio {
  estado: EstadoDoEnvio;
  /** Saiu com `test_event_code`. */
  teste?: boolean;
}

interface Opcoes {
  agora?: Date;
  /** Injetável nos testes. */
  buscar?: typeof fetch;
}

const MIN = 60_000;
const emMinutos = (agora: Date, min: number) => new Date(agora.getTime() + min * MIN).toISOString();
const textoDoErro = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Id da linha = a chave da deduplicação da Meta. */
export const idDoEnvio = (eventName: CapiEventName, eventId: string) => `${eventName}:${eventId}`;

/**
 * Enfileira e tenta enviar UM evento. Sem a CAPI configurada nada é gravado: a
 * fila não se enche de envios que nunca vão sair (Integrações já diz o que falta).
 */
export async function enviarParaMeta(p: PedidoDeEnvio, opts: Opcoes = {}): Promise<ResultadoDoEnvio> {
  if (!capiConfigurada()) return { estado: "nao-configurado" };
  const agora = opts.agora ?? new Date();
  const agoraIso = agora.toISOString();
  const teste = capiEmModoTeste();
  const evento = montarEventoCapi(p);
  const envio: CapiEnvio = {
    id: idDoEnvio(p.eventName, p.eventId),
    brand: p.brand,
    leadId: p.leadId,
    eventName: p.eventName,
    eventId: p.eventId,
    eventTime: p.eventTime,
    status: "pendente",
    tentativas: 0,
    // Já nasce reservada para a tentativa de agora: o cron não a pega no meio.
    proximaTentativa: emMinutos(agora, RESERVA_MINUTOS),
    teste,
    payload: evento,
    criadoEm: agoraIso,
    atualizadoEm: agoraIso,
  };
  let novo: boolean;
  try {
    novo = await addCapiEnvio(envio);
  } catch (e) {
    console.warn(`[capi] ${envio.id} (lead ${p.leadId}) não entrou na fila: ${textoDoErro(e)} — tentando direto, sem registro`);
    const r = await postarEventoCapi(evento, { buscar: opts.buscar, modoTeste: teste });
    if (!r.ok) console.warn(`[capi] ${envio.id} direto também falhou: ${r.detalhe}`);
    return r.ok ? { estado: "enviado-sem-registro", teste: r.teste } : { estado: "falha-local" };
  }
  if (!novo) return { estado: "ja-na-fila" };
  return tentarEnvio(envio, opts);
}

/** Atualiza a linha sem nunca lançar (o resultado da tentativa já é conhecido). */
async function anotar(id: string, patch: CapiEnvioPatch): Promise<void> {
  try {
    await updateCapiEnvio(id, patch);
  } catch (e) {
    // A linha segue pendente e reservada: daqui a pouco alguém tenta de novo, e a
    // Meta deduplica se este envio já tiver chegado.
    console.warn(`[capi] ${id}: não consegui anotar a tentativa: ${textoDoErro(e)}`);
  }
}

/** Uma tentativa de um envio pendente JÁ RESERVADO — anota o resultado na linha. */
export async function tentarEnvio(envio: CapiEnvio, opts: Opcoes = {}): Promise<ResultadoDoEnvio> {
  const agora = (opts.agora ?? new Date()).toISOString();
  const desistir = async (
    motivo: CapiMotivoFim,
    ultimoErro: string,
    extra: Partial<Pick<CapiEnvio, "tentativas" | "fbtraceId">> = {},
  ) => {
    await anotar(envio.id, {
      status: "expirado",
      motivo,
      proximaTentativa: null,
      ultimoErro,
      // O evento guardado tinha IP e navegador: sem envio pela frente, não fica.
      payload: null,
      ...(extra.tentativas !== undefined ? { tentativas: extra.tentativas } : {}),
      ...(extra.fbtraceId !== undefined ? { fbtraceId: extra.fbtraceId } : {}),
      atualizadoEm: agora,
    });
    return { estado: "nao-chegou" as const };
  };

  if (!envio.payload) return desistir("sem-payload", "O evento guardado não está mais na fila — não dá para reenviar.");
  if (expirouJanela(envio.eventTime, agora)) {
    return desistir("janela", envio.ultimoErro ?? `Ficou na fila além da janela de ${JANELA_REENVIO_HORAS} h sem chegar à Meta.`);
  }

  // O modo é o da ENTRADA na fila: evento real nunca vira teste no reenvio, e vice-versa.
  const r = await postarEventoCapi(envio.payload, { buscar: opts.buscar, modoTeste: envio.teste });
  const tentativas = envio.tentativas + 1;
  if (r.ok) {
    await anotar(envio.id, {
      status: "enviado",
      tentativas,
      enviadoEm: agora,
      proximaTentativa: null,
      ultimoErro: null,
      teste: r.teste,
      fbtraceId: r.fbtraceId ?? null,
      payload: null,
      atualizadoEm: agora,
    });
    return { estado: "enviado", teste: r.teste };
  }

  // O detalhe técnico (e o fbtrace, que o suporte da Meta pede) fica no log.
  console.warn(
    `[capi] ${envio.id} (lead ${envio.leadId}) tentativa ${tentativas}: ${r.detalhe}${
      r.subcodigo ? ` · subcode ${r.subcodigo}` : ""
    }${r.fbtraceId ? ` · fbtrace ${r.fbtraceId}` : ""}`,
  );
  const ultimoErro = mensagemDoErroCapi(r);
  // Evento de teste com o modo de teste desligado: não sai nunca — desiste já
  // (e não é perda: um evento de teste não conta em relatório nem otimização).
  const testeDesligado = envio.teste && r.detalhe.startsWith("Evento de teste");
  const recusado = erroPermanente(r);
  const proxima = testeDesligado || recusado ? null : proximaTentativaCapi(tentativas, envio.eventTime, agora);
  if (!proxima) {
    return desistir(testeDesligado ? "teste" : recusado ? "recusado" : "janela", ultimoErro, {
      tentativas,
      fbtraceId: r.fbtraceId,
    });
  }
  await anotar(envio.id, {
    tentativas,
    proximaTentativa: proxima,
    ultimoErro,
    fbtraceId: r.fbtraceId ?? null,
    atualizadoEm: agora,
  });
  return { estado: "pendente", teste: r.teste };
}

export interface ResumoDoReenvio {
  tentados: number;
  enviados: number;
  pendentes: number;
  naoChegaram: number;
  /** Pendentes fechados por terem passado da janela (sem postar). */
  vencidos: number;
  naoConfigurado: boolean;
}

/**
 * Tenta de novo os pendentes. Sem `forcar`, só os cuja vez chegou (cron e
 * carona); com `forcar` (o botão em Integrações, depois de trocar um token),
 * todos ainda dentro da janela — reenviar é seguro, a Meta deduplica.
 *
 * Antes de tudo, e MESMO sem a CAPI configurada, fecha os pendentes fora da
 * janela: o payload deles (IP, navegador) não fica guardado sem prazo.
 */
export async function reenviarPendentes({
  limit = 25,
  forcar = false,
  ...opts
}: Opcoes & { limit?: number; forcar?: boolean } = {}): Promise<ResumoDoReenvio> {
  const r: ResumoDoReenvio = { tentados: 0, enviados: 0, pendentes: 0, naoChegaram: 0, vencidos: 0, naoConfigurado: false };
  const agora = opts.agora ?? new Date();
  const agoraIso = agora.toISOString();
  try {
    r.vencidos = await expirarCapiVencidos({
      eventoAntesDe: new Date(agora.getTime() - JANELA_REENVIO_HORAS * 3_600_000).toISOString(),
      motivo: `Ficou na fila além da janela de ${JANELA_REENVIO_HORAS} h sem chegar à Meta.`,
      atualizadoEm: agoraIso,
    });
  } catch (e) {
    console.warn(`[capi] limpeza dos vencidos falhou: ${textoDoErro(e)}`);
  }
  r.naoChegaram += r.vencidos;
  if (!capiConfigurada()) return { ...r, naoConfigurado: true };

  const candidatos = forcar
    ? await listCapiEnvios({ status: "pendente", limit })
    : await listCapiEnvios({ devidosAte: agoraIso, limit });
  for (const envio of candidatos) {
    // A hora de CADA reserva (um lote lento não reserva com um "até" já vencido).
    const agoraDaLinha = opts.agora ?? new Date();
    const instante = agoraDaLinha.toISOString();
    // Reserva atômica: se outro processo pegou a linha, segue para a próxima. No
    // modo forçado não há "vez", mas uma reserva VIVA (linha mexida há menos de
    // RESERVA_MINUTOS — alguém a está postando) também é respeitada.
    const reservado = await reservarCapiEnvio(envio.id, {
      ate: emMinutos(agoraDaLinha, RESERVA_MINUTOS),
      vencidoAte: forcar ? undefined : instante,
      livreDesde: forcar ? emMinutos(agoraDaLinha, -RESERVA_MINUTOS) : undefined,
      atualizadoEm: instante,
    }).catch((e) => {
      console.warn(`[capi] ${envio.id}: reserva falhou: ${textoDoErro(e)}`);
      return false;
    });
    if (!reservado) continue;
    const res = await tentarEnvio(envio, { ...opts, agora: agoraDaLinha });
    r.tentados++;
    if (res.estado === "enviado") r.enviados++;
    else if (res.estado === "pendente") r.pendentes++;
    else r.naoChegaram++;
  }
  return r;
}

/** A frase curta que a tela mostra depois de registrar um fato que vira evento. */
export function notaDoEnvio(nome: string, r: ResultadoDoEnvio): string | null {
  switch (r.estado) {
    case "enviado":
    case "enviado-sem-registro":
      return r.teste ? `${nome} enviado à Meta (modo de teste)` : `${nome} enviado à Meta`;
    case "pendente":
      return `${nome} ainda não chegou à Meta — nova tentativa automática`;
    case "nao-chegou":
      return `${nome} não chegou à Meta (detalhe na ficha do lead)`;
    case "falha-local":
      return `${nome} não foi enviado à Meta: o painel não conseguiu registrar o envio (detalhe no log do servidor)`;
    default:
      return null;
  }
}
