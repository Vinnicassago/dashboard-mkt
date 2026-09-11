import Link from "next/link";
import { AlertTriangle, Award, Radio, TrendingUp, UserPlus } from "lucide-react";
import { ObjectiveSplitBar } from "@/components/kpi/objective-split";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { CreativesTable } from "@/components/tables/creatives-table";
import { ChartCard } from "@/components/ui/chart-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CHART } from "@/components/charts/colors";
import { getData } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { pageRange } from "@/lib/page-range";
import {
  adKpis,
  adsetPerformance,
  campaignPacing,
  creativePerformance,
  dailySeries,
  filterAds,
  objectiveBreakdown,
  OBJECTIVE_LABEL,
} from "@/lib/metrics";
import {
  formatCurrency,
  formatCurrency0,
  formatCurrencyOrDash,
  formatDecimal,
  formatInt,
  formatPercent,
} from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Dinheiro — quanto por conjunto na segunda, e qual criativo escalo ou mato.
 *
 * Funde as antigas Tráfego Pago e Criativos. As duas abriam com fileiras de KPIs
 * do mesmo tamanho (investimento, impressões, cliques, CTR, CPL) que repetiam a
 * home e empurravam para baixo as duas tabelas que de fato decidem a verba.
 * Agora a página começa por elas; os números de entrega da Meta viram uma linha
 * no card de orçamento.
 */

/** Uma linha rótulo → valor dentro das colunas por objetivo. */
function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("tabular text-sm font-medium", highlight && "text-primary")}>
        {value}
      </span>
    </div>
  );
}

const BUCKET_DOT: Record<"conversao" | "descoberta", string> = {
  conversao: CHART.series[0],
  descoberta: CHART.series[1],
};

/*
 * Amostra mínima para eleger destaque. Sem ela, 1 lead a R$ 10 "vence" 40 a
 * R$ 35, e um criativo com R$ 0,10 de gasto e 7 impressões vence o CTR com
 * 14,8% — razão com denominador minúsculo é ruído, não desempenho.
 */
const MIN_LEADS = 5;
const MIN_IMPRESSOES = 1000;

export default async function DinheiroPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const data = await getData(await activeBrandSlug());
  const { range } = pageRange(data, (await searchParams).range);

  const k = adKpis(filterAds(data.adDaily, range));
  const series = dailySeries(data, range);
  const byAdset = adsetPerformance(data, range);
  const obj = objectiveBreakdown(data, range);
  const perf = creativePerformance(data, range);

  // Metas para pintar de vermelho quem passou do teto.
  const goalCpl = data.goals.find((g) => g.metric === "cpl")?.target;
  const goalCpr = data.goals.find((g) => g.metric === "cpr")?.target;
  const overCls = (over: boolean) => (over ? "text-[var(--danger-text)] font-medium" : "");

  const spentAllTime = data.adDaily.reduce((s, r) => s + r.spend, 0);
  const budget = data.campaign.budgetTotal;
  const pacing = budget > 0 ? Math.min(1, spentAllTime / budget) : 0;
  const pace = campaignPacing(data, new Date().toISOString());

  // Destaques de criativo — só entre quem tem volume para a razão significar algo.
  const withLeads = perf.filter((c) => c.leads > 0);
  const enough = withLeads.filter((c) => c.leads >= MIN_LEADS);
  const bestCpl = [...(enough.length ? enough : withLeads)].sort((a, b) => a.cpl - b.cpl)[0];
  const bestCplLowSample = bestCpl != null && bestCpl.leads < MIN_LEADS;
  const gastoPeriodo = perf.reduce((s, c) => s + c.spend, 0);
  const comVolume = perf.filter(
    (c) => c.impressions >= MIN_IMPRESSOES || (gastoPeriodo > 0 && c.spend >= gastoPeriodo * 0.01),
  );
  const bestCtr = [...comVolume].sort((a, b) => b.ctr - a.ctr)[0];
  const ctrDescartados = perf.length - comVolume.length;
  const fatigued = perf.filter((c) => c.fatigue.level === "fadigado");

  return (
    <div className="space-y-6">
      {/* 1. A decisão de verba: por conjunto */}
      <Card>
        <CardHeader>
          <CardTitle>Por conjunto de anúncios</CardTitle>
          <CardDescription>
            Onde a verba vira reunião. Custo por lead e por reunião só nos conjuntos de
            conversão — descoberta não gera lead, então fica com &ldquo;—&rdquo;.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Conjunto</TH>
                <TH>Objetivo</TH>
                <TH className="text-right">Gasto</TH>
                <TH className="text-right">CTR</TH>
                <TH className="text-right">Leads</TH>
                <TH className="text-right">CPL</TH>
                <TH className="text-right">Reuniões</TH>
                <TH className="text-right">CPR</TH>
              </TR>
            </THead>
            <TBody>
              {byAdset.map((g) => {
                const isConv = g.bucket === "conversao";
                const cplOver = isConv && goalCpl != null && g.leads > 0 && g.cpl > goalCpl;
                const cprOver = isConv && goalCpr != null && g.meetings > 0 && g.cpr > goalCpr;
                return (
                  <TR key={g.adset}>
                    <TD className="font-medium">{g.adset}</TD>
                    <TD>
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: BUCKET_DOT[g.bucket] }}
                        />
                        {OBJECTIVE_LABEL[g.bucket]}
                      </span>
                    </TD>
                    <TD className="text-right tabular">{formatCurrency0(g.spend)}</TD>
                    <TD className="text-right tabular">{formatPercent(g.ctr)}</TD>
                    <TD className="text-right tabular">{formatInt(g.leads)}</TD>
                    <TD className={`text-right tabular ${overCls(cplOver)}`}>
                      {isConv && g.leads > 0 ? formatCurrency(g.cpl) : "—"}
                    </TD>
                    <TD className="text-right tabular">{isConv ? formatInt(g.meetings) : "—"}</TD>
                    <TD className={`text-right tabular ${overCls(cprOver)}`}>
                      {isConv && g.meetings > 0 ? formatCurrency(g.cpr) : "—"}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          {goalCpl != null || goalCpr != null ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Em <span className="text-[var(--danger-text)]">vermelho</span>: acima da meta
              {goalCpl != null ? ` de CPL (${formatCurrency0(goalCpl)})` : ""}
              {goalCpl != null && goalCpr != null ? " ou" : ""}
              {goalCpr != null ? ` de CPR (${formatCurrency0(goalCpr)})` : ""}.
            </p>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Sem meta de CPL e de custo por reunião, nada aqui fica vermelho.{" "}
              <Link href="/config#metas" className="text-primary underline-offset-4 hover:underline">
                Cadastrar metas
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      {/* 2. Criativos: escalar ou pausar */}
      <section id="criativos" className="scroll-mt-24 space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Criativos: o que escalar e o que pausar</h2>
          <p className="text-sm text-muted-foreground">
            Escale o que traz reunião barata, pause o que só gasta. A tabela ordena por
            qualquer coluna.
          </p>
        </div>

        {perf.length === 0 ? (
          <EmptyState
            title="Sem dados de criativos no período"
            hint="Sincronize ou importe o relatório de anúncios em Ajustes para comparar os criativos."
          />
        ) : (
          <>
            {fatigued.length > 0 ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-[var(--danger-text)]/30 bg-[var(--danger-text)]/[0.04] px-4 py-3 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--danger-text)]" />
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {fatigued.length === 1
                      ? "1 criativo fadigando:"
                      : `${fatigued.length} criativos fadigando:`}
                  </span>{" "}
                  {fatigued.map((c) => c.name).join(", ")}. Renove a arte antes que o custo
                  dispare — a fadiga infla o CPL e, na cascata, o custo por reunião.
                </p>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              {bestCpl ? (
                <Card>
                  <CardContent className="flex items-center gap-4 p-5">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-[var(--good)]/12 text-[var(--success-text)]">
                      <Award className="size-5" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Melhor CPL</p>
                      <p className="font-semibold">{bestCpl.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatCurrency(bestCpl.cpl)} por lead · {formatInt(bestCpl.leads)}{" "}
                        {bestCpl.leads === 1 ? "lead" : "leads"} · {formatInt(bestCpl.meetings)}{" "}
                        {bestCpl.meetings === 1 ? "reunião" : "reuniões"}
                      </p>
                      {bestCplLowSample ? (
                        <p className="mt-0.5 text-xs text-[var(--danger-text)]">
                          Amostra pequena ({formatInt(bestCpl.leads)}{" "}
                          {bestCpl.leads === 1 ? "lead" : "leads"}) — confirme antes de escalar.
                        </p>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ) : null}
              {bestCtr ? (
                <Card>
                  <CardContent className="flex items-center gap-4 p-5">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <TrendingUp className="size-5" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Maior CTR</p>
                      <p className="font-semibold">{bestCtr.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatPercent(bestCtr.ctr)} de cliques · {formatInt(bestCtr.impressions)}{" "}
                        impressões
                      </p>
                      {ctrDescartados > 0 ? (
                        <p className="pt-0.5 text-xs text-muted-foreground">
                          {ctrDescartados === 1
                            ? "1 criativo fora do ranking por volume baixo."
                            : `${ctrDescartados} criativos fora do ranking por volume baixo.`}
                        </p>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Todos os criativos</CardTitle>
              </CardHeader>
              <CardContent>
                <CreativesTable rows={perf} />
              </CardContent>
            </Card>
          </>
        )}
      </section>

      {/* 3. Orçamento: ritmo e divisão por objetivo */}
      <Card>
        <CardHeader>
          <CardTitle>Orçamento da campanha</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="tabular text-2xl font-semibold">{formatCurrency0(spentAllTime)}</span>
            {/*
              Orçamento zero não é "consumi 0%" — é campo em branco. Mostrar
              "de R$ 0 · 0% consumido" com a barra vazia dava a entender que o
              painel mediu alguma coisa.
            */}
            {budget > 0 ? (
              <span className="text-muted-foreground">
                de {formatCurrency0(budget)} · {formatPercent(pacing, 0)} consumido
              </span>
            ) : (
              <Link
                href="/config#orcamento"
                className="text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                Cadastrar o orçamento para ver o ritmo →
              </Link>
            )}
          </div>
          {budget > 0 ? (
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-foreground/[0.07]">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${pacing * 100}%` }}
              />
            </div>
          ) : null}
          {pace.status !== "unknown" && pace.projectedSpend != null ? (
            <p
              className={
                pace.status === "over"
                  ? "text-xs font-medium text-[var(--danger-text)]"
                  : "text-xs text-muted-foreground"
              }
            >
              No ritmo atual: gasto projetado {formatCurrency0(pace.projectedSpend)} até o fim —{" "}
              {pace.status === "over"
                ? "acima do orçamento, reduza o budget diário."
                : pace.status === "sub"
                  ? "abaixo do orçamento, há espaço para escalar."
                  : "em linha com o orçamento."}
            </p>
          ) : pace.exhaustInDays != null ? (
            <p className="text-xs text-muted-foreground">
              No ritmo atual, o orçamento dura ~{pace.exhaustInDays} dias.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">No período</span>
            <span>{formatInt(k.impressions)} impressões</span>
            <span>{formatInt(k.reach)} de alcance</span>
            <span>CTR {formatPercent(k.ctr)}</span>
            <span>CPM {formatCurrency(k.cpm)}</span>
            <span>CPC {formatCurrency(k.cpc)}</span>
            <span>Frequência {formatDecimal(k.frequency, 2)}</span>
            {(data.campaign.dailyBudget ?? 0) > 0 ? (
              <span>Budget diário {formatCurrency0(data.campaign.dailyBudget!)}</span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Orçamento por objetivo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <ObjectiveSplitBar
            conversao={obj.conversao.spend}
            descoberta={obj.descoberta.spend}
          />

          {obj.organicLeads > 0 ? (
            <p className="text-xs text-muted-foreground">
              + {formatInt(obj.organicLeads)}{" "}
              {obj.organicLeads === 1 ? "lead orgânico ou direto" : "leads orgânicos ou diretos"}{" "}
              — sem custo pago, fora do CPL e do custo por reunião.
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <UserPlus className="size-4 text-primary" />
                <p className="font-medium">Conversão — geração de leads</p>
              </div>
              <Stat label="Investimento" value={formatCurrency0(obj.conversao.spend)} />
              <Stat label="Leads" value={formatInt(obj.conversao.leads)} />
              {/* Sem denominador o custo é DESCONHECIDO, não zero — e "R$ 0,00"
                  ao lado de "Reuniões 0" lê-se como custo excelente. */}
              <Stat
                label="CPL"
                value={obj.conversao.leads > 0 ? formatCurrency(obj.conversao.cpl) : "—"}
                highlight
              />
              <Stat label="Reuniões" value={formatInt(obj.conversao.meetings)} />
              <Stat
                label="Custo por reunião"
                value={obj.conversao.meetings > 0 ? formatCurrency(obj.conversao.cpr) : "—"}
                highlight
              />
            </div>

            <div className="space-y-2 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <Radio className="size-4 text-muted-foreground" />
                <p className="font-medium">Descoberta — alcance &amp; seguidores</p>
              </div>
              {obj.hasDiscovery ? (
                <>
                  <Stat label="Investimento" value={formatCurrency0(obj.descoberta.spend)} />
                  <Stat label="Alcance" value={formatInt(obj.descoberta.reach)} />
                  <Stat label="CPM" value={formatCurrency(obj.descoberta.cpm)} />
                  <Stat
                    label="Custo / mil alcançados"
                    value={formatCurrency(obj.descoberta.costPerReach)}
                  />
                  <Stat
                    label="Seguidores no período"
                    value={`+${formatInt(obj.netNewFollowers)}`}
                  />
                  <Stat
                    label="Custo / seguidor (est.)"
                    value={formatCurrencyOrDash(obj.costPerFollowerEst)}
                    highlight
                  />
                  <p className="pt-1 text-xs text-muted-foreground">
                    Estimativa: seguidores são da conta (orgânico + pago); a Meta não atribui
                    seguidores por anúncio.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum anúncio de descoberta no período. Todo o orçamento foi para conversão.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <ChartCard title="Investimento por dia" description="Pacing diário de gasto.">
        <TimeSeriesChart
          data={series}
          series={[{ key: "spend", label: "Investimento", color: CHART.series[0] }]}
          yFormat="currency0"
          valueFormat="currency"
        />
      </ChartCard>
    </div>
  );
}
