import { MousePointerClick, UserPlus, CalendarCheck, CheckCircle2 } from "lucide-react";
import { KpiCard } from "@/components/kpi/kpi-card";
import { FunnelChart } from "@/components/charts/funnel-chart";
import { HorizontalBars } from "@/components/charts/horizontal-bars";
import { LeadsTable, type LeadRow } from "@/components/tables/leads-table";
import { ChartCard } from "@/components/ui/chart-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { CHART } from "@/components/charts/colors";
import { getData } from "@/lib/data/store";
import { can } from "@/lib/auth/guard";
import { pageRange } from "@/lib/page-range";
import {
  adIdFromUtmContent,
  buildFunnel,
  filterLeads,
  isBooked,
  lpKpis,
  overviewKpis,
} from "@/lib/metrics";
import { formatInt, formatPercent } from "@/lib/format";

function short(name: string, max = 24): string {
  return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

/** Chave de origem do lead: id do anúncio no utm_content, senão o próprio texto. */
function originKey(utmContent?: string): string {
  if (!utmContent) return "—";
  return adIdFromUtmContent(utmContent) ?? utmContent;
}
function originName(utmContent: string | undefined, nameById: Map<string, string>): string {
  if (!utmContent) return "—";
  const key = originKey(utmContent);
  return nameById.get(key) ?? utmContent.split("|")[0];
}

export default async function FunilPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const data = await getData();
  const canEditLeads = await can("leads:write");
  const { range } = pageRange(data, (await searchParams).range);

  const funnel = buildFunnel(data, range);
  const lp = lpKpis(data, range);
  const k = overviewKpis(data, range);
  const leads = filterLeads(data.leads, range);

  const nameById = new Map(data.creatives.map((c) => [c.adId, c.name]));

  // leads by origin (creative) — junta pelo id do anúncio embutido no utm_content
  const byCreative = new Map<string, number>();
  for (const l of leads) {
    const key = originKey(l.utmContent);
    byCreative.set(key, (byCreative.get(key) ?? 0) + 1);
  }
  const originBars = [...byCreative.entries()]
    .map(([key, value]) => ({ label: short(nameById.get(key) ?? key), value }))
    .sort((a, b) => b.value - a.value);

  const leadRows: LeadRow[] = [...leads]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 60)
    .map((l) => ({
      id: l.id,
      createdAt: l.createdAt,
      name: l.name,
      creativeName: originName(l.utmContent, nameById),
      status: l.status,
      meetingAt: l.meetingAt,
    }));

  return (
    <div className="space-y-6">
      <ChartCard
        title="Funil da campanha"
        description="Do anúncio à reunião — a última etapa mostra quem de fato compareceu."
      >
        <FunnelChart stages={funnel} />
      </ChartCard>

      {/* Conversion rates */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="CTR (anúncio)" value={formatPercent(k.ctr)} Icon={MousePointerClick} hint="cliques ÷ impressões" />
        <KpiCard label="LP → Lead" value={formatPercent(lp.visitToLead)} Icon={UserPlus} hint="leads ÷ visitas" />
        <KpiCard label="Lead → Reunião" value={formatPercent(k.leadToMeeting)} Icon={CalendarCheck} hint="reuniões ÷ leads" />
        <KpiCard label="Comparecimento" value={formatPercent(k.showRate)} Icon={CheckCircle2} hint="compareceu ÷ agendadas" />
      </div>

      {/* Landing page stats */}
      <Card>
        <CardHeader>
          <CardTitle>Landing page</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Visitas</p>
              <p className="text-2xl font-semibold tabular">{formatInt(lp.visits)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cliques no CTA</p>
              <p className="text-2xl font-semibold tabular">{formatInt(lp.clicks)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Leads (formulário)</p>
              <p className="text-2xl font-semibold tabular">{formatInt(lp.formSubmits)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Conversão da página</p>
              <p className="text-2xl font-semibold tabular">{formatPercent(lp.visitToLead)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Origin + leads */}
      <ChartCard title="Leads por criativo (origem)" description="De onde vieram os cadastros.">
        {originBars.length ? (
          <HorizontalBars data={originBars} valueFormat="int" barColor={CHART.series[2]} />
        ) : (
          <EmptyState title="Sem leads no período" />
        )}
      </ChartCard>

      <Card>
        <CardHeader>
          <CardTitle>
            Leads recentes{" "}
            <span className="font-normal text-muted-foreground">
              ({formatInt(leads.filter(isBooked).length)} com reunião de {formatInt(leads.length)})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {leadRows.length ? (
            <LeadsTable rows={leadRows} canEdit={canEditLeads} />
          ) : (
            <EmptyState title="Nenhum lead ainda" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
