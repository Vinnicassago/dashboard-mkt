/**
 * O INÍCIO montado — a função pura da home (exigência do ADR-03: cada tela tem
 * um `montarVisao` sem I/O, para o teste de consistência e para o resumo
 * semanal lerem exatamente o que a tela mostra). O nome do arquivo e de
 * `montarBussola` ficaram (renomear é churn); o rótulo da tela é "Início".
 *
 * Dois modos, escolhidos pela CHAVE do período (`periodoDaLive`, sem data):
 *   • NORMAL — quatro blocos, e só quatro (bloco novo = tirar um): cartões,
 *     leads chegando, atendimento e rodapé (`montarInicio`), mais o resumo da IA
 *     quando existe;
 *   • LIVE — uma das três chaves da régua da live (campanha, captação, pós-live):
 *     o painel da live (`montarPainelLive`, congelado) no lugar dos blocos.
 *
 * As ações do motor (`motor.ts`) saíram da tela: o motor e `acoes_estado` ficam
 * dormentes até a Mídia (Fase 4) — sem tela, sem IA, sem escritor.
 *
 * Os alertas do período também nascem aqui (puros): os do modo normal e os do
 * modo live. Quem carrega o que vem de fora (store, syncs, robô, turno) é
 * `bussola-server.ts`.
 */

import { alertaLpSemDado, alertasDeAtribuicao, alertasDeConfianca, alertasDeQualidade, type Alerta } from "./alertas";
import { rangeDoPainelLive, subAtalhosDaLive, type PeriodoDaLive, type RangeDoPainelLive } from "./atalho-live";
import { montarInicio, type EntradaInicio, type Inicio } from "./inicio";
import type { KpisDoPeriodo } from "./kpis";
import type { CampanhaDaLive } from "./live";
import { montarPainelLive, relatoriosDaLive, type PainelLive, type RelatorioDaLive } from "./live-painel";
import { dataQualityChecks, type DateRange } from "./metrics";
import { comPeriodo } from "./range";
import type { Expediente } from "./turno";
import type { DashboardData, LeadEvent } from "./types";

// ---------------------------------------------------------------- modo normal

/** A entrada do Início é a de `montarInicio` (kpis do carregador, robô inteiro, Fila da live, turno). */
export type EntradaBussola = EntradaInicio;

export interface Bussola {
  /** Os KPIs do período (com `comparar`): os mesmos dos cartões, da IA e dos alertas. */
  kpis: KpisDoPeriodo;
  /** Os quatro blocos (`montarInicio`). */
  inicio: Inicio;
}

export function montarBussola(e: EntradaBussola): Bussola {
  return { kpis: e.kpis, inicio: montarInicio(e) };
}

/**
 * Os alertas do período no modo normal (F19): as travas de confiança (sem as de
 * configuração — `alertasDeConfianca` as descarta: moram em Configurações →
 * Pendências), a saúde do dado (só a home registra estes: se saírem daqui, somem
 * do painel), a atribuição e a landing page que parou de registrar.
 *
 * `lp-sem-dado` é `alertaLpSemDado` (`alertas.ts`, o mesmo do Funil): só para um
 * período que JÁ começou (`range.from <= hoje`, C9) e que termina depois do 1º dia
 * rastreado (`lpParouNoPeriodo`): um período futuro, ou de antes de a landing page
 * existir, não tem linha de nada — e isso não é o rastreio parado.
 */
export function alertasDoInicio(e: {
  data: DashboardData;
  range: DateRange | undefined;
  kpis: KpisDoPeriodo;
  hoje: string;
}): Alerta[] {
  const { data, range } = e;
  return [
    ...alertasDeConfianca(e.kpis.trust.travas),
    ...alertasDeQualidade(dataQualityChecks(data)),
    ...alertasDeAtribuicao(data, range),
    ...alertaLpSemDado(data, range, e.hoje),
  ];
}

// ---------------------------------------------------------------- modo live

export interface SubAtalhoDaLive {
  id: PeriodoDaLive;
  rotulo: string;
  chave: string;
  /** `/?range=<chave>` — o painel é o Início no período da live. */
  href: string;
  /** É a janela aberta agora. */
  atual: boolean;
}

export interface ModoLive {
  /** Qual das três janelas da régua a chave abriu. */
  periodo: PeriodoDaLive;
  /** A chave do `?range=` (uma das três da régua). */
  chave: string;
  /** A régua editável (Configurações → Metas e orçamento). */
  cfg: CampanhaDaLive;
  /** O turno da live (`expedienteAtual`) — o mesmo da Fila. */
  expediente: Expediente;
  /** O recorte do painel, EXATAMENTE o da antiga `/live` (`rangeDoPainelLive`, sem o clamp do 1º dado). */
  rangePainel: RangeDoPainelLive;
  /** `montarPainelLive` (congelado), com esse recorte. */
  painel: PainelLive;
  /** `relatoriosDaLive` (congelado): os textos das tarefas. */
  relatorios: RelatorioDaLive[];
  /** Campanha da live · Captação · Pós-live, como links do Início. */
  subAtalhos: SubAtalhoDaLive[];
  /** Os links fixos do painel, já com o período (`comPeriodo`). */
  links: { filaDaLive: string };
}

/**
 * O painel da live como a antiga `/live` o calculava — as mesmas entradas
 * (`getData`, todos os eventos, a régua, o turno) e o mesmo recorte
 * (`rangeDoPainelLive(chave, hoje, cfg.periodo)`: período que ainda não começou =
 * o 1º dia, sem o clamp do 1º anúncio). Só leitura dos módulos congelados.
 */
export function montarModoLive(e: {
  data: DashboardData;
  eventos: LeadEvent[];
  cfg: CampanhaDaLive;
  expediente: Expediente;
  chave: string;
  periodo: PeriodoDaLive;
  hoje: string;
  agora: string;
}): ModoLive {
  const rangePainel = rangeDoPainelLive(e.chave, e.hoje, e.cfg.periodo);
  const painel = montarPainelLive({
    data: e.data,
    eventos: e.eventos,
    cfg: e.cfg,
    expediente: e.expediente,
    range: { de: rangePainel.de, ate: rangePainel.ate },
    hoje: e.hoje,
    agora: e.agora,
  });
  return {
    periodo: e.periodo,
    chave: e.chave,
    cfg: e.cfg,
    expediente: e.expediente,
    rangePainel,
    painel,
    relatorios: relatoriosDaLive(painel, e.cfg, e.hoje),
    subAtalhos: subAtalhosDaLive(e.cfg).map((s) => ({ ...s, href: comPeriodo("/", s.chave), atual: s.chave === e.chave })),
    links: { filaDaLive: comPeriodo("/fila#live", e.chave) },
  };
}

/** A trava de cobertura (`assessTrust`): afeta a verba que o painel da live mostra. */
const TRAVA_DA_VERBA = "cobertura-de-dias";

/**
 * Os alertas do modo live (C11): a saúde do dado, a atribuição, a trava
 * `cobertura-de-dias` (a verba do painel) e "nenhuma campanha casou" — que era
 * uma faixa no meio do painel e vai para o ⚠ (régua 4), só a partir do 1º dia da
 * régua (antes disso, campanha nenhuma é o esperado). As travas de CPL e custo
 * por reunião NÃO entram: a tela não mostra esses números (o painel imprime os
 * dele, sobre a verba da live).
 */
export function alertasDaLive(e: {
  data: DashboardData;
  /** O período resolvido pelo `pageRange` (C9) — o dos kpis. */
  range: DateRange | undefined;
  kpis: KpisDoPeriodo;
  live: Pick<ModoLive, "cfg" | "painel">;
  hoje: string;
}): Alerta[] {
  const { cfg, painel } = e.live;
  const nomes = cfg.linhas.map((l) => l.campanhas[0]).filter(Boolean);
  return [
    ...alertasDeConfianca(e.kpis.trust.travas.filter((t) => t.id === TRAVA_DA_VERBA)),
    ...alertasDeQualidade(dataQualityChecks(e.data)),
    ...alertasDeAtribuicao(e.data, e.range),
    ...(painel.semCampanhas && e.hoje >= cfg.periodo.de
      ? [
          {
            id: "live-sem-campanhas",
            nivel: "aviso" as const,
            titulo: "Nenhuma campanha do Gerenciador casou com os nomes da live",
            detalhe: `A verba e os custos do painel da live ficam zerados até alguma campanha casar${
              nomes.length ? ` (nomes esperados: ${nomes.join(", ")})` : ""
            }. Confira os nomes das campanhas na régua da live.`,
            cta: { label: "Conferir os nomes", href: "/configuracoes#campanha-live" },
          },
        ]
      : []),
  ];
}
