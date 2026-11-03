/**
 * As respostas do formulário da live e os fatos da automação (n8n) — fonte ÚNICA
 * dos valores e rótulos. Ficha, filtros de Leads, CSV, API do n8n e classe
 * (`lib/classe.ts`) leem daqui; nenhum deles repete uma lista.
 *
 * Também mora aqui a LEITURA em cinco estados que o atendimento usa (Novo · Em
 * contato · Sem resposta · Agendou · Encerrado) e o estado da reunião: as duas
 * são derivadas dos status e marcos que já existem — não é uma segunda máquina
 * de estados (o custo por reunião e o funil dependem da que existe).
 *
 * Puro: roda no servidor, no cliente e nos testes.
 */
import type { Lead, LeadStatus } from "./types";

// ---------------------------------------------------------------- vocabulários

export const BENS = {
  imovel: "Imóvel",
  carro: "Carro",
  empresa: "Bem para a empresa",
  outro: "Outro",
} as const;
export type Bem = keyof typeof BENS;

/** Faixas em ordem crescente — a classe compara posições. */
export const FAIXAS_VALOR = {
  ate_50k: "Até R$ 50 mil",
  "50k_150k": "R$ 50 mil a R$ 150 mil",
  "150k_300k": "R$ 150 mil a R$ 300 mil",
  "300k_500k": "R$ 300 mil a R$ 500 mil",
  "500k_1m": "R$ 500 mil a R$ 1 milhão",
  acima_1m: "Acima de R$ 1 milhão",
} as const;
export type FaixaValor = keyof typeof FAIXAS_VALOR;

export const FINALIDADES = {
  morar: "Morar",
  investir: "Investir ou alugar",
  trocar_carro: "Trocar de carro",
  empresa: "Empresa",
  quitar_dividas: "Quitar dívidas ou ter dinheiro na mão",
} as const;
export type Finalidade = keyof typeof FINALIDADES;

/** Faixas em ordem crescente — "parcela compatível" compara posições. */
export const FAIXAS_PARCELA = {
  ate_1500: "Até R$ 1.500",
  "1500_3000": "R$ 1.500 a R$ 3.000",
  "3000_6000": "R$ 3.000 a R$ 6.000",
  acima_6000: "Acima de R$ 6.000",
} as const;
export type FaixaParcela = keyof typeof FAIXAS_PARCELA;

export const PRAZOS_COMPRA = {
  agora: "Preciso agora",
  ate_1_ano: "Em até 1 ano",
  "1_3_anos": "De 1 a 3 anos",
  mais_3_anos: "Mais de 3 anos",
} as const;
export type PrazoCompra = keyof typeof PRAZOS_COMPRA;

export const CLASSES = {
  A: "A",
  B: "B",
  C: "C",
  X: "X",
} as const;
export type Classe = keyof typeof CLASSES;

/** O que cada classe significa para o atendimento — o ⓘ da coluna. */
export const CLASSE_HINT: Record<Classe, string> = {
  A: "Prioridade: ligar em até 1 hora útil (ou no horário que a pessoa escolheu).",
  B: "Ligar no mesmo dia (até o fim do turno).",
  C: "Fora da fila: valor abaixo do mínimo ou parcela incompatível.",
  X: "Fora da fila: quer quitar dívidas ou dinheiro na mão.",
};

/** A e B entram na Fila; C e X ficam só em Leads. */
export const CLASSES_NA_FILA: Classe[] = ["A", "B"];

export const HORARIOS = {
  manha: "Manhã",
  tarde: "Tarde",
  noite: "Noite",
} as const;
export type HorarioPreferido = keyof typeof HORARIOS;

export const RESULTADOS_CONTATO = {
  falou: "Falou",
  agendou: "Agendou",
  nao_atendeu: "Não atendeu",
  numero_invalido: "Número inválido",
  sem_interesse: "Sem interesse",
} as const;
export type ResultadoContato = keyof typeof RESULTADOS_CONTATO;

/** Resultados que contam como CONTATO VÁLIDO (a meta de 60% em 48 h). */
export const RESULTADOS_VALIDOS: ResultadoContato[] = ["falou", "agendou", "sem_interesse"];

/** Status da mensagem automática que o n8n informa. Outro texto é guardado como veio. */
export const STATUS_MSG1 = {
  enviada: "Enviada",
  entregue: "Entregue",
  lida: "Lida",
  falhou: "Falhou",
} as const;

/** As 9 perguntas do diagnóstico (texto livre; a API guarda o que vier). */
export const PERGUNTAS_DO_DIAGNOSTICO = 9;

export interface RespostaDiagnostico {
  pergunta?: string;
  resposta: string;
}

export interface Diagnostico {
  respostas: RespostaDiagnostico[];
  /** O perfil final que o diagnóstico devolve (texto). */
  perfil?: string;
  /** Quando foi feito (ISO). */
  feitoEm?: string;
}

/** Os fatos da ficha que viram linha no histórico (evento `ficha`, `payload.fato`). */
export const FATOS_DA_FICHA = {
  respostas: "Respostas do formulário",
  classe: "Classe",
  msg1: "Mensagem automática",
  horario: "Horário preferido",
  aviso: "Atendimento avisado",
  escalado: "Escalado",
  comunidade: "Clicou na comunidade",
  diagnostico: "Diagnóstico",
  reuniao_confirmada: "Reunião confirmada",
  reuniao_remarcar: "Pediu para remarcar",
} as const;
export type FatoDaFicha = keyof typeof FATOS_DA_FICHA;

// ---------------------------------------------------------------- leitura do que chega

/**
 * Um valor como o n8n (ou uma planilha) costuma escrever, na chave do
 * vocabulário: aceita a chave ("50k_150k"), o rótulo ("R$ 50 mil a R$ 150 mil")
 * e as grafias que só diferem em acento, maiúscula, "R$", espaço ou ponto
 * ("R$50 mil a R$150 mil", "imovel"). O que não casa vira `undefined` — quem
 * chama diz ao n8n que o campo veio inválido, em vez de gravar lixo.
 */
export function lerOpcao<K extends string>(vocab: Record<K, string>, valor: unknown): K | undefined {
  if (typeof valor !== "string" || !valor.trim()) return undefined;
  const alvo = chaveDeComparacao(valor);
  for (const [k, rotulo] of Object.entries(vocab) as [K, string][]) {
    if (chaveDeComparacao(k) === alvo || chaveDeComparacao(rotulo) === alvo) return k;
  }
  return undefined;
}

function chaveDeComparacao(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/r\$/g, "")
    .replace(/[\s._\-–—]/g, "");
}

/** Sim/não como chega: booleano, "sim"/"não", "true"/"false", 1/0. */
export function lerSimNao(valor: unknown): boolean | undefined {
  if (typeof valor === "boolean") return valor;
  if (typeof valor === "number") return valor === 1 ? true : valor === 0 ? false : undefined;
  if (typeof valor !== "string") return undefined;
  const v = chaveDeComparacao(valor);
  if (["sim", "s", "true", "1", "yes", "aceito", "aceitou"].includes(v)) return true;
  if (["nao", "n", "false", "0", "no"].includes(v)) return false;
  return undefined;
}

// ---------------------------------------------------------------- leituras derivadas

/** Os cinco estados do atendimento. Derivados de `status` — nunca gravados. */
export const STATUS_ATENDIMENTO = {
  novo: "Novo",
  em_contato: "Em contato",
  sem_resposta: "Sem resposta",
  agendou: "Agendou",
  encerrado: "Encerrado",
} as const;
export type StatusAtendimento = keyof typeof STATUS_ATENDIMENTO;

const ATENDIMENTO_DO_STATUS: Record<LeadStatus, StatusAtendimento> = {
  lead: "novo",
  em_contato: "em_contato",
  sem_resposta: "sem_resposta",
  agendado: "agendou",
  no_show: "agendou",
  reuniao_realizada: "agendou",
  cliente: "encerrado",
  contato_invalido: "encerrado",
  sem_interesse: "encerrado",
  desistencia: "encerrado",
};

/** O estado do atendimento de um lead (a leitura em cinco estados do status). */
export function statusAtendimento(l: Pick<Lead, "status">): StatusAtendimento {
  return ATENDIMENTO_DO_STATUS[l.status];
}

export const STATUS_REUNIAO = {
  agendada: "Agendada",
  confirmada: "Confirmada",
  realizada: "Realizada",
  nao_compareceu: "Não compareceu",
  remarcar: "Remarcar",
} as const;
export type StatusReuniao = keyof typeof STATUS_REUNIAO;

/**
 * O estado da reunião, dos marcos e do status: realizada (marco), não
 * compareceu (status), remarcar (pediu, ainda sem data nova), confirmada
 * (confirmação depois da data marcada) ou agendada. Sem reunião, `undefined`.
 */
export function statusReuniao(
  l: Pick<Lead, "status" | "attendedAt" | "meetingFor" | "bookedAt" | "reuniaoConfirmadaEm" | "reuniaoRemarcarEm">,
): StatusReuniao | undefined {
  if (l.attendedAt || l.status === "reuniao_realizada") return "realizada";
  if (l.status === "no_show") return l.reuniaoRemarcarEm ? "remarcar" : "nao_compareceu";
  if (l.status !== "agendado") return undefined;
  if (l.reuniaoRemarcarEm) return "remarcar";
  return l.reuniaoConfirmadaEm ? "confirmada" : "agendada";
}

/** A classe que vale para a fila: a do painel; sem ela (faltam respostas), a do n8n. */
export function classeDoLead(l: Pick<Lead, "classe" | "classeN8n">): Classe | undefined {
  return l.classe ?? l.classeN8n;
}

/** Inscrito qualificado = classe A ou B (a que vale, `classeDoLead`). */
export function ehQualificado(l: Pick<Lead, "classe" | "classeN8n">): boolean {
  const c = classeDoLead(l);
  return c === "A" || c === "B";
}

/** As duas classes existem e discordam — aviso na ficha e no painel de alertas. */
export function classeDiverge(l: Pick<Lead, "classe" | "classeN8n">): boolean {
  return Boolean(l.classe && l.classeN8n && l.classe !== l.classeN8n);
}
