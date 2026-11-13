/**
 * Fase 4 (§5.5 da spec) — "Para onde vai a verba" (`paraOndeVaiAVerba`), o "fora das
 * linhas" (`foraDasLinhasDeConversao`, `textoDosForaDasLinhas`), o maior resto
 * (`porcentagensInteiras`), Detalhes × Pausados (`separarPorVeiculacao`), os alertas só
 * da Mídia e o gasto da conferência com o Gerenciador.
 *
 *   • Só conversão: % da verba sobre o investimento de conversão; % dos leads sobre os
 *     leads de conversão COM conjunto, contados na MESMA passada do "fora das linhas"
 *     (K11) — D + n = leads de conversão por construção, também com um conjunto misto.
 *   • O título dá a resposta (as 5 regras do §2.3): o destaque pelos INTEIROS que a
 *     tabela mostra (K12), " ⚠" no fim acima de 25% fora das linhas (K32), "no ar em
 *     dd/mm" com o ref no passado (K7). A live é UMA linha, fora do destaque (K19).
 *
 * Datas fixas: 12/11/2026 (fixtures-midia) e 23/07/2026 (o seed).
 */
import { describe, expect, it } from "vitest";
import { alertaForaDasLinhas, alertaReunioesSoPorNome, type Alerta } from "../alertas";
import { alertasDoInicio } from "../bussola";
import type { Intervalo } from "../cobertura";
import { gastoDoPeriodoParaConferir } from "../conferencia-periodo";
import { custoExibivel, kpisDoPeriodo, type KpisDoPeriodo } from "../kpis";
import { LIVE_PADRAO } from "../live";
import { chavesDaLive } from "../atalho-live";
import { fimDoPeriodo } from "../metrics";
import {
  conjuntosDaVerba,
  conjuntosPorId,
  criativosComSinal,
  foraDasLinhasDeConversao,
  gastoDaVerba,
  paraOndeVaiAVerba,
  porcentagensInteiras,
  separarPorVeiculacao,
  textoDaPorcentagem,
  textoDosForaDasLinhas,
} from "../midia";
import type { ForaDasLinhasDeConversao, LinhaMidia, VerbaDaTela } from "../midia-tela";
import { pageRange } from "../page-range";
import { refDaVeiculacao } from "../veiculacao";
import { formatCurrency0 } from "../format";
import type { AdDaily, Creative, Lead } from "../types";
import { SEED_COBERTURA, SEED_HOJE, base, brt } from "@/test/fixtures-robo";
import {
  AGORA,
  HOJE,
  IDS,
  MARCA,
  NOMES,
  ULTIMO_SYNC_ADS,
  comLive,
  comPisoDeGasto,
  comReunioes,
  comReunioesSoPorNome,
  comSemTelefone,
  pessoa,
  piorCasoDeTexto,
  producaoSemana,
  somarDias,
  type SemanaDaMidia,
} from "@/test/fixtures-midia";
import { ROBO_DESLIGADO, entradaDosSinaisDa, midiaDa, semanaDoSeed } from "@/test/entrada-midia";

// ---------------------------------------------------------------- utilidades

const nPalavras = (t: string) => t.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p)).length;
const sp = (t: string) => t.replace(/ /g, " ");
/** "42%" → 42; "< 1%" → 0 e "> 99%" → 100 (o inteiro do maior resto). */
const inteiroDe = (t: string) => (t.startsWith("<") ? 0 : t.startsWith(">") ? 100 : Number(t.replace("%", "")));

/** A verba e as peças dela, montadas como `montarMidiaDaTela` monta. */
function montar(p: SemanaDaMidia, chave = "7d") {
  const { range } = pageRange(p.data, chave, p.hoje);
  const kpis = kpisDoPeriodo(p.data, range, { hoje: p.hoje, agora: p.agora, cobertura: p.cobertura, comparar: false });
  const fim = fimDoPeriodo(range, p.hoje);
  const ref = refDaVeiculacao({ fim, ultimoSyncAds: p.ultimoSyncAds, rows: p.data.adDaily });
  const cprExibivel = custoExibivel(kpis.custoPorReuniao);
  const conjuntos = conjuntosPorId(p.data, range, { custoPorReuniaoExibivel: cprExibivel, ref, cobertura: p.cobertura, cfgLive: p.cfgLive });
  const fora = foraDasLinhasDeConversao(p.data, range, kpis, conjuntos);
  const verba = paraOndeVaiAVerba(conjuntos, kpis, fora, { ref, hoje: p.hoje, cfgLive: p.cfgLive });
  return { range, kpis, ref, conjuntos, fora, verba, cprExibivel };
}

const conjuntosDe = (linhas: LinhaMidia[]) => linhas.flatMap((c) => c.conjuntos ?? []);
/** As linhas que entram nos 100% (no ar + Live + Fora do ar). */
const nos100 = (v: VerbaDaTela) => v.linhas.filter((l) => l.tipo !== "fora-das-linhas");

// ---------------------------------------------------------------- um construtor de semanas (os títulos)

/** O sync cobre até 11/11 (fixture: sem dia "sem dados" no período). */
const COB: Intervalo[] = [{ from: "2026-10-01", to: "2026-11-11" }];

interface Cj {
  nome: string;
  gasto: number;
  leads: number;
  campanha?: string;
  campaignId?: string;
  objective?: string;
  /** Dia do (único) gasto: o padrão é `diaNoAr` (no ar); um dia antigo = parou. */
  dia?: string;
}

let seqAd = 0;
/**
 * Uma semana sob medida: cada conjunto com UM anúncio e UMA linha de gasto exato num
 * dia (o "no ar" pede gasto na janela), `leads` leads de conversão pelo id do anúncio e
 * `leadsFora` leads de um anúncio fora das linhas da marca.
 */
function semanaDe(cjs: Cj[], o: { leadsFora?: number; ultimoSyncAds?: string; diaNoAr?: string } = {}): SemanaDaMidia {
  const adDaily: AdDaily[] = [];
  const creatives: Creative[] = [];
  const leads: Lead[] = [];
  let nn = 1;
  const pago = (adId: string): Partial<Lead> => ({ utmSource: "meta", utmMedium: "paid_social", adId, utmContent: adId });
  for (const c of cjs) {
    seqAd += 1;
    const adId = `735${String(seqAd).padStart(5, "0")}`;
    const adsetId = `725${String(seqAd).padStart(5, "0")}`;
    adDaily.push({
      brand: MARCA,
      date: c.dia ?? o.diaNoAr ?? HOJE,
      campaign: c.campanha ?? "[ACM] Teste - Leads",
      campaignId: c.campaignId ?? "71500001",
      adset: c.nome,
      adsetId,
      adId,
      objective: c.objective ?? "OUTCOME_LEADS",
      spend: c.gasto,
      impressions: c.gasto * 40,
      reach: c.gasto * 30,
      frequency: 1.33,
      clicks: c.gasto,
      leads: 0,
    });
    creatives.push({ adId, brand: MARCA, name: `Anúncio de ${c.nome}`, format: "imagem", creativeId: `745${String(seqAd).padStart(5, "0")}` });
    for (let j = 0; j < c.leads; j++) leads.push(pessoa(nn++, brt("2026-11-08", "10:00"), pago(adId)));
  }
  for (let j = 0; j < (o.leadsFora ?? 0); j++) leads.push(pessoa(nn++, brt("2026-11-09", "10:00"), pago(IDS.anuncioDeFora[0])));
  // Uma linha zerada em 01/10 (fora do período): o dado da conta começa antes, e os 7 dias
  // não são recortados no 1º dia com linha (`pageRange`).
  adDaily.push({
    brand: MARCA,
    date: "2026-10-01",
    campaign: "Âncora do histórico",
    campaignId: "71599999",
    adset: "Âncora",
    adsetId: "72599999",
    adId: "73599999",
    objective: "OUTCOME_LEADS",
    spend: 0,
    impressions: 0,
    reach: 0,
    frequency: 0,
    clicks: 0,
    leads: 0,
  });
  return {
    data: base({ adDaily, creatives, leads }),
    cobertura: COB,
    syncRuns: [],
    ultimoSyncAds: o.ultimoSyncAds ?? ULTIMO_SYNC_ADS,
    cfgLive: structuredClone(LIVE_PADRAO),
    eventos: [],
    robo: ROBO_DESLIGADO,
    hoje: HOJE,
    agora: AGORA,
  };
}

const titulo = (p: SemanaDaMidia) => montar(p).verba.titulo;

// ---------------------------------------------------------------- 1. o maior resto

describe("porcentagensInteiras e textoDaPorcentagem", () => {
  it("somam 100 pelo maior resto (33/33/34 e 0,4/99,6); Σ = 0 dá zeros", () => {
    expect(porcentagensInteiras([1, 1, 1]).reduce((s, v) => s + v, 0)).toBe(100);
    expect([...porcentagensInteiras([1, 1, 1])].sort()).toEqual([33, 33, 34]);
    expect(porcentagensInteiras([0.4, 99.6])).toEqual([0, 100]);
    expect(porcentagensInteiras([180, 170, 70, 40, 140])).toEqual([30, 28, 12, 7, 23]);
    expect(porcentagensInteiras([0, 0, 0])).toEqual([0, 0, 0]);
    expect(porcentagensInteiras([])).toEqual([]);
  });

  it("o que é > 0 e arredonda para 0 sai '< 1%'", () => {
    expect(textoDaPorcentagem(0, 0.004)).toBe("< 1%");
    expect(textoDaPorcentagem(0, 0)).toBe("0%");
    expect(textoDaPorcentagem(42, 0.4166)).toBe("42%");
  });
});

// ---------------------------------------------------------------- 2. a base

const ENTRADAS: [string, () => SemanaDaMidia, string][] = [
  ...(["7d", "30d", "all"] as const).map((k): [string, () => SemanaDaMidia, string] => [`seed · ${k}`, () => semanaDoSeed("consorcio", SEED_HOJE, SEED_COBERTURA), k]),
  ["produção · 7d", producaoSemana, "7d"],
  ["produção · campanha", producaoSemana, "all"],
  ["live · 7d", comLive, "7d"],
  ["3 reuniões · 7d", () => comReunioes(3), "7d"],
  ["2 reuniões só pelo nome · 7d", () => comReunioesSoPorNome(2), "7d"],
  ["sem telefone · 7d", comSemTelefone, "7d"],
  ["piso de gasto · 7d", comPisoDeGasto, "7d"],
  ["pior caso de texto · 7d", piorCasoDeTexto, "7d"],
];

describe("a base dos %: Σ gasto = o investimento de conversão; Σ % = 100", () => {
  for (const [nome, semana, chave] of ENTRADAS) {
    it(nome, () => {
      const p = semana();
      const { kpis, conjuntos, verba, fora } = montar(p, chave);
      // Σ gasto das linhas de conversão (no ar + Live + fora do ar) = o investimento de conversão.
      const conv = conjuntos.conversao.reduce((s, l) => s + l.spend, 0);
      expect(conv).toBeCloseTo(kpis.investimentoConversao.valor, 6);
      if (kpis.investimentoConversao.valor > 0) {
        const linhas = nos100(verba);
        // As barras são a fração exata: somam 1.
        expect(linhas.reduce((s, l) => s + l.barraVerba, 0)).toBeCloseTo(1, 9);
        expect(linhas.reduce((s, l) => s + inteiroDe(l.pctVerba), 0)).toBe(100);
        const D = kpis.leadsConversao.valor - fora.n;
        if (D > 0) {
          expect(linhas.reduce((s, l) => s + inteiroDe(l.pctLeads), 0)).toBe(100);
          expect(linhas.reduce((s, l) => s + l.barraLeads, 0)).toBeCloseTo(1, 9);
        } else for (const l of linhas) expect(l.pctLeads).toBe("—");
      }
      // A montagem da tela devolve a MESMA verba.
      expect(midiaDa(p, chave).verba).toEqual(kpis.investimento.valor === 0 ? null : verba);
    });
  }
});

// ---------------------------------------------------------------- 3. fora das linhas (K11, K16)

describe("fora das linhas: a MESMA passada dos leads da verba (K11)", () => {
  for (const [nome, semana, chave] of ENTRADAS) {
    it(`${nome}: n + Σ porConjunto = os leads de conversão; Σ por motivo = n`, () => {
      const { kpis, fora } = montar(semana(), chave);
      const porConjunto = [...fora.porConjunto.values()].reduce((s, v) => s + v, 0);
      expect(fora.n + porConjunto).toBe(kpis.leadsConversao.valor);
      expect(fora.de).toBe(kpis.leadsConversao.valor);
      expect(Object.values(fora.porMotivo).reduce((s, v) => s + v, 0)).toBe(fora.n);
    });
  }

  it("a produção: 8 de 23 — 6 de anúncio fora das linhas da marca, 1 macro, 1 ambíguo, nenhum 'desconhecida'; 1 orgânico", () => {
    const { fora, conjuntos } = montar(producaoSemana());
    expect(fora.n).toBe(8);
    expect(fora.de).toBe(23);
    expect(fora.porMotivo).toMatchObject({ "anuncio-de-fora": 6, macro: 1, ambigua: 1, desconhecida: 0, "sem-origem": 0, "sem-linha-no-periodo": 0, "linha-de-descoberta": 0 });
    expect(fora.organicos).toBe(1);
    // O golden não muda: `naoAtribuidos` ainda junta os dois em "desconhecida" (K16).
    expect(conjuntos.naoAtribuidos.desconhecida).toBe(6);
    const texto = textoDosForaDasLinhas(fora);
    expect(texto.startsWith("Fora das linhas: 8 de 23 leads de conversão.")).toBe(true);
    expect(texto).toContain("6 de anúncio fora das linhas desta marca.");
    expect(texto).toContain("1 com nome ambíguo.");
    expect(texto).toContain("1 com macro sem resolver.");
    expect(texto).not.toContain("origem desconhecida");
  });

  it("o conjunto MISTO: o lead de balde descoberta entra no 'Leads (painel)' da linha e NÃO na verba", () => {
    const { fora, conjuntos, verba } = montar(producaoSemana());
    const mirante = conjuntosDe(conjuntos.conversao).find((l) => l.adsetId === IDS.conjunto.mirante)!;
    expect(mirante.bucket).toBe("conversao");
    expect(mirante.leadsPainel).toBe(1);
    expect(fora.porConjunto.get(mirante.chave) ?? 0).toBe(0);
    expect(verba.linhas.find((l) => l.chave === mirante.chave)?.pctLeads).toBe("0%");
  });

  it("sem lead fora, o texto é vazio", () => {
    const vazio: ForaDasLinhasDeConversao = {
      n: 0,
      de: 10,
      porMotivo: { "anuncio-de-fora": 0, desconhecida: 0, "sem-origem": 0, ambigua: 0, macro: 0, "sem-linha-no-periodo": 0, "linha-de-descoberta": 0 },
      porConjunto: new Map([["x", 10]]),
      organicos: 2,
    };
    expect(textoDosForaDasLinhas(vazio)).toBe("");
  });
});

// ---------------------------------------------------------------- 4. os títulos (§2.3, K12, K32)

describe("o título dá a resposta (as 5 regras do §2.3)", () => {
  it("regra 1: só descoberta → 'Sem verba de conversão no período', sem tabela (e sem ⚠)", () => {
    const p = semanaDe([{ nome: "Engajamento amplo", gasto: 200, leads: 0, objective: "OUTCOME_ENGAGEMENT" }], { leadsFora: 5 });
    const { verba } = montar(p);
    expect(verba.titulo).toBe("Sem verba de conversão no período");
    expect(verba.linhas).toEqual([]);
  });

  it("regra 2 sem a live: 'Nenhum conjunto no ar · último gasto em 08/11', sem tabela (e sem ⚠)", () => {
    const p = semanaDe(
      [
        { nome: "Alfa", gasto: 100, leads: 2, dia: "2026-11-08" },
        { nome: "Bravo", gasto: 80, leads: 1, dia: "2026-11-07" },
      ],
      { leadsFora: 5 },
    );
    const { verba } = montar(p);
    expect(verba.titulo).toBe("Nenhum conjunto no ar · último gasto em 08/11");
    expect(verba.linhas).toEqual([]);
  });

  it("regra 2 com a live no ar: 'Só os conjuntos da live estão no ar'; a tabela tem a Live e 'Fora do ar'", () => {
    const p = semanaDe(
      [
        { nome: "Imóvel Aberto", gasto: 300, leads: 5, campanha: NOMES.campanha.live, campaignId: IDS.campanha.live },
        { nome: "Alfa", gasto: 100, leads: 2, dia: "2026-11-08" },
      ],
      { leadsFora: 5 },
    );
    const { verba } = montar(p);
    expect(verba.titulo).toBe("Só os conjuntos da live estão no ar");
    expect(verba.linhas.map((l) => l.tipo)).toEqual(["live", "fora-do-ar", "fora-das-linhas"]);
    expect(verba.linhas[0].rotulo).toBe(LIVE_PADRAO.nome);
    expect(verba.linhas.map((l) => l.pctVerba).slice(0, 2)).toEqual(["75%", "25%"]);
  });

  it("regra 3: menos de 10 leads nos conjuntos no ar → 'poucos leads para comparar' (singular com 1)", () => {
    expect(titulo(semanaDe([{ nome: "Alfa", gasto: 300, leads: 3 }, { nome: "Bravo", gasto: 200, leads: 4 }]))).toBe("2 conjuntos no ar · poucos leads para comparar");
    expect(titulo(semanaDe([{ nome: "Alfa", gasto: 300, leads: 3 }]))).toBe("1 conjunto no ar · poucos leads para comparar");
  });

  it("regra 4: o destaque pelos INTEIROS exibidos — verba 40% (40,4) e leads 50% (49,6) é destaque (Δ exibido 10)", () => {
    const p = semanaDe([
      { nome: "Xis", gasto: 404, leads: 62 },
      { nome: "Yankee", gasto: 300, leads: 34 },
      { nome: "Zulu", gasto: 296, leads: 29 },
    ]);
    const { verba } = montar(p);
    expect(verba.linhas.map((l) => [l.rotulo, l.pctVerba, l.pctLeads])).toEqual([
      ["Xis", "40%", "50%"],
      ["Yankee", "30%", "27%"],
      ["Zulu", "30%", "23%"],
    ]);
    expect(verba.titulo).toBe("Xis leva 40% da verba e traz 50% dos leads");
  });

  it("regra 5: verba 40% e leads 49% (Δ 9) → 'Leads acompanham a verba nos 3 conjuntos no ar' (o complemento exato da 4)", () => {
    const p = semanaDe([
      { nome: "Xis", gasto: 400, leads: 49 },
      { nome: "Yankee", gasto: 300, leads: 26 },
      { nome: "Zulu", gasto: 300, leads: 25 },
    ]);
    expect(titulo(p)).toBe("Leads acompanham a verba nos 3 conjuntos no ar");
    expect(titulo(semanaDe([{ nome: "Xis", gasto: 400, leads: 12 }]))).toBe("Leads acompanham a verba no único conjunto no ar");
  });

  it("sem corte de 10% da verba: uma linha com 5% da verba e 30% dos leads é o destaque", () => {
    const p = semanaDe([
      { nome: "Xis", gasto: 50, leads: 30 },
      { nome: "Yankee", gasto: 500, leads: 35 },
      { nome: "Zulu", gasto: 450, leads: 35 },
    ]);
    expect(titulo(p)).toBe("Xis leva 5% da verba e traz 30% dos leads");
  });

  it("empate no |Δ|: vence a linha de mais gasto", () => {
    const p = semanaDe([
      { nome: "Bravo", gasto: 300, leads: 15 },
      { nome: "Alfa", gasto: 700, leads: 5 },
    ]);
    expect(titulo(p)).toBe("Alfa leva 70% da verba e traz 25% dos leads");
  });

  it("nome repetido entre as linhas: a tabela e o título usam `rotuloConjunto` ('campanha › conjunto')", () => {
    const p = semanaDe([
      { nome: "Interesses", gasto: 700, leads: 5, campanha: "Campanha Um", campaignId: "71500011" },
      { nome: "Interesses", gasto: 300, leads: 15, campanha: "Campanha Dois", campaignId: "71500012" },
    ]);
    const { verba } = montar(p);
    expect(verba.linhas.map((l) => l.rotulo).slice(0, 2)).toEqual(["Campanha Um › Interesses", "Campanha Dois › Interesses"]);
    expect(verba.titulo).toBe("Campanha Um › Interesses leva 70% da verba e traz 25% dos leads");
  });

  it("nome longo é cortado (≤ 5 palavras ou 32 caracteres, com '…')", () => {
    const p = semanaDe([
      { nome: "Um Dois Três Quatro Cinco Seis Sete", gasto: 700, leads: 5 },
      { nome: "Bravo", gasto: 300, leads: 15 },
    ]);
    const t = titulo(p);
    const nome = t.split(" leva ")[0];
    expect(nome.endsWith("…"), t).toBe(true);
    expect(nPalavras(nome)).toBeLessThanOrEqual(5);
    expect(nome.length).toBeLessThanOrEqual(33);
    expect(nome.startsWith("Um Dois Três")).toBe(true);
    expect(t).toMatch(/ leva 70% da verba e traz 25% dos leads$/);
  });

  it("' ⚠' no FIM com mais de 25% dos leads fora das linhas (regras 3 a 5), nunca nas regras 1 e 2", () => {
    // A produção: 8 de 23 fora das linhas (35%).
    const { verba } = montar(producaoSemana());
    expect(verba.titulo).toBe("Aurora Interesses 30-55 leva 30% da verba e traz 73% dos leads ⚠");
    expect(titulo(semanaDe([{ nome: "Alfa", gasto: 300, leads: 3 }], { leadsFora: 2 }))).toBe("1 conjunto no ar · poucos leads para comparar ⚠");
    expect(titulo(semanaDe([{ nome: "Xis", gasto: 400, leads: 12 }], { leadsFora: 5 }))).toBe("Leads acompanham a verba no único conjunto no ar ⚠");
    // 25% exatos não levam (o mesmo corte do alerta).
    expect(titulo(semanaDe([{ nome: "Xis", gasto: 400, leads: 12 }], { leadsFora: 4 }))).toBe("Leads acompanham a verba no único conjunto no ar");
  });

  it("'no ar em dd/mm' quando o ref é anterior a hoje (o sync de ontem, K7)", () => {
    const p = semanaDe(
      [
        { nome: "Xis", gasto: 400, leads: 49 },
        { nome: "Yankee", gasto: 300, leads: 26 },
        { nome: "Zulu", gasto: 300, leads: 25 },
      ],
      { ultimoSyncAds: "2026-11-11T09:02:00Z", diaNoAr: "2026-11-11" },
    );
    expect(titulo(p)).toBe("Leads acompanham a verba nos 3 conjuntos no ar em 11/11");
    const parados = semanaDe([{ nome: "Alfa", gasto: 100, leads: 2, dia: "2026-11-07" }], { ultimoSyncAds: "2026-11-11T09:02:00Z" });
    expect(titulo(parados)).toBe("Nenhum conjunto no ar em 11/11 · último gasto em 07/11");
  });

  it("todo título ≤ 15 palavras e nenhum começa com 'Verba × leads' (K32)", () => {
    const todos = [
      ...ENTRADAS.map(([, s, k]) => montar(s(), k).verba.titulo),
      titulo(semanaDe([{ nome: "Um Dois Três Quatro Cinco Seis Sete Oito Nove Dez", gasto: 700, leads: 5 }, { nome: "B", gasto: 300, leads: 15 }], { leadsFora: 20 })),
    ];
    for (const t of todos) {
      expect(nPalavras(t), t).toBeLessThanOrEqual(15);
      expect(t.startsWith("Verba × leads"), t).toBe(false);
    }
  });
});

// ---------------------------------------------------------------- 5. a live (K19)

describe("a live é UMA linha da verba, nos 100% e fora do destaque (K19)", () => {
  it("com a campanha da live no ar: uma linha 'Live 01/12', tipo live; o ⓘ diz que ela entra numa linha só", () => {
    const { verba, conjuntos } = montar(comLive());
    const live = verba.linhas.filter((l) => l.tipo === "live");
    expect(live).toHaveLength(1);
    expect(live[0].rotulo).toBe(LIVE_PADRAO.nome);
    expect(live[0].barraVerba).toBeGreaterThan(0);
    // Os conjuntos da live (`daLive`) não aparecem um a um.
    const daLive = conjuntosDe(conjuntos.conversao).filter((l) => l.daLive);
    expect(daLive.map((l) => l.adsetId).sort()).toEqual([IDS.conjunto.imovelAberto, IDS.conjunto.persona].sort());
    for (const l of daLive) expect(verba.linhas.some((v) => v.chave === l.chave)).toBe(false);
    // Nunca é o destaque.
    expect(verba.titulo.startsWith(LIVE_PADRAO.nome)).toBe(false);
    expect(verba.dica).toContain("A Live 01/12 entra numa linha só");
    expect(nos100(verba).reduce((s, l) => s + inteiroDe(l.pctVerba), 0)).toBe(100);
  });

  it("sem gasto da live, nenhuma linha da live", () => {
    expect(montar(producaoSemana()).verba.linhas.some((l) => l.tipo === "live")).toBe(false);
    expect(montar(producaoSemana()).verba.dica).not.toContain("A Live 01/12");
  });
});

// ---------------------------------------------------------------- 6. só conversão

describe("só conversão", () => {
  it("nenhuma linha de descoberta na tabela; o ⓘ cita o gasto de descoberta", () => {
    const { verba, conjuntos, kpis } = montar(producaoSemana());
    const descoberta = new Set(conjuntosDe(conjuntos.descoberta).map((l) => l.chave));
    expect(descoberta.size).toBeGreaterThan(0);
    for (const l of verba.linhas) {
      expect(descoberta.has(l.chave)).toBe(false);
      expect(["no-ar", "live", "fora-do-ar", "fora-das-linhas"]).toContain(l.tipo);
    }
    expect(sp(verba.dica)).toContain(sp(formatCurrency0(kpis.investimentoDescoberta.valor)));
    expect(sp(verba.dica)).toContain(sp(formatCurrency0(kpis.investimentoConversao.valor)));
  });

  it("a ordem da tabela: no ar por gasto, Live, 'Fora do ar' e 'Fora das linhas' (n de N, sem barra)", () => {
    const { verba } = montar(producaoSemana());
    expect(verba.linhas.map((l) => [l.tipo, l.rotulo, l.pctVerba, l.pctLeads])).toEqual([
      ["no-ar", "Aurora Interesses 30-55", "30%", "73%"],
      ["no-ar", "Boreal Aberto 25-60", "28%", "20%"],
      ["no-ar", "Mirante Misto Engajamento", "12%", "0%"],
      ["no-ar", "Cerrado Remarketing 30 dias", "7%", "7%"],
      ["fora-do-ar", "Fora do ar", "23%", "0%"],
      ["fora-das-linhas", "Fora das linhas", "—", "8 de 23 leads"],
    ]);
    const fdl = verba.linhas.at(-1)!;
    expect([fdl.barraVerba, fdl.barraLeads]).toEqual([0, 0]);
  });
});

// ---------------------------------------------------------------- 7. Detalhes × Pausados (K39)

describe("separarPorVeiculacao: Detalhes (no ar) × Pausados (fora do ar), sem perder gasto (K39)", () => {
  for (const [nome, semana, chave] of ENTRADAS) {
    it(nome, () => {
      const { conjuntos, cprExibivel } = montar(semana(), chave);
      const sep = separarPorVeiculacao(conjuntos.conversao, cprExibivel);
      const somaDe = (ls: LinhaMidia[]) => ls.reduce((s, l) => s + l.spend, 0);
      expect(somaDe(sep.noAr) + somaDe(sep.foraDoAr)).toBeCloseTo(somaDe(conjuntos.conversao), 6);
      const noAr = conjuntosDe(sep.noAr);
      const fora = conjuntosDe(sep.foraDoAr);
      for (const l of noAr) expect(l.veiculacao.estado).toBe("no-ar");
      for (const l of fora) expect(l.veiculacao.estado).not.toBe("no-ar");
      const chaves = new Set(noAr.map((l) => l.chave));
      for (const l of fora) expect(chaves.has(l.chave), `${l.nome} nos dois lados`).toBe(false);
      expect(noAr.length + fora.length).toBe(conjuntosDe(conjuntos.conversao).length);
      // Cada campanha remontada só com os conjuntos do seu lado.
      for (const c of [...sep.noAr, ...sep.foraDoAr]) expect(c.spend).toBeCloseTo(somaDe(c.conjuntos ?? []), 6);
    });
  }

  it("a campanha da produção, com um conjunto parado, aparece nos dois lados — cada um com o seu total", () => {
    const { conjuntos, cprExibivel } = montar(producaoSemana());
    const sep = separarPorVeiculacao(conjuntos.conversao, cprExibivel);
    const noAr = sep.noAr.find((c) => c.campaignId === IDS.campanha.conversao)!;
    const fora = sep.foraDoAr.find((c) => c.campaignId === IDS.campanha.conversao)!;
    expect(noAr.spend).toBeCloseTo(460, 6);
    expect(fora.spend).toBeCloseTo(140, 6);
    expect(fora.conjuntos!.map((l) => l.nome)).toEqual([NOMES.conjunto.delta]);
    expect(fora.conjuntos![0].veiculacao.rotulo).toBe("Último gasto em 08/11");
    expect(noAr.veiculacao.estado).toBe("no-ar");
    expect(fora.veiculacao.estado).toBe("parou");
  });
});

// ---------------------------------------------------------------- 8. alertas

describe("os alertas só da Mídia (F4-D38)", () => {
  it("`alertaForaDasLinhas`: acima de 25% → `midia-fora-das-linhas`, que fala em CONJUNTO (K10)", () => {
    const a = alertaForaDasLinhas(8, 23);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ id: "midia-fora-das-linhas", nivel: "aviso", titulo: "8 de 23 leads de conversão sem conjunto identificado" });
    expect(a[0].detalhe).toContain("sem conjunto identificado");
    expect(a[0].detalhe).not.toMatch(/criativo/i);
    expect(a[0].cta?.href).toBe("/configuracoes/marcas");
    expect(alertaForaDasLinhas(5, 23)).toEqual([]);
    expect(alertaForaDasLinhas(0, 0)).toEqual([]);
  });

  it("`alertaReunioesSoPorNome` (K41): o link com {{ad.id}} não some", () => {
    const a = alertaReunioesSoPorNome(1);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ id: "midia-reunioes-so-por-nome", titulo: "1 reunião chegou só com o nome do anúncio" });
    expect(a[0].cta).toEqual({ label: "Gerar o link certo", href: "/configuracoes/ferramentas#utm" });
    expect(alertaReunioesSoPorNome(2)[0].titulo).toBe("2 reuniões chegaram só com o nome do anúncio");
    expect(alertaReunioesSoPorNome(0)).toEqual([]);
  });

  it("a Mídia registra os dois; o Início NÃO muda o ⚠ (a lista de ids de antes da Fase 4)", () => {
    const ids = (a: Alerta[]) => a.map((x) => x.id);
    const doInicio = (p: SemanaDaMidia) => {
      const { range, kpis } = montar(p);
      return ids(alertasDoInicio({ data: p.data, range, kpis: kpis as KpisDoPeriodo, hoje: p.hoje }));
    };
    // A lista gravada no código de antes da Fase 4 (master bd787ab), na mesma fixture.
    expect(doInicio(producaoSemana())).toEqual(["trava-sem-reuniao", "atribuicao-macro", "atribuicao-ambigua"]);
    expect(doInicio(comReunioesSoPorNome(2))).toEqual(["trava-cpr-amostra", "atribuicao-macro", "atribuicao-ambigua"]);
    expect(doInicio(comLive())).toEqual(["trava-sem-reuniao", "atribuicao-macro", "atribuicao-ambigua"]);
    expect(doInicio(comPisoDeGasto())).toEqual(["trava-sem-reuniao", "trava-cobertura-de-dias", "atribuicao-macro", "atribuicao-ambigua"]);
    expect(doInicio(piorCasoDeTexto())).toEqual([]);
    // A Mídia: as do Início (travas e atribuição) + as dela.
    const producao = ids(midiaDa(producaoSemana()).alertas);
    expect(producao).toContain("midia-fora-das-linhas");
    for (const id of doInicio(producaoSemana())) expect(producao).toContain(id);
    expect(ids(midiaDa(comReunioesSoPorNome(2)).alertas)).toContain("midia-reunioes-so-por-nome");
    expect(producao).not.toContain("midia-reunioes-so-por-nome");
  });
});

// ---------------------------------------------------------------- 9. a conferência (o TOTAL, K5)

describe("o gasto da conferência é o investimento TOTAL do período (K5)", () => {
  const chaves = ["7d", "30d", "all", chavesDaLive(LIVE_PADRAO).campanha, "lixo"];
  for (const [nome, semana] of [
    ["seed", () => semanaDoSeed("consorcio", SEED_HOJE, SEED_COBERTURA)],
    ["produção", producaoSemana],
    ["live", comLive],
  ] as const) {
    it(nome, () => {
      const p = semana();
      for (const rk of chaves) {
        const c = gastoDoPeriodoParaConferir(p.data, rk, p.hoje);
        const efetiva = rk === "lixo" ? undefined : rk;
        const { range } = pageRange(p.data, efetiva, p.hoje);
        expect(c.gasto, rk).toBe(kpisDoPeriodo(p.data, range, { cobertura: p.cobertura, hoje: p.hoje }).investimento.valor);
        expect(c.gasto, rk).toBe(kpisDoPeriodo(p.data, range, { brandRules: [], cobertura: [], hoje: p.hoje }).investimento.valor);
        if (rk === "lixo") {
          expect(c.rangeKey).toBe("all");
          expect(c.gasto).toBe(gastoDoPeriodoParaConferir(p.data, "all", p.hoje).gasto);
        }
      }
      // É o total (conversão + descoberta) — o "Investimento total" do ⓘ do resumo da Mídia.
      const { kpis } = montar(p, "7d");
      expect(gastoDoPeriodoParaConferir(p.data, "7d", p.hoje).gasto).toBeCloseTo(kpis.investimentoConversao.valor + kpis.investimentoDescoberta.valor, 6);
    });
  }
});

// ---------------------------------------------------------------- 10. conversão × descoberta no MESMO criativo ou conjunto (corretor final)

describe("conversão × descoberta no MESMO criativo ou conjunto: a verba, o sinal e a média só com o de conversão", () => {
  const soma = (xs: { spend: number }[]) => xs.reduce((t, l) => t + l.spend, 0);
  /** A produção com o anúncio de Reels (DESCOBERTA) usando o `creativeId` de um criativo de conversão. */
  const comCriativoMisto = (creativeId: string, multiplicarReels = 1): SemanaDaMidia => {
    const p = producaoSemana();
    p.data.creatives = p.data.creatives.map((c) => (c.adId === IDS.anuncio.reels ? { ...c, creativeId } : c));
    p.data.adDaily = p.data.adDaily.map((r) => (r.adId === IDS.anuncio.reels ? { ...r, spend: r.spend * multiplicarReels } : r));
    return p;
  };

  it("o criativo misto vira duas linhas: a de conversão só com o gasto de conversão (o cartão de antes); a de descoberta com `desc|`, sem sinal", () => {
    const p = comCriativoMisto(IDS.criativo.carrosselMirante);
    const { bloco } = criativosComSinal(entradaDosSinaisDa(p));
    const { kpis } = montar(p);
    const conv = bloco.conversao.find((l) => l.chave === IDS.criativo.carrosselMirante)!;
    expect(conv.spend).toBeCloseTo(70, 6);
    expect(conv.bucket).toBe("conversao");
    const desc = bloco.descoberta.find((l) => l.chave === `desc|${IDS.criativo.carrosselMirante}`)!;
    expect(desc).toBeDefined();
    expect(desc.sinal).toBeNull();
    expect(desc.spend).toBeGreaterThan(0);
    // Σ gasto dos criativos de conversão = o investimento de conversão (a verba de descoberta fica fora do cartão).
    expect(soma(bloco.conversao)).toBeCloseTo(kpis.investimentoConversao.valor, 6);
    // O cartão é o MESMO de sem o anúncio de descoberta: sinal, motivo, gasto e % — e nunca um Pausar falso.
    const card = midiaDa(p).criativos!.todos.find((c) => c.chave === IDS.criativo.carrosselMirante)!;
    const antes = midiaDa(producaoSemana()).criativos!.todos.find((c) => c.chave === IDS.criativo.carrosselMirante)!;
    expect(card.sinal).toEqual(antes.sinal);
    expect(card.motivo).toBe(antes.motivo);
    expect(card.numeros).toEqual(antes.numeros);
    expect(card.sinal.id).not.toBe("pausar");
    // A média dos criativos também não muda.
    expect(bloco.media).toEqual(criativosComSinal(entradaDosSinaisDa(producaoSemana())).bloco.media);
  });

  it("o criativo de conversão não some dos cartões quando o anúncio de descoberta com o mesmo id gasta mais", () => {
    const p = comCriativoMisto(IDS.criativo.post8, 6);
    const todos = midiaDa(p).criativos!.todos;
    const post8 = todos.find((c) => c.chave === IDS.criativo.post8)!;
    expect(post8).toBeDefined();
    const antes = midiaDa(producaoSemana()).criativos!.todos.find((c) => c.chave === IDS.criativo.post8)!;
    expect(post8.numeros).toEqual(antes.numeros);
    expect(post8.sinal).toEqual(antes.sinal);
  });

  it("o conjunto MISTO com gasto de descoberta: a verba usa só o gasto de conversão dele — Σ das linhas = o investimento de conversão", () => {
    const p = producaoSemana();
    // O anúncio de descoberta do conjunto misto passa a gastar R$ 5 por dia.
    p.data.adDaily = p.data.adDaily.map((r) => (r.adId === IDS.anuncio.videoMirante ? { ...r, spend: 5 } : r));
    // E um conjunto de DESCOBERTA ganha uma linha de anúncio de conversão (R$ 2 por dia).
    const extra = p.data.adDaily.filter((r) => r.adId === IDS.anuncio.video3).map((r) => ({ ...r, adId: "73000099", objective: "OUTCOME_LEADS", spend: 2 }));
    p.data.adDaily = [...p.data.adDaily, ...extra];
    const { kpis, conjuntos, verba, fora } = montar(p);
    const mirante = conjuntosDe(conjuntos.conversao).find((l) => l.adsetId === IDS.conjunto.mirante)!;
    expect(mirante.spend).toBeCloseTo(105, 6);
    expect(mirante.gastoConversao).toBeCloseTo(70, 6);
    const envolvimento = conjuntosDe(conjuntos.descoberta).find((l) => l.adsetId === IDS.conjunto.envolvimento)!;
    expect(envolvimento.gastoConversao).toBeCloseTo(14, 6);
    // Σ das linhas da verba = o investimento de conversão (que soma por linha de anúncio).
    expect(kpis.investimentoConversao.valor).toBeCloseTo(614, 6);
    expect(conjuntosDaVerba(conjuntos).reduce((t, l) => t + gastoDaVerba(l), 0)).toBeCloseTo(kpis.investimentoConversao.valor, 6);
    expect(verba.linhas.find((l) => l.chave === mirante.chave)!.barraVerba).toBeCloseTo(70 / 614, 9);
    expect(verba.linhas.find((l) => l.chave === envolvimento.chave)!.barraVerba).toBeCloseTo(14 / 614, 9);
    const linhas = nos100(verba);
    expect(linhas.reduce((t, l) => t + l.barraVerba, 0)).toBeCloseTo(1, 9);
    expect(linhas.reduce((t, l) => t + inteiroDe(l.pctVerba), 0)).toBe(100);
    // E os leads continuam fechando: D + n = os leads de conversão.
    expect(fora.n + [...fora.porConjunto.values()].reduce((t, v) => t + v, 0)).toBe(kpis.leadsConversao.valor);
    // O ⓘ diz que a base é o gasto de CONVERSÃO do conjunto.
    expect(verba.dica).toContain("% da verba = gasto de conversão do conjunto ÷");
  });
});

// ---------------------------------------------------------------- 11. um "Fora do ar" por recorte; "> 99%"; singular (corretor final)

describe("o 'Fora do ar' de Detalhes diz a live; '> 99%' ao lado de '< 1%'; o singular", () => {
  it("com um conjunto da live parado, Detalhes diz '1 da live' (o que está em Pausados) e o 'Fora do ar' da verba não tem a live", () => {
    const p = comLive();
    // O conjunto "Persona" da live para 3 dias antes de hoje.
    p.data.adDaily = p.data.adDaily.filter((r) => !(r.adId === IDS.anuncio.c4b && r.date >= somarDias(p.hoje, -2)));
    const m = midiaDa(p);
    const { conjuntos, kpis } = montar(p);
    const parados = conjuntosDaVerba(conjuntos).filter((l) => l.veiculacao.estado !== "no-ar");
    expect(parados.filter((l) => l.daLive)).toHaveLength(1);
    expect(parados.filter((l) => !l.daLive).length).toBeGreaterThan(0);
    expect(m.detalhes.conjuntos.foraDoAr).toMatchObject({ n: parados.length, daLive: 1 });
    expect(m.pausados!.conjuntos.flatMap((c) => c.conjuntos ?? [])).toHaveLength(parados.length);
    // A verba: "Fora do ar" = só os de fora da live; o parado da live está na linha da live.
    const foraDoAr = m.verba!.linhas.find((l) => l.tipo === "fora-do-ar")!;
    const semLive = parados.filter((l) => !l.daLive).reduce((t, l) => t + gastoDaVerba(l), 0);
    expect(foraDoAr.barraVerba).toBeCloseTo(semLive / kpis.investimentoConversao.valor, 9);
  });

  it("o maior resto nunca põe '100%' ao lado de '< 1%': a linha de cima vira '> 99%'", () => {
    expect(porcentagensInteiras([997, 3])).toEqual([100, 0]);
    expect(textoDaPorcentagem(100, 0.997)).toBe("> 99%");
    expect(textoDaPorcentagem(100, 1)).toBe("100%");
    expect(textoDaPorcentagem(0, 0.003)).toBe("< 1%");
    // Na verba: um conjunto no ar com R$ 997 e um que parou com R$ 3.
    const v = montar(semanaDe([{ nome: "Alfa", gasto: 997, leads: 12 }, { nome: "Beta", gasto: 3, leads: 0, dia: "2026-11-07" }])).verba;
    const textos = nos100(v).map((l) => l.pctVerba);
    expect(textos).toContain("< 1%");
    expect(textos).toContain("> 99%");
    expect(textos).not.toContain("100%");
    // O cartão também: o criativo de R$ 997 sai "> 99%" ao lado do de R$ 3.
    const cards = midiaDa(semanaDe([{ nome: "Alfa", gasto: 997, leads: 12 }, { nome: "Beta", gasto: 3, leads: 0 }])).criativos!.todos;
    expect(cards.map((c) => c.numeros.pctVerba).sort()).toEqual(["< 1%", "> 99%"]);
  });

  it("singular nos ⓘ: '1 lead', 'o único lead', '1 de 1 lead'", () => {
    const um = midiaDa(semanaDe([{ nome: "Alfa", gasto: 100, leads: 1 }]));
    expect(um.verba!.dica).toContain("÷ 1 lead de conversão com conjunto.");
    expect(um.criativos!.dica).toContain("O CPL do resumo divide pelo único lead de conversão.");
    expect(sp(um.criativos!.dica)).toContain("(R$ 100, 1 lead), a live incluída.");
    for (const d of [um.verba!.dica, um.criativos!.dica]) expect(d).not.toMatch(/\b1 leads\b|todos os 1 /);
    const fora = midiaDa(semanaDe([{ nome: "Alfa", gasto: 100, leads: 0 }], { leadsFora: 1 }));
    expect(fora.verba!.dica).toContain("Fora das linhas: 1 de 1 lead de conversão.");
    expect(fora.verba!.linhas.find((l) => l.tipo === "fora-das-linhas")!.pctLeads).toBe("1 de 1 lead");
    expect(alertaForaDasLinhas(1, 1)[0].titulo).toBe("1 de 1 lead de conversão sem conjunto identificado");
    // O lead de anúncio de fora é lead de conversão: o CPL do resumo divide por ele.
    expect(fora.criativos!.dica).toContain("O CPL do resumo divide pelo único lead de conversão.");
    const zero = midiaDa(semanaDe([{ nome: "Alfa", gasto: 100, leads: 0 }]));
    expect(zero.criativos!.dica).toContain("Nenhum lead de conversão no período: o CPL do resumo fica em —.");
  });
});
