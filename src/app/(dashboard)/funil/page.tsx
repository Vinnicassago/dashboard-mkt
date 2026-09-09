import { MousePointerClick, UserPlus, CalendarCheck, CheckCircle2, Handshake } from "lucide-react";
import { KpiCard } from "@/components/kpi/kpi-card";
import { FunnelChart } from "@/components/charts/funnel-chart";
import { HorizontalBars } from "@/components/charts/horizontal-bars";
import { LeadsTable, type LeadRow } from "@/components/tables/leads-table";
import { ChartCard } from "@/components/ui/chart-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { CHART } from "@/components/charts/colors";
import { getData } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { can } from "@/lib/auth/guard";
import { pageRange } from "@/lib/page-range";
import {
  adIdFromUtmContent,
  buildFunnel,
  cohortWeekly,
  filterLeads,
  isBooked,
  lossBreakdown,
  lossByKind,
  lpKpis,
  overviewKpis,
} from "@/lib/metrics";
import { formatCurrency, formatCurrency0, formatDecimal, formatInt, formatPercent } from "@/lib/format";

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
  const data = await getData(await activeBrandSlug());
  const canEditLeads = await can("leads:write");
  const { range } = pageRange(data, (await searchParams).range);

  const funnel = buildFunnel(data, range);
  const lp = lpKpis(data, range);
  const k = overviewKpis(data, range);
  const leads = filterLeads(data.leads, range);
  const cohorts = cohortWeekly(data, range, new Date().toISOString());

  // Perdas do período, quebradas por motivo e somadas por origem do problema.
  const lossRows = lossBreakdown(leads).filter((r) => r.count > 0);
  const byKind = lossByKind(leads);
  const lossTotal = byKind.qualidade + byKind.decisao;
  const losses = {
    rows: lossRows,
    total: lossTotal,
    qualidadeShare: lossTotal > 0 ? byKind.qualidade / lossTotal : 0,
  };

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
        description="Do anúncio à reunião — a última etapa mostra quem de fato compareceu à reunião."
      >
        <FunnelChart stages={funnel} />
      </ChartCard>

      {/* Conversion rates */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="LP → Lead" value={formatPercent(lp.visitToLead)} Icon={UserPlus} hint="leads ÷ visitas" />
        <KpiCard label="Lead → Reunião" value={formatPercent(k.leadToMeeting)} Icon={CalendarCheck} hint="reuniões ÷ leads" />
        <KpiCard label="Comparecimento" value={formatPercent(k.showRate)} Icon={CheckCircle2} hint="reuniões realizadas ÷ agendadas" />
        <KpiCard label="Reunião → Cliente" value={formatPercent(k.meetingToClient)} Icon={Handshake} hint="clientes ÷ reuniões" />
        <KpiCard label="CTR (anúncio)" value={formatPercent(k.ctr)} Icon={MousePointerClick} hint="cliques ÷ impressões" />
      </div>

      {/* Onde o funil vaza — só faz sentido com perda registrada no período */}
      {losses.total > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Por que perdemos</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Motivo</TH>
                  <TH>Onde está o problema</TH>
                  <TH className="text-right">Leads</TH>
                  <TH className="text-right">% das perdas</TH>
                </TR>
              </THead>
              <TBody>
                {losses.rows.map((row) => (
                  <TR key={row.status}>
                    <TD className="font-medium">{row.label}</TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-foreground/10"
                        >
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${Math.round(row.share * 100)}%`,
                              background:
                                row.kind === "qualidade" ? "var(--warning)" : "var(--critical)",
                            }}
                          />
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {row.kind === "qualidade" ? "Mídia" : "Oferta / pitch"}
                        </span>
                      </div>
                    </TD>
                    <TD className="text-right tabular">{formatInt(row.count)}</TD>
                    <TD className="text-right tabular">{formatPercent(row.share)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <p className="mt-3 text-xs text-muted-foreground">
              {formatInt(losses.total)} leads encerrados sem reunião ·{" "}
              <strong className="font-medium text-foreground">
                {formatPercent(losses.qualidadeShare)}
              </strong>{" "}
              por qualidade do lead (contato inválido, sem resposta) — isso se resolve na
              segmentação e no formulário, não no comercial. O restante chegou a falar com a
              equipe: é oferta e pitch.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Receita e retorno — só quando há cliente/receita */}
      {k.clients > 0 || k.revenue > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Receita e retorno</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: "Clientes", value: formatInt(k.clients) },
                { label: "Receita", value: formatCurrency0(k.revenue) },
                { label: "CAC", value: formatCurrency0(k.cac) },
                { label: "ROAS", value: `${formatDecimal(k.roas, 2)}×` },
                { label: "Ticket médio", value: formatCurrency0(k.ticket) },
                { label: "Valor / reunião", value: formatCurrency0(k.valuePerMeeting) },
              ].map((s) => (
                <div key={s.label}>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-2xl font-semibold tabular">{s.value}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              CAC = gasto de conversão ÷ clientes · ROAS = receita ÷ investimento total.
            </p>
          </CardContent>
        </Card>
      ) : null}

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

      {/* Coorte semanal — maturação por semana de entrada */}
      {cohorts.length >= 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>Coorte por semana de entrada</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Semana</TH>
                  <TH className="text-right">Leads</TH>
                  <TH className="text-right">Reuniões</TH>
                  <TH className="text-right">Lead→Reunião</TH>
                  <TH className="text-right">Clientes</TH>
                  <TH className="text-right">Receita</TH>
                </TR>
              </THead>
              <TBody>
                {cohorts.map((c) => (
                  <TR key={c.week}>
                    <TD className="font-medium">
                      {c.label}
                      {c.immature ? (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          (maturando)
                        </span>
                      ) : null}
                    </TD>
                    <TD className="text-right tabular">{formatInt(c.leads)}</TD>
                    <TD className="text-right tabular">{formatInt(c.meetings)}</TD>
                    <TD className="text-right tabular">{formatPercent(c.leadToMeeting)}</TD>
                    <TD className="text-right tabular">{formatInt(c.clients)}</TD>
                    <TD className="text-right tabular">{formatCurrency0(c.revenue)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <p className="mt-3 text-xs text-muted-foreground">
              Coortes recentes ainda estão maturando — não compare a conversão delas com
              as semanas mais antigas.
            </p>
          </CardContent>
        </Card>
      ) : null}

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
