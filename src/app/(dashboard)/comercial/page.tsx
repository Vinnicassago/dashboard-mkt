import { Handshake, Timer, CalendarCheck, Trophy, AlertCircle } from "lucide-react";
import { KpiCard } from "@/components/kpi/kpi-card";
import { ComercialTable } from "@/components/robo/comercial-table";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatInt, formatPercentValue } from "@/lib/format";
import { getComercial } from "@/lib/robo/client";
import { can } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/** 135 → "2 h 15 min" */
function duracao(min: number | null): string {
  if (min == null) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export default async function ComercialPage() {
  const { rows, kpis } = await getComercial();
  const canEdit = await can("leads:write");

  if (!kpis) {
    return (
      <EmptyState
        title="Robô não conectado"
        hint="Defina ROBO_SUPABASE_URL e ROBO_SUPABASE_KEY nas variáveis de ambiente para acompanhar o atendimento aqui."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label="Leads recebidos"
          value={formatInt(kpis.transferidos)}
          Icon={Handshake}
          hint="transferidos pelo robô"
        />
        <KpiCard
          label="Já abordados"
          value={formatPercentValue(kpis.taxa_abordagem)}
          Icon={CalendarCheck}
          hint={`${formatInt(kpis.abordados)} de ${formatInt(kpis.transferidos)}`}
        />
        <KpiCard
          label="Tempo até o 1º contato"
          value={duracao(kpis.minutos_medios_ate_abordagem)}
          Icon={Timer}
          hint={`pior caso: ${duracao(kpis.pior_tempo_minutos)}`}
          highlight
        />
        <KpiCard
          label="Reuniões realizadas"
          value={formatInt(kpis.reunioes_realizadas)}
          Icon={CalendarCheck}
          hint={`${formatInt(kpis.reunioes_marcadas)} marcadas`}
        />
        <KpiCard
          label="Negócios fechados"
          value={formatInt(kpis.negocios_fechados)}
          Icon={Trophy}
          highlight
        />
      </div>

      {kpis.aguardando_abordagem > 0 ? (
        <Card className="border-[var(--warning)]/40">
          <CardContent className="flex items-start gap-3 p-5">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-[var(--warning-text)]" />
            <p className="text-sm">
              <span className="font-medium">
                {formatInt(kpis.aguardando_abordagem)} lead
                {kpis.aguardando_abordagem > 1 ? "s" : ""} esperando o primeiro contato.
              </span>{" "}
              <span className="text-muted-foreground">
                São leads que já autorizaram a conversa. Responder rápido é o que mais
                aumenta o agendamento.
              </span>
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Atendimento ({rows.length})</CardTitle>
          <CardDescription>
            Cada lead que o robô qualificou e passou ao especialista. O tempo até o
            primeiro contato começa a contar na transferência e para quando &ldquo;Abordado&rdquo;
            vira Sim.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ComercialTable rows={rows} canEdit={canEdit} />
        </CardContent>
      </Card>
    </div>
  );
}
