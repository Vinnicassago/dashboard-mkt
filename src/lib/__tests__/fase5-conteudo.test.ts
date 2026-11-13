/**
 * Fase 5 de nov/26 (§5.1 da spec) — o Conteúdo como função pura (`montarConteudoDaTela`,
 * `lib/conteudo.ts`), sobre o seed e sobre a FORMA da produção de 13/11
 * (`fixtures-conteudo`, números e legendas fictícios). "Um fato, um número":
 *
 *   • o placar é o que a IA recebe (posts da grade, último post, líquido de seguidores),
 *     o último post é o do rodapé do Início e o "da grade" de Registros é o do placar;
 *   • os 3 melhores são `melhoresDaGrade` (salvos + compartilhamentos, depois interações,
 *     em número) — a IA lê a MESMA função no MESMO período;
 *   • as ações são `buildRecommendations` filtrado por `IDS_DE_CONTEUDO`, sem o pileup
 *     com grupo de variação do período, as 2 primeiras; as do AGORA aparecem em qualquer
 *     período;
 *   • a linha das variações é do histórico inteiro e só com 2+ posts na grade;
 *   • o dia do post é o de Brasília em todo filtro e toda data exibida (F5-D25).
 *
 * O nome `fase5-conteudo*` é desta Fase 5 (nov/26); `fase5.test.ts` é o motor da Fase 5
 * de out/26.
 */
import { describe, expect, it } from "vitest";
import { buildBriefing } from "../ai/briefing";
import { gradeDaSemana, suggestMatches } from "../content/outcomes";
import {
  FORMATO_DA_MINIATURA,
  METRICAS_DE_CONTEUDO,
  ROTULO_DO_TIPO,
  acoesDaGrade,
  alcanceOrganicoDosPosts,
  contagemDaGrade,
  horaDoPost,
  legendaCurta,
  miniaturaDoPost,
  montarConteudoDaTela,
  normalizarLegenda,
  registrosDoPeriodo,
  resumoSeguidores,
  textoDoUltimoPost,
  tituloDosRegistros,
  variacoesDeAnuncio,
  variacoesNaGrade,
  type ConteudoDaTela,
  type EntradaConteudo,
} from "../conteudo";
import { DICIONARIO, dica } from "../dicionario";
import { formatDateShort, formatDecimal, formatInt, formatPercent } from "../format";
import { montarInicio, type EntradaInicio } from "../inicio";
import { kpisDoPeriodo } from "../kpis";
import {
  aggregatePostPerformance,
  diaDoPost,
  followerSeries,
  igAccountTotals,
  inRange,
  melhoresDaGrade,
  pontosDoTotalDeSeguidores,
  postPerformance,
  rankingDaGrade,
  type PostPerf,
} from "../metrics";
import { miniaturaValida as miniaturaValidaDaMidia } from "../midia";
import { miniaturaValida } from "../miniatura";
import { pageRange } from "../page-range";
import { IDS_DE_CONTEUDO, buildRecommendations, type Recommendation } from "../recommendations";
import type { DashboardData, IgPost } from "../types";
import { entradaDoSeed } from "@/test/fixtures-robo";
import * as F from "@/test/fixtures-conteudo";
import { conteudoDa, entradaConteudoDa, seedDaMarca } from "@/test/entrada-conteudo";

// ---------------------------------------------------------------- utilidades

/** A régua de `palavras` (src/test/tela.ts): pedaço com letra ou algarismo. */
const nPalavras = (t: string) => t.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p)).length;
const frases = (t: string) => t.split(/(?<=[.!?])\s+/).filter((f) => f.trim() !== "");

const briefingDa = (e: EntradaConteudo) => buildBriefing(e.data, e.range, { nowIso: e.agora, drafts: e.drafts, warnings: [] });
const postsDa = (e: EntradaConteudo): PostPerf[] => postPerformance(e.data.igPosts, e.range, e.data.igAccountDaily, e.data.creatives);
const recsDa = (e: EntradaConteudo): Recommendation[] => buildRecommendations(e.data, e.range, e.agora, e.drafts);

/** Os mesmos dados da produção com outros posts (e sem criativo de impulsionado). */
const comPosts = (igPosts: IgPost[]): DashboardData => ({ ...F.producaoConteudo(), igPosts, creatives: [] });

/** Os verbos que abrem as linhas das ações (§2.5). */
const VERBOS = new Set(["Publique", "Espace", "Complete", "Revise", "Encurte", "Peça", "Tire"]);

/** Todas as dicas montadas pela tela. */
function dicasDe(c: ConteudoDaTela): [string, string][] {
  return [
    ["placar", c.placar.dica],
    ["variações", c.variacoes?.dica ?? ""],
    ["melhores", c.melhores?.dica ?? ""],
    ...c.acoes.map((a): [string, string] => [`ação ${a.id}`, a.dica]),
    ["todos", c.todos?.dica ?? ""],
    ["conta", c.conta?.dica ?? ""],
    ...(c.conta?.numeros ?? []).map((n): [string, string] => [`número ${n.id}`, n.dica]),
  ];
}

interface Caso {
  nome: string;
  entrada: () => EntradaConteudo;
}

const CASOS: Caso[] = [
  { nome: "seed · URL limpa (30 dias, julho fora)", entrada: () => entradaConteudoDa(seedDaMarca()) },
  { nome: "seed · 7 dias", entrada: () => entradaConteudoDa(seedDaMarca(), "7d") },
  { nome: "seed · campanha", entrada: () => entradaConteudoDa(seedDaMarca(), "all") },
  { nome: "seed da Krone · campanha", entrada: () => entradaConteudoDa(seedDaMarca("krone"), "all") },
  { nome: "produção · 30 dias", entrada: () => entradaConteudoDa(F.producaoConteudo(), "30d") },
  { nome: "produção · 7 dias", entrada: () => entradaConteudoDa(F.producaoConteudo(), "7d") },
  { nome: "produção · campanha", entrada: () => entradaConteudoDa(F.producaoConteudo(), "all") },
  { nome: "semana sem post · 7 dias", entrada: () => entradaConteudoDa(F.semPostNaSemana(), "7d") },
  { nome: "post da noite · 7 dias", entrada: () => entradaConteudoDa(F.postDaNoite(), "7d", { agora: F.AGORA_NOITE }) },
  { nome: "post da noite · campanha", entrada: () => entradaConteudoDa(F.postDaNoite(), "all", { agora: F.AGORA_NOITE }) },
  { nome: "pileup sem variação", entrada: () => entradaConteudoDa(F.pileupSemVariacao()) },
  { nome: "terça sem a segunda", entrada: () => entradaConteudoDa(F.tercaSemSegunda(), "30d", { hoje: F.HOJE_TERCA }) },
  { nome: "Krone · 30 dias", entrada: () => entradaConteudoDa(F.kroneConteudo()) },
  { nome: "período que ainda não começou", entrada: () => entradaConteudoDa(seedDaMarca(), F.CHAVE_NAO_COMECOU) },
  { nome: "pior caso de texto", entrada: () => entradaConteudoDa(F.piorCasoDeTexto(), F.CHAVE_DO_PIOR_CASO) },
];

// ---------------------------------------------------------------- 1–7. o placar e a paridade

describe("o placar é o que a IA recebe (§3.12)", () => {
  it("1. 'N posts no período' = aggregatePostPerformance(...).count = organico.posts da IA = contagemDaGrade(...).grade", () => {
    const casos = [entradaConteudoDa(seedDaMarca(), "all"), entradaConteudoDa(F.producaoConteudo(), "30d"), entradaConteudoDa(F.producaoConteudo(), "7d")];
    for (const e of casos) {
      const c = montarConteudoDaTela(e);
      const posts = postsDa(e);
      const n = aggregatePostPerformance(posts).count;
      expect(c.placar.numeros.posts, e.rangeKey).toBe(n);
      expect(briefingDa(e).organico.posts, e.rangeKey).toBe(n);
      expect(contagemDaGrade(posts).grade, e.rangeKey).toBe(n);
      expect(c.placar.posts).toBe(n === 0 ? "Nenhum post no período" : n === 1 ? "1 post no período" : `${formatInt(n)} posts no período`);
    }
    expect(montarConteudoDaTela(casos[0]).placar.posts).toBe("8 posts no período");
  });

  it("2. o último post é o do rodapé do Início (texto e número) e o da IA; o link do rodapé vai a /conteudo", () => {
    const ei = entradaDoSeed("all");
    const c = montarConteudoDaTela(entradaConteudoDa(ei.data, "all", { hoje: ei.hoje, agora: ei.agora }));
    const ini = montarInicio(ei);
    const link = ini.rodape.links.find((l) => l.id === "posts")!;
    expect(c.placar.ultimo).toBe(link.rotulo);
    expect(c.placar.numeros.diasDesdeUltimoPost).toBe(ini.rodape.diasDesdeUltimoPost);
    const ia = buildBriefing(ei.data, ei.range, { nowIso: ei.agora, warnings: [] });
    expect(c.placar.numeros.diasDesdeUltimoPost).toBe(ia.organico.cadencia.diasDesdeOUltimoPost);
    expect(link.href).toBe("/conteudo?range=all");

    // A fixture de produção, 7 dias: o mesmo texto ("há 2 dias") e o link com o período.
    const d = F.producaoConteudo();
    const { range, rangeKey } = pageRange(d, "7d", F.HOJE);
    const e7: EntradaInicio = { data: d, range, rangeKey, kpis: kpisDoPeriodo(d, range, { hoje: F.HOJE, agora: F.AGORA }), eventos: [], filaLive: [], agora: F.AGORA, hoje: F.HOJE };
    const ini7 = montarInicio(e7);
    const c7 = conteudoDa(d, "7d");
    const link7 = ini7.rodape.links.find((l) => l.id === "posts")!;
    expect(c7.placar.ultimo).toBe("Último post há 2 dias");
    expect(link7.rotulo).toBe(c7.placar.ultimo);
    expect(ini7.rodape.diasDesdeUltimoPost).toBe(c7.placar.numeros.diasDesdeUltimoPost);
    expect(link7.href).toBe("/conteudo?range=7d");
    expect(textoDoUltimoPost(2)).toBe(c7.placar.ultimo);
  });

  it("3. semana sem post não é 'há 0 dias' (pedido 3 do plano); sem post da grade no histórico = 'Nenhum post ainda'", () => {
    const c = conteudoDa(F.semPostNaSemana(), "7d");
    expect(c.placar.posts).toBe("Nenhum post no período");
    expect(c.placar.ultimo).toBe("Último post há 9 dias");
    expect(JSON.stringify(c)).not.toContain("há 0");
    expect(c.melhores).toBeNull();
    // Nunca houve post da grade: só um teste.
    const soTeste = conteudoDa(comPosts([F.post("IG-SO-TESTE", "2026-11-10", "12:00", "reel", "[TESTE] corte\nValidação.", { isTest: true })]));
    expect(soTeste.placar.ultimo).toBe("Nenhum post ainda");
    expect(soTeste.placar.numeros.diasDesdeUltimoPost).toBeNull();
    // Sem grade não há "a grade parou".
    expect(soTeste.acoes.map((a) => a.id)).not.toContain("no-recent-post");
    expect(soTeste.placar.dica).toContain("Nenhum post da grade em todo o histórico.");
  });

  it("4. seguidores: o líquido de resumoSeguidores = o da IA; sem total ou sem Instagram = 'Seguidores —' (nunca '+-')", () => {
    const e = entradaConteudoDa(F.producaoConteudo(), "30d");
    const c = montarConteudoDaTela(e);
    const seg = resumoSeguidores(e.data.igAccountDaily, e.range);
    expect(c.placar.seguidores).toBe(`Seguidores ${seg.liquidoTexto} (pago + orgânico)`);
    expect(c.placar.numeros.seguidoresLiquido).toBe(seg.liquido);
    expect(c.placar.numeros.seguidoresLiquido).toBe(briefingDa(e).perfil.ganhoLiquidoNoPeriodo);

    const semTotal = conteudoDa(F.semTotalDeSeguidores());
    expect(semTotal.placar.seguidores).toBe("Seguidores —");
    expect(semTotal.placar.numeros.seguidoresLiquido).toBeNull();
    expect(semTotal.placar.dica).toContain("Os snapshots do período vieram sem o total de seguidores.");

    const semIg = conteudoDa(F.semInstagram());
    expect(semIg.placar.seguidores).toBe("Seguidores —");
    expect(semIg.placar.numeros.seguidoresLiquido).toBeNull();
    expect(semIg.placar.dica).toContain("Sem dados do Instagram no período.");
    expect(semIg.conta).toBeNull();

    // Uma semana perdendo seguidores: o sinal é o "−" (U+2212), nunca "+-".
    const d = F.producaoConteudo();
    let total = d.igAccountDaily.find((r) => r.date === "2026-11-06")!.followers;
    const caindo = { ...d, igAccountDaily: d.igAccountDaily.map((r) => (r.date >= "2026-11-07" ? { ...r, followsDay: 0, unfollowsDay: 1, followers: --total } : r)) };
    const e7 = entradaConteudoDa(caindo, "7d");
    const c7 = montarConteudoDaTela(e7);
    expect(c7.placar.seguidores).toBe(`Seguidores ${resumoSeguidores(caindo.igAccountDaily, e7.range).liquidoTexto} (pago + orgânico)`);
    expect(c7.placar.seguidores).toMatch(/^Seguidores −6 \(pago \+ orgânico\)$/);

    for (const caso of CASOS) expect(JSON.stringify(montarConteudoDaTela(caso.entrada())), caso.nome).not.toContain("+-");
  });

  it("5. o ⓘ do placar: a nota dos 100+ (série desde 06/08 em Campanha); a frase dos leads só na marca de conversão", () => {
    const campanha = conteudoDa(F.producaoConteudo(), "all");
    expect(campanha.placar.dica).toContain("série disponível desde 06/08");
    expect(campanha.placar.dica).toContain("100+ seguidores");
    expect(conteudoDa(F.producaoConteudo()).placar.dica).toContain("cartão Leads do Início");
    expect(conteudoDa(F.kroneConteudo()).placar.dica).not.toContain("cartão Leads do Início");
    expect(conteudoDa(seedDaMarca("krone"), "all").placar.dica).not.toContain("cartão Leads do Início");
    // Pago + orgânico, no ⓘ (com total).
    expect(campanha.placar.dica).toContain("Pago + orgânico: a Meta não separa quem passou a seguir por causa de um anúncio.");
    // Quem ficou de fora no período (as partes com zero somem).
    expect(conteudoDa(F.producaoConteudo()).placar.dica).toContain("No período, 1 de teste e 2 impulsionados ficaram de fora; eles estão em Todos os posts.");
    expect(conteudoDa(F.producaoConteudo(), "7d").placar.dica).not.toContain("ficaram de fora");
  });

  it("6. desde quando conta a variação: véspera, ou a 1ª leitura do total (Campanha sem série completa)", () => {
    const krone = conteudoDa(seedDaMarca("krone"), "all");
    expect(krone.placar.dica).toContain("Sem leitura do total antes de 09/07");
    expect(krone.placar.dica).not.toContain("véspera");
    expect(krone.placar.seguidores).toBe("Seguidores +337 (pago + orgânico)");
    expect(conteudoDa(seedDaMarca(), "all").placar.dica).toContain("desde a véspera do período");
    expect(conteudoDa(F.producaoConteudo(), "30d").placar.dica).toContain("desde a véspera do período");
    // A produção em Campanha: o total só desde 01/07, ganhos e perdas só desde 06/08.
    const campanha = conteudoDa(F.producaoConteudo(), "all");
    expect(campanha.placar.dica).toContain("Sem leitura do total antes de 01/07: a variação conta a partir desse dia.");
    expect(campanha.placar.dica).not.toContain("véspera");
  });

  it("7. o dia do post é o de Brasília (F5-D25): o post das 21:30 de hoje conta hoje; nenhuma data exibida fora do período", () => {
    const c = conteudoDa(F.postDaNoite(), "7d", { agora: F.AGORA_NOITE });
    expect(c.placar.posts).toBe("1 post no período");
    expect(c.placar.ultimo).toBe("Último post hoje");
    expect(`${c.placar.posts} · ${c.placar.ultimo}`).not.toBe("Nenhum post no período · Último post hoje");
    expect(c.todos!.linhas.find((l) => l.id === "IG-NOITE-HOJE")?.data).toBe("13/11");
    expect(c.todos!.linhas.some((l) => l.id === "IG-NOITE-SEMANA")).toBe(false);
    const campanha = conteudoDa(F.postDaNoite(), "all", { agora: F.AGORA_NOITE });
    expect(campanha.todos!.linhas.find((l) => l.id === "IG-NOITE-SEMANA")?.data).toBe("06/11");

    // Para todo cartão, linha e registro: a data exibida é a do dia de Brasília e está no período.
    for (const caso of CASOS) {
      const e = caso.entrada();
      const t = montarConteudoDaTela(e);
      const porId = new Map(e.data.igPosts.map((p) => [p.id, p]));
      const conferir = (id: string, mostrado: string) => {
        const p = porId.get(id)!;
        const dia = diaDoPost(p);
        expect(inRange(dia, e.range), `${caso.nome}: ${id} (${dia})`).toBe(true);
        expect(mostrado, `${caso.nome}: ${id}`).toContain(formatDateShort(dia));
      };
      for (const l of t.todos?.linhas ?? []) conferir(l.id, l.data);
      for (const card of t.melhores?.cards ?? []) conferir(card.id, card.linha);
      for (const r of registrosDoPeriodo(e.data, e.range).linhas) conferir(r.id, r.quando);
    }
  });
});

// ---------------------------------------------------------------- 8–10. os melhores

describe("os posts que mais funcionaram (§2.4, F5-D3)", () => {
  it("8. rankingDaGrade: salvos + compartilhamentos → interações → alcance → recência → id; sem teste nem impulsionado; não muta a entrada", () => {
    const base = { reach: 60, views: 100, likes: 0, comments: 0, saved: 0, shares: 0 };
    const lista = [
      F.post("A", "2026-11-02", "12:00", "feed", "a", { ...base, saved: 2, likes: 3 }), // sc 2 · 5 interações
      F.post("B", "2026-11-03", "12:00", "feed", "b", { ...base, saved: 1, shares: 1, likes: 5 }), // sc 2 · 7 · alcance 60
      F.post("C", "2026-11-04", "12:00", "feed", "c", { ...base, saved: 2, likes: 5, reach: 100 }), // sc 2 · 7 · alcance 100
      F.post("D", "2026-11-05", "12:00", "feed", "d", { ...base, saved: 2, likes: 5, reach: 100 }), // igual a C, mais recente
      F.post("F", "2026-11-01", "12:00", "feed", "f", { ...base, saved: 3 }), // sc 3 · 3 interações
      F.post("T", "2026-11-01", "12:00", "reel", "t", { ...base, saved: 50, isTest: true }),
    ];
    const perf = postPerformance([lista[3], lista[0], lista[5], lista[2], lista[4], lista[1]], undefined, undefined, []);
    const antes = structuredClone(perf);
    expect(rankingDaGrade(perf).map((p) => p.id)).toEqual(["F", "D", "C", "B", "A"]);
    expect(perf).toEqual(antes);
    // Empate em tudo, inclusive no instante: o id decide — a mesma ordem em qualquer entrada.
    const gemeos = [F.post("E1", "2026-11-05", "12:00", "feed", "e", { ...base, saved: 1 }), F.post("E2", "2026-11-05", "12:00", "feed", "e", { ...base, saved: 1 })];
    const ida = rankingDaGrade(postPerformance(gemeos, undefined, undefined, [])).map((p) => p.id);
    const volta = rankingDaGrade(postPerformance([...gemeos].reverse(), undefined, undefined, [])).map((p) => p.id);
    expect(ida).toEqual(volta);
    // Lista vazia; todos com 0 interação → melhores vazio.
    expect(rankingDaGrade([])).toEqual([]);
    expect(melhoresDaGrade(postPerformance([F.post("Z", "2026-11-05", "12:00", "feed", "z", base)], undefined, undefined, []))).toEqual([]);

    // A produção: o teste e o impulsionado têm MAIS salvos, compartilhamentos e interações — e nunca entram.
    for (const chave of ["30d", "all"]) {
      const e = entradaConteudoDa(F.producaoConteudo(), chave);
      const posts = postsDa(e);
      const teste = posts.find((p) => p.id === F.IDS_CONTEUDO.teste)!;
      const imp = posts.find((p) => p.id === F.IDS_CONTEUDO.impulsionado)!;
      const daGrade = posts.filter((p) => !p.isTest && !p.boosted);
      for (const p of [teste, imp]) {
        expect(daGrade.every((g) => g.saved + g.shares < p.saved + p.shares && g.interactions < p.interactions), p.id).toBe(true);
      }
      const ids = rankingDaGrade(posts).map((p) => p.id);
      expect(ids).not.toContain(F.IDS_CONTEUDO.teste);
      expect(ids).not.toContain(F.IDS_CONTEUDO.impulsionado);
      expect(ids).not.toContain(F.IDS_CONTEUDO.impulsionadoNoGrupo);
      expect(montarConteudoDaTela(e).melhores!.cards.map((c) => c.id)).toEqual([F.IDS_CONTEUDO.melhor1, F.IDS_CONTEUDO.melhor2, F.IDS_CONTEUDO.melhor3]);
    }

    // Muitas curtidas e nenhum salvo × menos curtidas e 2 salvos: o salvo vence.
    const sc = entradaConteudoDa(F.salvosContraCurtidas());
    expect(rankingDaGrade(postsDa(sc)).map((p) => p.id)).toEqual(["IG-SALVOS", "IG-CURTIDAS"]);
  });

  it("9. o título diz a chave que DECIDIU (§2.4) e nunca chama empate de 'lidera'", () => {
    const titulo = (c: ConteudoDaTela) => c.melhores?.titulo;
    const semInt = conteudoDa(F.semInteracao());
    expect(titulo(semInt)).toBe("Nenhum post da grade teve interação no período");
    expect(semInt.melhores!.cards).toEqual([]);
    const um = conteudoDa(F.umPostDaGrade());
    expect(titulo(um)).toBe("1 post da grade, com 42 interações");
    expect(um.melhores!.cards).toHaveLength(1);
    const empate = conteudoDa(F.empateNoTopo());
    expect(titulo(empate)).toBe("2 posts empatam com 11 interações");
    expect(empate.melhores!.cards.map((c) => c.id)).toEqual(["IG-EMPATE-90", "IG-EMPATE-70", "IG-TERCEIRO"]);
    expect(titulo(conteudoDa(F.salvosContraCurtidas()))).toBe("Carrossel de 06/11 lidera: 2 salvos");
    expect(titulo(conteudoDa(F.lideraPorInteracoes()))).toBe("Feed de 04/11 lidera com 11 interações");
    expect(titulo(conteudoDa(F.producaoConteudo()))).toBe("Reel de 06/11 lidera: 6 salvos, 3 compartilhamentos");

    const seed = conteudoDa(seedDaMarca(), "all");
    expect(titulo(seed)).toBe("Carrossel de 23/07 lidera: 93 salvos, 67 compartilhamentos");
    expect(seed.melhores!.cards.map((c) => c.id)).toEqual(["POST-09", "POST-07", "POST-06"]);
    const krone = conteudoDa(seedDaMarca("krone"), "all");
    expect(titulo(krone)).toBe("Feed de 18/07 lidera: 99 salvos, 74 compartilhamentos");
    expect(krone.melhores!.cards.map((c) => c.id)).toEqual(["KPOST-04", "KPOST-05", "KPOST-03"]);

    // Nenhum período sem post da grade tem bloco de melhores.
    expect(conteudoDa(seedDaMarca()).melhores).toBeNull();

    for (const caso of CASOS) {
      const c = montarConteudoDaTela(caso.entrada());
      if (!c.melhores) continue;
      expect(nPalavras(c.melhores.titulo), `${caso.nome}: ${c.melhores.titulo}`).toBeLessThanOrEqual(8);
      expect(c.melhores.cards.length).toBeLessThanOrEqual(3);
      for (const card of c.melhores.cards) {
        expect(nPalavras(card.linha), card.linha).toBeLessThanOrEqual(8);
        expect(card.linha, card.linha).toMatch(/\bsalvos?\b/);
        expect(card.linha).toContain("compart.");
        expect(card.linha, card.linha).toMatch(/interaç(ão|ões)/);
      }
      if (/empatam/.test(c.melhores.titulo)) expect(c.melhores.titulo).not.toContain("lidera");
    }
  });

  it("10. a IA usa a MESMA régua no MESMO período: melhores na ordem dos cartões; piores do fim do ranking, nunca um melhor", () => {
    const tupla = (p: PostPerf) => [p.saved, p.shares, p.type];
    const ePiores = (p: PostPerf) => [p.reach, p.saved, p.shares, p.interactions, p.type];
    for (const e of [entradaConteudoDa(F.producaoConteudo(), "30d"), entradaConteudoDa(F.producaoConteudo(), "all"), entradaConteudoDa(seedDaMarca(), "all")]) {
      const c = montarConteudoDaTela(e);
      const ia = briefingDa(e).organico;
      const posts = postsDa(e);
      const melhores = melhoresDaGrade(posts, 3);
      expect(c.melhores!.cards.map((x) => x.id), e.rangeKey).toEqual(melhores.map((p) => p.id));
      expect(ia.melhoresPosts.map((p) => [p.salvos, p.compartilhamentos, p.formato]), e.rangeKey).toEqual(melhores.map(tupla));
      expect(ia.melhoresPosts.map((p) => p.interacoes)).toEqual(melhores.map((p) => p.interactions));
      for (const [i, card] of c.melhores!.cards.entries()) expect(card.linha).toContain(`${formatInt(melhores[i].saved)} salvo`);
      // Os piores: o fim do ranking, do último ao penúltimo, sem repetir um melhor.
      const ranking = rankingDaGrade(posts);
      const piores = ranking.slice(Math.max(melhores.length, ranking.length - 2)).reverse();
      expect(ia.pioresPosts.map((p) => [p.alcance, p.salvos, p.compartilhamentos, p.interacoes, p.formato])).toEqual(piores.map(ePiores));
      const idsMelhores = new Set(melhores.map((p) => p.id));
      for (const p of piores) expect(idsMelhores.has(p.id), p.id).toBe(false);
    }
    // Sobra nenhum post depois dos melhores: piores vazio.
    const um = entradaConteudoDa(F.umPostDaGrade());
    expect(rankingDaGrade(postsDa(um)).length).toBeLessThanOrEqual(melhoresDaGrade(postsDa(um), 3).length);
    expect(briefingDa(um).organico.pioresPosts).toEqual([]);
    // Interações [5, 0, 0]: 1 melhor; os 2 de 0 interação são os piores, do último ao penúltimo.
    const zero = { likes: 0, comments: 0, saved: 0, shares: 0 };
    const tres = entradaConteudoDa(
      comPosts([
        F.post("IG-CINCO", "2026-11-02", "12:00", "reel", "Cinco interações\nAssista.", { reach: 70, likes: 5, comments: 0, saved: 0, shares: 0 }),
        F.post("IG-ZERO-B", "2026-11-03", "12:00", "feed", "Zero B\nAssista.", { ...zero, reach: 80 }),
        F.post("IG-ZERO-C", "2026-11-04", "12:00", "feed", "Zero C\nAssista.", { ...zero, reach: 50 }),
      ]),
    );
    const ia = briefingDa(tres).organico;
    expect(rankingDaGrade(postsDa(tres)).map((p) => p.id)).toEqual(["IG-CINCO", "IG-ZERO-B", "IG-ZERO-C"]);
    expect(ia.melhoresPosts).toHaveLength(1);
    expect(ia.melhoresPosts[0].interacoes).toBe(5);
    expect(ia.pioresPosts.map((p) => p.alcance)).toEqual([50, 80]);
    expect(ia.pioresPosts.map((p) => p.interacoes)).toEqual([0, 0]);
  });
});

// ---------------------------------------------------------------- 11–12. miniatura, legenda e hora

describe("miniatura, legenda e hora do post (§3.5, F5-D17, F5-D18)", () => {
  const agoraMs = Date.parse(F.AGORA);
  const porId = new Map(F.producaoConteudo().igPosts.map((p) => [p.id, p]));
  const p = (id: string) => porId.get(id)!;

  it("11. miniaturaDoPost: reel = só a capa; os outros, a imagem que não é vídeo; vencida, ausente ou http → null", () => {
    expect(miniaturaDoPost(p(F.IDS_CONTEUDO.melhor1), agoraMs)).toBe(p(F.IDS_CONTEUDO.melhor1).thumbnailUrl);
    expect(p(F.IDS_CONTEUDO.melhor1).mediaUrl).toMatch(/\.mp4\?/);
    expect(miniaturaDoPost(p(F.IDS_CONTEUDO.reelSoMp4), agoraMs)).toBeNull();
    expect(miniaturaDoPost(p(F.IDS_CONTEUDO.melhor2), agoraMs)).toBe(p(F.IDS_CONTEUDO.melhor2).mediaUrl);
    expect(miniaturaDoPost(p(F.IDS_CONTEUDO.melhor3), agoraMs)).toBeNull();
    expect(miniaturaDoPost({ ...p(F.IDS_CONTEUDO.melhor2), mediaUrl: p(F.IDS_CONTEUDO.melhor2).mediaUrl!.replace("https:", "http:") }, agoraMs)).toBeNull();
    expect(miniaturaDoPost({ ...p(F.IDS_CONTEUDO.melhor2), mediaUrl: undefined }, agoraMs)).toBeNull();
    // Um feed com o `.mp4` como mídia (sem capa) não vira <img> de vídeo.
    expect(miniaturaDoPost({ ...p(F.IDS_CONTEUDO.melhor2), mediaUrl: F.urlDoCdn("x", F.OE_VALIDO, "mp4") }, agoraMs)).toBeNull();
    expect(FORMATO_DA_MINIATURA).toEqual({ reel: "video", carrossel: "carrossel", feed: "imagem", story: "imagem" });
    expect(ROTULO_DO_TIPO).toEqual({ feed: "Feed", carrossel: "Carrossel", reel: "Reel", story: "Story" });
    // A Mídia reexporta a MESMA função.
    expect(miniaturaValidaDaMidia).toBe(miniaturaValida);
    // Os cartões da produção: a capa e a imagem válidas; a vencida vira null (o quadrado do ícone).
    const cards = conteudoDa(F.producaoConteudo()).melhores!.cards;
    expect(cards.map((c) => [c.miniatura, c.formato])).toEqual([
      [p(F.IDS_CONTEUDO.melhor1).thumbnailUrl, "video"],
      [p(F.IDS_CONTEUDO.melhor2).mediaUrl, "carrossel"],
      [null, "imagem"],
    ]);
  });

  it("12. legendaCurta: a 1ª linha, ≤ 8 palavras ou 60 caracteres + '…'; vazia = 'Sem legenda'. horaDoPost: Brasília", () => {
    expect(legendaCurta("Primeira linha curta\nSegunda linha que nunca aparece")).toBe("Primeira linha curta");
    expect(legendaCurta("\n\n  Depois das linhas vazias  \noutra")).toBe("Depois das linhas vazias");
    expect(legendaCurta("um dois três quatro cinco seis sete oito nove dez onze doze")).toBe("um dois três quatro cinco seis sete oito…");
    const longas = "Consórcio imobiliário extraordinariamente vantajoso independentemente circunstâncias";
    expect(nPalavras(longas)).toBe(6);
    expect(longas.length).toBeGreaterThan(60);
    const cortada = legendaCurta(longas);
    expect(cortada.endsWith("…")).toBe(true);
    expect(cortada.slice(0, -1).length).toBeLessThanOrEqual(60);
    expect(longas.startsWith(cortada.slice(0, -1))).toBe(true);
    expect(legendaCurta("(sem legenda)")).toBe("Sem legenda");
    expect(legendaCurta("")).toBe("Sem legenda");
    expect(legendaCurta(undefined)).toBe("Sem legenda");
    // Emoji e "—" não contam como palavra.
    const comSimbolos = legendaCurta("Carta — 🚀 um dois três quatro cinco seis sete oito nove");
    expect(nPalavras(comSimbolos.replace(/…$/, ""))).toBe(8);
    expect(comSimbolos).toContain("—");
    expect(comSimbolos).toContain("🚀");
    // Nunca termina em espaço antes do "…".
    for (const t of ["um dois três quatro cinco seis sete oito — nove", "a b c d e f g h i", longas, F.LEGENDA_LONGA]) {
      expect(legendaCurta(t)).not.toMatch(/\s…$/);
      expect(nPalavras(legendaCurta(t))).toBeLessThanOrEqual(8);
    }
    // Uma URL sozinha maior que 60 caracteres: cortada em 60 + "…".
    const url = `https://exemplo.com.br/${"a".repeat(80)}`;
    expect(legendaCurta(url)).toBe(`${url.slice(0, 60)}…`);
    // A legenda longa da fixture: só a 1ª linha.
    expect(legendaCurta(F.LEGENDA_LONGA)).toBe("Planejamento patrimonial começa pela conta certa");

    expect(horaDoPost({ publishedAt: "2026-11-14T00:30:00.000Z" })).toBe("21:30");
    expect(horaDoPost({ publishedAt: "2026-07-23T15:00:00" })).toBe("15:00");
    expect(horaDoPost({ publishedAt: F.post("X", "2026-11-03", "22:40", "reel", "x").publishedAt })).toBe("22:40");
  });
});

// ---------------------------------------------------------------- 13–18. as ações

describe("as ações da grade (§2.5, F5-D8, F5-D31, F5-D32, F5-D34)", () => {
  it("13. no máximo 2, todas de IDS_DE_CONTEUDO, uma linha ≤ 10 palavras que abre com o verbo; → Produção com o período; Krone sem ação", () => {
    for (const caso of CASOS) {
      const e = caso.entrada();
      const c = montarConteudoDaTela(e);
      expect(c.acoes.length, caso.nome).toBeLessThanOrEqual(2);
      for (const a of c.acoes) {
        expect((IDS_DE_CONTEUDO as readonly string[]).includes(a.id), `${caso.nome}: ${a.id}`).toBe(true);
        expect(nPalavras(a.linha), a.linha).toBeLessThanOrEqual(10);
        expect(VERBOS.has(a.linha.split(" ")[0].replace(/:$/, "")), a.linha).toBe(true);
        expect(nPalavras(`${a.linha} → ${a.destino?.rotulo ?? ""}`), a.linha).toBeLessThanOrEqual(12);
        expect(a.rotulo).toMatch(/^Sobre a ação “.+”$/);
        expect(a.dica.length).toBeGreaterThan(0);
        if (e.marca === "consorcio") expect(a.destino, a.id).toEqual({ href: `/conteudo/producao?range=${e.rangeKey}`, rotulo: "Produção" });
      }
      if (e.marca === "krone") expect(c.acoes, caso.nome).toEqual([]);
    }
    expect(conteudoDa(F.producaoConteudo()).acoes.map((a) => a.destino?.href)).toEqual(["/conteudo/producao?range=30d", "/conteudo/producao?range=30d"]);
    expect(conteudoDa(F.producaoConteudo(), "all").acoes.every((a) => a.destino?.href === "/conteudo/producao?range=all")).toBe(true);
  });

  it("13b. acoesDaGrade: corta em 2, tira o pileup com grupo pendente no período, rótulo e destino", () => {
    const rec = (id: string, linha: string | undefined, href: string): Recommendation => ({ id, severity: "media", title: `Título ${id}`, detail: `Detalhe ${id}.`, href, dono: "MKT", ...(linha ? { linha } : {}) });
    const recs = [
      rec("same-day-pileup", "Espace os posts: 2 no mesmo dia, em 06/11", "/conteudo/producao"),
      rec("grade-composicao", undefined, "/conteudo/producao"),
      rec("cta-dm-excess", "Peça menos DM: 40,0% dos posts pedem DM", "/conteudo/producao"),
      rec("grade-da-semana", "Complete a grade da semana: 1 de 6 com peça", "/conteudo/producao"),
    ];
    expect(acoesDaGrade(recs, "30d", 0).map((a) => a.id)).toEqual(["same-day-pileup", "cta-dm-excess"]);
    expect(acoesDaGrade(recs, "30d", 1).map((a) => a.id)).toEqual(["cta-dm-excess", "grade-da-semana"]);
    const [a] = acoesDaGrade(recs, "7d", 1);
    expect(a).toEqual({ id: "cta-dm-excess", linha: "Peça menos DM: 40,0% dos posts pedem DM", destino: { href: "/conteudo/producao?range=7d", rotulo: "Produção" }, dica: "Detalhe cta-dm-excess.", rotulo: "Sobre a ação “Título cta-dm-excess”" });
    // Sem a Produção (sem playbook), a linha não vira link para a própria página.
    expect(acoesDaGrade([rec("no-recent-post", "Publique hoje: 4 dias sem post da grade", "/conteudo")], "30d", 0)[0].destino).toBeNull();
  });

  it("14. cada regra de IDS_DE_CONTEUDO preenche `linha` com o texto do §2.5", () => {
    const naRegra = (d: DashboardData, chave: string | undefined, id: string, o: { hoje?: string } = {}) => {
      const e = entradaConteudoDa(d, chave, o);
      return recsDa(e).find((r) => r.id === id)?.linha;
    };
    expect(naRegra(F.semPostNaSemana(), "7d", "no-recent-post")).toBe("Publique hoje: 9 dias sem post da grade");
    expect(naRegra(F.pileupSemVariacao(), "30d", "same-day-pileup")).toBe("Espace os posts: 2 no mesmo dia, em 06/11");
    expect(naRegra(F.producaoConteudo(), "all", "same-day-pileup")).toBe(`Espace os posts: ${F.GRUPOS_NA_GRADE} dias com 2 ou mais`);
    expect(naRegra(F.tercaSemSegunda(), "30d", "grade-da-semana", { hoje: F.HOJE_TERCA })).toBe("Complete a grade da semana: 0 de 6 com peça");
    // Retenção em %: reels com a duração (20 s), 25% contra 50% no período anterior.
    const ret = comPosts([
      F.post("IG-RET-1", "2026-11-09", "12:00", "reel", "Reel novo\nAssista.", { durationSec: 20, avgWatchTime: 5 }),
      F.post("IG-RET-0", "2026-11-03", "12:00", "reel", "Reel anterior\nAssista.", { durationSec: 20, avgWatchTime: 10 }),
    ]);
    expect(naRegra(ret, "7d", "retention-drop")).toBe(`Revise o gancho dos reels: retenção ${formatPercent(0.25)} contra ${formatPercent(0.5)}`);
    // Tempo assistido (sem duração): o pior caso, 12,3 s contra 45,6 s.
    expect(naRegra(F.piorCasoDeTexto(), F.CHAVE_DO_PIOR_CASO, "retention-drop")).toBe("Revise o gancho: reels com 12,3 s contra 45,6 s");
    const tempo = comPosts([
      F.post("IG-TMP-1", "2026-11-09", "12:00", "reel", "Reel novo\nAssista.", { avgWatchTime: 6 }),
      F.post("IG-TMP-0", "2026-11-03", "12:00", "reel", "Reel anterior\nAssista.", { avgWatchTime: 12 }),
    ]);
    expect(naRegra(tempo, "7d", "retention-drop")).toBe(`Revise o gancho: reels com ${formatDecimal(6, 1)} s contra ${formatDecimal(12, 1)} s`);
    // Reels longos: acima de 25 s (média) e de 30 s (alta).
    expect(naRegra(comPosts([F.post("IG-28S", "2026-11-09", "12:00", "reel", "Reel de 28 s\nAssista.", { durationSec: 28 })]), "7d", "reels-too-long")).toBe(
      "Encurte os reels: 1 acima de 25s",
    );
    expect(
      naRegra(
        comPosts([
          F.post("IG-35S", "2026-11-09", "12:00", "reel", "Reel de 35 s\nAssista.", { durationSec: 35 }),
          F.post("IG-40S", "2026-11-11", "12:00", "reel", "Reel de 40 s\nAssista.", { durationSec: 40 }),
        ]),
        "7d",
        "reels-too-long",
      ),
    ).toBe("Encurte os reels: 2 acima de 30s");
    // CTA de DM: o % do agregado do período.
    const e30 = entradaConteudoDa(F.producaoConteudo(), "30d");
    const share = aggregatePostPerformance(postsDa(e30)).dmCtaShare;
    expect(share).toBeGreaterThan(0.25);
    expect(naRegra(F.producaoConteudo(), "30d", "cta-dm-excess")).toBe(`Peça menos DM: ${formatPercent(share)} dos posts pedem DM`);
    // Cards de frase.
    const frase = comPosts([
      F.post("IG-FRASE-1", "2026-11-09", "12:00", "feed", "Frase 1\nPense nisso.", { pillar: "Card de frase" }),
      F.post("IG-FRASE-2", "2026-11-11", "12:00", "feed", "Frase 2\nPense nisso.", { pillar: "Motivacional" }),
    ]);
    expect(naRegra(frase, "7d", "pillar-frase")).toBe("Tire os cards de frase: 2 no período");
    // Toda linha ≤ 10 palavras, abrindo com o verbo.
    for (const d of [F.producaoConteudo(), F.pileupSemVariacao(), ret, tempo, frase]) {
      for (const r of recsDa(entradaConteudoDa(d, "30d"))) {
        if (!(IDS_DE_CONTEUDO as readonly string[]).includes(r.id)) continue;
        expect(r.linha, r.id).toBeDefined();
        expect(nPalavras(r.linha!), r.linha).toBeLessThanOrEqual(10);
        expect(VERBOS.has(r.linha!.split(" ")[0].replace(/:$/, "")), r.linha).toBe(true);
      }
    }
  });

  it("15. vanity-objective só na awareness (com /midia#conjuntos e MKT); nunca dias-sem-story; grade-composicao fica na IA e fora da tela", () => {
    // A rotina de presença registrada com dias sem story (a regra antiga dispararia).
    const comRotina = (d: DashboardData): DashboardData => ({
      ...d,
      igAccountDaily: d.igAccountDaily.map((r) => (r.date >= "2026-10-01" ? { ...r, storiesPosted: 0, storiesInteractive: 0, nicheComments: 0, accountsFollowed: 0, repliedAll: false } : r)),
    });
    for (const chave of ["30d", "7d", "all"]) {
      const e = entradaConteudoDa(comRotina(F.producaoConteudo()), chave);
      // A fixture tem descoberta VIDEO_VIEWS com gasto no período.
      expect(e.data.adDaily.some((r) => r.objective === "VIDEO_VIEWS" && r.spend > 0 && inRange(r.date, e.range)), chave).toBe(true);
      const ids = recsDa(e).map((r) => r.id);
      expect(ids, chave).not.toContain("vanity-objective");
      expect(ids, chave).not.toContain("dias-sem-story");
      for (const r of recsDa(e)) {
        if ((IDS_DE_CONTEUDO as readonly string[]).includes(r.id) || r.id === "grade-composicao") expect(r.href, r.id).toBe("/conteudo/producao");
      }
    }
    const k = entradaConteudoDa(comRotina(F.kroneConteudo()), "30d");
    const recsK = recsDa(k);
    expect(recsK.find((r) => r.id === "vanity-objective")).toMatchObject({ href: "/midia#conjuntos", dono: "MKT" });
    expect(recsK.map((r) => r.id)).not.toContain("dias-sem-story");
    for (const r of recsK) {
      if ((IDS_DE_CONTEUDO as readonly string[]).includes(r.id) || r.id === "grade-composicao") expect(r.href, r.id).toBe("/conteudo");
    }
    // A média do período continua na lista (para a IA), com o título novo — e nunca na tela.
    const e30 = entradaConteudoDa(F.producaoConteudo(), "30d");
    const gc = recsDa(e30).find((r) => r.id === "grade-composicao");
    expect(gc?.title).toBe("Equilibre os formatos da grade");
    for (const caso of CASOS) expect(montarConteudoDaTela(caso.entrada()).acoes.map((a) => a.id), caso.nome).not.toContain("grade-composicao");
    // A IA recebe a lista inteira (com a média do período).
    expect(briefingDa(e30).alertasJaDetectados.map((a) => a.titulo)).toContain("Equilibre os formatos da grade");
  });

  it("16. a grade da SEMANA CORRENTE (F5-D31): a MESMA conta da Produção, no dia de Brasília", () => {
    // A grade em dia: nenhuma ação, mesmo com a média de carrosséis do período baixa.
    const g = F.gradeCompleta();
    const eg = entradaConteudoDa(g.data, "30d", { drafts: g.drafts });
    expect(recsDa(eg).map((r) => r.id)).toContain("grade-composicao");
    expect(recsDa(eg).map((r) => r.id)).not.toContain("grade-da-semana");
    expect(montarConteudoDaTela(eg).acoes.map((a) => a.id)).not.toContain("grade-da-semana");
    expect(gradeDaSemana(g.data.igPosts, g.drafts, F.HOJE)).toMatchObject({ preenchidos: 6, slotsDeFeed: 6, vaziosAntesDeHoje: [] });

    // Terça sem a segunda: "0 de 6".
    const terca = conteudoDa(F.tercaSemSegunda(), "30d", { hoje: F.HOJE_TERCA });
    expect(terca.acoes.find((a) => a.id === "grade-da-semana")?.linha).toBe("Complete a grade da semana: 0 de 6 com peça");
    expect(gradeDaSemana(F.tercaSemSegunda().igPosts, [], F.HOJE_TERCA).vaziosAntesDeHoje).toEqual(["2026-11-09"]);

    // Segunda-feira sem nada: nenhum dia de feed antes de hoje.
    const segunda = conteudoDa(F.tercaSemSegunda(), "30d", { hoje: F.HOJE_SEGUNDA });
    expect(segunda.acoes.map((a) => a.id)).not.toContain("grade-da-semana");
    expect(gradeDaSemana(F.tercaSemSegunda().igPosts, [], F.HOJE_SEGUNDA).vaziosAntesDeHoje).toEqual([]);

    // Os números da linha são os da Produção (`gradeDaSemana`).
    const d = F.producaoConteudo();
    const gs = gradeDaSemana(d.igPosts, [], F.HOJE);
    expect(gs.slotsDeFeed).toBe(6);
    expect(conteudoDa(d).acoes.find((a) => a.id === "grade-da-semana")?.linha).toBe(`Complete a grade da semana: ${gs.preenchidos} de ${gs.slotsDeFeed} com peça`);

    // Uma peça planejada para o dia vazio tira o dia de `vaziosAntesDeHoje`.
    const comPeca = gradeDaSemana(F.tercaSemSegunda().igPosts, [F.peca("PECA-SEG", "2026-11-09", "carrossel")], F.HOJE_TERCA);
    expect(comPeca.vaziosAntesDeHoje).toEqual([]);
    expect(comPeca.preenchidos).toBe(1);
    // Peça descartada não conta.
    expect(gradeDaSemana(F.tercaSemSegunda().igPosts, [F.peca("PECA-X", "2026-11-09", "carrossel", { status: "descartado" })], F.HOJE_TERCA).vaziosAntesDeHoje).toEqual(["2026-11-09"]);

    // Um post às 22h de Brasília de segunda conta na segunda (não na terça).
    const noite = gradeDaSemana([F.post("IG-SEG-22H", "2026-11-09", "22:00", "carrossel", "x")], [], F.HOJE_TERCA);
    expect(noite.dias.find((x) => x.dia === "2026-11-09")?.publicados).toBe(1);
    expect(noite.dias.find((x) => x.dia === "2026-11-10")?.publicados).toBe(0);
    expect(noite.vaziosAntesDeHoje).toEqual([]);
  });

  it("17. as do AGORA aparecem em qualquer período (F5-D34); as do período, não", () => {
    for (const chave of ["30d", "7d"]) {
      const c = conteudoDa(seedDaMarca(), chave);
      expect(c.acoes.map((a) => a.id), chave).toEqual(["no-recent-post", "grade-da-semana"]);
      expect(c.acoes[0].linha).toBe("Publique hoje: 113 dias sem post da grade");
      expect(c.placar.posts).toBe("Nenhum post no período");
    }
    const e = entradaConteudoDa(seedDaMarca(), F.CHAVE_NAO_COMECOU);
    expect(e.naoComecou).toBe(true);
    expect(montarConteudoDaTela(e).acoes.map((a) => a.id)).toEqual(["no-recent-post", "grade-da-semana"]);
    for (const r of recsDa(e)) expect(["no-recent-post", "grade-da-semana"], r.id).toContain(r.id);
  });

  it("18. pileup × variações (F5-D32): com grupo do período, a tela não mostra 'Espace os posts' (a IA mantém)", () => {
    const e = entradaConteudoDa(F.producaoConteudo(), "30d");
    const c = montarConteudoDaTela(e);
    expect(variacoesNaGrade(e.data.igPosts, e.data.creatives, e.range).length).toBe(1);
    expect(c.acoes.map((a) => a.id)).not.toContain("same-day-pileup");
    expect(c.acoes).toHaveLength(2);
    expect(recsDa(e).map((r) => r.id)).toContain("same-day-pileup");
    expect(briefingDa(e).alertasJaDetectados.map((a) => a.titulo)).toContain(recsDa(e).find((r) => r.id === "same-day-pileup")!.title);
    expect(c.variacoes).not.toBeNull();
    const p = conteudoDa(F.pileupSemVariacao());
    expect(p.variacoes).toBeNull();
    expect(p.acoes.find((a) => a.id === "same-day-pileup")?.linha).toBe("Espace os posts: 2 no mesmo dia, em 06/11");
  });
});

// ---------------------------------------------------------------- 19–20. as variações

describe("os posts iguais no mesmo dia (§2.3, F5-D9, F5-D36)", () => {
  it("19. histórico inteiro e só com 2+ na grade: a linha, a lista, o impulsionado fora de `naGrade`", () => {
    const totais = ["7d", "30d", "all"].map((k) => conteudoDa(F.producaoConteudo(), k).variacoes?.total);
    expect(totais).toEqual([F.GRUPOS_NA_GRADE, F.GRUPOS_NA_GRADE, F.GRUPOS_NA_GRADE]);
    const d = F.producaoConteudo();
    expect(variacoesNaGrade(d.igPosts, d.creatives, undefined).length).toBe(F.GRUPOS_NA_GRADE);
    const v = conteudoDa(d).variacoes!;
    expect(v.linha).toBe("13 grupos de posts iguais no mesmo dia para conferir");
    expect(v.registrosHref).toBe("/conteudo/registros?range=all#posts");
    expect(v.lista).toHaveLength(13);
    // Do dia mais recente para o mais antigo.
    expect(v.lista[0].diaTexto).toBe("03/11");
    expect([...v.lista].map((g) => g.chave.slice(0, 10))).toEqual([...v.lista].map((g) => g.chave.slice(0, 10)).sort().reverse());
    // O grupo de 7 posts em 28/07.
    expect(v.lista.find((g) => g.diaTexto === "28/07")?.posts).toHaveLength(7);
    // O do período: a hora de Brasília (21:10 e 22:40 de 03/11).
    expect(v.lista[0].posts.map((p) => p.hora)).toEqual(["21:10", "22:40"]);
    const porId = new Map(d.igPosts.map((p) => [p.id, p]));
    for (const g of v.lista) {
      expect(g.naGrade.length, g.chave).toBeGreaterThanOrEqual(2);
      expect(nPalavras(g.legenda.replace(/…$/, "")), g.legenda).toBeLessThanOrEqual(8);
      expect(g.legenda).not.toContain("\n");
      for (const id of g.naGrade) expect(g.posts.find((p) => p.id === id)?.estado, id).toBe("grade");
      expect(g.posts.filter((p) => p.estado === "grade").map((p) => p.id)).toEqual(g.naGrade);
      for (const p of g.posts) {
        expect(p.hora, p.id).toMatch(/^\d{2}:\d{2}$/);
        expect(p.href, p.id).toBe(porId.get(p.id)!.permalink);
        expect(Object.keys(p).sort()).toEqual(["estado", "hora", "href", "id", "tipo"]);
      }
    }
    // O impulsionado do grupo de 12/08: no grupo, com selo, nunca em `naGrade`.
    const g12 = v.lista.find((g) => g.posts.some((p) => p.id === F.IDS_CONTEUDO.impulsionadoNoGrupo))!;
    expect(g12.posts.find((p) => p.id === F.IDS_CONTEUDO.impulsionadoNoGrupo)?.estado).toBe("impulsionado");
    expect(g12.naGrade).not.toContain(F.IDS_CONTEUDO.impulsionadoNoGrupo);
    expect(g12.naGrade).toHaveLength(3);
    // O par [orgânico + impulsionado] e o grupo com 1 na grade ficam fora.
    const listados = new Set(v.lista.flatMap((g) => g.posts.map((p) => p.id)));
    expect(listados.has(F.IDS_CONTEUDO.impulsionadoDoPar)).toBe(false);
    expect(listados.has("IG-NG1-1")).toBe(false);
    // `variacoesDeAnuncio` não muda: o grupo com 1 pendente continua lá (o filtro é de `variacoesNaGrade`).
    const resolvido = variacoesDeAnuncio(d.igPosts).find((g) => g.dia === "2026-09-16");
    expect(resolvido?.pendentes).toEqual(["IG-NG1-1"]);

    // Todos resolvidos: sem linha.
    expect(conteudoDa(F.variacoesResolvidas()).variacoes).toBeNull();
    // Um grupo só: a linha no singular.
    const grupos = F.gruposDaProducao();
    const outros = new Set(grupos.slice(0, 12).flat());
    const um = conteudoDa({ ...d, igPosts: d.igPosts.filter((p) => !outros.has(p.id)) });
    expect(um.variacoes?.linha).toBe("1 grupo de posts iguais no mesmo dia para conferir");
    expect(um.variacoes?.total).toBe(1);
    // Nenhuma legenda inteira na lista.
    const legendas = new Set(d.igPosts.map((p) => p.caption));
    for (const g of v.lista) expect(legendas.has(g.legenda), g.legenda).toBe(false);
  });

  it("20. o item 3 do ⓘ do placar usa só os grupos DO período", () => {
    const c7 = conteudoDa(F.producaoConteudo(), "7d");
    expect(c7.variacoes?.total).toBe(13);
    expect(c7.placar.dica).not.toMatch(/grupos? de posts iguais/);
    const c30 = conteudoDa(F.producaoConteudo(), "30d");
    expect(c30.placar.dica).toContain("1 grupo de posts iguais no mesmo dia do período ainda conta como posts da grade.");
    expect(conteudoDa(F.producaoConteudo(), "all").placar.dica).toContain("13 grupos de posts iguais no mesmo dia do período ainda contam como posts da grade.");
  });
});

// ---------------------------------------------------------------- 21. Registros

describe("Registros (lib, §2.11, F5-D33)", () => {
  it("21. o 'da grade' do título é o do placar; as partes somam a lista; cada linha com 'dd/mm hh:mm', legenda curta e o tipo cru", () => {
    const casos = [
      entradaConteudoDa(F.producaoConteudo(), "30d"),
      entradaConteudoDa(F.producaoConteudo(), "7d"),
      entradaConteudoDa(F.producaoConteudo(), "all"),
      entradaConteudoDa(F.postDaNoite(), "7d", { agora: F.AGORA_NOITE }),
      entradaConteudoDa(seedDaMarca(), "all"),
      entradaConteudoDa(seedDaMarca()),
    ];
    for (const e of casos) {
      const r = registrosDoPeriodo(e.data, e.range);
      const c = montarConteudoDaTela(e);
      const posts = postPerformance(e.data.igPosts, e.range, undefined, e.data.creatives);
      const k = contagemDaGrade(posts);
      expect(k.grade, e.rangeKey).toBe(c.placar.numeros.posts);
      expect(k.grade + k.testes + k.impulsionados, e.rangeKey).toBe(r.linhas.length);
      expect(k.total).toBe(r.linhas.length);
      expect(r.titulo).toBe(tituloDosRegistros(k));
      const porId = new Map(e.data.igPosts.map((p) => [p.id, p]));
      for (const l of r.linhas) {
        const p = porId.get(l.id)!;
        expect(l.quando, l.id).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
        expect(l.quando).toBe(`${formatDateShort(diaDoPost(p))} ${horaDoPost(p)}`);
        expect(nPalavras(l.legenda.replace(/…$/, ""))).toBeLessThanOrEqual(8);
        expect(l.href).toBe(p.permalink);
        expect(l.tipo).toBe(p.type);
        expect(l.tipoTexto).toBe(ROTULO_DO_TIPO[p.type]);
      }
      // Do mais recente ao mais antigo.
      const instantes = r.linhas.map((l) => Date.parse(porId.get(l.id)!.publishedAt));
      expect(instantes).toEqual([...instantes].sort((a, b) => b - a));
    }
    expect(registrosDoPeriodo(casos[0].data, casos[0].range).titulo).toMatch(/^\d+ posts da grade · 1 de teste · 2 impulsionados$/);
    expect(registrosDoPeriodo(casos[1].data, casos[1].range).titulo).toBe("3 posts da grade");
    expect(registrosDoPeriodo(casos[3].data, casos[3].range).titulo).toBe("1 post da grade");
    expect(registrosDoPeriodo(casos[5].data, casos[5].range)).toEqual({ titulo: "Nenhum post no período", linhas: [] });
    // O tipo cru (o formulário testa `tipo === "reel"` para a duração).
    const reel = registrosDoPeriodo(casos[0].data, casos[0].range).linhas.find((l) => l.id === F.IDS_CONTEUDO.melhor1)!;
    expect([reel.tipo, reel.tipoTexto]).toEqual(["reel", "Reel"]);
    // O post das 21:30 de 13/11.
    expect(registrosDoPeriodo(casos[3].data, casos[3].range).linhas[0]).toMatchObject({ id: "IG-NOITE-HOJE", quando: "13/11 21:30" });
    // Teste e impulsionado com o selo.
    const r30 = registrosDoPeriodo(casos[0].data, casos[0].range).linhas;
    expect(r30.find((l) => l.id === F.IDS_CONTEUDO.teste)).toMatchObject({ isTest: true, impulsionado: false });
    expect(r30.find((l) => l.id === F.IDS_CONTEUDO.impulsionado)).toMatchObject({ isTest: false, impulsionado: true });
  });
});

// ---------------------------------------------------------------- 22–23. a conta e o dicionário

describe("a conta do Instagram e o dicionário (§2.6, §3.7)", () => {
  it("22. os dois alcances separados (B11); o gráfico do TOTAL só na marca de conversão", () => {
    const e = entradaConteudoDa(F.producaoConteudo(), "30d");
    const c = montarConteudoDaTela(e);
    const ig = igAccountTotals(e.data.igAccountDaily, e.range);
    const org = alcanceOrganicoDosPosts(e.data.igPosts, e.range, e.data.creatives);
    const n = Object.fromEntries(c.conta!.numeros.map((x) => [x.id, x]));
    expect(c.conta!.numeros.map((x) => x.id)).toEqual(["alcance_conta", "alcance_organico_posts", "views", "interacoes", "visitas_perfil"]);
    expect(n.alcance_conta.valor).toBe(formatInt(ig.reach));
    expect(n.alcance_organico_posts.valor).toBe(formatInt(org.alcance));
    expect(ig.reach).not.toBe(org.alcance);
    expect(n.views.valor).toBe(formatInt(ig.views));
    expect(n.interacoes.valor).toBe(formatInt(ig.interactions));
    expect(n.visitas_perfil.valor).toBe(formatInt(ig.profileViews));
    expect(n.alcance_conta.rotulo).toBe("Alcance da conta (pago + orgânico)");
    expect(n.alcance_organico_posts.rotulo).toBe("Alcance orgânico dos posts");
    for (const x of c.conta!.numeros) {
      expect(x.rotulo).toBe(DICIONARIO[x.id].nome);
      expect(x.dica.startsWith(dica(x.id))).toBe(true);
    }
    expect(n.alcance_organico_posts.dica).toContain(`${formatInt(org.posts)} posts; 1 de teste e 2 impulsionados ficaram de fora.`);
    expect(conteudoDa(F.producaoConteudo(), "7d").conta!.numeros[1].dica).toMatch(/ \d+ posts\.$/);
    // O gráfico: os pontos de `pontosDoTotalDeSeguidores`, só com data e total; o título com o total.
    const seg = resumoSeguidores(e.data.igAccountDaily, e.range);
    const pontos = pontosDoTotalDeSeguidores(followerSeries(e.data.igAccountDaily, e.range)).map(({ date, followers }) => ({ date, followers }));
    expect(pontos.length).toBeGreaterThanOrEqual(2);
    expect(c.conta!.serieDeSeguidores).toEqual(pontos);
    for (const ponto of c.conta!.serieDeSeguidores!) expect(Object.keys(ponto).sort()).toEqual(["date", "followers"]);
    expect(c.conta!.tituloDoGrafico).toBe(`Total de seguidores · ${formatInt(seg.fim)}`);
    expect(conteudoDa(seedDaMarca(), "all").conta!.tituloDoGrafico).toBe("Total de seguidores · 524");
    // Krone: sem o gráfico (está no Início dela).
    for (const k of [conteudoDa(F.kroneConteudo()), conteudoDa(seedDaMarca("krone"), "all")]) {
      expect(k.conta).not.toBeNull();
      expect(k.conta!.serieDeSeguidores).toBeNull();
      expect(k.conta!.tituloDoGrafico).toBeNull();
    }
    // Sem Instagram no período: sem o recolhido.
    expect(conteudoDa(seedDaMarca()).conta).toBeNull();
  });

  it("23. o dicionário sem os cliques no link da bio nem as DMs; toda frase dos ⓘ da conta ≤ 25 palavras", () => {
    expect(Object.keys(DICIONARIO)).not.toContain("cliques_link_bio");
    expect(Object.keys(DICIONARIO)).not.toContain("conversas_dm");
    expect([...METRICAS_DE_CONTEUDO].sort()).toEqual(["alcance_conta", "alcance_organico_posts", "interacoes", "seguidores", "views", "visitas_perfil"]);
    for (const id of METRICAS_DE_CONTEUDO) for (const f of frases(dica(id))) expect(nPalavras(f), `${id}: ${f}`).toBeLessThanOrEqual(25);
    // E toda frase de todo ⓘ montado pela tela.
    for (const caso of CASOS) {
      for (const [onde, d] of dicasDe(montarConteudoDaTela(caso.entrada()))) {
        for (const f of frases(d)) expect(nPalavras(f), `${caso.nome} · ${onde}: ${f}`).toBeLessThanOrEqual(25);
      }
    }
  });
});

// ---------------------------------------------------------------- 24–27. correções da revisão final

describe("correções da revisão final: o dia de Brasília nas variações e na Produção, a chave do grupo, a concordância", () => {
  const IGUAL = "Corte do gancho da parcela que cabe no plano\nVersão de teste do mesmo vídeo.";

  it("24. variacoesDeAnuncio agrupa pelo `diaDoPost`: sem fuso = o relógio escrito (não o fuso do processo); '+00' não lança", () => {
    // Sem fuso (seed, CSV antigo): 01:30 escrito = 01:30 de Brasília, dia 10/11 em qualquer máquina.
    const semFuso = [
      { ...F.post("IG-SF-1", "2026-11-10", "12:00", "reel", IGUAL), publishedAt: "2026-11-10T01:30:00" },
      { ...F.post("IG-SF-2", "2026-11-10", "12:00", "reel", IGUAL), publishedAt: "2026-11-10T01:45:00" },
    ];
    const g = variacoesDeAnuncio(semFuso, { from: "2026-11-10", to: "2026-11-12" });
    expect(g.map((x) => x.dia)).toEqual(["2026-11-10"]);
    expect(g[0].dia).toBe(diaDoPost(semFuso[0]));
    // A tela: o grupo e a tabela "Todos os posts" dizem o MESMO dia; o grupo é do período (o kp).
    const c = conteudoDa(comPosts(semFuso), "30d");
    expect(c.variacoes!.lista.map((x) => x.diaTexto)).toEqual(["10/11"]);
    expect(c.todos!.linhas.map((l) => l.data)).toEqual(["10/11", "10/11"]);
    expect(c.placar.dica).toContain("1 grupo de posts iguais no mesmo dia do período ainda conta como posts da grade.");
    expect(c.acoes.map((a) => a.id)).not.toContain("same-day-pileup");

    // Fuso curto ("+00", como o Postgres imprime `timestamptz`): 01:30 UTC de 11/11 = 22:30 de 10/11.
    const curto = [
      { ...F.post("IG-FC-1", "2026-11-10", "12:00", "reel", IGUAL), publishedAt: "2026-11-11T01:30:00+00" },
      { ...F.post("IG-FC-2", "2026-11-10", "12:00", "reel", IGUAL), publishedAt: "2026-11-11T01:45:00+00" },
    ];
    expect(() => variacoesDeAnuncio(curto)).not.toThrow();
    expect(variacoesDeAnuncio(curto).map((x) => x.dia)).toEqual(["2026-11-10"]);
    const cc = conteudoDa(comPosts(curto), "30d");
    expect(cc.variacoes!.lista[0].diaTexto).toBe("10/11");
    expect(cc.variacoes!.lista[0].posts.map((p) => p.hora)).toEqual(["22:30", "22:45"]);
  });

  it("25. a chave do grupo não leva texto da legenda: o dia e o id do 1º post (a legenda inteira nunca vai ao client)", () => {
    const d = F.producaoConteudo();
    const historico = variacoesNaGrade(d.igPosts, d.creatives, undefined);
    const v = conteudoDa(d).variacoes!;
    expect(v.lista.map((g) => g.chave)).toEqual(historico.map((g) => `${g.dia}|${g.posts[0].id}`));
    expect(new Set(v.lista.map((g) => g.chave)).size).toBe(v.lista.length);
    const porId = new Map(d.igPosts.map((p) => [p.id, p]));
    for (const g of v.lista) {
      const legenda = porId.get(g.posts[0].id)!.caption;
      const [primeira = "", segunda = ""] = legenda.split(/\r?\n/).filter((l) => l.trim() !== "");
      expect(g.chave).not.toContain(normalizarLegenda(legenda));
      expect(g.chave.toLowerCase()).not.toContain(normalizarLegenda(primeira).split(" ").slice(0, 3).join(" "));
      if (segunda) expect(g.chave.toLowerCase()).not.toContain(normalizarLegenda(segunda));
    }
  });

  it("26. 1 post fora da grade: 'ficou de fora; ele está' (no placar e no alcance orgânico); 2+ no plural", () => {
    const base = F.umPostDaGrade();
    const teste = F.post("IG-UM-TESTE", "2026-11-11", "12:00", "feed", "Corte de teste do gancho\nVersão de teste.", { isTest: true });
    const um = conteudoDa({ ...base, igPosts: [...base.igPosts, teste] }, "30d");
    expect(um.placar.dica).toContain("No período, 1 de teste ficou de fora; ele está em Todos os posts.");
    expect(um.placar.dica).not.toContain("ficaram de fora");
    const org = um.conta!.numeros.find((n) => n.id === "alcance_organico_posts")!;
    expect(org.dica).toContain("1 post; 1 de teste ficou de fora.");

    const outro = F.post("IG-UM-TESTE-2", "2026-11-12", "12:00", "feed", "Outro corte de teste\nVersão de teste.", { isTest: true });
    const dois = conteudoDa({ ...base, igPosts: [...base.igPosts, teste, outro] }, "30d");
    expect(dois.placar.dica).toContain("No período, 2 de teste ficaram de fora; eles estão em Todos os posts.");
    expect(dois.conta!.numeros.find((n) => n.id === "alcance_organico_posts")!.dica).toContain("1 post; 2 de teste ficaram de fora.");
  });

  it("27. a Produção casa e exibe o post pelo dia de Brasília: o reel das 22h de 10/11 é 'mesmo dia e formato' da peça de 10/11", () => {
    const reel = F.post("IG-NOITE-PROD", "2026-11-10", "22:00", "reel", "Outra legenda qualquer\nAssista até o fim.");
    expect(reel.publishedAt).toBe("2026-11-11T01:00:00.000Z");
    const de10 = suggestMatches(F.peca("PD-10", "2026-11-10", "reel"), [reel], new Set());
    expect(de10.map((m) => m.motivo)).toEqual(["mesmo dia e formato"]);
    // A data que a Produção exibe ao lado da sugestão é a do dia que casou (nunca o prefixo UTC, 11/11).
    expect(formatDateShort(diaDoPost(de10[0]))).toBe("10/11");
    expect(suggestMatches(F.peca("PD-11", "2026-11-11", "reel"), [reel], new Set())).toEqual([]);
  });
});
