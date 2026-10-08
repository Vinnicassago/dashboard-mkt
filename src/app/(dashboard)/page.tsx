import { DollarSign, UserPlus, Sparkles, Users, Radio } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ExampleBanner } from "@/components/example-banner";
import { KpiCard } from "@/components/kpi/kpi-card";
import { GoalBar } from "@/components/kpi/goal-bar";
import { absDelta, pctDelta } from "@/components/kpi/delta";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { ChartCard } from "@/components/ui/chart-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getData, listResumosSemanais } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { brandDef } from "@/lib/brands";
import { pageRange } from "@/lib/page-range";
import { PERIODO_PADRAO_DA_BUSSOLA, carregarBussola } from "@/lib/bussola-server";
import { PlacarCard } from "@/components/kpi/placar-card";
import { Motores } from "@/components/kpi/motores";
import { OndeTrava } from "@/components/kpi/onde-trava";
import { AcoesSemana } from "@/components/kpi/acoes-semana";
import { ResumoSemanalCard } from "@/components/kpi/resumo-semanal";
import {
  awarenessKpis,
  dataQualityChecks,
  followerSeries,
  goalProgress,
  igAccountTotals,
  previousRange,
  type DateRange,
} from "@/lib/metrics";
import { alertasDeQualidade, type Alerta } from "@/lib/alertas";
import { RegistrarAlertas } from "@/components/layout/alertas";
import { buildInsights } from "@/lib/insights";
import { buildRecommendations, type Recommendation } from "@/lib/recommendations";
import type { DashboardData } from "@/lib/types";
import { RecommendationsCard } from "@/components/kpi/recommendations";
import { isAiConfigured } from "@/lib/ai/config";
import { can } from "@/lib/auth/guard";
import { getCurrentUser } from "@/lib/auth/current-user";
import { comPeriodo } from "@/lib/range";
import { formatCompact, formatCurrency0, formatCurrencyOrDash, formatInt, formatIntComSinal } from "@/lib/format";
import { CHART } from "@/components/charts/colors";

export const dynamic = "force-dynamic";

/**
 * A BÚSSOLA — "estamos no ritmo? onde trava? o que fazer?" em cinco blocos:
 * placar, motores, onde trava, ações da semana, rodapé (resumo da IA e links).
 * Bloco novo = tirar um. Os alertas de dado moram no "⚠" do cabeçalho.
 *
 * Sem `?range=` a Bússola olha a semana (7 dias contra os 7 anteriores); o
 * seletor do cabeçalho sabe disso (`periodoPadrao` em nav-items). O comercial
 * entra pela Fila: a home dele é a lista de quem ligar, não o placar.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await getCurrentUser();
  if (user?.role === "comercial") redirect("/fila");

  const brand = brandDef(await activeBrandSlug());
  const rangeParam = (await searchParams).range;
  const aiEnabled = isAiConfigured();
  const canWrite = await can("data:write");

  // Marca de awareness (krone.capital): visão de crescimento de perfil, não de funil.
  if (brand.type === "awareness") {
    const data = await getData(brand.slug);
    // O mesmo padrão da Bússola (a semana): o seletor marca "7 dias" para as duas marcas.
    const { range } = pageRange(data, rangeParam ?? PERIODO_PADRAO_DA_BUSSOLA);
    return (
      <AwarenessOverview
        data={data}
        range={range}
        recs={buildRecommendations(data, range, new Date().toISOString())}
        insights={buildInsights(data, range)}
        alertas={alertasDeQualidade(dataQualityChecks(data))}
        hint={range ? "vs. período anterior" : "no período"}
        resumoCard={
          <ResumoSemanalCard
            resumos={await listResumosSemanais({ brand: brand.slug, limit: 12 })}
            canWrite={canWrite}
            aiEnabled={aiEnabled}
          />
        }
      />
    );
  }

  const b = await carregarBussola(brand.slug, rangeParam);
  const podeDecidir = (await can("leads:write")) || canWrite;
  const ig = igAccountTotals(b.data.igAccountDaily, b.range);

  return (
    <div className="space-y-4">
      <RegistrarAlertas alertas={b.alertas} />
      {b.data.isSeed ? <ExampleBanner /> : null}

      {/* 1. PLACAR — o veredito. */}
      <PlacarCard placar={b.placar} serie={b.serie} rangeKey={b.rangeKey} />

      {/* 2. MOTORES — só os de dinheiro; as taxas moram no funil. */}
      <Motores kpis={b.kpis} regua={b.regua} />

      {/* 3. ONDE TRAVA — as transições com dono e o gargalo. */}
      <OndeTrava transicoes={b.transicoes} gargalo={b.gargalo} rangeKey={b.rangeKey} />

      {/* 4. AÇÕES — o motor v2, com estado por semana. */}
      <AcoesSemana acoes={b.acoes} historico={b.historicoAcoes} rangeKey={b.rangeKey} podeDecidir={podeDecidir} roboErro={b.roboErro} />

      {/* 5. RODAPÉ — o resumo da semana (recolhido) e os links. */}
      <ResumoSemanalCard resumos={b.resumos} canWrite={canWrite} aiEnabled={aiEnabled} />
      <p className="flex flex-wrap gap-x-5 gap-y-1 border-t pt-4 text-xs text-muted-foreground" data-bloco="rodape">
        <Link href={comPeriodo("/jornada", b.rangeKey)} className="hover:text-foreground">
          Funil completo →
        </Link>
        <Link href={comPeriodo("/dinheiro", b.rangeKey)} className="hover:text-foreground">
          Verba por conjunto e por criativo →
        </Link>
        <Link href={comPeriodo("/conteudo", b.rangeKey)} className="hover:text-foreground">
          {/* O alcance da conta INCLUI anúncios (Meta) — não é orgânico (B11). */}
          Instagram: {formatCompact(ig.reach)} de alcance da conta (pago + orgânico),{" "}
          {formatIntComSinal(ig.followersEnd - ig.followersStart)} seguidores →
        </Link>
      </p>
    </div>
  );
}

/**
 * Visão Geral de uma marca de awareness (krone.capital): crescimento de perfil,
 * custo por seguidor e alcance — sem funil de lead/CPR. Usa o bundle
 * `awarenessKpis` (Fase 2). Custos aparecem como "—" quando não há crescimento.
 */
function AwarenessOverview({
  data,
  range,
  recs,
  insights,
  alertas,
  hint,
  resumoCard,
}: {
  data: DashboardData;
  range: DateRange | undefined;
  recs: Recommendation[];
  insights: string[];
  alertas: Alerta[];
  hint: string;
  resumoCard: React.ReactNode;
}) {
  const a = awarenessKpis(data, range);
  const prevA = range ? awarenessKpis(data, previousRange(range)) : undefined;
  const series = followerSeries(data.igAccountDaily, range);
  const followersGoal = data.goals.find((g) => g.metric === "followers");
  const gp = followersGoal ? goalProgress(followersGoal, a.followersEnd) : undefined;

  return (
    <div className="space-y-6">
      <RegistrarAlertas alertas={alertas} />
      {data.isSeed ? <ExampleBanner /> : null}

      {/* Hero KPIs de crescimento */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-5">
        <KpiCard
          label="Seguidores"
          value={formatInt(a.followersEnd)}
          Icon={Users}
          delta={absDelta(a.netNewFollowers)}
          hint={hint}
          highlight
        />
        <KpiCard
          label="Novos seguidores"
          value={`${a.netNewFollowers >= 0 ? "+" : ""}${formatInt(a.netNewFollowers)}`}
          Icon={UserPlus}
          delta={prevA ? pctDelta(a.netNewFollowers, prevA.netNewFollowers) : undefined}
          hint={hint}
        />
        <KpiCard
          label="Investimento"
          value={formatCurrency0(a.spend)}
          Icon={DollarSign}
          delta={prevA ? pctDelta(a.spend, prevA.spend) : undefined}
          hint={hint}
        />
        <KpiCard
          label="Custo por seguidor"
          value={formatCurrencyOrDash(a.costPerFollower)}
          Icon={Sparkles}
          hint={a.spend > 0 ? "North Star" : "sem verba atribuída à marca"}
          highlight
        />
        <KpiCard
          label="Custo / 1k alcance"
          value={formatCurrencyOrDash(a.costPerReach)}
          Icon={Radio}
          hint={a.spend > 0 ? "alcance da conta" : "sem verba atribuída à marca"}
        />
      </div>

      {resumoCard}

      {/* Meta de seguidores */}
      {followersGoal && gp ? (
        <Card>
          <CardHeader>
            <CardTitle>Meta de seguidores</CardTitle>
          </CardHeader>
          <CardContent>
            <GoalBar
              label="Seguidores"
              valueText={formatInt(a.followersEnd)}
              targetText={formatInt(followersGoal.target)}
              pct={gp.pct}
              onTrack={gp.onTrack}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* Crescimento */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Seguidores" description="Total de seguidores ao longo do tempo.">
          <TimeSeriesChart
            data={series}
            series={[{ key: "followers", label: "Seguidores", color: CHART.series[0] }]}
            yFormat="int"
          />
        </ChartCard>
        <ChartCard title="Novos seguidores por dia" description="Crescimento líquido diário.">
          <TimeSeriesChart
            data={series}
            series={[{ key: "gain", label: "Novos seguidores", color: CHART.series[2] }]}
            yFormat="int"
          />
        </ChartCard>
      </div>

      <ChartCard title="Alcance e Views por dia" description="Quantas contas viram o conteúdo.">
        <TimeSeriesChart
          data={series}
          series={[
            { key: "reach", label: "Alcance", color: CHART.series[0] },
            { key: "views", label: "Views", color: CHART.series[1] },
          ]}
          yFormat="compact"
          valueFormat="int"
        />
      </ChartCard>

      {/* Próximas ações */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            Próximas ações
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RecommendationsCard recs={recs} fallback={insights} />
        </CardContent>
      </Card>
    </div>
  );
}

