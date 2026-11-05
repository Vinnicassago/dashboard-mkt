import { ExampleBanner } from "@/components/example-banner";
import { ResumoSemanalCard } from "@/components/kpi/resumo-semanal";
import { RegistrarAlertas } from "@/components/layout/alertas";
import type { Alerta } from "@/lib/alertas";
import type { Inicio } from "@/lib/inicio";
import type { ResumoSemanal } from "@/lib/types";
import { AtendimentoBloco } from "./atendimento";
import { CartoesDoInicio } from "./cartoes";
import { LeadsChegandoBloco } from "./leads-chegando";
import { RodapeDoInicioBloco } from "./rodape";

/**
 * O INÍCIO no modo normal (Fase 2, C13): os quatro blocos de `montarInicio`, e só
 * eles (bloco novo = tirar um) — no notebook, os 4 cartões numa linha; "Leads
 * chegando" (2/3) e "Atendimento" (1/3) na mesma linha; o resumo da IA (só quando
 * existe) e o rodapé numa linha. No celular, cartões em 2 colunas e o resto
 * empilhado.
 *
 * Recebe o objeto do Início pronto (server). Para os componentes client só vai
 * texto e número: o ⓘ (string), as barras (data, leads, pausado), os links e os
 * resumos — nunca `b`, `b.data`, eventos, a Fila ou a linha de Leads.
 */
export function InicioNormal({
  inicio,
  alertas,
  isSeed,
  rangeKey,
  resumos,
  canWrite,
  aiEnabled,
}: {
  inicio: Inicio;
  alertas: Alerta[];
  isSeed?: boolean;
  rangeKey: string;
  resumos: ResumoSemanal[];
  canWrite: boolean;
  aiEnabled: boolean;
}) {
  return (
    <div className="space-y-4">
      <RegistrarAlertas alertas={alertas} />
      {isSeed ? <ExampleBanner rangeKey={rangeKey} /> : null}

      <CartoesDoInicio cartoes={inicio.cartoes} />

      <div className="grid gap-4 lg:grid-cols-3">
        <LeadsChegandoBloco bloco={inicio.leadsChegando} className="lg:col-span-2" />
        <AtendimentoBloco bloco={inicio.atendimento} />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <ResumoSemanalCard resumos={resumos} canWrite={canWrite} aiEnabled={aiEnabled} className="min-w-0 lg:max-w-xl lg:flex-1" />
        <RodapeDoInicioBloco rodape={inicio.rodape} className="lg:ml-auto lg:py-2.5" />
      </div>
    </div>
  );
}
