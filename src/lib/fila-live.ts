/**
 * A Fila da live — os inscritos A e B que esperam uma tentativa, na ordem do
 * PRAZO (prazo_tentativa). Puro: a tela da Fila e a API do n8n (a checagem de
 * 10 em 10 minutos e a fila do início do turno) leem esta mesma lista.
 *
 * C e X ficam fora (só em Leads). Quem entrou sem classe segue a Fila de sempre
 * (`lib/fila.ts`). Reunião marcada também: confirmar e registrar desfecho são as
 * etapas de lá, para qualquer lead.
 *
 * Etapas, pelo que falta fazer:
 *   • primeira  — ninguém tentou; prazo da classe (`prazoDaPrimeiraTentativa`);
 *   • cadencia  — tentou e não falou; prazo = a próxima da cadência;
 *   • encerrar  — a cadência acabou ou passou a janela de 48 h sem contato
 *                 válido; prazo = o fim da janela → "Sem resposta";
 *   • retornar  — falou e não houve desfecho; prazo = 24 h depois da conversa.
 *
 * O relógio é o do EPISÓDIO (`inicioDoEpisodioDaLive`): a entrada na live — quem
 * já era lead de outra campanha começa na inscrição, como "1ª tentativa" — ou o
 * último `reaberto` depois dela. As tentativas de antes do episódio ficam no
 * histórico e fora da cadência.
 */
import { eventosPorLead, quando, resumoContato, type ResumoContato } from "./contato";
import { HORAS_APOS_CONVERSA } from "./fila";
import { CLASSES_NA_FILA, classeDoLead, type Classe, type HorarioPreferido } from "./qualificacao";
import { entradaNaLive } from "./live";
import { fimDaJanelaDeContato, prazoDaPrimeiraTentativa, type Expediente } from "./turno";
import type { Lead, LeadEvent, LeadStatus } from "./types";

export type EtapaDaLive = "primeira" | "cadencia" | "encerrar" | "retornar";

export const ETAPA_DA_LIVE: Record<EtapaDaLive, { label: string; acao: string }> = {
  primeira: { label: "1ª tentativa", acao: "Ligar" },
  cadencia: { label: "Próxima tentativa", acao: "Tentar de novo" },
  encerrar: { label: "Sem contato válido", acao: "Encerrar como “Sem resposta”" },
  retornar: { label: "Retornar a conversa", acao: "Retornar" },
};

export interface ItemDaFilaLive {
  leadId: string;
  nome: string;
  telefone?: string;
  email?: string;
  classe: Classe;
  etapa: EtapaDaLive;
  status: LeadStatus;
  /** O prazo desta etapa (ISO) — a ordem da lista. */
  prazo: string;
  /** Já passou do prazo. */
  atrasado: boolean;
  /** Minutos até o prazo (negativo = atraso). */
  minutosParaPrazo: number;
  contato: ResumoContato;
  horarioPreferido?: HorarioPreferido;
  /** O episódio começou quando: a entrada na live (a inscrição, para quem já era lead) ou o último reaberto. */
  desde: string;
  escaladoEm?: string;
  atendimentoAvisadoEm?: string;
}

/**
 * Onde começa o episódio da Fila da live: a entrada NA LIVE (`entradaNaLive` — quem
 * já era lead de outra campanha começa na inscrição) ou o último `reaberto` depois
 * dela (lead que voltou), como na Fila de sempre.
 */
export function inicioDoEpisodioDaLive(l: Pick<Lead, "createdAt" | "inscritoLiveEm">, eventos: LeadEvent[]): string {
  const entrada = entradaNaLive(l);
  const reaberto = eventos
    .filter((e) => e.action === "reaberto")
    .map((e) => e.createdAt)
    .sort()
    .at(-1);
  return reaberto && Date.parse(reaberto) > Date.parse(entrada) ? reaberto : entrada;
}

/**
 * O histórico que vale para a cadência do episódio: tudo, menos as tentativas de
 * antes dele (a conversa da campanha antiga continua no histórico, fora da conta).
 */
export function eventosDoEpisodioDaLive(eventos: LeadEvent[], desde: string): LeadEvent[] {
  const t = Date.parse(desde);
  return eventos.filter((e) => e.action !== "tentativa" || Date.parse(quando(e)) >= t);
}

/** A etapa e o prazo de UM lead A/B em contato; null = nada a fazer na Fila da live. */
export function etapaDaLive(
  l: Lead,
  eventos: LeadEvent[],
  cfg: Expediente,
): { etapa: EtapaDaLive; prazo: string; contato: ResumoContato; desde: string } | null {
  const classe = classeDoLead(l);
  if (!classe || !CLASSES_NA_FILA.includes(classe) || l.deletedAt) return null;
  const desde = inicioDoEpisodioDaLive(l, eventos);
  const contato = resumoContato(eventosDoEpisodioDaLive(eventos, desde));

  // Ninguém tentou NESTE episódio: 1ª tentativa — também quem já era lead e está
  // "Em contato" pelas tentativas da campanha antiga.
  if (l.status === "lead" || (l.status === "em_contato" && contato.tentativas === 0)) {
    const prazo = prazoDaPrimeiraTentativa({ createdAt: desde, classe, horarioPreferido: l.horarioPreferido }, cfg);
    return prazo ? { etapa: "primeira", prazo, contato, desde } : null;
  }
  if (l.status !== "em_contato") return null;

  if (contato.falou) {
    if (!contato.ultima) return null;
    const prazo = new Date(Date.parse(contato.ultima) + HORAS_APOS_CONVERSA * 3_600_000).toISOString();
    return { etapa: "retornar", prazo, contato, desde };
  }
  const fimDaJanela = fimDaJanelaDeContato(desde, cfg);
  // A cadência ainda tem tentativa marcada e ela vem antes do fim da janela.
  if (contato.proxima && contato.proxima < fimDaJanela) {
    return { etapa: "cadencia", prazo: contato.proxima, contato, desde };
  }
  return { etapa: "encerrar", prazo: fimDaJanela, contato, desde };
}

/** A lista inteira, do prazo mais antigo (o mais atrasado) para o mais novo. */
export function montarFilaDaLive(leads: Lead[], eventos: LeadEvent[], agoraIso: string, cfg: Expediente): ItemDaFilaLive[] {
  const agora = Date.parse(agoraIso);
  const porLead = eventosPorLead(eventos);
  const itens: ItemDaFilaLive[] = [];
  for (const l of leads) {
    const e = etapaDaLive(l, porLead.get(l.id) ?? [], cfg);
    if (!e) continue;
    const ms = Date.parse(e.prazo) - agora;
    itens.push({
      leadId: l.id,
      nome: l.name,
      telefone: l.phone,
      email: l.email,
      classe: classeDoLead(l)!,
      etapa: e.etapa,
      status: l.status,
      prazo: e.prazo,
      atrasado: ms < 0,
      minutosParaPrazo: Math.round(ms / 60_000),
      contato: e.contato,
      horarioPreferido: l.horarioPreferido,
      desde: e.desde,
      escaladoEm: l.escaladoEm,
      atendimentoAvisadoEm: l.atendimentoAvisadoEm,
    });
  }
  // Prazo mais antigo primeiro; no empate, A antes de B.
  return itens.sort((a, b) => a.prazo.localeCompare(b.prazo) || a.classe.localeCompare(b.classe));
}

/** "faltam 40 min" / "atrasado 2 h 10 min" — o tempo da Fila, em minutos inteiros. */
export function tempoAtePrazo(minutos: number): string {
  const m = Math.abs(minutos);
  const h = Math.floor(m / 60);
  const resto = m % 60;
  const dias = Math.floor(h / 24);
  const texto = dias >= 1 ? `${dias} d ${h % 24} h` : h >= 1 ? `${h} h${resto ? ` ${resto} min` : ""}` : `${resto} min`;
  return minutos < 0 ? `atrasado ${texto}` : `faltam ${texto}`;
}
