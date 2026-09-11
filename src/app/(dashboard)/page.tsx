import { DollarSign, UserPlus, Sparkles, Users, Radio } from "lucide-react";
import Link from "next/link";
import { ExampleBanner } from "@/components/example-banner";
import { KpiCard } from "@/components/kpi/kpi-card";
import { DataQualityCard } from "@/components/kpi/data-quality";
import { GoalBar } from "@/components/kpi/goal-bar";
import { absDelta, pctDelta } from "@/components/kpi/delta";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { ChartCard } from "@/components/ui/chart-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getData, getState } from "@/lib/data/store";
import { aiAnalysisKey } from "@/lib/data/backend";
import { activeBrandSlug } from "@/lib/active-brand";
import { brandDef } from "@/lib/brands";
import { pageRange } from "@/lib/page-range";
import { getCascataFontes, getComercial } from "@/lib/robo/client";
import { montarCascata, resumirCascata } from "@/lib/cascata";
import { contarParados, montarFarol } from "@/lib/farol";
import { FILA_ETAPAS } from "@/lib/fila";
import { FarolCard } from "@/components/kpi/farol-card";
import { Cascata } from "@/components/charts/cascata";
import { resolveMetaBrands } from "@/lib/meta/config";
import { assessTrust } from "@/lib/trust";
import { TrustBand } from "@/components/kpi/trust-band";
import {
  awarenessKpis,
  dataQualityChecks,
  followerSeries,
  goalProgress,
  igAccountTotals,
  overviewKpis,
  previousRange,
  type DataWarning,
  type DateRange,
} from "@/lib/metrics";
import { getLastSync } from "@/lib/meta/sync";
import { buildInsights } from "@/lib/insights";
import { buildRecommendations, type Recommendation } from "@/lib/recommendations";
import type { AiAnalysis, DashboardData } from "@/lib/types";
import { RecommendationsCard } from "@/components/kpi/recommendations";
import { AiAnalysisCard } from "@/components/kpi/ai-analysis";
import { isAiConfigured } from "@/lib/ai/config";
import { periodOf } from "@/lib/ai/briefing";
import { can } from "@/lib/auth/guard";
import { comPeriodo, rangeLabel } from "@/lib/range";
import {
  formatCompact,
  formatCurrency,
  formatCurrency0,
  formatCurrencyOrDash,
  formatInt,
} from "@/lib/format";
import { CHART } from "@/components/charts/colors";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const brand = brandDef(await activeBrandSlug());
  const data = await getData(brand.slug);
  const { range, rangeKey } = pageRange(data, (await searchParams).range);

  // Leitura de IA guardada (Etapa 3). Só é buscada e exibida quando a camada de
  // IA está ligada — sem chave, o card nem existe.
  const aiEnabled = isAiConfigured();
  const analysis = aiEnabled ? await getState<AiAnalysis>(aiAnalysisKey(brand.slug)) : null;
  const canWrite = await can("data:write");
  const aiCard = aiEnabled ? (
    <AiAnalysisCard
      analysis={analysis}
      rangeKey={rangeKey}
      rangeLabel={rangeLabel(rangeKey)}
      currentPeriod={periodOf(range)}
      canWrite={canWrite}
    />
  ) : null;

  const insights = buildInsights(data, range);
  const hint = range ? "vs. período anterior" : "no período";

  const lastSync = await getLastSync();
  const warnings = dataQualityChecks(data, {
    nowIso: new Date().toISOString(),
    lastSyncAds: lastSync.ads,
  });

  // Marca de awareness (krone.capital): visão de crescimento de perfil, não de funil.
  if (brand.type === "awareness") {
    return (
      <AwarenessOverview
        data={data}
        range={range}
        recs={buildRecommendations(data, range, new Date().toISOString())}
        insights={insights}
        warnings={warnings}
        hint={hint}
        aiCard={aiCard}
      />
    );
  }

  const k = overviewKpis(data, range);

  /**
   * O que dá (e o que não dá) para afirmar com estes números.
   *
   * A comparação com o robô só roda no período "campanha inteira": a view do
   * robô é vitalícia e sem marca, então confrontá-la com um recorte de 7 dias
   * acusaria divergência onde só há janelas diferentes.
   */
  const trust = assessTrust({
    data,
    range,
    brandRules: await resolveMetaBrands(),
    kpis: {
      meetings: k.meetings,
      leads: k.leads,
      spendConversao: k.spendConversao,
      spendTotal: k.spend,
    },
    roboReunioes: range ? null : (await getComercial()).kpis?.reunioes_realizadas ?? null,
  });
  // A cascata atravessa quatro sistemas, então precisa das fontes do robô —
  // sem elas ela termina no painel, e o card diz isso em vez de fingir completude.
  const fontesCascata = await getCascataFontes();
  const cascata = montarCascata({
    data,
    range,
    robo: fontesCascata.robo,
    comercial: fontesCascata.comercial,
    investimentoConversao: k.spendConversao,
  });
  const ig = igAccountTotals(data.igAccountDaily, range);

  /*
   * O FAROL e as AÇÕES vêm primeiro, e o resto existe para sustentá-los.
   *
   * Antes esta página abria com seis KPIs do mesmo tamanho e terminava, dez
   * blocos abaixo, no único card que diz o que fazer. Além da ordem invertida,
   * ela repetia: "7 dias sem dados" aparecia cinco vezes, o custo por reunião
   * duas vezes com valores 2,4x diferentes, e "Transferidos: 6" duplicava um
   * degrau da cascata lendo outra view do banco.
   */
  const { parados, midiaParada } = contarParados(cascata.degraus);

  // As juntas com gente parada viram a ação nº 1 — o motor de recomendação não
  // enxergava robô nem fila, então nunca propunha falar com quem já foi pago.
  // Rótulo, prazo e dono vêm de FILA_ETAPAS. A primeira versão tinha um mapa
  // de prazos por degrau aqui mesmo — e mostrou 24h para quem tem 2h.
  const recs = buildRecommendations(data, range, new Date().toISOString(), {
    grupos: cascata.degraus
      .filter((d) => d.parados && d.etapaFila)
      .map((d) => {
        const meta = FILA_ETAPAS[d.etapaFila!];
        return {
          etapa: d.etapaFila!,
          label: meta.label,
          pessoas: d.parados!,
          midiaParada: d.midiaParada ?? 0,
          slaHoras: meta.slaHoras,
          dono: meta.dono,
        };
      }),
  });

  const farol = montarFarol({
    degraus: cascata.degraus,
    trust,
    kpis: { cpr: k.cpr, cpl: k.cpl, leads: k.leads, meetings: k.meetings },
    metaCpr: data.goals.find((g) => g.metric === "cpr")?.target,
    parados,
    midiaParada,
    fontesOk: fontesCascata.falha == null,
  });

  // A faixa "antes de decidir" fica só com o que desqualifica um número.
  // Campo em branco não é ressalva sobre a campanha — vira link no rodapé.
  const travasDeNumero = trust.travas.filter(
    (t) => t.nivel === "quarentena" || t.nivel === "teto",
  );
  const pendencias = trust.travas.filter((t) => t.nivel === "config");
  const temPiso = trust.travas.some((t) => t.nivel === "piso");

  return (
    <div className="space-y-6">
      {data.isSeed ? <ExampleBanner /> : null}

      <FarolCard farol={farol} rangeKey={rangeKey} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            O que fazer esta semana
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Teto de 3 na home: seis ações do mesmo tamanho voltariam a ser
              empate. O resto fica recolhido — não some, só não disputa. */}
          <RecommendationsCard recs={recs.slice(0, 3)} fallback={insights} />
          {recs.length > 3 ? (
            <details>
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                +{recs.length - 3} {recs.length - 3 === 1 ? "otimização" : "otimizações"} de mídia e
                conteúdo
              </summary>
              <div className="pt-3">
                <RecommendationsCard recs={recs.slice(3)} />
              </div>
            </details>
          ) : null}
        </CardContent>
      </Card>

      {/* Placar, não bússola: três números numa tira, sem card por número. */}
      <Card>
        <CardContent className="space-y-2 p-5">
          <div className="flex flex-wrap gap-x-10 gap-y-3">
            <div>
              <p className="text-xs text-muted-foreground">Investimento</p>
              <p className="tabular text-xl font-semibold">
                {temPiso ? <span className="text-muted-foreground">≥ </span> : null}
                {formatCurrency0(k.spend)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Leads</p>
              <p className="tabular text-xl font-semibold">
                {formatInt(k.leads)}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {k.leads > 0 ? `a ${temPiso ? "≥ " : ""}${formatCurrency(k.cpl)}` : ""}
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Reuniões</p>
              <p className="tabular text-xl font-semibold">
                {formatInt(k.meetings)}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {trust.porMetrica.cpr
                    ? trust.porMetrica.cpr.motivo.toLowerCase()
                    : `a ${formatCurrency(k.cpr)}`}
                </span>
              </p>
            </div>
          </div>

          {temPiso ? (
            <p className="text-xs text-muted-foreground">
              Os valores com ≥ são piso — faltam dias de gasto no período.{" "}
              <Link href="/config#integracoes" className="text-primary underline-offset-4 hover:underline">
                Sincronizar
              </Link>
            </p>
          ) : null}
          {k.hasDiscovery ? (
            <p className="text-xs text-muted-foreground">
              CPL e custo por reunião usam só os {formatCurrency0(k.spendConversao)} de conversão,
              de {formatCurrency0(k.spend)} no total.{" "}
              <Link
                href={comPeriodo("/dinheiro", rangeKey)}
                className="text-primary underline-offset-4 hover:underline"
              >
                ver o split
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>

      <ChartCard
        title="Onde o dinheiro para"
        description="Os degraus onde há gente parada, e o fim do funil."
        action={
          <Link
            href={comPeriodo("/jornada", rangeKey)}
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Cascata completa →
          </Link>
        }
      >
        <Cascata degraus={resumirCascata(cascata.degraus)} />
      </ChartCard>

      <TrustBand travas={travasDeNumero} rangeKey={rangeKey} />

      {aiCard}

      <p className="flex flex-wrap gap-x-5 gap-y-1 border-t pt-4 text-xs text-muted-foreground">
        <Link href={comPeriodo("/conteudo", rangeKey)} className="hover:text-foreground">
          Orgânico: {formatCompact(ig.reach)} de alcance, +{formatInt(ig.followersEnd - ig.followersStart)} seguidores →
        </Link>
        <Link href={comPeriodo("/dinheiro", rangeKey)} className="hover:text-foreground">
          Verba por conjunto e por criativo →
        </Link>
        {pendencias.length > 0 ? (
          <Link href="/config#pendencias" className="hover:text-foreground">
            {pendencias.length}{" "}
            {pendencias.length === 1 ? "configuração pendente" : "configurações pendentes"}:{" "}
            {pendencias.map((p) => p.titulo.toLowerCase()).join(", ")} →
          </Link>
        ) : null}
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
  warnings,
  hint,
  aiCard,
}: {
  data: DashboardData;
  range: DateRange | undefined;
  recs: Recommendation[];
  insights: string[];
  warnings: DataWarning[];
  hint: string;
  aiCard: React.ReactNode;
}) {
  const a = awarenessKpis(data, range);
  const prevA = range ? awarenessKpis(data, previousRange(range)) : undefined;
  const series = followerSeries(data.igAccountDaily, range);
  const followersGoal = data.goals.find((g) => g.metric === "followers");
  const gp = followersGoal ? goalProgress(followersGoal, a.followersEnd) : undefined;

  return (
    <div className="space-y-6">
      {data.isSeed ? <ExampleBanner /> : null}
      <DataQualityCard warnings={warnings} />

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
          hint="North Star"
          highlight
        />
        <KpiCard
          label="Custo / 1k alcance"
          value={formatCurrencyOrDash(a.costPerReach)}
          Icon={Radio}
          hint="alcance da conta"
        />
      </div>

      {aiCard}

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
