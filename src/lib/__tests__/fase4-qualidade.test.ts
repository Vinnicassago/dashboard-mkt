/**
 * Fase 4 (§5.4 da spec) — a resposta ao robô POR LINHA da Mídia (criativo, conjunto):
 * `trechoDoRoboPorLinha` (funil-processo.ts) conta, com a MESMA classificação e os
 * MESMOS fatos do Funil (`fatosDoTrecho`), quantos de cada linha estão no robô, falaram,
 * responderam, aceitaram e estão sem WhatsApp — sem teste nem cópia de duplicado.
 *
 *   • A conferência com o Funil (K14): Σ linhas + sem linha + teste/cópia (por fato) =
 *     cada degrau do robô de `funilDoProcesso` na mesma entrada. Não é tautologia: o
 *     lado esquerdo sai das contagens por linha, o direito do funil.
 *   • A partição: os `leads` de cada linha = o "Leads (painel)" dela, com e sem o robô.
 *   • Os textos de `QualidadeDaLinha` ("6 de 9 · 67%", "1 de 2", "—", "≥ N") e os
 *     valores de ordenação.
 *   • As colunas do robô por `colunasDoRobo` e a situação `roboNosCriativos` (K23).
 *
 * Só contagens por chave: os ids de lead nunca saem daqui (LGPD).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ATOR_LP } from "../diagnostico-leads";
import { fatosDoTrecho, funilDoProcesso, textoDaTaxa, trechoDoRoboPorLinha, type EntradaDoProcesso } from "../funil-processo";
import { filterLeads } from "../metrics";
import { chaveDoConjuntoDoLead, chaveDoCriativoDoLead, conjuntosPorId, criativosComSinal } from "../midia";
import type { EntradaDosSinais, LinhaCriativo, LinhaMidia, QualidadeDaLinha } from "../midia-tela";
import type { ContagemDoTrecho, TrechoPorLinha } from "../sinal-do-criativo";
import type { SituacaoRobo } from "../robo/situacao";
import type { Lead } from "../types";
import {
  ADS_DA_ANTERIOR,
  ADS_DA_SEMANA,
  ATRASADO,
  LEADS_DA_ANTERIOR,
  LEADS_DO_ROBO,
  NUNCA_LIDO,
  PARADO,
  ROBO,
  SEED_HOJE,
  brt,
  entradaDoRobo,
  reaberto,
} from "@/test/fixtures-robo";
import {
  HOJE,
  IDS,
  NOMES,
  comCandidatoPeloRobo,
  comLeituraParada,
  comLive,
  comNaoResponde,
  comReunioes,
  comRoboDesligado,
  comSemTelefone,
  entradaDoProcessoDa,
  pessoa,
  piorCasoDeTexto,
  producaoSemana,
  somarDias,
  type SemanaDaMidia,
} from "@/test/fixtures-midia";
import { entradaDosSinaisDa, midiaDa, semanaDoSeed } from "@/test/entrada-midia";

// ---------------------------------------------------------------- as entradas

interface Caso {
  e: EntradaDoProcesso;
  /** A entrada de `criativosComSinal` da MESMA tela. */
  sinais: EntradaDosSinais;
  /** A chave de criativo da MESMA tela (com a live separada quando há régua da live). */
  chaveCri: (l: Lead) => string | null;
  chaveConj: (l: Lead) => string | null;
}

const daSemana = (p: SemanaDaMidia, chave = "7d"): Caso => {
  const e = entradaDoProcessoDa(p, chave);
  return {
    e,
    sinais: entradaDosSinaisDa(p, chave),
    chaveCri: chaveDoCriativoDoLead(p.data, e.range, p.cfgLive),
    chaveConj: chaveDoConjuntoDoLead(p.data, e.range),
  };
};

const doRobo = (...args: Parameters<typeof entradaDoRobo>): Caso => {
  const e = entradaDoRobo(...args);
  return {
    e,
    // O robô de fixture não tem régua da live: sem `cfgLive` (a live não é separada).
    sinais: { data: e.data, range: e.range, kpis: e.kpis, eventos: e.eventos, robo: e.robo, cobertura: e.cobertura ?? [], ultimoSyncAds: null, hoje: e.hoje, agora: e.agora },
    chaveCri: chaveDoCriativoDoLead(e.data, e.range),
    chaveConj: chaveDoConjuntoDoLead(e.data, e.range),
  };
};

const ANTES_DO_ROBO = () =>
  doRobo(ROBO, { from: "2026-10-20", to: "2026-10-28" }, { leads: [...LEADS_DO_ROBO, ...LEADS_DA_ANTERIOR], adDaily: [...ADS_DA_ANTERIOR, ...ADS_DA_SEMANA] });

const CASOS: [string, () => Caso][] = [
  // O seed das duas marcas, 3 períodos (o robô desligado: só a partição).
  ...(["consorcio", "krone"] as const).flatMap((marca) =>
    (["7d", "30d", "all"] as const).map((chave): [string, () => Caso] => [`seed ${marca} · ${chave}`, () => daSemana(semanaDoSeed(marca, SEED_HOJE), chave)]),
  ),
  // O robô de fixture (fixtures-robo), em dia, parado, atrasado, nunca lido e desligado.
  ["robô · semana", () => doRobo()],
  ["robô · campanha", () => doRobo(ROBO, null)],
  ["robô parado", () => doRobo(PARADO)],
  ["robô atrasado", () => doRobo(ATRASADO)],
  ["robô nunca lido", () => doRobo(NUNCA_LIDO)],
  ["robô desligado", () => doRobo(null)],
  ["todo antes de 29/10", ANTES_DO_ROBO],
  // A forma da produção (fixtures-midia).
  ["produção · 7d", () => daSemana(producaoSemana())],
  ["produção · 30d", () => daSemana(producaoSemana(), "30d")],
  ["produção · campanha", () => daSemana(producaoSemana(), "all")],
  ["produção · leitura parada", () => daSemana(comLeituraParada())],
  ["produção · robô desligado", () => daSemana(comRoboDesligado())],
  ["produção · candidato pelo robô", () => daSemana(comCandidatoPeloRobo())],
  ["produção · 9 maduros sem resposta", () => daSemana(comNaoResponde(9))],
  ["produção · sem telefone", () => daSemana(comSemTelefone())],
  ["produção · 3 reuniões", () => daSemana(comReunioes(3))],
  ["live no ar · 7d", () => daSemana(comLive())],
  ["pior caso de texto", () => daSemana(piorCasoDeTexto())],
];

const ZERO = { comRobo: 0, primeiraMsg: 0, responderam: 0, aceitaram: 0 };
const linhasDe = (t: TrechoPorLinha): ContagemDoTrecho[] => [...t.porLinha.values(), t.semLinha];
const soma = (xs: ContagemDoTrecho[], f: (c: ContagemDoTrecho) => number) => xs.reduce((s, c) => s + f(c), 0);
const coorteDe = (e: EntradaDoProcesso) => filterLeads(e.data.leads, e.range).filter((l) => !l.deletedAt);
const somaFora = (c: ContagemDoTrecho) => Object.values(c.fora).reduce((s, v) => s + v, 0);

// ---------------------------------------------------------------- 1. a conferência com o Funil (K14)

describe("Σ linhas + sem linha + teste/cópia = os degraus do robô do Funil (K14)", () => {
  for (const [nome, caso] of CASOS) {
    it(nome, () => {
      const { e, chaveCri, chaveConj } = caso();
      const f = funilDoProcesso(e);
      const n = (id: string) => f.degraus.find((d) => d.id === id)?.n ?? 0;
      for (const [qual, chaveDe] of [
        ["criativo", chaveCri],
        ["conjunto", chaveConj],
      ] as const) {
        const t = trechoDoRoboPorLinha(e, chaveDe);
        expect(t.comRobo, qual).toBe(f.comRobo);
        expect(t.parada, qual).toBe(f.parada);
        if (!t.comRobo) {
          expect(t.degraus, qual).toEqual(ZERO);
          continue;
        }
        const X = linhasDe(t);
        expect(soma(X, (c) => c.noRobo + c.testesECopias), `${qual} · com-robo`).toBe(n("com-robo"));
        expect(soma(X, (c) => c.falou + c.testesECopiasPorFato.falou), `${qual} · 1ª mensagem`).toBe(n("primeira-msg"));
        expect(soma(X, (c) => c.respondeu + c.testesECopiasPorFato.respondeu), `${qual} · responderam`).toBe(n("responderam"));
        expect(soma(X, (c) => c.aceitou + c.testesECopiasPorFato.aceitou), `${qual} · aceitaram`).toBe(n("aceitaram"));
        expect(t.degraus, qual).toEqual({ comRobo: n("com-robo"), primeiraMsg: n("primeira-msg"), responderam: n("responderam"), aceitaram: n("aceitaram") });
        // O "fora" por linha soma o fora do Funil.
        for (const k of Object.keys(f.fora) as (keyof typeof f.fora)[]) expect(soma(X, (c) => c.fora[k]), `${qual} · fora.${k}`).toBe(f.fora[k]);
        // A leitura parada do trecho = a do Funil.
        expect(t.leituraParada, qual).toEqual(f.leituraParada);
      }
    });
  }

  it("as entradas exercitam os dois caminhos (com e sem o robô) e linhas de verdade", () => {
    const comRobo = CASOS.filter(([, c]) => funilDoProcesso(c().e).comRobo).map(([n]) => n);
    expect(comRobo).toContain("produção · 7d");
    expect(comRobo).toContain("robô parado");
    expect(comRobo).not.toContain("robô desligado");
    const p = daSemana(producaoSemana());
    // Os três criativos da semana com lead (o Carrossel da Aurora e os dois posts).
    expect(trechoDoRoboPorLinha(p.e, p.chaveCri).porLinha.size).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------- 2. a partição (sempre, K14)

/** As linhas de nível conjunto de um bloco de `conjuntosPorId`. */
const conjuntosDe = (linhas: LinhaMidia[]) => linhas.flatMap((c) => c.conjuntos ?? []);

describe("a partição: os `leads` de cada linha = o 'Leads (painel)' dela — com e sem o robô", () => {
  for (const [nome, caso] of CASOS) {
    it(nome, () => {
      const { e, sinais, chaveConj } = caso();
      const coorte = coorteDe(e).length;
      // Criativos: a MESMA montagem da tela (`criativosComSinal`).
      const { bloco, trecho } = criativosComSinal(sinais);
      const criativos: LinhaCriativo[] = [...bloco.conversao, ...bloco.descoberta];
      for (const l of criativos) expect(trecho.porLinha.get(l.chave)?.leads ?? 0, `criativo ${l.nome}`).toBe(l.leadsPainel);
      expect(criativos.reduce((s, l) => s + l.leadsPainel, 0) + trecho.semLinha.leads, "Σ criativos + sem linha = a coorte").toBe(coorte);
      expect(soma(linhasDe(trecho), (c) => c.leads)).toBe(coorte);
      // Conjuntos: a passada de leads de `conjuntosPorId`.
      const tc = trechoDoRoboPorLinha(e, chaveConj);
      const conj = conjuntosPorId(e.data, e.range, { trecho: tc });
      const linhas = conjuntosDe([...conj.conversao, ...conj.descoberta]);
      for (const l of linhas) expect(tc.porLinha.get(l.chave)?.leads ?? 0, `conjunto ${l.nome}`).toBe(l.leadsPainel);
      expect(linhas.reduce((s, l) => s + l.leadsPainel, 0) + tc.semLinha.leads, "Σ conjuntos + sem linha = a coorte").toBe(coorte);
      // Com o robô: cada linha = fora + teste/cópia + no robô; sem ele, os campos do robô ficam em 0.
      for (const t of [trecho, tc]) {
        for (const c of linhasDe(t)) {
          if (t.comRobo) expect(c.leads).toBe(somaFora(c) + c.testesECopias + c.noRobo);
          else {
            expect(somaFora(c) + c.testesECopias + c.noRobo + c.falou + c.respondeu + c.aceitou + c.semWhatsapp + c.noPrazo).toBe(0);
            expect(c.testesECopiasPorFato).toEqual({ falou: 0, respondeu: 0, aceitou: 0 });
          }
          expect(c.semTelefoneUtil).toBeLessThanOrEqual(c.leads);
        }
      }
    });
  }

  it("`semTelefoneUtil` é contado também com o robô desligado (a trava do candidato vale sem ele, K4)", () => {
    const p = comSemTelefone();
    const { e, chaveCri } = daSemana(p);
    const sem = trechoDoRoboPorLinha({ ...e, robo: undefined }, chaveCri);
    expect(sem.comRobo).toBe(false);
    expect(sem.motivoSemRobo).toBe("desligado");
    const aurora = sem.porLinha.get(IDS.criativo.carrosselAurora)!;
    expect(aurora).toMatchObject({ leads: 11, semTelefoneUtil: 11, noRobo: 0 });
    // Com o robô ligado: os mesmos 11, todos fora do robô por falta de telefone.
    const com = trechoDoRoboPorLinha(e, chaveCri).porLinha.get(IDS.criativo.carrosselAurora)!;
    expect(com).toMatchObject({ leads: 11, semTelefoneUtil: 11, noRobo: 0 });
    expect(com.fora.semTelefone).toBe(11);
  });
});

// ---------------------------------------------------------------- 3. aninhamento

describe("aninhamento: noRobo ≥ falou ≥ respondeu ≥ aceitou; sem WhatsApp ≤ noRobo; nas 24 h ≤ falou − respondeu", () => {
  for (const [nome, caso] of CASOS) {
    it(nome, () => {
      const { e, chaveCri, chaveConj } = caso();
      for (const chaveDe of [chaveCri, chaveConj]) {
        for (const c of linhasDe(trechoDoRoboPorLinha(e, chaveDe))) {
          expect(c.noRobo).toBeGreaterThanOrEqual(c.falou);
          expect(c.falou).toBeGreaterThanOrEqual(c.respondeu);
          expect(c.respondeu).toBeGreaterThanOrEqual(c.aceitou);
          expect(c.semWhatsapp).toBeLessThanOrEqual(c.noRobo);
          expect(c.noPrazo).toBeLessThanOrEqual(c.falou - c.respondeu);
          expect(c.testesECopiasPorFato.falou).toBeGreaterThanOrEqual(c.testesECopiasPorFato.respondeu);
          expect(c.testesECopiasPorFato.respondeu).toBeGreaterThanOrEqual(c.testesECopiasPorFato.aceitou);
          expect(c.testesECopias).toBeGreaterThanOrEqual(c.testesECopiasPorFato.falou);
        }
      }
    });
  }
});

// ---------------------------------------------------------------- 4. estados

describe("os estados do trecho", () => {
  it("robô desligado → sem `comRobo`, motivo 'desligado', `porLinha` com os leads e os campos do robô em 0", () => {
    const { e, chaveCri } = daSemana(comRoboDesligado());
    const t = trechoDoRoboPorLinha(e, chaveCri);
    expect(t).toMatchObject({ comRobo: false, motivoSemRobo: "desligado", parada: false, leituraParada: null, degraus: ZERO });
    const aurora = t.porLinha.get(IDS.criativo.carrosselAurora)!;
    expect(aurora.leads).toBe(11);
    expect([aurora.noRobo, aurora.falou, aurora.respondeu, aurora.aceitou, aurora.semWhatsapp, aurora.noPrazo, aurora.testesECopias]).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it("período todo antes de 29/10 → 'antes-do-robo'", () => {
    const { e, chaveCri } = ANTES_DO_ROBO();
    const t = trechoDoRoboPorLinha(e, chaveCri);
    expect(t.comRobo).toBe(false);
    expect(t.motivoSemRobo).toBe("antes-do-robo");
  });

  it("leitura parada → as células do robô com '≥ N', sem %; a linha da leitura parada do Funil", () => {
    const m = midiaDa(comLeituraParada());
    expect(m.colunasDoRobo).toBe(true);
    expect(m.roboNosCriativos).toBe("leitura-parada");
    const qualidades: QualidadeDaLinha[] = [
      ...m.detalhes.criativos.conversao.map((l) => l.qualidade),
      ...conjuntosDe(m.detalhes.conjuntos.conversao).map((l) => l.qualidade),
    ].filter((q): q is QualidadeDaLinha => q != null);
    expect(qualidades.length).toBeGreaterThan(0);
    let comMinimo = 0;
    for (const q of qualidades) {
      for (const t of [q.responderam, q.aceitaram, q.semWhatsapp]) {
        expect(t, t).toMatch(/^(≥ \d+|—)$/);
        expect(t).not.toContain("%");
        if (t.startsWith("≥")) comMinimo += 1;
      }
    }
    expect(comMinimo).toBeGreaterThan(0);
    for (const c of m.criativos!.cards) if (c.robo) for (const t of Object.values(c.robo)) expect(t).not.toContain("%");
    expect(m.criativos!.leituraParada).toBe("Robô sem leitura desde 12/11 12:30 ⚠");
  });

  it("uma linha só de inscritos da live → '—', e o `title` da célula diz 'inscritos da live'", () => {
    const m = midiaDa(comLive());
    const persona = conjuntosDe([...m.detalhes.conjuntos.conversao, ...(m.pausados?.conjuntos ?? [])]).find((l) => l.adsetId === IDS.conjunto.persona);
    expect(persona, "o conjunto Persona (só inscritos da live)").toBeDefined();
    expect(persona!.qualidade).not.toBeNull();
    expect(persona!.qualidade!.responderam).toBe("—");
    expect(persona!.qualidade!.valores.responderam).toBeNull();
    expect(persona!.qualidade!.dica).toContain("inscritos da live");
  });
});

// ---------------------------------------------------------------- 5. episódio e cópia

describe("o episódio e a cópia de duplicado", () => {
  const aurora = (p: SemanaDaMidia) => {
    const { e, chaveCri } = daSemana(p);
    return trechoDoRoboPorLinha(e, chaveCri).porLinha.get(IDS.criativo.carrosselAurora)!;
  };
  const PAGO_AURORA: Partial<Lead> = { utmSource: "meta", utmMedium: "paid_social", adId: IDS.anuncio.carrosselAurora, utmContent: IDS.anuncio.carrosselAurora };

  it("a resposta de antes do `reaberto` não conta (a pessoa voltou pela página; o robô falou de novo, ela não respondeu)", () => {
    const antes = aurora(producaoSemana());
    const p = producaoSemana();
    const criado = brt(somarDias(HOJE, -5), "10:00");
    const reab = brt(somarDias(HOJE, -3), "10:00");
    const l = pessoa(80, criado, {
      ...PAGO_AURORA,
      roboVistoEm: brt(somarDias(HOJE, -5), "10:03"),
      roboRecebidoEm: brt(somarDias(HOJE, -5), "10:01"),
      roboSaudacaoEm: brt(somarDias(HOJE, -5), "10:02"),
      roboRespondeuEm: brt(somarDias(HOJE, -5), "10:20"),
      roboUltimaMsgClienteEm: brt(somarDias(HOJE, -5), "10:40"),
      // Depois do reaberto, o robô cobrou de novo (fala do episódio novo), sem resposta.
      roboUltimaInteracaoEm: brt(somarDias(HOJE, -3), "10:30"),
      roboEtapa: "nao_respondeu",
    });
    p.data.leads.push(l);
    p.eventos.push(reaberto(l.id, reab, ATOR_LP));
    const depois = aurora(p);
    expect(depois.leads).toBe(antes.leads + 1);
    expect(depois.noRobo).toBe(antes.noRobo + 1);
    expect(depois.falou).toBe(antes.falou + 1);
    expect(depois.respondeu).toBe(antes.respondeu);
    // E a conta continua batendo com o Funil.
    const { e, chaveCri } = daSemana(p);
    const t = trechoDoRoboPorLinha(e, chaveCri);
    expect(t.degraus.responderam).toBe(funilDoProcesso(e).degraus.find((d) => d.id === "responderam")!.n);
  });

  it("a cópia de duplicado com o mesmo estado do robô entra em `testesECopias` (e por fato), não em `noRobo`", () => {
    const antes = aurora(producaoSemana());
    const p = producaoSemana();
    const conversou = (dia: string): Partial<Lead> => ({
      roboVistoEm: brt(dia, "10:03"),
      roboRecebidoEm: brt(dia, "10:01"),
      roboSaudacaoEm: brt(dia, "10:02"),
      roboRespondeuEm: brt(dia, "10:20"),
      roboUltimaMsgClienteEm: brt(dia, "10:40"),
      roboUltimaInteracaoEm: brt(dia, "10:41"),
      roboEtapa: "em_conversa",
    });
    const d1 = somarDias(HOJE, -5);
    const d2 = somarDias(HOJE, -4);
    const principal = pessoa(81, brt(d1, "10:00"), { ...PAGO_AURORA, ...conversou(d1) });
    const copia = pessoa(82, brt(d2, "10:00"), { ...PAGO_AURORA, ...conversou(d2), phone: principal.phone });
    p.data.leads.push(principal, copia);
    const depois = aurora(p);
    expect(depois.leads).toBe(antes.leads + 2);
    expect(depois.noRobo).toBe(antes.noRobo + 1);
    expect(depois.testesECopias).toBe(antes.testesECopias + 1);
    expect(depois.testesECopiasPorFato).toEqual({
      falou: antes.testesECopiasPorFato.falou + 1,
      respondeu: antes.testesECopiasPorFato.respondeu + 1,
      aceitou: antes.testesECopiasPorFato.aceitou,
    });
    expect(depois.falou).toBe(antes.falou + 1);
    expect(depois.respondeu).toBe(antes.respondeu + 1);
  });
});

// ---------------------------------------------------------------- 6. textos e valores

/** O texto de uma célula do robô: "n de base · %" (base ≥ 3), "n de base" (1–2), "—" (0). */
const textoDaCelula = (n: number, base: number) => (base === 0 ? "—" : base >= 3 ? `${n} de ${base} · ${textoDaTaxa(n / base)}` : `${n} de ${base}`);

function conferirQualidade(q: QualidadeDaLinha, c: ContagemDoTrecho | undefined, onde: string) {
  const x = c ?? { falou: 0, respondeu: 0, aceitou: 0, semWhatsapp: 0, noRobo: 0 };
  expect(q.responderam, `${onde} · responderam`).toBe(textoDaCelula(x.respondeu, x.falou));
  expect(q.aceitaram, `${onde} · aceitaram`).toBe(textoDaCelula(x.aceitou, x.respondeu));
  expect(q.semWhatsapp, `${onde} · sem WhatsApp`).toBe(textoDaCelula(x.semWhatsapp, x.noRobo));
  expect(q.valores, `${onde} · valores`).toEqual({
    responderam: x.falou > 0 ? x.respondeu / x.falou : null,
    aceitaram: x.respondeu > 0 ? x.aceitou / x.respondeu : null,
    semWhatsapp: x.noRobo > 0 ? x.semWhatsapp / x.noRobo : null,
  });
}

describe("os textos e os valores de `QualidadeDaLinha` (o % é o `textoDaTaxa` do Funil, com a régua AMOSTRA_MINIMA)", () => {
  it("a produção: Aurora '3 de 10 · 30%', o post de 8 palavras '1 de 3 · 33%', o de 4 palavras '1 de 1'", () => {
    const p = producaoSemana();
    const m = midiaDa(p);
    const q = (chave: string) => m.detalhes.criativos.conversao.find((l) => l.chave === chave)!.qualidade!;
    expect(q(IDS.criativo.carrosselAurora)).toMatchObject({ responderam: "3 de 10 · 30%", aceitaram: "1 de 3 · 33%", semWhatsapp: "1 de 11 · 9%" });
    expect(q(IDS.criativo.post8).responderam).toBe("1 de 3 · 33%");
    expect(q(IDS.criativo.post8).aceitaram).toBe("0 de 1");
    expect(q(IDS.criativo.post4).responderam).toBe("1 de 1");
    expect(q(IDS.criativo.carrosselAurora).valores).toEqual({ responderam: 0.3, aceitaram: 1 / 3, semWhatsapp: 1 / 11 });
  });

  it("base 2 → '1 de 2'; base 0 → '—' com valor null", () => {
    const p = producaoSemana();
    // Mais um lead no post de 4 palavras (pelo nome único), saudado e sem resposta.
    const dia = somarDias(HOJE, -3);
    p.data.leads.push(
      pessoa(83, brt(dia, "11:00"), {
        utmSource: "meta",
        utmMedium: "paid_social",
        utmContent: NOMES.criativo.post4,
        roboVistoEm: brt(dia, "11:03"),
        roboRecebidoEm: brt(dia, "11:01"),
        roboSaudacaoEm: brt(dia, "11:02"),
        roboEtapa: "nao_respondeu",
      }),
    );
    const post4 = midiaDa(p).detalhes.criativos.conversao.find((l) => l.chave === IDS.criativo.post4)!;
    expect(post4.qualidade!.responderam).toBe("1 de 2");
    // O Carrossel do Mirante não tem lead: "—", e o valor é null (vai para o fim na ordenação).
    const mirante = midiaDa(producaoSemana()).detalhes.criativos.conversao.find((l) => l.chave === IDS.criativo.carrosselMirante)!;
    expect(mirante.qualidade).toMatchObject({ responderam: "—", aceitaram: "—", semWhatsapp: "—", valores: { responderam: null, aceitaram: null, semWhatsapp: null } });
  });

  for (const [nome, semana] of [
    ["produção", producaoSemana],
    ["candidato pelo robô", comCandidatoPeloRobo],
    ["9 maduros sem resposta", () => comNaoResponde(9)],
    ["3 reuniões", () => comReunioes(3)],
    ["live", comLive],
  ] as const) {
    it(`cada célula de ${nome} sai das contagens da linha (criativos e conjuntos)`, () => {
      const p = semana();
      const m = midiaDa(p);
      const sinais = criativosComSinal(entradaDosSinaisDa(p));
      const cri = [...m.detalhes.criativos.conversao, ...(m.pausados?.criativos ?? [])];
      expect(cri.length).toBeGreaterThan(0);
      for (const l of cri) {
        expect(l.qualidade, l.nome).not.toBeNull();
        conferirQualidade(l.qualidade!, sinais.trecho.porLinha.get(l.chave), `criativo ${l.nome}`);
      }
      const { e } = daSemana(p);
      const tc = trechoDoRoboPorLinha(e, chaveDoConjuntoDoLead(p.data, e.range));
      for (const l of conjuntosDe([...m.detalhes.conjuntos.conversao, ...(m.pausados?.conjuntos ?? [])])) {
        expect(l.qualidade, l.nome).not.toBeNull();
        conferirQualidade(l.qualidade!, tc.porLinha.get(l.chave), `conjunto ${l.nome}`);
      }
    });
  }

  it("sem o trecho do robô, nenhuma linha tem qualidade", () => {
    const m = midiaDa(comRoboDesligado());
    for (const l of [...m.detalhes.criativos.conversao, ...conjuntosDe(m.detalhes.conjuntos.conversao)]) expect(l.qualidade).toBeNull();
  });
});

// ---------------------------------------------------------------- 7. sem WhatsApp pela etapa do episódio (K15)

describe("sem WhatsApp = a etapa do robô NESTE episódio (K15), a mesma regra da junta do Funil", () => {
  it("um lead com `roboSemWhatsappEm` gravado e a etapa trocada para opt-out NÃO conta", () => {
    const antes = daSemana(producaoSemana());
    const tAntes = trechoDoRoboPorLinha(antes.e, antes.chaveCri);
    expect(tAntes.porLinha.get(IDS.criativo.carrosselAurora)!.semWhatsapp).toBe(1);
    const p = producaoSemana();
    const l = p.data.leads.find((x) => x.roboEtapa === "sem_whatsapp" && x.adId === IDS.anuncio.carrosselAurora)!;
    expect(l.roboSemWhatsappEm).toBeDefined();
    l.roboEtapa = "opt_out";
    const depois = daSemana(p);
    const tDepois = trechoDoRoboPorLinha(depois.e, depois.chaveCri);
    expect(tDepois.porLinha.get(IDS.criativo.carrosselAurora)!.semWhatsapp).toBe(0);
    expect(soma(linhasDe(tDepois), (c) => c.semWhatsapp)).toBe(soma(linhasDe(tAntes), (c) => c.semWhatsapp) - 1);
  });

  it("fatosDoTrecho: falou ⊇ respondeu ⊇ aceitou; sem WhatsApp pela etapa", () => {
    const s = (o: Partial<SituacaoRobo>) => o as SituacaoRobo;
    expect(fatosDoTrecho(s({ falouEm: "2026-11-10T12:00:00Z", respondeu: true, aceitouEm: "2026-11-10T13:00:00Z", etapa: "transferido" }))).toEqual({
      falou: true,
      respondeu: true,
      aceitou: true,
      semWhatsapp: false,
    });
    // Sem a fala do robô, a resposta e o aceite não contam (o mesmo predicado dos degraus).
    expect(fatosDoTrecho(s({ falouEm: undefined, respondeu: true, aceitouEm: "2026-11-10T13:00:00Z", etapa: "sem_whatsapp" }))).toEqual({
      falou: false,
      respondeu: false,
      aceitou: false,
      semWhatsapp: true,
    });
    expect(fatosDoTrecho(s({ falouEm: "2026-11-10T12:00:00Z", respondeu: false, aceitouEm: "2026-11-10T13:00:00Z", etapa: "nao_respondeu" }))).toEqual({
      falou: true,
      respondeu: false,
      aceitou: false,
      semWhatsapp: false,
    });
  });
});

// ---------------------------------------------------------------- 8. as colunas do robô e a situação (K23)

describe("`colunasDoRobo` e `roboNosCriativos` (K23)", () => {
  it("robô ligado, mas só gente SEM criativo no trecho → sem colunas e 'ninguem-no-robo' (o `degraus.comRobo` > 0 não liga as colunas)", () => {
    const p = producaoSemana();
    const { e, chaveCri } = daSemana(p);
    for (const l of p.data.leads) if (chaveCri(l) != null) l.phone = undefined;
    const t = trechoDoRoboPorLinha(e, chaveCri);
    expect(t.comRobo).toBe(true);
    expect(t.degraus.comRobo).toBeGreaterThan(0);
    const m = midiaDa(p);
    expect(m.colunasDoRobo).toBe(false);
    expect(m.roboNosCriativos).toBe("ninguem-no-robo");
    for (const c of m.criativos?.cards ?? []) expect(c.robo).toBeNull();
  });

  it("a situação existe mesmo sem `criativos` (só descoberta, período antes do robô)", () => {
    const so = producaoSemana();
    so.data.adDaily = so.data.adDaily.filter((r) => r.objective !== "OUTCOME_LEADS");
    const m = midiaDa(so);
    expect(m.criativos).toBeNull();
    expect(m.roboNosCriativos).toBe("ninguem-no-robo");
    expect(m.colunasDoRobo).toBe(false);
    expect(midiaDa(producaoSemana(), "2026-10-20..2026-10-28").roboNosCriativos).toBe("antes-do-robo");
  });

  it("os outros estados: ok, leitura parada, robô desligado", () => {
    expect(midiaDa(producaoSemana())).toMatchObject({ colunasDoRobo: true, roboNosCriativos: "ok" });
    expect(midiaDa(comLeituraParada())).toMatchObject({ colunasDoRobo: true, roboNosCriativos: "leitura-parada" });
    expect(midiaDa(comRoboDesligado())).toMatchObject({ colunasDoRobo: false, roboNosCriativos: "robo-desligado" });
  });
});

// ---------------------------------------------------------------- 9. o refator não mudou número

describe("refator sem número novo: `fatosDoTrecho` é a única fonte dos fatos do trecho", () => {
  it("funil-processo.ts não tem mais a cadeia de `continue` dos degraus, e usa `fatosDoTrecho`", () => {
    const fonte = fs.readFileSync(path.join(process.cwd(), "src/lib/funil-processo.ts"), "utf8");
    expect(fonte).not.toContain("if (!x.s.falouEm) continue");
    expect(fonte).toMatch(/export function fatosDoTrecho\(/);
    expect(fonte.split("fatosDoTrecho(").length - 1).toBeGreaterThanOrEqual(3);
    // Os tipos do trecho vêm de sinal-do-criativo.ts (só tipo: sem ciclo de valor).
    expect(fonte).toMatch(/import type \{[^}]*\bContagemDoTrecho\b[^}]*\} from "\.\/sinal-do-criativo"/);
  });
});
