/**
 * O SINAL DO CRIATIVO (Fase 4, nov/26) — puro. "O que faço com este criativo no ar?"
 * em UMA régua (`REGUA_DO_SINAL`): a tela (o selo do cartão e a coluna Sinal), o motor
 * dormente (M3, M6, M8, M9) e a IA leem `linha.sinal`, montado uma vez em
 * `criativosComSinal` (`lib/midia.ts`). É SUGESTÃO: nada muda no Meta.
 *
 * O primeiro que casar: Escalar (3+ reuniões por id a custo ≤ o da conta, sem fadiga) ·
 * Pausar (sem reunião, e nenhum lead ou CPL ≥ 2× a média, com gasto que torna isso
 * improvável por acaso — Poisson < 5%; os leads de nome ambíguo contam a favor) ·
 * Pausar (caro e não responde ao robô) · Trocar arte (fadiga) · Trocar arte (barato e
 * não responde) · Cedo (sem média) · Cedo (gasto < 3 leads da média, com < 10 leads) ·
 * Candidato a escalar (com 10 maduros no robô: responde e CPL até a média; senão a D9:
 * CPL ≤ 0,7× a média com 10 leads, com a trava de qualidade) · Manter.
 *
 * A leitura da qualidade (`leituraDaQualidade`) sai das contagens do trecho do robô por
 * linha (`ContagemDoTrecho`, montadas por `trechoDoRoboPorLinha` em `funil-processo.ts`
 * com a MESMA classificação do Funil). `ContagemDoTrecho` e `TrechoPorLinha` são
 * declarados AQUI (K24); `funil-processo.ts` os importa só como tipo.
 *
 * Não importa `midia`, `kpis` nem `motor` (a ordem de valor é metrics/funil-processo ←
 * sinal ← midia ← motor, sem ciclo).
 */

import { REGRA_FADIGA, type Fatigue } from "./metrics";
import type { ForaDoRobo } from "./funil-processo";
import { formatCurrency0, formatInt, formatPercent } from "./format";
import { MIN_REUNIOES } from "./trust";

// ---------------------------------------------------------------- a régua

/** A amostra de PESSOAS da régua — uma constante só (K9): base da média, candidato pelo CPL, contato inválido, telefone, maduros do robô e a M4 do motor. */
export const AMOSTRA_DE_PESSOAS = 10;

export const REGUA_DO_SINAL = {
  /** λ = gasto ÷ média ("leads que esse gasto rendia na média"). Julgável com λ ≥ 3 — a régua única de amostra (AMOSTRA_MINIMA = MIN_REUNIOES). */
  esperadosParaJulgar: MIN_REUNIOES,
  /** Pausar por custo: a chance de um criativo IGUAL à média render tão pouco (Poisson, P(X ≤ leads | λ)) fica abaixo disto (K1), e λ ≥ 3 (`esperadosParaJulgar`): com 0 lead a chance sozinha já cairia abaixo em λ ≈ 2,996, onde a régua escrita diz Cedo. */
  chanceMaxima: 0.05,
  /** A média só existe com ≥ 10 leads com criativo e ≥ 2 criativos com gasto (fora a live). */
  baseDaMedia: { leads: AMOSTRA_DE_PESSOAS, criativos: 2 },
  /** Pausar por custo: CPL ≥ 2 × a média. O MESMO 2× da live (MULTIPLO_PAUSAR), de propósito — constante própria, não importada. */
  pausarAcimaDaMedia: 2,
  /** D9: CPL ≤ 0,7 × a média… */
  candidatoAteDaMedia: 0.7,
  /** …com ≥ 10 leads. */
  candidatoMinLeads: AMOSTRA_DE_PESSOAS,
  /** Trava do candidato: contato inválido > 25% com ≥ 10 leads. O `CONTATO_INVALIDO_MAX` do motor passa a ler daqui. */
  contatoInvalidoMax: 0.25,
  contatoInvalidoMinLeads: AMOSTRA_DE_PESSOAS,
  /** Trava do candidato (K4): sem telefone utilizável + sem WhatsApp > 25% dos leads, com ≥ 10 leads. Vale com e sem o robô. */
  semTelefoneOuWhatsappMax: 0.25,
  qualidade: {
    /** Maduros mínimos para JULGAR. Maduro = respondeu, ou recebeu a 1ª mensagem há ≥ 24 h. */
    maduros: AMOSTRA_DE_PESSOAS,
    /** "Boa": responderam ÷ 1ª mensagem (o número da tela) ≥ isto. */
    respondeuBoa: 0.5,
    /** "Ruim": responderam ÷ maduros < isto. */
    respondeuRuim: 0.25,
    /** Sem WhatsApp ÷ no robô acima disto = ruim (o mesmo 25% do contato inválido)… */
    semWhatsappMax: 0.25,
    /** …com ≥ 10 pessoas no robô. */
    semWhatsappMinNoRobo: AMOSTRA_DE_PESSOAS,
    /** Trava do candidato pela D9 (K4): abaixo da amostra, com ≥ 3 maduros (AMOSTRA_MINIMA), responderam ÷ maduros < respondeuRuim bloqueia. Trava só BLOQUEIA o positivo; por isso pede menos prova que o "ruim". */
    travaMinMaduros: MIN_REUNIOES,
  },
} as const;

/** Folga de ponto flutuante nas bordas da régua (0,7 × média não pode virar 0,7000000001). */
const EPS = 1e-9;
const ge = (a: number, b: number) => a >= b - EPS;
const le = (a: number, b: number) => a <= b + EPS;
const gt = (a: number, b: number) => a > b + EPS;
const lt = (a: number, b: number) => a < b - EPS;

/** P(X ≤ k) de uma Poisson(λ), somada em log (sem underflow com λ grande). Puro. */
export function chanceDeAte(k: number, lambda: number): number {
  if (!Number.isFinite(k) || k < 0) return 0;
  if (!(lambda > 0)) return 1;
  const kk = Math.floor(k);
  const lnL = Math.log(lambda);
  // ln(termo_i) = −λ + i·ln λ − ln i!
  const termos: number[] = [];
  let lnFat = 0;
  for (let i = 0; i <= kk; i++) {
    if (i > 0) lnFat += Math.log(i);
    termos.push(-lambda + i * lnL - lnFat);
  }
  const max = Math.max(...termos);
  const soma = termos.reduce((s, t) => s + Math.exp(t - max), 0);
  return Math.min(1, Math.exp(max + Math.log(soma)));
}

// ---------------------------------------------------------------- o vocabulário

export type Sinal = "escalar" | "candidato" | "manter" | "trocar-arte" | "pausar" | "cedo";
export const ROTULO_DO_SINAL: Record<Sinal, string> = {
  escalar: "Escalar",
  candidato: "Candidato a escalar",
  manter: "Manter",
  "trocar-arte": "Trocar arte",
  pausar: "Pausar",
  cedo: "Cedo",
};
/** `ok-vazado` = o anel do Candidato (K42): a cor do Escalar sem o preenchimento. */
export type TomDoSinal = "fora" | "perto" | "ok" | "ok-vazado" | "neutro";
export const TOM_DO_SINAL: Record<Sinal, TomDoSinal> = {
  pausar: "fora",
  "trocar-arte": "perto",
  escalar: "ok",
  candidato: "ok-vazado",
  manter: "neutro",
  cedo: "neutro",
};
export const ORDEM_DO_SINAL: Record<Sinal, number> = { pausar: 0, "trocar-arte": 1, escalar: 2, candidato: 3, manter: 4, cedo: 5 };

export type CausaDoSinal =
  | "reunioes" | "sem-resultado" | "caro" | "qualidade" | "fadiga"
  | "cpl-robo" | "cpl-d9" | "amostra" | "sem-base" | null;

export type LeituraDaQualidade =
  | { estado: "indisponivel"; porque: "desligado" | "antes-do-robo" | "leitura-parada" | "ninguem-no-robo" }
  | { estado: "sem-amostra"; maduros: number; faltam: number }
  | { estado: "boa" | "neutra"; maduros: number; taxa: number }
  | { estado: "ruim"; motivo: "nao-responde" | "sem-whatsapp"; maduros: number };

/** As contagens do trecho do robô de UMA linha (criativo ou conjunto) — §3.3. */
export interface ContagemDoTrecho {
  /** Leads da coorte do período com esta chave (= "Leads (painel)" da linha). Contado SEMPRE, com ou sem o robô. */
  leads: number;
  /** Leads da linha sem telefone utilizável (`chaveTelefoneValida`, a régua do "sem telefone"). Contado SEMPRE (a trava do candidato vale sem o robô). */
  semTelefoneUtil: number;
  /** Por que não estão no robô — a mesma partição de `ForaDoRobo`. Zerado sem `comRobo`. */
  fora: ForaDoRobo;
  /** No trecho, mas teste ou cópia de duplicado (`testesEDuplicados`): no degrau do Funil, fora da qualidade. */
  testesECopias: number;
  /** Os mesmos, por fato (K14): para a identidade com cada degrau do Funil. */
  testesECopiasPorFato: { falou: number; respondeu: number; aceitou: number };
  /** O DENOMINADOR: no trecho do robô, sem teste e sem cópia. */
  noRobo: number;
  falou: number;
  respondeu: number;
  aceitou: number;
  semWhatsapp: number;
  /** Falou, ainda não respondeu e a 1ª mensagem tem menos de RESGATE_SEM_RESPOSTA_H (24 h) contra `ref`. */
  noPrazo: number;
}

export interface TrechoPorLinha {
  /** O MESMO `comRobo` do Funil. */
  comRobo: boolean;
  motivoSemRobo: "desligado" | "antes-do-robo" | null;
  parada: boolean;
  /** = linhaDaLeituraParada(robo, agora) — só com o robô ligado. */
  leituraParada: { desde: string | null; texto: string } | null;
  /** Por chave de linha. SEMPRE preenchido com `leads` e `semTelefoneUtil`; os campos do robô só com `comRobo` (K14). */
  porLinha: Map<string, ContagemDoTrecho>;
  /** Leads da coorte sem chave (sem linha identificada). */
  semLinha: ContagemDoTrecho;
  /** Os 4 degraus do robô contados na MESMA passada (P, com teste e cópia) — a conferência com o Funil. Zerados sem `comRobo`. */
  degraus: { comRobo: number; primeiraMsg: number; responderam: number; aceitaram: number };
}

// ---------------------------------------------------------------- a qualidade

/** A leitura da qualidade de UMA linha (contagem ausente = ninguém da linha no robô). */
export function leituraDaQualidade(
  c: ContagemDoTrecho | undefined,
  t: Pick<TrechoPorLinha, "comRobo" | "motivoSemRobo" | "parada">,
): LeituraDaQualidade {
  const q = REGUA_DO_SINAL.qualidade;
  if (!t.comRobo) return { estado: "indisponivel", porque: t.motivoSemRobo ?? "desligado" };
  if (t.parada) return { estado: "indisponivel", porque: "leitura-parada" };
  if (!c || c.noRobo === 0) return { estado: "indisponivel", porque: "ninguem-no-robo" };
  const maduros = c.falou - c.noPrazo;
  // Quem não tem WhatsApp nunca amadurece: vem antes da amostra.
  if (c.noRobo >= q.semWhatsappMinNoRobo && gt(c.semWhatsapp / c.noRobo, q.semWhatsappMax)) {
    return { estado: "ruim", motivo: "sem-whatsapp", maduros };
  }
  if (maduros < q.maduros) return { estado: "sem-amostra", maduros, faltam: q.maduros - maduros };
  if (lt(c.respondeu / maduros, q.respondeuRuim)) return { estado: "ruim", motivo: "nao-responde", maduros };
  const taxa = c.falou > 0 ? c.respondeu / c.falou : 0;
  if (ge(taxa, q.respondeuBoa)) return { estado: "boa", maduros, taxa };
  return { estado: "neutra", maduros, taxa };
}

// ---------------------------------------------------------------- a média

export interface MediaDosCriativos {
  porLead: number;
  gasto: number;
  leads: number;
  criativos: number;
}

function baseDe(linhas: readonly { gasto: number; leads: number }[]) {
  let gasto = 0;
  let leads = 0;
  let criativos = 0;
  for (const l of linhas) {
    if (!(l.gasto > 0)) continue;
    gasto += l.gasto;
    leads += l.leads;
    criativos += 1;
  }
  return { gasto, leads, criativos };
}

/** Razão das somas (ponderada pelo gasto), nunca a média dos CPLs. null sem base. */
export function mediaDosCriativos(linhas: readonly { gasto: number; leads: number }[]): MediaDosCriativos | null {
  const b = baseDe(linhas);
  if (b.criativos < REGUA_DO_SINAL.baseDaMedia.criativos || b.leads < REGUA_DO_SINAL.baseDaMedia.leads) return null;
  return { porLead: b.gasto / b.leads, gasto: b.gasto, leads: b.leads, criativos: b.criativos };
}

/** Por que não há média (K21): "um-criativo" (< 2 criativos com gasto) vence "poucos-leads" (< 10 leads); null com média. */
export function porqueSemMedia(linhas: readonly { gasto: number; leads: number }[]): "um-criativo" | "poucos-leads" | null {
  const b = baseDe(linhas);
  if (b.criativos < REGUA_DO_SINAL.baseDaMedia.criativos) return "um-criativo";
  if (b.leads < REGUA_DO_SINAL.baseDaMedia.leads) return "poucos-leads";
  return null;
}

// ---------------------------------------------------------------- o sinal

export interface EntradaDoSinal {
  /** Do período. */
  gasto: number;
  /** Leads do período com este criativo (= `leadsPainel` da linha). */
  leads: number;
  /** Leads do período de nome ambíguo que PODEM ser deste criativo (= `ambiguos` da linha, K3). */
  ambiguos: number;
  /** Reuniões agendadas no período, só por id (= `agendadas` da linha). */
  agendadas: number;
  /** Leads do período deste criativo com status "Contato inválido". */
  contatoInvalido: number;
  /** = `ContagemDoTrecho.semTelefoneUtil` da linha (com ou sem o robô). */
  semTelefone: number;
  /** `computeFatigue` no período, sem "sem resultado" (que não existe mais lá). */
  fadiga: Fatigue;
  qualidade: LeituraDaQualidade;
  /** As contagens do robô (para os textos "2 de 11"); ausente sem o trecho do robô. */
  robo?: Pick<ContagemDoTrecho, "noRobo" | "falou" | "respondeu" | "aceitou" | "semWhatsapp" | "noPrazo">;
}

export interface ContextoDoSinal {
  media: MediaDosCriativos | null;
  /** = porqueSemMedia(...) — o motivo do Cedo sem base. */
  porqueSemMedia: "um-criativo" | "poucos-leads" | null;
  /** kp.custoPorReuniao.valor quando `custoExibivel`; senão null (Escalar fica desligado). */
  custoPorReuniaoDaConta: number | null;
  /** kp.investimento.confianca?.nivel === "piso" (dias sem dado de gasto, K13): gasto e CPL da linha são pisos — sem Candidato. */
  gastoIncompleto: boolean;
  /** Opcional: a base da média quando ela não existe (Σ leads e criativos com gasto) — só a `amostra` do Cedo sem base. */
  baseDaMedia?: { leads: number; criativos: number };
}

export interface SinalDoCriativo {
  sinal: Sinal;
  rotulo: string;
  tom: TomDoSinal;
  causa: CausaDoSinal;
  /** ≤ 10 palavras, com o número. */
  motivo: string;
  /** Só no candidato: a ressalva visível. */
  ressalva: string | null;
  /** O que o cartão mostra embaixo do nome: ressalva (candidato), motivo (escalar, pausar, trocar arte, cedo), null (manter). */
  linha: string | null;
  /** λ; null sem média. */
  esperados: number | null;
  /** CPL ÷ média; null sem lead ou sem média. */
  razao: number | null;
  /**
   * A amostra que sustenta o sinal (o motor copia para `Acao.amostra`):
   * reunioes → {agendadas, MIN_REUNIOES}; sem-resultado/caro/amostra → {⌊λ⌋, 3};
   * qualidade/cpl-robo → {maduros, 10} (sem-whatsapp: {noRobo, 10}); cpl-d9 → {leads, 10};
   * fadiga → {impressões da janela recente, REGRA_FADIGA.impressoesMinimas};
   * sem-base → {Σ leads da base, 10} ("um-criativo": {criativos, 2}); manter → {leads, 0}.
   */
  amostra: { n: number; minimo: number };
  /** O ⓘ do selo: motivo + a regra deste sinal + a leitura do robô. Sem o nome do criativo (K30). */
  dica: string;
}

/** Uma casa, vírgula: "3,2". */
const umaCasa = (v: number) => (Math.round(v * 10) / 10).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** "0,4×". */
const multiplo = (r: number) => `${umaCasa(r)}×`;
const plural = (n: number, um: string, varios: string) => `${formatInt(n)} ${n === 1 ? um : varios}`;
const pct0 = (r: number) => formatPercent(r, 0);

const REGRA_POR_SINAL: Record<Exclude<Sinal, "candidato">, string> & { "candidato-robo": string; "candidato-d9": string } = {
  escalar: "Escalar = 3 ou mais reuniões no período, pelo id do anúncio, a custo por reunião até o da conta, sem fadiga.",
  pausar:
    "Pausar = sem reunião, e nenhum lead ou CPL de 2× a média ou mais. O gasto precisa tornar isso improvável por acaso: menos de 5% num criativo igual à média. Também pausa: CPL acima da média e resposta ruim ao robô, sem reunião.",
  "trocar-arte":
    "Trocar arte = fadiga: CTR caiu e a frequência ou o custo subiu. Ou CPL até a média e resposta ruim ao robô (menos de 25% respondem, ou mais de 25% sem WhatsApp). Resposta ruim só com 10 pessoas que já tiveram 24 h.",
  "candidato-robo": "Candidato a escalar = metade ou mais responde ao robô, em 10 pessoas com 24 h, e CPL até a média, sem fadiga.",
  "candidato-d9":
    "Candidato a escalar = sem leitura suficiente do robô, CPL até 0,7× a média com 10 leads, sem fadiga. Trava: até 25% de contato inválido, até 25% sem telefone ou WhatsApp e resposta ao robô não ruim. Sem candidato com dias sem dado de gasto.",
  cedo: "Cedo = gastou menos do que renderia 3 leads na média, com menos de 10 leads. Ou não há média: menos de 10 leads com criativo na conta, ou um criativo só.",
  manter: "Manter = nenhuma régua disparou.",
};

/** A régua inteira em palavras (o `title` do cabeçalho "Sinal" na tabela e a `regua` da IA). */
export function textoDaReguaDoSinal(): string {
  return [
    REGRA_POR_SINAL.escalar,
    REGRA_POR_SINAL["candidato-robo"],
    REGRA_POR_SINAL["candidato-d9"],
    REGRA_POR_SINAL.pausar,
    REGRA_POR_SINAL["trocar-arte"],
    REGRA_POR_SINAL.cedo,
    "É sugestão: nada muda no Meta.",
  ].join(" ");
}

/** A leitura do robô em uma frase (o fim do ⓘ do selo). */
function textoDoRobo(q: LeituraDaQualidade, robo: EntradaDoSinal["robo"]): string {
  if (q.estado === "indisponivel") {
    if (q.porque === "desligado") return "Robô desligado nesta marca.";
    if (q.porque === "antes-do-robo") return "Período antes do robô (29/10).";
    if (q.porque === "leitura-parada") return "Robô sem leitura recente: a resposta não entra.";
    return "Nenhum lead deste criativo passou pelo robô.";
  }
  if (q.estado === "sem-amostra") return `Robô: ${q.faltam === 1 ? "falta" : "faltam"} ${plural(q.faltam, "pessoa", "pessoas")} com 24 h para julgar.`;
  const r = robo ?? { noRobo: 0, falou: 0, respondeu: 0, aceitou: 0, semWhatsapp: 0, noPrazo: 0 };
  return `Robô: ${formatInt(r.respondeu)} de ${formatInt(r.falou)} responderam, ${formatInt(r.aceitou)} ${r.aceitou === 1 ? "aceitou" : "aceitaram"}, ${formatInt(r.semWhatsapp)} sem WhatsApp.`;
}

/**
 * "2 de 11 responderam ao robô" · "4 de 11 sem WhatsApp" — a MESMA fração da coluna da
 * tabela do cartão (responderam ÷ 1ª mensagem; sem WhatsApp ÷ no robô): um fato, um
 * número no cartão. A régua decide com os MADUROS (quem já teve 24 h, no ⓘ: "Resposta
 * ruim só com 10 pessoas que já tiveram 24 h"); a fração exibida é sempre ≤ a madura,
 * então nunca contradiz a decisão.
 */
function textoDaQualidadeRuim(q: Extract<LeituraDaQualidade, { estado: "ruim" }>, robo: EntradaDoSinal["robo"]): string {
  const r = robo ?? { noRobo: 0, falou: 0, respondeu: 0, aceitou: 0, semWhatsapp: 0, noPrazo: 0 };
  return q.motivo === "sem-whatsapp"
    ? `${formatInt(r.semWhatsapp)} de ${formatInt(r.noRobo)} sem WhatsApp`
    : `${formatInt(r.respondeu)} de ${formatInt(r.falou)} responderam ao robô`;
}

export function sinalDoCriativo(e: EntradaDoSinal, ctx: ContextoDoSinal): SinalDoCriativo {
  const R = REGUA_DO_SINAL;
  const { media } = ctx;
  const q = e.qualidade;
  const lambda = media ? e.gasto / media.porLead : null;
  const julgavel = lambda != null && ge(lambda, R.esperadosParaJulgar);
  const cpl = e.leads > 0 ? e.gasto / e.leads : null;
  const razao = cpl != null && media ? cpl / media.porLead : null;
  const semReuniao = e.agendadas === 0;
  // Pausar por custo exige também λ ≥ 3 (`julgavel`): com 0 lead a chance < 5% vale já
  // em λ > ln 20 ≈ 2,996, e entre isso e 3 a régua escrita ("gastou menos do que
  // renderia 3 leads" = Cedo) diria o contrário. Com 1+ lead o limiar da chance já
  // passa de 3 (4,75; 6,30; …): nada muda.
  const pausaPorCusto = (k: number) =>
    media != null &&
    lambda != null &&
    julgavel &&
    semReuniao &&
    (k === 0 || ge(e.gasto / k, R.pausarAcimaDaMedia * media.porLead)) &&
    chanceDeAte(k, lambda) < R.chanceMaxima;
  // Com dias sem dado de gasto (K13), todo R$ que sai do gasto DESTA linha é um piso: "≥".
  const piso = ctx.gastoIncompleto ? "≥ " : "";
  const reais = (v: number) => `${piso}${formatCurrency0(v)}`;
  const travaContato = e.leads >= R.contatoInvalidoMinLeads && gt(e.contatoInvalido / e.leads, R.contatoInvalidoMax);
  const pctSemContato = e.leads > 0 ? (e.semTelefone + (e.robo?.semWhatsapp ?? 0)) / e.leads : 0;
  const travaTelefone = e.leads >= R.candidatoMinLeads && gt(pctSemContato, R.semTelefoneOuWhatsappMax);
  const maduros = e.robo ? e.robo.falou - e.robo.noPrazo : 0;
  const travaResposta =
    q.estado === "sem-amostra" &&
    maduros >= R.qualidade.travaMinMaduros &&
    lt((e.robo?.respondeu ?? 0) / maduros, R.qualidade.respondeuRuim);
  const fadigaLivre = e.fadiga.level !== "fadigado" && e.fadiga.level !== "atencao";
  const lambdaFloor = lambda != null ? Math.floor(lambda + EPS) : 0;

  const montar = (
    sinal: Sinal,
    causa: CausaDoSinal,
    motivo: string,
    amostra: { n: number; minimo: number },
    ressalva: string | null = null,
  ): SinalDoCriativo => {
    const regra =
      sinal === "candidato" ? REGRA_POR_SINAL[causa === "cpl-robo" ? "candidato-robo" : "candidato-d9"] : REGRA_POR_SINAL[sinal];
    return {
      sinal,
      rotulo: ROTULO_DO_SINAL[sinal],
      tom: TOM_DO_SINAL[sinal],
      causa,
      motivo,
      ressalva,
      linha: sinal === "candidato" ? ressalva : sinal === "manter" ? null : motivo,
      esperados: lambda,
      razao,
      amostra,
      dica: `${motivo}. ${regra} ${textoDoRobo(q, e.robo)}`,
    };
  };

  // 1. Escalar — reunião vence tudo (menos a fadiga confirmada).
  if (
    e.agendadas >= MIN_REUNIOES &&
    ctx.custoPorReuniaoDaConta != null &&
    le(e.gasto / e.agendadas, ctx.custoPorReuniaoDaConta) &&
    e.fadiga.level !== "fadigado"
  ) {
    return montar(
      "escalar",
      "reunioes",
      `${reais(e.gasto / e.agendadas)} por reunião · ${plural(e.agendadas, "reunião", "reuniões")}`,
      { n: e.agendadas, minimo: MIN_REUNIOES },
    );
  }

  // 2. Pausar por custo (K1), com os ambíguos a favor (K3).
  if (pausaPorCusto(e.leads) && pausaPorCusto(e.leads + e.ambiguos)) {
    const renderia = `a média renderia ${umaCasa(lambda!)}`;
    const motivo =
      e.leads === 0
        ? `${reais(e.gasto)} sem lead; ${renderia}`
        : e.leads < MIN_REUNIOES
          ? `${reais(e.gasto)} e ${plural(e.leads, "lead", "leads")}; ${renderia}`
          : `CPL ${reais(cpl!)} · ${multiplo(razao!)} a média`;
    return montar("pausar", e.leads === 0 ? "sem-resultado" : "caro", motivo, { n: lambdaFloor, minimo: MIN_REUNIOES });
  }

  const amostraDaQualidade = (r: Extract<LeituraDaQualidade, { estado: "ruim" }>) =>
    r.motivo === "sem-whatsapp" ? { n: e.robo?.noRobo ?? 0, minimo: AMOSTRA_DE_PESSOAS } : { n: r.maduros, minimo: AMOSTRA_DE_PESSOAS };

  // 3. Pausar por qualidade: caro e não responde, sem reunião.
  if (q.estado === "ruim" && semReuniao && julgavel && razao != null && gt(razao, 1)) {
    return montar("pausar", "qualidade", `caro e ${textoDaQualidadeRuim(q, e.robo)}`, amostraDaQualidade(q));
  }

  // 4. Trocar arte por fadiga.
  if (e.fadiga.level === "fadigado") {
    const j = e.fadiga.janelas;
    const motivo = j
      ? `CTR ${formatPercent(j.recente.ctr, 1)} contra ${formatPercent(j.anterior.ctr, 1)}; ${
          j.recente.frequency >= REGRA_FADIGA.frequenciaAlta ? `frequência ${umaCasa(j.recente.frequency)}` : "CPL Meta (Pixel) subiu"
        }`
      : "CTR caiu; frequência ou custo subiu";
    return montar("trocar-arte", "fadiga", motivo, { n: j?.recente.impressions ?? 0, minimo: REGRA_FADIGA.impressoesMinimas });
  }

  // 5. Trocar arte por qualidade: barato (ou sem média) e não responde, sem reunião.
  if (q.estado === "ruim" && semReuniao) {
    const texto = textoDaQualidadeRuim(q, e.robo);
    return montar("trocar-arte", "qualidade", media ? `barato, mas ${texto}` : texto, amostraDaQualidade(q));
  }

  // 6. Cedo: não há média para comparar (K21).
  if (media == null) {
    const umCriativo = ctx.porqueSemMedia === "um-criativo";
    return montar(
      "cedo",
      "sem-base",
      umCriativo ? "um criativo só: sem média para comparar" : "poucos leads na conta para comparar",
      umCriativo
        ? { n: ctx.baseDaMedia?.criativos ?? 0, minimo: R.baseDaMedia.criativos }
        : { n: ctx.baseDaMedia?.leads ?? 0, minimo: R.baseDaMedia.leads },
    );
  }

  // 7. Cedo: gastou menos do que renderia 3 leads na média, com menos de 10 leads (K2).
  if (lambda != null && lt(lambda, R.esperadosParaJulgar) && e.leads < R.candidatoMinLeads) {
    // O gasto está abaixo do alvo: o texto nunca diz "R$ 120 de R$ 120" (o arredondamento
    // dos dois lados). Na borda, o alvo exibido passa o gasto exibido em R$ 1.
    const alvo = Math.max(Math.round(R.esperadosParaJulgar * media.porLead), Math.round(e.gasto) + 1);
    return montar("cedo", "amostra", `${reais(e.gasto)} de ${formatCurrency0(alvo)} para julgar`, { n: lambdaFloor, minimo: MIN_REUNIOES });
  }

  // 8. Candidato a escalar.
  const indisponivelOuSemAmostra = q.estado === "indisponivel" || q.estado === "sem-amostra";
  const reunioes = e.agendadas > 0 ? ` · ${plural(e.agendadas, "reunião", "reuniões")}, decide com ${MIN_REUNIOES}` : null;
  const motivoCandidato = razao != null ? `CPL ${multiplo(razao)} a média · ${plural(e.leads, "lead", "leads")}` : "";
  const baseDoCandidato = e.agendadas < MIN_REUNIOES && fadigaLivre;
  const peloRobo = q.estado === "boa" && razao != null && le(razao, 1);
  const pelaD9 = indisponivelOuSemAmostra && e.leads >= R.candidatoMinLeads && razao != null && le(razao, R.candidatoAteDaMedia);
  if (baseDoCandidato && peloRobo && !travaContato && !travaTelefone && !ctx.gastoIncompleto) {
    return montar(
      "candidato",
      "cpl-robo",
      motivoCandidato,
      { n: q.estado === "boa" ? q.maduros : maduros, minimo: AMOSTRA_DE_PESSOAS },
      reunioes ? `responde ao robô${reunioes}` : "responde ao robô, ainda sem reunião",
    );
  }
  if (baseDoCandidato && pelaD9 && !travaContato && !travaTelefone && !travaResposta && !ctx.gastoIncompleto) {
    return montar(
      "candidato",
      "cpl-d9",
      motivoCandidato,
      { n: e.leads, minimo: AMOSTRA_DE_PESSOAS },
      reunioes ? `sinal de topo de funil${reunioes}` : "sinal de topo de funil, ainda sem reunião",
    );
  }

  // 9. Manter — o motivo vai só para o ⓘ.
  const motivoDeManter = (): string => {
    if (pausaPorCusto(e.leads) && !pausaPorCusto(e.leads + e.ambiguos)) {
      return `${plural(e.ambiguos, "lead", "leads")} de nome ambíguo ${e.ambiguos === 1 ? "pode" : "podem"} ser dele`;
    }
    if (baseDoCandidato && (peloRobo || pelaD9)) {
      if (travaContato) return `CPL baixo, mas ${pct0(e.contatoInvalido / e.leads)} de contato inválido`;
      if (travaTelefone) return `CPL baixo, mas ${pct0(pctSemContato)} sem telefone ou WhatsApp`;
      // A fração da tabela do cartão (÷ 1ª mensagem); a trava decide com os maduros (≤ esta).
      if (pelaD9 && travaResposta) return `CPL baixo, mas ${formatInt(e.robo?.respondeu ?? 0)} de ${formatInt(e.robo?.falou ?? 0)} responderam ao robô`;
      if (ctx.gastoIncompleto) return "CPL baixo, mas há dias sem dado de gasto";
    }
    if (q.estado === "neutra") return `${formatInt(e.robo?.respondeu ?? 0)} de ${formatInt(e.robo?.falou ?? 0)} responderam ao robô`;
    if (q.estado === "sem-amostra" && razao != null && le(razao, 1)) {
      return `CPL ${multiplo(razao)} a média; robô decide com ${AMOSTRA_DE_PESSOAS} (${q.faltam === 1 ? "falta" : "faltam"} ${formatInt(q.faltam)})`;
    }
    if (e.agendadas >= MIN_REUNIOES) {
      return ctx.custoPorReuniaoDaConta != null
        ? `${formatInt(e.agendadas)} reuniões; custo acima do da conta`
        : `${formatInt(e.agendadas)} reuniões; custo da conta sem leitura confiável`;
    }
    if (e.fadiga.level === "atencao") return "CTR ou frequência mudando; observar";
    if (e.leads >= MIN_REUNIOES && razao != null) return `CPL ${multiplo(razao)} a média`;
    if (e.leads > 0) return `${plural(e.leads, "lead", "leads")}; a média renderia ${umaCasa(lambda ?? 0)}`;
    return "nenhum lead ainda";
  };
  return montar("manter", null, motivoDeManter(), { n: e.leads, minimo: 0 });
}
