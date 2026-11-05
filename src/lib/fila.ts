/**
 * A FILA ÚNICA — para quem ligar agora, nesta ordem.
 *
 * Com o robô de WhatsApp LIGADO (Fase 1, nov/26), o 1º contato é dele e a Fila
 * do comercial tem quatro grupos, nesta ordem fixa:
 *
 *   1. Resgate              — quem ficou sem conversa com o robô (sem resposta em
 *                             24 h, sem WhatsApp, sem telefone, o robô não falou),
 *                             quem faltou à reunião e o retorno de quem já estava
 *                             sendo trabalhado antes do robô (`ResgateMotivo`);
 *   2. Aceitou o convite    — recebeu o link do Calendly: conferir e registrar a data;
 *   3. Reuniões a confirmar — reunião nas próximas 48 h, ainda sem confirmação;
 *   4. Reuniões sem desfecho.
 *
 * Quem está COM o robô (em conversa, esperando resposta, encerrado) não está na
 * Fila — aparece só na barra "Com o robô agora" (`comRobo`). Tudo sai do store:
 * os fatos que o sync do robô gravou no lead (`situacaoDoRobo`), nunca o banco do
 * robô no render.
 *
 * Com o robô DESLIGADO (sem credencial, desativado em Configurações, ou outra
 * marca) o processo antigo volta inteiro: "Novos — ligar agora" (1 hora útil),
 * "Retornar hoje", e as reuniões. Desligado não é erro.
 *
 * ORDEM: por grupo, na ordem fixa; dentro do grupo, por quanto cada um estourou
 * o SEU prazo (atraso relativo = horas ÷ SLA), não por idade crua. A mesma pessoa
 * com dois cadastros aparece uma vez (dedupe por telefone, vence a etapa mais funda).
 *
 * Função PURA: recebe os leads e os eventos já carregados e devolve a fila.
 */

import { formatarEspera } from "./format";
import { everBooked } from "./metrics";
import { chaveTelefoneValida } from "./phone";
import { horasUteisEntre, somarHorasUteis } from "./horario-util";
import { eventosPorLead, resumoContato, type ResumoContato } from "./contato";
import { classeDoLead } from "./qualificacao";
import {
  agendouDepoisDoAceite,
  casaFiltroRobo,
  leadAberto,
  primeiroNome,
  reabertoDe,
  reabertoNoPainelDe,
  refDoRobo,
  situacaoDoRobo,
  type ResgateMotivo,
  type RoboNaFila,
} from "./robo/situacao";
import type { Lead, LeadEvent, LeadStatus } from "./types";
// Só o tipo (fila-live importa HORAS_APOS_CONVERSA daqui: nada de ciclo em runtime).
import type { ItemDaFilaLive } from "./fila-live";

// ---------------------------------------------------------------- vocabulário

/**
 * Os grupos da Fila. Com o robô ligado só existem os quatro primeiros; `novo` e
 * `retornar` são do robô desligado (o processo antigo, intacto).
 */
export type FilaEtapa = "resgate" | "convite-aceito" | "confirmar" | "sem-desfecho" | "novo" | "retornar";
export type FilaDono = "COM" | "BOT";

export interface EtapaMeta {
  label: string;
  /** Prazo em horas a partir do qual o item está atrasado. */
  slaHoras: number;
  /** O prazo conta só horas úteis (`lib/horario-util.ts`), não corridas. */
  horasUteis?: boolean;
  dono: FilaDono;
  /** UMA frase (≤ 12 palavras): o que aconteceu — vira o ⓘ do grupo. */
  hint: string;
  /** Quanto mais fundo no funil, mais caro foi chegar até aqui (vence no dedupe). */
  profundidade: number;
}

/** Fonte ÚNICA dos prazos e rótulos dos grupos. */
export const FILA_ETAPAS: Record<FilaEtapa, EtapaMeta> = {
  resgate: {
    label: "Resgate",
    slaHoras: 2,
    horasUteis: true,
    dono: "COM",
    hint: "Sem conversa com o robô, ou faltou à reunião: retome o contato.",
    profundidade: 1.5,
  },
  "convite-aceito": {
    label: "Aceitou o convite",
    slaHoras: 2,
    horasUteis: true,
    dono: "COM",
    hint: "Recebeu o link do Calendly: confira o agendamento e registre a data.",
    profundidade: 3,
  },
  confirmar: {
    label: "Reuniões a confirmar",
    slaHoras: 48,
    dono: "COM",
    hint: "Reunião nas próximas 48 horas — confirme com a pessoa.",
    profundidade: 4,
  },
  "sem-desfecho": {
    label: "Reuniões sem desfecho",
    slaHoras: 24,
    horasUteis: true,
    dono: "COM",
    hint: "A data da reunião passou e ninguém registrou se ela aconteceu.",
    profundidade: 5,
  },
  /*
   * Robô desligado: o comercial faz o 1º contato. O prazo era 48h; quem tenta na
   * 1ª hora qualifica ~7× mais que quem tenta uma hora depois (HBR, 2011).
   */
  novo: {
    label: "Novos — ligar agora",
    slaHoras: 1,
    horasUteis: true,
    dono: "COM",
    hint: "Entrou e ninguém tentou contato. Prazo: 1 hora útil.",
    profundidade: 1,
  },
  retornar: {
    label: "Retornar hoje",
    slaHoras: 4,
    horasUteis: true,
    dono: "COM",
    hint: "Já houve tentativa e o retorno combinado pela cadência venceu.",
    profundidade: 1.5,
  },
};

/** A ordem fixa dos grupos com o robô ligado. */
export const GRUPOS_COM_ROBO: readonly FilaEtapa[] = ["resgate", "convite-aceito", "confirmar", "sem-desfecho"];
/** A ordem fixa dos grupos com o robô desligado (o processo antigo). */
export const GRUPOS_SEM_ROBO: readonly FilaEtapa[] = ["novo", "retornar", "confirmar", "sem-desfecho"];

/** Os grupos que existem nesta operação, na ordem da página. */
export function gruposDaFila(roboLigado: boolean): readonly FilaEtapa[] {
  return roboLigado ? GRUPOS_COM_ROBO : GRUPOS_SEM_ROBO;
}

/**
 * Prazo do 1º contato HUMANO (1 hora útil) — o KPI "1º contato no prazo", o Funil
 * e Leads leem daqui. Derivado de `FILA_ETAPAS.novo` (fonte única).
 */
export const SLA_PRIMEIRO_CONTATO_HORAS = FILA_ETAPAS.novo.slaHoras;

/**
 * Horas sem desfecho depois de falar com a pessoa até ela voltar à fila.
 * Exportado para a vista de Leads dizer QUANDO ela volta — o "—" de quem tem
 * esse relógio correndo não é "nada pendente". Fonte única do prazo.
 */
export const HORAS_APOS_CONVERSA = 24;
/** Reunião agendada antes de existir data (legado): sem desfecho depois disto. */
const DIAS_AGENDADO_SEM_DATA = 7;
/** "Retorno" de quem já estava sendo trabalhado antes do robô: tentativa humana nos últimos N dias. */
export const DIAS_RETORNO_ANTES_DO_ROBO = 7;

/**
 * Links antigos (`?etapa=`) → o grupo de hoje, ou `null` = o topo da Fila. Os avisos
 * já enviados por WhatsApp e os links guardados (do farol, das ações da semana)
 * continuam abrindo a Fila; as frases do Atendimento do Início usam `?etapa=<grupo>`.
 *  - robô ligado: novo / retornar / sem-status → resgate; aguardando-contato →
 *    aceitou o convite; convite-pendente, quentes, todos → topo;
 *  - robô desligado: novo, retornar, as reuniões como sempre; sem-status → novo;
 *    resgate → novo (o mais perto: ninguém tentou); o resto → topo.
 */
export function grupoDaUrl(etapa: string | string[] | undefined | null, roboLigado: boolean): FilaEtapa | null {
  // `?etapa=a&etapa=b` chega como lista (Next): vale o primeiro — nunca derruba a página.
  const bruto = Array.isArray(etapa) ? etapa[0] : etapa;
  const e = (typeof bruto === "string" ? bruto : "").trim();
  if (e === "confirmar" || e === "sem-desfecho") return e;
  if (roboLigado) {
    if (e === "resgate" || e === "novo" || e === "retornar" || e === "sem-status") return "resgate";
    if (e === "convite-aceito" || e === "aguardando-contato") return "convite-aceito";
    return null;
  }
  if (e === "novo" || e === "sem-status" || e === "resgate") return "novo";
  if (e === "retornar") return "retornar";
  return null;
}

export interface FilaItem {
  /** Chave estável para React e para as ações. */
  id: string;
  etapa: FilaEtapa;
  nome: string;
  telefone?: string;
  email?: string;
  /** Desde quando está esperando NESTA etapa. */
  desde?: string;
  horasEsperando?: number;
  /** horasEsperando ÷ slaHoras. Acima de 1 = fora do prazo. É a ordenação no grupo. */
  atraso: number;
  /** Lead no painel — habilita mudar status. */
  leadId?: string;
  /** Status atual do lead do painel (decide quais desfechos aparecem). */
  status?: LeadStatus;
  /** O lead do painel já teve reunião marcada — só então "Desistência" é opção. */
  jaAgendou?: boolean;
  /** Tentativas de contato já feitas (painel). */
  contato?: ResumoContato;
  /** Data da reunião (confirmar / sem desfecho). */
  reuniao?: string;
  /** Até quando cumpre o prazo: "vence às…". */
  venceEm?: string;
  /** Por que está no resgate (só no grupo Resgate). */
  motivo?: ResgateMotivo;
  /** Outras etapas em que esta mesma pessoa também aparece. */
  tambemEm: FilaEtapa[];
}

/** Um grupo da página: as pessoas, o total e quantas passaram do prazo. */
export interface FilaGrupo {
  etapa: FilaEtapa;
  itens: FilaItem[];
  total: number;
  /** "Reuniões a confirmar" não tem "fora do prazo" (o prazo é a própria reunião). */
  foraDoPrazo: number;
}

/** Uma entrada no resgate pelo robô (a chave do aviso ao n8n é `id:motivo:desde`). */
export interface EntradaDeResgate {
  /** O id do lead. */
  id: string;
  primeiroNome: string | null;
  motivo: ResgateMotivo;
  desde: string;
}

export interface FilaResult {
  /** Todas as pessoas, na ordem da página (grupo a grupo). */
  itens: FilaItem[];
  /** Os grupos que existem nesta operação, na ordem fixa — a ÚNICA contagem por grupo (título, aba, C1, aviso). */
  grupos: FilaGrupo[];
  /** Pessoas distintas — menor que a soma das filas quando há sobreposição. */
  total: number;
  /** "Com o robô agora" (`casaFiltroRobo`): em conversa, esperando resposta, encerrados. Zero com o robô desligado. */
  comRobo: { emConversa: number; esperando: number; encerrados: number };
  /**
   * As entradas no resgate PELO ROBÔ dos leads que a Fila considera — inclusive
   * quem a cadência humana escondeu do grupo agora (isso não é saída do resgate).
   * Uma por pessoa (telefone); quem já está num grupo mais fundo fica de fora. É o
   * `naFila` do aviso de resgate.
   */
  entradasDeResgate: EntradaDeResgate[];
}

// ---------------------------------------------------------------- entradas

export interface FilaInput {
  nowIso: string;
  /** Leads do painel. Só os que ainda não têm desfecho entram. */
  leads: Lead[];
  /** Histórico dos leads (tentativas de contato, reaberto). Sem ele, ninguém está "em retorno". */
  eventos?: LeadEvent[];
  /** O robô (`estadoDoRoboAgora`) — a MESMA entrada em /fila, no motor e no aviso. Ausente = desligado. */
  robo?: RoboNaFila;
}

// ---------------------------------------------------------------- montagem

function horasDesde(iso: string | null | undefined, now: number): number | undefined {
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return undefined;
  return Math.max(0, (now - t) / 3_600_000);
}

/**
 * Atraso relativo ao prazo da etapa. Sem carimbo de tempo assumimos que está
 * no prazo (0) em vez de no topo: um dado faltando não é uma emergência, e
 * colocá-lo em primeiro empurraria para baixo quem realmente está atrasado.
 */
function calcAtraso(horas: number | undefined, slaHoras: number): number {
  if (horas === undefined) return 0;
  return horas / slaHoras;
}

export function montarFila(input: FilaInput): FilaResult {
  const now = new Date(input.nowIso).getTime();
  const ligado = Boolean(input.robo?.ligado);
  const robo = ligado ? input.robo : undefined;
  const itens: FilaItem[] = [];
  const porLead = eventosPorLead(input.eventos ?? []);
  const leads = input.leads.filter((l) => !l.deletedAt);
  const ctx: ContextoDaEtapa = { reunioesPorTelefone: reunioesPorTelefone(leads) };

  for (const l of leads) {
    const etapa = etapaDoLead(l, porLead.get(l.id) ?? [], input.nowIso, robo, ctx);
    if (!etapa) continue;
    const { nome: e, desde, horasUteis, reuniao, venceEm, contato, motivo } = etapa;
    const meta = FILA_ETAPAS[e];
    itens.push({
      id: `lead:${l.id}`,
      etapa: e,
      nome: l.name,
      telefone: l.phone,
      email: l.email,
      desde,
      horasEsperando: horasDesde(desde, now),
      atraso: e === "confirmar" ? etapa.atraso! : calcAtraso(horasUteis, meta.slaHoras),
      leadId: l.id,
      status: l.status,
      jaAgendou: everBooked(l),
      contato,
      reuniao,
      venceEm,
      motivo,
      tambemEm: [],
    });
  }

  /*
   * Dedupe por telefone: a mesma pessoa cadastrada duas vezes (enviou o formulário
   * de novo, veio por outro caminho) aparece uma vez. Vence a etapa mais funda —
   * se ela já tem reunião, é lá que a ação acontece; as outras aparições viram
   * etiqueta no mesmo cartão. Só telefone UTILIZÁVEL agrupa (`chaveTelefoneValida`,
   * a régua da identidade e do casamento com o robô): duas pessoas com o mesmo
   * lixo ("123") são duas pessoas — juntar escondia uma, sem dono (nov/26, nos
   * dois modos).
   */
  const porTelefone = new Map<string, FilaItem>();
  const finais: FilaItem[] = [];
  for (const item of itens) {
    const chave = chaveTelefoneValida(item.telefone);
    if (!chave) {
      finais.push(item);
      continue;
    }
    const existente = porTelefone.get(chave);
    if (!existente) {
      porTelefone.set(chave, item);
      finais.push(item);
      continue;
    }
    const a = FILA_ETAPAS[existente.etapa].profundidade;
    const b = FILA_ETAPAS[item.etapa].profundidade;
    const vencedor = b > a ? item : existente;
    const perdedor = b > a ? existente : item;
    // Herda o que o outro registro sabia e o outro só não tinha.
    vencedor.email ??= perdedor.email;
    vencedor.leadId ??= perdedor.leadId;
    // Só etiqueta quando a outra aparição é de OUTRA etapa. Duas linhas da mesma
    // etapa com o mesmo telefone são a mesma pessoa cadastrada duas vezes —
    // fundir basta, etiquetar confundiria.
    if (perdedor.etapa !== vencedor.etapa && !vencedor.tambemEm.includes(perdedor.etapa)) {
      vencedor.tambemEm.push(perdedor.etapa);
    }
    // A espera que vale é a da etapa que venceu, mas se a pessoa está parada há
    // mais tempo na outra, é esse relógio que o comercial precisa ver. O atraso
    // fica na régua do grupo que VENCEU: na mesma etapa, o do outro já está nela;
    // em outra, a espera do outro em horas ÚTEIS quando o grupo conta úteis, e "a
    // confirmar" mantém a proximidade da reunião (é a ordem dele, não espera). Até
    // nov/26 o atraso era refeito com as horas CORRIDAS ÷ um prazo em úteis — um par
    // de cadastros antes das 9h estourava 1 hora útil que não tinha passado, e a
    // reunião de amanhã perdia o lugar na fila de confirmar (vale nos dois modos).
    if (
      perdedor.horasEsperando !== undefined &&
      (vencedor.horasEsperando === undefined || perdedor.horasEsperando > vencedor.horasEsperando)
    ) {
      vencedor.horasEsperando = perdedor.horasEsperando;
      vencedor.desde = perdedor.desde;
      if (perdedor.etapa === vencedor.etapa) vencedor.atraso = perdedor.atraso;
      else if (vencedor.etapa !== "confirmar") {
        const meta = FILA_ETAPAS[vencedor.etapa];
        const horas =
          meta.horasUteis && perdedor.desde ? horasUteisEntre(perdedor.desde, input.nowIso) : perdedor.horasEsperando;
        vencedor.atraso = Math.max(vencedor.atraso, calcAtraso(horas, meta.slaHoras));
      }
    }
    if (vencedor !== existente) {
      finais.splice(finais.indexOf(existente), 1, vencedor);
      porTelefone.set(chave, vencedor);
    }
  }

  // Por grupo, na ordem fixa; dentro dele, o mais atrasado primeiro.
  const ordem = gruposDaFila(ligado);
  const noGrupo = (a: FilaItem, b: FilaItem) =>
    b.atraso - a.atraso || (b.horasEsperando ?? 0) - (a.horasEsperando ?? 0) || a.id.localeCompare(b.id);
  const grupos: FilaGrupo[] = ordem.map((etapa) => {
    const doGrupo = finais.filter((i) => i.etapa === etapa).sort(noGrupo);
    return {
      etapa,
      itens: doGrupo,
      total: doGrupo.length,
      foraDoPrazo: etapa === "confirmar" ? 0 : doGrupo.filter((i) => i.atraso > 1).length,
    };
  });
  const ordenados = grupos.flatMap((g) => g.itens);

  // ---- o robô: a barra e as entradas no resgate (as mesmas pessoas, o mesmo recorte) ----
  const comRobo = { emConversa: 0, esperando: 0, encerrados: 0 };
  const entradas = new Map<string, EntradaDeResgate>();
  if (ligado && robo) {
    const ref = refDoRobo(robo, input.nowIso);
    const grupoDoTelefone = new Map<string, FilaEtapa>();
    for (const [chave, item] of porTelefone) grupoDoTelefone.set(chave, item.etapa);
    for (const l of leads) {
      const evs = porLead.get(l.id) ?? [];
      const reabertoEm = reabertoDe(evs);
      const s = situacaoDoRobo(l, { agora: input.nowIso, ref, ligado: true, reabertoEm, reabertoNoPainel: reabertoNoPainelDe(evs) });
      const ctx = { agora: input.nowIso, reabertoEm };
      if (casaFiltroRobo(l, "em-conversa", s, ctx)) comRobo.emConversa += 1;
      else if (casaFiltroRobo(l, "esperando", s, ctx)) comRobo.esperando += 1;
      else if (casaFiltroRobo(l, "encerrado", s, ctx)) comRobo.encerrados += 1;
      if (!s.resgate) continue;
      const tel = chaveTelefoneValida(l.phone);
      // A mesma pessoa já está num grupo mais fundo (outro cadastro com reunião): não é resgate.
      const grupo = tel ? grupoDoTelefone.get(tel) : undefined;
      if (grupo && grupo !== "resgate") continue;
      const entrada: EntradaDeResgate = { id: l.id, primeiroNome: primeiroNome(l.name), motivo: s.resgate.motivo, desde: s.resgate.desde };
      const chave = tel ?? `lead:${l.id}`;
      const atual = entradas.get(chave);
      // Uma por pessoa: a que espera há mais tempo (depois o id, para ser estável).
      if (!atual || entrada.desde < atual.desde || (entrada.desde === atual.desde && entrada.id < atual.id)) {
        entradas.set(chave, entrada);
      }
    }
  }

  return {
    itens: ordenados,
    grupos,
    total: ordenados.length,
    comRobo,
    entradasDeResgate: [...entradas.values()].sort((a, b) => a.desde.localeCompare(b.desde) || a.id.localeCompare(b.id)),
  };
}

/**
 * Quantas PESSOAS esperam o comercial agora — o número do título da Fila (a aba
 * do navegador) e do bloco "Atendimento" do Início, a MESMA conta nas duas telas.
 * Pessoas, não aparições: um A ou B da live que aceitou o convite está na Fila da
 * live E em "Aceitou o convite" — conta uma vez. Entram: os A e B da live na 1ª
 * tentativa; com o robô, o Resgate e o "Aceitou o convite"; sem o robô, os Novos.
 * As reuniões (confirmar, sem desfecho) não são "esperando o 1º contato".
 */
export function esperandoOComercial(
  fila: Pick<FilaResult, "grupos">,
  filaLive: readonly Pick<ItemDaFilaLive, "leadId" | "etapa">[],
  roboLigado: boolean,
): number {
  const etapas: readonly FilaEtapa[] = roboLigado ? ["resgate", "convite-aceito"] : ["novo"];
  return new Set([
    ...filaLive.filter((i) => i.etapa === "primeira").map((i) => i.leadId),
    ...etapas.flatMap((e) => (fila.grupos.find((g) => g.etapa === e)?.itens ?? []).map((i) => i.leadId ?? i.id)),
  ]).size;
}

/**
 * Telefone (`chaveTelefoneValida`) → o agendamento mais recente (`bookedAt`) entre
 * os leads ativos. "Aceitou o convite" não pede a reunião de novo a quem a mesma
 * pessoa já agendou por OUTRO cadastro depois de aceitar (11.4: o aceite chega a
 * todos os cadastros com aquele telefone) — senão a 2ª gravação contava duas
 * reuniões para uma pessoa.
 */
export function reunioesPorTelefone(leads: readonly Lead[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of leads) {
    if (l.deletedAt || !l.bookedAt) continue;
    const tel = chaveTelefoneValida(l.phone);
    if (!tel) continue;
    const atual = out.get(tel);
    if (!atual || Date.parse(l.bookedAt) > Date.parse(atual)) out.set(tel, l.bookedAt);
  }
  return out;
}

/** O que `etapaDoLead` precisa saber dos OUTROS leads da marca (opcional). */
export interface ContextoDaEtapa {
  /** `reunioesPorTelefone` dos leads da marca. */
  reunioesPorTelefone?: ReadonlyMap<string, string>;
}

/**
 * Quem a cadência humana tirou do grupo AGORA (robô ligado): o grupo para onde
 * volta e quando. Não é "fora da Fila": é a mesma conta de `etapaDoLead`, que
 * devolve `null` até `volta`.
 */
export interface VoltaDaCadencia {
  nome: "resgate" | "convite-aceito";
  /** Quando volta ao grupo (ISO). */
  volta: string;
  motivo?: ResgateMotivo;
}

/** `etapaDoLead` com o porquê do `null` que Leads e a ficha precisam dizer. */
export interface EtapaEVolta {
  etapa: EtapaCalculada | null;
  /** Fora do grupo agora só pela cadência humana. */
  volta?: VoltaDaCadencia;
  /** Aceitou o convite, mas a mesma pessoa já agendou por outro cadastro depois. */
  reuniaoEmOutroCadastro?: boolean;
}

interface EtapaCalculada {
  nome: FilaEtapa;
  /** Desde quando esta etapa está esperando. */
  desde: string;
  /** Horas (úteis quando a etapa conta úteis) desde `desde`. */
  horasUteis: number;
  /** Só "confirmar": 0–1, mais perto da reunião = mais alto. */
  atraso?: number;
  reuniao?: string;
  venceEm?: string;
  contato?: ResumoContato;
  /** Só "resgate". */
  motivo?: ResgateMotivo;
}

/** O maior dos instantes (ISO), ignorando vazios. */
function maisTarde(a: string, b: string | undefined): string {
  return b && Date.parse(b) > Date.parse(a) ? b : a;
}

/**
 * Em que grupo da fila um lead do painel está AGORA — ou nenhum (não há nada a
 * fazer com ele neste momento, ou ele está com o robô). Pura; exportada para os
 * testes, para Leads e para a ficha.
 *
 * `robo` = `estadoDoRoboAgora` (ausente ou desligado = o código de antes do robô,
 * intacto). `ctx` = o que vem dos outros leads (`reunioesPorTelefone`).
 */
export function etapaDoLead(
  l: Lead,
  eventos: LeadEvent[],
  nowIso: string,
  robo?: RoboNaFila,
  ctx?: ContextoDaEtapa,
): EtapaCalculada | null {
  return etapaEVoltaDoLead(l, eventos, nowIso, robo, ctx).etapa;
}

/**
 * A MESMA conta de `etapaDoLead`, com o porquê do `null` quando é a cadência
 * humana (`volta`) ou a reunião de outro cadastro — Leads e a ficha dizem isso
 * sem refazer a régua.
 */
export function etapaEVoltaDoLead(
  l: Lead,
  eventos: LeadEvent[],
  nowIso: string,
  robo?: RoboNaFila,
  ctx?: ContextoDaEtapa,
): EtapaEVolta {
  if (l.status === "agendado") return { etapa: etapaDaReuniao(l, nowIso) };
  if (robo?.ligado) return etapaComRobo(l, eventos, nowIso, robo, reabertoDe(eventos), ctx);
  return { etapa: etapaSemRobo(l, eventos, nowIso) };
}

/** Robô desligado: o processo de antes do robô (as reuniões já saíram acima). */
function etapaSemRobo(l: Lead, eventos: LeadEvent[], nowIso: string): EtapaCalculada | null {
  const now = Date.parse(nowIso);
  const uteis = (de: string) => horasUteisEntre(de, nowIso);
  // Lead reaberto (pelo administrador, ou porque preencheu o formulário de novo):
  // o relógio recomeça ali — senão quem voltou hoje entraria com "3 semanas".
  const reaberto = reabertoDe(eventos);
  const desdeReaberto = (base: string) => (reaberto && reaberto > base ? reaberto : base);

  // Lead da ficha da live (com classe): A e B estão na Fila da live, pelo prazo do
  // turno (`lib/fila-live.ts`); C e X ficam fora da Fila. As reuniões (confirmar,
  // registrar desfecho) continuam aqui, para todo mundo.
  if (classeDoLead(l) && leadAberto(l)) return null;

  if (l.status === "lead") {
    const desde = desdeReaberto(l.createdAt);
    return {
      nome: "novo",
      desde,
      horasUteis: uteis(desde),
      venceEm: somarHorasUteis(desde, FILA_ETAPAS.novo.slaHoras),
    };
  }

  if (l.status === "em_contato" || l.status === "no_show") {
    const contato = resumoContato(eventos);
    // Retorno devido: o combinado pela cadência; depois de uma conversa sem
    // desfecho, no dia seguinte; quem não compareceu, a partir da reunião.
    const devido = desdeReaberto(
      l.status === "no_show"
        ? (l.meetingFor ?? contato.ultima ?? l.createdAt)
        : (contato.proxima ??
          (contato.ultima
            ? new Date(Date.parse(contato.ultima) + HORAS_APOS_CONVERSA * 3_600_000).toISOString()
            : l.createdAt)),
    );
    if (Date.parse(devido) > now) return null; // ainda não é hora
    return { nome: "retornar", desde: devido, horasUteis: uteis(devido), contato };
  }

  return null;
}

/** Confirmar (48 h antes, sem quem já confirmou) e sem desfecho — iguais nos dois modos. */
function etapaDaReuniao(l: Lead, nowIso: string): EtapaCalculada | null {
  const now = Date.parse(nowIso);
  const uteis = (de: string) => horasUteisEntre(de, nowIso);
  if (l.meetingFor) {
    const ate = (Date.parse(l.meetingFor) - now) / 3_600_000;
    if (ate > FILA_ETAPAS.confirmar.slaHoras) return null; // longe ainda
    if (ate > 0) {
      // A pessoa já confirmou (fato da ficha ou do n8n): nada a fazer até a reunião.
      if (l.reuniaoConfirmadaEm) return null;
      return {
        nome: "confirmar",
        desde: l.bookedAt ?? l.createdAt,
        horasUteis: 0,
        atraso: 1 - ate / FILA_ETAPAS.confirmar.slaHoras,
        reuniao: l.meetingFor,
      };
    }
    return { nome: "sem-desfecho", desde: l.meetingFor, horasUteis: uteis(l.meetingFor), reuniao: l.meetingFor };
  }
  // Agendado antes de a data ser obrigatória: sem data, vira "sem desfecho"
  // uma semana depois do agendamento.
  const base = l.bookedAt ?? l.createdAt;
  const limite = Date.parse(base) + DIAS_AGENDADO_SEM_DATA * 86_400_000;
  if (limite > now) return null;
  const desde = new Date(limite).toISOString();
  return { nome: "sem-desfecho", desde, horasUteis: uteis(desde) };
}

/**
 * Robô ligado, nesta ordem (11.2, 11.5):
 *  - não compareceu → resgate (`nao-compareceu`), para todos, a partir da
 *    reunião e com a cadência;
 *  - aceitou o convite e não agendou depois dele (`agendouDepoisDoAceite`: a
 *    reunião de um episódio anterior ao reaberto não conta) → "Aceitou o convite", para todos
 *    (com ou sem classe: é conferir o Calendly), com a cadência humana — menos
 *    quando a mesma pessoa já agendou por outro cadastro depois do aceite;
 *  - com classe (a live) → fora das etapas de contato;
 *  - antes do robô: só o retorno de quem estava sendo trabalhado (tentativa nos
 *    últimos 7 dias); o resto fica no filtro "Antes do robô" de Leads;
 *  - o robô não conseguiu a conversa (`situacaoDoRobo`) → resgate, com a cadência;
 *  - senão: está com o robô.
 *
 * Cadência humana no resgate e no convite aceito: devido = max(entrada, próxima
 * tentativa pela cadência, ou última + 24 h depois de uma conversa) — quem já
 * tentou hoje some até a próxima da cadência (`volta`). No convite aceito e no
 * "não compareceu" só contam as tentativas feitas DEPOIS da entrada; no resgate,
 * as feitas depois do último `reaberto`.
 */
function etapaComRobo(
  l: Lead,
  eventos: LeadEvent[],
  nowIso: string,
  robo: RoboNaFila,
  reaberto: string | undefined,
  ctx: ContextoDaEtapa | undefined,
): EtapaEVolta {
  const now = Date.parse(nowIso);
  const uteis = (de: string) => horasUteisEntre(de, nowIso);
  const desdeReaberto = (base: string) => (reaberto && reaberto > base ? reaberto : base);
  const contato = resumoContato(eventos);
  const depoisDaConversa = contato.ultima
    ? new Date(Date.parse(contato.ultima) + HORAS_APOS_CONVERSA * 3_600_000).toISOString()
    : undefined;
  const nada: EtapaEVolta = { etapa: null };

  /** No grupo a partir de `devido`; antes disso, fora dele só pela cadência (`volta`). */
  const aPartirDe = (nome: "resgate" | "convite-aceito", devido: string, motivo?: ResgateMotivo): EtapaEVolta => {
    if (Date.parse(devido) > now) return { etapa: null, volta: { nome, volta: devido, motivo } }; // a cadência ainda não venceu
    return {
      etapa: {
        nome,
        desde: devido,
        horasUteis: uteis(devido),
        venceEm: somarHorasUteis(devido, FILA_ETAPAS[nome].slaHoras),
        contato,
        motivo,
      },
    };
  };

  /*
   * `soDepoisDaEntrada`: a entrada é um fato NOVO que pede ação (aceitou o convite,
   * faltou à reunião) — tentativa de ANTES dela (a conversa do resgate, a
   * confirmação da reunião) não adia o grupo; só a feita depois conta na cadência.
   * Sem ele, o corte é o último `reaberto`: a tentativa do episódio encerrado não
   * adia o resgate de quem voltou (o relógio recomeça no reaberto) — com o robô
   * desligado, o mesmo lead entra em "Novos" na hora.
   */
  const comCadencia = (
    nome: "resgate" | "convite-aceito",
    entrada: string,
    motivo?: ResgateMotivo,
    soDepoisDaEntrada = false,
  ): EtapaEVolta => {
    const corte = soDepoisDaEntrada ? entrada : reaberto;
    const vale = !corte || (contato.ultima != null && Date.parse(contato.ultima) >= Date.parse(corte));
    return aPartirDe(nome, vale ? maisTarde(entrada, contato.proxima ?? depoisDaConversa) : entrada, motivo);
  };

  if (l.status === "no_show") {
    // A partir da reunião, COM a cadência (11.2): a tentativa não muda o status
    // `no_show`, então sem ela quem já ligou hoje voltava ao topo a cada recarga.
    return comCadencia("resgate", desdeReaberto(l.meetingFor ?? contato.ultima ?? l.createdAt), "nao-compareceu", true);
  }
  if (!leadAberto(l)) return nada;

  const s = situacaoDoRobo(l, {
    agora: nowIso,
    ref: refDoRobo(robo, nowIso),
    ligado: true,
    reabertoEm: reaberto,
    reabertoNoPainel: reabertoNoPainelDe(eventos),
  });
  if (s.aceitouEm && !agendouDepoisDoAceite(l, s.aceitouEm)) {
    const tel = chaveTelefoneValida(l.phone);
    const outra = tel ? ctx?.reunioesPorTelefone?.get(tel) : undefined;
    // A mesma pessoa agendou por outro cadastro depois de aceitar: o convite já virou reunião.
    if (outra && Date.parse(outra) >= Date.parse(s.aceitouEm)) return { etapa: null, reuniaoEmOutroCadastro: true };
    return comCadencia("convite-aceito", s.aceitouEm, undefined, true);
  }

  // A live (classe) está congelada: fora das etapas de contato da Fila de sempre.
  if (classeDoLead(l)) return nada;

  if (s.antesDoRobo) {
    // Só o "retornar" de quem já estava sendo trabalhado — a cadência de antes.
    const recente = contato.ultima && now - Date.parse(contato.ultima) <= DIAS_RETORNO_ANTES_DO_ROBO * 86_400_000;
    if (l.status !== "em_contato" || !recente) return nada;
    return aPartirDe("resgate", desdeReaberto(contato.proxima ?? depoisDaConversa!), "retorno");
  }

  if (s.resgate) return comCadencia("resgate", s.resgate.desde, s.resgate.motivo);
  return nada; // está com o robô
}

/** A espera em linguagem de quem vai ligar — ver `formatarEspera` (format.ts). */
export const formatEspera = formatarEspera;
