/**
 * A CASCATA — do anúncio à venda, os quatro sistemas na mesma coluna.
 *
 * O problema que ela resolve é literalmente a queixa que originou o redesenho:
 * as etapas da campanha existem, são medidas, e vivem em telas separadas que
 * nunca somam. Impressões em /trafego, visitas em /funil, leads em /leads,
 * conversas em /robo, reuniões em /comercial — e nenhuma tela mostra a coluna
 * inteira, então ninguém vê onde o dinheiro para.
 *
 * Três decisões que fazem a leitura funcionar:
 *
 * 1. DUAS ÂNCORAS. Os degraus do topo medem % das impressões; a partir de LEADS,
 *    Leads = 100%. Com uma âncora só, oito linhas seguidas imprimem "0,0% do
 *    topo" — o que é mentira por arredondamento, não informação.
 *
 * 2. SELO DE FONTE em cada degrau, e junta tracejada onde o dado troca de
 *    sistema. Quando dois números não batem, saber que vieram de bancos
 *    diferentes é metade do diagnóstico.
 *
 * 3. CLIQUES NÃO É DEGRAU. `meta/ads.ts` faz `inline_link_clicks || clicks`:
 *    nos conjuntos de descoberta (posts impulsionados, sem link) o inline é 0 e
 *    o painel conta curtida, comentário e toque no perfil como clique. Somar
 *    duas definições incompatíveis e chamar de etapa produzia a maior "perda"
 *    do funil, que não existe.
 *
 * Função PURA: recebe os números dos quatro sistemas já carregados.
 */

import { filterAds, filterLeads, countMeetings, countAttended, countClients } from "./metrics";
import type { DateRange } from "./metrics";
import type { DashboardData } from "./types";

// ---------------------------------------------------------------- vocabulário

export type Fonte = "meta" | "lp" | "crm" | "robo" | "comercial";
export type Dono = "MKT" | "BOT" | "COM";

export const FONTE_META: Record<Fonte, { label: string; sistema: string }> = {
  meta: { label: "Meta Ads", sistema: "Meta" },
  lp: { label: "Landing page", sistema: "LP" },
  crm: { label: "Painel", sistema: "Painel" },
  robo: { label: "Robô (WhatsApp)", sistema: "Robô" },
  // Mesmo banco do robô, mas outra mesa: quem age aqui é o especialista, não o
  // bot. Rotular de "Robô" faria o degrau parecer automático quando ele é o
  // ponto do funil que mais depende de alguém pegar o telefone.
  comercial: { label: "Atendimento", sistema: "Atendimento" },
};

export interface Degrau {
  key: string;
  label: string;
  /** `null` = não dá para afirmar (sem leitura, ou fontes divergem). */
  valor: number | null;
  fonte: Fonte;
  /** Conversão a partir do degrau anterior (0–1). */
  daAnterior?: number;
  /** Fração da âncora vigente (0–1). */
  daAncora?: number;
  /** Este degrau reinicia a contagem percentual (vira 100%). */
  ehAncora?: boolean;
  /** O dado troca de sistema ANTES deste degrau — junta tracejada. */
  trocaDeSistema?: boolean;
  /** Quanto da verba de conversão foi gasto por unidade que chegou aqui. */
  custoUnitario?: number;
  /** Pessoas perdidas em relação ao degrau anterior. */
  perda?: number;
  /** De quem é a ação nesta junta. */
  dono?: Dono;
  /** Quantos estão parados AQUI agora — o que dá para recuperar. */
  parados?: number;
  /** Ressalva colada ao degrau. */
  nota?: string;
}

/**
 * Versão curta da cascata, para a Visão Geral.
 *
 * Onze degraus com selo de fonte, custo unitário e nota de rodapé é peça de
 * consulta: o gestor lê os três primeiros e desiste antes de chegar no degrau
 * onde está o problema. Aqui ficam a âncora, os degraus onde há gente parada e
 * o fim do funil — as taxas são RECALCULADAS entre os que sobraram, senão o
 * percentual apontaria para um degrau que não está mais na tela.
 *
 * A versão completa continua em /jornada.
 */
export function resumirCascata(degraus: Degrau[]): Degrau[] {
  const manter = degraus.filter(
    (d, i) =>
      i === 0 ||
      d.ehAncora ||
      (d.parados ?? 0) > 0 ||
      i === degraus.length - 1 ||
      d.valor === null,
  );

  return manter.map((d, i) => {
    if (i === 0) return { ...d, daAnterior: undefined, perda: undefined };
    const ant = manter[i - 1];
    const podeCalcular = d.valor != null && ant.valor != null && ant.valor > 0;
    return {
      ...d,
      // Sem trocaDeSistema no resumo: com degraus omitidos, a junta deixaria de
      // marcar uma fronteira real e viraria enfeite.
      trocaDeSistema: false,
      daAnterior: podeCalcular ? d.valor! / ant.valor! : undefined,
      perda: podeCalcular ? Math.max(0, ant.valor! - d.valor!) : undefined,
    };
  });
}

/** Coisa que parece perda e não é — metade da resposta a "para onde olhar". */
export interface NaoAgir {
  titulo: string;
  detalhe: string;
}

export interface CascataResult {
  degraus: Degrau[];
  naoAgir: NaoAgir[];
  /** Verba de conversão do período — o denominador de todo custo unitário. */
  investimentoConversao: number;
  /** Número da Meta que NÃO entra em nenhuma taxa. */
  conversoesPixel: number;
}

// ---------------------------------------------------------------- entradas

export interface CascataRobo {
  conversas: number;
  responderam: number;
  convidados: number;
  transferidos: number;
  /** Parados esperando responder ao convite. */
  convitePendente: number;
}

export interface CascataComercial {
  abordados: number;
  reunioesRealizadas: number;
  negociosFechados: number;
  /** Transferidos que ainda não receberam o primeiro contato. */
  aguardandoAbordagem: number;
}

export interface CascataInput {
  data: DashboardData;
  range?: DateRange;
  /** `null` quando o robô está desligado ou a leitura falhou. */
  robo: CascataRobo | null;
  comercial: CascataComercial | null;
  /** Verba de conversão — vem de `objectiveBreakdown`, não do gasto total. */
  investimentoConversao: number;
}

// ---------------------------------------------------------------- montagem

const div = (a: number, b: number) => (b > 0 ? a / b : 0);

export function montarCascata(input: CascataInput): CascataResult {
  const { data, range, robo, comercial } = input;
  const ads = filterAds(data.adDaily, range);
  const leads = filterLeads(data.leads, range);
  const lp = (data.lpDaily ?? []).filter(
    (r) => !range || (r.date >= range.from && r.date <= range.to),
  );

  const impressoes = ads.reduce((s, r) => s + r.impressions, 0);
  const cliquesBrutos = ads.reduce((s, r) => s + r.clicks, 0);
  const conversoesPixel = ads.reduce((s, r) => s + (r.leads ?? 0), 0);
  const visitas = lp.reduce((s, r) => s + r.visits, 0);
  const ctaCliques = lp.reduce((s, r) => s + r.clicks, 0);
  const envios = lp.reduce((s, r) => s + r.formSubmits, 0);

  const leadCount = leads.length;
  const reunioesPainel = countMeetings(leads);
  const compareceuPainel = countAttended(leads);
  const clientesPainel = countClients(leads);

  const verba = input.investimentoConversao;

  const degraus: Degrau[] = [];
  const push = (d: Degrau) => degraus.push(d);

  /** Custo por unidade que chegou até aqui. */
  const custo = (v: number | null) => (v && v > 0 ? verba / v : undefined);

  // ---- topo: âncora nas impressões -------------------------------------
  push({
    key: "impressoes",
    label: "Impressões",
    valor: impressoes,
    fonte: "meta",
    ehAncora: true,
    daAncora: 1,
  });

  if (visitas > 0) {
    push({
      key: "visitas",
      label: "Visitas na landing page",
      valor: visitas,
      fonte: "lp",
      trocaDeSistema: true,
      daAnterior: div(visitas, impressoes),
      daAncora: div(visitas, impressoes),
      custoUnitario: custo(visitas),
      dono: "MKT",
    });
    push({
      key: "envios",
      label: "Envios de formulário",
      valor: envios,
      fonte: "lp",
      daAnterior: div(envios, visitas),
      daAncora: div(envios, impressoes),
      nota: "eventos, não pessoas — um mesmo visitante pode enviar duas vezes",
    });
  }

  // ---- LEADS: a segunda âncora. Daqui para baixo, Leads = 100% ----------
  const antesDeLeads = visitas > 0 ? envios : impressoes;
  push({
    key: "leads",
    label: "Leads",
    valor: leadCount,
    fonte: "crm",
    trocaDeSistema: visitas > 0,
    ehAncora: true,
    daAnterior: div(leadCount, antesDeLeads),
    daAncora: 1,
    custoUnitario: custo(leadCount),
    perda: Math.max(0, antesDeLeads - leadCount),
    dono: "MKT",
    nota: "pessoas cadastradas — é este número que se chama “lead”",
  });

  // ---- robô ------------------------------------------------------------
  if (robo) {
    const seq: [string, string, number, Dono, number | undefined][] = [
      ["conversas", "Conversas no WhatsApp", robo.conversas, "MKT", undefined],
      ["responderam", "Responderam", robo.responderam, "BOT", undefined],
      ["convite", "Receberam convite", robo.convidados, "BOT", undefined],
      ["transferidos", "Transferidos ao especialista", robo.transferidos, "BOT", robo.convitePendente],
    ];
    let anterior = leadCount;
    for (const [key, label, valor, dono, parados] of seq) {
      push({
        key,
        label,
        valor,
        fonte: "robo",
        trocaDeSistema: key === "conversas",
        daAnterior: div(valor, anterior),
        daAncora: div(valor, leadCount),
        custoUnitario: custo(valor),
        perda: Math.max(0, anterior - valor),
        dono,
        parados: parados && parados > 0 ? parados : undefined,
      });
      anterior = valor;
    }
  }

  // ---- comercial -------------------------------------------------------
  if (comercial) {
    const anteriorCom = robo ? robo.transferidos : leadCount;
    push({
      key: "abordados",
      label: "Abordados pelo especialista",
      valor: comercial.abordados,
      fonte: "comercial",
      trocaDeSistema: true,
      daAnterior: div(comercial.abordados, anteriorCom),
      daAncora: div(comercial.abordados, leadCount),
      custoUnitario: custo(comercial.abordados),
      perda: Math.max(0, anteriorCom - comercial.abordados),
      dono: "COM",
      parados: comercial.aguardandoAbordagem > 0 ? comercial.aguardandoAbordagem : undefined,
      nota: comercial.abordados <= 1 ? "n=1 — não é uma taxa" : undefined,
    });

    /*
     * Reunião: dois sistemas afirmam sobre o MESMO fato. Quando discordam, o
     * degrau não escolhe um lado — mostra "—" e nomeia a divergência. Publicar
     * um dos dois números aqui seria escolher em silêncio.
     */
    const divergem =
      comercial.reunioesRealizadas > 0 && reunioesPainel === 0 && !range;
    push({
      key: "reuniao",
      label: "Reunião realizada",
      valor: divergem ? null : Math.max(comercial.reunioesRealizadas, compareceuPainel),
      fonte: "comercial",
      daAnterior: divergem ? undefined : div(comercial.reunioesRealizadas, comercial.abordados),
      daAncora: divergem ? undefined : div(comercial.reunioesRealizadas, leadCount),
      custoUnitario: divergem ? undefined : custo(comercial.reunioesRealizadas),
      dono: "COM",
      nota: divergem
        ? `o atendimento registra ${comercial.reunioesRealizadas} e o funil do painel conta ${reunioesPainel} — as fontes discordam`
        : undefined,
    });

    push({
      key: "negocio",
      label: "Negócio fechado",
      valor: divergem ? null : Math.max(comercial.negociosFechados, clientesPainel),
      fonte: "comercial",
      daAnterior: divergem ? undefined : div(comercial.negociosFechados, comercial.reunioesRealizadas),
      daAncora: divergem ? undefined : div(comercial.negociosFechados, leadCount),
      dono: "COM",
      nota: divergem ? "idem — e sem valor de carta registrado" : undefined,
    });
  } else {
    // Sem robô/comercial, o fundo do funil é o do painel.
    push({
      key: "reunioes",
      label: "Reuniões agendadas",
      valor: reunioesPainel,
      fonte: "crm",
      daAnterior: div(reunioesPainel, leadCount),
      daAncora: div(reunioesPainel, leadCount),
      custoUnitario: custo(reunioesPainel),
      perda: Math.max(0, leadCount - reunioesPainel),
      dono: "COM",
    });
    push({
      key: "compareceu",
      label: "Reunião realizada",
      valor: compareceuPainel,
      fonte: "crm",
      daAnterior: div(compareceuPainel, reunioesPainel),
      daAncora: div(compareceuPainel, leadCount),
      dono: "COM",
    });
    push({
      key: "clientes",
      label: "Clientes",
      valor: clientesPainel,
      fonte: "crm",
      daAnterior: div(clientesPainel, compareceuPainel),
      daAncora: div(clientesPainel, leadCount),
      dono: "COM",
    });
  }

  // ---- o que parece perda e não é --------------------------------------
  const naoAgir: NaoAgir[] = [];

  if (cliquesBrutos > 0 && visitas > 0 && cliquesBrutos > visitas * 1.5) {
    const descoberta = ads.filter((r) => r.objective && /ENGAGEMENT|AWARENESS|REACH|VIDEO/i.test(r.objective));
    naoAgir.push({
      titulo: `${Math.round(cliquesBrutos - visitas).toLocaleString("pt-BR")} “cliques” que não viraram visita`,
      detalhe:
        `A maior perda aparente do funil é artefato de medição, não gente perdida. Nos ${descoberta.length > 0 ? "conjuntos de descoberta" : "posts impulsionados"} — sem link para clicar — o painel conta curtida, comentário e toque no perfil como clique. Por isso “cliques” não é degrau desta cascata.`,
    });
  }

  if (visitas > 0 && envios > 0 && visitas > envios) {
    naoAgir.push({
      titulo: `${(visitas - envios).toLocaleString("pt-BR")} visitas que não preencheram`,
      detalhe:
        "A maior perda percentual, e a menos recuperável: são visitantes anônimos que já foram embora. Melhorar a landing page muda o tráfego futuro — não traz nenhum destes de volta.",
    });
  }

  if (ctaCliques > visitas && visitas > 0) {
    naoAgir.push({
      titulo: `${ctaCliques.toLocaleString("pt-BR")} cliques no CTA contra ${visitas.toLocaleString("pt-BR")} visitas`,
      detalhe: `Não é dado corrompido: são ${(ctaCliques / visitas).toFixed(2)} eventos por visita. Um contador de evento ao lado de um contador de sessão — não é etapa e não tem taxa.`,
    });
  }

  return { degraus, naoAgir, investimentoConversao: verba, conversoesPixel };
}
