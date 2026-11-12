/**
 * Fixtures da Fase 3 — o Funil (fora da coleta do vitest, que só pega `*.test.ts`).
 * ACRESCENTAM ao `fixtures-robo.ts` (a base do golden do Início, que não muda):
 *
 *   • `entradaEm`: a mesma forma de `EntradaInicio` em qualquer instante, com
 *     qualquer leitura do robô (o `entradaDoRobo` fica preso a 04/11 15:00);
 *   • os fatos do robô em qualquer hora (`saudadoAs`, `conversou`, `aceitouAs`) e
 *     a leitura dele (`roboLido`, `roboFalhando`);
 *   • os eventos do histórico: tentativa, mudança de status, confirmação da reunião.
 *
 * Os leads saem do `lead()` de `fixtures-robo.ts`: nome único (`Fulano-<id>-zq`),
 * e-mail e telefone próprios.
 */
import { montarFilaDaLive } from "@/lib/fila-live";
import type { EntradaInicio } from "@/lib/inicio";
import { kpisDoPeriodo } from "@/lib/kpis";
import type { DateRange } from "@/lib/metrics";
import type { RoboAgora } from "@/lib/robo/situacao";
import { EXPEDIENTE_PADRAO } from "@/lib/turno";
import type { Intervalo } from "@/lib/cobertura";
import type { AdDaily, Lead, LeadEvent, LeadStatus, LpDaily } from "@/lib/types";
import { base, brt } from "./fixtures-robo";

// ---------------------------------------------------------------- o robô

/** Leitura em dia, terminada em `lidoAte` (confiável: as regras medem contra ela). */
export const roboLido = (lidoAte: string): RoboAgora => ({ ligado: true, lidoAte, confiavel: true, sync: { ultimoOk: lidoAte, falha: null } });

/** Leitura falhando desde `desde` (o último ok em `ultimoOk`): parada, as regras medem contra agora. */
export const roboFalhando = (ultimoOk: string, desde: string): RoboAgora => ({
  ligado: true,
  lidoAte: ultimoOk,
  confiavel: false,
  sync: { ultimoOk, falha: { desde, erro: "timeout" } },
});

/** Entrou em `dia` às `hhmm` e o robô o viu, recebeu e saudou na mesma hora (sem resposta). */
export const saudadoAs = (dia: string, hhmm: string, over: Partial<Lead> = {}): Partial<Lead> => ({
  createdAt: brt(dia, hhmm),
  roboVistoEm: brt(dia, hhmm),
  roboRecebidoEm: brt(dia, hhmm),
  roboSaudacaoEm: brt(dia, hhmm),
  roboEtapa: "nao_respondeu",
  ...over,
});

/** Saudado em `dia` às 09:00 e respondeu às 09:10 (em conversa; a última atividade é a resposta). */
export const conversou = (dia: string, over: Partial<Lead> = {}): Partial<Lead> => ({
  ...saudadoAs(dia, "09:00"),
  roboRespondeuEm: brt(dia, "09:10"),
  roboUltimaMsgClienteEm: brt(dia, "09:10"),
  roboUltimaInteracaoEm: brt(dia, "09:10"),
  roboEtapa: "em_conversa",
  ...over,
});

/** `conversou(dia)` e aceitou o convite (recebeu o link do Calendly) às `hhmm` de `dia`. */
export const aceitouAs = (dia: string, hhmm = "10:00", over: Partial<Lead> = {}): Partial<Lead> => ({
  ...conversou(dia),
  roboConviteEm: brt(dia, hhmm),
  roboAceitouEm: brt(dia, hhmm),
  roboUltimaInteracaoEm: brt(dia, hhmm),
  roboEtapa: "transferido",
  ...over,
});

// ---------------------------------------------------------------- eventos

let evSeq = 0;

/** Uma tentativa do comercial (sem `proxima`: o retorno devido é 24 h depois). */
export const tentativa = (leadId: string, quando: string, falou: "sim" | "nao" = "nao"): LeadEvent => ({
  id: `T${++evSeq}`,
  leadId,
  leadName: "x",
  actor: "ana",
  action: "tentativa",
  occurredAt: quando,
  createdAt: quando,
  payload: { canal: "whatsapp", falou },
});

/** Uma mudança de status registrada em `quando` (`actor` = `ATOR_N8N` para a API do n8n). */
export const mudouStatus = (leadId: string, quando: string, para: LeadStatus, actor = "ana", de: LeadStatus = "lead"): LeadEvent => ({
  id: `S${++evSeq}`,
  leadId,
  leadName: "x",
  actor,
  action: "status_changed",
  fromStatus: de,
  toStatus: para,
  createdAt: quando,
});

/** A confirmação da reunião gravada pela ficha (`gravarFicha`): o evento fica mesmo depois de uma remarcação. */
export const confirmouReuniao = (leadId: string, quando: string): LeadEvent => ({
  id: `F${++evSeq}`,
  leadId,
  leadName: "x",
  actor: "ana",
  action: "ficha",
  payload: { fato: "reuniao_confirmada" },
  createdAt: quando,
});

// ---------------------------------------------------------------- a entrada

export const lpDia = (date: string, visits: number, formSubmits = 0): LpDaily => ({
  brand: "consorcio",
  date,
  visits,
  clicks: Math.round(visits / 2),
  formSubmits,
});

/**
 * Uma entrada do Início/Funil (a forma de `EntradaInicio`, que também serve ao
 * `funilDoProcesso` e ao `montarFunilDaTela`) em qualquer instante. `robo: null`
 * (ou ausente) = o robô desligado; `range: null` = a campanha inteira.
 */
export function entradaEm(o: {
  leads: Lead[];
  range: DateRange | null;
  agora: string;
  hoje: string;
  robo?: RoboAgora | null;
  eventos?: LeadEvent[];
  adDaily?: AdDaily[];
  lpDaily?: LpDaily[];
  cobertura?: Intervalo[];
}): EntradaInicio {
  const data = base({ leads: o.leads, adDaily: o.adDaily ?? [], lpDaily: o.lpDaily ?? [] });
  const eventos = o.eventos ?? [];
  const range = o.range ?? undefined;
  return {
    data,
    range,
    rangeKey: o.range ? `${o.range.from}..${o.range.to}` : "all",
    kpis: kpisDoPeriodo(data, range, { hoje: o.hoje, agora: o.agora, cobertura: o.cobertura }),
    eventos,
    robo: o.robo ?? undefined,
    cobertura: o.cobertura,
    expediente: EXPEDIENTE_PADRAO,
    filaLive: montarFilaDaLive(data.leads, eventos, o.agora, EXPEDIENTE_PADRAO),
    agora: o.agora,
    hoje: o.hoje,
  };
}
