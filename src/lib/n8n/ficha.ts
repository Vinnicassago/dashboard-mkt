/**
 * A ficha do lead como a API do n8n devolve — puro. As chaves são as do
 * briefing (snake_case); os valores das respostas vêm na CHAVE do vocabulário
 * (estável para o fluxo decidir) e o texto para mensagem vai em `rotulos`.
 * Tentativas, prazo e estados saem das mesmas funções da tela.
 */
import { tentativasDoLead } from "../contato";
import { etapaDaLive } from "../fila-live";
import {
  BENS,
  FAIXAS_PARCELA,
  FAIXAS_VALOR,
  FINALIDADES,
  HORARIOS,
  PRAZOS_COMPRA,
  RESULTADOS_CONTATO,
  STATUS_ATENDIMENTO,
  STATUS_REUNIAO,
  classeDiverge,
  classeDoLead,
  statusAtendimento,
  statusReuniao,
} from "../qualificacao";
import { statusLabel } from "../lead-status";
import { normalizarTelefone } from "../phone";
import type { Expediente } from "../turno";
import type { Lead, LeadEvent } from "../types";

export function fichaParaN8n(lead: Lead, eventos: LeadEvent[], cfg: Expediente, agora: string, painelUrl?: string) {
  const tentativas = tentativasDoLead(eventos);
  const live = etapaDaLive(lead, eventos, cfg);
  const reuniao = statusReuniao(lead);
  const ultimoResultado = [...tentativas].reverse().find((t) => t.resultado)?.resultado;
  const atendimento = statusAtendimento(lead);
  return {
    id: lead.id,
    nome: lead.name,
    whatsapp: lead.phone ? normalizarTelefone(lead.phone) : null,
    email: lead.email ?? null,
    inscrito_em: lead.createdAt,
    classe: classeDoLead(lead) ?? null,
    classe_painel: lead.classe ?? null,
    classe_n8n: lead.classeN8n ?? null,
    classe_diverge: classeDiverge(lead),
    bem: lead.bem ?? null,
    valor: lead.faixaValor ?? null,
    finalidade: lead.finalidade ?? null,
    parcela: lead.faixaParcela ?? null,
    prazo: lead.prazoCompra ?? null,
    aceite_mensagens: lead.aceiteMensagens ?? null,
    horario_preferido: lead.horarioPreferido ?? null,
    rotulos: {
      bem: lead.bem ? BENS[lead.bem] : null,
      valor: lead.faixaValor ? FAIXAS_VALOR[lead.faixaValor] : null,
      finalidade: lead.finalidade ? FINALIDADES[lead.finalidade] : null,
      parcela: lead.faixaParcela ? FAIXAS_PARCELA[lead.faixaParcela] : null,
      prazo: lead.prazoCompra ? PRAZOS_COMPRA[lead.prazoCompra] : null,
      horario_preferido: lead.horarioPreferido ? HORARIOS[lead.horarioPreferido] : null,
      status: statusLabel(lead.status),
      status_atendimento: STATUS_ATENDIMENTO[atendimento],
      reuniao_status: reuniao ? STATUS_REUNIAO[reuniao] : null,
      resultado_contato: ultimoResultado ? RESULTADOS_CONTATO[ultimoResultado] : null,
    },
    status: lead.status,
    status_atendimento: atendimento,
    // A Fila da live: etapa e prazo (prazo_tentativa = o da próxima ação).
    na_fila: Boolean(live),
    etapa_fila: live?.etapa ?? null,
    prazo_tentativa: live?.prazo ?? null,
    atrasado: live ? Date.parse(live.prazo) < Date.parse(agora) : false,
    tentativas: tentativas.map((t) => ({
      em: t.em,
      canal: t.canal ?? null,
      resultado: t.resultado ?? (t.falou ? "falou" : "nao_atendeu"),
      notas: t.nota ?? null,
      por: t.por,
    })),
    tentativa_1_em: tentativas[0]?.em ?? null,
    tentativa_2_em: tentativas[1]?.em ?? null,
    tentativa_3_em: tentativas[2]?.em ?? null,
    resultado_contato: ultimoResultado ?? null,
    msg1_enviada_em: lead.msg1EnviadaEm ?? null,
    msg1_status: lead.msg1Status ?? null,
    eduardo_avisado_em: lead.atendimentoAvisadoEm ?? null,
    escalado_em: lead.escaladoEm ?? null,
    clicou_comunidade: Boolean(lead.comunidadeEm),
    comunidade_em: lead.comunidadeEm ?? null,
    diagnostico: lead.diagnostico ?? null,
    reuniao_em: lead.meetingFor ?? null,
    reuniao_status: reuniao ?? null,
    utm_source: lead.utmSource ?? null,
    utm_campaign: lead.utmCampaign ?? null,
    utm_content: lead.utmContent ?? null,
    link_ficha: painelUrl ? `${painelUrl.replace(/\/$/, "")}/leads/${encodeURIComponent(lead.id)}` : null,
  };
}

export type FichaN8n = ReturnType<typeof fichaParaN8n>;
