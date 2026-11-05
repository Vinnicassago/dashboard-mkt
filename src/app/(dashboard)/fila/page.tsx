import Link from "next/link";
import { FilaList, type ExtrasDaLinha } from "@/components/fila/fila-list";
import { FilaLive } from "@/components/fila/fila-live";
import { montarFilaDaLive } from "@/lib/fila-live";
import { expedienteAtual } from "@/lib/atendimento-server";
import { AtualizacaoAutomatica } from "@/components/layout/atualizacao-automatica";
import { RolarParaAncora } from "@/components/ui/rolar-para-ancora";
import { getData, getState, listLeadEvents } from "@/lib/data/store";
import { STATE_KEYS } from "@/lib/data/backend";
import { activeBrandSlug } from "@/lib/active-brand";
import { estadoDoRoboAgora } from "@/lib/robo/estado";
import { dispararCaronaDoRobo } from "@/lib/robo/sync";
import type { ResumoLeituraRobo } from "@/lib/robo/casar";
import { fatoDoEpisodio, reabertosPorLead, type FiltroRobo } from "@/lib/robo/situacao";
import { after } from "next/server";
import { mensagemWhatsapp } from "@/lib/integracoes";
import { esperandoOComercial, montarFila, grupoDaUrl } from "@/lib/fila";
import { diaBrt } from "@/lib/horario-util";
import { quando } from "@/lib/contato";
import { can } from "@/lib/auth/guard";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatInt } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Fila de contato — o painel de trabalho do comercial: para quem ligar agora,
 * nesta ordem, e o que registrar depois.
 *
 * A seção da live (A e B pelo turno) vem primeiro e não mudou; depois os grupos
 * de `montarFila`, na ordem fixa (com o robô: Resgate, Aceitou o convite,
 * Reuniões a confirmar, Reuniões sem desfecho; sem o robô: Novos, Retornar, as
 * reuniões), cinco pessoas por grupo e uma linha por pessoa; no fim, quantos
 * estão com o robô agora. Nada de texto de abertura nem cartões repetindo o
 * mesmo número: a explicação de cada grupo está no ⓘ e a falha de leitura do
 * robô, no ⚠ do cabeçalho.
 *
 * Não respeita o seletor de período de propósito: "quem está esperando" é uma
 * pergunta sobre AGORA, e filtrar por 7 dias esconderia justamente os mais
 * antigos, que são os mais urgentes. Atualiza sozinha a cada minuto.
 */

/** O link da barra "Com o robô agora" para Leads — SEM período: o número clicado é o da página aberta. */
const linkDoRobo = (chave: FiltroRobo) => `/leads?robo=${chave}&range=all`;

export default async function FilaPage({
  searchParams,
}: {
  searchParams: Promise<{ etapa?: string | string[] }>;
}) {
  const { etapa } = await searchParams;
  const brand = await activeBrandSlug();
  const data = await getData(brand);
  const canEdit = await can("leads:write");
  const user = await getCurrentUser();
  const usuario = user?.username;
  // LGPD (Fase 6): o papel Marketing não vê telefone nem e-mail — nem aqui, nem
  // em Leads. Sem telefone o botão de WhatsApp some sozinho.
  const mascarar = user?.role === "marketing";
  const agora = new Date().toISOString();
  // De carona, depois da resposta: lê o robô se a última tentativa tem mais de 15 min
  // (job de sistema; a página não espera e nunca vê erro dele).
  after(() => dispararCaronaDoRobo(brand));

  // O robô pelo store (o sync grava os fatos no lead): o MESMO estado do Início e do aviso.
  const [robo, eventos, mensagem, expediente] = await Promise.all([
    estadoDoRoboAgora(brand),
    listLeadEvents({ brand, limit: 0 }),
    mensagemWhatsapp(),
    expedienteAtual(),
  ]);
  const roboLigado = robo.ligado;
  // Quem aceitou o convite e não casou com lead nenhum (só a contagem, do último sync).
  const leitura = roboLigado ? await getState<ResumoLeituraRobo>(STATE_KEYS.roboUltimaLeitura) : null;

  // Pediu ao robô para não receber mensagens (LGPD): o WhatsApp some de toda a
  // Fila — também da seção da live, que só recebe o item sem o telefone.
  const optOut = new Set(data.leads.filter((l) => l.roboOptOutEm).map((l) => l.id));
  const semContato = <T extends { telefone?: string; email?: string }>(i: T, leadId?: string): T =>
    mascarar ? { ...i, telefone: undefined, email: undefined } : leadId && optOut.has(leadId) ? { ...i, telefone: undefined } : i;

  // A Fila da live: A e B pelo prazo do turno. C e X não entram; quem não tem
  // classe segue a fila de sempre, abaixo.
  const filaLive = montarFilaDaLive(data.leads, eventos, agora, expediente);
  const liveA = filaLive.filter((i) => i.classe === "A");
  const liveB = filaLive.filter((i) => i.classe === "B");
  const naLive = new Set(filaLive.map((i) => i.leadId));

  // Robô desligado (sem credencial, desativado em Configurações, outra marca): o
  // processo antigo (Novos, Retornar). A leitura falhando é o ⚠ do cabeçalho.
  const fila = montarFila({ nowIso: agora, leads: data.leads, eventos, robo: roboLigado ? robo : undefined });

  // Por lead: o que a linha precisa além do item (do store, sem PII nova).
  const extras: Record<string, ExtrasDaLinha> = {};
  const porId = new Map(data.leads.map((l) => [l.id, l]));
  const reabertos = roboLigado ? reabertosPorLead(eventos) : new Map<string, string>();
  for (const i of fila.itens) {
    if (!i.leadId) continue;
    const l = porId.get(i.leadId);
    extras[i.leadId] = {
      aceitouEm: i.etapa === "convite-aceito" ? l?.roboAceitouEm : undefined,
      naLive: naLive.has(i.leadId),
      optOut: optOut.has(i.leadId),
      // "1ª msg há 26 h": a saudação DESTE episódio (a de antes do reaberto é da conversa antiga).
      primeiraMsgEm:
        i.etapa === "resgate" && i.motivo === "sem-resposta-24h"
          ? fatoDoEpisodio(l?.roboSaudacaoEm, reabertos.get(i.leadId))
          : undefined,
    };
  }

  // "Seu dia": o que quem está logado já fez hoje (Brasília).
  const hoje = diaBrt(agora);
  const meus = usuario ? eventos.filter((e) => e.actor === usuario && diaBrt(quando(e)) === hoje) : [];
  const tentativasHoje = meus.filter((e) => e.action === "tentativa").length;
  const agendamentosHoje = meus.filter((e) => e.action === "status_changed" && e.toStatus === "agendado").length;

  // Pessoas, não aparições (a live e "Aceitou o convite" contam uma vez): o MESMO
  // número do título "Atendimento · N esperando o comercial" do Início.
  const esperando = esperandoOComercial(fila, filaLive, roboLigado);

  const grupoInicial = grupoDaUrl(etapa, roboLigado);
  const grupos = fila.grupos.map((g) => ({ ...g, itens: g.itens.map((i) => semContato(i, i.leadId)) }));
  const barra: { n: number; rotulo: string; chave: FiltroRobo }[] = [
    { n: fila.comRobo.emConversa, rotulo: "em conversa", chave: "em-conversa" },
    { n: fila.comRobo.esperando, rotulo: "esperando resposta", chave: "esperando" },
    { n: fila.comRobo.encerrados, rotulo: fila.comRobo.encerrados === 1 ? "encerrado" : "encerrados", chave: "encerrado" },
  ];

  return (
    <div className="space-y-6">
      <RolarParaAncora padrao={grupoInicial} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {usuario ? (
          <p className="text-xs text-muted-foreground">
            Seu dia: {formatInt(tentativasHoje)} {tentativasHoje === 1 ? "tentativa" : "tentativas"} ·{" "}
            {formatInt(agendamentosHoje)} {agendamentosHoje === 1 ? "reunião agendada" : "reuniões agendadas"}
          </p>
        ) : (
          <span />
        )}
        <AtualizacaoAutomatica
          geradoEm={agora}
          titulo={esperando > 0 ? `(${esperando}) Fila de contato` : "Fila de contato"}
        />
      </div>

      <section id="live" className="scroll-mt-24 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Live 01/12 — A e B por prazo</h2>
          <p className="text-xs text-muted-foreground">
            {formatInt(filaLive.length)} na fila · A: {formatInt(liveA.length)}
            {liveA.some((i) => i.atrasado) ? (
              <span className="font-medium text-[var(--status-fora-text)]">
                {" "}
                ({formatInt(liveA.filter((i) => i.atrasado).length)} atrasados)
              </span>
            ) : null}{" "}
            · B: {formatInt(liveB.length)}
            {liveB.some((i) => i.atrasado) ? (
              <span className="font-medium text-[var(--status-perto-text)]">
                {" "}
                ({formatInt(liveB.filter((i) => i.atrasado).length)} atrasados)
              </span>
            ) : null}
          </p>
        </div>
        <FilaLive
          itens={filaLive.map((i) => semContato(i, i.leadId))}
          canEdit={canEdit}
          mensagemWhatsapp={mensagem}
        />
      </section>

      <FilaList
        grupos={grupos}
        canEdit={canEdit}
        mensagemWhatsapp={mensagem}
        agora={agora}
        grupoInicial={grupoInicial}
        extras={extras}
        transferidosSemLead={roboLigado ? (leitura?.transferidosSemLead ?? 0) : 0}
        roboLigado={roboLigado}
      />

      {roboLigado ? (
        <p className="text-sm text-muted-foreground">
          Com o robô agora:{" "}
          {barra.map((b, i) => (
            <span key={b.chave}>
              {i > 0 ? " · " : ""}
              <Link href={linkDoRobo(b.chave)} className="font-medium text-foreground underline-offset-4 hover:underline">
                {formatInt(b.n)} {b.rotulo}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
