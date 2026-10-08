import { DollarSign, UserPlus, Sparkles, Users, Radio } from "lucide-react";
import Link from "next/link";
import { ExampleBanner } from "@/components/example-banner";
import { KpiCard } from "@/components/kpi/kpi-card";
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
import { maiorVazamento, montarCascata, resumirCascata } from "@/lib/cascata";
import { contarParados, montarFarol } from "@/lib/farol";
import { FILA_ETAPAS } from "@/lib/fila";
import { FarolCard } from "@/components/kpi/farol-card";
import { Cascata } from "@/components/charts/cascata";
import { resolveMetaBrands } from "@/lib/meta/config";
import { MIN_REUNIOES } from "@/lib/trust";
import {
  awarenessKpis,
  dataQualityChecks,
  followerSeries,
  goalProgress,
  igAccountTotals,
  previousRange,
  type DateRange,
} from "@/lib/metrics";
import { custoExibivel, kpisDoPeriodo, mostrar, reguaDoPeriodo } from "@/lib/kpis";
import { formatarAlvo, metaVigente } from "@/lib/metas";
import { hojeEmBrasilia } from "@/lib/range";
import { StatusMetaBadge, type MetaExibida } from "@/components/kpi/status-meta";
import type { MetricaComMeta } from "@/lib/types";
import { dica } from "@/lib/dicionario";
import { coberturaDeAnuncios } from "@/lib/sincronizacao";
import {
  alertasDeAtribuicao,
  alertasDeConfianca,
  alertasDeQualidade,
  type Alerta,
} from "@/lib/alertas";
import { RegistrarAlertas } from "@/components/layout/alertas";
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
  formatCurrency0,
  formatCurrencyOrDash,
  formatInt,
  formatIntComSinal,
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

  // Saúde do dado: antes calculada nas duas homes e exibida só na da Krone (S12).
  const alertasDeDado = alertasDeQualidade(dataQualityChecks(data));

  // Marca de awareness (krone.capital): visão de crescimento de perfil, não de funil.
  if (brand.type === "awareness") {
    return (
      <AwarenessOverview
        data={data}
        range={range}
        recs={buildRecommendations(data, range, new Date().toISOString())}
        insights={insights}
        alertas={alertasDeDado}
        hint={hint}
        aiCard={aiCard}
      />
    );
  }

  /**
   * Os números do período, com o que dá (e o que não dá) para afirmar com eles.
   * É a MESMA conta da Jornada, do Dinheiro, do motor de ações e da IA.
   *
   * A comparação com o robô só roda no período "campanha inteira": a view do
   * robô é vitalícia e sem marca, então confrontá-la com um recorte de 7 dias
   * acusaria divergência onde só há janelas diferentes.
   */
  const kp = kpisDoPeriodo(data, range, {
    brandRules: await resolveMetaBrands(),
    cobertura: await coberturaDeAnuncios(brand.slug),
    roboReunioes: range ? null : (await getComercial()).kpis?.reunioes_realizadas ?? null,
  });
  const trust = kp.trust;
  // A cascata atravessa quatro sistemas, então precisa das fontes do robô —
  // sem elas ela termina no painel, e o card diz isso em vez de fingir completude.
  const fontesCascata = await getCascataFontes();
  const cascata = montarCascata({
    data,
    range,
    robo: fontesCascata.robo,
    comercial: fontesCascata.comercial,
    kpis: kp,
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
  const { parados, midiaParada, filaHref } = contarParados(cascata.degraus);

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
    kpis: kp,
    metaCpr: metaVigente(data.metas, "custo_por_reuniao", hojeEmBrasilia())?.alvo ?? undefined,
    parados,
    midiaParada,
    filaHref,
    // Robô DESLIGADO (sem credencial) é ausência, não falha: a cascata cai no
    // funil do painel e o farol segue. Só a leitura que QUEBROU vira "não sei".
    fontesOk: fontesCascata.falha?.tipo !== "erro",
  });

  // Ressalvas, pendências e saúde do dado moram no "⚠ alertas" do cabeçalho —
  // não numa faixa no meio da página (3.6). O que desqualifica um número fica
  // TAMBÉM colado nele ("—", "≥", "≤").
  const alertas: Alerta[] = [
    ...alertasDeConfianca(trust.travas),
    ...alertasDeDado,
    ...alertasDeAtribuicao(data, range),
    ...(fontesCascata.falha?.tipo === "erro"
      ? [
          {
            id: "robo-leitura",
            nivel: "falha" as const,
            titulo: "Não consegui ler o robô nem o atendimento",
            detalhe:
              "Sem eles, o fundo do funil fica invisível — e ausência de leitura não é o mesmo que ninguém esperando. A cascata termina no painel até a leitura voltar.",
            cta: { label: "Ver integrações", href: "/config#integracoes" },
          },
        ]
      : []),
  ];
  const temPiso = kp.investimento.confianca?.nivel === "piso";
  const nConv = kp.reunioesConversao.valor;

  // A régua (Fase 4): cada número contra a meta que vale no período.
  const regua = new Map(reguaDoPeriodo(kp, data, range).map((l) => [l.metrica, l]));
  const metaDe = (m: MetricaComMeta, rotulo: string): MetaExibida | undefined => {
    const l = regua.get(m);
    if (!l || l.alvo == null) return undefined;
    return { alvoTexto: `${rotulo} ${formatarAlvo(m, l.alvo)}`, avaliacao: l.avaliacao, provisoria: l.meta?.provisoria };
  };
  const metasDaTira = {
    orcamento: metaDe("investimento_conversao", "conversão prevista"),
    leads: metaDe("leads", "meta"),
    cpl: metaDe("cpl", "CPL alvo"),
    reunioes: metaDe("reunioes_agendadas", "meta"),
    cpr: metaDe("custo_por_reuniao", "custo alvo"),
  };

  return (
    <div className="space-y-6">
      <RegistrarAlertas alertas={alertas} />
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
          {/* Cada número com a definição do dicionário no ⓘ (title): "Reuniões
              agendadas" aqui é a mesma da Jornada, do Dinheiro e da IA. */}
          <div className="flex flex-wrap gap-x-10 gap-y-3">
            <div title={dica("investimento")}>
              <p className="text-xs text-muted-foreground">Investimento</p>
              <p className="tabular text-xl font-semibold">{mostrar(kp.investimento, "moeda0")}</p>
              {metasDaTira.orcamento ? <StatusMetaBadge meta={metasDaTira.orcamento} /> : null}
            </div>
            <div title={dica("cpl")}>
              <p className="text-xs text-muted-foreground">Leads</p>
              <p className="tabular text-xl font-semibold">
                {formatInt(kp.leads.valor)}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {/* O CPL divide pelos leads da campanha de conversão — sem dizer
                      isso, "113 leads a R$ 29,70" parecia uma conta que não fecha. */}
                  {custoExibivel(kp.cpl)
                    ? `a ${mostrar(kp.cpl, "moeda")}` +
                      (kp.leadsConversao.valor !== kp.leads.valor
                        ? ` (CPL sobre ${formatInt(kp.leadsConversao.valor)} de conversão)`
                        : "")
                    : ""}
                </span>
              </p>
              <div className="flex flex-col">
                {metasDaTira.leads ? <StatusMetaBadge meta={metasDaTira.leads} /> : null}
                {metasDaTira.cpl ? <StatusMetaBadge meta={metasDaTira.cpl} /> : null}
              </div>
            </div>
            <div title={dica("reunioes_agendadas")}>
              <p className="text-xs text-muted-foreground">Reuniões agendadas</p>
              <p className="tabular text-xl font-semibold">
                {formatInt(kp.reunioesAgendadas.valor)}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {/* Abaixo da régua o custo por reunião não aparece: no lugar dele,
                      o FATO (quantas são de conversão), não a razão. */}
                  {custoExibivel(kp.custoPorReuniao)
                    ? `a ${mostrar(kp.custoPorReuniao, "moeda")}` +
                      (nConv !== kp.reunioesAgendadas.valor ? ` (sobre ${formatInt(nConv)} de conversão)` : "")
                    : kp.custoPorReuniao.confianca?.nivel === "quarentena" &&
                        !kp.custoPorReuniao.confianca.motivo.startsWith("Só ")
                      ? kp.custoPorReuniao.confianca.motivo.toLowerCase()
                      : `${formatInt(nConv)} de conversão — o custo por reunião aparece a partir de ${MIN_REUNIOES}`}
                </span>
              </p>
              <div className="flex flex-col">
                {metasDaTira.reunioes ? <StatusMetaBadge meta={metasDaTira.reunioes} /> : null}
                {metasDaTira.cpr ? <StatusMetaBadge meta={metasDaTira.cpr} /> : null}
              </div>
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
          {kp.temDescoberta ? (
            <p className="text-xs text-muted-foreground">
              CPL e custo por reunião usam só os {formatCurrency0(kp.investimentoConversao.valor)} de
              conversão, de {formatCurrency0(kp.investimento.valor)} no total.{" "}
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
        description="Do lead ao negócio: onde há gente parada e onde mais se perde."
        action={
          <Link
            href={comPeriodo("/jornada", rangeKey)}
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Cascata completa →
          </Link>
        }
      >
        <Cascata
          degraus={resumirCascata(cascata.degraus)}
          vazamentoKey={maiorVazamento(cascata.degraus)?.degrau.key}
          tomVazamento="alerta"
        />
      </ChartCard>

      {aiCard}

      <p className="flex flex-wrap gap-x-5 gap-y-1 border-t pt-4 text-xs text-muted-foreground">
        <Link href={comPeriodo("/conteudo", rangeKey)} className="hover:text-foreground">
          {/* O alcance da conta INCLUI anúncios (Meta) — não é orgânico (B11). */}
          Instagram: {formatCompact(ig.reach)} de alcance da conta (pago + orgânico),{" "}
          {formatIntComSinal(ig.followersEnd - ig.followersStart)} seguidores →
        </Link>
        <Link href={comPeriodo("/dinheiro", rangeKey)} className="hover:text-foreground">
          Verba por conjunto e por criativo →
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
  aiCard,
}: {
  data: DashboardData;
  range: DateRange | undefined;
  recs: Recommendation[];
  insights: string[];
  alertas: Alerta[];
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
