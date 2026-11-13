/**
 * O INÍCIO (Fase 2, nov/26) — a home em quatro blocos, montada por UMA função
 * pura (exigência do ADR-03: a tela só carrega e renderiza; a IA lê o mesmo
 * objeto, sem a lista de pessoas):
 *
 *   1. CARTÕES — investimento em conversão (com o minigráfico diário), CPL, leads
 *      e reuniões agendadas, todos de `kpisDoPeriodo` (`mostrar`), e o custo por
 *      reunião pelo fato único (`fatoDoCustoPorReuniao`);
 *   2. LEADS CHEGANDO — leads do PAINEL por dia de Brasília (`diaDoLead`; nunca o
 *      Pixel) e os 8 mais recentes do período, saídos de `montarLinhasDeLeads`
 *      com a entrada de /leads (sem telefone, e-mail ou motivo de teste);
 *   3. ATENDIMENTO — o título com quem espera o comercial (`esperandoOComercial`,
 *      o número da Fila), o funil curto da COORTE do período (`funilDoAtendimento`
 *      = um RECORTE do funil do processo do Funil, `lib/funil-processo.ts`, pelas
 *      colunas `robo_*` lidas por `situacaoDoRobo`, nunca o banco do robô) e até
 *      três frases de AGORA, cada uma com o número do grupo da MESMA `montarFila`
 *      da /fila. `ondeTrava` (a manchete do Funil) vai junto só como DADO para a IA;
 *   4. RODAPÉ — Funil, Mídia e o último post da grade (`ultimoPostDaGrade` com
 *      `textoDoUltimoPost`, o MESMO texto do placar do Conteúdo; link para `/conteudo`).
 *
 * Os links já saem com o período (`comPeriodo`, idempotente: o componente pode
 * aplicá-lo de novo sem efeito). Quem carrega o que vem de fora (store, syncs,
 * robô, turno da live) é o servidor; aqui nada faz I/O.
 */

import { diaCoberto, type Intervalo } from "./cobertura";
import { textoDoUltimoPost } from "./conteudo-tela";
import { dica } from "./dicionario";
import type { Dono } from "./dono";
import { esperandoOComercial, FILA_ETAPAS, gruposDaFila, montarFila, type FilaEtapa, type FilaResult } from "./fila";
import type { ItemDaFilaLive } from "./fila-live";
import { formatInt, formatarEspera } from "./format";
import {
  RECORTE_DO_INICIO,
  dicaDoRecorteDoRobo,
  funilDoProcesso,
  linhaDaLeituraParada,
  recortarProcesso,
  recorteDoFunil,
  type ForaDoRobo,
  type FunilDoProcesso,
} from "./funil-processo";
import { diaDoLead } from "./horario-util";
import { fatoDoCustoPorReuniao, mostrar, type FatoDoCustoPorReuniao, type FormatoMedida, type KpisDoPeriodo, type Medida } from "./kpis";
import { montarLinhasDeLeads } from "./leads-vista";
import { bucketOfAd, dailySeries, filterAds, filterLeads, ultimoPostDaGrade, type DateRange } from "./metrics";
import { ondeTrava, resumoDaTrava, type ResumoDaTrava } from "./onde-trava";
import { comPeriodo } from "./range";
import {
  ROBO_INICIO,
  leituraDoRoboParada,
  reabertosNoPainel,
  reabertosPorLead,
  semMensagemDoRobo,
  type RoboAgora,
} from "./robo/situacao";
import type { Expediente } from "./turno";
import type { DashboardData, LeadEvent } from "./types";

// ---------------------------------------------------------------- entrada

export interface EntradaInicio {
  data: DashboardData;
  /** O período resolvido (`pageRange`); `undefined` = a campanha inteira. */
  range: DateRange | undefined;
  /** A chave do `?range=` — os links levam o período (`comPeriodo`). */
  rangeKey: string;
  /** Os KPIs do período, com `comparar` (o Δ dos cartões) e o contexto do carregador. */
  kpis: KpisDoPeriodo;
  /** O histórico da marca inteiro (`listLeadEvents({ limit: 0 })`): tentativas e reabertos. */
  eventos: LeadEvent[];
  /** O robô (`estadoDoRoboAgora`, inteiro) — o MESMO da Fila e de Leads. Ausente ou desligado = sem o robô. */
  robo?: RoboAgora;
  /** Dias cobertos por syncs de anúncio bem-sucedidos (ADR-06). */
  cobertura?: Intervalo[];
  /** O turno da live (`expedienteAtual`): a coluna Atendimento dos A e B, como em /leads. */
  expediente?: Expediente;
  /** A Fila da live (`montarFilaDaLive`, só leitura) — a mesma entrada da /fila. */
  filaLive: readonly ItemDaFilaLive[];
  /** "Agora" (ISO). */
  agora: string;
  /** Hoje em Brasília (AAAA-MM-DD). */
  hoje: string;
}

// ---------------------------------------------------------------- saída

/** Um cartão: a `Medida` de `kpisDoPeriodo` + o texto exibido (`mostrar`) + o ⓘ. */
export type CartaoDoInicio = Medida & {
  /** `mostrar(medida, formato)`: "—" quando não se sustenta, "≥"/"≤" quando é piso/teto. */
  texto: string;
  /** O ⓘ do cartão (o que era a linha de dica embaixo do número). */
  dica: string;
};

export interface CartoesDoInicio {
  investimento: CartaoDoInicio;
  cpl: CartaoDoInicio;
  leads: CartaoDoInicio;
  /** Reuniões AGENDADAS no período (a north star, pela data do agendamento). */
  reunioes: CartaoDoInicio;
  leadsConversao: number;
  leadsOrganicos: number;
  temDescoberta: boolean;
  /** O fato único do custo por reunião (o mesmo da Mídia). */
  custo: FatoDoCustoPorReuniao;
  /**
   * A linha do cartão Reuniões: "R$ 300,00 por reunião de conversão" ou o fato no
   * cartão ("R$ 430 investidos · 1 reunião de conversão", `fatoNoCartao`).
   */
  custoReuniao: string;
  /** Gasto de conversão por dia até ontem (C3); `null` = sem minigráfico. */
  sparkInvestimento: number[] | null;
}

export interface DiaDeLeads {
  /** AAAA-MM-DD (Brasília). */
  date: string;
  /** Leads do painel que entraram no dia (com teste e duplicado, como o cartão). */
  leads: number;
  /** Nenhuma linha de anúncio de CONVERSÃO no dia e o dia coberto por sync (a campanha estava parada). */
  pausado: boolean;
}

/** Uma pessoa da lista — SEM telefone, e-mail ou motivo de teste (LGPD: vai para o cliente). */
export interface LeadDaHome {
  id: string;
  nome: string;
  /** ISO da entrada. */
  criadoEm: string;
  /** "agora" (< 1 min) ou "há 2 h" (`formatarEspera`). */
  ha: string;
  /** A ficha (`/leads/<id>`), com o período. */
  href: string;
  /** `origem.anuncio`, encurtado; sem origem = "—". */
  origem: string;
  /** A coluna "Atendimento" de Leads (`atendimentoAgora`); `null` = nada a fazer ("—"). */
  atendimento: { texto: string; href?: string; atrasado: boolean } | null;
}

export interface LeadsChegando {
  /**
   * "Leads · último há 2 h" / "Leads · nenhum no período" (o período sem lead
   * nenhum) / "Leads · só teste ou duplicado" (há lead, mas a lista tira todos) — a
   * hora em UMA unidade (`haQuantoNoTitulo`): os dois títulos da linha cabem nas 10
   * palavras (C13).
   */
  titulo: string;
  /** O ⓘ do título. */
  dica: string;
  /** Todo dia do período (Σ leads = `kpis.leads.valor`). */
  dias: DiaDeLeads[];
  /** Trechos seguidos de dias pausados (a faixa cinza). */
  faixasPausa: { from: string; to: string }[];
  /** A entrada do mais recente da LISTA (a mesma população: sem teste nem cópia de duplicado). */
  ultimoEm: string | null;
  /** Os 8 mais recentes do período, do mais novo ao mais antigo. */
  ultimos: LeadDaHome[];
}

export type DegrauCurtoId = "leads" | "com-robo" | "primeira-msg" | "responderam" | "aceitaram" | "agendaram" | "realizadas";

export interface DegrauCurto {
  id: DegrauCurtoId;
  rotulo: string;
  valor: number;
  /** O número pronto: "12", ou "≥ 12" quando a leitura do robô está parada. */
  texto: string;
  /** Fração sobre a base (sempre ≤ 1); `null` = sem amostra (base < `AMOSTRA_MINIMA`), recorte, ou leitura parada. */
  taxa: number | null;
  /** Sobre quem a taxa é: o degrau anterior, ou os leads (ramo paralelo, "Agendaram"). */
  base: "anterior" | "leads" | null;
  /** Contagem que só pode crescer: a leitura do robô está parada (o número real é maior ou igual). */
  piso: boolean;
  dono: Dono;
  /** O degrau sai das colunas `robo_*` (o que o sync do robô gravou no lead). */
  doRobo: boolean;
}

// Movidos para o funil do processo (Fase 3): o Início os reexporta (nenhum leitor muda).
export { dicaDoRecorteDoRobo, recorteDoFunil };
export type { ForaDoRobo };

export interface FunilDoAtendimento {
  /** O funil mostra o trecho do robô: ligado e o período não é todo anterior a ele. */
  comRobo: boolean;
  degraus: DegrauCurto[];
  /** Leads do período (`kpis.leads.valor`). */
  leads: number;
  /** Desses, quantos passam pelo robô ("Com o robô"); 0 sem o robô. */
  noRobo: number;
  /** Os leads da coorte que ficaram fora de "Com o robô", por motivo (zeros sem o trecho do robô). */
  fora: ForaDoRobo;
  /** A leitura do robô está parada ou falhando (`leituraDoRoboParada`). */
  parada: boolean;
}

export type FraseId = "live" | "sem-1a-msg" | FilaEtapa;

export interface FraseDoAtendimento {
  id: FraseId;
  /** "Resgate · 33 · 32 fora do prazo → Fila" — o título da página que o link abre. */
  texto: string;
  href: string;
  dono: Dono;
  /** O número da frase (o `total` do grupo, o tamanho da Fila da live, ou `semMensagemDoRobo`). */
  total: number;
  /** Os fora do prazo do grupo (só nos grupos da Fila). */
  foraDoPrazo?: number;
}

export interface AtendimentoDoInicio {
  roboLigado: boolean;
  /** "Atendimento · 5 esperando o comercial" / "Atendimento · ninguém esperando". */
  titulo: string;
  /** Pessoas esperando o comercial agora — `esperandoOComercial`, o número do título da Fila. */
  esperando: number;
  /** O ⓘ do título: o que é o funil (coorte) e o que são as frases (agora). */
  dica: string;
  /** O recorte do funil: "leads de 30/10 a 05/11" / "leads da campanha". */
  recorte: string;
  /** Leitura do robô parada/falhando: a 1ª linha do bloco ("Robô sem leitura desde 05/11 12:30 ⚠"). */
  leituraParada: { desde: string | null; texto: string } | null;
  funil: DegrauCurto[];
  /** O trecho do robô aparece no funil. */
  funilComRobo: boolean;
  /** Até 3, na ordem fixa. */
  frases: FraseDoAtendimento[];
  /** Sem frase nenhuma: "Nada esperando o comercial agora."; senão `null`. */
  vazio: string | null;
  /**
   * Onde trava (Fase 3, K14): a MESMA `ondeTrava` da manchete do Funil, sobre o MESMO
   * funil do processo do recorte acima. Só DADO, para a IA (`inicioParaIA`) — nenhuma
   * marca nem palavra na tela. Sempre um objeto (K8).
   */
  ondeTrava: ResumoDaTrava;
}

export interface RodapeDoInicio {
  /** `ultimoPostDaGrade` (histórico inteiro, dia de Brasília); `null` = nenhum post da grade. */
  diasDesdeUltimoPost: number | null;
  links: { id: "funil" | "midia" | "posts"; rotulo: string; href: string }[];
}

export interface Inicio {
  cartoes: CartoesDoInicio;
  leadsChegando: LeadsChegando;
  atendimento: AtendimentoDoInicio;
  rodape: RodapeDoInicio;
}

// ---------------------------------------------------------------- utilidades

const MIN_MS = 60_000;

function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diasEntre(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = somarDias(d, 1)) out.push(d);
  return out;
}

const DIA_VALIDO = /^\d{4}-\d{2}-\d{2}$/;
const dm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/** "agora" (menos de 1 min, sem arredondar: 45 s ainda é "agora") ou "há 2 h". */
export function haQuanto(iso: string, agora: string): string {
  const ms = Date.parse(agora) - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return ms < MIN_MS ? "agora" : `há ${formatarEspera(ms / 3_600_000)}`;
}

/**
 * O "há quanto" do TÍTULO, numa unidade só (o título tem orçamento de palavras;
 * a lista mostra o tempo inteiro, `haQuanto`): "agora" (< 1 min), "há 25 min",
 * "há 5 h" (5 h 59 min), "há 3 d". Parte do MESMO total arredondado de
 * `formatarEspera` (minutos abaixo de 24 h, horas acima) e só então corta para a
 * maior unidade — senão, na virada, a 1ª linha da lista dizia "há 1 h" e o título
 * "há 59 min" para a mesma pessoa.
 */
export function haQuantoNoTitulo(iso: string, agora: string): string {
  const ms = Date.parse(agora) - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  if (ms < MIN_MS) return "agora";
  const min = Math.round(ms / MIN_MS);
  if (min < 60) return `há ${min} min`;
  if (min < 24 * 60) return `há ${Math.floor(min / 60)} h`;
  return `há ${Math.floor(Math.round(ms / 3_600_000) / 24)} d`;
}

function curto(s: string, max = 40): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function trechos<T extends { date: string }>(dias: readonly T[], marca: (d: T) => boolean): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const d of dias) {
    if (!marca(d)) continue;
    const ultimo = out.at(-1);
    if (ultimo && somarDias(ultimo.to, 1) === d.date) ultimo.to = d.date;
    else out.push({ from: d.date, to: d.date });
  }
  return out;
}


// ---------------------------------------------------------------- 1. cartões

/**
 * O minigráfico do investimento (C3): gasto de CONVERSÃO por dia, de `range.from`
 * (sem range, o 1º dia com linha) até `min(range.to, ontem)` — hoje é sempre
 * parcial. "Sem dados" é o `semDado` de `dailySeries` sem filtro de objetivo
 * (nenhuma linha de nenhum objetivo e o dia não coberto por sync, ADR-06). Os dias
 * "sem dados" do FIM (o atraso da Meta) são cortados; se sobra buraco no meio, a
 * linha desenharia uma queda falsa — sem minigráfico. Também sem ele com menos de
 * 3 pontos ou com o investimento piso/teto.
 */
export function sparkDoInvestimento(
  data: DashboardData,
  range: DateRange | undefined,
  kpis: KpisDoPeriodo,
  cobertura: Intervalo[] | undefined,
  hoje: string,
): number[] | null {
  if (kpis.investimentoConversao.confianca) return null;
  const ontem = somarDias(hoje, -1);
  const inicio = range?.from ?? data.adDaily.map((r) => r.date).sort()[0];
  const pedido = range?.to ?? ontem;
  const fim = pedido < ontem ? pedido : ontem;
  if (!inicio || inicio > fim) return null;
  const janela = { from: inicio, to: fim };
  const conversao = new Map<string, number>();
  for (const r of filterAds(data.adDaily, janela)) {
    if (bucketOfAd(r) === "conversao") conversao.set(r.date, (conversao.get(r.date) ?? 0) + r.spend);
  }
  const pontos = dailySeries(data, janela, cobertura, hoje).map((p) => ({ semDado: p.semDado, gasto: conversao.get(p.date) ?? 0 }));
  while (pontos.length > 0 && pontos.at(-1)!.semDado) pontos.pop();
  if (pontos.length < 3 || pontos.some((p) => p.semDado)) return null;
  return pontos.map((p) => p.gasto);
}

/**
 * O fato do custo por reunião NO CARTÃO: os MESMOS números de
 * `fatoDoCustoPorReuniao` (o investimento com o "≥"/"≤" dele e a parte das
 * reuniões, que sai do próprio fato), sem o "em conversão" depois de
 * "investidos" — o cartão do lado já diz "Investimento em conversão" com o mesmo
 * valor, e os quatro cartões cabem nas 25 palavras (C13). A Mídia, sem esse
 * vizinho, mostra o fato inteiro.
 */
export function fatoNoCartao(k: KpisDoPeriodo, custo: FatoDoCustoPorReuniao): string {
  const i = custo.fato.lastIndexOf(" · ");
  return `${mostrar(k.investimentoConversao, "moeda0")} investidos${i >= 0 ? custo.fato.slice(i) : ""}`;
}

/**
 * `naoComecou`: o período ainda não começou (C9: o 1º dia, vazio) — o cartão
 * não leva o `anterior`. O "período anterior" de um dia futuro é HOJE (parcial),
 * e a seta imprimiria uma queda de −100% que não aconteceu.
 */
function cartao(m: Medida, formato: FormatoMedida, d: string, naoComecou: boolean): CartaoDoInicio {
  const { anterior, ...resto } = m;
  return { ...resto, ...(naoComecou || anterior === undefined ? {} : { anterior }), texto: mostrar(m, formato), dica: d };
}

function cartoesDoInicio(e: EntradaInicio): CartoesDoInicio {
  const k = e.kpis;
  const nc = Boolean(e.range && e.range.from > e.hoje);
  const custo = fatoDoCustoPorReuniao(k);
  const spark = sparkDoInvestimento(e.data, e.range, k, e.cobertura, e.hoje);
  const conv = k.leadsConversao.valor;
  const org = k.leadsOrganicos.valor;
  const investimento = [
    dica("investimento_conversao"),
    k.temDescoberta ? `De ${mostrar(k.investimento, "moeda0")} no total; o resto foi descoberta.` : "",
    spark ? "A linha: o gasto de conversão por dia, até ontem." : "",
  ];
  return {
    investimento: cartao(k.investimentoConversao, "moeda0", investimento.filter(Boolean).join(" "), nc),
    cpl: cartao(k.cpl, "moeda", `${dica("cpl")} Sobre ${formatInt(conv)} ${conv === 1 ? "lead" : "leads"} de conversão.`, nc),
    leads: cartao(
      k.leads,
      "int",
      org > 0 ? `${dica("leads")} ${formatInt(conv)} de conversão · ${formatInt(org)} ${org === 1 ? "orgânico" : "orgânicos"}.` : dica("leads"),
      nc,
    ),
    reunioes: cartao(k.reunioesAgendadas, "int", `${dica("reunioes_agendadas")} ${dica("custo_por_reuniao")}`, nc),
    leadsConversao: conv,
    leadsOrganicos: org,
    temDescoberta: k.temDescoberta,
    custo,
    custoReuniao: custo.exibivel ? `${custo.valor} por reunião de conversão` : fatoNoCartao(k, custo),
    sparkInvestimento: spark,
  };
}

// ---------------------------------------------------------------- 2. leads chegando

/**
 * Leads do PAINEL por dia de Brasília (`diaDoLead`) em todo dia do período (sem
 * range: do 1º lead ou anúncio até hoje). A mesma população do cartão (com teste
 * e duplicado: um número por métrica), então Σ = `kpis.leads.valor`. Cinza só o
 * dia PAUSADO: sem linha de anúncio de conversão e coberto por sync (ADR-06: o que
 * não se sabe não vira pausa; o "≥" dos cartões carrega a cobertura). Dia depois
 * de hoje é futuro e dia antes da 1ª linha de anúncio da marca (de qualquer
 * objetivo) não existia: nunca pausados — a mesma régua de `dailySeries` (Mídia) e
 * das coortes do Funil.
 */
export function leadsPorDia(
  data: DashboardData,
  range: DateRange | undefined,
  cobertura: Intervalo[] | undefined,
  hoje: string,
): DiaDeLeads[] {
  const porDia = new Map<string, number>();
  for (const l of filterLeads(data.leads, range)) {
    const d = diaDoLead(l.createdAt);
    porDia.set(d, (porDia.get(d) ?? 0) + 1);
  }
  let from = range?.from;
  let to = range?.to;
  if (!range) {
    const dias = [...[...porDia.keys()].filter((d) => DIA_VALIDO.test(d)), ...data.adDaily.map((r) => r.date)].sort();
    from = dias[0];
    const ultimo = dias.at(-1);
    to = ultimo && ultimo > hoje ? ultimo : hoje;
  }
  if (!from || !to || !DIA_VALIDO.test(from) || !DIA_VALIDO.test(to) || from > to) return [];
  const comConversao = new Set(data.adDaily.filter((r) => bucketOfAd(r) === "conversao").map((r) => r.date));
  let primeiroDado: string | undefined;
  for (const r of data.adDaily) if (!primeiroDado || r.date < primeiroDado) primeiroDado = r.date;
  return diasEntre(from, to).map((date) => ({
    date,
    leads: porDia.get(date) ?? 0,
    pausado:
      date <= hoje &&
      !(primeiroDado !== undefined && date < primeiroDado) &&
      !comConversao.has(date) &&
      Boolean(cobertura && diaCoberto(cobertura, date)),
  }));
}

function leadsChegando(e: EntradaInicio): LeadsChegando {
  const dias = leadsPorDia(e.data, e.range, e.cobertura, e.hoje);
  // As MESMAS opções de /leads (`leads/page.tsx`): a coluna Atendimento é a mesma nas duas telas.
  const linhas = montarLinhasDeLeads(e.data, e.eventos, e.agora, { range: e.range, expediente: e.expediente, robo: e.robo });
  const t = (iso: string) => {
    const v = Date.parse(iso);
    return Number.isFinite(v) ? v : -Infinity;
  };
  const ultimos = linhas
    // Fora: o que parece teste e a CÓPIA de duplicado (`duplicadoDe`; `duplicado` marca o principal também).
    .filter((r) => !r.sinalizadores.teste && r.sinalizadores.duplicadoDe === undefined)
    .sort((a, b) => t(b.createdAt) - t(a.createdAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    .slice(0, 8)
    .map(
      (r): LeadDaHome => ({
        id: r.id,
        nome: r.name,
        criadoEm: r.createdAt,
        ha: haQuanto(r.createdAt, e.agora),
        href: comPeriodo(`/leads/${encodeURIComponent(r.id)}`, e.rangeKey),
        origem: r.origem.anuncio && r.origem.anuncio !== "—" ? curto(r.origem.anuncio) : "—",
        atendimento:
          r.atendimentoAgora.texto === "—"
            ? null
            : {
                texto: r.atendimentoAgora.texto,
                ...(r.atendimentoAgora.href ? { href: comPeriodo(r.atendimentoAgora.href, e.rangeKey) } : {}),
                atrasado: r.atendimentoAgora.atrasado,
              },
      }),
    );
  const ultimoEm = ultimos[0]?.criadoEm ?? null;
  // "nenhum" só quando o período não tem lead NENHUM (o cartão e as barras dizem 0); com
  // lead e a lista vazia, todos são teste ou cópia de duplicado — e o título diz isso.
  const noPeriodo = dias.reduce((s, d) => s + d.leads, 0);
  return {
    titulo: ultimoEm
      ? `Leads · último ${haQuantoNoTitulo(ultimoEm, e.agora)}`
      : noPeriodo > 0
        ? "Leads · só teste ou duplicado"
        : "Leads · nenhum no período",
    dica:
      "Barras: leads do painel por dia (horário de Brasília), com teste e duplicado, como o cartão. Cinza: anúncio de conversão pausado. A lista tira teste e cópia de duplicado.",
    dias,
    faixasPausa: trechos(dias, (d) => d.pausado),
    ultimoEm,
    ultimos,
  };
}

// ---------------------------------------------------------------- 3. atendimento

/**
 * O funil curto do atendimento — um RECORTE do funil do processo do Funil
 * (`recortarProcesso(funilDoProcesso(…), RECORTE_DO_INICIO)`, `lib/funil-processo.ts`,
 * Fase 3): a COORTE dos leads do período, lida das colunas `robo_*` por
 * `situacaoDoRobo` com os MESMOS insumos da Fila e de Leads (ref, reabertos), com os
 * mesmos números e o mesmo texto do % (`textoDaTaxa`) nos degraus que os dois mostram.
 *
 * Robô ligado: Leads → Com o robô (recorte sem taxa; o ⓘ diz quem ficou fora) → 1ª
 * mensagem → Responderam → Convite aceito (interseções: taxa ≤ 1) e, em ramo
 * paralelo, Agendaram (= `kpis.agendaram`, taxa "dos leads"). Com a leitura parada,
 * todo degrau do robô vira "≥ N", sem taxa. Só o período TODO anterior ao robô cai
 * no funil do painel. Robô desligado: Leads → Agendaram → Reuniões realizadas
 * (sobre Agendaram). Taxa só com base ≥ `AMOSTRA_MINIMA`.
 *
 * `p` opcional (K37): `atendimentoDoInicio` calcula o processo UMA vez (com a Fila
 * que já montou) e o passa.
 */
export function funilDoAtendimento(
  e: {
    data: DashboardData;
    range: DateRange | undefined;
    kpis: KpisDoPeriodo;
    eventos: readonly LeadEvent[];
    robo?: RoboAgora;
    agora: string;
    fila?: Pick<FilaResult, "itens">;
  },
  p: FunilDoProcesso = funilDoProcesso(e),
): FunilDoAtendimento {
  const ids = p.comRobo ? RECORTE_DO_INICIO.comRobo : RECORTE_DO_INICIO.semRobo;
  return {
    comRobo: p.comRobo,
    leads: p.leads,
    noRobo: p.noRobo,
    fora: p.fora,
    parada: p.parada,
    degraus: recortarProcesso(p, ids).map(
      (d): DegrauCurto => ({
        id: d.id as DegrauCurtoId,
        rotulo: d.rotulo,
        valor: d.n,
        texto: d.texto,
        taxa: d.taxa,
        base: d.base === null ? null : d.base === "leads" ? "leads" : "anterior",
        piso: d.piso,
        dono: d.dono,
        doRobo: d.doRobo,
      }),
    ),
  };
}

const LIVE_NA_FILA = "Live 01/12"; // o título da seção da live na /fila

/**
 * As frases de AGORA (até 3, na ordem fixa, só as não vazias), cada uma com o
 * número da página que o link abre: o grupo da MESMA `montarFila` da /fila
 * ("Resgate · 33 · 32 fora do prazo → Fila"), o tamanho da Fila da live ("N na
 * fila", o número da seção da live) e, com o robô ligado e a leitura em dia, o
 * `semMensagemDoRobo` (o número do alerta, de Integrações e do filtro de Leads).
 */
export function frasesDoAtendimento(e: {
  fila: Pick<FilaResult, "grupos">;
  filaLive: readonly unknown[];
  roboLigado: boolean;
  /** `semMensagemDoRobo(...).total` — só com o robô ligado e a leitura em dia; senão `null`. */
  semMensagem: number | null;
  rangeKey: string;
}): FraseDoAtendimento[] {
  const doGrupo = (etapa: FilaEtapa): FraseDoAtendimento | null => {
    const g = e.fila.grupos.find((x) => x.etapa === etapa);
    if (!g || g.total <= 0) return null;
    const fora = etapa !== "confirmar" && g.foraDoPrazo > 0 ? ` · ${formatInt(g.foraDoPrazo)} fora do prazo` : "";
    return {
      id: etapa,
      texto: `${FILA_ETAPAS[etapa].label} · ${formatInt(g.total)}${fora} → Fila`,
      href: comPeriodo(`/fila?etapa=${etapa}#${etapa}`, e.rangeKey),
      dono: FILA_ETAPAS[etapa].dono,
      total: g.total,
      foraDoPrazo: g.foraDoPrazo,
    };
  };
  const live: FraseDoAtendimento | null =
    e.filaLive.length > 0
      ? {
          id: "live",
          texto: `${LIVE_NA_FILA} · ${formatInt(e.filaLive.length)} na fila → Fila`,
          href: comPeriodo("/fila#live", e.rangeKey),
          dono: "COM",
          total: e.filaLive.length,
        }
      : null;
  const semMsg: FraseDoAtendimento | null =
    e.roboLigado && e.semMensagem != null && e.semMensagem > 0
      ? {
          id: "sem-1a-msg",
          texto: `Sem a 1ª mensagem do robô · ${formatInt(e.semMensagem)} → Leads`,
          // Sem período de propósito: o número clicado é o de Leads com `range=all`.
          href: "/leads?robo=sem-1a-msg&range=all",
          dono: "BOT",
          total: e.semMensagem,
        }
      : null;
  const [primeiro, ...resto] = gruposDaFila(e.roboLigado);
  // Robô ligado: live, Resgate, sem a 1ª mensagem, Aceitou o convite, a confirmar,
  // sem desfecho. Desligado: live, Novos, Retornar, a confirmar, sem desfecho.
  const candidatas = e.roboLigado
    ? [live, doGrupo(primeiro), semMsg, ...resto.map(doGrupo)]
    : [live, ...[primeiro, ...resto].map(doGrupo)];
  return candidatas.filter((f): f is FraseDoAtendimento => f !== null).slice(0, 3);
}

function atendimentoDoInicio(e: EntradaInicio): AtendimentoDoInicio {
  const robo = e.robo?.ligado ? e.robo : undefined;
  const roboLigado = Boolean(robo);
  // A MESMA entrada da /fila (`fila/page.tsx`): todos os leads, todos os eventos, o robô só ligado.
  const fila = montarFila({ nowIso: e.agora, leads: e.data.leads, eventos: e.eventos, robo });
  const esperando = esperandoOComercial(fila, e.filaLive, roboLigado);
  const parada = robo ? leituraDoRoboParada(robo, e.agora) : false;
  const semMensagem =
    robo && !parada
      ? semMensagemDoRobo(e.data.leads, reabertosPorLead(e.eventos), robo, e.agora, reabertosNoPainel(e.eventos)).total
      : null;
  // O funil do processo UMA vez, com a MESMA Fila: o recorte do funil e a trava saem dele.
  const p = funilDoProcesso({ ...e, fila });
  const funil = funilDoAtendimento(e, p);
  const frases = frasesDoAtendimento({ fila, filaLive: e.filaLive, roboLigado, semMensagem, rangeKey: e.rangeKey });

  const dicaFunil = funil.comRobo
    ? dicaDoRecorteDoRobo(funil)
    : roboLigado
      ? `Nenhum lead do período passou pelo robô (ele começou em ${dm(ROBO_INICIO)}): o funil é o do painel.`
      : "Sem o robô: o funil é o do painel (leads, agendaram, reuniões realizadas).";
  return {
    roboLigado,
    titulo: esperando > 0 ? `Atendimento · ${formatInt(esperando)} esperando o comercial` : "Atendimento · ninguém esperando",
    esperando,
    dica: `Funil = quem entrou no período; frases = quem espera agora (não dependem do período). ${dicaFunil}${
      funil.parada && funil.comRobo ? " Leitura do robô parada: os números do robô são o mínimo, sem taxa." : ""
    }`,
    recorte: recorteDoFunil(e.range),
    leituraParada: linhaDaLeituraParada(robo, e.agora),
    funil: funil.degraus,
    funilComRobo: funil.comRobo,
    frases,
    vazio: frases.length === 0 ? "Nada esperando o comercial agora." : null,
    ondeTrava: resumoDaTrava(ondeTrava(p, { rangeKey: e.rangeKey })),
  };
}

// ---------------------------------------------------------------- 4. rodapé

/** O texto do último post mora em `conteudo-tela.ts` (o placar do Conteúdo lê o mesmo); daqui, só reexportado. */
export { textoDoUltimoPost } from "./conteudo-tela";

function rodapeDoInicio(e: EntradaInicio): RodapeDoInicio {
  // A MESMA conta e o MESMO texto do placar do Conteúdo e da IA: o último post DA
  // GRADE (sem teste nem impulsionado), histórico inteiro (`textoDoUltimoPost`,
  // de `conteudo-tela.ts`). O link vai à página única do Conteúdo, com o período.
  const dias = ultimoPostDaGrade(e.data.igPosts, e.data.creatives, e.agora);
  return {
    diasDesdeUltimoPost: dias,
    links: [
      { id: "funil", rotulo: "Funil completo", href: comPeriodo("/funil", e.rangeKey) },
      { id: "midia", rotulo: "Verba por criativo", href: comPeriodo("/midia", e.rangeKey) },
      { id: "posts", rotulo: textoDoUltimoPost(dias), href: comPeriodo("/conteudo", e.rangeKey) },
    ],
  };
}

// ---------------------------------------------------------------- montagem

export function montarInicio(e: EntradaInicio): Inicio {
  return {
    cartoes: cartoesDoInicio(e),
    leadsChegando: leadsChegando(e),
    atendimento: atendimentoDoInicio(e),
    rodape: rodapeDoInicio(e),
  };
}
