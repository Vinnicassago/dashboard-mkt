/**
 * A Bússola montada — a função pura da home (exigência do ADR-03: cada tela tem
 * um `montarVisao` sem I/O, para o teste de consistência e para o resumo
 * semanal lerem exatamente o que a tela mostra).
 *
 * Cinco blocos, e só cinco (regra do CLAUDE.md: bloco novo = tirar um):
 *   1. PLACAR — reuniões agendadas contra a meta, gargalo, comparecimento;
 *   2. MOTORES — investimento (ritmo), CPL e leads, cada um com meta e Δ;
 *   3. ONDE TRAVA — as transições com dono, taxa, referência e n;
 *   4. AÇÕES — o motor v2, com estado por semana;
 *   5. RODAPÉ — o resumo semanal da IA e os links.
 *
 * Quem carrega o que vem de fora (robô, syncs, estados) é `bussola-server.ts`.
 */

import { gargalo, transicoesDoFunil, type Gargalo, type Transicao } from "./gargalo";
import { kpisDoPeriodo, periodoDaRegua, reguaDoPeriodo, serieSemanal, type KpisDoPeriodo, type LinhaDaRegua, type PontoSemanal } from "./kpis";
import { motorDeAcoes, type Acao, type EntradaMotor } from "./motor";
import { montarPlacar, type Placar } from "./placar";
import { SEMANAS_POR_MES, metaVigente } from "./metas";
import type { DateRange } from "./metrics";
import type { DashboardData } from "./types";

export interface EntradaBussola extends Omit<EntradaMotor, "kpis"> {
  data: DashboardData;
  range: DateRange | undefined;
  /** Os KPIs do período, já com `comparar` (o Δ dos motores). */
  kpis: KpisDoPeriodo;
  /**
   * O acumulado da campanha (`kpisDoPeriodo(data, undefined, …)`) calculado com
   * as MESMAS opções do período (regras de marca, cobertura do sync, robô) —
   * senão o "Campanha:" do placar sai com "≥"/"≤" diferentes dos de Dinheiro.
   * Ausente (testes), calcula-se aqui sem contexto.
   */
  campanha?: KpisDoPeriodo;
}

export interface Bussola {
  kpis: KpisDoPeriodo;
  /** `kpisDoPeriodo(data, undefined)`: o acumulado da campanha, para o placar. */
  campanha: KpisDoPeriodo;
  regua: Map<string, LinhaDaRegua>;
  placar: Placar;
  transicoes: Transicao[];
  gargalo: Gargalo | null;
  acoes: Acao[];
  serie: PontoSemanal[];
}

export function montarBussola(e: EntradaBussola): Bussola {
  const { data, range, kpis } = e;
  const campanha = e.campanha ?? (range ? kpisDoPeriodo(data, undefined, { hoje: e.hoje, agora: e.agora }) : kpis);
  // A linha tracejada do minigráfico SEMANAL é a meta por semana, nunca o alvo
  // somado do período (30 dias → 30, que achatava toda barra).
  const metaSemana = metaVigente(data.metas, "reunioes_agendadas", e.hoje);
  const alvoSemanal =
    metaSemana?.alvo != null ? (metaSemana.periodo === "mes" ? metaSemana.alvo / SEMANAS_POR_MES : metaSemana.alvo) : undefined;
  const regua = new Map(reguaDoPeriodo(kpis, data, range, e.hoje).map((l) => [l.metrica, l]));
  const transicoes = transicoesDoFunil(data, range, kpis, { agora: e.agora, hoje: e.hoje });
  // "Campanha inteira" vira um período concreto (do primeiro dado até hoje): é
  // ele que divide o impacto em semanas.
  const g = gargalo(transicoes, periodoDaRegua(data, range, e.hoje));
  return {
    kpis,
    campanha,
    regua,
    placar: montarPlacar({ kpis, campanha, regua, gargalo: g, range, alvoSemanal }),
    transicoes,
    gargalo: g,
    acoes: motorDeAcoes(e),
    serie: serieSemanal(data, e.hoje, 10),
  };
}
