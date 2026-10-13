/**
 * A vista de Leads — cada linha da tabela pronta para a tela, e os filtros,
 * as contagens e o CSV que a tela usa. Puro, sem I/O.
 *
 * A página não calcula nada (ADR-03): carrega os dados e o histórico e chama
 * `montarLinhasDeLeads`. Tudo o que uma coluna mostra sai da fonte única de
 * cada fato — etapa máxima dos marcos (`etapaMaxima`), tentativas do histórico
 * (`resumoContato`), próxima ação da MESMA régua da Fila (`etapaDoLead`),
 * origem da junção única (`origemDoLead`), dono de `lib/dono.ts` — para o que
 * Leads diz de uma pessoa ser o que a Fila e o Funil dizem dela.
 */

import { eventosPorLead, resumoContato, type ResumoContato } from "./contato";
import { DONO_LABEL, type Dono } from "./dono";
import { etapaDoLead, FILA_ETAPAS, HORAS_APOS_CONVERSA, type FilaEtapa } from "./fila";
import { formatDateTime, formatarEspera } from "./format";
import { horasUteisEntre, somarHorasUteis } from "./horario-util";
import { gruposDuplicados, pareceTeste, problemasDeContato } from "./identidade";
import {
  ETAPAS_MAXIMAS,
  ETAPA_MAXIMA_LABEL,
  LEAD_STATUSES,
  etapaMaxima,
  isLostStatus,
  statusLabel,
  type EtapaMaxima,
} from "./lead-status";
import { everBooked, filterLeads, type DateRange } from "./metrics";
import { origemDoLead, type Origem } from "./origem";
import type { DashboardData, Lead, LeadEvent, LeadStatus } from "./types";

// ---------------------------------------------------------------- vocabulário

/** O que fazer com o lead AGORA, nas palavras da Fila. "—" = nada neste momento. */
export type ProximaAcao = "ligar agora" | "retornar" | "confirmar reunião" | "registrar desfecho" | "—";

/** Cada etapa da Fila, no verbo de quem vai agir. */
export const ACAO_DA_ETAPA: Record<FilaEtapa, ProximaAcao> = {
  novo: "ligar agora",
  "aguardando-contato": "ligar agora",
  retornar: "retornar",
  "convite-pendente": "retornar",
  confirmar: "confirmar reunião",
  "sem-desfecho": "registrar desfecho",
};

export type SinalizadorChave = "teste" | "duplicado" | "contato_invalido";

export const SINALIZADOR_LABEL: Record<SinalizadorChave, string> = {
  teste: "Teste",
  duplicado: "Duplicado",
  contato_invalido: "Contato inválido",
};

export interface Sinalizadores {
  /** Por que parece cadastro de teste (`pareceTeste`), ou null. */
  teste: string | null;
  /** A mesma pessoa tem outro cadastro (mesmo telefone ou e-mail). */
  duplicado: boolean;
  /** Nome do cadastro principal quando ESTE é o duplicado. */
  duplicadoDe?: string;
  /** Contato com formato inválido, ou já encerrado como "Contato inválido". */
  contatoInvalido: boolean;
}

export interface LinhaDeLead {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  createdAt: string;
  status: LeadStatus;
  /** Já teve reunião marcada (`everBooked`) — decide os destinos do editor. */
  jaAgendou: boolean;
  /** Data DA reunião. Agendado antes de out/2026 não tem (a coluna diz isso). */
  meetingFor?: string;
  etapaMaxima: EtapaMaxima;
  /** Horas ÚTEIS entre a entrada e a 1ª tentativa; null = sem tentativa registrada. */
  horasAte1oContato: number | null;
  /** A 1ª tentativa coube na régua da Fila (1 hora útil)? null sem 1º contato. */
  primeiroContatoNoPrazo: boolean | null;
  tentativas: number;
  diasComTentativa: number;
  falou: boolean;
  ultimaTentativa?: string;
  proximaTentativa?: string;
  proximaAcao: ProximaAcao;
  /** Etapa da Fila de onde a ação vem — o link abre a Fila nela. */
  etapaDaFila?: FilaEtapa;
  /** A ação já estourou o prazo da etapa. */
  acaoAtrasada: boolean;
  /** Por que não há ação agora (quando `proximaAcao` é "—"), ou desde quando há. */
  acaoPorque: string;
  origem: Origem;
  /** Quem age em seguida; sem dono = lead encerrado. */
  dono?: Dono;
  sinalizadores: Sinalizadores;
}

// ---------------------------------------------------------------- montagem

/**
 * Quem age em seguida. Na Fila, o dono da etapa; fora dela, o especialista
 * conduz quem já compareceu (e o cliente); quem espera a cadência ou a reunião
 * continua com o comercial; perda encerrada não tem dono — ninguém age.
 */
function donoDoLead(l: Lead, etapa: FilaEtapa | undefined): Dono | undefined {
  if (etapa) return FILA_ETAPAS[etapa].dono;
  if (l.status === "reuniao_realizada" || l.status === "cliente") return "ESP";
  if (isLostStatus(l.status)) return undefined;
  return "COM";
}

/** O motivo de não haver ação agora — para a dica do "—" não ser um zero disfarçado. */
function porqueSemAcao(l: Lead, contato: ResumoContato): string {
  if (isLostStatus(l.status)) return `Encerrado como “${statusLabel(l.status)}”.`;
  if (l.status === "cliente") return "Fechou — nada a fazer.";
  if (l.status === "reuniao_realizada") return "Compareceu; o desfecho (cliente ou não) é do especialista.";
  if (l.status === "agendado" && l.meetingFor) {
    return `Reunião em ${formatDateTime(l.meetingFor)} — confirmar ${FILA_ETAPAS.confirmar.slaHoras} h antes.`;
  }
  if (l.status === "agendado") return "Agendado sem data registrada; vira “sem desfecho” uma semana depois.";
  if (contato.proxima) return `Retorno combinado pela cadência para ${formatDateTime(contato.proxima)}.`;
  // Tentativa sem retorno combinado (falou e não fechou nada, ou a cadência
  // acabou): a Fila traz a pessoa de volta HORAS_APOS_CONVERSA depois da última
  // tentativa — a MESMA conta de `etapaDoLead`. Até lá existe um prazo; dizer
  // "nada pendente" esconderia o relógio que estoura amanhã.
  if (l.status === "em_contato" && contato.ultima) {
    const volta = new Date(Date.parse(contato.ultima) + HORAS_APOS_CONVERSA * 3_600_000).toISOString();
    const conversa = contato.falou ? " — já falou com a pessoa" : "";
    return (
      `Última tentativa em ${formatDateTime(contato.ultima)}${conversa}, sem desfecho; ` +
      `volta à Fila (“${FILA_ETAPAS.retornar.label}”) em ${formatDateTime(volta)}, ${HORAS_APOS_CONVERSA} h depois.`
    );
  }
  return "Nada pendente neste momento.";
}

/**
 * As linhas da tabela de Leads. `eventos` = histórico da marca (todas as
 * tentativas); `agora` em ISO para a função seguir pura. Com `range`, só os
 * leads que ENTRARAM no período — a coorte, como a aba Funil lê.
 */
export function montarLinhasDeLeads(
  data: DashboardData,
  eventos: LeadEvent[],
  agora: string,
  opts: { range?: DateRange } = {},
): LinhaDeLead[] {
  const origem = origemDoLead(data);
  const porLead = eventosPorLead(eventos);
  const sla = FILA_ETAPAS.novo.slaHoras;

  // Duplicados olham a base INTEIRA (um duplicado pode ter entrado fora do período).
  const grupoDe = new Map<string, { principal: Lead }>();
  for (const g of gruposDuplicados(data.leads)) {
    for (const m of [g.principal, ...g.duplicados]) grupoDe.set(m.id, { principal: g.principal });
  }

  const leads = filterLeads(data.leads, opts.range).filter((l) => !l.deletedAt);
  return leads.map((l): LinhaDeLead => {
    const proprios = porLead.get(l.id) ?? [];
    const contato = resumoContato(proprios);
    const etapa = etapaDoLead(l, proprios, agora);
    const horas = l.firstContactAt ? horasUteisEntre(l.createdAt, l.firstContactAt) : null;
    const grupo = grupoDe.get(l.id);
    const atrasada = etapa
      ? etapa.nome === "confirmar"
        ? false
        : etapa.horasUteis / FILA_ETAPAS[etapa.nome].slaHoras > 1
      : false;
    return {
      id: l.id,
      name: l.name,
      email: l.email,
      phone: l.phone,
      createdAt: l.createdAt,
      status: l.status,
      jaAgendou: everBooked(l),
      meetingFor: l.meetingFor,
      etapaMaxima: etapaMaxima(l),
      horasAte1oContato: horas,
      primeiroContatoNoPrazo: l.firstContactAt ? l.firstContactAt <= somarHorasUteis(l.createdAt, sla) : null,
      tentativas: contato.tentativas,
      diasComTentativa: contato.diasComTentativa,
      falou: contato.falou,
      ultimaTentativa: contato.ultima,
      proximaTentativa: contato.proxima,
      proximaAcao: etapa ? ACAO_DA_ETAPA[etapa.nome] : "—",
      etapaDaFila: etapa?.nome,
      acaoAtrasada: atrasada,
      acaoPorque: etapa
        ? etapa.venceEm
          ? `${FILA_ETAPAS[etapa.nome].hint} Vence ${formatDateTime(etapa.venceEm)}.`
          : `${FILA_ETAPAS[etapa.nome].hint} Desde ${formatDateTime(etapa.desde)}.`
        : porqueSemAcao(l, contato),
      origem: origem(l),
      dono: donoDoLead(l, etapa?.nome),
      sinalizadores: {
        teste: pareceTeste(l),
        duplicado: Boolean(grupo),
        duplicadoDe: grupo && grupo.principal.id !== l.id ? grupo.principal.name : undefined,
        contatoInvalido: l.status === "contato_invalido" || problemasDeContato(l).length > 0,
      },
    };
  });
}

// ---------------------------------------------------------------- abas e filtros

export type AbaStatus = LeadStatus | "todos";

/** Contagem por aba — as de status SOMAM "todos", sempre (aceite 7.5). */
export function contarPorStatus(linhas: Pick<LinhaDeLead, "status">[]): Record<AbaStatus, number> {
  const c = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<AbaStatus, number>;
  c.todos = linhas.length;
  for (const r of linhas) c[r.status] += 1;
  return c;
}

export interface FiltroDeLeads {
  status: AbaStatus;
  campanha?: string;
  conjunto?: string;
  dono?: Dono;
  /** Qualquer um dos marcados basta (OU) — quem filtra por sinal quer ver o que revisar. */
  sinalizadores: SinalizadorChave[];
  /** Nome, e-mail ou telefone. */
  busca: string;
}

export const FILTRO_VAZIO: FiltroDeLeads = { status: "todos", sinalizadores: [], busca: "" };

function temSinal(r: LinhaDeLead, s: SinalizadorChave): boolean {
  if (s === "teste") return r.sinalizadores.teste !== null;
  if (s === "duplicado") return r.sinalizadores.duplicado;
  return r.sinalizadores.contatoInvalido;
}

/** Tudo MENOS o status — é sobre este conjunto que as abas contam. */
export function aplicarFiltroSemStatus(linhas: LinhaDeLead[], f: FiltroDeLeads): LinhaDeLead[] {
  const q = f.busca.trim().toLowerCase();
  const qDigitos = q.replace(/\D/g, "");
  return linhas.filter((r) => {
    if (f.campanha && r.origem.campanha !== f.campanha) return false;
    if (f.conjunto && r.origem.conjunto !== f.conjunto) return false;
    if (f.dono && r.dono !== f.dono) return false;
    if (f.sinalizadores.length && !f.sinalizadores.some((s) => temSinal(r, s))) return false;
    if (!q) return true;
    const noTexto = r.name.toLowerCase().includes(q) || (r.email ?? "").toLowerCase().includes(q);
    const noFone = qDigitos.length > 0 && (r.phone ?? "").replace(/\D/g, "").includes(qDigitos);
    return noTexto || noFone;
  });
}

export function aplicarFiltro(linhas: LinhaDeLead[], f: FiltroDeLeads): LinhaDeLead[] {
  const base = aplicarFiltroSemStatus(linhas, f);
  return f.status === "todos" ? base : base.filter((r) => r.status === f.status);
}

/**
 * O filtro em palavras, para o registro da exportação ("quem exportou o quê").
 * A busca entra só como "sim": o texto digitado costuma ser um telefone ou um
 * e-mail, e PII não vai para o log de auditoria.
 */
export function descreverFiltro(f: FiltroDeLeads, periodo: string): string {
  const partes = [`período: ${periodo}`, `status: ${f.status === "todos" ? "todos" : statusLabel(f.status)}`];
  if (f.campanha) partes.push(`campanha: ${f.campanha}`);
  if (f.conjunto) partes.push(`conjunto: ${f.conjunto}`);
  if (f.dono) partes.push(`dono: ${DONO_LABEL[f.dono]}`);
  if (f.sinalizadores.length) partes.push(`sinalizadores: ${f.sinalizadores.map((s) => SINALIZADOR_LABEL[s]).join(", ")}`);
  if (f.busca.trim()) partes.push("busca: sim");
  return partes.join(" · ");
}

// ---------------------------------------------------------------- CSV

/**
 * Uma célula de texto. Dois cuidados: citar o que carrega `;`, aspas ou quebra
 * de linha, e NEUTRALIZAR o começo que o Excel executa — `=`, `+`, `-`, `@`
 * (também atrás de tab/CR). Nome, e-mail e utm_content vêm do formulário
 * público da LP: um nome `=HYPERLINK(...)` viraria link ou fórmula na máquina
 * do comercial ao abrir o arquivo. O apóstrofo faz o Excel ler como texto. O
 * único `=` de propósito é o de `csvTelefone`, que não passa por aqui.
 */
function csvCell(v: string): string {
  const perigoso = /^[=+\-@\t\r]/.test(v);
  const texto = perigoso ? `'${v}` : v;
  return perigoso || /[;"\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/**
 * Telefone como TEXTO para o Excel: sem isso ele abre 5511999990000 como número
 * e grava "5,51E+12" — foi assim que telefones viraram notação científica. O
 * importador de leads (`lerTelefone`) desfaz o `="…"`.
 */
export function csvTelefone(v?: string): string {
  return v ? `="${v.replace(/"/g, "")}"` : "";
}

export const CSV_CABECALHO = [
  "Nome",
  "E-mail",
  "Telefone",
  "Status",
  "Etapa máxima",
  "Entrada",
  "Tempo até 1º contato",
  "Tentativas",
  "Próxima ação",
  "Campanha",
  "Conjunto",
  "Anúncio",
  "Reunião",
  "Dono",
] as const;

/** CSV pt-BR (`;`, BOM, CRLF) das linhas recebidas — e só delas: o filtro vale. */
export function montarCsvDeLeads(linhas: LinhaDeLead[]): string {
  const corpo = linhas.map((r) =>
    [
      csvCell(r.name),
      csvCell(r.email ?? ""),
      csvTelefone(r.phone),
      csvCell(statusLabel(r.status)),
      csvCell(ETAPA_MAXIMA_LABEL[r.etapaMaxima]),
      csvCell(formatDateTime(r.createdAt)),
      csvCell(r.horasAte1oContato == null ? "" : formatarEspera(r.horasAte1oContato)),
      String(r.tentativas),
      csvCell(r.proximaAcao === "—" ? "" : r.proximaAcao),
      csvCell(r.origem.campanha ?? ""),
      csvCell(r.origem.conjunto ?? ""),
      csvCell(r.origem.anuncio === "—" ? "" : r.origem.anuncio),
      csvCell(r.meetingFor ? formatDateTime(r.meetingFor) : r.jaAgendou ? "data não registrada" : ""),
      csvCell(r.dono ? DONO_LABEL[r.dono] : ""),
    ].join(";"),
  );
  // BOM + CRLF: é assim que o Excel pt-BR abre acentos e colunas certos.
  return "﻿" + [CSV_CABECALHO.join(";"), ...corpo].join("\r\n");
}

/** Profundidade da etapa máxima, para ordenar a coluna. */
export function profundidadeDaEtapa(e: EtapaMaxima): number {
  return ETAPAS_MAXIMAS.indexOf(e);
}
