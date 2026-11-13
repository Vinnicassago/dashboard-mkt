/**
 * Fase 4 (§5.2 da spec) — o "NO AR" da Mídia (`lib/veiculacao.ts`), sem o status do
 * Meta: impressão OU gasto nos 3 dias (`DIAS_DE_ATRASO_DA_META + 1`) até o dia de
 * referência (min(fim, dia em Brasília do último sync de anúncios OK); sem sync, o
 * último dia com linha). Fora da janela: "parou" só com um dia depois do último gasto
 * COBERTO por sync bem-sucedido (ADR-06); senão "sem leitura". E o "sem resultado"
 * que saiu da fadiga (F4-D3): anúncio desligado nunca fica vermelho.
 *
 * Datas fixas (12/11/2026, a semana de produção de `fixtures-midia`), nunca o relógio.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DIAS_DE_ATRASO_DA_META, janelasCobertas, type Intervalo } from "../cobertura";
import { computeFatigue } from "../metrics";
import { JANELA_NO_AR_DIAS, janelaNoAr, noArTexto, refDaVeiculacao, veiculacaoNoFim } from "../veiculacao";
import type { AdDaily } from "../types";
import { HOJE, IDS, producaoSemana, somarDias, syncDeAnuncios } from "@/test/fixtures-midia";
import { midiaDa, semanaDoSeed } from "@/test/entrada-midia";

/** Uma linha de anúncio de conversão (gasto e impressões > 0 por padrão). */
const linha = (date: string, extra: Partial<AdDaily> = {}): AdDaily => ({
  brand: "consorcio",
  date,
  campaign: "[ACM] CP7 - Leads",
  campaignId: "71000001",
  adset: "Aurora Interesses 30-55",
  adsetId: "72000001",
  adId: "73000001",
  objective: "OUTCOME_LEADS",
  spend: 20,
  impressions: 800,
  reach: 600,
  frequency: 1.3,
  clicks: 10,
  leads: 1,
  ...extra,
});

/** Linhas diárias de `de` a `ate` (inclusive). */
function linhas(de: string, ate: string, extra: Partial<AdDaily> = {}): AdDaily[] {
  const out: AdDaily[] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) out.push(linha(d, extra));
  return out;
}

/** O sync das 06:02 de 12/11 em Brasília: cobre até 10/11 (a Meta atrasa 2 dias). */
const COBERTURA_ATE_10: Intervalo[] = janelasCobertas([syncDeAnuncios("s1", "2026-11-12T09:02:00Z", "2026-10-20", HOJE)]);
const REF = HOJE;

// ---------------------------------------------------------------- refDaVeiculacao

describe("refDaVeiculacao: o dia de referência do 'no ar'", () => {
  const rows = linhas("2026-11-01", "2026-11-12");

  it("o sync às 06:02 de 12/11 (Brasília) → 12/11", () => {
    expect(refDaVeiculacao({ fim: HOJE, ultimoSyncAds: "2026-11-12T09:02:00Z", rows })).toBe("2026-11-12");
  });

  it("o sync às 22:30 de 11/11 (Brasília; 12/11 em UTC) → 11/11 — e a cobertura dele vai até 10/11, ≥ ref − 2 (K17)", () => {
    const fim = "2026-11-12T01:30:00Z";
    const ref = refDaVeiculacao({ fim: HOJE, ultimoSyncAds: fim, rows });
    expect(ref).toBe("2026-11-11");
    const cob = janelasCobertas([syncDeAnuncios("s-noite", fim, "2026-10-20", HOJE)]);
    expect(cob).toEqual([{ from: "2026-10-20", to: "2026-11-10" }]);
    // A prova do "parou" (K17): a cobertura nunca fica atrás de ref − 2.
    expect(cob[0].to >= somarDias(ref, -DIAS_DE_ATRASO_DA_META)).toBe(true);
  });

  it("o fim do período antes do sync → o fim", () => {
    expect(refDaVeiculacao({ fim: "2026-11-08", ultimoSyncAds: "2026-11-12T09:02:00Z", rows })).toBe("2026-11-08");
  });

  it("sem sync registrado → o último dia com linha (min com o fim)", () => {
    expect(refDaVeiculacao({ fim: HOJE, ultimoSyncAds: null, rows: linhas("2026-07-09", "2026-07-23") })).toBe("2026-07-23");
    expect(refDaVeiculacao({ fim: "2026-07-20", ultimoSyncAds: null, rows: linhas("2026-07-09", "2026-07-23") })).toBe("2026-07-20");
  });

  it("sem linha nenhuma → o fim", () => {
    expect(refDaVeiculacao({ fim: HOJE, ultimoSyncAds: null, rows: [] })).toBe(HOJE);
  });

  it("período no passado (fim 31/10, sync em 12/11) → 31/10", () => {
    expect(refDaVeiculacao({ fim: "2026-10-31", ultimoSyncAds: "2026-11-12T09:02:00Z", rows })).toBe("2026-10-31");
  });
});

// ---------------------------------------------------------------- veiculacaoNoFim

describe("veiculacaoNoFim (ref = 12/11, cobertura até 10/11)", () => {
  const o = { ref: REF, cobertura: COBERTURA_ATE_10 };

  it("a janela é [ref − 2, ref] e JANELA_NO_AR_DIAS = DIAS_DE_ATRASO_DA_META + 1", () => {
    expect(JANELA_NO_AR_DIAS).toBe(DIAS_DE_ATRASO_DA_META + 1);
    expect(JANELA_NO_AR_DIAS).toBe(3);
    expect(janelaNoAr(REF)).toEqual({ from: "2026-11-10", to: "2026-11-12" });
  });

  it("impressão em 10/11 (sem gasto) → no ar", () => {
    const v = veiculacaoNoFim([linha("2026-11-05"), linha("2026-11-10", { spend: 0, impressions: 300 })], o);
    expect(v).toEqual({ estado: "no-ar", ultimoDia: "2026-11-10", rotulo: "No ar" });
  });

  it("impressão só em 12/11 (o dia parcial) → no ar", () => {
    expect(veiculacaoNoFim([linha("2026-11-12", { spend: 0, impressions: 40 })], o).estado).toBe("no-ar");
    // Gasto sem impressão também é veiculação.
    expect(veiculacaoNoFim([linha("2026-11-11", { impressions: 0, spend: 3 })], o).estado).toBe("no-ar");
  });

  it("último gasto em 08/11 → parou, 'Último gasto em 08/11'", () => {
    expect(veiculacaoNoFim(linhas("2026-11-01", "2026-11-08"), o)).toEqual({ estado: "parou", ultimoDia: "2026-11-08", rotulo: "Último gasto em 08/11" });
  });

  it("último gasto em 09/11 → parou (o 10/11 está coberto)", () => {
    const v = veiculacaoNoFim(linhas("2026-11-01", "2026-11-09"), o);
    expect(v.estado).toBe("parou");
    expect(v.rotulo).toBe("Último gasto em 09/11");
  });

  it("linha zerada em 11/11 e gasto até 08/11 → parou (a linha zerada não é veiculação)", () => {
    const rows = [...linhas("2026-11-01", "2026-11-08"), linha("2026-11-11", { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 })];
    expect(veiculacaoNoFim(rows, o)).toMatchObject({ estado: "parou", ultimoDia: "2026-11-08" });
  });

  it("linhas DEPOIS do ref não contam (período no passado)", () => {
    const v = veiculacaoNoFim(linhas("2026-10-20", "2026-11-12"), { ref: "2026-10-25", cobertura: COBERTURA_ATE_10 });
    expect(v).toMatchObject({ estado: "no-ar", ultimoDia: "2026-10-25" });
  });
});

describe("ADR-06: sem cobertura não é 'parou'", () => {
  it("sem cobertura nenhuma e último gasto em 08/11 → sem leitura, 'Sem leitura depois de 08/11' — nunca 'parou'", () => {
    for (const cobertura of [[], [{ from: "2026-10-01", to: "2026-11-08" }]] as Intervalo[][]) {
      const v = veiculacaoNoFim(linhas("2026-11-01", "2026-11-08"), { ref: REF, cobertura });
      expect(v).toEqual({ estado: "sem-leitura", ultimoDia: "2026-11-08", rotulo: "Sem leitura depois de 08/11" });
    }
  });

  it("nenhuma linha com veiculação → 'Sem leitura', sem dia", () => {
    expect(veiculacaoNoFim([], { ref: REF, cobertura: COBERTURA_ATE_10 })).toEqual({ estado: "sem-leitura", ultimoDia: null, rotulo: "Sem leitura" });
  });
});

describe("o grupo (conjunto ou criativo): as linhas de todos os anúncios juntas", () => {
  const o = { ref: REF, cobertura: COBERTURA_ATE_10 };
  const noAr = linhas("2026-11-01", "2026-11-12", { adId: "a1" });
  const parado = linhas("2026-11-01", "2026-11-05", { adId: "a2" });

  it("um anúncio no ar e outro parado → no ar, com o último dia = o máximo", () => {
    expect(veiculacaoNoFim([...parado, ...noAr], o)).toMatchObject({ estado: "no-ar", ultimoDia: "2026-11-12" });
  });

  it("parou + sem leitura → sem leitura (o `ultimoDia` é o máximo)", () => {
    // A cobertura vai só até 06/11: o anúncio que parou em 05/11 tem o 06/11 coberto;
    // o que gastou até 08/11 não tem nenhum dia coberto depois.
    const cob: Intervalo[] = [{ from: "2026-11-01", to: "2026-11-06" }];
    const a = linhas("2026-11-01", "2026-11-05", { adId: "a1" });
    const b = linhas("2026-11-01", "2026-11-08", { adId: "a2" });
    expect(veiculacaoNoFim(a, { ref: REF, cobertura: cob }).estado).toBe("parou");
    expect(veiculacaoNoFim(b, { ref: REF, cobertura: cob }).estado).toBe("sem-leitura");
    expect(veiculacaoNoFim([...a, ...b], { ref: REF, cobertura: cob })).toEqual({
      estado: "sem-leitura",
      ultimoDia: "2026-11-08",
      rotulo: "Sem leitura depois de 08/11",
    });
  });

  it("dois parados → parou, com o último gasto do grupo", () => {
    const a = linhas("2026-11-01", "2026-11-05", { adId: "a1" });
    const b = linhas("2026-11-01", "2026-11-07", { adId: "a2" });
    expect(veiculacaoNoFim([...a, ...b], o)).toEqual({ estado: "parou", ultimoDia: "2026-11-07", rotulo: "Último gasto em 07/11" });
  });
});

// ---------------------------------------------------------------- noArTexto (K7)

describe("noArTexto (K7): o título diz a data quando o ref é anterior a hoje", () => {
  it("ref = hoje → 'no ar'; ref < hoje → 'no ar em dd/mm'", () => {
    expect(noArTexto("2026-11-12", "2026-11-12")).toBe("no ar");
    expect(noArTexto("2026-07-23", "2026-11-12")).toBe("no ar em 23/07");
    expect(noArTexto("2026-11-11", "2026-11-12")).toBe("no ar em 11/11");
  });

  it("a Mídia do seed (sem sync, dado até 23/07) com range=all: o título dos criativos diz 'no ar em 23/07'", () => {
    const m = midiaDa(semanaDoSeed("consorcio"), "all");
    expect(m.criativos).not.toBeNull();
    expect(m.criativos!.titulo).toContain("no ar em 23/07");
    // A verba também diz a data nas regras que a citam (2, 3 e 5); nunca "no ar" no presente.
    if (m.verba && /no ar/.test(m.verba.titulo)) expect(m.verba.titulo).toContain("no ar em 23/07");
  });
});

// ---------------------------------------------------------------- "sem resultado" saiu (F4-D3)

describe("'Sem resultado' saiu da fadiga (F4-D3): só existe como Pausar, só no ar", () => {
  it("computeFatigue com gasto e 0 lead nunca devolve 'sem-resultado' — nem com a opção antiga", () => {
    const rows = linhas("2026-11-06", "2026-11-12", { spend: 60, leads: 0 });
    expect(computeFatigue(rows, { fim: HOJE, cobertura: COBERTURA_ATE_10 }).level).not.toBe("sem-resultado");
    const antiga = { fim: HOJE, cobertura: COBERTURA_ATE_10, semResultado: { gastoPeriodo: 420, leadsPainel: 0, cplAlvo: 50 } };
    expect(computeFatigue(rows, antiga as never).level).not.toBe("sem-resultado");
  });

  it("o fonte de metrics.ts não tem mais 'sem-resultado' nem `semResultado`", () => {
    const fonte = fs.readFileSync(path.join(process.cwd(), "src/lib/metrics.ts"), "utf8");
    expect(fonte).not.toContain('"sem-resultado"');
    expect(fonte).not.toContain("semResultado");
  });

  it("na Mídia: o criativo que parou em 08/11 com gasto ≥ 3 × a média e 0 lead não tem sinal, e mora em Pausados, sem cor", () => {
    const m = midiaDa(producaoSemana(), "7d");
    const parou = m.pausados?.criativos.find((l) => l.chave === IDS.criativo.post6);
    expect(parou, "o post de 6 palavras em Pausados").toBeDefined();
    expect(parou!.veiculacao.estado).toBe("parou");
    expect(parou!.veiculacao.rotulo).toBe("Último gasto em 08/11");
    expect(parou!.sinal).toBeNull();
    expect(parou!.leadsPainel).toBe(0);
    // Gastou ≥ 3 × a média dos criativos (R$ 600 ÷ 15 leads com criativo = R$ 40): o
    // Pausar/sem-resultado, se estivesse no ar.
    expect(parou!.spend).toBeGreaterThanOrEqual(3 * (600 / 15));
    // Nem em Detalhes (só os no ar), nem nos cartões.
    expect(m.detalhes.criativos.conversao.some((l) => l.chave === IDS.criativo.post6)).toBe(false);
    expect(m.criativos!.todos.some((c) => c.chave === IDS.criativo.post6)).toBe(false);
    // Nenhuma linha de Pausados tem sinal (nem tom de status).
    for (const l of m.pausados!.criativos) expect(l.sinal).toBeNull();
  });
});
