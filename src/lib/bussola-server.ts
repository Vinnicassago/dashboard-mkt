import "server-only";
import { getData, listLeadEvents, listResumosSemanais } from "./data/store";
import { brandDef, type BrandDef } from "./brands";
import { pageRange } from "./page-range";
import { PERIODO_PADRAO_DO_INICIO, hojeEmBrasilia } from "./range";
import { kpisDoPeriodo, type KpisDoPeriodo } from "./kpis";
import { alertasDaLive, alertasDoInicio, montarBussola, montarModoLive, type ModoLive } from "./bussola";
import type { Inicio } from "./inicio";
import { periodoDaLive } from "./atalho-live";
import { campanhaDaLive } from "./live-server";
import type { CampanhaDaLive } from "./live";
import { contextoDeMarcas } from "./meta/config";
import { montarFilaDaLive } from "./fila-live";
import { expedienteAtual } from "./atendimento-server";
import { coberturaDeAnuncios } from "./sincronizacao";
import { estadoDoRoboAgora, type EstadoDoRobo } from "./robo/estado";
import type { DateRange } from "./metrics";
import type { Alerta } from "./alertas";
import type { Expediente } from "./turno";
import type { DashboardData, LeadEvent, ResumoSemanal } from "./types";

/** Sem `?range=`, o Início olha a semana: 7 dias contra os 7 anteriores. */
export const PERIODO_PADRAO_DA_BUSSOLA = PERIODO_PADRAO_DO_INICIO;

interface CarregadoComum {
  brand: BrandDef;
  /** A base da marca (com contato: fica no servidor — nunca vai inteira a um componente client). */
  data: DashboardData;
  /** O período resolvido (`pageRange`, C9): período que ainda não começou = o 1º dia, vazio. */
  range: DateRange | undefined;
  rangeKey: string;
  /** O período pedido ainda não começou (`range.from > hoje`). */
  naoComecou: boolean;
  hoje: string;
  agora: string;
  /** Os KPIs do período, com o contexto (marcas, cobertura) e `comparar` — os da tela e da IA. */
  kpis: KpisDoPeriodo;
  /** Todos os eventos da marca (`limit: 0`) — tentativas, reabertos. Têm o nome do lead: só servidor. */
  eventos: LeadEvent[];
  /** O turno da live (`expedienteAtual`). */
  expediente: Expediente;
  /** O robô (`estadoDoRoboAgora`, inteiro): o MESMO objeto da Fila e de Leads. */
  robo: EstadoDoRobo;
  /** A régua da live (`campanhaDaLive`, editável). */
  cfgDaLive: CampanhaDaLive;
  /** Os alertas do período (para o "⚠ N" do cabeçalho). */
  alertas: Alerta[];
  /** Os resumos semanais da IA, mais recente primeiro (até 12). */
  resumos: ResumoSemanal[];
}

/**
 * O que o Início carrega: no modo normal, os quatro blocos (`inicio`); no modo
 * live (a chave do período é uma das três da régua), o painel da live (`live`).
 */
export type BussolaCarregada =
  | (CarregadoComum & { modo: "normal"; inicio: Inicio; live: null })
  | (CarregadoComum & { modo: "live"; inicio: null; live: ModoLive });

/**
 * Carrega tudo o que o Início precisa de fora (store, syncs, robô, turno, régua
 * da live) e entrega a visão montada pelas funções puras de `bussola.ts`. É o
 * MESMO caminho da home e do resumo semanal: a IA lê o que a tela mostra.
 *
 * O robô entra pelo store: os fatos que o sync gravou no lead e o estado da
 * leitura (`estadoDoRoboAgora`, o MESMO objeto da /fila) — nunca o banco do robô
 * no render. A falha da leitura é o alerta `sync-robo` do cabeçalho.
 *
 * Funciona sem sessão nem cookie (o cron não tem usuário): permissões ficam na página.
 */
export async function carregarBussola(
  brandSlug: string,
  rangeKeyParam?: string,
  opts: {
    /** A régua da live já lida (a página lê antes, para o redirect do comercial). */
    cfgDaLive?: CampanhaDaLive;
    /** Nunca o modo live — o resumo semanal lê a semana fechada, mesmo que ela coincida com uma janela da régua. */
    semModoLive?: boolean;
  } = {},
): Promise<BussolaCarregada> {
  const brand = brandDef(brandSlug);
  const agoraDate = new Date();
  const agora = agoraDate.toISOString();
  const hoje = hojeEmBrasilia(agoraDate);

  const [data, cfgDaLive, { brandRules, campanhasDaConta }, cobertura, eventos, robo, expediente, resumos] = await Promise.all([
    getData(brand.slug),
    opts.cfgDaLive ?? campanhaDaLive(),
    contextoDeMarcas(),
    coberturaDeAnuncios(brand.slug),
    listLeadEvents({ brand: brand.slug, limit: 0 }),
    estadoDoRoboAgora(brand.slug, agoraDate),
    expedienteAtual(),
    listResumosSemanais({ brand: brand.slug, limit: 12 }),
  ]);
  const { range, rangeKey, naoComecou } = pageRange(data, rangeKeyParam ?? PERIODO_PADRAO_DA_BUSSOLA, hoje);

  // A trava "fontes divergem" (reuniões do atendimento × do painel) fica dormente:
  // sem fonte de reuniões do atendimento (era `vw_robo_comercial_kpis`); volta quando
  // o Calendly entrar. O painel não lê o banco do robô no render (F3-D18).
  const roboReunioes = null;
  const kpis = kpisDoPeriodo(data, range, {
    brandRules,
    campanhasDaConta,
    cobertura,
    roboReunioes,
    // Período que ainda não começou (C9: o 1º dia, vazio) não tem "anterior": o dia
    // antes dele é HOJE, parcial, e a seta mostraria uma queda que não aconteceu.
    comparar: !naoComecou,
    hoje,
    agora,
  });
  const comum = { brand, data, range, rangeKey, naoComecou, hoje, agora, kpis, eventos, expediente, robo, cfgDaLive, resumos };

  // O modo live casa SÓ pela chave (sem data): depois do fim as três chaves continuam abrindo o painel.
  const periodo = brand.type !== "awareness" && !opts.semModoLive ? periodoDaLive(rangeKeyParam, cfgDaLive) : null;
  if (periodo && rangeKeyParam) {
    const live = montarModoLive({ data, eventos, cfg: cfgDaLive, expediente, chave: rangeKeyParam, periodo, hoje, agora });
    return { ...comum, modo: "live", inicio: null, live, alertas: alertasDaLive({ data, range, kpis, live, hoje }) };
  }

  const { inicio } = montarBussola({
    data,
    range,
    rangeKey,
    kpis,
    eventos,
    // Robô DESLIGADO (sem credencial, desativado, ou outra marca) é ausência, não
    // falha: o processo antigo volta inteiro (`montarInicio` lê `robo.ligado`).
    robo,
    cobertura,
    expediente,
    // Os inscritos da live (A e B): a frase da live e o "esperando" da Fila.
    filaLive: montarFilaDaLive(data.leads, eventos, agora, expediente),
    agora,
    hoje,
  });
  return { ...comum, modo: "normal", inicio, live: null, alertas: alertasDoInicio({ data, range, kpis, hoje }) };
}
