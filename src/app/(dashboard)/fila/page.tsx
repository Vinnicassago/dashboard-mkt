import { AlertTriangle, CalendarClock, PhoneCall, RotateCcw } from "lucide-react";
import { KpiCard } from "@/components/kpi/kpi-card";
import { FilaList } from "@/components/fila/fila-list";
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
  const usuario = (await getCurrentUser())?.username;
  const agora = new Date().toISOString();

  const [comercial, convites, eventos, mensagem] = await Promise.all([
    getComercial(),
    getRoboLeads(),
    listLeadEvents({ brand, limit: 0 }),
    mensagemWhatsapp(),
  ]);

  const fila = montarFila({
    nowIso: agora,
    leads: data.leads,
    eventos,
    convites: convites.rows,
    comercial: comercial.rows,
  });

  // Robô desligado (sem credencial ou desativado em Ajustes): as etapas dele
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

  const esperando = (doGrupo("novo")?.total ?? 0) + (doGrupo("aguardando-contato")?.total ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Todo mundo que está esperando alguma coisa, numa lista só, do mais atrasado para o
          menos. O prazo do 1º contato é de 1 hora útil (seg–sex, 9h–18h): quem é contatado na
          primeira hora qualifica muito mais.
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
              parado, desative-o em Ajustes → Integrações e este aviso some.
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

      {usuario ? (
        <p className="text-xs text-muted-foreground">
          Seu dia: {formatInt(tentativasHoje)} {tentativasHoje === 1 ? "tentativa" : "tentativas"} ·{" "}
          {formatInt(agendamentosHoje)} {agendamentosHoje === 1 ? "reunião agendada" : "reuniões agendadas"}
        </p>
      ) : null}

      {fila.total === 0 ? (
        <EmptyState
          title="Ninguém esperando"
          hint="Todo lead novo já teve tentativa de contato, nenhum retorno venceu e nenhuma reunião está sem desfecho."
        />
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
            itens={fila.itens}
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
