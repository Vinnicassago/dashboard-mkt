/**
 * Briefing do analista: TODOS os números do período, pré-calculados.
 *
 * PURO — sem I/O, sem `server-only`. É a fronteira que sustenta a Etapa 3:
 *
 *   • O modelo NÃO calcula. Cada número aqui sai de `metrics.ts`, as mesmas
 *     funções que desenham a tela. Assim o texto da IA nunca diverge do painel.
 *   • NENHUM dado de lead entra. Só contagens e razões — nome, e-mail e telefone
 *     ficam no servidor (LGPD). Legenda de post entra truncada: é conteúdo
 *     público do próprio perfil, não dado de terceiro. Do Início entram só os
 *     textos e as contagens (`inicioParaIA`): a lista de pessoas fica de fora.
 *   • ~3 KB de JSON em vez de milhares de linhas: barato, rápido e cacheável.
 */

import {
  CTA_LABEL,
  actualForGoal,
  aggregatePostPerformance,
  awarenessKpis,
  campaignPacing,
  ctaDistribution,
  formatPerformance,
  igAccountTotals,
  inRange,
  objectiveBreakdown,
  pillarPerformance,
  postPerformance,
  postingCadence,
  previousRange,
  type DataWarning,
  type DateRange,
} from "../metrics";
import { MIN_REUNIOES } from "../trust";
import { hojeEmBrasilia } from "../range";
import { custoExibivel, kpisDoPeriodo, reguaDoPeriodo, type KpisDoPeriodo } from "../kpis";
import type { Inicio } from "../inicio";
import type { MidiaParaIA } from "../midia-tela";
import { DONO_LABEL } from "../dono";
import type { ResumoDaTrava } from "../onde-trava";
import { META_DEF } from "../metas";
import { DICIONARIO } from "../dicionario";
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
  /**
   * Os KPIs do período como a tela os calculou (`carregarBussola`: regras de
   * marca, cobertura do sync, "hoje"). Com eles, `pago`, `regua` e o custo por
   * reunião em quarentena são os MESMOS números dos cartões do Início (com a
   * mesma confiança). Ausentes (marca awareness, testes), calcula-se aqui.
   */
  kpis?: KpisDoPeriodo;
  /**
   * O Início montado (`montarInicio`) — entra só a projeção sem pessoas
   * (`inicioParaIA`): os cartões como a tela os escreve, leads por dia, o funil
   * curto, as frases do atendimento e o último post.
   */
  inicio?: Inicio;
  /**
   * A Mídia da semana como a tela a escreve (`midiaParaIA(montarMidiaDaTela(…))`):
   * o resumo, a verba, os criativos no ar com sinal, motivo e ressalva, e a
   * situação do robô — sem pessoa. Calculada só no resumo semanal (o Início não
   * paga por ela). Ausente: `pago.midia` = null.
   */
  midia?: MidiaParaIA;
}

/**
 * "Onde trava" para a IA (Fase 3, K8): SEMPRE um objeto, com a `situacao` que
 * distingue os quatro estados (trava · abaixo-da-amostra · sem-leads ·
 * leitura-parada) — nunca um `null` só. A frase é a da manchete do Funil (a MESMA
 * `ondeTrava`), sobre os leads do período DESTE briefing. Só contagens e textos.
 */
function ondeTravaParaIA(t: ResumoDaTrava) {
  const trava = t.situacao === "trava";
  return {
    frase: t.titulo,
    situacao: t.situacao,
    semEtapasDoRobo: t.semEtapasDoRobo,
    dono: t.dono ? DONO_LABEL[t.dono] : null,
    pessoasParadas: trava ? t.travados : null,
    entraram: trava ? t.entradas : null,
    aindaNoPrazo: trava ? t.emAndamento : null,
    abertos: trava ? t.abertos : null,
    encerrados: trava ? t.encerrados : null,
  };
}

/**
 * O bloco `inicio` do briefing: o que o Início MOSTRA, só textos e contagens —
 * nunca a lista de pessoas (`leadsChegando.ultimos`), nome, telefone ou e-mail.
 * O atendimento (título, frases) é a foto do MOMENTO da geração (segunda 08:00),
 * não da semana resumida; o funil curto é a coorte do período. `ondeTrava` (a
 * manchete do Funil sobre a coorte do período) vai sempre, só contagens e a `situacao`.
 */
export function inicioParaIA(i: Inicio) {
  return {
    cartoes: {
      investimentoConversao: i.cartoes.investimento.texto,
      cpl: i.cartoes.cpl.texto,
      leads: i.cartoes.leads.texto,
      reunioesAgendadas: i.cartoes.reunioes.texto,
      custoPorReuniao: i.cartoes.custoReuniao,
    },
    leadsChegando: {
      porDia: i.leadsChegando.dias.map((d) => ({ dia: d.date, leads: d.leads, campanhaPausada: d.pausado })),
      ultimoLead: i.leadsChegando.ultimos[0]?.ha ?? null,
    },
    atendimento: {
      titulo: i.atendimento.titulo,
      esperandoOComercial: i.atendimento.esperando,
      leituraDoRobo: i.atendimento.leituraParada?.texto ?? null,
      funil: {
        recorte: i.atendimento.recorte,
        degraus: i.atendimento.funil.map((d) => ({
          degrau: d.rotulo,
          contagem: d.valor,
          minimo: d.piso,
          taxaPct: d.taxa == null ? null : pct(d.taxa),
          taxaSobre: d.taxa == null ? null : d.base === "leads" ? "leads" : "degrau anterior",
        })),
      },
      frases: i.atendimento.frases.map((f) => f.texto),
      nadaEsperando: i.atendimento.vazio,
      ondeTrava: ondeTravaParaIA(i.atendimento.ondeTrava),
    },
    diasDesdeOUltimoPost: i.rodape.diasDesdeUltimoPost,
  };
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
  const cadencia = postingCadence(data.igPosts, range, opts.nowIso, data.creatives);

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

  // ---- metas de conteúdo (as do funil têm vigência: `pago.regua`) ----
  const FUNIL_LEGADO = new Set(["leads", "meetings", "cpl", "cpr"]);
  const metas = data.goals
    .filter((g) => !FUNIL_LEGADO.has(g.metric))
    // A meta de conversas de DM é da CAMPANHA (o card só a julga na campanha
    // inteira): num recorte, a IA não recebe um veredito que a tela não dá.
    .filter((g) => !(g.metric === "conversas_dm" && range))
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
        // null = nunca houve post da grade (não é "postou hoje").
        diasDesdeOUltimoPost: cadencia.daysSinceLast,
        diasComDuasOuMaisPecas: cadencia.daysWithPileup,
      },
      melhoresPosts: melhores,
      pioresPosts: piores,
    },

    metas,
    // O que o painel já detectou sozinho: as regras de conteúdo — a IA prioriza
    // ou discorda, não redescobre. As ações do motor não vão (dormente). A Mídia
    // vai como a tela a escreve (`pago.midia`).
    alertasJaDetectados: buildRecommendations(data, range, opts.nowIso).map((r) => ({
      severidade: r.severity,
      titulo: r.title,
      dono: r.dono,
      regra: "conteudo",
    })),
    // O que o Início mostra (cartões, leads chegando, atendimento, último post) — sem pessoas.
    inicio: opts.inicio ? inicioParaIA(opts.inicio) : null,
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

  // Os MESMOS números dos cartões do Início (kpisDoPeriodo, com o contexto do
  // carregador quando ele os passa) — a IA não argumenta com um CPL ou um custo
  // por reunião diferente do que a tela mostra.
  const kp = opts.kpis ?? kpisDoPeriodo(data, range);
  const k = kp.overview;
  const kpPrev = prevRange ? kpisDoPeriodo(data, prevRange) : undefined;
  const obj = objectiveBreakdown(data, range);
  const pacing = campaignPacing(data, opts.nowIso);
  // Com menos de MIN_REUNIOES o custo por reunião está em quarentena na tela: a
  // IA recebe null e o motivo, nunca o valor — senão argumenta com um número que
  // o painel esconde.
  const cprConfiavel = custoExibivel(kp.custoPorReuniao);

  return {
    ...base,
    pago: {
      investimentoTotal: money(k.spend),
      investimentoConversao: money(k.spendConversao),
      investimentoDescoberta: money(k.spendDescoberta),
      // O CPL/CPR FIEL exclui o gasto de descoberta — é a leitura do painel.
      leads: k.leads,
      leadsConversao: k.leadsConversao,
      leadsOrganicos: k.organicLeads,
      cpl: custoExibivel(kp.cpl) ? r2(k.cpl) : null,
      cplAnterior: kpPrev && custoExibivel(kpPrev.cpl) ? r2(kpPrev.overview.cpl) : null,
      reunioesAgendadasNoPeriodo: k.meetings,
      reunioesDeConversao: k.meetingsConversao,
      agendaramDaCoorte: k.meetingsCoorte,
      cpr: cprConfiavel ? r2(k.cpr) : null,
      cprEmQuarentena: cprConfiavel
        ? null
        : `só ${k.meetingsConversao} ${k.meetingsConversao === 1 ? "reunião" : "reuniões"} de conversão no período — com menos de ${MIN_REUNIOES}, o custo por reunião não é exibido nem usado para decidir`,
      cprAnterior: kpPrev && custoExibivel(kpPrev.custoPorReuniao) ? r2(kpPrev.overview.cpr) : null,
      compareceram: k.attended,
      taxaComparecimentoPct: pct(k.showRate),
      // Derivadas óbvias, entregues prontas: o modelo tende a calculá-las
      // sozinho para argumentar, e proibir é mais frágil do que dar o número.
      custoPorComparecimento: k.attended >= MIN_REUNIOES ? r2(k.spendConversao / k.attended) : null,
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
      // A Mídia como a tela a escreve (Fase 4): os criativos no ar com o sinal do
      // cartão (nome, selo, motivo, ressalva) — a IA não julga o que a tela não
      // julga, nem chama de "fadigando" o que o cartão chama de "Pausar". Sem pessoa.
      midia: opts.midia ?? null,
    },
    // A régua (Fase 4): cada número do funil contra a meta que vale no período.
    // Sem status quando o número não se sustenta — a IA não julga o que a tela não julga.
    regua: reguaDoPeriodo(kp, data, range, hojeEmBrasilia(new Date(opts.nowIso)))
      .filter((l) => l.alvo != null)
      .map((l) => ({
        metrica: META_DEF[l.metrica].nome,
        realizado: r2(l.medida.valor),
        alvoDoPeriodo: r2(l.alvo!),
        status: l.avaliacao?.rotulo ?? "sem status (número não se sustenta)",
        provisoria: l.meta?.provisoria ?? false,
      })),
    // O que cada número quer dizer — a IA lê a mesma definição que o ⓘ da tela.
    dicionario: [
      DICIONARIO.leads,
      DICIONARIO.leads_conversao,
      DICIONARIO.cpl,
      DICIONARIO.reunioes_agendadas,
      DICIONARIO.reunioes_conversao,
      DICIONARIO.custo_por_reuniao,
      DICIONARIO.agendaram,
      DICIONARIO.taxa_lead_agendada,
      DICIONARIO.no_ar,
      DICIONARIO.sinal_do_criativo,
      DICIONARIO.qualidade_do_robo,
      DICIONARIO.sem_whatsapp,
      DICIONARIO.fora_das_linhas,
    ].map((d) => ({ nome: d.nome, definicao: d.definicao, exclui: d.exclui })),
  };
}

export type Briefing = ReturnType<typeof buildBriefing>;
