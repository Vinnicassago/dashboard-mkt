/**
 * A reunião com o Brunno, da véspera ao resultado (E5-05) — puro.
 *
 * O resultado que já é status continua sendo status: aconteceu = "Reunião
 * realizada", faltou = "Não compareceu", vendeu = "Cliente" (com o valor da
 * carta), não tem interesse = "Sem interesse". O que fica no meio do caminho
 * ("proposta enviada", "vai pensar") é um FATO da ficha (evento `ficha`, fato
 * `resultado_reuniao`) — a máquina de status não ganha estados novos.
 */
import { BENS, FAIXAS_PARCELA, FAIXAS_VALOR, type Bem, type PrazoCompra } from "./qualificacao";
import type { Lead, LeadEvent } from "./types";

export const RESULTADOS_DA_REUNIAO = {
  proposta: "Proposta enviada",
  pensando: "Vai pensar",
} as const;
export type ResultadoDaReuniao = keyof typeof RESULTADOS_DA_REUNIAO;

/** O último resultado registrado — o mais recente vale (a pessoa pode pensar e depois pedir a proposta). */
export function resultadoDaReuniao(eventos: LeadEvent[]): { resultado: ResultadoDaReuniao; em: string } | undefined {
  let ultimo: { resultado: ResultadoDaReuniao; em: string } | undefined;
  for (const e of eventos) {
    if (e.action !== "ficha" || e.payload?.fato !== "resultado_reuniao") continue;
    const r = e.payload?.resultado;
    if (r !== "proposta" && r !== "pensando") continue;
    const em = e.occurredAt ?? e.createdAt;
    if (!ultimo || em >= ultimo.em) ultimo = { resultado: r, em };
  }
  return ultimo;
}

const BEM_NA_FRASE: Record<Bem, string> = {
  imovel: "imóvel",
  carro: "carro",
  empresa: "bem para a empresa",
  outro: "outro bem",
};
const PRAZO_NA_FRASE: Record<PrazoCompra, string> = {
  agora: "para agora",
  ate_1_ano: "em até 1 ano",
  "1_3_anos": "em 1 a 3 anos",
  mais_3_anos: "em mais de 3 anos",
};

const horaEmBrasilia = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .replace(",", "");

/**
 * A linha que vai para o Brunno na véspera, no formato da E5-05:
 * "{hora} · {nome} · quer {bem} de {valor} em {prazo} · parcela que cabe {faixa}
 * · perfil do diagnóstico: {perfil} · alertas: {alertas}". O que falta vira "—".
 */
export function mensagemDaVespera(lead: Lead): string {
  const quer = lead.bem
    ? `quer ${BEM_NA_FRASE[lead.bem] ?? BENS[lead.bem]}${lead.faixaValor ? ` de ${FAIXAS_VALOR[lead.faixaValor]}` : ""}${
        lead.prazoCompra ? ` ${PRAZO_NA_FRASE[lead.prazoCompra]}` : ""
      }`
    : "quer —";
  const alertas = lead.diagnostico?.alertas?.length ? lead.diagnostico.alertas.join(", ") : lead.diagnostico ? "nenhum" : "—";
  return [
    lead.meetingFor ? horaEmBrasilia(lead.meetingFor) : "—",
    lead.name,
    quer,
    `parcela que cabe ${lead.faixaParcela ? FAIXAS_PARCELA[lead.faixaParcela] : "—"}`,
    `perfil do diagnóstico: ${lead.diagnostico?.perfil ?? "—"}`,
    `alertas: ${alertas}`,
  ]
    .join(" · ")
    .replace(/ /g, " ");
}
