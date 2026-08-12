/**
 * Briefing do analista: TODOS os números do período, pré-calculados.
 *
 * PURO — sem I/O, sem `server-only`. É a fronteira que sustenta a Etapa 3:
 *
 *   • O modelo NÃO calcula. Cada número aqui sai de `metrics.ts`, as mesmas
 *     funções que desenham a tela. Assim o texto da IA nunca diverge do painel.
 *   • NENHUM dado de lead entra. Só contagens e razões — nome, e-mail e telefone
 *     ficam no servidor (LGPD). Legenda de post entra truncada: é conteúdo
 *     público do próprio perfil, não dado de terceiro.
 *   • ~3 KB de JSON em vez de milhares de linhas: barato, rápido e cacheável.
 */

import {
  CTA_LABEL,
  actualForGoal,
  aggregatePostPerformance,
  awarenessKpis,
  campaignPacing,
  creativePerformance,
  ctaDistribution,
  formatPerformance,
  igAccountTotals,
  inRange,
  objectiveBreakdown,
  overviewKpis,
  pillarPerformance,
  postPerformance,
  postingCadence,
  previousRange,
  type DataWarning,
  type DateRange,
} from "../metrics";
import { buildRecommendations } from "../recommendations";
import { BENCHMARK, ROTINA_DIARIA, WEEKLY_MIX } from "../content/playbook";
import { buildOutcomeReport, presenceRoutine } from "../content/outcomes";
import { brandDef, isAwareness } from "../brands";
import type { DashboardData, PostDraft } from "../types";

/** Arredonda para não gastar token com casa decimal que ninguém usa. */
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Razão 0–1 vira percentual inteiro-ish: 0.1234 → 12.3 */
const pct = (n: number) => r1(n * 100);
const money = (n: number) => Math.round(n);
const short = (s: string, max = 70) =>
  s.length > max ? `${s.slice(0, max).trim()}…` : s;

/**
 * Rótulo do período, na forma que a análise grava. Exportado para a UI comparar
 * o período da análise guardada com o que está na tela — se as duas montassem
 * essa string por conta própria, o aviso de "análise de outro período" quebraria
 * silenciosamente na primeira divergência.
 */
export function periodOf(range: DateRange | undefined): { de: string; ate: string } {
  return range
    ? { de: range.from, ate: range.to }
    : { de: "início da campanha", ate: "hoje" };
}

export interface BriefingOptions {
  nowIso: string;
  /** Peças em produção — habilita o bloco de previsto×realizado. */
  drafts?: PostDraft[];
  /** Avisos de qualidade de dados (vêm de fora: dependem do último sync). */
  warnings: DataWarning[];
}

/**
 * Monta o pacote de números. Devolve um objeto simples (serializa direto para
 * JSON) — nunca uma string formatada: o modelo lê melhor estrutura que prosa.
 */
export function buildBriefing(
  data: DashboardData,
  range: DateRange | undefined,
  opts: BriefingOptions,
) {
  const brand = brandDef(data.campaign.brand);
  const awareness = isAwareness(brand.slug);
  const prevRange = range ? previousRange(range) : undefined;

  // ---- perfil (vale para as duas marcas) ----
  const ig = igAccountTotals(data.igAccountDaily, range);
  const igPrev = prevRange ? igAccountTotals(data.igAccountDaily, prevRange) : undefined;

  // ---- orgânico: mesmo universo da página Posts (sem teste, sem impulsionado) ----
  const postsAll = postPerformance(data.igPosts, range, data.igAccountDaily, data.creatives);
  const organicos = postsAll.filter((p) => !p.isTest && !p.boosted);
  const agg = aggregatePostPerformance(postsAll);
  const aggPrev = prevRange
    ? aggregatePostPerformance(
        postPerformance(data.igPosts, prevRange, data.igAccountDaily, data.creatives),
      )
    : undefined;
  const organicIds = new Set(organicos.map((p) => p.id));
  const organicRaw = data.igPosts.filter((p) => organicIds.has(p.id));
  const cadencia = postingCadence(data.igPosts, range, opts.nowIso);

  const melhores = [...organicos]
    .sort((a, b) => b.engagementRate - a.engagementRate)
    .slice(0, 3)
    .map((p) => ({
      gancho: short(p.caption),
      formato: p.type,
      pilar: p.pillar,
      alcance: p.reach,
      engajamento: pct(p.engagementRate),
      salvosPor1k: r1(p.savesPer1k),
      retencao: p.retention != null ? pct(p.retention) : undefined,
      cta: p.cta ? CTA_LABEL[p.cta] : undefined,
    }));
  const piores = [...organicos]
    .sort((a, b) => a.engagementRate - b.engagementRate)
    .slice(0, 2)
    .map((p) => ({
      gancho: short(p.caption),
      formato: p.type,
      pilar: p.pillar,
      alcance: p.reach,
      engajamento: pct(p.engagementRate),
    }));

  // ---- metas ----
  const metas = data.goals
    .map((g) => {
      // `actualForGoal` ancora "agora" em data.updatedAt para permanecer pura;
      // a cadência ancora no agora REAL. Com dataset parado os dois divergem
      // (7/semana vs 3/semana), e mandar dois números para a mesma métrica é a
      // forma mais rápida de a IA escrever besteira. Aqui vale a cadência: uma
      // grade parada há 20 dias não mantém o ritmo de quando postava.
      const real =
        g.metric === "posts_semana" ? cadencia.postsPerWeek : actualForGoal(g, data, range);
      return {
        metrica: g.metric,
        alvo: g.target,
        realizado: real == null ? null : r1(real),
        semDado: real == null,
        atingiu: real == null ? null : g.lowerIsBetter ? real <= g.target : real >= g.target,
      };
    })
    .sort((a, b) => a.metrica.localeCompare(b.metrica));

  const base = {
    marca: {
      handle: brand.handle,
      tipo: brand.type,
      northStar: awareness
        ? "custo por seguidor e custo por mil alcançados"
        : "custo por reunião agendada (CPR)",
    },
    periodo: { ...periodOf(range), diasComDado: ig.days },
    comparacao: prevRange ? { de: prevRange.from, ate: prevRange.to } : null,

    perfil: {
      seguidores: ig.followersEnd,
      ganhoLiquidoNoPeriodo: ig.netNew,
      ganhoLiquidoAnterior: igPrev?.netNew,
      alcance: ig.reach,
      views: ig.views,
      interacoes: ig.interactions,
      visitasAoPerfil: ig.profileViews,
      cliquesNoLink: ig.profileLinkTaps,
      taxaCliqueNoLinkPct: pct(ig.linkTapRate),
      alcanceDiarioSobreBasePct: pct(ig.reachRateOnBase),
      engajamentoSobreAlcancePct: pct(ig.engagementRate),
      descobertaPct: ig.hasReachSplit ? pct(ig.discoveryRate) : null,
      crescimentoBruto: ig.hasFollowSplit
        ? { seguiram: ig.followsTotal, deixaram: ig.unfollowsTotal }
        : null,
      conversasDeDm: ig.hasDmData ? ig.dmConversations : null,
    },

    organico: {
      posts: agg.count,
      alcanceMedio: Math.round(agg.avgReach),
      alcanceSobreBasePct: agg.avgReachOnBase != null ? pct(agg.avgReachOnBase) : null,
      engajamentoMedioPct: pct(agg.avgEr),
      salvosPor1kViews: r1(agg.savesPer1k),
      compartilhamentosPorPost: r1(agg.sharesPerPost),
      comentariosPorPost: r1(agg.commentsPerPost),
      retencaoMediaPct: agg.avgRetention != null ? pct(agg.avgRetention) : null,
      tempoAssistidoMedioSeg: agg.avgWatchTime != null ? r1(agg.avgWatchTime) : null,
      pedidosDeDmPct: pct(agg.dmCtaShare),
      anterior: aggPrev
        ? {
            posts: aggPrev.count,
            alcanceMedio: Math.round(aggPrev.avgReach),
            engajamentoMedioPct: pct(aggPrev.avgEr),
            salvosPor1kViews: r1(aggPrev.savesPer1k),
            comentariosPorPost: r1(aggPrev.commentsPerPost),
            retencaoMediaPct: aggPrev.avgRetention != null ? pct(aggPrev.avgRetention) : null,
          }
        : null,
      porFormato: formatPerformance(organicRaw, range).map((f) => ({
        formato: f.label,
        posts: f.count,
        engajamentoPct: pct(f.avgEngagement),
        alcanceMedio: Math.round(f.avgReach),
        amostraConfiavel: f.sampleOk,
      })),
      porSerie: pillarPerformance(organicRaw, range).map((p) => ({
        serie: p.pillar,
        posts: p.count,
        engajamentoPct: pct(p.avgEngagement),
        alcanceMedio: Math.round(p.avgReach),
        amostraConfiavel: p.sampleOk,
      })),
      ctaPedidos: ctaDistribution(organicos).map((c) => ({ cta: c.label, posts: c.count })),
      cadencia: {
        postsPorSemana: r1(cadencia.postsPerWeek),
        reelsPorSemana: r1(cadencia.reelsPerWeek),
        carrosseisPorSemana: r1(cadencia.carrosseisPerWeek),
        gradeEsperada: `${WEEKLY_MIX.reels} reels + ${WEEKLY_MIX.carrosseis} carrosséis`,
        maiorIntervaloDias: cadencia.maxGapDays,
        diasDesdeOUltimoPost: cadencia.daysSinceLast,
        diasComDuasOuMaisPecas: cadencia.daysWithPileup,
      },
      melhoresPosts: melhores,
      pioresPosts: piores,
    },

    metas,
    alertasJaDetectados: buildRecommendations(data, range, opts.nowIso).map((r) => ({
      severidade: r.severity,
      titulo: r.title,
    })),
    rotinaDePresenca: (() => {
      const r = presenceRoutine(data.igAccountDaily.filter((x) => inRange(x.date, range)));
      if (!r.temDados) return null;
      return {
        diasRegistrados: r.diasComRegistro,
        storiesPorDia: r1(r.storiesPorDia),
        metaStoriesPorDia: `${ROTINA_DIARIA.storiesMin}–${ROTINA_DIARIA.storiesMax}`,
        diasUteisSemStory: r.diasUteisSemStory,
        comentariosNoNichoPorDia: r1(r.comentariosPorDia),
        metaComentarios: ROTINA_DIARIA.comentariosNoNicho,
        contasSeguidasPorDia: r1(r.seguidasPorDia),
        respondeuTudoPct: pct(r.respondeuTudoPct),
      };
    })(),

    // Previsto × realizado: a régua do guia prediz desempenho neste perfil?
    // `null` enquanto não há pares suficientes — nunca mande o modelo concluir
    // de amostra pequena, ele conclui.
    previstoVsRealizado: (() => {
      if (!opts.drafts?.length) return null;
      const rep = buildOutcomeReport(opts.drafts, data.igPosts);
      if (rep.pairs.length === 0) return null;
      return {
        pecasVinculadas: rep.pairs.length,
        amostraSuficiente: rep.sampleOk,
        minimoParaConcluir: rep.minSample,
        correlacaoNotaAlcance: rep.correlacaoNotaAlcance,
        porFaixaDeNota: rep.sampleOk
          ? rep.porFaixaDeNota.map((b) => ({
              faixa: b.faixa,
              pecas: b.n,
              alcanceMedio: b.alcanceMedio,
              engajamentoPct: pct(b.engajamentoMedio),
            }))
          : null,
        regrasComEfeitoMedido: rep.porRegra
          .filter((x) => x.sampleOk)
          .map((x) => ({
            regra: x.label,
            alcanceCumprindo: x.alcanceMedioCumpriu,
            alcanceViolando: x.alcanceMedioViolou,
            lift: r2(x.lift),
          })),
      };
    })(),

    qualidadeDeDados: opts.warnings.map((w) => w.message),
    reguaDoNicho: {
      viewsPorReelEsperado: `${BENCHMARK.reelViewsMin}–${BENCHMARK.reelViewsMax}`,
      referencia: `perfis do nicho com ~${BENCHMARK.seguidoresReferencia / 1000} mil seguidores`,
      nota: BENCHMARK.nota,
    },
  };

  if (awareness) {
    const a = awarenessKpis(data, range);
    return {
      ...base,
      pago: {
        investimento: money(a.spend),
        seguidoresGanhos: a.netNewFollowers,
        custoPorSeguidor: a.costPerFollower != null ? r2(a.costPerFollower) : null,
        custoPorMilAlcancados: a.costPerReach != null ? r2(a.costPerReach) : null,
      },
    };
  }

  const k = overviewKpis(data, range);
  const kPrev = prevRange ? overviewKpis(data, prevRange) : undefined;
  const obj = objectiveBreakdown(data, range);
  const pacing = campaignPacing(data, opts.nowIso);
  const criativos = creativePerformance(data, range);
  const comCpr = criativos.filter((c) => c.meetings > 0);

  return {
    ...base,
    pago: {
      investimentoTotal: money(k.spend),
      investimentoConversao: money(k.spendConversao),
      investimentoDescoberta: money(k.spendDescoberta),
      // O CPL/CPR FIEL exclui o gasto de descoberta — é a leitura do painel.
      leads: k.leads,
      leadsOrganicos: k.organicLeads,
      cpl: r2(k.cpl),
      cplAnterior: kPrev ? r2(kPrev.cpl) : null,
      reunioes: k.meetings,
      cpr: r2(k.cpr),
      cprAnterior: kPrev ? r2(kPrev.cpr) : null,
      compareceram: k.attended,
      taxaComparecimentoPct: pct(k.showRate),
      // Derivadas óbvias, entregues prontas: o modelo tende a calculá-las
      // sozinho para argumentar, e proibir é mais frágil do que dar o número.
      custoPorComparecimento: k.attended > 0 ? r2(k.spendConversao / k.attended) : null,
      custoPorCliente: k.clients > 0 ? r2(k.spendConversao / k.clients) : null,
      leadParaReuniaoPct: pct(k.leadToMeeting),
      clientes: k.clients,
      receita: money(k.revenue),
      cac: r2(k.cac),
      roas: r2(k.roas),
      ticketMedio: money(k.ticket),
      custoPorSeguidorEstimado:
        obj.costPerFollowerEst != null ? r2(obj.costPerFollowerEst) : null,
      ritmoDeGasto: {
        gastoAteAgora: money(pacing.spent),
        orcamento: money(pacing.budget),
        projetadoAteOFim: pacing.projectedSpend != null ? money(pacing.projectedSpend) : null,
        situacao: pacing.status,
        diasRestantes: pacing.daysLeft ?? null,
      },
      criativos: {
        melhorPorCpr: comCpr.length
          ? (() => {
              const c = comCpr.reduce((m, x) => (x.cpr < m.cpr ? x : m));
              return { nome: c.name, cpr: r2(c.cpr), reunioes: c.meetings, gasto: money(c.spend) };
            })()
          : null,
        piorPorCpr: comCpr.length > 1
          ? (() => {
              const c = comCpr.reduce((m, x) => (x.cpr > m.cpr ? x : m));
              return { nome: c.name, cpr: r2(c.cpr), reunioes: c.meetings, gasto: money(c.spend) };
            })()
          : null,
        fadigados: criativos
          .filter((c) => c.fatigue.level === "fadigado")
          .map((c) => ({ nome: c.name, motivo: c.fatigue.reason, gasto: money(c.spend) })),
      },
    },
  };
}

export type Briefing = ReturnType<typeof buildBriefing>;
