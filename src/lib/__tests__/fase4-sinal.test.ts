/**
 * Fase 4 (§5.3 da spec) — o SINAL do criativo (`lib/sinal-do-criativo.ts`, puro):
 * Escalar · Pausar · Trocar arte · Cedo · Candidato a escalar · Manter, o primeiro que
 * casar (§3.2), com UMA régua (`REGUA_DO_SINAL`) e UMA amostra de pessoas
 * (`AMOSTRA_DE_PESSOAS`). As correções da crítica (§10): Pausar por custo pela chance
 * de Poisson (K1), Cedo só com menos de 10 leads (K2), os leads de nome ambíguo a
 * favor (K3), as travas do candidato (K4), o piso do gasto (K13), sem média não se diz
 * "barato" (K21), o anel do candidato (K42) e frase nenhuma acima de 25 palavras (K36).
 *
 * As entradas são escritas à mão: a média é fixa (R$ 40 por lead) e o gasto sai de λ
 * ("leads que esse gasto rendia na média"): gasto = λ × 40.
 */
import { describe, expect, it } from "vitest";
import { AMOSTRA_MIN } from "../motor";
import { REGRA_FADIGA, type Fatigue } from "../metrics";
import { MIN_REUNIOES } from "../trust";
import {
  AMOSTRA_DE_PESSOAS,
  ORDEM_DO_SINAL,
  REGUA_DO_SINAL,
  ROTULO_DO_SINAL,
  TOM_DO_SINAL,
  chanceDeAte,
  leituraDaQualidade,
  mediaDosCriativos,
  porqueSemMedia,
  sinalDoCriativo,
  textoDaReguaDoSinal,
  type ContagemDoTrecho,
  type ContextoDoSinal,
  type EntradaDoSinal,
  type LeituraDaQualidade,
  type MediaDosCriativos,
  type Sinal,
  type SinalDoCriativo,
  type TrechoPorLinha,
} from "../sinal-do-criativo";

// ---------------------------------------------------------------- régua de texto

/** A régua de `palavras()` (src/test/tela.ts): pedaço separado por espaço com letra ou algarismo. */
const nPalavras = (t: string) => t.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p)).length;
/** Frase = trecho até ". ", "! " ou "? " (K36). */
const frases = (t: string) => t.split(/(?<=[.!?])\s+/).filter((f) => f.trim() !== "");
/** O `formatCurrency` escreve "R$" com espaço inquebrável. */
const sp = (t: string) => t.replace(/ /g, " ");

// ---------------------------------------------------------------- entradas

const PORLEAD = 40;
const MEDIA: MediaDosCriativos = { porLead: PORLEAD, gasto: 4000, leads: 100, criativos: 5 };
/** gasto que rende λ leads na média. */
const gastoDe = (lambda: number) => lambda * PORLEAD;
/** gasto com `leads` leads a `razao` × a média. */
const gastoPorRazao = (leads: number, razao: number) => leads * razao * PORLEAD;

const SAUDAVEL: Fatigue = { level: "saudavel", frequency: 1.3, reason: "CTR estável" };
const ATENCAO: Fatigue = { level: "atencao", frequency: 2.4, reason: "frequência 2,4 com CTR estável" };
const janela = (ctr: number, frequency: number, impressions: number) => ({
  from: "2026-11-06",
  to: "2026-11-12",
  impressions,
  spend: 100,
  leads: 4,
  ctr,
  cpl: 25,
  frequency,
});
const FADIGADO: Fatigue = {
  level: "fadigado",
  frequency: 2.3,
  reason: "CTR 0,8% vs 1,2% nos 7 d anteriores (≤ 75%) e frequência 2,3",
  janelas: { recente: janela(0.008, 2.3, 7000), anterior: { ...janela(0.012, 1.4, 6800), from: "2026-10-30", to: "2026-11-05" } },
};

const INDISPONIVEL: LeituraDaQualidade = { estado: "indisponivel", porque: "desligado" };
const PARADA: LeituraDaQualidade = { estado: "indisponivel", porque: "leitura-parada" };

const entrada = (o: Partial<EntradaDoSinal> = {}): EntradaDoSinal => ({
  gasto: 0,
  leads: 0,
  ambiguos: 0,
  agendadas: 0,
  contatoInvalido: 0,
  semTelefone: 0,
  fadiga: SAUDAVEL,
  qualidade: INDISPONIVEL,
  ...o,
});

const ctx = (o: Partial<ContextoDoSinal> = {}): ContextoDoSinal => ({
  media: MEDIA,
  porqueSemMedia: null,
  custoPorReuniaoDaConta: null,
  gastoIncompleto: false,
  ...o,
});

const sinal = (e: Partial<EntradaDoSinal> = {}, c: Partial<ContextoDoSinal> = {}): SinalDoCriativo => sinalDoCriativo(entrada(e), ctx(c));

/** As contagens do robô de uma linha (o `robo` da entrada). */
const robo = (o: Partial<NonNullable<EntradaDoSinal["robo"]>> = {}): NonNullable<EntradaDoSinal["robo"]> => ({
  noRobo: 0,
  falou: 0,
  respondeu: 0,
  aceitou: 0,
  semWhatsapp: 0,
  noPrazo: 0,
  ...o,
});

/** Uma `ContagemDoTrecho` inteira (a de `leituraDaQualidade`). */
const contagem = (o: Partial<ContagemDoTrecho> = {}): ContagemDoTrecho => ({
  leads: 0,
  semTelefoneUtil: 0,
  fora: { antes: 0, semTelefone: 0, live: 0, recentes: 0, depoisDaLeitura: 0, reabertosNoPainel: 0 },
  testesECopias: 0,
  testesECopiasPorFato: { falou: 0, respondeu: 0, aceitou: 0 },
  noRobo: 0,
  falou: 0,
  respondeu: 0,
  aceitou: 0,
  semWhatsapp: 0,
  noPrazo: 0,
  ...o,
});

const LIGADO: Pick<TrechoPorLinha, "comRobo" | "motivoSemRobo" | "parada"> = { comRobo: true, motivoSemRobo: null, parada: false };
const ler = (c: Partial<ContagemDoTrecho> | undefined, t = LIGADO) => leituraDaQualidade(c ? contagem(c) : undefined, t);

/** Qualidade "sem amostra" com as contagens do robô coerentes. */
const semAmostra = (falou: number, respondeu: number, noPrazo = 0): Pick<EntradaDoSinal, "qualidade" | "robo"> => {
  const maduros = falou - noPrazo;
  return {
    qualidade: { estado: "sem-amostra", maduros, faltam: AMOSTRA_DE_PESSOAS - maduros },
    robo: robo({ noRobo: falou, falou, respondeu, noPrazo }),
  };
};

// ---------------------------------------------------------------- 1. bordas

describe("bordas, em tabela (K1, K2, K4)", () => {
  it("chanceDeAte: P(X ≤ k) de uma Poisson(λ), sem underflow com λ grande", () => {
    expect(chanceDeAte(0, 3)).toBeCloseTo(0.0498, 4);
    expect(chanceDeAte(0, 2.99)).toBeCloseTo(0.0503, 4);
    expect(chanceDeAte(1, 3)).toBeCloseTo(0.199, 3);
    expect(chanceDeAte(2, 4)).toBeCloseTo(0.238, 3);
    const grande = chanceDeAte(650, 700);
    expect(Number.isNaN(grande)).toBe(false);
    expect(grande).toBeGreaterThan(0.02);
    expect(grande).toBeLessThan(0.045);
    expect(chanceDeAte(700, 700)).toBeGreaterThan(0.5);
  });

  it("Pausar por custo (K1), sem reunião e com a média fixa: os limiares de λ por número de leads", () => {
    const pausa = (leads: number, lambda: number) => sinal({ leads, gasto: gastoDe(lambda) });
    // 0 lead: 3 esperados (a chance é a do "3 leads na média").
    expect(pausa(0, 2.99).sinal).not.toBe("pausar");
    expect(pausa(0, 3.0)).toMatchObject({ sinal: "pausar", causa: "sem-resultado" });
    // 1 lead: 4,75 — e o motivo não cita CPL (1 lead é sorte).
    expect(pausa(1, 4.74).sinal).not.toBe("pausar");
    const um = pausa(1, 4.75);
    expect(um).toMatchObject({ sinal: "pausar", causa: "caro" });
    expect(sp(um.motivo)).toBe("R$ 190 e 1 lead; a média renderia 4,8");
    expect(um.motivo).not.toContain("CPL");
    // 2 leads: 6,30.
    expect(pausa(2, 6.29).sinal).not.toBe("pausar");
    const dois = pausa(2, 6.3);
    expect(dois).toMatchObject({ sinal: "pausar", causa: "caro" });
    expect(sp(dois.motivo)).toMatch(/^R\$ \d+ e 2 leads; a média renderia 6,3$/);
    // 3 leads: 7,76 — com 3 leads o motivo cita o CPL e o múltiplo.
    expect(pausa(3, 7.75).sinal).not.toBe("pausar");
    const tres = pausa(3, 7.76);
    expect(tres).toMatchObject({ sinal: "pausar", causa: "caro" });
    expect(sp(tres.motivo)).toMatch(/^CPL R\$ \d+ · 2,6× a média$/);
    // 6 leads: manda o 2× (razão 1,99 não pausa; 2,00 pausa).
    expect(sinal({ leads: 6, gasto: gastoPorRazao(6, 1.99) }).sinal).not.toBe("pausar");
    expect(sinal({ leads: 6, gasto: gastoPorRazao(6, 2) })).toMatchObject({ sinal: "pausar", causa: "caro" });
  });

  it("1 lead com λ = 3 NUNCA é Pausar (era o erro: razão = λ, 20% de falso positivo)", () => {
    const s = sinal({ leads: 1, gasto: gastoDe(3) });
    expect(s.razao).toBeCloseTo(3, 6);
    expect(s.sinal).not.toBe("pausar");
    expect(s.sinal).toBe("manter");
  });

  it("D9: razão 0,70 é candidato, 0,71 não; 10 leads é candidato, 9 não", () => {
    expect(sinal({ leads: 11, gasto: gastoPorRazao(11, 0.7) })).toMatchObject({ sinal: "candidato", causa: "cpl-d9" });
    expect(sinal({ leads: 11, gasto: gastoPorRazao(11, 0.71) }).sinal).toBe("manter");
    expect(sinal({ leads: 10, gasto: gastoPorRazao(10, 0.5) })).toMatchObject({ sinal: "candidato", causa: "cpl-d9" });
    expect(sinal({ leads: 9, gasto: gastoPorRazao(9, 0.5) }).sinal).toBe("manter");
  });

  it("Cedo × Candidato (K2): 9 leads a 0,3× (λ 2,7) é Cedo; 12 leads a 0,2× (λ 2,4) é Candidato", () => {
    const cedo = sinal({ leads: 9, gasto: gastoPorRazao(9, 0.3) });
    expect(cedo.esperados).toBeCloseTo(2.7, 6);
    expect(cedo).toMatchObject({ sinal: "cedo", causa: "amostra" });
    expect(sp(cedo.motivo)).toBe("R$ 108 de R$ 120 para julgar");
    const barato = sinal({ leads: 12, gasto: gastoPorRazao(12, 0.2) });
    expect(barato.esperados).toBeCloseTo(2.4, 6);
    expect(barato).toMatchObject({ sinal: "candidato", causa: "cpl-d9" });
  });

  it("contato inválido 25% passa; 26% trava (com 10+ leads)", () => {
    const base = { leads: 100, gasto: gastoPorRazao(100, 0.5) };
    expect(sinal({ ...base, contatoInvalido: 25 }).sinal).toBe("candidato");
    const travado = sinal({ ...base, contatoInvalido: 26 });
    expect(travado.sinal).toBe("manter");
    expect(travado.motivo).toBe("CPL baixo, mas 26% de contato inválido");
  });

  it("sem telefone + sem WhatsApp 25% passa; 26% trava (K4) — e o sem WhatsApp do robô soma", () => {
    const base = { leads: 100, gasto: gastoPorRazao(100, 0.5) };
    expect(sinal({ ...base, semTelefone: 25 }).sinal).toBe("candidato");
    expect(sinal({ ...base, semTelefone: 26 })).toMatchObject({ sinal: "manter", motivo: "CPL baixo, mas 26% sem telefone ou WhatsApp" });
    // 20 sem telefone + 6 sem WhatsApp (o robô) = 26%.
    const soma = sinal({ ...base, semTelefone: 20, qualidade: INDISPONIVEL, robo: robo({ noRobo: 80, semWhatsapp: 6 }) });
    expect(soma).toMatchObject({ sinal: "manter", motivo: "CPL baixo, mas 26% sem telefone ou WhatsApp" });
  });

  it("a média: 9 leads ou 1 criativo não fazem média; 10 leads e 2 criativos fazem", () => {
    expect(mediaDosCriativos([{ gasto: 100, leads: 4 }, { gasto: 200, leads: 5 }])).toBeNull();
    expect(mediaDosCriativos([{ gasto: 100, leads: 5 }, { gasto: 200, leads: 5 }])).toMatchObject({ porLead: 30, gasto: 300, leads: 10, criativos: 2 });
    expect(mediaDosCriativos([{ gasto: 600, leads: 20 }])).toBeNull();
    // Criativo sem gasto não conta como 2º.
    expect(mediaDosCriativos([{ gasto: 600, leads: 20 }, { gasto: 0, leads: 0 }])).toBeNull();
    expect(mediaDosCriativos([{ gasto: 600, leads: 20 }, { gasto: 10, leads: 0 }])).not.toBeNull();
  });
});

// ---------------------------------------------------------------- 2. precedência

describe("precedência (a primeira regra que casar, K21)", () => {
  const escalar = { agendadas: 3, gasto: 450, leads: 12 };

  it("Escalar vence fadiga ATENÇÃO; com fadiga 'fadigado', 3 reuniões a custo bom → Trocar arte", () => {
    expect(sinal({ ...escalar, fadiga: ATENCAO }, { custoPorReuniaoDaConta: 200 })).toMatchObject({ sinal: "escalar", causa: "reunioes" });
    expect(sinal({ ...escalar, fadiga: FADIGADO }, { custoPorReuniaoDaConta: 200 })).toMatchObject({ sinal: "trocar-arte", causa: "fadiga" });
    // Sem o custo da conta (quarentena), Escalar fica desligado.
    expect(sinal(escalar, { custoPorReuniaoDaConta: null }).sinal).not.toBe("escalar");
  });

  it("Pausar vence Trocar arte (fadigado e caro → Pausar)", () => {
    expect(sinal({ gasto: gastoDe(5), fadiga: FADIGADO })).toMatchObject({ sinal: "pausar", causa: "sem-resultado" });
  });

  it("Trocar arte por fadiga vence Cedo", () => {
    expect(sinal({ gasto: gastoDe(1), leads: 0, fadiga: FADIGADO })).toMatchObject({ sinal: "trocar-arte", causa: "fadiga" });
    expect(sinal({ gasto: 30, fadiga: FADIGADO }, { media: null, porqueSemMedia: "um-criativo" })).toMatchObject({ sinal: "trocar-arte", causa: "fadiga" });
  });

  it("qualidade ruim + reunião → nunca Pausar nem Trocar arte por qualidade (a reunião vence a leitura)", () => {
    const ruim: LeituraDaQualidade = { estado: "ruim", motivo: "nao-responde", maduros: 12 };
    const contagens = robo({ noRobo: 12, falou: 12, respondeu: 1 });
    for (const razao of [1.3, 0.5]) {
      const s = sinal({ leads: 12, gasto: gastoPorRazao(12, razao), agendadas: 1, qualidade: ruim, robo: contagens });
      expect(s.sinal, `razão ${razao}`).not.toBe("pausar");
      expect(s.sinal, `razão ${razao}`).not.toBe("trocar-arte");
      expect(s.causa).not.toBe("qualidade");
    }
  });

  it("sem média: só Escalar, Trocar arte (sem 'barato') ou Cedo — que diz qual base falta", () => {
    const um = sinal({ gasto: 500, leads: 0 }, { media: null, porqueSemMedia: "um-criativo" });
    expect(um).toMatchObject({ sinal: "cedo", causa: "sem-base", motivo: "um criativo só: sem média para comparar" });
    const poucos = sinal({ gasto: 500, leads: 3 }, { media: null, porqueSemMedia: "poucos-leads" });
    expect(poucos).toMatchObject({ sinal: "cedo", causa: "sem-base", motivo: "poucos leads na conta para comparar" });
    // Qualidade ruim sem média: Trocar arte, e nunca "barato" (não há com o que comparar).
    const ruim = sinal(
      { gasto: 500, leads: 12, qualidade: { estado: "ruim", motivo: "nao-responde", maduros: 12 }, robo: robo({ noRobo: 12, falou: 12, respondeu: 2 }) },
      { media: null, porqueSemMedia: "poucos-leads" },
    );
    expect(ruim).toMatchObject({ sinal: "trocar-arte", causa: "qualidade" });
    expect(ruim.motivo).not.toContain("barato");
    expect(ruim.motivo).toMatch(/^\d+ de \d+ responderam ao robô$/);
    const semWhats = sinal(
      { gasto: 500, leads: 12, qualidade: { estado: "ruim", motivo: "sem-whatsapp", maduros: 2 }, robo: robo({ noRobo: 12, falou: 8, semWhatsapp: 4 }) },
      { media: null, porqueSemMedia: "poucos-leads" },
    );
    expect(semWhats).toMatchObject({ sinal: "trocar-arte", causa: "qualidade", motivo: "4 de 12 sem WhatsApp" });
    // Com 3 reuniões a custo da conta, Escalar vale mesmo sem média.
    expect(sinal({ ...escalar }, { media: null, porqueSemMedia: "poucos-leads", custoPorReuniaoDaConta: 200 }).sinal).toBe("escalar");
    // Nenhuma combinação sem média dá Pausar, Candidato ou Manter.
    const possiveis = new Set<Sinal>(["escalar", "trocar-arte", "cedo"]);
    for (const e of [
      { gasto: 2000, leads: 0 },
      { gasto: 2000, leads: 1 },
      { gasto: 100, leads: 30 },
      { gasto: 100, leads: 30, fadiga: ATENCAO },
      { gasto: 900, leads: 3, agendadas: 3 },
    ]) {
      for (const porque of ["um-criativo", "poucos-leads"] as const) {
        const s = sinal(e, { media: null, porqueSemMedia: porque, custoPorReuniaoDaConta: 100 });
        expect(possiveis.has(s.sinal), `${JSON.stringify(e)} → ${s.sinal}`).toBe(true);
        expect(s.esperados).toBeNull();
        expect(s.razao).toBeNull();
      }
    }
  });
});

// ---------------------------------------------------------------- 3. ambíguos (K3)

describe("os leads de nome ambíguo contam a favor (K3)", () => {
  it("0 lead + 1 ambíguo com λ = 4 → Manter ('1 lead de nome ambíguo pode ser dele'); com λ = 5 → Pausar", () => {
    const salva = sinal({ leads: 0, ambiguos: 1, gasto: gastoDe(4) });
    expect(salva.sinal).toBe("manter");
    expect(salva.motivo).toBe("1 lead de nome ambíguo pode ser dele");
    expect(salva.linha).toBeNull();
    expect(salva.dica.startsWith("1 lead de nome ambíguo pode ser dele")).toBe(true);
    // Sem o ambíguo, λ = 4 com 0 lead pausaria.
    expect(sinal({ leads: 0, gasto: gastoDe(4) }).sinal).toBe("pausar");
    // λ = 5: mesmo contando o ambíguo (1 lead), a chance é < 5% e o CPL ≥ 2× → Pausar.
    expect(sinal({ leads: 0, ambiguos: 1, gasto: gastoDe(5) })).toMatchObject({ sinal: "pausar", causa: "sem-resultado" });
    expect(sinal({ leads: 0, ambiguos: 2, gasto: gastoDe(5) }).motivo).toBe("2 leads de nome ambíguo podem ser dele");
  });
});

// ---------------------------------------------------------------- 4. D9 e as travas (K4, K13)

describe("a D9 e as travas do candidato (K4, K13)", () => {
  const d9 = { leads: 11, gasto: gastoPorRazao(11, 0.4) };

  it("sem leitura do robô (ou sem amostra) + CPL 0,4× + 11 leads + saudável → Candidato, com a ressalva LITERAL da D9", () => {
    for (const q of [INDISPONIVEL, PARADA, { estado: "sem-amostra", maduros: 4, faltam: 6 } as LeituraDaQualidade]) {
      const s = sinal({ ...d9, qualidade: q });
      expect(s).toMatchObject({ sinal: "candidato", causa: "cpl-d9" });
      expect(s.ressalva).toBe("sinal de topo de funil, ainda sem reunião");
      expect(s.linha).toBe(s.ressalva);
      expect(s.motivo).toBe("CPL 0,4× a média · 11 leads");
    }
  });

  it("com 1 ou 2 reuniões, a ressalva diz quantas e que decide com 3", () => {
    expect(sinal({ ...d9, agendadas: 1 }).ressalva).toBe("sinal de topo de funil · 1 reunião, decide com 3");
    expect(sinal({ ...d9, agendadas: 2 }).ressalva).toBe("sinal de topo de funil · 2 reuniões, decide com 3");
  });

  it("com atenção ou trava de contato → Manter; fadigado → Trocar arte (a regra 4 vem antes do candidato)", () => {
    expect(sinal({ ...d9, fadiga: ATENCAO }).sinal).toBe("manter");
    expect(sinal({ ...d9, fadiga: FADIGADO })).toMatchObject({ sinal: "trocar-arte", causa: "fadiga" });
    expect(sinal({ ...d9, contatoInvalido: 3 })).toMatchObject({ sinal: "manter", motivo: "CPL baixo, mas 27% de contato inválido" });
  });

  it("0 de 9 maduros responderam → Manter ('CPL baixo, mas 0 de 9 responderam ao robô'); 2 de 3 → Candidato; leitura parada: a trava não vale", () => {
    expect(sinal({ ...d9, ...semAmostra(9, 0) })).toMatchObject({ sinal: "manter", motivo: "CPL baixo, mas 0 de 9 responderam ao robô" });
    expect(sinal({ ...d9, ...semAmostra(3, 2) })).toMatchObject({ sinal: "candidato", causa: "cpl-d9" });
    // Com a leitura parada a qualidade é "indisponível": o "≥" não prova taxa baixa.
    expect(sinal({ ...d9, qualidade: PARADA, robo: robo({ noRobo: 9, falou: 9, respondeu: 0 }) })).toMatchObject({ sinal: "candidato", causa: "cpl-d9" });
    // Abaixo de 3 maduros não há trava (AMOSTRA_MINIMA).
    expect(sinal({ ...d9, ...semAmostra(2, 0) }).sinal).toBe("candidato");
  });

  it("11 leads sem telefone → Manter ('CPL baixo, mas 100% sem telefone ou WhatsApp')", () => {
    expect(sinal({ ...d9, semTelefone: 11 })).toMatchObject({ sinal: "manter", motivo: "CPL baixo, mas 100% sem telefone ou WhatsApp" });
  });

  it("gasto em piso (dias sem dado, K13) → nenhum Candidato ('CPL baixo, mas há dias sem dado de gasto'); Pausar continua", () => {
    expect(sinal(d9, { gastoIncompleto: true })).toMatchObject({ sinal: "manter", motivo: "CPL baixo, mas há dias sem dado de gasto" });
    expect(sinal({ gasto: gastoDe(5) }, { gastoIncompleto: true })).toMatchObject({ sinal: "pausar", causa: "sem-resultado" });
    // Pelo robô também não.
    const boa = { qualidade: { estado: "boa", maduros: 12, taxa: 0.6 } as LeituraDaQualidade, robo: robo({ noRobo: 12, falou: 12, respondeu: 8 }) };
    expect(sinal({ leads: 12, gasto: gastoPorRazao(12, 0.9), ...boa }, { gastoIncompleto: true }).sinal).toBe("manter");
  });

  it("3 reuniões com a conta exibível: custo ≤ o da conta → Escalar (sem ressalva); acima → Manter", () => {
    const tres = { ...d9, agendadas: 3 };
    const esc = sinal(tres, { custoPorReuniaoDaConta: 200 });
    expect(esc).toMatchObject({ sinal: "escalar", causa: "reunioes", ressalva: null });
    expect(sp(esc.motivo)).toBe("R$ 59 por reunião · 3 reuniões");
    expect(esc.linha).toBe(esc.motivo);
    expect(sinal(tres, { custoPorReuniaoDaConta: 50 })).toMatchObject({ sinal: "manter", motivo: "3 reuniões; custo acima do da conta" });
    expect(sinal(tres, { custoPorReuniaoDaConta: null })).toMatchObject({ sinal: "manter", motivo: "3 reuniões; custo da conta sem leitura confiável" });
  });
});

// ---------------------------------------------------------------- 5. a matriz da qualidade

describe("a qualidade pelo robô (F4-D7, F4-D9)", () => {
  const boa = { qualidade: { estado: "boa", maduros: 12, taxa: 8 / 12 } as LeituraDaQualidade, robo: robo({ noRobo: 12, falou: 12, respondeu: 8, aceitou: 2 }) };
  const ruim = { qualidade: { estado: "ruim", motivo: "nao-responde", maduros: 12 } as LeituraDaQualidade, robo: robo({ noRobo: 12, falou: 12, respondeu: 1 }) };
  const neutra = { qualidade: { estado: "neutra", maduros: 12, taxa: 4 / 12 } as LeituraDaQualidade, robo: robo({ noRobo: 12, falou: 12, respondeu: 4 }) };

  it("boa + razão 0,9 → Candidato pelo robô ('responde ao robô, ainda sem reunião'); boa + razão 1,2 → Manter", () => {
    const c = sinal({ leads: 12, gasto: gastoPorRazao(12, 0.9), ...boa });
    expect(c).toMatchObject({ sinal: "candidato", causa: "cpl-robo", ressalva: "responde ao robô, ainda sem reunião" });
    expect(sinal({ leads: 12, gasto: gastoPorRazao(12, 0.9), agendadas: 2, ...boa }).ressalva).toBe("responde ao robô · 2 reuniões, decide com 3");
    expect(sinal({ leads: 12, gasto: gastoPorRazao(12, 1.2), ...boa }).sinal).toBe("manter");
  });

  it("ruim + razão 0,5 → Trocar arte ('barato, mas …'); ruim + razão 1,3 com λ ≥ 3 → Pausar ('caro e …')", () => {
    const troca = sinal({ leads: 12, gasto: gastoPorRazao(12, 0.5), ...ruim });
    expect(troca).toMatchObject({ sinal: "trocar-arte", causa: "qualidade" });
    expect(troca.motivo).toMatch(/^barato, mas \d+ de \d+ responderam ao robô$/);
    const pausa = sinal({ leads: 12, gasto: gastoPorRazao(12, 1.3), ...ruim });
    expect(pausa).toMatchObject({ sinal: "pausar", causa: "qualidade" });
    expect(pausa.motivo).toMatch(/^caro e \d+ de \d+ responderam ao robô$/);
    // Sem WhatsApp como motivo da "ruim".
    const semW = { qualidade: { estado: "ruim", motivo: "sem-whatsapp", maduros: 6 } as LeituraDaQualidade, robo: robo({ noRobo: 12, falou: 8, semWhatsapp: 4 }) };
    expect(sinal({ leads: 12, gasto: gastoPorRazao(12, 1.3), ...semW }).motivo).toBe("caro e 4 de 12 sem WhatsApp");
    expect(sinal({ leads: 12, gasto: gastoPorRazao(12, 0.5), ...semW }).motivo).toBe("barato, mas 4 de 12 sem WhatsApp");
  });

  it("neutra → Manter, com '{r} de {f} responderam ao robô' no ⓘ", () => {
    const s = sinal({ leads: 12, gasto: gastoPorRazao(12, 0.5), ...neutra });
    expect(s).toMatchObject({ sinal: "manter", motivo: "4 de 12 responderam ao robô", linha: null });
  });

  it("sem amostra + razão 0,6 + 11 leads + 5 maduros com 3 respostas → Candidato pela D9", () => {
    expect(sinal({ leads: 11, gasto: gastoPorRazao(11, 0.6), ...semAmostra(5, 3) })).toMatchObject({ sinal: "candidato", causa: "cpl-d9" });
  });

  it("sem amostra e razão ≤ 1 sem candidato: Manter diz quantos faltam ('robô decide com 10')", () => {
    const s = sinal({ leads: 11, gasto: gastoPorRazao(11, 0.8), ...semAmostra(6, 3) });
    expect(s).toMatchObject({ sinal: "manter", motivo: "CPL 0,8× a média; robô decide com 10 (faltam 4)" });
  });
});

// ---------------------------------------------------------------- 6. leituraDaQualidade

describe("leituraDaQualidade: os 8 casos do §3.2, na ordem", () => {
  it("1–3: indisponível (desligado / antes do robô / leitura parada / ninguém no robô)", () => {
    expect(ler({ noRobo: 20, falou: 20, respondeu: 15 }, { comRobo: false, motivoSemRobo: null, parada: false })).toEqual({ estado: "indisponivel", porque: "desligado" });
    expect(ler({ noRobo: 20 }, { comRobo: false, motivoSemRobo: "antes-do-robo", parada: false })).toEqual({ estado: "indisponivel", porque: "antes-do-robo" });
    expect(ler({ noRobo: 20, falou: 20, respondeu: 15 }, { comRobo: true, motivoSemRobo: null, parada: true })).toEqual({ estado: "indisponivel", porque: "leitura-parada" });
    expect(ler(undefined)).toEqual({ estado: "indisponivel", porque: "ninguem-no-robo" });
    expect(ler({ leads: 5, noRobo: 0 })).toEqual({ estado: "indisponivel", porque: "ninguem-no-robo" });
  });

  it("4: sem WhatsApp > 25% com 10 no robô é ruim ANTES da amostra (quem não tem WhatsApp nunca amadurece)", () => {
    expect(ler({ noRobo: 10, falou: 3, semWhatsapp: 3 })).toEqual({ estado: "ruim", motivo: "sem-whatsapp", maduros: 3 });
    // Bordas: 25% não é ruim; 26% é; com 9 no robô, não julga.
    expect(ler({ noRobo: 100, falou: 75, respondeu: 40, semWhatsapp: 25 }).estado).not.toBe("ruim");
    expect(ler({ noRobo: 100, falou: 74, respondeu: 40, semWhatsapp: 26 })).toMatchObject({ estado: "ruim", motivo: "sem-whatsapp" });
    expect(ler({ noRobo: 9, falou: 0, semWhatsapp: 9 }).estado).toBe("sem-amostra");
  });

  it("5: menos de 10 maduros (falou − nas 24 h) é sem amostra, com quantos faltam — bordas 9 / 10", () => {
    expect(ler({ noRobo: 12, falou: 9, respondeu: 0 })).toEqual({ estado: "sem-amostra", maduros: 9, faltam: 1 });
    expect(ler({ noRobo: 14, falou: 13, respondeu: 0, noPrazo: 4 })).toEqual({ estado: "sem-amostra", maduros: 9, faltam: 1 });
    expect(ler({ noRobo: 12, falou: 10, respondeu: 0 }).estado).toBe("ruim");
  });

  it("6–8: ruim (maduros < 25%), boa (exibida ≥ 50%), neutra — bordas 24 / 25% e 49 / 50%", () => {
    expect(ler({ noRobo: 100, falou: 100, respondeu: 24 })).toEqual({ estado: "ruim", motivo: "nao-responde", maduros: 100 });
    expect(ler({ noRobo: 100, falou: 100, respondeu: 25 })).toEqual({ estado: "neutra", maduros: 100, taxa: 0.25 });
    expect(ler({ noRobo: 100, falou: 100, respondeu: 49 })).toEqual({ estado: "neutra", maduros: 100, taxa: 0.49 });
    expect(ler({ noRobo: 100, falou: 100, respondeu: 50 })).toEqual({ estado: "boa", maduros: 100, taxa: 0.5 });
  });

  it("imaturidade: com 4 nas 24 h, a exibida (÷ 1ª mensagem) é menor que a madura; 'boa' usa a exibida, 'ruim' usa a madura", () => {
    // 14 falaram, 4 ainda nas 24 h: 10 maduros.
    const seis = ler({ noRobo: 14, falou: 14, respondeu: 6, noPrazo: 4 }); // exibida 43%, madura 60%
    expect(seis).toEqual({ estado: "neutra", maduros: 10, taxa: 6 / 14 });
    expect(ler({ noRobo: 14, falou: 14, respondeu: 7, noPrazo: 4 })).toEqual({ estado: "boa", maduros: 10, taxa: 0.5 });
    // Exibida 21% (< 25%), madura 30%: as 24 h não contam contra o criativo — não é ruim.
    expect(ler({ noRobo: 14, falou: 14, respondeu: 3, noPrazo: 4 }).estado).toBe("neutra");
    expect(ler({ noRobo: 14, falou: 14, respondeu: 2, noPrazo: 4 })).toEqual({ estado: "ruim", motivo: "nao-responde", maduros: 10 });
  });
});

// ---------------------------------------------------------------- 7. a média

describe("mediaDosCriativos e porqueSemMedia", () => {
  it("razão das somas (ponderada pelo gasto): 1 lead a R$ 10 não puxa a média de 40 leads a R$ 35", () => {
    const m = mediaDosCriativos([{ gasto: 1400, leads: 40 }, { gasto: 10, leads: 1 }])!;
    expect(m.porLead).toBeCloseTo(1410 / 41, 6);
    expect(m.porLead).toBeGreaterThan(34);
    // A média dos CPLs daria R$ 22,50.
    expect(m.porLead).not.toBeCloseTo((35 + 10) / 2, 0);
    expect(porqueSemMedia([{ gasto: 1400, leads: 40 }, { gasto: 10, leads: 1 }])).toBeNull();
  });

  it("1 criativo → 'um-criativo' (vence 'poucos-leads'); 2 criativos e 9 leads → 'poucos-leads'", () => {
    expect(porqueSemMedia([{ gasto: 300, leads: 20 }])).toBe("um-criativo");
    expect(porqueSemMedia([{ gasto: 300, leads: 5 }])).toBe("um-criativo");
    expect(porqueSemMedia([{ gasto: 300, leads: 4 }, { gasto: 100, leads: 5 }])).toBe("poucos-leads");
  });
});

// ---------------------------------------------------------------- 8. textos

/** Um caso por sinal e causa (e os motivos de Manter). */
const CASOS: [string, () => SinalDoCriativo][] = [
  ["escalar", () => sinal({ agendadas: 3, gasto: 450, leads: 12 }, { custoPorReuniaoDaConta: 200 })],
  ["pausar · sem resultado", () => sinal({ gasto: gastoDe(5) })],
  ["pausar · caro com 1 lead", () => sinal({ leads: 1, gasto: gastoDe(5) })],
  ["pausar · caro com 3 leads", () => sinal({ leads: 3, gasto: gastoDe(9) })],
  ["pausar · qualidade", () => sinal({ leads: 12, gasto: gastoPorRazao(12, 1.3), qualidade: { estado: "ruim", motivo: "nao-responde", maduros: 48 }, robo: robo({ noRobo: 50, falou: 48, respondeu: 10 }) })],
  ["trocar arte · fadiga", () => sinal({ leads: 5, gasto: gastoDe(4), fadiga: FADIGADO })],
  ["trocar arte · qualidade", () => sinal({ leads: 12, gasto: gastoPorRazao(12, 0.5), qualidade: { estado: "ruim", motivo: "nao-responde", maduros: 48 }, robo: robo({ noRobo: 50, falou: 48, respondeu: 10 }) })],
  ["trocar arte · qualidade sem média", () => sinal({ leads: 12, gasto: 400, qualidade: { estado: "ruim", motivo: "sem-whatsapp", maduros: 30 }, robo: robo({ noRobo: 48, falou: 30, semWhatsapp: 14 }) }, { media: null, porqueSemMedia: "poucos-leads" })],
  ["cedo · sem base (um criativo)", () => sinal({ gasto: 100 }, { media: null, porqueSemMedia: "um-criativo" })],
  ["cedo · sem base (poucos leads)", () => sinal({ gasto: 100, leads: 2 }, { media: null, porqueSemMedia: "poucos-leads" })],
  ["cedo · amostra", () => sinal({ gasto: gastoDe(2.5), leads: 1 })],
  ["candidato · D9", () => sinal({ leads: 110, gasto: gastoPorRazao(110, 0.4) })],
  ["candidato · D9 com reunião", () => sinal({ leads: 110, gasto: gastoPorRazao(110, 0.4), agendadas: 2 })],
  ["candidato · robô", () => sinal({ leads: 12, gasto: gastoPorRazao(12, 0.9), qualidade: { estado: "boa", maduros: 12, taxa: 0.6 }, robo: robo({ noRobo: 12, falou: 12, respondeu: 8, aceitou: 3 }) })],
  ["manter · ambíguo", () => sinal({ ambiguos: 2, gasto: gastoDe(4) })],
  ["manter · trava contato", () => sinal({ leads: 30, gasto: gastoPorRazao(30, 0.5), contatoInvalido: 9 })],
  ["manter · trava telefone", () => sinal({ leads: 30, gasto: gastoPorRazao(30, 0.5), semTelefone: 9 })],
  ["manter · trava resposta", () => sinal({ leads: 11, gasto: gastoPorRazao(11, 0.4), ...semAmostra(9, 0) })],
  ["manter · piso", () => sinal({ leads: 11, gasto: gastoPorRazao(11, 0.4) }, { gastoIncompleto: true })],
  ["manter · neutra", () => sinal({ leads: 50, gasto: gastoPorRazao(50, 0.9), qualidade: { estado: "neutra", maduros: 48, taxa: 0.25 }, robo: robo({ noRobo: 50, falou: 48, respondeu: 12, aceitou: 3, semWhatsapp: 2 }) })],
  ["manter · sem amostra", () => sinal({ leads: 11, gasto: gastoPorRazao(11, 0.8), ...semAmostra(6, 3) })],
  ["manter · reuniões acima", () => sinal({ agendadas: 12, gasto: 2000, leads: 40 }, { custoPorReuniaoDaConta: 100 })],
  ["manter · conta sem custo", () => sinal({ agendadas: 12, gasto: 2000, leads: 40 }, { custoPorReuniaoDaConta: null })],
  ["manter · atenção", () => sinal({ leads: 30, gasto: gastoPorRazao(30, 1.2), fadiga: ATENCAO })],
  ["manter · CPL", () => sinal({ leads: 30, gasto: gastoPorRazao(30, 1.2) })],
  ["manter · poucos leads", () => sinal({ leads: 2, gasto: gastoDe(3.4) })],
  ["manter · nenhum lead", () => sinal({ gasto: gastoDe(3.1), ambiguos: 0, leads: 0, agendadas: 1 })],
];

describe("textos: motivo e linha ≤ 10 palavras, frases do ⓘ ≤ 25 (K36)", () => {
  for (const [nome, f] of CASOS) {
    it(nome, () => {
      const s = f();
      expect(nPalavras(s.motivo), s.motivo).toBeLessThanOrEqual(10);
      expect(s.motivo.length).toBeGreaterThan(0);
      if (s.linha) expect(nPalavras(s.linha), s.linha).toBeLessThanOrEqual(10);
      // `linha` = null só em Manter; senão é a ressalva (candidato) ou o motivo.
      if (s.sinal === "manter") expect(s.linha).toBeNull();
      else expect(s.linha).toBe(s.sinal === "candidato" ? s.ressalva : s.motivo);
      expect(s.ressalva === null).toBe(s.sinal !== "candidato");
      // O ⓘ: o motivo primeiro (sem o nome do criativo na frente, K30) e nenhuma frase > 25.
      expect(s.dica.startsWith(s.motivo), s.dica).toBe(true);
      for (const fr of frases(s.dica)) expect(nPalavras(fr), fr).toBeLessThanOrEqual(25);
      // Rótulo e tom da tabela.
      expect(s.rotulo).toBe(ROTULO_DO_SINAL[s.sinal]);
      expect(s.tom).toBe(TOM_DO_SINAL[s.sinal]);
    });
  }

  it("cada caso acerta o sinal que diz", () => {
    for (const [nome, f] of CASOS) expect(f().sinal, nome).toBe(nome.split(" · ")[0].replace("trocar arte", "trocar-arte") as Sinal);
  });

  it("o anel do candidato (K42): 'ok-vazado'; o escalar tem o ponto cheio 'ok'", () => {
    expect(TOM_DO_SINAL.candidato).toBe("ok-vazado");
    expect(TOM_DO_SINAL.escalar).toBe("ok");
    expect(TOM_DO_SINAL.pausar).toBe("fora");
    expect(TOM_DO_SINAL["trocar-arte"]).toBe("perto");
    expect(TOM_DO_SINAL.manter).toBe("neutro");
    expect(TOM_DO_SINAL.cedo).toBe("neutro");
    expect(ROTULO_DO_SINAL).toEqual({ escalar: "Escalar", candidato: "Candidato a escalar", manter: "Manter", "trocar-arte": "Trocar arte", pausar: "Pausar", cedo: "Cedo" });
    expect(Object.entries(ORDEM_DO_SINAL).sort((a, b) => a[1] - b[1]).map(([k]) => k)).toEqual(["pausar", "trocar-arte", "escalar", "candidato", "manter", "cedo"]);
  });

  it("textoDaReguaDoSinal: a régua inteira — o 0,7× da D9, a chance de 5% e 'É sugestão'", () => {
    const r = textoDaReguaDoSinal();
    expect(r).toContain("0,7× a média");
    expect(r).toContain("5%");
    expect(r).toContain("É sugestão");
    for (const fr of frases(r)) expect(nPalavras(fr), fr).toBeLessThanOrEqual(25);
  });

  it("o ⓘ diz a leitura do robô (boa: as contagens; sem amostra: quantos faltam; indisponível: o porquê)", () => {
    const comRobo = CASOS.find(([n]) => n === "manter · neutra")![1]();
    expect(comRobo.dica).toContain("Robô: 12 de 48 responderam, 3 aceitaram, 2 sem WhatsApp.");
    expect(sinal({ leads: 11, gasto: gastoPorRazao(11, 0.8), ...semAmostra(6, 3) }).dica).toContain("Robô: faltam 4 pessoas com 24 h para julgar.");
    expect(sinal({ leads: 30, gasto: gastoPorRazao(30, 1.2) }).dica).toContain("Robô desligado nesta marca.");
    expect(sinal({ leads: 30, gasto: gastoPorRazao(30, 1.2), qualidade: { estado: "indisponivel", porque: "antes-do-robo" } }).dica).toContain("Período antes do robô (29/10).");
    expect(sinal({ leads: 30, gasto: gastoPorRazao(30, 1.2), qualidade: PARADA }).dica).toContain("Robô sem leitura recente: a resposta não entra.");
    expect(sinal({ leads: 30, gasto: gastoPorRazao(30, 1.2), qualidade: { estado: "indisponivel", porque: "ninguem-no-robo" } }).dica).toContain(
      "Nenhum lead deste criativo passou pelo robô.",
    );
  });
});

describe("a amostra que sustenta o sinal (o motor copia para `Acao.amostra`)", () => {
  it("por causa, como na tabela do tipo (§3.2)", () => {
    expect(sinal({ agendadas: 3, gasto: 450, leads: 12 }, { custoPorReuniaoDaConta: 200 }).amostra).toEqual({ n: 3, minimo: MIN_REUNIOES });
    expect(sinal({ gasto: gastoDe(5.7) }).amostra).toEqual({ n: 5, minimo: 3 });
    expect(sinal({ leads: 1, gasto: gastoDe(5) }).amostra).toEqual({ n: 5, minimo: 3 });
    expect(sinal({ gasto: gastoDe(2.5), leads: 1 }).amostra).toEqual({ n: 2, minimo: 3 });
    // Qualidade e candidato pelo robô: os maduros; sem WhatsApp: os que estão no robô.
    const ruim = { qualidade: { estado: "ruim", motivo: "nao-responde", maduros: 12 } as LeituraDaQualidade, robo: robo({ noRobo: 12, falou: 12, respondeu: 1 }) };
    expect(sinal({ leads: 12, gasto: gastoPorRazao(12, 1.3), ...ruim }).amostra).toEqual({ n: 12, minimo: 10 });
    const semW = { qualidade: { estado: "ruim", motivo: "sem-whatsapp", maduros: 6 } as LeituraDaQualidade, robo: robo({ noRobo: 14, falou: 8, semWhatsapp: 6 }) };
    expect(sinal({ leads: 14, gasto: gastoPorRazao(14, 0.5), ...semW }).amostra).toEqual({ n: 14, minimo: 10 });
    const boa = { qualidade: { estado: "boa", maduros: 13, taxa: 0.6 } as LeituraDaQualidade, robo: robo({ noRobo: 14, falou: 13, respondeu: 8 }) };
    expect(sinal({ leads: 14, gasto: gastoPorRazao(14, 0.9), ...boa }).amostra).toEqual({ n: 13, minimo: 10 });
    // D9: os leads.
    expect(sinal({ leads: 11, gasto: gastoPorRazao(11, 0.4) }).amostra).toEqual({ n: 11, minimo: 10 });
    // Fadiga: as impressões da janela recente.
    expect(sinal({ leads: 5, gasto: gastoDe(4), fadiga: FADIGADO }).amostra).toEqual({ n: 7000, minimo: REGRA_FADIGA.impressoesMinimas });
    // Sem base: a régua da média ("um criativo só": 2 criativos).
    expect(sinal({ gasto: 100 }, { media: null, porqueSemMedia: "um-criativo" }).amostra.minimo).toBe(2);
    expect(sinal({ gasto: 100, leads: 2 }, { media: null, porqueSemMedia: "poucos-leads" }).amostra.minimo).toBe(AMOSTRA_DE_PESSOAS);
    // Manter: os leads, sem mínimo.
    expect(sinal({ leads: 30, gasto: gastoPorRazao(30, 1.2) }).amostra).toEqual({ n: 30, minimo: 0 });
  });
});

// ---------------------------------------------------------------- 9. uma régua de amostra (K9)

describe("uma régua de amostra de PESSOAS (K9)", () => {
  it("candidato, contato inválido, maduros, sem WhatsApp, base da média e a M4 do motor são todos AMOSTRA_DE_PESSOAS (10)", () => {
    expect(AMOSTRA_DE_PESSOAS).toBe(10);
    expect(REGUA_DO_SINAL.candidatoMinLeads).toBe(AMOSTRA_DE_PESSOAS);
    expect(REGUA_DO_SINAL.contatoInvalidoMinLeads).toBe(AMOSTRA_DE_PESSOAS);
    expect(REGUA_DO_SINAL.qualidade.maduros).toBe(AMOSTRA_DE_PESSOAS);
    expect(REGUA_DO_SINAL.qualidade.semWhatsappMinNoRobo).toBe(AMOSTRA_DE_PESSOAS);
    expect(REGUA_DO_SINAL.baseDaMedia.leads).toBe(AMOSTRA_DE_PESSOAS);
    expect(AMOSTRA_MIN.M4).toBe(AMOSTRA_DE_PESSOAS);
  });

  it("os outros números da régua (§3.2)", () => {
    expect(REGUA_DO_SINAL.esperadosParaJulgar).toBe(MIN_REUNIOES);
    expect(REGUA_DO_SINAL.chanceMaxima).toBe(0.05);
    expect(REGUA_DO_SINAL.baseDaMedia.criativos).toBe(2);
    expect(REGUA_DO_SINAL.pausarAcimaDaMedia).toBe(2);
    expect(REGUA_DO_SINAL.candidatoAteDaMedia).toBe(0.7);
    expect(REGUA_DO_SINAL.contatoInvalidoMax).toBe(0.25);
    expect(REGUA_DO_SINAL.semTelefoneOuWhatsappMax).toBe(0.25);
    expect(REGUA_DO_SINAL.qualidade).toMatchObject({ respondeuBoa: 0.5, respondeuRuim: 0.25, semWhatsappMax: 0.25, travaMinMaduros: MIN_REUNIOES });
  });
});

// ---------------------------------------------------------------- 10. a régua escrita, o número da tabela e o piso (corretor final)

describe("a régua escrita, a fração da tabela e o piso no motivo", () => {
  it("0 lead: Pausar só com λ ≥ 3 — entre ln 20 (≈ 2,996) e 3 a chance já é < 5%, mas a régua diz Cedo", () => {
    // λ = 2,998: P(X = 0) ≈ 0,0499 < 5%, e ainda assim "gastou menos do que renderia 3 leads".
    expect(chanceDeAte(0, 2.998)).toBeLessThan(REGUA_DO_SINAL.chanceMaxima);
    const quase = sinal({ leads: 0, gasto: gastoDe(2.998) });
    expect(quase).toMatchObject({ sinal: "cedo", causa: "amostra" });
    expect(sinal({ leads: 0, gasto: gastoDe(3) })).toMatchObject({ sinal: "pausar", causa: "sem-resultado" });
  });

  it("o motivo do Cedo nunca diz 'R$ X de R$ X': o alvo exibido passa o gasto exibido", () => {
    for (const lambda of [2.5, 2.98, 2.994, 2.995, 2.998, 2.9999]) {
      const s = sinal({ leads: 0, gasto: gastoDe(lambda) });
      expect(s.sinal, `λ ${lambda}`).toBe("cedo");
      const [gasto, alvo] = [...sp(s.motivo).matchAll(/R\$ ([\d.]+)/g)].map((m) => Number(m[1].replace(/\./g, "")));
      expect(alvo, s.motivo).toBeGreaterThan(gasto);
    }
    // Longe da borda, o alvo é o 3 × a média de sempre.
    expect(sp(sinal({ leads: 9, gasto: gastoPorRazao(9, 0.3) }).motivo)).toBe("R$ 108 de R$ 120 para julgar");
  });

  it("'responderam ao robô' no motivo usa a MESMA fração da tabela do cartão (÷ 1ª mensagem), não os maduros", () => {
    const d9 = { leads: 11, gasto: gastoPorRazao(11, 0.4) };
    // 11 com a 1ª mensagem, 2 ainda nas 24 h (9 maduros), ninguém respondeu: a trava pega; o texto diz 0 de 11.
    expect(sinal({ ...d9, ...semAmostra(11, 0, 2) })).toMatchObject({ sinal: "manter", motivo: "CPL baixo, mas 0 de 11 responderam ao robô" });
    // A "ruim" (10 maduros de 14): o motivo visível diz 2 de 14 — a coluna Responderam do cartão.
    const ruim = { qualidade: { estado: "ruim", motivo: "nao-responde", maduros: 10 } as LeituraDaQualidade, robo: robo({ noRobo: 14, falou: 14, respondeu: 2, noPrazo: 4 }) };
    expect(sinal({ leads: 14, gasto: gastoPorRazao(14, 0.5), ...ruim }).motivo).toBe("barato, mas 2 de 14 responderam ao robô");
    expect(sinal({ leads: 14, gasto: gastoPorRazao(14, 1.3), ...ruim }).motivo).toBe("caro e 2 de 14 responderam ao robô");
  });

  it("com dias sem dado de gasto (K13), todo R$ que sai do gasto da linha leva '≥' — e o motivo continua ≤ 10 palavras", () => {
    const piso = { gastoIncompleto: true };
    const esc = sinal({ leads: 11, gasto: gastoPorRazao(11, 0.4), agendadas: 3 }, { ...piso, custoPorReuniaoDaConta: 200 });
    expect(sp(esc.motivo)).toBe("≥ R$ 59 por reunião · 3 reuniões");
    expect(sp(sinal({ leads: 0, gasto: gastoDe(5) }, piso).motivo)).toBe("≥ R$ 200 sem lead; a média renderia 5,0");
    expect(sp(sinal({ leads: 1, gasto: gastoDe(4.75) }, piso).motivo)).toBe("≥ R$ 190 e 1 lead; a média renderia 4,8");
    expect(sp(sinal({ leads: 3, gasto: gastoDe(7.76) }, piso).motivo)).toMatch(/^CPL ≥ R\$ \d+ · 2,6× a média$/);
    expect(sp(sinal({ leads: 9, gasto: gastoPorRazao(9, 0.3) }, piso).motivo)).toBe("≥ R$ 108 de R$ 120 para julgar");
    for (const s of [esc, sinal({ leads: 0, gasto: gastoDe(5) }, piso)]) expect(nPalavras(s.motivo)).toBeLessThanOrEqual(10);
    // Sem o piso, nenhum "≥".
    expect(sinal({ leads: 0, gasto: gastoDe(5) }).motivo).not.toContain("≥");
  });

  it("singular: 'falta 1 pessoa' e '(falta 1)'", () => {
    expect(sinal({ leads: 11, gasto: gastoPorRazao(11, 0.8), ...semAmostra(9, 4) })).toMatchObject({
      sinal: "manter",
      motivo: "CPL 0,8× a média; robô decide com 10 (falta 1)",
    });
    expect(sinal({ leads: 11, gasto: gastoPorRazao(11, 0.8), ...semAmostra(9, 4) }).dica).toContain("Robô: falta 1 pessoa com 24 h para julgar.");
    expect(sinal({ leads: 11, gasto: gastoPorRazao(11, 0.8), ...semAmostra(6, 3) }).dica).toContain("Robô: faltam 4 pessoas com 24 h para julgar.");
  });
});
