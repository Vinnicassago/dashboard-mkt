/**
 * Fase 4 (D0, §5.1 da spec) — o GOLDEN de paridade da Mídia.
 *
 * Gravado no código de master bd787ab (versão 2026-11-12a), ANTES de a Fase 4 mexer
 * em `midia.ts`, `metrics.ts` e `funil-processo.ts`. É a trava da regressão: o `.snap`
 * NÃO se edita e este arquivo NUNCA roda com `-u`. Depois da Fase 4 só as CHAMADAS
 * (`chamarConjuntos`, `chamarCriativos`) mudam — sai o `cplAlvo` — e nunca as
 * asserções. Diferença aqui é bug.
 *
 * O que se grava, por caso:
 *   • `conjuntosPorId` — em cada linha (campanha e conjunto) os campos de
 *     `CAMPOS_DO_CONJUNTO`, e o `naoAtribuidos` INTEIRO (K16: `anuncio-de-fora` e
 *     `desconhecida` continuam caindo os dois em `naoAtribuidos.desconhecida`; a
 *     separação existe só no `ForaDasLinhasDeConversao` novo);
 *   • `criativosAgregados` — em cada linha (criativo e o detalhe por anúncio) os
 *     campos de `CAMPOS_DO_CRIATIVO`. FORA: `saude` (perde o "sem resultado", F4-D3),
 *     `hookRate`/`holdRate` (saem, F4-D14) e todo campo que a Fase 4 cria (sinal,
 *     veiculação, qualidade, daLive, contatoInvalido…). As chamadas não passam
 *     `cfgLive`: sem ele a chave dos criativos da live (`live|…`, K20) não existe e
 *     nada muda;
 *   • `funilDoProcesso` — os degraus `{ id, n }` (o refator `fatosDoTrecho` não muda
 *     nenhum), sobre `entradaDoRobo`/`entradaDoSeed` (fixtures-robo) e a semana de
 *     produção (fixtures-midia).
 *
 * Números arredondados a 6 casas (`arred`): a soma de gastos em outra ordem não
 * pode virar diferença de último bit. Datas fixas — o `hoje` de cada fixture —,
 * nunca o relógio.
 *
 * O golden é FECHADO: com o `.snap` gravado, um caso renomeado ou novo falha (o
 * vitest gravaria uma chave nova em silêncio fora do CI).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Intervalo } from "../cobertura";
import { buildSeedData } from "../data/seed";
import { funilDoProcesso, type EntradaDoProcesso } from "../funil-processo";
import { custoExibivel, kpisDoPeriodo } from "../kpis";
import { fimDoPeriodo, type DateRange } from "../metrics";
import { conjuntosPorId, criativosAgregados, type LinhaCriativo, type LinhaMidia } from "../midia";
import { pageRange } from "../page-range";
import type { DashboardData } from "../types";
import {
  ATRASADO,
  NUNCA_LIDO,
  PARADO,
  ROBO,
  SEED_AGORA,
  SEED_COBERTURA,
  SEED_HOJE,
  entradaDoRobo,
  entradaDoSeed,
  porMarca,
} from "@/test/fixtures-robo";
import {
  comCandidatoPeloRobo,
  comLeituraParada,
  comLive,
  comNaoResponde,
  comReunioes,
  comReunioesSoPorNome,
  comRoboDesligado,
  comSemTelefone,
  entradaDoProcessoDa,
  piorCasoDeTexto,
  producaoSemana,
  type SemanaDaMidia,
} from "@/test/fixtures-midia";

// ---------------------------------------------------------------- o golden é fechado

const ARQUIVO_DO_GOLDEN = path.join(__dirname, "__snapshots__", "fase4-paridade-midia.test.ts.snap");
/** As chaves já gravadas (null só na 1ª rodada, a que grava). */
const GRAVADAS: ReadonlySet<string> | null = fs.existsSync(ARQUIVO_DO_GOLDEN)
  ? new Set([...fs.readFileSync(ARQUIVO_DO_GOLDEN, "utf8").matchAll(/^exports\[`(.*)`\] = /gm)].map((m) => m[1]))
  : null;

/** `toMatchSnapshot`, exigindo que a chave já exista no golden gravado. */
function confere(valor: unknown, dica: string) {
  const chave = `${expect.getState().currentTestName} > ${dica} 1`;
  if (GRAVADAS) expect(GRAVADAS.has(chave), `o golden não tem "${chave}": caso renomeado ou novo — o .snap NÃO se regrava`).toBe(true);
  expect(valor).toMatchSnapshot(dica);
}

// ---------------------------------------------------------------- o que se grava

/** Os campos de `LinhaMidia` que a Fase 4 não muda (§5.1). */
const CAMPOS_DO_CONJUNTO = [
  "chave",
  "nome",
  "bucket",
  "spend",
  "impressions",
  "leadsPainel",
  "conversoesPixel",
  "agendadas",
  "contatoInvalido",
  "custoPorAgendada",
] as const satisfies readonly (keyof LinhaMidia)[];

/** Os campos de `LinhaCriativo` que a Fase 4 não muda (§5.1): sem `saude`, `hookRate`, `holdRate` nem os campos novos. */
const CAMPOS_DO_CRIATIVO = [
  "chave",
  "nome",
  "bucket",
  "anuncios",
  "spend",
  "impressions",
  "leadsPainel",
  "agendadas",
  "custoPorAgendada",
  "ambiguos",
] as const satisfies readonly (keyof LinhaCriativo)[];

/** Número a 6 casas (a ordem de uma soma não muda o golden); o resto como veio. */
const arred = (v: unknown) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v);

function campos<T extends object>(l: T, nomes: readonly (keyof T)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of nomes) out[String(k)] = arred(l[k]);
  return out;
}

function linhaDeConjunto(l: LinhaMidia): Record<string, unknown> {
  return { ...campos(l, CAMPOS_DO_CONJUNTO), ...(l.conjuntos ? { conjuntos: l.conjuntos.map(linhaDeConjunto) } : {}) };
}

function linhaDeCriativo(l: LinhaCriativo): Record<string, unknown> {
  return { ...campos(l, CAMPOS_DO_CRIATIVO), ...(l.anunciosDetalhe ? { anunciosDetalhe: l.anunciosDetalhe.map(linhaDeCriativo) } : {}) };
}

// ---------------------------------------------------------------- os casos da Mídia

interface CasoDaMidia {
  data: DashboardData;
  range: DateRange | undefined;
  cobertura: Intervalo[];
  /** `fimDoPeriodo(range, hoje)` — onde as janelas terminam (a página passa o mesmo). */
  fim: string;
  /** `custoExibivel(kp.custoPorReuniao)` da MESMA entrada (`kpisDoPeriodo`). */
  custoPorReuniaoExibivel: boolean;
}

function caso(data: DashboardData, chave: string, o: { hoje: string; agora: string; cobertura: Intervalo[] }): CasoDaMidia {
  const { range } = pageRange(data, chave, o.hoje);
  const kp = kpisDoPeriodo(data, range, { hoje: o.hoje, agora: o.agora, cobertura: o.cobertura });
  return { data, range, cobertura: o.cobertura, fim: fimDoPeriodo(range, o.hoje), custoPorReuniaoExibivel: custoExibivel(kp.custoPorReuniao) };
}

const doSeed = (marca: string, chave: string) => () =>
  caso(porMarca(buildSeedData(), marca), chave, { hoje: SEED_HOJE, agora: SEED_AGORA, cobertura: SEED_COBERTURA });

const daSemana = (semana: () => SemanaDaMidia, chave: string) => () => {
  const p = semana();
  return caso(p.data, chave, { hoje: p.hoje, agora: p.agora, cobertura: p.cobertura });
};

const CASOS_DA_MIDIA: { nome: string; entrada: () => CasoDaMidia }[] = [
  // O seed, com o `hoje` dele (23/07): 7 e 30 dias têm dado.
  { nome: "seed consorcio · 7d", entrada: doSeed("consorcio", "7d") },
  { nome: "seed consorcio · 30d", entrada: doSeed("consorcio", "30d") },
  { nome: "seed consorcio · campanha", entrada: doSeed("consorcio", "all") },
  { nome: "seed krone (awareness) · 7d", entrada: doSeed("krone", "7d") },
  { nome: "seed krone (awareness) · 30d", entrada: doSeed("krone", "30d") },
  { nome: "seed krone (awareness) · campanha", entrada: doSeed("krone", "all") },
  // A forma da produção de 12/11 (fixtures-midia).
  { nome: "produção · 7d", entrada: daSemana(producaoSemana, "7d") },
  { nome: "produção · campanha", entrada: daSemana(producaoSemana, "all") },
  { nome: "produção com 3 reuniões por id · 7d", entrada: daSemana(() => comReunioes(3), "7d") },
  { nome: "produção com 2 reuniões só pelo nome · 7d", entrada: daSemana(() => comReunioesSoPorNome(2), "7d") },
  { nome: "live no ar (criativo misto, sem cfgLive) · 7d", entrada: daSemana(comLive, "7d") },
  { nome: "pior caso de texto · 7d", entrada: daSemana(piorCasoDeTexto, "7d") },
];

/** A CHAMADA de hoje. Na Fase 4 só ela muda (sai `cplAlvo`) — nunca a asserção. */
function chamarConjuntos(c: CasoDaMidia) {
  return conjuntosPorId(c.data, c.range, { custoPorReuniaoExibivel: c.custoPorReuniaoExibivel });
}

/** A CHAMADA de hoje. `cplAlvo` só mexe na `saude` (fora do golden) e sai na Fase 4; sem `cfgLive`. */
function chamarCriativos(c: CasoDaMidia) {
  return criativosAgregados(c.data, c.range, {
    fim: c.fim,
    cobertura: c.cobertura,
    custoPorReuniaoExibivel: c.custoPorReuniaoExibivel,
  });
}

describe("paridade da Mídia — golden gravado antes da Fase 4 (§5.1)", () => {
  for (const c of CASOS_DA_MIDIA) {
    it(c.nome, () => {
      const e = c.entrada();
      const conjuntos = chamarConjuntos(e);
      const criativos = chamarCriativos(e);

      // A entrada (o período, o fim e a régua do custo) — o porquê de um diff abaixo.
      confere({ range: e.range ?? null, fim: e.fim, custoPorReuniaoExibivel: e.custoPorReuniaoExibivel }, "entrada");
      confere(
        {
          conversao: conjuntos.conversao.map(linhaDeConjunto),
          descoberta: conjuntos.descoberta.map(linhaDeConjunto),
          naoAtribuidos: conjuntos.naoAtribuidos,
        },
        "conjuntosPorId",
      );
      confere(
        {
          conversao: criativos.conversao.map(linhaDeCriativo),
          descoberta: criativos.descoberta.map(linhaDeCriativo),
        },
        "criativosAgregados",
      );
    });
  }
});

// ---------------------------------------------------------------- os degraus do funil do processo

const CASOS_DO_FUNIL: { nome: string; entrada: () => EntradaDoProcesso; comRobo: boolean }[] = [
  // O seed da marca consorcio: robô desligado (o funil do painel).
  { nome: "seed consorcio · 7d", entrada: () => entradaDoSeed("7d"), comRobo: false },
  { nome: "seed consorcio · 30d", entrada: () => entradaDoSeed("30d"), comRobo: false },
  { nome: "seed consorcio · campanha", entrada: () => entradaDoSeed("all"), comRobo: false },
  // O robô de fixture (colunas robo_*).
  { nome: "robô · semana", entrada: () => entradaDoRobo(), comRobo: true },
  { nome: "robô · campanha", entrada: () => entradaDoRobo(ROBO, null), comRobo: true },
  { nome: "robô parado (falhando)", entrada: () => entradaDoRobo(PARADO), comRobo: true },
  { nome: "robô parado há 90 min, ainda 'confiável'", entrada: () => entradaDoRobo(ATRASADO), comRobo: true },
  { nome: "robô nunca lido", entrada: () => entradaDoRobo(NUNCA_LIDO), comRobo: true },
  { nome: "robô desligado", entrada: () => entradaDoRobo(null), comRobo: false },
  // A semana de produção (fixtures-midia).
  { nome: "produção · 7d", entrada: () => entradaDoProcessoDa(producaoSemana(), "7d"), comRobo: true },
  { nome: "produção · campanha", entrada: () => entradaDoProcessoDa(producaoSemana(), "all"), comRobo: true },
  { nome: "produção · leitura parada", entrada: () => entradaDoProcessoDa(comLeituraParada(), "7d"), comRobo: true },
  { nome: "produção · robô desligado", entrada: () => entradaDoProcessoDa(comRoboDesligado(), "7d"), comRobo: false },
  { nome: "produção · candidato pelo robô", entrada: () => entradaDoProcessoDa(comCandidatoPeloRobo(), "7d"), comRobo: true },
  { nome: "produção · 9 maduros sem resposta", entrada: () => entradaDoProcessoDa(comNaoResponde(9), "7d"), comRobo: true },
  { nome: "produção · sem telefone", entrada: () => entradaDoProcessoDa(comSemTelefone(), "7d"), comRobo: true },
  { nome: "live no ar · 7d", entrada: () => entradaDoProcessoDa(comLive(), "7d"), comRobo: true },
];

describe("paridade da Mídia — os degraus do funil do processo antes de fatosDoTrecho (§5.1)", () => {
  for (const c of CASOS_DO_FUNIL) {
    it(c.nome, () => {
      const f = funilDoProcesso(c.entrada());
      // O caminho que o caso exercita.
      expect(f.comRobo, "comRobo").toBe(c.comRobo);
      confere(
        f.degraus.map((d) => ({ id: d.id, n: d.n })),
        "funilDoProcesso.degraus",
      );
    });
  }
});
