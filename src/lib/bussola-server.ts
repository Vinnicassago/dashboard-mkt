import "server-only";
import { getData, listAcoesEstado, listLeadEvents, listResumosSemanais } from "./data/store";
import { brandDef, type BrandDef } from "./brands";
import { pageRange } from "./page-range";
import { hojeEmBrasilia } from "./range";
import { kpisDoPeriodo } from "./kpis";
import { montarBussola, type Bussola } from "./bussola";
import { semanaDaAcao } from "./motor";
import { temLpNoPeriodo } from "./gargalo";
import { NAO_CLASSIFICADO, integrationStatus, resolveMetaBrands } from "./meta/config";
import { coberturaDeAnuncios, estadoDaFonte } from "./sincronizacao";
import { getComercial, getRoboLeads } from "./robo/client";
import { dataQualityChecks, type DateRange } from "./metrics";
import { alertasDeAtribuicao, alertasDeConfianca, alertasDeQualidade, type Alerta } from "./alertas";
import type { AcaoEstado, DashboardData, ResumoSemanal } from "./types";

/** Sem `?range=`, a Bússola olha a semana: 7 dias contra os 7 anteriores. */
export const PERIODO_PADRAO_DA_BUSSOLA = "7d";

export interface BussolaCarregada extends Bussola {
  brand: BrandDef;
  data: DashboardData;
  range: DateRange | undefined;
  rangeKey: string;
  hoje: string;
  agora: string;
  /** Os alertas do período (para o "⚠ N" do cabeçalho). */
  alertas: Alerta[];
  /** O robô está ligado e a leitura dele QUEBROU — a fila e as ações estão incompletas. */
  roboErro: boolean;
  /** Últimas decisões sobre ações (qualquer semana), mais recentes primeiro. */
  historicoAcoes: AcaoEstado[];
  /** Os resumos semanais da IA, mais recente primeiro (até 12). */
  resumos: ResumoSemanal[];
}

/**
 * Carrega tudo o que a Bússola precisa de fora (store, robô, syncs, estados) e
 * entrega a visão montada pela função pura. É o MESMO caminho da home e do
 * resumo semanal: a IA lê o que a tela mostra.
 */
export async function carregarBussola(
  brandSlug: string,
  rangeKeyParam?: string,
  opts: {
    /** Semana (segunda, AAAA-MM-DD) cujos estados de ação valem — o resumo semanal lê a semana que resume. */
    semanaDosEstados?: string;
  } = {},
): Promise<BussolaCarregada> {
  const brand = brandDef(brandSlug);
  const data = await getData(brand.slug);
  const { range, rangeKey } = pageRange(data, rangeKeyParam ?? PERIODO_PADRAO_DA_BUSSOLA);
  const agoraDate = new Date();
  const agora = agoraDate.toISOString();
  const hoje = hojeEmBrasilia(agoraDate);
  const status = integrationStatus();
  const semanaDosEstados = opts.semanaDosEstados ?? semanaDaAcao(hoje);

  const [brandRules, cobertura, eventos, comercial, convites, ads, estados, historicoAcoes, resumos, semMarca] =
    await Promise.all([
      resolveMetaBrands(),
      coberturaDeAnuncios(brand.slug),
      listLeadEvents({ brand: brand.slug, limit: 0 }),
      getComercial(),
      getRoboLeads(),
      estadoDaFonte("ads", brand.slug),
      listAcoesEstado({ brand: brand.slug, semana: semanaDosEstados, limit: 0 }),
      listAcoesEstado({ brand: brand.slug, limit: 30 }),
      listResumosSemanais({ brand: brand.slug, limit: 12 }),
      // Gasto que nenhuma regra de marca reivindica (30 dias) — a regra D2.
      status.ads ? getData(NAO_CLASSIFICADO) : null,
    ]);

  const corte = new Date(agoraDate.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const gastoSemMarca = (semMarca?.adDaily ?? []).filter((r) => r.date >= corte).reduce((s, r) => s + r.spend, 0);

  // A comparação com o robô só roda no período "campanha inteira": a view do
  // robô é vitalícia e sem marca.
  const roboReunioes = comercial.kpis?.reunioes_realizadas ?? null;
  const kpis = kpisDoPeriodo(data, range, {
    brandRules,
    cobertura,
    roboReunioes: range ? null : roboReunioes,
    comparar: true,
    hoje,
    agora,
  });
  // O acumulado da campanha com o MESMO contexto (marca, cobertura, robô): é o
  // número que Dinheiro imprime em "Campanha", com os mesmos "≥"/"≤".
  const campanha = range ? kpisDoPeriodo(data, undefined, { brandRules, cobertura, roboReunioes, hoje, agora }) : kpis;

  // Robô DESLIGADO (sem credencial, ou desativado em Ajustes) é ausência, não
  // falha: as filas dele não existem. Leitura que QUEBROU é outra coisa.
  const roboLigado = comercial.falha?.tipo !== "desligado" || convites.falha?.tipo !== "desligado";
  const roboErro = comercial.falha?.tipo === "erro" || convites.falha?.tipo === "erro";

  const bussola = montarBussola({
    data,
    range,
    kpis,
    campanha,
    cobertura,
    eventos,
    robo: roboLigado ? { convites: convites.rows, comercial: comercial.rows } : undefined,
    fontes: { adsFalha: ads.falha, gastoSemMarca },
    estados,
    agora,
    hoje,
  });

  const alertas: Alerta[] = [
    ...alertasDeConfianca(kpis.trust.travas),
    ...alertasDeQualidade(dataQualityChecks(data)),
    ...alertasDeAtribuicao(data, range),
    // A LP registrava e parou: no período não há linha dela — as duas primeiras
    // transições saem de "Onde trava" (não viram "0%"), e o aviso diz por quê.
    ...(data.lpDaily.length > 0 && range && !temLpNoPeriodo(data, range)
      ? [
          {
            id: "lp-sem-dado",
            nivel: "aviso" as const,
            titulo: "A landing page não registrou visitas no período",
            detalhe:
              "Há histórico da landing page, mas nenhuma linha neste período: o rastreio (/api/track) pode ter parado — chave trocada, script fora da página. Visita → lead fica fora do funil até voltar.",
            cta: { label: "Ver integrações", href: "/config#integracoes" },
          },
        ]
      : []),
    ...(roboErro
      ? [
          {
            id: "robo-leitura",
            nivel: "falha" as const,
            titulo: "Não consegui ler o robô nem o atendimento",
            detalhe:
              "Sem eles, quem espera o 1º contato pelo robô não aparece nas ações — e ausência de leitura não é o mesmo que ninguém esperando. Se o robô está parado, desative-o em Ajustes.",
            cta: { label: "Ver integrações", href: "/config#integracoes" },
          },
        ]
      : []),
  ];

  return { ...bussola, brand, data, range, rangeKey, hoje, agora, alertas, roboErro, historicoAcoes, resumos };
}
