import { AlertTriangle, CalendarClock, PhoneCall, RotateCcw } from "lucide-react";
import { KpiCard } from "@/components/kpi/kpi-card";
import { FilaList } from "@/components/fila/fila-list";
import { FilaLive } from "@/components/fila/fila-live";
import { montarFilaDaLive } from "@/lib/fila-live";
import { expedienteAtual } from "@/lib/atendimento-server";
import Link from "next/link";
import { AtualizacaoAutomatica } from "@/components/layout/atualizacao-automatica";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getData, listLeadEvents } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { getComercial, getRoboLeads } from "@/lib/robo/client";
import { mensagemWhatsapp } from "@/lib/integracoes";
import {
  montarFila,
  ETAPAS_DO_ROBO,
  FILA_ETAPAS,
  type FilaEtapa,
  type FiltroFila,
} from "@/lib/fila";
import { diaBrt } from "@/lib/horario-util";
import { quando } from "@/lib/contato";
import { can } from "@/lib/auth/guard";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatInt } from "@/lib/format";
import { DONO_LABEL } from "@/lib/dono";

export const dynamic = "force-dynamic";

/**
 * Fila de contato — o painel de trabalho do comercial: para quem ligar agora,
 * nesta ordem, e o que registrar depois.
 *
 * Não respeita o seletor de período de propósito: "quem está esperando" é uma
 * pergunta sobre AGORA, e filtrar por 7 dias esconderia justamente os mais
 * antigos, que são os mais urgentes. Atualiza sozinha a cada minuto.
 */
/** Filtro vindo do link (farol, ações). Valor desconhecido cai em "todos". */
function filtroDaUrl(etapa?: string): FiltroFila {
  if (etapa === "quentes" || etapa === "todos") return etapa;
  if (etapa && etapa in FILA_ETAPAS) return etapa as FilaEtapa;
  // Links antigos ("sem-status") caem nos novos.
  if (etapa === "sem-status") return "novo";
  return "todos";
}

export default async function FilaPage({
  searchParams,
}: {
  searchParams: Promise<{ etapa?: string }>;
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

  const [comercial, convites, eventos, mensagem, expediente] = await Promise.all([
    getComercial(),
    getRoboLeads(),
    listLeadEvents({ brand, limit: 0 }),
    mensagemWhatsapp(),
    expedienteAtual(),
  ]);

  // A Fila da live: A e B pelo prazo do turno. C e X não entram; quem não tem
  // classe segue a fila de sempre, abaixo.
  const filaLive = montarFilaDaLive(data.leads, eventos, agora, expediente);
  const liveA = filaLive.filter((i) => i.classe === "A");
  const liveB = filaLive.filter((i) => i.classe === "B");

  const fila = montarFila({
    nowIso: agora,
    leads: data.leads,
    eventos,
    convites: convites.rows,
    comercial: comercial.rows,
  });

  // Robô desligado (sem credencial ou desativado em Configurações): as etapas dele
  // não existem. Leitura que QUEBROU é outra coisa — aí a fila está incompleta.
  const roboLigado = comercial.falha?.tipo !== "desligado" || convites.falha?.tipo !== "desligado";
  const parcial = comercial.falha?.tipo === "erro" || convites.falha?.tipo === "erro";
  const etapasVisiveis = (Object.keys(FILA_ETAPAS) as FilaEtapa[]).filter(
    (e) => roboLigado || !ETAPAS_DO_ROBO.includes(e),
  );

  const doGrupo = (e: FilaEtapa) => fila.resumo.find((r) => r.etapa === e);
  const foraDoPrazo = fila.resumo
    .filter((r) => r.etapa !== "confirmar")
    .reduce((s, r) => s + r.foraDoPrazo, 0);

  // "Seu dia": o que quem está logado já fez hoje (Brasília).
  const hoje = diaBrt(agora);
  const meus = usuario ? eventos.filter((e) => e.actor === usuario && diaBrt(quando(e)) === hoje) : [];
  const tentativasHoje = meus.filter((e) => e.action === "tentativa").length;
  const agendamentosHoje = meus.filter((e) => e.action === "status_changed" && e.toStatus === "agendado").length;

  const esperando =
    (doGrupo("novo")?.total ?? 0) +
    (doGrupo("aguardando-contato")?.total ?? 0) +
    filaLive.filter((i) => i.etapa === "primeira").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Primeiro os inscritos da live (A e B), na ordem do prazo da tentativa — o turno e os
          prazos estão em{" "}
          <Link href="/configuracoes/atendimento#turno" className="text-primary underline-offset-4 hover:underline">
            Configurações → Atendimento
          </Link>
          . C e X ficam só em Leads. Abaixo, quem entrou sem as respostas, pela régua de sempre
          (1 hora útil, seg–sex, 9h–18h).
        </p>
        <AtualizacaoAutomatica
          geradoEm={agora}
          titulo={esperando > 0 ? `(${esperando}) Fila de contato` : "Fila de contato"}
        />
      </div>

      {parcial ? (
        <Card className="border-[var(--warning)]/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning-text)]" />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Esta fila está incompleta.</span>{" "}
              Não consegui ler o robô, então só aparecem os leads do painel. Se o robô está
              parado, desative-o em Configurações → Integrações e este aviso some.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Aguardando 1º contato"
          value={formatInt(esperando)}
          Icon={PhoneCall}
          hint="prazo: 1 hora útil"
          highlight
        />
        <KpiCard
          label="Fora do prazo"
          value={formatInt(foraDoPrazo)}
          Icon={AlertTriangle}
          hint="passaram do prazo da etapa"
        />
        <KpiCard
          label="Retornos de hoje"
          value={formatInt(doGrupo("retornar")?.total ?? 0)}
          Icon={RotateCcw}
          hint="tentativa combinada que venceu"
        />
        <KpiCard
          label="Reuniões a confirmar"
          value={formatInt(doGrupo("confirmar")?.total ?? 0)}
          Icon={CalendarClock}
          hint="nas próximas 48 horas"
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
          itens={mascarar ? filaLive.map((i) => ({ ...i, telefone: undefined, email: undefined })) : filaLive}
          canEdit={canEdit}
          mensagemWhatsapp={mensagem}
        />
      </section>

      {usuario ? (
        <p className="text-xs text-muted-foreground">
          Seu dia: {formatInt(tentativasHoje)} {tentativasHoje === 1 ? "tentativa" : "tentativas"} ·{" "}
          {formatInt(agendamentosHoje)} {agendamentosHoje === 1 ? "reunião agendada" : "reuniões agendadas"}
        </p>
      ) : null}

      {fila.total === 0 ? (
        filaLive.length ? (
          <p className="text-xs text-muted-foreground">
            Fora da live, ninguém esperando: nenhum lead sem classe sem tentativa, nenhum retorno vencido, nenhuma
            reunião sem desfecho.
          </p>
        ) : (
          <EmptyState
            title="Ninguém esperando"
            hint="Todo lead novo já teve tentativa de contato, nenhum retorno venceu e nenhuma reunião está sem desfecho."
          />
        )
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {fila.resumo
              .filter((r) => etapasVisiveis.includes(r.etapa))
              .map((r) => {
                const meta = FILA_ETAPAS[r.etapa as FilaEtapa];
                return (
                  <Card key={r.etapa}>
                    <CardContent className="space-y-1 p-4">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-medium">{meta.label}</p>
                        <span className="tabular text-lg font-semibold">{r.total}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{meta.hint}</p>
                      {r.etapa !== "confirmar" ? (
                        <p className="text-xs text-muted-foreground">
                          Prazo {meta.slaHoras} h{meta.horasUteis ? " útil" : ""} ·{" "}
                          {r.foraDoPrazo > 0 ? (
                            <span className="font-medium text-[var(--danger-text)]">{r.foraDoPrazo} fora</span>
                          ) : (
                            "todos no prazo"
                          )}{" "}
                          · dono: {DONO_LABEL[meta.dono]}
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
          </div>

          <FilaList
            itens={mascarar ? fila.itens.map((i) => ({ ...i, telefone: undefined, email: undefined })) : fila.itens}
            canEdit={canEdit}
            filtroInicial={filtroDaUrl(etapa)}
            etapasVisiveis={etapasVisiveis}
            mensagemWhatsapp={mensagem}
          />
        </>
      )}
    </div>
  );
}
