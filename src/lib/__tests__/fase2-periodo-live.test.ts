/**
 * Fase 2 (nov/26), etapa A3 — o período (C9) e o atalho da live (C10), só a
 * lógica pura: `resolveRange` nunca devolve "tudo" para um período pedido,
 * `pageRange` diz quando o período ainda não começou, e `atalho-live.ts` decide
 * botão, modo live, destino da antiga `/live` e o range do painel congelado.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  atalhoDaLive,
  chavesDaLive,
  destinoDaLive,
  periodoDaLive,
  rangeDoPainelLive,
  subAtalhosDaLive,
} from "../atalho-live";
import { LIVE_PADRAO, type CampanhaDaLive } from "../live";
import { pageRange } from "../page-range";
import { buildCustomKey, parseCustomRange, resolveRange } from "../range";
import type { AdDaily, DashboardData } from "../types";

// ------------------------------------------------------------------ fixtures

const ad = (date: string, spend = 10): AdDaily => ({
  brand: "consorcio",
  date,
  campaign: "[BRN] Leads",
  adset: "Conjunto",
  adId: "111111",
  objective: "OUTCOME_LEADS",
  spend,
  impressions: 1000,
  reach: 800,
  frequency: 1.25,
  clicks: 10,
  leads: 1,
});

function dataset(adDaily: AdDaily[]): DashboardData {
  return {
    campaign: {
      id: "c",
      brand: "consorcio",
      name: "Campanha",
      objective: "Leads",
      status: "ativa",
      startDate: "2026-08-01",
      budgetTotal: 0,
    },
    igAccountDaily: [],
    igPosts: [],
    adDaily,
    creatives: [],
    lpDaily: [],
    leads: [],
    goals: [],
    updatedAt: "2026-11-05T12:00:00.000Z",
  };
}

/** Anúncios de 01/08 a 04/11 (o dia 05/11 ainda não chegou da Meta). */
const SPAN = { from: "2026-08-01", to: "2026-11-04" };
const HOJE = "2026-11-05";

const cfg = (parcial: Partial<CampanhaDaLive> = {}): CampanhaDaLive => ({ ...LIVE_PADRAO, ...parcial });

const K = {
  campanha: "2026-11-16..2026-12-15",
  captacao: "2026-11-16..2026-12-01",
  posLive: "2026-12-02..2026-12-15",
};

/**
 * A conta da antiga `live/page.tsx` (linhas 70-83 em 05/11), copiada como era,
 * para o `rangeDoPainelLive` ser comparado com ela e não com ele mesmo.
 */
function contaDaPaginaLive(rangeParam: string | undefined, c: CampanhaDaLive, hoje: string) {
  const chaveDe = (i: { de: string; ate: string }) => `${i.de}..${i.ate}`;
  const atalhos = [
    { rotulo: "Campanha da live", chave: chaveDe(c.periodo) },
    { rotulo: "Captação", chave: chaveDe(c.captacao) },
    { rotulo: "Pós-live", chave: chaveDe(c.posLive) },
  ];
  const chave = rangeParam && parseCustomRange(rangeParam) ? rangeParam : atalhos[0].chave;
  const livre = parseCustomRange(chave)!;
  const de = livre.from ?? c.periodo.de;
  const ateBruto = livre.to ?? c.periodo.ate;
  const ate = ateBruto > hoje ? hoje : ateBruto;
  const naoComecou = de > hoje;
  const range = naoComecou ? { de, ate: de } : { de, ate };
  return { chave, range, naoComecou, atalhos };
}

afterEach(() => {
  vi.useRealTimers();
});

// ------------------------------------------------------------------ C9

describe("C9 — resolveRange: undefined só para 'all', sem chave ou chave inválida", () => {
  it("'all', ausente, vazio e inválido são 'tudo'", () => {
    expect(resolveRange("all", SPAN, HOJE)).toBeUndefined();
    expect(resolveRange(undefined, SPAN, HOJE)).toBeUndefined();
    expect(resolveRange("", SPAN, HOJE)).toBeUndefined();
    expect(resolveRange("lixo", SPAN, HOJE)).toBeUndefined();
    expect(resolveRange("toString", SPAN, HOJE)).toBeUndefined();
    expect(resolveRange("..", SPAN, HOJE)).toBeUndefined();
  });

  it("os presets contam a partir de hoje (inclusive), não do último anúncio", () => {
    expect(resolveRange("7d", SPAN, HOJE)).toEqual({ from: "2026-10-30", to: "2026-11-05" });
    expect(resolveRange("14d", SPAN, HOJE)).toEqual({ from: "2026-10-23", to: "2026-11-05" });
    expect(resolveRange("30d", SPAN, HOJE)).toEqual({ from: "2026-10-07", to: "2026-11-05" });
    expect(resolveRange("90d", SPAN, HOJE)).toEqual({ from: "2026-08-08", to: "2026-11-05" });
  });

  it("preset maior que o histórico encosta no 1º dado", () => {
    expect(resolveRange("90d", { from: "2026-09-01", to: "2026-11-04" }, HOJE)).toEqual({ from: "2026-09-01", to: "2026-11-05" });
  });

  it("preset nunca inverte: dado que só começa depois de hoje não puxa o início", () => {
    expect(resolveRange("7d", { from: "2026-11-10", to: "2026-11-12" }, HOJE)).toEqual({ from: "2026-10-30", to: "2026-11-05" });
  });

  it("preset sem 'hoje' cai no último dado; sem nenhum dos dois é 'tudo'", () => {
    expect(resolveRange("7d", SPAN)).toEqual({ from: "2026-10-29", to: "2026-11-04" });
    expect(resolveRange("7d", { from: "", to: "" }, "")).toBeUndefined();
  });

  it("período livre dentro do histórico sai como pedido", () => {
    expect(resolveRange("2026-09-01..2026-09-30", SPAN, HOJE)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("período livre invertido na URL é desinvertido", () => {
    expect(resolveRange("2026-09-30..2026-09-01", SPAN, HOJE)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("período livre que passa de hoje termina hoje; o que começa antes do 1º dado começa nele", () => {
    expect(resolveRange("2026-11-01..2026-11-30", SPAN, HOJE)).toEqual({ from: "2026-11-01", to: "2026-11-05" });
    expect(resolveRange("2026-07-01..2026-08-10", SPAN, HOJE)).toEqual({ from: "2026-08-01", to: "2026-08-10" });
  });

  it("pontas abertas: 'de..' vai até hoje; '..ate' começa no 1º dado", () => {
    expect(resolveRange("2026-10-01..", SPAN, HOJE)).toEqual({ from: "2026-10-01", to: "2026-11-05" });
    expect(resolveRange("..2026-09-15", SPAN, HOJE)).toEqual({ from: "2026-08-01", to: "2026-09-15" });
  });

  it("marca sem anúncio: o período livre é o pedido (limitado a hoje)", () => {
    const vazio = { from: "", to: "" };
    expect(resolveRange("2026-10-01..2026-10-07", vazio, HOJE)).toEqual({ from: "2026-10-01", to: "2026-10-07" });
    expect(resolveRange("2026-10-01..", vazio, HOJE)).toEqual({ from: "2026-10-01", to: "2026-11-05" });
    expect(resolveRange("..2026-10-07", vazio, HOJE)).toEqual({ from: "2026-10-07", to: "2026-10-07" });
  });

  describe("from > to nunca vira 'tudo'", () => {
    it("caso 1 — período que ainda não começou: o 1º dia pedido, vazio", () => {
      // A chave da live em 05/11: antes virava undefined = a campanha inteira em silêncio.
      expect(resolveRange(K.campanha, SPAN, HOJE)).toEqual({ from: "2026-11-16", to: "2026-11-16" });
      expect(resolveRange(K.captacao, SPAN, HOJE)).toEqual({ from: "2026-11-16", to: "2026-11-16" });
      expect(resolveRange(K.posLive, SPAN, HOJE)).toEqual({ from: "2026-12-02", to: "2026-12-02" });
      expect(resolveRange("2026-11-16..", SPAN, HOJE)).toEqual({ from: "2026-11-16", to: "2026-11-16" });
      // Começa amanhã: ainda é futuro.
      expect(resolveRange("2026-11-06..2026-11-10", SPAN, HOJE)).toEqual({ from: "2026-11-06", to: "2026-11-06" });
    });

    it("caso 1 — começa hoje não é futuro: hoje..hoje", () => {
      expect(resolveRange("2026-11-05..2026-11-30", SPAN, HOJE)).toEqual({ from: "2026-11-05", to: "2026-11-05" });
    });

    it("caso 2 — período inteiro antes do 1º dado: o pedido, sem o clamp do span", () => {
      expect(resolveRange("2026-01-01..2026-01-31", SPAN, HOJE)).toEqual({ from: "2026-01-01", to: "2026-01-31" });
      expect(resolveRange("2026-07-01..2026-07-31", SPAN, HOJE)).toEqual({ from: "2026-07-01", to: "2026-07-31" });
      // Sem início pedido: o último dia pedido, vazio.
      expect(resolveRange("..2026-07-31", SPAN, HOJE)).toEqual({ from: "2026-07-31", to: "2026-07-31" });
    });

    it("caso 2 — o histórico começa depois de hoje (dado futuro): o pedido até hoje", () => {
      expect(resolveRange("2026-11-01..2026-11-30", { from: "2026-11-10", to: "2026-11-12" }, HOJE)).toEqual({
        from: "2026-11-01",
        to: "2026-11-05",
      });
    });
  });
});

describe("C9 — pageRange devolve naoComecou", () => {
  const data = dataset([ad("2026-08-01"), ad("2026-11-04")]);

  it("período futuro: o 1º dia e naoComecou", () => {
    expect(pageRange(data, K.campanha, HOJE)).toEqual({
      range: { from: "2026-11-16", to: "2026-11-16" },
      span: SPAN,
      rangeKey: K.campanha,
      naoComecou: true,
    });
  });

  it("presets, período passado, antes do 1º dado e 'tudo' já começaram", () => {
    expect(pageRange(data, "7d", HOJE)).toMatchObject({ range: { from: "2026-10-30", to: "2026-11-05" }, naoComecou: false });
    expect(pageRange(data, "2026-09-01..2026-09-30", HOJE).naoComecou).toBe(false);
    expect(pageRange(data, "2026-01-01..2026-01-31", HOJE)).toMatchObject({
      range: { from: "2026-01-01", to: "2026-01-31" },
      naoComecou: false,
    });
    expect(pageRange(data, "2026-11-05..2026-11-30", HOJE).naoComecou).toBe(false);
    expect(pageRange(data, undefined, HOJE)).toEqual({ range: undefined, span: SPAN, rangeKey: "all", naoComecou: false });
  });

  it("depois que o período começa, naoComecou cai", () => {
    expect(pageRange(data, K.campanha, "2026-11-16")).toMatchObject({
      range: { from: "2026-11-16", to: "2026-11-16" },
      naoComecou: false,
    });
    expect(pageRange(data, K.campanha, "2026-11-20")).toMatchObject({
      range: { from: "2026-11-16", to: "2026-11-20" },
      naoComecou: false,
    });
  });

  it("sem 'hoje' explícito usa o dia de Brasília", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T02:00:00Z")); // 05/11 23h em Brasília
    expect(pageRange(data, "7d")).toMatchObject({ range: { from: "2026-10-30", to: "2026-11-05" }, naoComecou: false });
    expect(pageRange(data, "2026-11-06..2026-11-10").naoComecou).toBe(true);
  });
});

// ------------------------------------------------------------------ C10

describe("C10 — chavesDaLive e periodoDaLive", () => {
  it("as três chaves são os períodos livres da régua", () => {
    expect(chavesDaLive(cfg())).toEqual(K);
    expect(chavesDaLive(cfg()).campanha).toBe(buildCustomKey(LIVE_PADRAO.periodo.de, LIVE_PADRAO.periodo.ate));
  });

  it("sub-atalhos do painel na ordem e com os rótulos da antiga /live", () => {
    expect(subAtalhosDaLive(cfg())).toEqual([
      { id: "campanha", rotulo: "Campanha da live", chave: K.campanha },
      { id: "captacao", rotulo: "Captação", chave: K.captacao },
      { id: "posLive", rotulo: "Pós-live", chave: K.posLive },
    ]);
  });

  it("casa as três chaves", () => {
    expect(periodoDaLive(K.campanha, cfg())).toBe("campanha");
    expect(periodoDaLive(K.captacao, cfg())).toBe("captacao");
    expect(periodoDaLive(K.posLive, cfg())).toBe("posLive");
  });

  it("preset, 'all', ausente, inválido e período livre comum não são a live", () => {
    for (const k of ["7d", "30d", "all", "", "lixo", "2026-11-01..2026-11-30", "2026-11-16..", undefined, null]) {
      expect(periodoDaLive(k, cfg())).toBeNull();
    }
  });

  it("só igualdade de chave: as mesmas datas invertidas na URL não casam", () => {
    expect(periodoDaLive("2026-12-15..2026-11-16", cfg())).toBeNull();
  });

  it("chave antiga (a régua foi editada depois) vira período comum", () => {
    const editada = cfg({ periodo: { de: "2026-11-17", ate: "2026-12-15" }, captacao: { de: "2026-11-17", ate: "2026-12-01" } });
    expect(periodoDaLive(K.campanha, editada)).toBeNull();
    expect(periodoDaLive(K.captacao, editada)).toBeNull();
    expect(periodoDaLive("2026-11-17..2026-12-15", editada)).toBe("campanha");
    // O pós-live não foi editado: a chave dele continua.
    expect(periodoDaLive(K.posLive, editada)).toBe("posLive");
  });

  it("depois de 15/12 as chaves continuam casando (não olha a data)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-20T15:00:00Z"));
    expect(periodoDaLive(K.campanha, cfg())).toBe("campanha");
    expect(periodoDaLive(K.captacao, cfg())).toBe("captacao");
    expect(periodoDaLive(K.posLive, cfg())).toBe("posLive");
  });

  it("duas janelas com as mesmas datas: vale a primeira (campanha → captação → pós-live)", () => {
    const igual = cfg({ captacao: { ...LIVE_PADRAO.periodo } });
    expect(periodoDaLive(K.campanha, igual)).toBe("campanha");
  });
});

describe("C10 — atalhoDaLive: o botão some só depois de max(periodo.ate, posLive.ate)", () => {
  it("antes, durante e no último dia: visível, com a chave da campanha e o nome da régua", () => {
    for (const hoje of ["2026-11-05", "2026-11-16", "2026-12-01", "2026-12-15"]) {
      expect(atalhoDaLive(cfg(), hoje, "conversao")).toEqual({ chave: K.campanha, rotulo: "Live 01/12", visivel: true });
    }
  });

  it("depois do último dia: escondido, mas a chave continua a mesma", () => {
    expect(atalhoDaLive(cfg(), "2026-12-16", "conversao")).toEqual({ chave: K.campanha, rotulo: "Live 01/12", visivel: false });
    expect(atalhoDaLive(cfg(), "2027-01-10", "conversao").visivel).toBe(false);
  });

  it("pós-live editado para depois do período: o botão vai até o fim do pós-live", () => {
    const c = cfg({ posLive: { de: "2026-12-02", ate: "2026-12-20" } });
    expect(atalhoDaLive(c, "2026-12-16", "conversao").visivel).toBe(true);
    expect(atalhoDaLive(c, "2026-12-20", "conversao").visivel).toBe(true);
    expect(atalhoDaLive(c, "2026-12-21", "conversao").visivel).toBe(false);
  });

  it("período editado para depois do pós-live: o botão vai até o fim do período", () => {
    const c = cfg({ periodo: { de: "2026-11-16", ate: "2026-12-31" } });
    expect(atalhoDaLive(c, "2026-12-20", "conversao")).toEqual({ chave: "2026-11-16..2026-12-31", rotulo: "Live 01/12", visivel: true });
    expect(atalhoDaLive(c, "2027-01-01", "conversao").visivel).toBe(false);
  });

  it("rótulo é o nome editável da régua", () => {
    expect(atalhoDaLive(cfg({ nome: "Live de março" }), HOJE, "conversao").rotulo).toBe("Live de março");
  });

  it("marca awareness nunca vê o botão", () => {
    for (const hoje of ["2026-11-05", "2026-11-20", "2026-12-20"]) {
      expect(atalhoDaLive(cfg(), hoje, "awareness")).toEqual({ chave: K.campanha, rotulo: "Live 01/12", visivel: false });
    }
  });
});

describe("C10 — destinoDaLive: para onde a antiga /live manda", () => {
  it("preset, 'all', ausente, vazio e inválido → a campanha inteira", () => {
    for (const k of ["7d", "30d", "all", undefined, null, "", "lixo"]) {
      expect(destinoDaLive(k, cfg())).toBe(K.campanha);
    }
  });

  it("período livre comum e chave antiga → a campanha inteira", () => {
    expect(destinoDaLive("2026-11-01..2026-11-30", cfg())).toBe(K.campanha);
    const editada = cfg({ periodo: { de: "2026-11-17", ate: "2026-12-15" } });
    expect(destinoDaLive(K.campanha, editada)).toBe("2026-11-17..2026-12-15");
  });

  it("uma das três chaves da régua → ela mesma", () => {
    expect(destinoDaLive(K.campanha, cfg())).toBe(K.campanha);
    expect(destinoDaLive(K.captacao, cfg())).toBe(K.captacao);
    expect(destinoDaLive(K.posLive, cfg())).toBe(K.posLive);
  });
});

describe("C10 — rangeDoPainelLive reproduz a conta da antiga /live", () => {
  const casos = [
    // 05/11: nada começou ainda.
    { hoje: "2026-11-05", chave: K.campanha, esperado: { de: "2026-11-16", ate: "2026-11-16", naoComecou: true } },
    { hoje: "2026-11-05", chave: K.captacao, esperado: { de: "2026-11-16", ate: "2026-11-16", naoComecou: true } },
    { hoje: "2026-11-05", chave: K.posLive, esperado: { de: "2026-12-02", ate: "2026-12-02", naoComecou: true } },
    // 20/11: captação em curso, pós-live ainda não.
    { hoje: "2026-11-20", chave: K.campanha, esperado: { de: "2026-11-16", ate: "2026-11-20", naoComecou: false } },
    { hoje: "2026-11-20", chave: K.captacao, esperado: { de: "2026-11-16", ate: "2026-11-20", naoComecou: false } },
    { hoje: "2026-11-20", chave: K.posLive, esperado: { de: "2026-12-02", ate: "2026-12-02", naoComecou: true } },
  ];

  for (const { hoje, chave, esperado } of casos) {
    it(`${chave} com hoje = ${hoje}`, () => {
      const r = rangeDoPainelLive(chave, hoje, LIVE_PADRAO.periodo);
      expect(r).toEqual(esperado);
      const pagina = contaDaPaginaLive(chave, cfg(), hoje);
      expect({ de: r.de, ate: r.ate }).toEqual(pagina.range);
      expect(r.naoComecou).toBe(pagina.naoComecou);
      // Sem o `padrao` dá o mesmo: as três chaves têm as duas pontas.
      expect(rangeDoPainelLive(chave, hoje)).toEqual(esperado);
    });
  }

  it("com o padrão da régua, chave inválida ou de ponta aberta = a página", () => {
    for (const hoje of ["2026-11-05", "2026-11-20", "2026-12-20"]) {
      for (const chave of ["lixo", "7d", "2026-11-20..", "..2026-11-25"]) {
        const r = rangeDoPainelLive(chave, hoje, LIVE_PADRAO.periodo);
        const pagina = contaDaPaginaLive(chave, cfg(), hoje);
        expect({ de: r.de, ate: r.ate }).toEqual(pagina.range);
        expect(r.naoComecou).toBe(pagina.naoComecou);
      }
    }
  });

  it("depois do fim o painel mostra a campanha inteira (não corta em hoje)", () => {
    expect(rangeDoPainelLive(K.campanha, "2026-12-20")).toEqual({ de: "2026-11-16", ate: "2026-12-15", naoComecou: false });
  });

  it("sem o clamp do span: o painel começa no dia da régua mesmo com o 1º anúncio depois", () => {
    // Anúncios só a partir de 18/11: o resolveRange (kpis da página) encosta no 1º dado; o painel, não.
    const span = { from: "2026-11-18", to: "2026-11-19" };
    expect(resolveRange(K.campanha, span, "2026-11-20")).toEqual({ from: "2026-11-18", to: "2026-11-20" });
    expect(rangeDoPainelLive(K.campanha, "2026-11-20")).toEqual({ de: "2026-11-16", ate: "2026-11-20", naoComecou: false });
  });

  it("antes de começar, painel e resolveRange concordam: o 1º dia, vazio", () => {
    for (const chave of [K.campanha, K.captacao, K.posLive]) {
      const p = rangeDoPainelLive(chave, HOJE);
      expect(resolveRange(chave, SPAN, HOJE)).toEqual({ from: p.de, to: p.ate });
    }
  });
});

describe("atalho-live.ts é importável no cliente", () => {
  it("sem server-only, sem store e só import de TIPO da régua", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/atalho-live.ts"), "utf8");
    expect(src).not.toMatch(/server-only/);
    expect(src).not.toMatch(/data\/store|live-server|atendimento-server/);
    expect(src).toMatch(/import type \{[^}]*CampanhaDaLive[^}]*\} from "\.\/live"/);
    expect(src).not.toMatch(/^import \{[^}]*\} from "\.\/live"/m);
  });
});
