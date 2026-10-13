/**
 * Fase 6.5 — Conteúdo: variações de anúncio, cadência sem testes e impulsionados,
 * alcance orgânico dos posts e a série de seguidores (B10/B11/S14).
 * Fixture sintética (nenhum dado real).
 */
import { describe, expect, it } from "vitest";
import {
  alcanceOrganicoDosPosts,
  funilDoPerfil,
  metaDeConversasDm,
  metaDeSeguidores,
  normalizarLegenda,
  reconstruirSeguidores,
  resumoSeguidores,
  variacoesDeAnuncio,
} from "../conteudo";
import { formatIntComSinal } from "../format";
import {
  awarenessKpis,
  buildOrganicFunnel,
  followerSeries,
  igAccountTotals,
  postingCadence,
  seguidoresDoPeriodo,
} from "../metrics";
import { funilDeDescoberta } from "../funil";
import { kpisDoPeriodo } from "../kpis";
import { buildBriefing } from "../ai/briefing";
import type { AdDaily, Creative, DashboardData, Goal, IgAccountDaily, IgPost } from "../types";

const post = (id: string, publishedAt: string, caption: string, over: Partial<IgPost> = {}): IgPost => ({
  id,
  brand: "consorcio",
  publishedAt,
  type: "reel",
  caption,
  permalink: `https://www.instagram.com/reel/${id}/`,
  reach: 100,
  views: 200,
  likes: 1,
  comments: 0,
  saved: 0,
  shares: 0,
  ...over,
});

const criativo = (adId: string, over: Partial<Creative> = {}): Creative => ({
  adId,
  brand: "consorcio",
  name: `Anúncio ${adId}`,
  format: "imagem",
  ...over,
});

const dia = (date: string, over: Partial<IgAccountDaily> = {}): IgAccountDaily => ({
  brand: "consorcio",
  date,
  followers: 100,
  reach: 10,
  views: 20,
  profileLinkTaps: 1,
  accountsEngaged: 2,
  totalInteractions: 3,
  profileViews: 4,
  ...over,
});

describe("6.5 — variações de anúncio (mesma legenda, mesmo dia em Brasília)", () => {
  it("normaliza a legenda: pontas, caixa e espaços repetidos", () => {
    expect(normalizarLegenda("  Gancho   A \n novo ")).toBe("gancho a novo");
  });

  it("agrupa 2+ posts com a mesma legenda no mesmo dia e ignora os sozinhos", () => {
    const posts = [
      post("A1", "2026-10-05T12:00:00Z", "Gancho A — três caminhos"),
      post("A2", "2026-10-05T15:30:00Z", "gancho a —  três caminhos", { type: "feed" }),
      post("A3", "2026-10-05T18:00:00Z", "  GANCHO A — TRÊS CAMINHOS  "),
      post("B1", "2026-10-05T13:00:00Z", "Legenda única do dia"),
      post("C1", "2026-10-06T13:00:00Z", "Gancho A — três caminhos"), // outro dia: não é variação
    ];
    const grupos = variacoesDeAnuncio(posts);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].dia).toBe("2026-10-05");
    expect(grupos[0].legenda).toBe("Gancho A — três caminhos");
    expect(grupos[0].posts.map((p) => p.id)).toEqual(["A1", "A2", "A3"]);
    expect(grupos[0].pendentes).toEqual(["A1", "A2", "A3"]);
  });

  it("o dia é o de Brasília: 23h30 e 2h30 UTC do dia seguinte são o mesmo dia", () => {
    const posts = [
      post("N1", "2026-10-05T23:30:00Z", "Mesma legenda"), // 20h30 em Brasília, dia 05
      post("N2", "2026-10-06T02:30:00Z", "Mesma legenda"), // 23h30 em Brasília, dia 05
      post("N3", "2026-10-06T03:30:00Z", "Mesma legenda"), // 00h30 em Brasília, dia 06
    ];
    const grupos = variacoesDeAnuncio(posts);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].dia).toBe("2026-10-05");
    expect(grupos[0].posts.map((p) => p.id)).toEqual(["N1", "N2"]);
  });

  it("grupo já confirmado como teste não volta; parcialmente marcado sugere só os pendentes", () => {
    const posts = [
      post("T1", "2026-10-05T12:00:00Z", "Teste confirmado", { isTest: true }),
      post("T2", "2026-10-05T13:00:00Z", "Teste confirmado", { isTest: true }),
      post("P1", "2026-10-07T12:00:00Z", "Metade marcada", { isTest: true }),
      post("P2", "2026-10-07T13:00:00Z", "Metade marcada"),
    ];
    const grupos = variacoesDeAnuncio(posts);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].legenda).toBe("Metade marcada");
    expect(grupos[0].pendentes).toEqual(["P2"]);
    expect(grupos[0].posts.find((p) => p.id === "P1")?.isTest).toBe(true);
  });

  it("posts sem legenda não viram variação; o período filtra pelo dia de Brasília", () => {
    const posts = [
      post("S1", "2026-10-05T12:00:00Z", "(sem legenda)"),
      post("S2", "2026-10-05T13:00:00Z", "(sem legenda)"),
      post("V1", "2026-10-09T12:00:00Z", "Fora do período"),
      post("V2", "2026-10-09T13:00:00Z", "Fora do período"),
      post("D1", "2026-10-05T12:00:00Z", "Dentro"),
      post("D2", "2026-10-05T13:00:00Z", "Dentro"),
    ];
    expect(variacoesDeAnuncio(posts).map((g) => g.legenda)).toEqual(["Fora do período", "Dentro"]);
    expect(variacoesDeAnuncio(posts, { from: "2026-10-01", to: "2026-10-07" }).map((g) => g.legenda)).toEqual(["Dentro"]);
  });
});

describe("6.5 — cadência ignora testes e impulsionados", () => {
  const posts = [
    post("G1", "2026-10-01T12:00:00Z", "Da grade"),
    post("G2", "2026-10-04T12:00:00Z", "Da grade também", { type: "carrossel" }),
    post("T1", "2026-10-04T13:00:00Z", "[TESTE] gancho", { isTest: true }),
    post("I1", "2026-10-06T12:00:00Z", "Impulsionado por id"),
    post("I2", "2026-10-06T13:00:00Z", "Impulsionado por permalink"),
  ];
  const creatives = [
    criativo("AD-1", { instagramMediaId: "I1" }),
    criativo("AD-2", { instagramPermalink: "https://www.instagram.com/reel/I2/" }),
  ];
  const range = { from: "2026-10-01", to: "2026-10-07" };
  const agora = "2026-10-07T12:00:00Z";

  it("com os criativos: só os posts da grade contam (mesma regra do postPerformance)", () => {
    const c = postingCadence(posts, range, agora, creatives);
    expect(c.count).toBe(2);
    expect(c.postsPerWeek).toBe(2);
    expect(c.maxSameDay).toBe(1);
    expect(c.daysWithPileup).toBe(0);
    expect(c.reelsPerWeek).toBe(1);
    expect(c.carrosseisPerWeek).toBe(1);
    expect(c.daysSinceLast).toBe(3); // o último da GRADE foi 04/10, não o impulsionado de 06/10
  });

  it("aceita também um conjunto de ids a excluir", () => {
    const c = postingCadence(posts, range, agora, new Set(["I1", "I2"]));
    expect(c.count).toBe(2);
  });

  it("sem o 4º argumento, os testes continuam fora; os impulsionados entram", () => {
    const c = postingCadence(posts, range, agora);
    expect(c.count).toBe(4);
    expect(c.maxSameDay).toBe(2);
    expect(c.busiestDay).toBe("2026-10-06");
  });
});

describe("6.5 — alcance orgânico dos posts (B11)", () => {
  it("soma só os posts que não são teste nem impulsionados e diz quantos ficaram de fora", () => {
    const posts = [
      post("G1", "2026-10-01T12:00:00Z", "Da grade", { reach: 1000 }),
      post("G2", "2026-10-02T12:00:00Z", "Da grade também", { reach: 500 }),
      post("T1", "2026-10-03T12:00:00Z", "[TESTE]", { reach: 9000, isTest: true }),
      post("I1", "2026-10-04T12:00:00Z", "Impulsionado", { reach: 50000 }),
      post("F1", "2026-10-20T12:00:00Z", "Fora do período", { reach: 777 }),
    ];
    const r = alcanceOrganicoDosPosts(posts, { from: "2026-10-01", to: "2026-10-10" }, [
      criativo("AD-1", { instagramMediaId: "I1" }),
    ]);
    expect(r).toEqual({ alcance: 1500, posts: 2, testes: 1, impulsionados: 1 });
  });
});

describe("6.5 — seguidores (B10 / S14)", () => {
  it("reconstrói para trás com o LÍQUIDO (ganhos − perdas), nunca com o bruto", () => {
    const serie = reconstruirSeguidores({
      dias: ["2026-10-05", "2026-10-06", "2026-10-07"],
      seguidoresAgora: 1000,
      ganhosPorDia: new Map([
        ["2026-10-07", 10],
        ["2026-10-06", 5],
      ]),
      perdasPorDia: new Map([
        ["2026-10-07", 4],
        ["2026-10-06", 1],
      ]),
      snapshots: new Map(),
    });
    expect(serie.get("2026-10-07")).toBe(1000);
    expect(serie.get("2026-10-06")).toBe(994); // 1000 − (10 − 4): com o bruto seria 990
    expect(serie.get("2026-10-05")).toBe(990); // 994 − (5 − 1)
  });

  it("só ganhos (sem perdas) não é variação líquida: cai no snapshot gravado", () => {
    const serie = reconstruirSeguidores({
      dias: ["2026-10-05", "2026-10-06", "2026-10-07"],
      seguidoresAgora: 1000,
      ganhosPorDia: new Map([
        ["2026-10-07", 10],
        ["2026-10-06", 5],
      ]),
      perdasPorDia: new Map(),
      snapshots: new Map([["2026-10-05", 980]]),
    });
    expect(serie.get("2026-10-07")).toBe(1000);
    expect(serie.get("2026-10-06")).toBe(1000); // sem snapshot: o valor conhecido mais próximo, nunca 0
    expect(serie.get("2026-10-05")).toBe(980); // o que foi gravado
  });

  it("série parcial: reconstrói até onde há os dois lados e segue com os snapshots", () => {
    const serie = reconstruirSeguidores({
      dias: ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"],
      seguidoresAgora: 500,
      ganhosPorDia: new Map([
        ["2026-10-06", 3],
        ["2026-10-05", 2],
      ]),
      perdasPorDia: new Map([
        ["2026-10-06", 1],
        ["2026-10-05", 0],
      ]),
      snapshots: new Map([
        ["2026-10-03", 480],
        ["2026-10-04", 0],
      ]),
    });
    expect([...serie.entries()]).toEqual([
      ["2026-10-06", 500],
      ["2026-10-05", 498],
      ["2026-10-04", 496], // fim da série: o total do dia ainda é conhecido
      ["2026-10-03", 480],
    ]);
  });

  it("o líquido sai com sinal certo — nunca “+-12” — e a nota diz desde quando há série", () => {
    const rows = [
      dia("2026-10-01", { followers: 112 }),
      dia("2026-10-02", { followers: 108 }),
      dia("2026-10-03", { followers: 104, followsDay: 2, unfollowsDay: 6 }),
      dia("2026-10-04", { followers: 100, followsDay: 1, unfollowsDay: 5 }),
    ];
    const r = resumoSeguidores(rows, { from: "2026-10-01", to: "2026-10-04" });
    expect(r.liquido).toBe(-12);
    expect(r.liquidoTexto).toBe("−12");
    expect(r.liquidoTexto).not.toContain("+-");
    expect(r.ganhos).toBe(3);
    expect(r.perdas).toBe(11);
    expect(r.serieDesde).toBe("2026-10-03");
    expect(r.serieCompleta).toBe(false);
    expect(r.nota).toBe("ganhos e perdas: +3 / −11 · série disponível desde 03/10 (a API só fornece com 100+ seguidores)");
  });

  it("sem nenhum dia com os dois lados, a nota diz que não há série (não diz 0 perdas)", () => {
    const r = resumoSeguidores([dia("2026-10-01", { followers: 90 }), dia("2026-10-02", { followers: 95 })]);
    expect(r.liquidoTexto).toBe("+5");
    expect(r.temSerie).toBe(false);
    expect(r.nota).toBe("ganhos e perdas: sem série (a API só fornece com 100+ seguidores)");
  });

  it("série completa no período: só ganhos e perdas, e o líquido FECHA com eles; zero vira 0, não −0", () => {
    // Totais como o sync reconstrói: 96 no dia anterior → +4 no dia 01 → 100.
    const r = resumoSeguidores([
      dia("2026-10-01", { followers: 100, followsDay: 4, unfollowsDay: 0 }),
      dia("2026-10-02", { followers: 100, followsDay: 0, unfollowsDay: 0 }),
    ]);
    expect(r.serieCompleta).toBe(true);
    expect(r.liquido).toBe(r.ganhos - r.perdas);
    expect(r.liquidoTexto).toBe("+4");
    expect(r.inicio).toBe(96);
    expect(r.nota).toBe("ganhos e perdas: +4 / 0");
    // Série parada: ganhos − perdas = 0 imprime "0", nunca "−0".
    const parado = resumoSeguidores([dia("2026-10-01", { followers: 100, followsDay: 0, unfollowsDay: 0 })]);
    expect(parado.liquido).toBe(0);
    expect(parado.liquidoTexto).toBe("0");
  });
});

/** Σ da "Variação de seguidores por dia" — tem de dar o líquido do card. */
const somaDaVariacao = (rows: IgAccountDaily[], range?: { from: string; to: string }) =>
  followerSeries(rows, range).reduce((s, p) => s + p.gain, 0);

describe("6.5 — revisão 19: líquido e ganhos/perdas cobrem os MESMOS dias", () => {
  // Semana com +10/−2 no 1º dia e nada depois. `followers` é o total no FIM do
  // dia, como o sync reconstrói: 100 na véspera → 108 no dia 01 → 108 até o fim.
  const semana = [
    dia("2026-09-30", { followers: 100, followsDay: 0, unfollowsDay: 0 }),
    dia("2026-10-01", { followers: 108, followsDay: 10, unfollowsDay: 2 }),
    dia("2026-10-02", { followers: 108, followsDay: 0, unfollowsDay: 0 }),
    dia("2026-10-03", { followers: 108, followsDay: 0, unfollowsDay: 0 }),
    dia("2026-10-04", { followers: 108, followsDay: 0, unfollowsDay: 0 }),
    dia("2026-10-05", { followers: 108, followsDay: 0, unfollowsDay: 0 }),
    dia("2026-10-06", { followers: 108, followsDay: 0, unfollowsDay: 0 }),
    dia("2026-10-07", { followers: 108, followsDay: 0, unfollowsDay: 0 }),
  ];
  const range = { from: "2026-10-01", to: "2026-10-07" };

  it("o 1º dia do período entra no líquido: início é o total da VÉSPERA e serieCompleta ⇒ líquido = ganhos − perdas", () => {
    const r = resumoSeguidores(semana, range);
    expect(r.serieCompleta).toBe(true);
    expect(r.inicio).toBe(100);
    expect(r.fim).toBe(108);
    expect(r.ganhos).toBe(10);
    expect(r.perdas).toBe(2);
    expect(r.liquido).toBe(8); // antes: 108 − 108 = "0 no período · +10 / −2"
    expect(r.liquido).toBe(r.ganhos - r.perdas);
    expect(r.liquidoTexto).toBe("+8");
    expect(r.nota).toBe("ganhos e perdas: +10 / −2");
  });

  it("sem linha antes do período, o 1º dia menos o próprio líquido dá a véspera — e ainda fecha", () => {
    const r = resumoSeguidores(
      semana.filter((d) => d.date >= range.from),
      range,
    );
    expect(r.inicio).toBe(100);
    expect(r.liquido).toBe(8);
    expect(r.liquido).toBe(r.ganhos - r.perdas);
  });

  it("série incompleta: o líquido parte da última linha ANTES do período, e a nota diz que não fecha", () => {
    const rows = [
      dia("2026-09-29", { followers: 100 }),
      dia("2026-10-01", { followers: 105 }), // sem os dois lados
      dia("2026-10-02", { followers: 108, followsDay: 3, unfollowsDay: 0 }),
    ];
    const r = resumoSeguidores(rows, { from: "2026-10-01", to: "2026-10-02" });
    expect(r.serieCompleta).toBe(false);
    expect(r.inicio).toBe(100);
    expect(r.liquido).toBe(8);
    expect(r.nota).toContain("série");
  });

  it("o gráfico de variação por dia fecha com a nota: o 1º dia varia contra a véspera, não contra si mesmo", () => {
    const serie = followerSeries(semana, range);
    expect(serie.map((p) => p.gain)).toEqual([8, 0, 0, 0, 0, 0, 0]); // antes: [0, 0, …] — o +8 sumia
    expect(serie.reduce((s, p) => s + p.gain, 0)).toBe(resumoSeguidores(semana, range).liquido);
    // Sem a véspera, o 1º dia com os dois lados varia o próprio líquido (+10 − 2).
    const semVespera = semana.slice(1);
    expect(followerSeries(semVespera, range)[0].gain).toBe(8);
    expect(somaDaVariacao(semVespera, range)).toBe(resumoSeguidores(semVespera, range).liquido);
    // Véspera com total desconhecido (0) não é véspera: cai no líquido do próprio dia.
    const vesperaSemTotal = [dia("2026-09-30", { followers: 0 }), ...semana.slice(1)];
    expect(followerSeries(vesperaSemTotal, range)[0].gain).toBe(8);
    // Sem véspera e sem os dois lados não há com o que comparar: 0.
    expect(followerSeries([dia("2026-10-01", { followers: 108 })], range)[0].gain).toBe(0);
  });

  it("propriedade: com a série completa, líquido = ganhos − perdas; e a soma do gráfico = o líquido do card", () => {
    const casos: { rows: IgAccountDaily[]; range?: { from: string; to: string } }[] = [
      { rows: semana, range },
      { rows: semana.slice(1), range },
      { rows: semana, range: { from: "2026-10-03", to: "2026-10-07" } },
      { rows: semana }, // "tudo": sem período
      {
        rows: [
          dia("2026-10-01", { followers: 200, followsDay: 5, unfollowsDay: 1 }),
          dia("2026-10-02", { followers: 198, followsDay: 0, unfollowsDay: 2 }),
          dia("2026-10-03", { followers: 207, followsDay: 9, unfollowsDay: 0 }),
        ],
        range: { from: "2026-10-01", to: "2026-10-03" },
      },
    ];
    for (const { rows, range: r } of casos) {
      const seg = resumoSeguidores(rows, r);
      if (seg.serieCompleta) {
        expect(seg.liquido).toBe(seg.ganhos - seg.perdas);
        expect(seg.nota).toBe(`ganhos e perdas: ${formatIntComSinal(seg.ganhos)} / ${formatIntComSinal(-seg.perdas)}`);
        expect(seg.liquidoTexto).toBe(formatIntComSinal(seg.ganhos - seg.perdas));
      }
      expect(somaDaVariacao(rows, r)).toBe(seg.liquido);
    }
  });

  it("período que começa no meio da semana: a véspera é o dia 02, e o +8 do dia 01 fica fora do líquido E da nota", () => {
    const r = resumoSeguidores(semana, { from: "2026-10-03", to: "2026-10-07" });
    expect(r.inicio).toBe(108);
    expect(r.liquido).toBe(0);
    expect(r.liquidoTexto).toBe("0");
    expect(r.nota).toBe("ganhos e perdas: 0 / 0");
  });
});

describe("6.5 — revisão 20: total 0 é desconhecido, não “Abaixo da meta (0%)”", () => {
  const metaSeg: Goal = { brand: "consorcio", metric: "followers", period: "campanha", target: 1000 };

  it("metaDeSeguidores não dá status com total 0, mesmo com temDado", () => {
    expect(metaDeSeguidores([metaSeg], 0, true)).toEqual({ alvoTexto: "meta 1.000" });
    expect(metaDeSeguidores([metaSeg], 0, true).avaliacao).toBeUndefined();
    expect(metaDeSeguidores([metaSeg], 900, true).avaliacao?.status).toBe("ambar");
  });

  it("snapshot manual de hoje sem o campo: fim é o último total CONHECIDO e o líquido não despenca", () => {
    const rows = [
      dia("2026-10-01", { followers: 1240 }),
      dia("2026-10-02", { followers: 1250 }),
      dia("2026-10-03", { followers: 0, reach: 500, views: 900 }), // registrou só alcance e views
    ];
    const range = { from: "2026-10-01", to: "2026-10-03" };
    const r = resumoSeguidores(rows, range);
    expect(r.temTotal).toBe(true);
    expect(r.fim).toBe(1250); // antes: 0 → "0 · −1.240 no período · Abaixo da meta (0%)"
    expect(r.fimEm).toBe("2026-10-02"); // a tela diz de quando é o total
    expect(r.fimNoUltimoDia).toBe(false);
    expect(resumoSeguidores(rows.slice(0, 2), range).fimNoUltimoDia).toBe(true);
    expect(r.liquido).toBe(10);
    // Um número só: os totais da conta (Bússola, Funil, IA) leem a mesma regra.
    expect(igAccountTotals(rows, range)).toMatchObject({ followersEnd: 1250, followersStart: 1240, netNew: 10 });
    // Contra a meta vale o 1.250 conhecido (verde), nunca o 0 do campo em branco (vermelho).
    expect(metaDeSeguidores([metaSeg], r.fim, r.temTotal).avaliacao?.status).toBe("verde");
    expect(metaDeSeguidores([metaSeg], 0, true).avaliacao).toBeUndefined();
  });

  it("nenhum total conhecido no período: temTotal false, fim 0, líquido 0 — sem valor, sem Δ, sem status", () => {
    const r = resumoSeguidores(
      [dia("2026-10-01", { followers: 0 }), dia("2026-10-02", { followers: 0 })],
      { from: "2026-10-01", to: "2026-10-02" },
    );
    expect(r.temTotal).toBe(false);
    expect(r.fim).toBe(0);
    expect(r.liquido).toBe(0);
    expect(metaDeSeguidores([metaSeg], r.fim, r.temTotal)).toEqual({ alvoTexto: "meta 1.000" });
  });
});

describe("6.5 — revisão 21: o funil do perfil diz que o alcance é o da conta (pago + orgânico)", () => {
  const rows = [
    dia("2026-09-30", { followers: 100, reach: 0, profileViews: 0, followsDay: 0, unfollowsDay: 0 }),
    dia("2026-10-01", { followers: 110, reach: 200_000, profileViews: 1_500, followsDay: 12, unfollowsDay: 2 }),
    dia("2026-10-02", { followers: 112, reach: 11_800, profileViews: 900, followsDay: 2, unfollowsDay: 0 }),
  ];
  const range = { from: "2026-10-01", to: "2026-10-02" };

  it("o 1º degrau é rotulado como alcance da CONTA e soma o mesmo reach do card", () => {
    const f = funilDoPerfil(rows, range);
    expect(f[0].label).toBe("Alcance da conta (pago + orgânico)");
    expect(f[0].label).not.toMatch(/orgânico do perfil/i);
    expect(f[0].value).toBe(211_800);
    expect(f[0].value).toBe(igAccountTotals(rows, range).reach);
    expect(f[1]).toMatchObject({ label: "Visitas ao perfil", value: 2_400 });
    expect(f[1].fromPrev).toBeCloseTo(2_400 / 211_800, 6);
  });

  it("o 3º degrau é o líquido alinhado de resumoSeguidores (inclui o 1º dia), não o netNew", () => {
    const f = funilDoPerfil(rows, range);
    const seg = resumoSeguidores(rows, range);
    expect(seg.liquido).toBe(12);
    expect(f[2]).toMatchObject({ label: "Novos seguidores (líquido)", value: 12 });
    expect(f[2].fromPrev).toBeCloseTo(12 / 2_400, 6);
    // O helper de metrics.ts (fora da tela) também rotula o topo como alcance da conta.
    expect(buildOrganicFunnel(rows, range)[0].label).toBe("Alcance da conta (pago + orgânico)");
  });

  it("líquido negativo não vira degrau negativo", () => {
    const perdendo = [
      dia("2026-10-01", { followers: 90, reach: 100, profileViews: 10, followsDay: 0, unfollowsDay: 10 }),
    ];
    const f = funilDoPerfil(perdendo, { from: "2026-10-01", to: "2026-10-01" });
    expect(f[2].value).toBe(0);
    expect(f[2].fromPrev).toBe(0);
  });
});

describe("6.5 — metas dos cards de conteúdo", () => {
  const metaDm: Goal = { brand: "consorcio", metric: "conversas_dm", period: "campanha", target: 60 };
  const metaSeg: Goal = { brand: "consorcio", metric: "followers", period: "campanha", target: 1000 };

  it("sem meta cadastrada o card diz “sem meta”", () => {
    expect(metaDeConversasDm([], 10, true, true)).toEqual({ alvoTexto: "sem meta" });
    expect(metaDeSeguidores([], 10, true)).toEqual({ alvoTexto: "sem meta" });
  });

  it("DM: status só na campanha inteira e com registro; fora disso, só o alvo", () => {
    expect(metaDeConversasDm([metaDm], 0, false, true)).toEqual({ alvoTexto: "meta 60 na campanha" });
    expect(metaDeConversasDm([metaDm], 50, true, false)).toEqual({ alvoTexto: "meta 60 na campanha" });
    const r = metaDeConversasDm([metaDm], 50, true, true);
    expect(r.alvoTexto).toBe("meta 60");
    expect(r.avaliacao?.status).toBe("ambar");
    expect(r.avaliacao?.rotulo).toContain("83%");
  });

  it("seguidores: a meta é um total, compara em qualquer período", () => {
    const r = metaDeSeguidores([metaSeg], 1200, true);
    expect(r.avaliacao?.status).toBe("verde");
    expect(metaDeSeguidores([metaSeg], 0, false)).toEqual({ alvoTexto: "meta 1.000" });
  });
});

// ------------------------------------------------- um fato, um número (verificação 6.5)

/**
 * A regra do líquido mora em `seguidoresDoPeriodo` (metrics.ts) e `igAccountTotals`
 * a lê: a Bússola (cards, gráfico e o link do rodapé), o Funil de descoberta, a
 * IA e o Conteúdo imprimem o MESMO número. Antes da verificação, só o Conteúdo
 * via a véspera — a Bússola dizia "+0" ao lado de um gráfico que somava +8.
 */
describe("6.5 — verificação: o líquido de seguidores é o mesmo em todas as telas", () => {
  // O cenário do achado: véspera 1000, +10/−2 no dia 01, o resto parado.
  const semana = [
    dia("2026-09-30", { followers: 1000, followsDay: 0, unfollowsDay: 0 }),
    dia("2026-10-01", { followers: 1008, followsDay: 10, unfollowsDay: 2, reach: 900, profileViews: 80 }),
    ...["02", "03", "04", "05", "06", "07"].map((d) =>
      dia(`2026-10-${d}`, { followers: 1008, followsDay: 0, unfollowsDay: 0, reach: 900, profileViews: 80 }),
    ),
  ];
  const range = { from: "2026-10-01", to: "2026-10-07" };
  const anuncio = (date: string, spend: number): AdDaily => ({
    brand: "consorcio",
    date,
    campaign: "Campanha de perfil",
    adset: "Conjunto",
    adId: "300001",
    objective: "OUTCOME_ENGAGEMENT",
    spend,
    impressions: 1000,
    reach: 800,
    frequency: 1.25,
    clicks: 10,
    leads: 0,
  });
  const dados = (igAccountDaily: IgAccountDaily[], over: Partial<DashboardData> = {}): DashboardData => ({
    campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-09-01", budgetTotal: 0 },
    igAccountDaily,
    igPosts: [],
    adDaily: [],
    creatives: [],
    lpDaily: [],
    leads: [],
    goals: [],
    updatedAt: "2026-10-08T12:00:00.000Z",
    ...over,
  });
  const somaDoGrafico = (rows: IgAccountDaily[], r?: { from: string; to: string }) =>
    followerSeries(rows, r).reduce((s, p) => s + p.gain, 0);

  it("Bússola (marca de awareness): os cards Seguidores e Novos seguidores dizem o que o gráfico soma", () => {
    const a = awarenessKpis(dados(semana), range);
    expect(a.netNewFollowers).toBe(8); // antes: 0 nos cards, +8 no gráfico "Novos seguidores por dia"
    expect(a.netNewFollowers).toBe(somaDoGrafico(semana, range));
    expect(a.followersEnd).toBe(1008);
    // O 1º dia do gráfico varia contra a véspera, e é o único que se moveu.
    expect(followerSeries(semana, range).map((p) => p.gain)).toEqual([8, 0, 0, 0, 0, 0, 0]);
  });

  it("rodapé da Bússola: fim − início (o que o link imprime) é o “+8 no período” do card Seguidores que ele abre", () => {
    const ig = igAccountTotals(semana, range);
    const seg = resumoSeguidores(semana, range);
    expect(ig.followersEnd - ig.followersStart).toBe(8); // antes: 1008 − 1008 = 0
    expect(formatIntComSinal(ig.followersEnd - ig.followersStart)).toBe(seg.liquidoTexto);
    expect(seg.liquidoTexto).toBe("+8");
  });

  it("propriedade: fim − início = líquido = Σ do gráfico = card do Conteúdo, em qualquer cenário", () => {
    const cenarios: { rows: IgAccountDaily[]; range?: { from: string; to: string } }[] = [
      { rows: semana, range },
      { rows: semana.slice(1), range }, // sem véspera
      { rows: semana, range: { from: "2026-10-03", to: "2026-10-07" } },
      { rows: semana }, // "tudo"
      // sem a série: totais contra a véspera
      { rows: semana.map((r) => ({ ...r, followsDay: undefined, unfollowsDay: undefined })), range },
      // o último snapshot veio sem o campo (registro manual só com alcance e views)
      { rows: [...semana.slice(0, -1), dia("2026-10-07", { followers: 0 })], range },
      // série e totais que não fecham entre si (snapshot manual no meio da série)
      {
        rows: [
          dia("2026-09-30", { followers: 1000 }),
          dia("2026-10-01", { followers: 1030, followsDay: 10, unfollowsDay: 2 }),
          dia("2026-10-02", { followers: 1030, followsDay: 1, unfollowsDay: 0 }),
        ],
        range: { from: "2026-10-01", to: "2026-10-02" },
      },
      // nenhum total conhecido
      { rows: [dia("2026-10-01", { followers: 0 }), dia("2026-10-02", { followers: 0 })], range },
    ];
    for (const { rows, range: r } of cenarios) {
      const ig = igAccountTotals(rows, r);
      const seg = resumoSeguidores(rows, r);
      const unico = seguidoresDoPeriodo(rows, r);
      expect(ig.netNew).toBe(unico.liquido);
      expect(ig.followersEnd - ig.followersStart).toBe(ig.netNew);
      expect(somaDoGrafico(rows, r)).toBe(ig.netNew);
      expect(seg.liquido).toBe(ig.netNew);
      expect(seg.fim).toBe(ig.followersEnd);
      if (seg.serieCompleta) expect(ig.netNew).toBe(seg.ganhos - seg.perdas);
    }
  });

  it("Funil → descoberta: “Novos seguidores (líquido)” é o 8 do Conteúdo, ao lado de +10 / −2, e o custo por seguidor usa o mesmo 8", () => {
    const data = dados(semana, { adDaily: [anuncio("2026-10-02", 80)] });
    const f = funilDeDescoberta(data, range, kpisDoPeriodo(data, range));
    const seguidores = f.etapas.find((e) => e.key === "seguidores")!;
    expect(seguidores.valor).toBe(8); // antes: 0, com a nota "ganhos brutos 10 · deixaram de seguir 2"
    expect(seguidores.nota).toBe("ganhos brutos 10 · deixaram de seguir 2");
    expect(seguidores.custo).toMatchObject({ valor: 10, rotulo: "por seguidor" }); // R$ 80 ÷ 8
    // O "Funil do perfil" do Conteúdo, mesmo rótulo de etapa, mesmo número.
    const perfil = funilDoPerfil(semana, range);
    expect(perfil[2]).toMatchObject({ label: seguidores.label, value: 8 });
    expect(buildOrganicFunnel(semana, range)[2].value).toBe(8);
  });

  it("IA: o briefing manda o total e o líquido que a tela mostra (último total conhecido, véspera inclusa)", () => {
    // Último snapshot sem o campo: a tela mostra 1.008 (de 06/10) e +8; a IA também.
    const rows = [...semana.slice(0, -1), dia("2026-10-07", { followers: 0, reach: 900, profileViews: 80 })];
    const seg = resumoSeguidores(rows, range);
    expect(seg).toMatchObject({ fim: 1008, liquido: 8, temTotal: true });
    const b = buildBriefing(dados(rows), range, { nowIso: "2026-10-08T12:00:00.000Z", warnings: [] });
    expect(b.perfil.seguidores).toBe(seg.fim); // antes: 0 (o snapshot em branco)
    expect(b.perfil.ganhoLiquidoNoPeriodo).toBe(seg.liquido); // antes: 0 (o 1º dia ficava de fora)
    // E o período anterior pela MESMA regra.
    const anterior = { from: "2026-09-24", to: "2026-09-30" };
    expect(b.perfil.ganhoLiquidoAnterior).toBe(resumoSeguidores(rows, anterior).liquido);
  });
});
