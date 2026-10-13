import Link from "next/link";
import {
  ChevronDown,
  DollarSign,
  ExternalLink,
  Eye,
  Heart,
  Info,
  Leaf,
  MessageCircle,
  Percent,
  Radio,
  Sparkles,
  TrendingUp,
  UserRound,
  Users,
} from "lucide-react";
import { KpiCard, type KpiDelta } from "@/components/kpi/kpi-card";
import { KpiComDica } from "@/components/conteudo/kpi-com-dica";
import { VariacoesCard, type VariacaoExibida } from "@/components/conteudo/variacoes-card";
import { GoalBar } from "@/components/kpi/goal-bar";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { FunnelChart } from "@/components/charts/funnel-chart";
import { ChartCard } from "@/components/ui/chart-card";
import { HorizontalBars } from "@/components/charts/horizontal-bars";
import { EmptyState } from "@/components/ui/empty-state";
import { CHART } from "@/components/charts/colors";
import { getData } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { brandDef } from "@/lib/brands";
import { can } from "@/lib/auth/guard";
import { pageRange } from "@/lib/page-range";
import { comPeriodo, hojeEmBrasilia } from "@/lib/range";
import { kpisDoPeriodo, mostrar } from "@/lib/kpis";
import { dica } from "@/lib/dicionario";
import {
  SEM_META,
  alcanceOrganicoDosPosts,
  dicaConteudo,
  funilDoPerfil,
  metaDeConversasDm,
  metaDeSeguidores,
  resumoSeguidores,
  variacoesDeAnuncio,
} from "@/lib/conteudo";
import {
  awarenessKpis,
  buildProfileClickFunnel,
  followerSeries,
  goalProgress,
  igAccountTotals,
  igEngagementSeries,
  inRange,
  previousRange,
  weeklyDmSeries,
} from "@/lib/metrics";
import { pctDelta } from "@/components/kpi/delta";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RecommendationsCard } from "@/components/kpi/recommendations";
import { buildRecommendations } from "@/lib/recommendations";
import {
  formatCompact,
  formatCurrency0,
  formatCurrencyOrDash,
  formatDateShort,
  formatDecimal,
  formatInt,
  formatIntComSinal,
  formatPercent,
} from "@/lib/format";

/** Δ absoluto com o sinal de `formatIntComSinal` — nunca "+-12" (S14). */
function deltaDeContagem(valor: number, sufixo: string): KpiDelta {
  return {
    text: `${formatIntComSinal(valor)} ${sufixo}`,
    direction: valor > 0 ? "up" : valor < 0 ? "down" : "flat",
    intent: valor > 0 ? "good" : valor < 0 ? "bad" : "neutral",
  };
}

const TIPO_LABEL: Record<string, string> = {
  feed: "Feed",
  carrossel: "Carrossel",
  reel: "Reel",
  story: "Story",
};

const horaEmBrasilia = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

const SEM_IG = "sem dados do Instagram no período";

/**
 * Conteúdo → Conta: "O conteúdo está melhorando, e alimenta o funil?"
 *
 * O primeiro bloco responde a pergunta — o que o orgânico entregou ao funil —
 * em 4 cards. O resto (alcance, views, funis, séries) fica em "Mais métricas",
 * recolhido. Alcance da conta (pago + orgânico) e alcance orgânico dos posts
 * são dois números de propósito (B11). Nenhum sinal sai de um "+" fixo (S14).
 */
export default async function ConteudoPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const brand = brandDef(await activeBrandSlug());
  const data = await getData(brand.slug);
  const { range, rangeKey } = pageRange(data, (await searchParams).range);
  const podeEditar = await can("data:write");
  const registrosHref = comPeriodo("/conteudo/registros", rangeKey);

  const rows = data.igAccountDaily.filter((r) => inRange(r.date, range));
  const temIg = rows.length > 0;
  const cur = igAccountTotals(data.igAccountDaily, range);
  const prev = range ? igAccountTotals(data.igAccountDaily, previousRange(range)) : undefined;
  // Marca de awareness (krone): eficiência do investimento pago em seguidores.
  const aware = brand.type === "awareness" ? awarenessKpis(data, range) : null;

  // Leads orgânicos: o MESMO número de todas as telas (ADR-03), com o anterior.
  const k = kpisDoPeriodo(data, range, { hoje: hojeEmBrasilia(), comparar: true });
  const lo = k.leadsOrganicos;
  const deltaLeadsOrganicos =
    lo.anterior !== undefined ? deltaDeContagem(lo.valor - lo.anterior, "vs. anterior") : undefined;

  const seg = resumoSeguidores(data.igAccountDaily, range);
  const organico = alcanceOrganicoDosPosts(data.igPosts, range, data.creatives);
  const organicoPrev = range
    ? alcanceOrganicoDosPosts(data.igPosts, previousRange(range), data.creatives)
    : undefined;
  const foraDoOrganico = [
    organico.testes > 0 ? `${formatInt(organico.testes)} teste(s)` : null,
    organico.impulsionados > 0 ? `${formatInt(organico.impulsionados)} impulsionado(s)` : null,
  ]
    .filter(Boolean)
    .join(" e ");

  // O que falta registrar para os cards acima terem número — tudo o que falta, não só o 1º.
  const faltasDeRegistro = !temIg
    ? [
        "Sem snapshot do Instagram no período — a sincronização ainda não cobriu estes dias ou o registro manual falta.",
      ]
    : [
        seg.temTotal ? null : "O total de seguidores não veio nos snapshots do período (campo em branco).",
        cur.hasDmData ? null : "Conversas de DM sem registro no período.",
      ].filter((t): t is string => t !== null);

  // Variações de anúncio: a sugestão; quem confirma é uma pessoa (card abaixo).
  const variacoes: VariacaoExibida[] = variacoesDeAnuncio(data.igPosts, range).map((g) => ({
    dia: g.dia,
    diaLabel: formatDateShort(g.dia),
    legenda: g.legenda,
    pendentes: g.pendentes,
    posts: g.posts.map((p) => ({
      id: p.id,
      tipo: TIPO_LABEL[p.type] ?? p.type,
      hora: horaEmBrasilia(p.publishedAt),
      isTest: p.isTest,
    })),
  }));

  // As ações de conteúdo (cadência, formato, CTA, grade) moram AQUI desde a
  // Bússola (Fase 5): a home de conversão só lista o motor v2, que é o funil
  // pago. A marca de seguidores já as mostra na home dela — um fato, um lugar.
  const acoesDeConteudo =
    brand.type === "awareness" ? [] : buildRecommendations(data, range, new Date().toISOString());

  // Funil do perfil: alcance da CONTA (pago + orgânico) — o rótulo diz (B11).
  const perfilFunnel = funilDoPerfil(data.igAccountDaily, range);
  const clickFunnel = buildProfileClickFunnel(data.igAccountDaily, range);
  const engagementDaily = igEngagementSeries(data.igAccountDaily, range);
  const dmWeeks = weeklyDmSeries(data.igAccountDaily, range);
  const series = followerSeries(data.igAccountDaily, range);

  // Meta de seguidores: progresso + projeção linear pelo ritmo do período. O
  // total é o último CONHECIDO (`seg.fim`: 0 = snapshot sem o campo) e o ritmo
  // é o líquido alinhado aos dias do período — o mesmo número do card.
  const followersGoal = data.goals.find((g) => g.metric === "followers");
  const gp = followersGoal && seg.temTotal ? goalProgress(followersGoal, seg.fim) : undefined;
  const windowDays = rows.length;
  const avgGain = windowDays > 0 ? seg.liquido / windowDays : 0;
  const remaining = followersGoal ? Math.max(0, followersGoal.target - seg.fim) : 0;
  const daysAtRate = avgGain > 0 ? Math.ceil(remaining / avgGain) : null;
  const goalOutlook = !followersGoal
    ? ""
    : gp?.onTrack
      ? "Meta batida 🎉"
      : avgGain > 0 && daysAtRate != null
        ? `Faltam ${formatInt(remaining)} · no ritmo de +${formatDecimal(avgGain, 1)}/dia, ~${daysAtRate} dias.`
        : `Faltam ${formatInt(remaining)} · sem crescimento no período para projetar.`;

  return (
    <div className="space-y-6">
      {/* ---- 1. Contribuição para o funil: a resposta da tela ---- */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Contribuição para o funil</h2>
          <p className="text-sm text-muted-foreground">
            O que o orgânico entregou no período: leads sem mídia paga, cliques na bio, conversas
            e base.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {aware ? (
            <KpiCard
              label="Custo por seguidor"
              value={formatCurrencyOrDash(aware.costPerFollower)}
              Icon={Sparkles}
              hint={aware.spend > 0 ? "North Star" : "sem verba atribuída à marca"}
              highlight
            />
          ) : (
            <KpiComDica
              dica={dica("leads_organicos")}
              label="Leads orgânicos"
              value={mostrar(lo, "int")}
              Icon={Leaf}
              delta={deltaLeadsOrganicos}
              hint="sem anúncio pago identificado"
              meta={SEM_META}
              highlight
            />
          )}
          <KpiComDica
            dica={dicaConteudo("cliques_link_bio")}
            label="Cliques no link da bio"
            value={temIg ? formatInt(cur.profileLinkTaps) : "—"}
            Icon={ExternalLink}
            delta={temIg && prev ? pctDelta(cur.profileLinkTaps, prev.profileLinkTaps) : undefined}
            hint={
              !temIg
                ? SEM_IG
                : cur.hasLinkTapSplit
                  ? `${formatInt(cur.linkTapsWebsite)} site · ${formatInt(cur.linkTapsWhatsApp)} WhatsApp`
                  : "site e WhatsApp"
            }
            meta={SEM_META}
          />
          <KpiComDica
            dica={dicaConteudo("conversas_dm")}
            label="Conversas de DM"
            value={cur.hasDmData ? formatInt(cur.dmConversations) : "—"}
            Icon={MessageCircle}
            delta={
              prev && cur.hasDmData && prev.hasDmData
                ? pctDelta(cur.dmConversations, prev.dmConversations)
                : undefined
            }
            hint={cur.hasDmData ? "registro manual" : "registro manual em Registros"}
            meta={metaDeConversasDm(data.goals, cur.dmConversations, cur.hasDmData, range === undefined)}
          />
          {/* Total 0 é desconhecido (snapshot manual sem o campo): sem valor, sem Δ e
              sem status contra a meta — "Abaixo da meta (0%)" por um campo em branco
              seria cor sobre nada. */}
          <KpiComDica
            dica={dicaConteudo("seguidores")}
            label="Seguidores"
            value={temIg && seg.temTotal ? formatInt(seg.fim) : "—"}
            Icon={Users}
            delta={temIg && seg.temTotal ? deltaDeContagem(seg.liquido, "no período") : undefined}
            hint={
              !temIg
                ? SEM_IG
                : !seg.temTotal
                  ? "sem total de seguidores no período — o snapshot veio sem o campo"
                  : seg.fimNoUltimoDia || !seg.fimEm
                    ? seg.nota
                    : `total de ${formatDateShort(seg.fimEm)} (o último snapshot veio sem o campo) · ${seg.nota}`
            }
            meta={metaDeSeguidores(data.goals, seg.fim, temIg && seg.temTotal)}
          />
        </div>
        {faltasDeRegistro.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {faltasDeRegistro.join(" ")}{" "}
            <Link href={registrosHref} className="underline underline-offset-2">
              Registrar em Registros
            </Link>
            .
          </p>
        ) : null}
      </section>

      {/* ---- 2. Variações de anúncio: sugestão, nunca correção automática ---- */}
      {variacoes.length > 0 ? (
        <VariacoesCard
          grupos={variacoes}
          registrosHref={comPeriodo("/conteudo/registros#posts", rangeKey)}
          podeEditar={podeEditar}
        />
      ) : null}

      {/* ---- 3. Ações de conteúdo (as recomendações moram aqui) ---- */}
      {acoesDeConteudo.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              Ações de conteúdo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RecommendationsCard recs={acoesDeConteudo} rangeKey={rangeKey} />
          </CardContent>
        </Card>
      ) : null}

      {/* ---- 4. Mais métricas: tudo o que não responde a pergunta, sob demanda ---- */}
      {!temIg ? (
        <EmptyState
          title="Sem dados do Instagram no período"
          hint="A conta foi criada há pouco — insights podem levar até 48h para consolidar. Registre snapshots diários em Conteúdo → Registros."
        />
      ) : (
        <details className="group rounded-xl border bg-card text-card-foreground shadow-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            Mais métricas
            <span className="font-normal text-muted-foreground">
              — alcance, views, interações, funis e séries
            </span>
          </summary>
          <div className="space-y-6 border-t p-5">
            {/* Dois alcances, de propósito (B11): a conta soma o pago; os posts, só o orgânico. */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <KpiComDica
                dica={dicaConteudo("alcance_conta")}
                label="Alcance da conta (pago + orgânico)"
                value={formatCompact(cur.reach)}
                Icon={Radio}
                delta={prev ? pctDelta(cur.reach, prev.reach) : undefined}
                hint="soma dos dias; inclui anúncios"
              />
              <KpiComDica
                dica={dicaConteudo("alcance_organico_posts")}
                label="Alcance orgânico dos posts"
                value={organico.posts > 0 ? formatCompact(organico.alcance) : "—"}
                Icon={Leaf}
                delta={
                  organico.posts > 0 && organicoPrev && organicoPrev.posts > 0
                    ? pctDelta(organico.alcance, organicoPrev.alcance)
                    : undefined
                }
                hint={
                  organico.posts > 0
                    ? `${formatInt(organico.posts)} post(s)${foraDoOrganico ? ` · fora: ${foraDoOrganico}` : ""}`
                    : "nenhum post orgânico no período"
                }
              />
              <KpiComDica
                dica={dicaConteudo("views")}
                label="Views"
                value={formatCompact(cur.views)}
                Icon={Eye}
                delta={prev ? pctDelta(cur.views, prev.views) : undefined}
              />
              <KpiComDica
                dica={dicaConteudo("interacoes")}
                label="Interações"
                value={formatCompact(cur.interactions)}
                Icon={Heart}
                delta={prev ? pctDelta(cur.interactions, prev.interactions) : undefined}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {aware ? (
                <>
                  <KpiCard
                    label="Custo / 1k alcance"
                    value={formatCurrencyOrDash(aware.costPerReach)}
                    Icon={Radio}
                    hint={aware.spend > 0 ? "alcance da conta" : "sem verba atribuída à marca"}
                  />
                  <KpiCard label="Investimento" value={formatCurrency0(aware.spend)} Icon={DollarSign} />
                </>
              ) : null}
              <KpiComDica
                dica={dicaConteudo("visitas_perfil")}
                label="Visitas ao perfil"
                value={formatCompact(cur.profileViews)}
                Icon={UserRound}
                delta={prev ? pctDelta(cur.profileViews, prev.profileViews) : undefined}
              />
              <KpiCard
                label="Taxa de clique no link"
                value={cur.profileViews > 0 ? formatPercent(cur.linkTapRate) : "—"}
                Icon={Percent}
                hint={cur.profileViews > 0 ? "cliques ÷ visitas" : "sem visitas ao perfil no período"}
              />
              <KpiCard
                label="Engaj. da conta"
                value={cur.reach > 0 ? formatPercent(cur.engagementRate) : "—"}
                Icon={TrendingUp}
                hint={cur.reach > 0 ? "interações ÷ alcance" : "sem alcance no período"}
                delta={prev ? pctDelta(cur.engagementRate, prev.engagementRate) : undefined}
              />
              <KpiCard
                label="Alcance diário sobre a base"
                value={cur.followersEnd > 0 ? formatPercent(cur.reachRateOnBase) : "—"}
                Icon={Users}
                hint="alcance/dia ÷ seguidores · saudável 30%+"
                delta={prev ? pctDelta(cur.reachRateOnBase, prev.reachRateOnBase) : undefined}
              />
              <KpiCard
                label="Aquecimento da base"
                value={cur.followersEnd > 0 ? formatPercent(cur.engagementOnBase) : "—"}
                Icon={Heart}
                hint="interações/dia ÷ seguidores"
                delta={prev ? pctDelta(cur.engagementOnBase, prev.engagementOnBase) : undefined}
              />
              {cur.hasFollowSplit ? (
                <>
                  <KpiCard
                    label="Começaram a seguir"
                    value={formatIntComSinal(cur.followsTotal)}
                    Icon={UserRound}
                    hint="crescimento bruto"
                    delta={
                      prev?.hasFollowSplit ? pctDelta(cur.followsTotal, prev.followsTotal) : undefined
                    }
                  />
                  <KpiCard
                    label="Deixaram de seguir"
                    value={formatIntComSinal(-cur.unfollowsTotal)}
                    Icon={UserRound}
                    hint="churn da base"
                    delta={
                      prev?.hasFollowSplit
                        ? pctDelta(cur.unfollowsTotal, prev.unfollowsTotal, { lowerIsBetter: true })
                        : undefined
                    }
                  />
                </>
              ) : null}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard
                title="Funil do perfil (alcance da conta, pago + orgânico)"
                description="Alcance da conta → visita ao perfil → novo seguidor. O alcance aqui inclui os anúncios (a Meta não separa) — o orgânico dos posts está no card acima. Onde perde: muito alcance e pouca visita = gancho fraco (ou anúncio que não leva ao perfil); muita visita e poucos seguidores = feed/prova social."
              >
                <FunnelChart stages={perfilFunnel} />
              </ChartCard>
              <ChartCard
                title="Funil do link da bio"
                description={`Views → visita ao perfil → clique no link. CTR da bio (cliques ÷ visitas): ${
                  cur.profileViews > 0 ? formatPercent(cur.linkTapRate) : "—"
                }.${
                  cur.hasLinkTapSplit
                    ? ` Destino: ${formatInt(cur.linkTapsWebsite)} site · ${formatInt(cur.linkTapsWhatsApp)} WhatsApp.`
                    : ""
                }`}
              >
                <FunnelChart stages={clickFunnel} />
              </ChartCard>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {followersGoal && gp ? (
                <ChartCard title="Meta de seguidores" description={goalOutlook}>
                  <GoalBar
                    label="Seguidores"
                    valueText={formatInt(seg.fim)}
                    targetText={formatInt(followersGoal.target)}
                    pct={gp.pct}
                    onTrack={gp.onTrack}
                  />
                </ChartCard>
              ) : null}
              <ChartCard
                title="Engajamento sobre o alcance"
                description="Interações ÷ alcance do dia — qualidade do conteúdo para quem o viu."
              >
                <TimeSeriesChart
                  data={engagementDaily}
                  series={[
                    { key: "engagementRate", label: "Sobre o alcance", color: CHART.series[0], kind: "line" },
                  ]}
                  yFormat="percent"
                />
              </ChartCard>
              <ChartCard
                title="Aquecimento da base por dia"
                description="Interações ÷ seguidores — a base fria esquentando (ou não)."
              >
                <TimeSeriesChart
                  data={engagementDaily}
                  series={[{ key: "warmth", label: "Sobre a base", color: CHART.series[1], kind: "line" }]}
                  yFormat="percent"
                />
              </ChartCard>
            </div>

            {cur.hasReachSplit ? (
              <ChartCard
                title="Descoberta — alcance por tipo de conta"
                description={`${formatPercent(cur.discoveryRate)} do alcance foi de não-seguidores (gente nova).`}
              >
                <HorizontalBars
                  data={[
                    { label: "Seguidores", value: cur.reachFollowers, color: CHART.series[0] },
                    { label: "Não-seguidores", value: cur.reachNonFollowers, color: CHART.series[1] },
                  ]}
                  valueFormat="compact"
                />
              </ChartCard>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="Seguidores" description="Total de seguidores ao longo do tempo.">
                <TimeSeriesChart
                  data={series}
                  series={[{ key: "followers", label: "Seguidores", color: CHART.series[0] }]}
                  yFormat="int"
                />
              </ChartCard>
              <ChartCard
                title="Variação de seguidores por dia"
                description={`Líquido diário: total no fim do dia − o último total conhecido; o 1º dia, contra a véspera (dia sem total conta 0). ${seg.nota}.`}
              >
                <TimeSeriesChart
                  data={series}
                  series={[{ key: "gain", label: "Variação", color: CHART.series[2] }]}
                  yFormat="int"
                />
              </ChartCard>
            </div>

            <ChartCard
              title="Alcance e Views por dia"
              description="Quantas contas viram o conteúdo (conta inteira: pago + orgânico)."
            >
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

            {dmWeeks.length > 0 ? (
              <ChartCard
                title="Conversas de DM por semana"
                description="A métrica de negócio do perfil (registro manual em Registros — a API não expõe DMs)."
              >
                <HorizontalBars
                  data={dmWeeks.map((w) => ({
                    label: `Semana de ${w.label}`,
                    value: w.conversations,
                    color: CHART.series[0],
                  }))}
                  valueFormat="int"
                />
              </ChartCard>
            ) : null}
          </div>
        </details>
      )}

      <div className="flex items-start gap-2.5 rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p>
          Dados demográficos (idade, cidade) e a série de ganhos e perdas de seguidores só ficam
          disponíveis com <span className="font-medium text-foreground">100+ seguidores</span> e
          podem levar até 48h — por isso não aparecem nos primeiros dias de uma conta nova.
        </p>
      </div>
    </div>
  );
}
