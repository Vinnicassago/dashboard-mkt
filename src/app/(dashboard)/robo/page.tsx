import { Bot, MessageSquare, Timer, Gauge, ShieldAlert } from "lucide-react";
import { KpiCard } from "@/components/kpi/kpi-card";
import { FunnelChart } from "@/components/charts/funnel-chart";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatInt, formatPercentValue } from "@/lib/format";
import { getRoboSnapshot, type RoboMotivo, type RoboPendente } from "@/lib/robo/client";
import type { FunnelStage } from "@/lib/metrics";
import { getData } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { pageRange } from "@/lib/page-range";

export const dynamic = "force-dynamic";

const ETAPA_LABEL: Record<string, string> = {
  nao_respondeu: "Não respondeu",
  em_conversa: "Em conversa",
  convite_pendente: "Convite pendente",
  declinou: "Declinou",
  frio: "Frio",
  transferido: "Transferido",
};

function horas(n: number | null): string {
  if (n == null) return "—";
  if (n < 1) return `${Math.round(n * 60)} min`;
  return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
}

function quando(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function RoboPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  // mesmo seletor de período das outras abas
  const data = await getData(await activeBrandSlug());
  const { range } = pageRange(data, (await searchParams).range);

  const { kpis, diario, motivos, saude, pendentes } = await getRoboSnapshot(range?.from);

  if (!kpis) {
    return (
      <EmptyState
        title="Robô não conectado"
        hint="Defina ROBO_SUPABASE_URL e ROBO_SUPABASE_KEY nas variáveis de ambiente para ver o atendimento automático aqui."
      />
    );
  }

  const noPeriodo = diario.reduce((a, d) => a + (d.transferidos ?? 0), 0);
  const responderam = kpis.leads_total - kpis.nao_responderam;
  const convidados = kpis.convite_pendente + kpis.declinaram + kpis.transferidos;

  const funil: FunnelStage[] = [
    { key: "leads", label: "Chegaram pela LP", value: kpis.leads_total },
    {
      key: "responderam",
      label: "Responderam",
      value: responderam,
      fromPrev: kpis.leads_total ? responderam / kpis.leads_total : 0,
    },
    {
      key: "convidados",
      label: "Receberam convite",
      value: convidados,
      fromPrev: responderam ? convidados / responderam : 0,
    },
    {
      key: "transferidos",
      label: "Transferidos",
      value: kpis.transferidos,
      fromPrev: convidados ? kpis.transferidos / convidados : 0,
    },
  ];

  const colunasMotivo: Column<RoboMotivo>[] = [
    {
      key: "etapa",
      header: "Etapa",
      render: (r) => (
        <Badge variant={r.etapa === "transferido" ? "good" : "muted"}>
          {ETAPA_LABEL[r.etapa] ?? r.etapa}
        </Badge>
      ),
    },
    { key: "motivo", header: "Decisão do robô", render: (r) => r.motivo },
    {
      key: "leads",
      header: "Leads",
      align: "right",
      sortable: true,
      sortValue: (r) => r.leads,
      render: (r) => formatInt(r.leads),
    },
    {
      key: "score",
      header: "Score médio",
      align: "right",
      sortable: true,
      sortValue: (r) => r.score_medio ?? 0,
      render: (r) => r.score_medio ?? "—",
    },
    {
      key: "turnos",
      header: "Turnos",
      align: "right",
      render: (r) => r.turnos_medios ?? "—",
    },
  ];

  const colunasPendente: Column<RoboPendente>[] = [
    { key: "nome", header: "Lead", render: (r) => r.nome ?? "—" },
    {
      key: "telefone",
      header: "WhatsApp",
      render: (r) =>
        r.telefone ? (
          <a
            href={`https://wa.me/${r.telefone}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            {r.telefone}
          </a>
        ) : (
          "—"
        ),
    },
    {
      key: "score",
      header: "Score",
      align: "right",
      sortable: true,
      sortValue: (r) => r.score ?? 0,
      render: (r) => r.score ?? "—",
    },
    {
      key: "ultima",
      header: "Última mensagem",
      align: "right",
      render: (r) => quando(r.ultima_interacao),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-5">
        <KpiCard
          label="Transferidos ao especialista"
          value={formatInt(noPeriodo)}
          Icon={Bot}
          hint="no período"
          highlight
          spark={diario.map((d) => d.transferidos)}
        />
        <KpiCard
          label="Responderam a saudação"
          value={formatPercentValue(kpis.taxa_resposta)}
          Icon={MessageSquare}
          hint={`${formatInt(responderam)} de ${formatInt(kpis.leads_total)}`}
        />
        <KpiCard
          label="Aceitaram o convite"
          value={formatPercentValue(kpis.taxa_aceite_convite)}
          Icon={Gauge}
          hint="dos que foram convidados"
        />
        <KpiCard
          label="Score médio"
          value={kpis.score_medio?.toString() ?? "—"}
          Icon={Gauge}
          hint={`transferidos: ${kpis.score_medio_transferidos ?? "—"}`}
        />
        <KpiCard
          label="Tempo até transferir"
          value={horas(kpis.horas_medias_ate_transferir)}
          Icon={Timer}
          hint={`${kpis.turnos_medios_ate_transferir ?? "—"} turnos em média`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Do lead ao especialista</CardTitle>
          <CardDescription>
            O que aconteceu depois que o lead preencheu a landing page. Cada etapa é a
            conversão da anterior.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FunnelChart stages={funil} />
        </CardContent>
      </Card>

      {pendentes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Aguardando resposta ao convite ({pendentes.length})</CardTitle>
            <CardDescription>
              O robô ofereceu falar com o especialista e o lead não respondeu. São os
              contatos mais quentes parados — vale um toque manual.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={colunasPendente}
              rows={pendentes}
              rowKey={(r, i) => r.telefone ?? String(i)}
              initialSortKey="score"
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Onde cada grupo parou</CardTitle>
          <CardDescription>
            A decisão que o robô registrou no último turno de cada lead. Score baixo com
            muitos turnos costuma indicar pergunta que não gera sinal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={colunasMotivo}
            rows={motivos}
            rowKey={(r, i) => `${r.etapa}-${i}`}
            initialSortKey="leads"
            emptyTitle="Nenhuma conversa ainda"
          />
        </CardContent>
      </Card>

      {saude ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-muted-foreground" />
              Saúde do robô
            </CardTitle>
            <CardDescription>
              Respostas que os filtros de conformidade precisaram corrigir antes de enviar,
              e mensagens que chegaram sem identificação.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Respostas enviadas</p>
              <p className="mt-1 text-2xl font-semibold tabular">
                {formatInt(saude.respostas_robo)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Corrigidas pelo filtro</p>
              <p className="mt-1 text-2xl font-semibold tabular">
                {formatPercentValue(saude.taxa_bloqueio)}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatInt(saude.respostas_bloqueadas)} respostas
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Convite fora de hora</p>
              <p className="mt-1 text-2xl font-semibold tabular">
                {formatInt(saude.bloq_convite + saude.convite_removido)}
              </p>
              <p className="text-xs text-muted-foreground">removido antes de enviar</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Sem identificação</p>
              <p className="mt-1 text-2xl font-semibold tabular">
                {formatInt(saude.pendencias_identidade)}
              </p>
              <p className="text-xs text-muted-foreground">leads a reconciliar</p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
