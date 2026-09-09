/**
 * Camada de CONFIANÇA — o direito do painel de dizer "não sei".
 *
 * O problema que ela resolve: `div(a, b)` devolve 0 quando o denominador é 0
 * (metrics.ts), então "nenhuma reunião aconteceu" e "cada reunião custou zero"
 * imprimem exatamente o mesmo pixel — e o segundo parece uma notícia ótima. O
 * mesmo vale para gasto contaminado por outra marca, ou para um CPL calculado
 * sobre 37 dos 44 dias do período.
 *
 * Aqui não se conserta o cálculo: dizemos o que dá (e o que não dá) para
 * afirmar com ele. `div()` continua como está de propósito — são 75 call sites
 * e `OverviewKpis` é consumido por insights, briefing de IA e recomendações;
 * trocar para `number | null` seria dias de refactor com null vazando para o
 * Recharts, sem ganho sobre esta camada.
 *
 * Função PURA: recebe dados e devolve veredito. Sem I/O, como manda o CLAUDE.md.
 */

import type { DashboardData } from "./types";
import type { DateRange } from "./metrics";

// ---------------------------------------------------------------- vocabulário

/** Métricas que podem cair em quarentena. */
export type MetricKey =
  | "cpr"
  | "cpl"
  | "cplBlended"
  | "spend"
  | "split"
  | "cpm"
  | "costPerFollower"
  | "meetings";

/**
 * O quanto dá para confiar no número:
 *   `quarentena` — não exiba. Qualquer valor seria inventado.
 *   `piso`       — o real é IGUAL OU MAIOR (falta dado que só soma). Prefixe "≥".
 *   `teto`       — o real é IGUAL OU MENOR (há dado a mais no cálculo). Prefixe "≤".
 */
export type NivelConfianca = "quarentena" | "piso" | "teto";

export interface Quarentena {
  nivel: NivelConfianca;
  /** Frase curta, para ficar colada ao número. */
  motivo: string;
}

export interface Trava {
  id: string;
  /** `config` não é culpa da campanha — é campo em branco. Não colore o farol. */
  nivel: NivelConfianca | "config";
  titulo: string;
  detalhe: string;
  afeta: MetricKey[];
  cta?: { label: string; href: string };
}

export interface TrustInput {
  data: DashboardData;
  range?: DateRange;
  /** Regras de marca já resolvidas (env + override da UI). */
  brandRules: { slug: string; campaignMatch: string[] }[];
  kpis: { meetings: number; leads: number; spendConversao: number; spendTotal: number };
  /**
   * Reuniões que o robô/comercial registrou no mesmo período. `null` = sem
   * leitura (robô desligado ou falhou) — o que NÃO é o mesmo que zero.
   */
  roboReunioes?: number | null;
}

export interface TrustReport {
  travas: Trava[];
  /** A trava mais severa que afeta cada métrica. */
  porMetrica: Partial<Record<MetricKey, Quarentena>>;
}

const SEVERIDADE: Record<NivelConfianca, number> = { quarentena: 3, teto: 2, piso: 1 };

// ---------------------------------------------------------------- checagens

/** Dias do intervalo sem nenhuma linha de anúncio (o buraco que vira "piso"). */
function diasSemDado(data: DashboardData, range?: DateRange): { faltando: number; total: number } {
  const dates = new Set(data.adDaily.map((r) => r.date));
  let from: string;
  let to: string;
  if (range) {
    from = range.from;
    to = range.to;
  } else {
    const all = [...dates].sort();
    if (all.length < 2) return { faltando: 0, total: all.length };
    from = all[0];
    to = all.at(-1)!;
  }
  const start = new Date(from + "T00:00:00Z").getTime();
  const end = new Date(to + "T00:00:00Z").getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return { faltando: 0, total: 0 };
  }
  const total = Math.round((end - start) / 86_400_000) + 1;
  let faltando = 0;
  for (let i = 0; i < total; i++) {
    const d = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    if (!dates.has(d)) faltando += 1;
  }
  return { faltando, total };
}

/**
 * Gasto atribuído a esta marca que casa com o token de OUTRA marca.
 *
 * Só detecta o que foi declarado: se a regra da outra marca está vazia, não há
 * token para casar e o resultado é 0 — por isso a checagem de "regra nunca
 * configurada" existe em separado. Sem balde de "não classificado", um erro de
 * atribuição é indistinguível de um acerto (meta/config.ts:111-131).
 */
function gastoDeOutraMarca(input: TrustInput): { valor: number; tokens: string[] } {
  const minha = input.data.campaign.brand;
  const outros = input.brandRules
    .filter((b) => b.slug !== minha)
    .flatMap((b) => b.campaignMatch)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t && !/^\d+$/.test(t));
  if (outros.length === 0) return { valor: 0, tokens: [] };

  const casados = new Set<string>();
  let valor = 0;
  for (const row of input.data.adDaily) {
    const nome = (row.campaign ?? "").toLowerCase();
    const hit = outros.find((t) => nome.includes(t));
    if (hit) {
      valor += row.spend;
      casados.add(hit);
    }
  }
  return { valor, tokens: [...casados] };
}

// ---------------------------------------------------------------- veredito

/**
 * Avalia o que dá para afirmar com os números do período.
 *
 * Ordem importa: a trava mais severa por métrica é a que vale, e a lista sai
 * ordenada por severidade para a faixa "antes de decidir" da Visão Geral.
 */
export function assessTrust(input: TrustInput): TrustReport {
  const { data, kpis } = input;
  const travas: Trava[] = [];

  // 1. Fontes divergem sobre o mesmo fato. É a trava mais grave que existe:
  //    dois sistemas afirmando coisas incompatíveis sobre a MESMA reunião.
  if (input.roboReunioes != null && input.roboReunioes > 0 && kpis.meetings === 0) {
    travas.push({
      id: "fontes-divergem",
      nivel: "quarentena",
      titulo: "As fontes discordam sobre reuniões",
      detalhe: `O atendimento registra ${input.roboReunioes} reunião(ões) e o funil do painel conta 0. Enquanto discordarem, o custo por reunião não é exibido — um dos dois lados está com o lead sem parear.`,
      afeta: ["cpr", "meetings"],
      cta: { label: "Ver atendimento", href: "/comercial" },
    });
  }

  // 2. Sem reunião no período, CPR não é R$ 0,00 — é ausência de denominador.
  //    Esta é a trava que tira o "custo excelente" que nunca existiu da tela.
  if (kpis.meetings === 0 && kpis.spendConversao > 0) {
    travas.push({
      id: "sem-reuniao",
      nivel: "quarentena",
      titulo: "Nenhuma reunião registrada no período",
      detalhe: `Houve R$ ${Math.round(kpis.spendConversao)} de investimento em conversão e nenhuma reunião marcada. O custo por reunião fica sem denominador: "R$ 0,00" seria lido como custo baixo, quando é ausência de resultado.`,
      afeta: ["cpr"],
      cta: { label: "Ver o funil", href: "/funil" },
    });
  }

  // 2b. Mesmo raciocínio um degrau acima: sem lead, CPL não é R$ 0,00.
  if (kpis.leads === 0 && kpis.spendConversao > 0) {
    travas.push({
      id: "sem-lead",
      nivel: "quarentena",
      titulo: "Nenhum lead registrado no período",
      detalhe:
        "Houve investimento em conversão e nenhum cadastro. O custo por lead fica sem denominador — e vale checar o rastreio da landing page antes de concluir que a mídia não performou.",
      afeta: ["cpl", "cplBlended"],
      cta: { label: "Ver integrações", href: "/config" },
    });
  }

  // 3. Gasto de outra marca dentro deste denominador — infla tudo que divide
  //    por investimento. O real é MENOR que o exibido, daí "teto".
  const contaminacao = gastoDeOutraMarca(input);
  if (contaminacao.valor > 0 && kpis.spendTotal > 0) {
    const pct = contaminacao.valor / kpis.spendTotal;
    if (pct > 0.05) {
      travas.push({
        id: "marca-contaminada",
        nivel: "teto",
        titulo: `R$ ${Math.round(contaminacao.valor)} de outra marca neste total`,
        detalhe: `${Math.round(pct * 100)}% do investimento vem de campanhas que casam com "${contaminacao.tokens.join('", "')}". Investimento, split por objetivo, CPL e custo por seguidor estão inflados — o valor real é menor.`,
        afeta: ["spend", "cpl", "cplBlended", "split", "cpm", "costPerFollower", "cpr"],
        cta: { label: "Reclassificar marcas", href: "/config" },
      });
    }
  } else if (input.brandRules.length > 1 && kpis.spendTotal > 0) {
    // Nenhuma outra marca declarou token: tudo cai no catch-all sem aviso.
    const semRegra = input.brandRules
      .filter((b) => b.slug !== data.campaign.brand)
      .every((b) => b.campaignMatch.length === 0);
    if (semRegra) {
      travas.push({
        id: "marca-sem-regra",
        nivel: "teto",
        titulo: "A separação de marcas nunca foi configurada",
        detalhe:
          "Há mais de uma marca no mesmo ad account e nenhuma regra que diga quais campanhas são de qual. Sem ela, tudo que não casa cai nesta marca por padrão — e um erro de atribuição fica indistinguível de um acerto.",
        afeta: ["spend", "cpl", "cplBlended", "split", "cpm", "costPerFollower", "cpr"],
        cta: { label: "Definir a regra", href: "/config" },
      });
    }
  }

  // 4. Buraco na série: o gasto real é maior, então CPL/CPR reais são maiores.
  const { faltando, total } = diasSemDado(data, input.range);
  if (total > 0 && faltando / total > 0.1) {
    travas.push({
      id: "cobertura-de-dias",
      nivel: "piso",
      titulo: `${faltando} de ${total} dias sem dados de anúncio`,
      detalhe: `${Math.round((faltando / total) * 100)}% do período não tem linha de gasto — por pausa de campanha ou por falha de sincronização. Se for falha, o investimento real é maior e todo custo por lead e por reunião aqui é um piso.`,
      afeta: ["spend", "cpl", "cplBlended", "cpr", "cpm"],
      cta: { label: "Sincronizar ou importar", href: "/config" },
    });
  }

  // 5 e 6. Campo em branco — não é erro de medição, é configuração que falta.
  //        Não entra em `porMetrica`: não há número errado, há regra desligada.
  if (data.goals.length === 0) {
    travas.push({
      id: "metas-ausentes",
      nivel: "config",
      titulo: "Nenhuma meta cadastrada",
      detalhe:
        'Sem meta, "R$ 26,42 por lead" é só um número — não dá para dizer se está bom. E as duas regras de severidade alta do motor de recomendação ("CPL acima da meta" e "custo por reunião acima da meta") nunca disparam: ele está rodando a meia força.',
      afeta: [],
      cta: { label: "Cadastrar metas", href: "/config" },
    });
  }

  if ((data.campaign.budgetTotal ?? 0) <= 0) {
    travas.push({
      id: "budget-ausente",
      nivel: "config",
      titulo: "Orçamento da campanha não cadastrado",
      detalhe:
        'Por isso o painel mostra "de R$ 0 · 0% consumido" e o ritmo de gasto não projeta se a verba acaba antes do fim.',
      afeta: [],
      cta: { label: "Cadastrar orçamento", href: "/config" },
    });
  }

  // A trava mais severa vence por métrica.
  const porMetrica: Partial<Record<MetricKey, Quarentena>> = {};
  for (const t of travas) {
    if (t.nivel === "config") continue;
    for (const m of t.afeta) {
      const atual = porMetrica[m];
      if (!atual || SEVERIDADE[t.nivel] > SEVERIDADE[atual.nivel]) {
        porMetrica[m] = { nivel: t.nivel, motivo: t.titulo };
      }
    }
  }

  const ordem = (t: Trava) => (t.nivel === "config" ? 0 : SEVERIDADE[t.nivel]);
  travas.sort((a, b) => ordem(b) - ordem(a));

  return { travas, porMetrica };
}

/**
 * Como exibir um valor dado o veredito. `quarentena` some com o número — é o
 * ponto inteiro da camada: número nenhum é melhor que número errado.
 */
export function aplicarConfianca(valor: string, q?: Quarentena): string {
  if (!q) return valor;
  if (q.nivel === "quarentena") return "—";
  return `${q.nivel === "piso" ? "≥" : "≤"} ${valor}`;
}
