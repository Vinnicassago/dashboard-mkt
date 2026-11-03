import "server-only";
import { addLeadEvent, getLead, updateLeadFicha } from "../data/store";
import type { LeadFichaPatch } from "../data/backend";
import { newEventId } from "../auth/actor";
import { formatDateTime } from "../format";
import { enviarParaMeta } from "../meta/capi-envios";
import {
  BENS,
  FAIXAS_PARCELA,
  FAIXAS_VALOR,
  FINALIDADES,
  HORARIOS,
  PRAZOS_COMPRA,
  STATUS_MSG1,
  classeDoLead,
  ehQualificado,
  type FatoDaFicha,
} from "../qualificacao";
import type { Lead } from "../types";
import { pessoaParaMeta } from "./mudar-status";

/**
 * Grava a ficha da live num lead e deixa no histórico um evento `ficha` por fato
 * que MUDOU — o que a automação e o atendimento fizeram aparece na linha do
 * tempo da ficha, com quem fez. A API do n8n e a ficha passam por aqui.
 */
export interface FichaGravada {
  /** Os fatos que mudaram (vazio = nada novo). */
  mudou: FatoDaFicha[];
  lead: Lead;
}

const RESPOSTAS = ["bem", "faixaValor", "finalidade", "faixaParcela", "prazoCompra", "aceiteMensagens"] as const;

const rotuloResposta = (l: Partial<Lead>, campo: (typeof RESPOSTAS)[number]): string => {
  switch (campo) {
    case "bem":
      return l.bem ? BENS[l.bem] : "—";
    case "faixaValor":
      return l.faixaValor ? FAIXAS_VALOR[l.faixaValor] : "—";
    case "finalidade":
      return l.finalidade ? FINALIDADES[l.finalidade] : "—";
    case "faixaParcela":
      return l.faixaParcela ? FAIXAS_PARCELA[l.faixaParcela] : "—";
    case "prazoCompra":
      return l.prazoCompra ? PRAZOS_COMPRA[l.prazoCompra] : "—";
    case "aceiteMensagens":
      return l.aceiteMensagens == null ? "—" : l.aceiteMensagens ? "aceitou mensagens" : "não aceitou mensagens";
  }
};

/** O que mudou, em palavras curtas para o histórico. PII nunca entra aqui. */
function fatosQueMudaram(antes: Lead, depois: Lead): { fato: FatoDaFicha; detalhe?: string }[] {
  const fatos: { fato: FatoDaFicha; detalhe?: string }[] = [];
  const respostas = RESPOSTAS.filter((c) => antes[c] !== depois[c]);
  if (respostas.length) {
    fatos.push({ fato: "respostas", detalhe: respostas.map((c) => rotuloResposta(depois, c)).join(" · ") });
  }
  if (antes.classe !== depois.classe || antes.classeN8n !== depois.classeN8n) {
    const de = antes.classe ?? "—";
    const para = depois.classe ?? "—";
    fatos.push({
      fato: "classe",
      detalhe: `painel ${de === para ? para : `${de} → ${para}`}${depois.classeN8n ? ` · n8n ${depois.classeN8n}` : ""}`,
    });
  }
  if (antes.msg1EnviadaEm !== depois.msg1EnviadaEm || antes.msg1Status !== depois.msg1Status) {
    const status = depois.msg1Status ? (STATUS_MSG1[depois.msg1Status as keyof typeof STATUS_MSG1] ?? depois.msg1Status) : undefined;
    fatos.push({
      fato: "msg1",
      detalhe: [status?.toLowerCase(), depois.msg1EnviadaEm ? `enviada em ${formatDateTime(depois.msg1EnviadaEm)}` : undefined]
        .filter(Boolean)
        .join(" · "),
    });
  }
  if (antes.horarioPreferido !== depois.horarioPreferido) {
    fatos.push({ fato: "horario", detalhe: depois.horarioPreferido ? HORARIOS[depois.horarioPreferido] : "sem preferência" });
  }
  if (antes.atendimentoAvisadoEm !== depois.atendimentoAvisadoEm) fatos.push({ fato: "aviso" });
  if (antes.escaladoEm !== depois.escaladoEm) fatos.push({ fato: "escalado" });
  if (antes.comunidadeEm !== depois.comunidadeEm) fatos.push({ fato: "comunidade" });
  if (JSON.stringify(antes.diagnostico ?? null) !== JSON.stringify(depois.diagnostico ?? null)) {
    fatos.push({ fato: "diagnostico", detalhe: depois.diagnostico?.perfil ? `perfil: ${depois.diagnostico.perfil}` : undefined });
  }
  if (antes.reuniaoConfirmadaEm !== depois.reuniaoConfirmadaEm && depois.reuniaoConfirmadaEm) {
    fatos.push({ fato: "reuniao_confirmada" });
  }
  if (antes.reuniaoRemarcarEm !== depois.reuniaoRemarcarEm && depois.reuniaoRemarcarEm) {
    fatos.push({ fato: "reuniao_remarcar" });
  }
  return fatos;
}

/** Fatos que o histórico grava com o instante em que ACONTECERAM (não o do registro). */
const QUANDO_ACONTECEU: Partial<Record<FatoDaFicha, (l: Lead) => string | undefined>> = {
  aviso: (l) => l.atendimentoAvisadoEm,
  escalado: (l) => l.escaladoEm,
  comunidade: (l) => l.comunidadeEm,
  reuniao_confirmada: (l) => l.reuniaoConfirmadaEm,
  reuniao_remarcar: (l) => l.reuniaoRemarcarEm,
};

/**
 * Os eventos que esta escrita da ficha dispara na Meta (E2-19): virou A ou B
 * (`LeadQualificado`) e clicou na comunidade (`EntrouNaComunidade`). Só o
 * painel sabe a classe, então os dois saem SÓ pela CAPI — o Pixel não os manda.
 * Pura. O id é estável por lead: voltar a ser A depois de um C não manda outro.
 */
export function eventosDaFicha(antes: Lead, depois: Lead): ("LeadQualificado" | "EntrouNaComunidade")[] {
  const eventos: ("LeadQualificado" | "EntrouNaComunidade")[] = [];
  if (!ehQualificado(antes) && ehQualificado(depois)) eventos.push("LeadQualificado");
  if (!antes.comunidadeEm && depois.comunidadeEm) eventos.push("EntrouNaComunidade");
  return eventos;
}

/** Enfileira os eventos da ficha na caixa de saída da CAPI (nunca lança: o fato já foi gravado). */
async function avisarMeta(depois: Lead, eventos: ReturnType<typeof eventosDaFicha>, agora: string): Promise<void> {
  for (const ev of eventos) {
    await enviarParaMeta({
      brand: depois.brand,
      leadId: depois.id,
      eventName: ev,
      eventId: ev === "LeadQualificado" ? `qualificado-${depois.id}` : `comunidade-${depois.id}`,
      eventTime: ev === "EntrouNaComunidade" ? (depois.comunidadeEm ?? agora) : agora,
      actionSource: "system_generated",
      eventSourceUrl: process.env.LP_BASE_URL,
      user: pessoaParaMeta(depois),
      customData:
        ev === "LeadQualificado"
          ? { content_name: "Lead qualificado", classe: classeDoLead(depois) }
          : { content_name: "Entrou na comunidade" },
    });
  }
}

export async function gravarFicha(lead: Lead, patch: LeadFichaPatch, actor: string): Promise<FichaGravada> {
  await updateLeadFicha(lead.id, patch);
  const depois = (await getLead(lead.id)) ?? lead;
  const fatos = fatosQueMudaram(lead, depois);
  const agora = new Date().toISOString();
  // Como no status: o envio entra na fila ANTES do histórico — se o histórico
  // falhar, o fato que acabou de ser gravado já tem o seu evento.
  await avisarMeta(depois, eventosDaFicha(lead, depois), agora);
  for (const f of fatos) {
    await addLeadEvent({
      id: newEventId(),
      leadId: lead.id,
      brand: lead.brand,
      leadName: lead.name,
      actor,
      action: "ficha",
      payload: { fato: f.fato, ...(f.detalhe ? { detalhe: f.detalhe } : {}) },
      occurredAt: QUANDO_ACONTECEU[f.fato]?.(depois),
      createdAt: agora,
    });
  }
  return { mudou: fatos.map((f) => f.fato), lead: depois };
}
