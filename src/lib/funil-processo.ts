/**
 * O FUNIL DO PROCESSO (Fase 3, nov/26) — a função ÚNICA de "até onde os leads do
 * período chegaram", PURA e sem I/O. O Funil a desenha inteira; o Início mostra um
 * RECORTE dela (`recortarProcesso` + `RECORTE_DO_INICIO`): os mesmos números e o
 * mesmo texto do % (`textoDaTaxa`) nos degraus que os dois mostram.
 *
 * A COORTE do período (`filterLeads`, pelo dia de Brasília, com teste e duplicado =
 * `kpis.leads`), lida SÓ do lead — as colunas `robo_*` que o sync gravou, por
 * `situacaoDoRobo` com os MESMOS insumos da Fila (ref, reabertos), e os marcos —,
 * nunca do banco do robô:
 *
 *   Leads → Com o robô (recorte: fora os de antes de 29/10, sem telefone, live,
 *   recentes, depois da leitura, reabertos no painel) → 1ª mensagem → Responderam →
 *   Convite aceito (interseções) · Agendaram (`isBooked` = `kpis.agendaram`; com o
 *   robô, ramo paralelo sobre Leads) — Confirmaram (lateral sobre Agendaram:
 *   confirmação REGISTRADA alguma vez) — Reuniões realizadas (sobre Agendaram =
 *   `showRate`) → Vendas.
 *
 * Na MESMA passada saem as JUNTAS (a matéria-prima de `ondeTrava`): por etapa, quem
 * entrou, passou, chegou a agendar por outro caminho NESTE episódio, ainda está no
 * prazo e quem TRAVOU — sobre a coorte SEM teste nem cópia de duplicado
 * (`testesEDuplicados`, a régua das perdas) e sem a live (F3-D1); com o trecho do
 * robô, também sem os de antes de 29/10 fora da Fila (F3-D31, sem processo).
 *
 * Importa só módulos de dado puro (nunca `inicio`, `funil`, `cascata` nem `kpis` em
 * runtime — K29: `cascata` puxa `kpis`; aqui só os TIPOS deles). O objeto só tem
 * contagens e textos (LGPD: vai para o client e para a IA); os ids do trecho do
 * robô saem por `idsDoTrechoDoRobo`, que fica no servidor.
 *
 * A Mídia (Fase 4) conta o MESMO trecho POR LINHA (criativo, conjunto) com a MESMA
 * classificação e os mesmos fatos (`trechoDoRoboPorLinha`, `fatosDoTrecho`): Σ linhas
 * + sem linha + teste/cópia (por fato) = os degraus do robô daqui. Os tipos
 * (`ContagemDoTrecho`, `TrechoPorLinha`) moram em `sinal-do-criativo.ts` (só tipo).
 */

import type { Fonte } from "./cascata";
import { eventosPorLead, resumoContato } from "./contato";
import type { MetricaId } from "./dicionario";
import type { Dono } from "./dono";
import { FILA_ETAPAS, montarFila, reunioesPorTelefone, type FilaEtapa, type FilaItem, type FilaResult } from "./fila";
import { formatDateTimeCurta, formatInt, formatPercent } from "./format";
import { diaDoLead, horasUteisEntre } from "./horario-util";
import { testesEDuplicados } from "./identidade";
import type { KpisDoPeriodo } from "./kpis";
import { BOOKED_STATUSES, isLostStatus } from "./lead-status";
import { everBooked, filterLeads, isAttended, isBooked, isClient, type DateRange } from "./metrics";
import { chaveTelefoneValida } from "./phone";
import { classeDoLead } from "./qualificacao";
import {
  RESGATE_SEM_RESPOSTA_H,
  ROBO_INICIO,
  ROBO_SEM_MSG_MIN,
  encerramentoDoRobo,
  fatoDoEpisodio,
  leadAberto,
  leituraDoRoboParada,
  reabertosNoPainel,
  reabertosPorLead,
  refDoRobo,
  situacaoDoRobo,
  type RoboAgora,
  type SituacaoRobo,
} from "./robo/situacao";
import type { ContagemDoTrecho, TrechoPorLinha } from "./sinal-do-criativo";
import { MIN_REUNIOES } from "./trust";
import type { DashboardData, Lead, LeadEvent, LeadStatus } from "./types";

// ---------------------------------------------------------------- contrato

export type DegrauId =
  | "leads" | "com-robo" | "primeira-msg" | "responderam" | "aceitaram"
  | "agendaram" | "confirmaram" | "realizadas" | "vendas";

export const ROTULO_DO_DEGRAU: Record<DegrauId, string> = {
  leads: "Leads", "com-robo": "Com o robô", "primeira-msg": "1ª mensagem", responderam: "Responderam",
  aceitaram: "Convite aceito", agendaram: "Agendaram", confirmaram: "Confirmaram",
  realizadas: "Reuniões realizadas", vendas: "Vendas",
};

export interface DegrauDoProcesso {
  id: DegrauId;
  /** `ROTULO_DO_DEGRAU[id]` — um rótulo só, Início e Funil. */
  rotulo: string;
  n: number;
  /** `${piso ? "≥ " : ""}${formatInt(n)}`. */
  texto: string;
  /** De quem é a taxa; null = âncora (leads) ou recorte (com-robo). */
  base: DegrauId | null;
  /** n ÷ n(base): só com n(base) ≥ AMOSTRA_MINIMA, n ≤ n(base) e sem piso (nem no degrau, nem na base). */
  taxa: number | null;
  /** "registro-parcial" = Confirmaram com reunião de antes de 04/11 (K2). */
  semTaxa: "ancora" | "recorte" | "amostra" | "nao-aninhada" | "leitura-parada" | "registro-parcial" | null;
  /** primeira-msg, responderam, aceitaram, confirmaram: linha recuada (sub-etapa). */
  recuo: boolean;
  /** n ÷ Leads (o comprimento da barra); null com Leads = 0. */
  daAncora: number | null;
  piso: boolean;
  dono: Dono;
  /** "crm" | "robo". */
  fonte: Fonte;
  doRobo: boolean;
  dica: MetricaId;
}

export type JuntaId =
  | "robo-falou" | "respondeu" | "aceitou" | "agendou-apos-aceite"
  /** K1: com o robô, os leads de `fora` (menos a live e, F3-D31, os de antes do robô fora da Fila). */
  | "fora-agendou"
  | "agendou" | "realizou" | "fechou";

export interface JuntaDoProcesso {
  id: JuntaId;
  de: DegrauId;
  para: DegrauId;
  dono: Dono;
  /** As três primeiras. */
  doRobo: boolean;
  entradas: number;
  passaram: number;
  /** Não passaram, mas chegaram a agendar NESTE episódio (`everEp`; no legado sem `bookedAt`, a reunião realizada) — por outro caminho ou desistindo depois. */
  outroCaminho: number;
  /** Não passaram e o prazo natural da etapa ainda corre (§3.4). */
  emAndamento: number;
  /** entradas − passaram − outroCaminho − emAndamento: a perda em PESSOAS. */
  travados: number;
  /** Dos travados: status de perda; nas três juntas do robô, também o fim da conversa pelo robô (`encerramentoDoRobo`, K16). */
  encerrados: number;
  /** travados − encerrados. */
  abertos: number;
  /** O grupo da Fila que tem mais travados desta junta AGORA (empate: maior `profundidade`); null = nenhum na Fila. */
  destino: FilaEtapa | null;
  /** Só em robo-falou (K9): os travados por motivo — partição dos travados. */
  semFala?: { semWhatsapp: number; naoChegou: number; naoFalou: number };
}

/** Por que um lead da coorte fica fora de "Com o robô" (o ⓘ do funil diz quantos de cada). */
export interface ForaDoRobo {
  /** Entrou antes de 29/10 e o robô nunca o viu (`antesDoRobo`). */
  antes: number;
  /** Sem telefone utilizável (`chaveTelefoneValida`). */
  semTelefone: number;
  /** Inscrito da live (com classe): a Fila da live, não o robô. */
  live: number;
  /** Entrou há menos de `ROBO_SEM_MSG_MIN` (contra agora): o robô ainda não teve tempo. */
  recentes: number;
  /** Entrou depois da última leitura do robô (menos os 15 min): o painel ainda não sabe. */
  depoisDaLeitura: number;
  /** Reaberto no PAINEL sem fala nova do robô: a reabertura nunca chega a ele. */
  reabertosNoPainel: number;
}

export interface FunilDoProcesso {
  /** O trecho do robô aparece: ligado E o período não é todo anterior a 29/10 (`todoAntes`). */
  comRobo: boolean;
  /** `leituraDoRoboParada` (robô ligado); false sem o robô. */
  parada: boolean;
  /** A linha de uma frase (§3.6); null sem o robô ligado ou com a leitura em dia. */
  leituraParada: { desde: string | null; texto: string } | null;
  /** = `kpis.leads.valor`. */
  leads: number;
  /** = n("com-robo"); 0 sem o trecho. */
  noRobo: number;
  /** Zeros sem o trecho. */
  fora: ForaDoRobo;
  /** O funil COMPLETO na ordem de exibição (§3.3). */
  degraus: DegrauDoProcesso[];
  /** Aceitou → agendou depois do aceite. null sem o trecho do robô ou com n(aceitaram) = 0. */
  ponte: { aceitaram: number; peloConvite: number; texto: string } | null;
  /** As juntas que existem neste funil (§3.4), na ordem. */
  juntas: JuntaDoProcesso[];
  /**
   * Quem as juntas NÃO julgam: testes e cópias de duplicado (nenhuma junta: a régua
   * das perdas, K5); inscritos da live (F3-D1) e — com o trecho do robô — os de antes
   * de 29/10 fora da Fila (F3-D31: sem processo, D5), estes dois só nas juntas ANTES
   * de Agendaram (a reunião deles, se houve, é julgada em `realizou`/`fechou`).
   */
  foraDasJuntas: { testes: number; duplicados: number; live: number; antes: number };
  /** Agendaram e desistiram depois (everBooked ∧ ¬isBooked) — fora de Agendaram (política do CPR). */
  desistiram: number;
  /** Reuniões realizadas sem confirmação registrada (o ⓘ de Confirmaram, K2). */
  realizadasSemConfirmacao: number;
  /** `recorteDoFunil(range)`: "leads de 05/11 a 11/11" / "leads da campanha". */
  recorte: string;
}

export interface EntradaDoProcesso {
  data: DashboardData;
  range: DateRange | undefined;
  kpis: Pick<KpisDoPeriodo, "leads" | "agendaram" | "taxaLeadAgendada" | "overview">;
  /** O histórico da marca inteiro (`listLeadEvents({ limit: 0 })`): reabertos, confirmações e a Fila. */
  eventos: readonly LeadEvent[];
  /** `estadoDoRoboAgora` — o MESMO da Fila. Ausente ou `ligado: false` = sem o robô. */
  robo?: RoboAgora;
  /** A `montarFila` da MESMA entrada da /fila; ausente = calculada aqui. */
  fila?: Pick<FilaResult, "itens">;
  agora: string;
}

/** Os degraus que o Início mostra (o recorte do funil do processo). */
export const RECORTE_DO_INICIO = {
  comRobo: ["leads", "com-robo", "primeira-msg", "responderam", "aceitaram", "agendaram"],
  semRobo: ["leads", "agendaram", "realizadas"],
} as const satisfies Record<string, readonly DegrauId[]>;

/** O dia em que o painel passou a registrar a confirmação (versão 2026-11-03c no ar; coluna da migração 0021). */
export const CONFIRMACAO_DESDE = "2026-11-04";
/** K7: conversa com o robô sem atividade (robô, pessoa ou tentativa) há mais que isto = parada. */
export const CONVERSA_PARADA_H = 48;
/** K7: reunião realizada sem desfecho há mais que isto = parada na negociação. */
export const NEGOCIACAO_DIAS = 30;

/** A régua ÚNICA de amostra (`AMOSTRA_MINIMA` da cascata = `MIN_REUNIOES`; daqui sem o import de runtime, K29). */
const AMOSTRA_MINIMA = MIN_REUNIOES;

const MIN_MS = 60_000;
const H_MS = 3_600_000;
const DIA_MS = 86_400_000;

const dm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

// ---------------------------------------------------------------- textos

/**
 * K31: o texto do % — UMA função, Início e Funil. De Leads para baixo
 * `formatPercent(taxa, 0)`; no topo (`{ topo: true }`: visitas, a taxa da linha
 * Leads) uma casa abaixo de 10% ("1,3%"), senão nenhuma.
 */
export function textoDaTaxa(taxa: number, o?: { topo?: boolean }): string {
  if (o?.topo && taxa < 0.1) return formatPercent(taxa, 1);
  // Sem casa decimal, de 0,1% a 0,49% arredondaria para "0%" — o mesmo pixel de
  // "ninguém" ao lado de um n > 0 (a regra 7.2 do `formatPercent` só cobre 1 casa).
  if (taxa > 0 && taxa < 0.005) return "< 1%";
  return formatPercent(taxa, 0);
}

/**
 * A linha de uma frase da leitura parada (§3.6) — o MESMO texto no Início e no
 * Funil: "Robô sem leitura desde 05/11 12:30 ⚠" ou "Robô ainda não lido ⚠". `null`
 * com o robô desligado ou com a leitura em dia.
 */
export function linhaDaLeituraParada(robo: RoboAgora | undefined, agora: string): { desde: string | null; texto: string } | null {
  if (!robo?.ligado || !leituraDoRoboParada(robo, agora)) return null;
  const desde = robo.sync.falha?.desde ?? robo.sync.ultimoOk ?? null;
  return { desde, texto: desde ? `Robô sem leitura desde ${formatDateTimeCurta(desde)} ⚠` : "Robô ainda não lido ⚠" };
}

/** "leads de 30/10 a 05/11", "leads de 05/11", "leads da campanha". */
export function recorteDoFunil(range: DateRange | undefined): string {
  if (!range) return "leads da campanha";
  return range.from === range.to ? `leads de ${dm(range.from)}` : `leads de ${dm(range.from)} a ${dm(range.to)}`;
}

/**
 * O ⓘ do "Com o robô": "8 dos 12 leads passam pelo robô; fora: 1 sem telefone, 1
 * inscrito da live." — o motivo REAL de cada um que ficou fora (uma semana só de
 * inscritos da live dá "0 dos 4 … fora: 4 inscritos da live", nunca "o robô não
 * existia"). Com a leitura parada, "≥ N".
 */
export function dicaDoRecorteDoRobo(f: Pick<FunilDoProcesso, "noRobo" | "leads" | "fora" | "parada">): string {
  const n = (v: number, um: string, varios: string) => `${formatInt(v)} ${v === 1 ? um : varios}`;
  const motivos = [
    f.fora.antes > 0 ? n(f.fora.antes, `de antes de ${dm(ROBO_INICIO)}`, `de antes de ${dm(ROBO_INICIO)}`) : "",
    f.fora.semTelefone > 0 ? n(f.fora.semTelefone, "sem telefone", "sem telefone") : "",
    f.fora.live > 0 ? n(f.fora.live, "inscrito da live", "inscritos da live") : "",
    f.fora.recentes > 0 ? n(f.fora.recentes, "recém-chegado (o robô ainda não teve tempo)", "recém-chegados (o robô ainda não teve tempo)") : "",
    f.fora.depoisDaLeitura > 0 ? n(f.fora.depoisDaLeitura, "depois da última leitura do robô", "depois da última leitura do robô") : "",
    f.fora.reabertosNoPainel > 0 ? n(f.fora.reabertosNoPainel, "reaberto no painel", "reabertos no painel") : "",
  ].filter(Boolean);
  const dos = f.leads === 1 ? "do 1 lead" : `dos ${formatInt(f.leads)} leads`;
  // "≥ 1 dos 12 passam" (pelo menos um); "≥ 1 do 1 lead" é exatamente um.
  const passa = f.noRobo === 1 && (!f.parada || f.leads === 1);
  const passam = `${f.parada ? "≥ " : ""}${formatInt(f.noRobo)} ${dos} ${passa ? "passa" : "passam"} pelo robô`;
  return motivos.length > 0 ? `${passam}; fora: ${motivos.join(", ")}.` : `${passam}.`;
}

// ---------------------------------------------------------------- a classificação (ÚNICA)

type MotivoFora = keyof ForaDoRobo;

interface LeadClassificado {
  lead: Lead;
  /** O motivo de `fora`, ou "com-robo". Interno: nunca sai do módulo. */
  motivo: MotivoFora | "com-robo";
  s: SituacaoRobo;
  reabertoEm?: string;
}

interface Classificacao {
  /** A coorte (P): `filterLeads` sem excluídos. */
  coorte: Lead[];
  /** O robô ligado (o MESMO da Fila); undefined sem ele. */
  robo?: RoboAgora;
  parada: boolean;
  /** Robô ligado e o período não é todo anterior a ele. */
  comRobo: boolean;
  fora: ForaDoRobo;
  /** Por lead da coorte (só com `comRobo`). */
  porLead: Map<string, LeadClassificado>;
  reabertos: Map<string, string>;
  ref: string;
}

const foraZerado = (): ForaDoRobo => ({ antes: 0, semTelefone: 0, live: 0, recentes: 0, depoisDaLeitura: 0, reabertosNoPainel: 0 });

/**
 * A classificação ÚNICA do trecho do robô — `funilDoProcesso` e `idsDoTrechoDoRobo`
 * leem daqui. A MESMA ordem e as MESMAS regras do funil do Atendimento de antes da
 * Fase 3 (`inicio.ts`, nov/26), sem mudança: antes; sem telefone; live; recentes /
 * depois da leitura (a base é o reaberto, se posterior à entrada, contra a leitura
 * menos os 15 min); reaberto no painel sem fala nova do robô.
 */
function classificar(e: Pick<EntradaDoProcesso, "data" | "range" | "eventos" | "robo" | "agora">): Classificacao {
  const coorte = filterLeads(e.data.leads, e.range).filter((l) => !l.deletedAt);
  const robo = e.robo?.ligado ? e.robo : undefined;
  const parada = robo ? leituraDoRoboParada(robo, e.agora) : false;
  const reabertos = reabertosPorLead(e.eventos);
  const ref = refDoRobo(robo, e.agora);
  const porLead = new Map<string, LeadClassificado>();
  if (!robo) return { coorte, robo, parada, comRobo: false, fora: foraZerado(), porLead, reabertos, ref };

  const limite = Date.parse(ref) - ROBO_SEM_MSG_MIN * MIN_MS;
  const recente = Date.parse(e.agora) - ROBO_SEM_MSG_MIN * MIN_MS;
  const noPainel = reabertosNoPainel(e.eventos);
  const fora = foraZerado();
  for (const l of coorte) {
    const reabertoEm = reabertos.get(l.id);
    const reabertoNoPainel = noPainel.has(l.id);
    const s = situacaoDoRobo(l, { agora: e.agora, ref, ligado: true, reabertoEm, reabertoNoPainel });
    const marcar = (motivo: LeadClassificado["motivo"]) => {
      if (motivo !== "com-robo") fora[motivo] += 1;
      porLead.set(l.id, { lead: l, motivo, s, reabertoEm });
    };
    if (s.antesDoRobo) {
      marcar("antes");
      continue;
    }
    if (!chaveTelefoneValida(l.phone)) {
      marcar("semTelefone");
      continue;
    }
    if (classeDoLead(l)) {
      marcar("live");
      continue;
    }
    // O robô ainda não teve tempo (a mesma régua dos 15 min da B1 e do alerta, contra a leitura).
    const base = reabertoEm && Date.parse(reabertoEm) > Date.parse(l.createdAt) ? reabertoEm : l.createdAt;
    if (!(Date.parse(base) <= limite)) {
      marcar(Date.parse(base) > recente ? "recentes" : "depoisDaLeitura");
      continue;
    }
    // Reaberto no PAINEL e sem fala nova: a reabertura nunca chega ao robô — não é dele.
    if (reabertoNoPainel && !s.falouEm) {
      marcar("reabertosNoPainel");
      continue;
    }
    marcar("com-robo");
  }
  // Só o período TODO anterior ao robô cai no funil do painel; "Com o robô" = 0 por
  // outro motivo (só inscritos da live, sem telefone, leitura atrasada) fica no
  // funil do robô, e o ⓘ diz o motivo.
  const todoAntes = (e.range !== undefined && e.range.to < ROBO_INICIO) || (coorte.length > 0 && fora.antes === coorte.length);
  if (todoAntes) return { coorte, robo, parada, comRobo: false, fora: foraZerado(), porLead: new Map(), reabertos, ref };
  return { coorte, robo, parada, comRobo: true, fora, porLead, reabertos, ref };
}

/**
 * Os ids dos leads do trecho do robô ("Com o robô"), pela MESMA classificação de
 * `funilDoProcesso`. Vazio sem o trecho. SÓ servidor: alimenta `perdasConfiaveis`
 * (K5) e nunca entra em `FunilDoProcesso` nem em payload nenhum.
 */
export function idsDoTrechoDoRobo(e: EntradaDoProcesso): ReadonlySet<string> {
  const c = classificar(e);
  const out = new Set<string>();
  if (!c.comRobo) return out;
  for (const [id, x] of c.porLead) if (x.motivo === "com-robo") out.add(id);
  return out;
}

// ---------------------------------------------------------------- o trecho por linha (Mídia, Fase 4)

/**
 * Os fatos do trecho do robô de UM lead — o MESMO predicado dos degraus do Funil e
 * das linhas da Mídia. `aceitou` ⇒ `respondeu` ⇒ `falou`. Sem WhatsApp lê a ETAPA do
 * episódio (SOBRESCREVE), a mesma regra da junta "robô falou" — nunca o fato UMA VEZ
 * `roboSemWhatsappEm` (K15): a Mídia e o Funil contam igual.
 */
export function fatosDoTrecho(s: SituacaoRobo): { falou: boolean; respondeu: boolean; aceitou: boolean; semWhatsapp: boolean } {
  const falou = Boolean(s.falouEm);
  const respondeu = falou && s.respondeu;
  const aceitou = respondeu && Boolean(s.aceitouEm);
  return { falou, respondeu, aceitou, semWhatsapp: s.etapa === "sem_whatsapp" };
}

const contagemZerada = (): ContagemDoTrecho => ({
  leads: 0,
  semTelefoneUtil: 0,
  fora: foraZerado(),
  testesECopias: 0,
  testesECopiasPorFato: { falou: 0, respondeu: 0, aceitou: 0 },
  noRobo: 0,
  falou: 0,
  respondeu: 0,
  aceitou: 0,
  semWhatsapp: 0,
  noPrazo: 0,
});

/**
 * O trecho do robô POR LINHA (criativo ou conjunto, pela `chaveDe` do lead) — a
 * classificação ÚNICA (`classificar`) e os fatos ÚNICOS (`fatosDoTrecho`) do Funil,
 * numa passada pela coorte. SEMPRE conta `leads` e `semTelefoneUtil` (com ou sem o
 * robô, K14: = "Leads (painel)" da linha e a trava do candidato); os campos do robô
 * só com `comRobo`. Teste e cópia de duplicado entram no degrau (como no Funil), mas
 * ficam fora da qualidade (`testesECopias`, por fato). Só contagens por chave (LGPD):
 * os ids continuam saindo só por `idsDoTrechoDoRobo`.
 */
export function trechoDoRoboPorLinha(
  e: Pick<EntradaDoProcesso, "data" | "range" | "eventos" | "robo" | "agora">,
  chaveDe: (l: Lead) => string | null,
): TrechoPorLinha {
  const c = classificar(e);
  const { testes, duplicados } = testesEDuplicados(e.data.leads);
  const motivoSemRobo: TrechoPorLinha["motivoSemRobo"] = !e.robo?.ligado ? "desligado" : !c.comRobo ? "antes-do-robo" : null;
  const porLinha = new Map<string, ContagemDoTrecho>();
  const semLinha = contagemZerada();
  const degraus = { comRobo: 0, primeiraMsg: 0, responderam: 0, aceitaram: 0 };
  const refMs = Date.parse(c.ref);
  for (const l of c.coorte) {
    const chave = chaveDe(l);
    let acc = semLinha;
    if (chave != null) {
      acc = porLinha.get(chave) ?? contagemZerada();
      porLinha.set(chave, acc);
    }
    acc.leads += 1;
    if (!chaveTelefoneValida(l.phone)) acc.semTelefoneUtil += 1;
    if (!c.comRobo) continue;
    const x = c.porLead.get(l.id);
    if (!x) continue;
    if (x.motivo !== "com-robo") {
      acc.fora[x.motivo] += 1;
      continue;
    }
    const f = fatosDoTrecho(x.s);
    degraus.comRobo += 1;
    if (f.falou) degraus.primeiraMsg += 1;
    if (f.respondeu) degraus.responderam += 1;
    if (f.aceitou) degraus.aceitaram += 1;
    if (testes.has(l.id) || duplicados.has(l.id)) {
      acc.testesECopias += 1;
      if (f.falou) acc.testesECopiasPorFato.falou += 1;
      if (f.respondeu) acc.testesECopiasPorFato.respondeu += 1;
      if (f.aceitou) acc.testesECopiasPorFato.aceitou += 1;
      continue;
    }
    acc.noRobo += 1;
    if (f.falou) acc.falou += 1;
    if (f.respondeu) acc.respondeu += 1;
    if (f.aceitou) acc.aceitou += 1;
    if (f.semWhatsapp) acc.semWhatsapp += 1;
    // Ainda nas primeiras 24 h depois da 1ª mensagem (contra a leitura do robô): não conta contra o criativo.
    if (f.falou && !f.respondeu && Date.parse(x.s.falouEm!) + RESGATE_SEM_RESPOSTA_H * H_MS > refMs) acc.noPrazo += 1;
  }
  return {
    comRobo: c.comRobo,
    motivoSemRobo,
    parada: c.parada,
    leituraParada: linhaDaLeituraParada(c.robo, e.agora),
    porLinha,
    semLinha,
    degraus,
  };
}

// ---------------------------------------------------------------- degraus

const DICA_DO_DEGRAU: Record<DegrauId, MetricaId> = {
  leads: "leads",
  "com-robo": "com_robo",
  "primeira-msg": "primeira_mensagem",
  responderam: "responderam",
  aceitaram: "convite_aceito",
  agendaram: "agendaram",
  confirmaram: "confirmaram",
  realizadas: "reunioes_realizadas",
  vendas: "vendas",
};

const BASE_DO_DEGRAU: Record<DegrauId, DegrauId | null> = {
  leads: null,
  "com-robo": null,
  "primeira-msg": "com-robo",
  responderam: "primeira-msg",
  aceitaram: "responderam",
  agendaram: "leads",
  confirmaram: "agendaram",
  realizadas: "agendaram",
  vendas: "realizadas",
};

const DONO_DO_DEGRAU: Record<DegrauId, Dono> = {
  leads: "MKT",
  "com-robo": "BOT",
  "primeira-msg": "BOT",
  responderam: "BOT",
  aceitaram: "BOT",
  agendaram: "COM",
  confirmaram: "COM",
  realizadas: "COM",
  vendas: "ESP",
};

const DO_ROBO: ReadonlySet<DegrauId> = new Set(["com-robo", "primeira-msg", "responderam", "aceitaram"]);
const RECUADOS: ReadonlySet<DegrauId> = new Set(["primeira-msg", "responderam", "aceitaram", "confirmaram"]);

/**
 * A taxa de um degrau (§3.3), na ordem: sem base → âncora/recorte; piso no degrau
 * ou na base → leitura parada (robô) ou registro parcial (confirmaram); base abaixo
 * da amostra; acima da base (não aninhada); senão n ÷ base.
 */
function taxaDe(
  id: DegrauId,
  n: number,
  base: { id: DegrauId; n: number; piso: boolean } | null,
  piso: boolean,
): { taxa: number | null; semTaxa: DegrauDoProcesso["semTaxa"] } {
  if (!base) return { taxa: null, semTaxa: id === "leads" ? "ancora" : "recorte" };
  if (piso || base.piso) return { taxa: null, semTaxa: DO_ROBO.has(id) || DO_ROBO.has(base.id) ? "leitura-parada" : "registro-parcial" };
  if (base.n < AMOSTRA_MINIMA) return { taxa: null, semTaxa: "amostra" };
  if (n > base.n) return { taxa: null, semTaxa: "nao-aninhada" };
  return { taxa: n / base.n, semTaxa: null };
}

// ---------------------------------------------------------------- a função

const REALIZOU_STATUS: readonly LeadStatus[] = ["reuniao_realizada", "cliente"];
const CLIENTE_STATUS: readonly LeadStatus[] = ["cliente"];

/**
 * Os marcos do EPISÓDIO (K21): o que é de antes do último `reaberto` não responde pelo
 * episódio atual. Os marcos são gravados UMA vez (`??=`/`coalesce`): o reaberto que
 * agenda (faz a reunião, fecha) DE NOVO não regrava a data — o `bookedAt` continua o do
 * episódio antigo. Toda reabertura (painel, página, n8n) devolve o status a Novo/Em
 * contato, então o fato deste episódio é a 1ª mudança de status registrada depois do
 * reaberto (`status_changed`) ou, sem ela, o próprio status atual (só pode ter vindo
 * depois; a data fica a do reaberto, o mínimo que se sabe).
 */
function marcosDoEpisodio(l: Lead, reabertoEm: string | undefined, evs: readonly LeadEvent[]) {
  const reab = reabertoEm ? Date.parse(reabertoEm) : NaN;
  const noEp = (iso: string | null | undefined) => !reabertoEm || (iso != null && Date.parse(iso) >= reab);
  const deNovo = (sts: readonly LeadStatus[]): string | null => {
    if (!reabertoEm) return null;
    let primeira: string | null = null;
    for (const ev of evs) {
      if (ev.action !== "status_changed" || !ev.toStatus || !sts.includes(ev.toStatus)) continue;
      if (!(Date.parse(ev.createdAt) >= reab)) continue;
      if (!primeira || Date.parse(ev.createdAt) < Date.parse(primeira)) primeira = ev.createdAt;
    }
    return primeira ?? (sts.includes(l.status) ? reabertoEm : null);
  };
  /** Quando agendou NESTE episódio (o marco, ou a mudança de status depois do reaberto); null = não agendou nele. */
  const agendouEm = l.bookedAt && noEp(l.bookedAt) ? l.bookedAt : deNovo(BOOKED_STATUSES);
  const everEp = everBooked(l) && (noEp(l.bookedAt) || agendouEm != null);
  const attendedEp = isAttended(l) && (noEp(l.attendedAt ?? l.bookedAt) || deNovo(REALIZOU_STATUS) != null);
  return {
    agendouEm,
    everEp,
    bookedEp: isBooked(l) && everEp,
    attendedEp,
    clientEp: isClient(l) && (noEp(l.closedAt ?? l.attendedAt ?? l.bookedAt) || deNovo(CLIENTE_STATUS) != null),
    /**
     * O "outro caminho" das juntas antes de Agendaram: chegou a agendar NESTE episódio —
     * o marco do agendamento ou, no legado sem `bookedAt` (F3-D10), a reunião realizada
     * (quem fez a reunião agendou). Sem isso, o legado travava duas vezes: em `agendou`
     * (sem `everEp`) e de novo em `fechou` (com `attendedEp`) — §3.4, uma junta por pessoa.
     */
    chegouEp: everEp || attendedEp,
  };
}

const JUNTA_META: Record<JuntaId, { de: DegrauId; para: DegrauId; dono: Dono; doRobo: boolean }> = {
  "robo-falou": { de: "com-robo", para: "primeira-msg", dono: "BOT", doRobo: true },
  respondeu: { de: "primeira-msg", para: "responderam", dono: "BOT", doRobo: true },
  aceitou: { de: "responderam", para: "aceitaram", dono: "BOT", doRobo: true },
  "agendou-apos-aceite": { de: "aceitaram", para: "agendaram", dono: "COM", doRobo: false },
  "fora-agendou": { de: "leads", para: "agendaram", dono: "COM", doRobo: false },
  agendou: { de: "leads", para: "agendaram", dono: "COM", doRobo: false },
  realizou: { de: "agendaram", para: "realizadas", dono: "COM", doRobo: false },
  fechou: { de: "realizadas", para: "vendas", dono: "ESP", doRobo: false },
};

/** O acumulador de uma junta (as contagens + os travados por grupo da Fila). */
class Junta {
  readonly j: JuntaDoProcesso;
  private readonly porGrupo = new Map<FilaEtapa, number>();
  constructor(id: JuntaId) {
    this.j = { id, ...JUNTA_META[id], entradas: 0, passaram: 0, outroCaminho: 0, emAndamento: 0, travados: 0, encerrados: 0, abertos: 0, destino: null };
    if (id === "robo-falou") this.j.semFala = { semWhatsapp: 0, naoChegou: 0, naoFalou: 0 };
  }
  /** Julga uma pessoa: devolve se ela PASSOU (segue para a próxima junta da cadeia). */
  julgar(o: {
    passou: boolean;
    outroCaminho: boolean;
    emAndamento: () => boolean;
    encerrado: () => boolean;
    item: FilaItem | undefined;
    semFala?: () => "semWhatsapp" | "naoChegou" | "naoFalou";
  }): boolean {
    const j = this.j;
    j.entradas += 1;
    if (o.passou) {
      j.passaram += 1;
      return true;
    }
    if (o.outroCaminho) j.outroCaminho += 1;
    else if (o.emAndamento()) j.emAndamento += 1;
    else {
      j.travados += 1;
      if (o.encerrado()) j.encerrados += 1;
      else j.abertos += 1;
      if (j.semFala && o.semFala) j.semFala[o.semFala()] += 1;
      if (o.item) this.porGrupo.set(o.item.etapa, (this.porGrupo.get(o.item.etapa) ?? 0) + 1);
    }
    return false;
  }
  fechar(): JuntaDoProcesso {
    let destino: FilaEtapa | null = null;
    let max = 0;
    for (const [g, n] of this.porGrupo) {
      if (n > max || (n === max && destino && FILA_ETAPAS[g].profundidade > FILA_ETAPAS[destino].profundidade)) {
        destino = g;
        max = n;
      }
    }
    this.j.destino = destino;
    return this.j;
  }
}

export function funilDoProcesso(e: EntradaDoProcesso): FunilDoProcesso {
  const c = classificar(e);
  const { coorte, comRobo, parada } = c;
  const leads = e.kpis.leads.valor;
  const agora = Date.parse(e.agora);
  const refMs = Date.parse(c.ref);

  // ---- confirmação registrada (o campo ou o evento da ficha; a remarcação limpa o campo, não o evento) ----
  const confirmadosPorEvento = new Set<string>();
  for (const ev of e.eventos) if (ev.action === "ficha" && ev.payload?.fato === "reuniao_confirmada") confirmadosPorEvento.add(ev.leadId);
  const temConfirmacao = (l: Lead) => Boolean(l.reuniaoConfirmadaEm) || confirmadosPorEvento.has(l.id);

  // ---- os marcos do episódio, por lead da coorte (a ponte e as juntas) ----
  const eventosDe = eventosPorLead([...e.eventos]);
  const marcos = new Map(coorte.map((l) => [l.id, marcosDoEpisodio(l, c.reabertos.get(l.id), eventosDe.get(l.id) ?? [])]));
  /** Agendou DEPOIS do aceite, neste episódio (a régua de `agendouDepoisDoAceite`, com a data do episódio). */
  const agendouAposAceite = (l: Lead, aceitouEm: string) => {
    const em = marcos.get(l.id)?.agendouEm;
    return em != null && Date.parse(em) >= Date.parse(aceitouEm);
  };

  // ---- a passada pelos degraus (P, com teste e duplicado) ----
  let noRobo = 0;
  let primeira = 0;
  let responderam = 0;
  let aceitaram = 0;
  let peloConvite = 0;
  let confirmaram = 0;
  let antesDaConfirmacao = false;
  let desistiram = 0;
  let realizadasSemConfirmacao = 0;
  for (const l of coorte) {
    const booked = isBooked(l);
    if (booked && temConfirmacao(l)) confirmaram += 1;
    if (booked && diaDoLead(l.meetingFor ?? l.bookedAt ?? l.createdAt) < CONFIRMACAO_DESDE) antesDaConfirmacao = true;
    if (everBooked(l) && !booked) desistiram += 1;
    if (isAttended(l) && !temConfirmacao(l)) realizadasSemConfirmacao += 1;
    const x = c.porLead.get(l.id);
    if (!comRobo || x?.motivo !== "com-robo") continue;
    noRobo += 1;
    // Os fatos do trecho — a MESMA função das linhas da Mídia (`trechoDoRoboPorLinha`).
    const f = fatosDoTrecho(x.s);
    if (!f.falou) continue;
    primeira += 1;
    if (!f.respondeu) continue;
    responderam += 1;
    if (!f.aceitou) continue;
    aceitaram += 1;
    if (booked && agendouAposAceite(l, x.s.aceitouEm!)) peloConvite += 1;
  }

  const contagem: Record<DegrauId, number> = {
    leads,
    "com-robo": noRobo,
    "primeira-msg": primeira,
    responderam,
    aceitaram,
    agendaram: e.kpis.agendaram.valor,
    confirmaram,
    realizadas: e.kpis.overview.attended,
    vendas: e.kpis.overview.clients,
  };
  const pisoDe = (id: DegrauId) => (DO_ROBO.has(id) ? parada : id === "confirmaram" ? antesDaConfirmacao : false);
  const ordem: DegrauId[] = comRobo
    ? ["leads", "com-robo", "primeira-msg", "responderam", "aceitaram", "agendaram", "confirmaram", "realizadas", "vendas"]
    : ["leads", "agendaram", "confirmaram", "realizadas", "vendas"];
  const degraus = ordem.map((id): DegrauDoProcesso => {
    const n = contagem[id];
    const piso = pisoDe(id);
    const baseId = BASE_DO_DEGRAU[id];
    const r = taxaDe(id, n, baseId ? { id: baseId, n: contagem[baseId], piso: pisoDe(baseId) } : null, piso);
    const semTaxa = r.semTaxa;
    // "Um número por métrica": a taxa de Agendaram é a de `kpisDoPeriodo`; a de
    // Reuniões realizadas, o comparecimento da coorte (`showRate`, K2).
    const taxa =
      r.taxa === null
        ? null
        : id === "agendaram"
          ? Math.min(1, e.kpis.taxaLeadAgendada.valor)
          : id === "realizadas"
            ? e.kpis.overview.showRate
            : r.taxa;
    return {
      id,
      rotulo: ROTULO_DO_DEGRAU[id],
      n,
      texto: `${piso ? "≥ " : ""}${formatInt(n)}`,
      base: baseId,
      taxa,
      semTaxa,
      recuo: RECUADOS.has(id),
      daAncora: leads > 0 ? n / leads : null,
      piso,
      dono: DONO_DO_DEGRAU[id],
      fonte: DO_ROBO.has(id) ? "robo" : "crm",
      doRobo: DO_ROBO.has(id),
      dica: DICA_DO_DEGRAU[id],
    };
  });
  const dAceitaram = degraus.find((d) => d.id === "aceitaram");
  const ponte =
    comRobo && dAceitaram && aceitaram > 0
      ? {
          aceitaram,
          peloConvite,
          // Com a leitura parada, "pelo convite" também é o mínimo: quem aceitou e agendou
          // depois da última leitura está em Agendaram, mas o aceite dele ainda não foi lido.
          texto: `${dAceitaram.piso ? "≥ " : ""}${formatInt(peloConvite)} pelo convite do robô, de ${dAceitaram.texto} que ${aceitaram === 1 ? "aceitou" : "aceitaram"}`,
        }
      : null;

  // ---- as juntas (P' = P − testes − cópias de duplicado; sem a live) ----
  const { testes, duplicados } = testesEDuplicados(e.data.leads);
  const fila = e.fila ?? montarFila({ nowIso: e.agora, leads: e.data.leads, eventos: [...e.eventos], robo: c.robo });
  // O item da Fila da PESSOA: a Fila deduplica por telefone (`chaveTelefoneValida`) e fica
  // com o `leadId` de UM cadastro — no empate de etapa, o primeiro da lista, que pode ser a
  // cópia (fora de P'). Sem item próprio, o lead herda o do mesmo telefone (a chave do dedupe).
  const itemDe = new Map<string, FilaItem>();
  const itemDoTelefone = new Map<string, FilaItem>();
  for (const it of fila.itens) {
    if (it.leadId && !itemDe.has(it.leadId)) itemDe.set(it.leadId, it);
    const tel = chaveTelefoneValida(it.telefone);
    if (tel && !itemDoTelefone.has(tel)) itemDoTelefone.set(tel, it);
  }
  const itemDaPessoa = (l: Lead): FilaItem | undefined => {
    const proprio = itemDe.get(l.id);
    if (proprio) return proprio;
    const tel = chaveTelefoneValida(l.phone);
    return tel ? itemDoTelefone.get(tel) : undefined;
  };
  const reunioesTel = reunioesPorTelefone(e.data.leads);
  const foraDasJuntas = { testes: 0, duplicados: 0, live: 0, antes: 0 };

  const ids: JuntaId[] = comRobo
    ? ["robo-falou", "respondeu", "aceitou", "agendou-apos-aceite", "fora-agendou", "realizou", "fechou"]
    : ["agendou", "realizou", "fechou"];
  const juntas = new Map<JuntaId, Junta>(ids.map((id) => [id, new Junta(id)]));
  const J = (id: JuntaId) => juntas.get(id)!;
  const prazoConvite = FILA_ETAPAS["convite-aceito"].slaHoras;
  const prazoSemDesfecho = FILA_ETAPAS["sem-desfecho"].slaHoras;

  for (const l of coorte) {
    if (testes.has(l.id)) {
      foraDasJuntas.testes += 1;
      continue;
    }
    if (duplicados.has(l.id)) {
      foraDasJuntas.duplicados += 1;
      continue;
    }
    const x = c.porLead.get(l.id);
    const reabertoEm = c.reabertos.get(l.id);
    const m = marcos.get(l.id)!;
    const item = itemDaPessoa(l);
    const perdido = () => isLostStatus(l.status);
    const live = Boolean(classeDoLead(l));

    // ---- antes de Agendaram: UMA cadeia por pessoa (robô, fora-agendou ou agendou) ----
    if (live) {
      // F3-D1: a Fila da live (congelada) cuida deles; nenhuma junta antes de Agendaram os julga.
      foraDasJuntas.live += 1;
    } else if (comRobo && x?.motivo === "com-robo") {
      const s = x.s;
      const enc = encerramentoDoRobo(l, reabertoEm);
      const encerradoRobo = () => perdido() || enc != null;
      const aberto = leadAberto(l);
      /** K7: a conversa teve atividade (robô, pessoa, cobrança ou tentativa do comercial) nas últimas 48 h. */
      const conversaAtiva = () => {
        const ultimaTentativa = resumoContato(eventosDe.get(l.id) ?? []).ultima;
        const atividade = Math.max(
          ...[
            fatoDoEpisodio(l.roboUltimaInteracaoEm, reabertoEm),
            fatoDoEpisodio(l.roboUltimaMsgClienteEm, reabertoEm),
            fatoDoEpisodio(l.roboUltimaCobrancaEm, reabertoEm),
            s.falouEm,
            ultimaTentativa,
          ]
            .map(ms)
            .filter(Number.isFinite),
        );
        return Number.isFinite(atividade) && atividade + CONVERSA_PARADA_H * H_MS > refMs;
      };
      /*
       * O relógio do robô (as 2 h e as 24 h, `s.resgate`) só corre para quem ainda não
       * falou com ele: quem já respondeu (ou aceitou) sem a fala do robô registrada no
       * episódio — escreveu primeiro, ou o robô ficou pausado depois de um reaberto —
       * nunca entra no Resgate, e sem prazo ficaria "no prazo" para sempre. O prazo dele é
       * o da conversa: 48 h sem atividade (K7, a régua de `aceitou`).
       */
      const engajou = s.respondeu || Boolean(s.aceitouEm);
      const noPrazoDoRobo = () => aberto && !enc && (engajou ? conversaAtiva() : !s.resgate);
      const passouFala = J("robo-falou").julgar({
        passou: Boolean(s.falouEm),
        outroCaminho: m.chegouEp,
        emAndamento: noPrazoDoRobo,
        encerrado: encerradoRobo,
        item,
        semFala: () =>
          s.etapa === "sem_whatsapp"
            ? "semWhatsapp"
            : !engajou && !fatoDoEpisodio(l.roboVistoEm, reabertoEm)
              ? "naoChegou"
              : "naoFalou",
      });
      const passouResposta =
        passouFala &&
        J("respondeu").julgar({
          passou: s.respondeu,
          outroCaminho: m.chegouEp,
          emAndamento: noPrazoDoRobo,
          encerrado: encerradoRobo,
          item,
        });
      const passouAceite =
        passouResposta &&
        J("aceitou").julgar({
          passou: Boolean(s.aceitouEm),
          outroCaminho: m.chegouEp,
          emAndamento: () => aberto && !enc && conversaAtiva(),
          encerrado: encerradoRobo,
          item,
        });
      if (passouAceite) {
        const aceitouEm = s.aceitouEm!;
        const tel = chaveTelefoneValida(l.phone);
        const outroCadastro = tel ? reunioesTel.get(tel) : undefined;
        J("agendou-apos-aceite").julgar({
          passou: m.bookedEp && agendouAposAceite(l, aceitouEm),
          outroCaminho: m.chegouEp || (outroCadastro !== undefined && ms(outroCadastro) >= ms(aceitouEm)),
          emAndamento: () => aberto && horasUteisEntre(aceitouEm, e.agora) <= prazoConvite,
          encerrado: perdido,
          item,
        });
      }
    } else if (comRobo) {
      // Fora do robô (K1). F3-D31: o de antes de 29/10 sem item na Fila não tem processo
      // (D5) — fica fora das juntas, contado no ⓘ.
      const motivo = x?.motivo;
      if (motivo === "antes" && !item) foraDasJuntas.antes += 1;
      else
        J("fora-agendou").julgar({
          passou: m.bookedEp,
          outroCaminho: m.chegouEp,
          emAndamento: () => leadAberto(l) && (item ? item.atraso <= 1 : motivo !== "antes"),
          encerrado: perdido,
          item,
        });
    } else {
      J("agendou").julgar({
        passou: m.bookedEp,
        outroCaminho: m.chegouEp,
        // Robô desligado: o prazo do grupo da Fila (fora dela, quem a cadência escondeu está
        // sendo trabalhado). Robô ligado com o período todo antes dele: fora da Fila = sem processo (D5).
        emAndamento: () => leadAberto(l) && (c.robo ? item !== undefined && item.atraso <= 1 : !(item && item.atraso > 1)),
        encerrado: perdido,
        item,
      });
    }

    // ---- de Agendaram em diante: a reunião é fato da coorte (a live inclusive) ----
    if (m.everEp) {
      J("realizou").julgar({
        passou: m.attendedEp,
        outroCaminho: false,
        emAndamento: () => {
          if (l.status !== "agendado") return false;
          if (l.meetingFor) return horasUteisEntre(l.meetingFor, e.agora) <= prazoSemDesfecho;
          return ms(m.agendouEm ?? l.bookedAt ?? l.createdAt) + 7 * DIA_MS > agora;
        },
        encerrado: perdido,
        item,
      });
    }
    if (m.attendedEp) {
      J("fechou").julgar({
        passou: m.clientEp,
        outroCaminho: false,
        emAndamento: () => !perdido() && ms(l.attendedAt ?? l.meetingFor ?? l.bookedAt ?? l.createdAt) + NEGOCIACAO_DIAS * DIA_MS > agora,
        encerrado: perdido,
        item,
      });
    }
  }

  return {
    comRobo,
    parada,
    leituraParada: linhaDaLeituraParada(c.robo, e.agora),
    leads,
    noRobo: comRobo ? noRobo : 0,
    fora: comRobo ? c.fora : foraZerado(),
    degraus,
    ponte,
    juntas: ids.map((id) => J(id).fechar()),
    foraDasJuntas,
    desistiram,
    realizadasSemConfirmacao,
    recorte: recorteDoFunil(e.range),
  };
}

// ---------------------------------------------------------------- o recorte

/**
 * Os degraus pedidos, na ordem pedida. Se a `base` de um degrau saiu do recorte,
 * sobe pela cadeia de bases até um id mantido e recalcula a taxa com a mesma régua
 * (`taxaDe`); a base mantida conserva a taxa do funil inteiro (a de `kpis` em
 * Agendaram e Reuniões realizadas). Os dois recortes de hoje não sobem: com K2,
 * `realizadas.base` já é `agendaram`.
 */
export function recortarProcesso(f: FunilDoProcesso, ids: readonly DegrauId[]): DegrauDoProcesso[] {
  const porId = new Map(f.degraus.map((d) => [d.id, d]));
  const mantidos = new Set(ids.filter((id) => porId.has(id)));
  const out: DegrauDoProcesso[] = [];
  for (const id of ids) {
    const d = porId.get(id);
    if (!d) continue;
    if (d.base === null || mantidos.has(d.base)) {
      out.push({ ...d });
      continue;
    }
    let base: DegrauId | null = d.base;
    while (base !== null && !mantidos.has(base)) base = BASE_DO_DEGRAU[base];
    const b = base ? porId.get(base)! : null;
    const { taxa, semTaxa } = taxaDe(d.id, d.n, b ? { id: b.id, n: b.n, piso: b.piso } : null, d.piso);
    out.push({ ...d, base, taxa, semTaxa });
  }
  return out;
}
