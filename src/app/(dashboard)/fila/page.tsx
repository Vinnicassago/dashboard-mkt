import { AlertTriangle, PhoneCall } from "lucide-react";
import { KpiCard } from "@/components/kpi/kpi-card";
import { FilaList } from "@/components/fila/fila-list";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getData } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { getComercial, getRoboLeads } from "@/lib/robo/client";
import {
  montarFila,
  FILA_ETAPAS,
  formatEspera,
  type FilaEtapa,
  type FiltroFila,
} from "@/lib/fila";
import { can } from "@/lib/auth/guard";
import { formatInt } from "@/lib/format";
import { DONO_LABEL } from "@/lib/dono";

export const dynamic = "force-dynamic";

/**
 * Fila de contato — para quem ligar agora, nesta ordem.
 *
 * Junta as três filas que hoje vivem em telas separadas e se sobrepõem sem que
 * ninguém veja o total. Não respeita o seletor de período de propósito: "quem
 * está esperando" é uma pergunta sobre AGORA, e filtrar por 7 dias esconderia
 * justamente os mais antigos, que são os mais urgentes.
 */
/** Filtro vindo do link (farol, ações). Valor desconhecido cai em "todos". */
function filtroDaUrl(etapa?: string): FiltroFila {
  if (etapa === "quentes" || etapa === "todos") return etapa;
  if (etapa && etapa in FILA_ETAPAS) return etapa as FilaEtapa;
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

  const [comercial, convites] = await Promise.all([getComercial(), getRoboLeads()]);

  const fila = montarFila({
    nowIso: new Date().toISOString(),
    leads: data.leads,
    convites: convites.rows,
    comercial: comercial.rows,
  });

  // Leitura do robô falhou: a fila ficaria só com os leads do painel e pareceria
  // completa. Melhor dizer que está parcial do que entregar uma lista curta.
  const parcial = comercial.falha?.tipo === "erro" || convites.falha?.tipo === "erro";

  const aguardando = fila.resumo.find((r) => r.etapa === "aguardando-contato");
  const foraDoPrazo = fila.resumo.reduce((s, r) => s + r.foraDoPrazo, 0);
  const maisAntigo = fila.itens[0];

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Todo mundo que está esperando alguma coisa, numa lista só, do mais atrasado para o
        menos. A ordem é por quanto cada um passou do prazo da <em>sua</em> etapa — quem foi
        transferido ao especialista há 6 horas vem antes de um lead parado há 30, porque
        custou muito mais caro para chegar até ali.
      </p>

      {parcial ? (
        <Card className="border-[var(--warning)]/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning-text)]" />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Esta fila está incompleta.</span>{" "}
              Não consegui ler o robô, então só aparecem os leads do painel — quem está
              esperando o especialista não está listado aqui.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Pessoas na fila"
          value={formatInt(fila.total)}
          Icon={PhoneCall}
          hint="sem duplicatas"
          highlight
        />
        <KpiCard
          label="Fora do prazo"
          value={formatInt(foraDoPrazo)}
          Icon={AlertTriangle}
          hint="passaram do SLA da etapa"
        />
        <KpiCard
          label="Esperando o especialista"
          value={formatInt(aguardando?.total ?? 0)}
          hint={`SLA de ${FILA_ETAPAS["aguardando-contato"].slaHoras}h`}
        />
        <KpiCard
          label="Espera mais longa"
          value={formatEspera(maisAntigo?.horasEsperando)}
          hint={maisAntigo ? maisAntigo.nome : undefined}
        />
      </div>

      {fila.total === 0 ? (
        <EmptyState
          title="Ninguém esperando"
          hint="Todo lead que entrou já tem um desfecho registrado, e ninguém está parado no robô ou no especialista."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {fila.resumo.map((r) => {
              const meta = FILA_ETAPAS[r.etapa as FilaEtapa];
              return (
                <Card key={r.etapa}>
                  <CardContent className="space-y-1 p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">{meta.label}</p>
                      <span className="tabular text-lg font-semibold">{r.total}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{meta.hint}</p>
                    <p className="text-xs text-muted-foreground">
                      Prazo {meta.slaHoras}h ·{" "}
                      {r.foraDoPrazo > 0 ? (
                        <span className="font-medium text-[var(--danger-text)]">
                          {r.foraDoPrazo} fora
                        </span>
                      ) : (
                        "todos no prazo"
                      )}{" "}
                      · dono: {DONO_LABEL[meta.dono]}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <FilaList itens={fila.itens} canEdit={canEdit} filtroInicial={filtroDaUrl(etapa)} />
        </>
      )}
    </div>
  );
}
