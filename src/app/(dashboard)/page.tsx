import { DollarSign, UserPlus, Sparkles, Users, Radio } from "lucide-react";
import { redirect } from "next/navigation";
import { ExampleBanner } from "@/components/example-banner";
import { KpiCard } from "@/components/kpi/kpi-card";
import { GoalBar } from "@/components/kpi/goal-bar";
import { absDelta, pctDelta } from "@/components/kpi/delta";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { ChartCard } from "@/components/ui/chart-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InicioNormal } from "@/components/inicio/inicio-normal";
import { PainelLive } from "@/components/live/painel-live";
import { getData, listResumosSemanais } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { brandDef } from "@/lib/brands";
import { pageRange } from "@/lib/page-range";
import { PERIODO_PADRAO_DA_BUSSOLA, carregarBussola } from "@/lib/bussola-server";
import { campanhaDaLive } from "@/lib/live-server";
import { periodoDaLive } from "@/lib/atalho-live";
import { ResumoSemanalCard } from "@/components/kpi/resumo-semanal";
import {
  awarenessKpis,
  dataQualityChecks,
  followerSeries,
  pontosDoTotalDeSeguidores,
  goalProgress,
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
import { formatCurrency0, formatCurrencyOrDash, formatInt } from "@/lib/format";
import { CHART } from "@/components/charts/colors";

export const dynamic = "force-dynamic";

/**
 * O INÍCIO — "o que chegou, quanto custou e quem está esperando agora?" em quatro
 * blocos (cartões, leads chegando, atendimento, rodapé) mais o resumo da IA
 * quando existe; tudo sai de `carregarBussola` (`b.inicio`) e é desenhado por
 * `components/inicio/*`. Bloco novo = tirar um. Os alertas de dado moram no "⚠"
 * do cabeçalho.
 *
 * Com o `?range=` numa das três chaves da régua da live (`periodoDaLive`), o
 * Início vira o PAINEL DA LIVE (`b.live`, `components/live/painel-live.tsx`) mais
 * o resumo da IA, se existir — sem rodapé. Sem `?range=` olha a semana (7 dias
 * contra os 7 anteriores). O comercial entra pela Fila — menos no modo live, onde
 * ele grava os números manuais.
 *
 * Esta página só carrega e repassa: o servidor fica com `b` inteiro (base,
 * eventos, robô); para os componentes client vão só textos, números e links.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const [user, brandSlug, { range: rangeParam }, cfgDaLive] = await Promise.all([
    getCurrentUser(),
    activeBrandSlug(),
    searchParams,
    campanhaDaLive(),
  ]);
  const brand = brandDef(brandSlug);
  // A régua e o período ANTES do redirect: no modo live o comercial fica (C10).
  const modoLive = brand.type !== "awareness" && periodoDaLive(rangeParam, cfgDaLive) !== null;
  if (user?.role === "comercial" && !modoLive) redirect("/fila");

  const aiEnabled = isAiConfigured();
  const [canWrite, podeLeads] = await Promise.all([can("data:write"), can("leads:write")]);

  // Marca de awareness (krone.capital): visão de crescimento de perfil, não de funil.
  if (brand.type === "awareness") {
    const data = await getData(brand.slug);
    // O mesmo padrão do Início (a semana): o seletor marca "7 dias" para as duas marcas.
    const { range, rangeKey } = pageRange(data, rangeParam ?? PERIODO_PADRAO_DA_BUSSOLA);
    return (
      <AwarenessOverview
        data={data}
        range={range}
        rangeKey={rangeKey}
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

  const b = await carregarBussola(brand.slug, rangeParam, { cfgDaLive });

  // MODO LIVE — o painel da live mais o resumo da IA (só se existir), sem rodapé (C11).
  if (b.modo === "live") {
    return (
      <div className="space-y-6">
        <RegistrarAlertas alertas={b.alertas} />
        <PainelLive live={b.live} podeManuais={canWrite} podeLeads={podeLeads} />
        {b.resumos.length > 0 ? <ResumoSemanalCard resumos={b.resumos} canWrite={canWrite} aiEnabled={aiEnabled} /> : null}
      </div>
    );
  }

  // MODO NORMAL — os quatro blocos de `b.inicio` (nunca `b.data` num client).
  return (
    <InicioNormal
      inicio={b.inicio}
      alertas={b.alertas}
      isSeed={b.data.isSeed}
      rangeKey={b.rangeKey}
      resumos={b.resumos}
      canWrite={canWrite}
      aiEnabled={aiEnabled}
    />
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
  rangeKey,
  resumoCard,
}: {
  data: DashboardData;
  range: DateRange | undefined;
  recs: Recommendation[];
  insights: string[];
  alertas: Alerta[];
  hint: string;
  rangeKey: string;
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
      {data.isSeed ? <ExampleBanner rangeKey={rangeKey} /> : null}

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
            data={pontosDoTotalDeSeguidores(series)}
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
          <RecommendationsCard recs={recs} fallback={insights} rangeKey={rangeKey} />
        </CardContent>
      </Card>
    </div>
  );
}

