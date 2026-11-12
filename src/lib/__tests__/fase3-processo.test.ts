/**
 * Fase 3 (§8.2 da spec) — o funil do processo (`lib/funil-processo.ts`), a função
 * ÚNICA do Funil e do Início:
 *
 *   1. um número por métrica (os degraus = os kpis), 3 períodos × 2 marcas;
 *   2. o funil curto do Início é um RECORTE dele (os mesmos números e textos);
 *   3. aninhamento: taxa só sobre a etapa de cima, com amostra, nunca acima de 1;
 *   4. as juntas: cada pessoa julgada numa junta só antes de Agendaram (menos a live
 *      e, com o robô, os de antes de 29/10 fora da Fila — F3-D31), sem teste nem
 *      cópia de duplicado (K5);
 *   5. Confirmaram (K2), 6. a ponte (K10), 7. os casos de borda (K19, K21);
 *   8. LGPD do objeto; 9. a regra 11.7 nos kpis (K20); 10. `textoDaTaxa` (K31).
 *
 * Fixtures sintéticas (`src/test/fixtures-robo.ts`, a base do golden do Início, e
 * `src/test/fixtures-funil.ts`). AGORA = quarta 04/11/2026 15:00 de Brasília.
 */
import { describe, expect, it } from "vitest";
import { buildSeedData, buildSeedLeadEvents } from "../data/seed";
import { AMOSTRA_MINIMA } from "../cascata";
import { ATOR_LP } from "../diagnostico-leads";
import { montarFila } from "../fila";
import { formatInt, formatPercent } from "../format";
import {
  CONFIRMACAO_DESDE,
  RECORTE_DO_INICIO,
  dicaDoRecorteDoRobo,
  ROTULO_DO_DEGRAU,
  funilDoProcesso,
  idsDoTrechoDoRobo,
  linhaDaLeituraParada,
  recortarProcesso,
  textoDaTaxa,
  type DegrauDoProcesso,
  type DegrauId,
  type FunilDoProcesso,
  type JuntaDoProcesso,
  type JuntaId,
} from "../funil-processo";
import { funilDoAtendimento, montarInicio, type EntradaInicio } from "../inicio";
import { kpisDoPeriodo } from "../kpis";
import { dataDateRange, filterLeads, type DateRange } from "../metrics";
import { testesEDuplicados } from "../identidade";
import { classeDoLead } from "../qualificacao";
import type { DashboardData, Lead, LeadEvent } from "../types";
import {
  ADS_DA_ANTERIOR,
  ADS_DA_SEMANA,
  AGORA,
  ATRASADO,
  HOJE,
  LEADS_DA_ANTERIOR,
  LEADS_DO_ROBO,
  NUNCA_LIDO,
  ONTEM,
  PARADO,
  ROBO,
  SEMANA,
  base,
  brt,
  entradaDoRobo,
  entradaDoSeed,
  lead,
  porMarca,
  reaberto,
  saudado,
} from "@/test/fixtures-robo";
import { aceitouAs, confirmouReuniao, entradaEm, mudouStatus, saudadoAs, tentativa } from "@/test/fixtures-funil";

// ---------------------------------------------------------------- utilidades

const degrau = (p: FunilDoProcesso, id: DegrauId): DegrauDoProcesso | undefined => p.degraus.find((d) => d.id === id);
const junta = (p: FunilDoProcesso, id: JuntaId): JuntaDoProcesso => {
  const j = p.juntas.find((x) => x.id === id);
  if (!j) throw new Error(`junta ${id} ausente`);
  return j;
};
const soma = (ns: number[]) => ns.reduce((s, n) => s + n, 0);

const ORDEM_COM_ROBO: DegrauId[] = ["leads", "com-robo", "primeira-msg", "responderam", "aceitaram", "agendaram", "confirmaram", "realizadas", "vendas"];
const ORDEM_SEM_ROBO: DegrauId[] = ["leads", "agendaram", "confirmaram", "realizadas", "vendas"];
const JUNTAS_COM_ROBO: JuntaId[] = ["robo-falou", "respondeu", "aceitou", "agendou-apos-aceite", "fora-agendou", "realizou", "fechou"];
const JUNTAS_SEM_ROBO: JuntaId[] = ["agendou", "realizou", "fechou"];
const DONO_DA_JUNTA: Record<JuntaId, string> = {
  "robo-falou": "BOT",
  respondeu: "BOT",
  aceitou: "BOT",
  "agendou-apos-aceite": "COM",
  "fora-agendou": "COM",
  agendou: "COM",
  realizou: "COM",
  fechou: "ESP",
};
const DE_PARA: Record<JuntaId, [DegrauId, DegrauId]> = {
  "robo-falou": ["com-robo", "primeira-msg"],
  respondeu: ["primeira-msg", "responderam"],
  aceitou: ["responderam", "aceitaram"],
  "agendou-apos-aceite": ["aceitaram", "agendaram"],
  "fora-agendou": ["leads", "agendaram"],
  agendou: ["leads", "agendaram"],
  realizou: ["agendaram", "realizadas"],
  fechou: ["realizadas", "vendas"],
};

/** P' = a coorte do período sem teste nem cópia de duplicado (a base das juntas, K5). */
function populacaoDasJuntas(e: Pick<EntradaInicio, "data" | "range">): Lead[] {
  const { testes, duplicados } = testesEDuplicados(e.data.leads);
  return filterLeads(e.data.leads, e.range).filter((l) => !l.deletedAt && !testes.has(l.id) && !duplicados.has(l.id));
}

/** §3.3: ordem, rótulo, texto, barra, aninhamento e o porquê de toda linha sem taxa. */
function conferirDegraus(p: FunilDoProcesso) {
  expect(p.degraus.map((d) => d.id)).toEqual(p.comRobo ? ORDEM_COM_ROBO : ORDEM_SEM_ROBO);
  const porId = new Map(p.degraus.map((d) => [d.id, d]));
  for (const d of p.degraus) {
    expect(d.rotulo).toBe(ROTULO_DO_DEGRAU[d.id]);
    expect(d.texto).toBe(`${d.piso ? "≥ " : ""}${formatInt(d.n)}`);
    expect(d.daAncora).toBe(p.leads > 0 ? d.n / p.leads : null);
    expect(d.recuo).toBe(["primeira-msg", "responderam", "aceitaram", "confirmaram"].includes(d.id));
    expect(d.doRobo).toBe(["com-robo", "primeira-msg", "responderam", "aceitaram"].includes(d.id));
    expect(d.fonte).toBe(d.doRobo ? "robo" : "crm");
    if (d.piso) expect(d.taxa, `${d.id}: piso sem taxa`).toBeNull();
    if (d.base === null) {
      expect(d.taxa).toBeNull();
      expect(d.semTaxa).toBe(d.id === "leads" ? "ancora" : "recorte");
      continue;
    }
    const b = porId.get(d.base);
    expect(b, `${d.id}: a base ${d.base} está no funil`).toBeDefined();
    if (d.n > b!.n) {
      expect(d.taxa, `${d.id}: mais gente que na base`).toBeNull();
      // A amostra e o piso vêm antes na régua (`taxaDe`); fora deles, o motivo é o aninhamento.
      if (b!.n >= AMOSTRA_MINIMA && !d.piso && !b!.piso) expect(d.semTaxa, `${d.id}: mais gente que na base`).toBe("nao-aninhada");
    }
    if (d.taxa !== null) {
      expect(d.semTaxa).toBeNull();
      expect(d.taxa).toBeGreaterThanOrEqual(0);
      expect(d.taxa).toBeLessThanOrEqual(1);
      expect(b!.n, `${d.id}: taxa só com a base ≥ AMOSTRA_MINIMA`).toBeGreaterThanOrEqual(AMOSTRA_MINIMA);
      expect(b!.piso).toBe(false);
    } else {
      expect(d.semTaxa, `${d.id}: sem taxa sempre diz por quê`).not.toBeNull();
    }
  }
  // Confirmaram é LATERAL (K2): não é base de ninguém; Reuniões realizadas é sobre Agendaram.
  expect(p.degraus.some((d) => d.base === "confirmaram")).toBe(false);
  expect(porId.get("confirmaram")?.base).toBe("agendaram");
  expect(porId.get("realizadas")?.base).toBe("agendaram");
  expect(porId.get("vendas")?.base).toBe("realizadas");
  expect(porId.get("agendaram")?.base).toBe("leads");
  if (p.comRobo) {
    expect(porId.get("primeira-msg")?.base).toBe("com-robo");
    expect(porId.get("responderam")?.base).toBe("primeira-msg");
    expect(porId.get("aceitaram")?.base).toBe("responderam");
  }
}

/** §3.4: a conta de cada junta fecha, e cada pessoa trava em no máximo uma. */
function conferirJuntas(p: FunilDoProcesso) {
  expect(p.juntas.map((j) => j.id)).toEqual(p.comRobo ? JUNTAS_COM_ROBO : JUNTAS_SEM_ROBO);
  for (const j of p.juntas) {
    expect(j.entradas, j.id).toBe(j.passaram + j.outroCaminho + j.emAndamento + j.travados);
    expect(j.travados, j.id).toBe(j.abertos + j.encerrados);
    for (const n of [j.entradas, j.passaram, j.outroCaminho, j.emAndamento, j.travados, j.abertos, j.encerrados]) expect(n).toBeGreaterThanOrEqual(0);
    expect(j.dono, j.id).toBe(DONO_DA_JUNTA[j.id]);
    expect([j.de, j.para], j.id).toEqual(DE_PARA[j.id]);
    expect(j.doRobo, j.id).toBe(["robo-falou", "respondeu", "aceitou"].includes(j.id));
    if (j.id === "realizou" || j.id === "fechou") expect(j.outroCaminho, j.id).toBe(0);
    if (j.travados === 0) expect(j.destino, j.id).toBeNull();
    if (j.id === "robo-falou" && j.semFala) expect(j.semFala.semWhatsapp + j.semFala.naoChegou + j.semFala.naoFalou).toBe(j.travados);
    if (j.id !== "robo-falou") expect(j.semFala).toBeUndefined();
  }
  expect(soma(p.juntas.map((j) => j.travados))).toBeLessThanOrEqual(p.leads);
  if (p.comRobo) {
    // A cadeia do robô: quem passa numa junta é quem entra na seguinte.
    expect(junta(p, "respondeu").entradas).toBe(junta(p, "robo-falou").passaram);
    expect(junta(p, "aceitou").entradas).toBe(junta(p, "respondeu").passaram);
    expect(junta(p, "agendou-apos-aceite").entradas).toBe(junta(p, "aceitou").passaram);
  }
}

/** A partição antes de Agendaram (K1 + F3-D31): cada pessoa de P' começa numa cadeia só, ou fica fora pelo motivo contado. */
function conferirParticao(p: FunilDoProcesso, e: Pick<EntradaInicio, "data" | "range">) {
  const pLinha = populacaoDasJuntas(e);
  const inicios = p.comRobo ? junta(p, "robo-falou").entradas + junta(p, "fora-agendou").entradas : junta(p, "agendou").entradas;
  expect(inicios + p.foraDasJuntas.live + p.foraDasJuntas.antes).toBe(pLinha.length);
  if (!p.comRobo) expect(p.foraDasJuntas.antes).toBe(0);
  expect(p.foraDasJuntas.live).toBe(pLinha.filter((l) => classeDoLead(l)).length);
}

/** O processo, conferido por inteiro (degraus, juntas e partição). */
function processo(e: EntradaInicio): FunilDoProcesso {
  const p = funilDoProcesso(e);
  conferirDegraus(p);
  conferirJuntas(p);
  conferirParticao(p, e);
  return p;
}

// ---------------------------------------------------------------- 1. um número por métrica

const AGORA_SEED = "2026-10-08T12:00:00.000Z";
const HOJE_SEED = "2026-10-08";

function conferirNumeros(p: FunilDoProcesso, e: Pick<EntradaInicio, "data" | "range" | "kpis">) {
  const k = e.kpis;
  const P = filterLeads(e.data.leads, e.range).filter((l) => !l.deletedAt);
  expect(P.length).toBe(k.leads.valor);
  expect(p.leads).toBe(k.leads.valor);
  expect(degrau(p, "leads")?.n).toBe(k.leads.valor);
  expect(degrau(p, "agendaram")?.n).toBe(k.agendaram.valor);
  expect(degrau(p, "realizadas")?.n).toBe(k.overview.attended);
  expect(degrau(p, "vendas")?.n).toBe(k.overview.clients);
  const ag = degrau(p, "agendaram")!;
  if (k.leads.valor >= AMOSTRA_MINIMA) expect(ag.taxa).toBe(k.taxaLeadAgendada.valor);
  else expect(ag.taxa).toBeNull();
  // Reuniões realizadas é sobre Agendaram: o comparecimento da coorte (K2).
  const r = degrau(p, "realizadas")!;
  if (r.taxa !== null) expect(r.taxa).toBe(k.overview.showRate);
}

describe("1 · um número por métrica: os degraus são os kpis (3 períodos × 2 marcas)", () => {
  const seed = buildSeedData();
  // A marca de awareness não tem lead no seed (nem em produção: é só seguidores); sem leads, a
  // 2ª marca só conferiria 0 = 0. Ela ganha uma cópia dos leads da consorcio (ids próprios).
  const comDuasMarcas = {
    ...seed,
    leads: [...seed.leads, ...seed.leads.filter((l) => l.brand === "consorcio").map((l) => ({ ...l, id: `krone-${l.id}`, brand: "krone" }))],
  };
  for (const brand of ["consorcio", "krone"]) {
    const data = porMarca(comDuasMarcas, brand);
    it(`${brand}: a marca tem leads na campanha (a conferência não é vazia)`, () => {
      expect(data.leads.length).toBeGreaterThan(20);
    });
    const ultimo = dataDateRange(data).to || "2026-10-07";
    const menos = (n: number) => {
      const d = new Date(`${ultimo}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - n);
      return d.toISOString().slice(0, 10);
    };
    const periodos: [string, DateRange | undefined][] = [
      ["7 dias", { from: menos(6), to: ultimo }],
      ["30 dias", { from: menos(29), to: ultimo }],
      ["campanha", undefined],
    ];
    for (const [nome, range] of periodos) {
      it(`${brand} · ${nome} (robô desligado)`, () => {
        const kpis = kpisDoPeriodo(data, range, { hoje: HOJE_SEED, agora: AGORA_SEED });
        const e = { data, range, kpis, eventos: buildSeedLeadEvents(data.leads), agora: AGORA_SEED };
        const p = funilDoProcesso(e);
        conferirNumeros(p, e);
        conferirDegraus(p);
        conferirJuntas(p);
        conferirParticao(p, e);
        expect(p.comRobo).toBe(false);
      });
    }
  }

  const comRobo: [string, () => EntradaInicio][] = [
    ["robô · semana", () => entradaDoRobo()],
    ["robô · campanha", () => entradaDoRobo(ROBO, null)],
    ["robô parado", () => entradaDoRobo(PARADO)],
    ["robô nunca lido", () => entradaDoRobo(NUNCA_LIDO)],
    ["robô desligado", () => entradaDoRobo(null)],
  ];
  for (const [nome, entrada] of comRobo) {
    it(`fixture do robô · ${nome}`, () => {
      const e = entrada();
      conferirNumeros(processo(e), e);
    });
  }
});

// ---------------------------------------------------------------- 2. o Início é um recorte

describe("2 · o funil do Início é um recorte do funil do processo (os mesmos números e textos)", () => {
  const casos: [string, () => EntradaInicio][] = [
    ["seed · 7d", () => entradaDoSeed("7d")],
    ["seed · 30d", () => entradaDoSeed("30d")],
    ["seed · campanha", () => entradaDoSeed("all")],
    ["robô · semana", () => entradaDoRobo()],
    ["robô · campanha", () => entradaDoRobo(ROBO, null)],
    ["robô parado", () => entradaDoRobo(PARADO)],
    ["robô parado há 90 min", () => entradaDoRobo(ATRASADO)],
    ["robô desligado", () => entradaDoRobo(null)],
    ["todo antes de 29/10", () => entradaDoRobo(ROBO, { from: "2026-10-20", to: "2026-10-28" }, { leads: [...LEADS_DO_ROBO, ...LEADS_DA_ANTERIOR], adDaily: [...ADS_DA_ANTERIOR, ...ADS_DA_SEMANA] })],
  ];
  for (const [nome, entrada] of casos) {
    it(nome, () => {
      const e = entrada();
      const p = processo(e);
      const ids = p.comRobo ? RECORTE_DO_INICIO.comRobo : RECORTE_DO_INICIO.semRobo;
      const recorte = recortarProcesso(p, ids);
      const ini = funilDoAtendimento(e);
      expect(recorte.map((d) => d.id)).toEqual([...ids]);
      expect(recorte.map((d) => d.id)).toEqual(ini.degraus.map((d) => d.id));
      expect(recorte.map((d) => [d.rotulo, d.n, d.texto, d.taxa, d.piso, d.dono, d.doRobo])).toEqual(
        ini.degraus.map((d) => [d.rotulo, d.valor, d.texto, d.taxa, d.piso, d.dono, d.doRobo]),
      );
      // O MESMO texto do % nos dois (K31): a string, não só o número.
      for (const d of recorte) if (d.taxa !== null) expect(textoDaTaxa(d.taxa)).toBe(formatPercent(d.taxa, 0));
      expect([ini.comRobo, ini.leads, ini.noRobo, ini.parada]).toEqual([p.comRobo, p.leads, p.noRobo, p.parada]);
      expect(ini.fora).toEqual(p.fora);
      // Passar o processo pronto (o que o Início faz, calculado uma vez) dá o mesmo objeto.
      expect(funilDoAtendimento(e, p)).toEqual(ini);
    });
  }
});

// ---------------------------------------------------------------- 3 e 4. as juntas

/**
 * Um fixture pequeno, contado à mão (robô em dia, 20/10 a 04/11):
 *   • f-antes: de antes de 29/10, encerrado, fora da Fila → fora das juntas (F3-D31);
 *   • f-semtel: sem telefone, no Resgate há 14 h úteis → trava em `fora-agendou`;
 *   • f-reabpainel: reaberto pelo admin ontem, sem fala nova; no Resgate (o robô não falou) → trava em `fora-agendou`;
 *   • f-recente: entrou às 14:50 → `fora-agendou`, ainda no relógio do robô;
 *   • f-live: inscrito da live → fora das juntas;
 *   • f-semresposta: saudado ontem, sem resposta há > 24 h → trava em `respondeu`.
 */
const DESDE_20: DateRange = { from: "2026-10-20", to: HOJE };
function fixtureF(): { leads: Lead[]; eventos: LeadEvent[] } {
  return {
    leads: [
      lead("f-antes", { createdAt: brt("2026-10-20", "10:00"), status: "sem_interesse", lostAt: brt("2026-10-21", "10:00") }),
      lead("f-semtel", { createdAt: brt(ONTEM, "10:00"), phone: undefined }),
      lead("f-reabpainel", saudado("2026-10-30")),
      lead("f-recente", { createdAt: brt(HOJE, "14:50") }),
      lead("f-live", { createdAt: brt(ONTEM, "10:00"), classe: "A", bem: "imovel" }),
      lead("f-semresposta", saudado(ONTEM)),
    ],
    eventos: [reaberto("f-reabpainel", brt(ONTEM, "10:00"), "admin")],
  };
}

describe("3 e 4 · aninhamento e juntas", () => {
  it("as invariantes valem em toda a bateria de fixtures", () => {
    for (const e of [
      entradaDoRobo(),
      entradaDoRobo(ROBO, null),
      entradaDoRobo(PARADO),
      entradaDoRobo(NUNCA_LIDO),
      entradaDoRobo(ATRASADO),
      entradaDoRobo(null),
      entradaDoRobo(null, null),
      entradaDoSeed("7d"),
      entradaDoSeed("30d"),
      entradaDoSeed("all"),
    ]) {
      processo(e);
    }
  });

  it("contado à mão: cada pessoa trava numa junta só, e todo lead de P' sem reunião começa numa cadeia só (K1, F3-D31)", () => {
    const { leads, eventos } = fixtureF();
    const e = entradaEm({ leads, eventos, range: DESDE_20, agora: AGORA, hoje: HOJE, robo: ROBO });
    const p = processo(e);
    expect(p.comRobo).toBe(true);
    expect(p.fora).toEqual({ antes: 1, semTelefone: 1, live: 1, recentes: 1, depoisDaLeitura: 0, reabertosNoPainel: 1 });
    expect(p.foraDasJuntas).toEqual({ testes: 0, duplicados: 0, live: 1, antes: 1 });
    expect(junta(p, "robo-falou")).toMatchObject({ entradas: 1, passaram: 1, outroCaminho: 0, emAndamento: 0, travados: 0 });
    expect(junta(p, "respondeu")).toMatchObject({ entradas: 1, passaram: 0, outroCaminho: 0, emAndamento: 0, travados: 1, abertos: 1, encerrados: 0, destino: "resgate" });
    expect(junta(p, "aceitou")).toMatchObject({ entradas: 0, travados: 0 });
    expect(junta(p, "agendou-apos-aceite")).toMatchObject({ entradas: 0, travados: 0 });
    // semtel e reabpainel travam (no Resgate, fora do prazo); o recente ainda corre.
    expect(junta(p, "fora-agendou")).toMatchObject({ entradas: 3, passaram: 0, outroCaminho: 0, emAndamento: 1, travados: 2, abertos: 2, encerrados: 0, destino: "resgate" });
    expect(junta(p, "realizou")).toMatchObject({ entradas: 0, travados: 0 });
    expect(junta(p, "fechou")).toMatchObject({ entradas: 0, travados: 0 });
    // Três pessoas travadas, três travas: ninguém em duas juntas.
    expect(soma(p.juntas.map((j) => j.travados))).toBe(3);
    // 1 (cadeia do robô) + 3 (fora do robô) + 1 (live) + 1 (antes, fora da Fila) = os 6 de P'.
    expect(populacaoDasJuntas(e)).toHaveLength(6);
    // `idsDoTrechoDoRobo`: a MESMA classificação de "Com o robô" (só servidor; nunca no objeto).
    expect(idsDoTrechoDoRobo(e)).toEqual(new Set(["f-semresposta"]));
    expect(idsDoTrechoDoRobo(e).size).toBe(degrau(p, "com-robo")?.n);
    expect(JSON.stringify(p)).not.toContain("f-semresposta");
  });

  it("teste e cópia de duplicado ficam nos degraus e fora de toda junta (K5)", () => {
    const { leads, eventos } = fixtureF();
    const semResposta = leads.find((l) => l.id === "f-semresposta")!;
    const comLimpeza = [
      ...leads,
      // Um teste do time (e-mail de teste) que travaria em `respondeu`.
      lead("f-teste", { ...saudado(ONTEM), email: "teste@teste.com" }),
      // A mesma pessoa de f-semresposta (mesmo telefone), cadastrada depois: a cópia.
      lead("f-copia", { ...saudado(ONTEM), createdAt: brt(ONTEM, "10:00"), phone: semResposta.phone }),
    ];
    const antes = processo(entradaEm({ leads, eventos, range: DESDE_20, agora: AGORA, hoje: HOJE, robo: ROBO }));
    const e = entradaEm({ leads: comLimpeza, eventos, range: DESDE_20, agora: AGORA, hoje: HOJE, robo: ROBO });
    const p = processo(e);
    expect(p.foraDasJuntas).toEqual({ testes: 1, duplicados: 1, live: 1, antes: 1 });
    // As juntas não mudam: nem o teste nem a cópia viraram "parados".
    expect(p.juntas).toEqual(antes.juntas);
    // Os degraus contam todo mundo (Leads = kpis.leads, como o cartão).
    expect(p.leads).toBe(antes.leads + 2);
    expect(degrau(p, "com-robo")?.n).toBe(3);
    expect(idsDoTrechoDoRobo(e)).toEqual(new Set(["f-semresposta", "f-teste", "f-copia"]));
  });

  it("a pessoa com dois cadastros: a Fila fica com o item de UM (a cópia, no empate); o principal herda o item pelo telefone e trava como a Fila diz", () => {
    // Robô desligado: 3 pessoas, 2 cadastros cada, "Novo" desde 29/10 (fora do prazo).
    const leads: Lead[] = [];
    for (const i of [0, 1, 2]) {
      const principal = lead(`dup-p${i}`, { createdAt: brt("2026-10-29", "10:00") });
      // A cópia: o mesmo telefone, cadastrada depois — e listada antes (o store ordena do mais novo).
      leads.push(lead(`dup-c${i}`, { createdAt: brt("2026-10-29", "11:00"), phone: principal.phone }), principal);
    }
    const e = entradaEm({ leads, range: SEMANA, agora: AGORA, hoje: HOJE });
    const fila = montarFila({ nowIso: AGORA, leads: e.data.leads, eventos: [], robo: undefined });
    // A precondição: a Fila guardou o `leadId` das cópias (fora de P').
    expect(fila.itens.map((i) => i.leadId).sort()).toEqual(["dup-c0", "dup-c1", "dup-c2"]);
    expect(fila.itens.every((i) => i.etapa === "novo" && i.atraso > 1)).toBe(true);
    const p = processo(e);
    expect(p.foraDasJuntas.duplicados).toBe(3);
    expect(junta(p, "agendou")).toMatchObject({ entradas: 3, passaram: 0, emAndamento: 0, travados: 3, abertos: 3, destino: "novo" });
    // Com o principal listado antes (a Fila fica com ele), a mesma resposta.
    const invertido = processo(entradaEm({ leads: [...leads].reverse(), range: SEMANA, agora: AGORA, hoje: HOJE }));
    expect(invertido.juntas).toEqual(p.juntas);
  });

  it("Campanha com perdas de antes de 29/10: fora de toda junta (`foraDasJuntas.antes`); o 'antes' no Resgate e atrasado trava em `fora-agendou` (F3-D31)", () => {
    const perdasAntes = [
      lead("pa-1", { createdAt: brt("2026-10-15", "10:00"), status: "sem_interesse", lostAt: brt("2026-10-16", "10:00") }),
      lead("pa-2", { createdAt: brt("2026-10-16", "10:00"), status: "sem_resposta", lostAt: brt("2026-10-18", "10:00") }),
      lead("pa-3", { createdAt: brt("2026-10-17", "10:00"), status: "contato_invalido", lostReasonDetail: "numero_inexistente", lostAt: brt("2026-10-17", "12:00") }),
    ];
    // Era trabalhado antes do robô: a última tentativa foi segunda (02/11); o retorno venceu terça 10:00.
    const retorno = lead("pa-retorno", { createdAt: brt("2026-10-22", "10:00"), status: "em_contato", firstContactAt: brt("2026-10-22", "10:30") });
    const eventos = [tentativa("pa-retorno", brt("2026-10-22", "10:30")), tentativa("pa-retorno", brt("2026-11-02", "10:00"))];
    const p0 = processo(entradaDoRobo(ROBO, null));
    const e = entradaDoRobo(ROBO, null, { leads: [...LEADS_DO_ROBO, ...perdasAntes, retorno], eventos });
    const p = processo(e);
    // O retorno está no Resgate, fora do prazo (o fixture vale o que diz).
    const item = montarFila({ nowIso: AGORA, leads: e.data.leads, eventos, robo: ROBO }).itens.find((i) => i.leadId === "pa-retorno");
    expect(item?.etapa).toBe("resgate");
    expect(item!.atraso).toBeGreaterThan(1);
    // O "antes" do LEADS_DO_ROBO (sem Fila) + as 3 perdas de antes do robô: nenhuma em junta.
    expect(p0.foraDasJuntas.antes).toBe(1);
    expect(p.foraDasJuntas.antes).toBe(p0.foraDasJuntas.antes + 3);
    const f0 = junta(p0, "fora-agendou");
    const f = junta(p, "fora-agendou");
    expect(f).toMatchObject({
      entradas: f0.entradas + 1,
      passaram: f0.passaram,
      outroCaminho: f0.outroCaminho,
      emAndamento: f0.emAndamento,
      travados: f0.travados + 1,
      abertos: f0.abertos + 1,
      encerrados: f0.encerrados,
      destino: "resgate",
    });
    // As perdas de antes do robô não viraram trava em lugar nenhum.
    for (const id of ["robo-falou", "respondeu", "aceitou", "agendou-apos-aceite", "realizou", "fechou"] as const) {
      expect(junta(p, id), id).toEqual(junta(p0, id));
    }
    expect(p.leads).toBe(p0.leads + 4);
  });
});

// ---------------------------------------------------------------- 5. Confirmaram (K2)

describe("5 · Confirmaram: confirmação REGISTRADA, linha lateral sobre Agendaram (K2)", () => {
  // Robô desligado; todas as reuniões a partir de 04/11 (o painel registra a confirmação desde então).
  const leads = () => [
    // Confirmou e depois remarcou: a remarcação limpou `reuniaoConfirmadaEm`, o evento `ficha` ficou.
    lead("c-remarcou", { createdAt: brt("2026-11-01", "10:00"), status: "agendado", bookedAt: brt("2026-11-02", "10:00"), meetingFor: brt("2026-11-06", "10:00") }),
    lead("c-confirmou", {
      createdAt: brt("2026-11-01", "11:00"),
      status: "agendado",
      bookedAt: brt("2026-11-02", "11:00"),
      meetingFor: brt("2026-11-07", "10:00"),
      reuniaoConfirmadaEm: brt(ONTEM, "10:00"),
    }),
    // Realizada sem confirmação registrada: NÃO conta (Confirmaram é registro).
    lead("c-realizou", {
      createdAt: brt("2026-11-01", "12:00"),
      status: "reuniao_realizada",
      bookedAt: brt("2026-11-02", "12:00"),
      meetingFor: brt(HOJE, "10:00"),
      attendedAt: brt(HOJE, "11:00"),
    }),
    lead("c-nada", { createdAt: brt("2026-11-01", "13:00"), status: "agendado", bookedAt: brt("2026-11-02", "13:00"), meetingFor: brt("2026-11-05", "10:00") }),
  ];
  const eventos = [confirmouReuniao("c-remarcou", brt(ONTEM, "09:00"))];

  it("o dia em que o registro começou é 04/11", () => {
    expect(CONFIRMACAO_DESDE).toBe("2026-11-04");
  });

  it("só reuniões depois de 04/11: conta o registro (campo ou evento), sem o 'ou realizou', com a taxa sobre Agendaram", () => {
    const e = entradaEm({ leads: leads(), eventos, range: SEMANA, agora: AGORA, hoje: HOJE });
    const p = processo(e);
    expect(degrau(p, "agendaram")?.n).toBe(4);
    expect(degrau(p, "confirmaram")).toMatchObject({ n: 2, texto: "2", piso: false, taxa: 0.5, semTaxa: null, base: "agendaram", recuo: true });
    expect(p.realizadasSemConfirmacao).toBe(1);
    expect(degrau(p, "realizadas")).toMatchObject({ n: 1, base: "agendaram", taxa: 0.25 });
    expect(degrau(p, "realizadas")?.taxa).toBe(e.kpis.overview.showRate);
  });

  it("com uma reunião de antes de 04/11 no período: '≥ N', sem taxa, `registro-parcial`", () => {
    const antiga = lead("c-antiga", { createdAt: brt("2026-11-01", "09:00"), status: "agendado", bookedAt: brt("2026-11-02", "09:00"), meetingFor: brt(ONTEM, "10:00") });
    const p = processo(entradaEm({ leads: [...leads(), antiga], eventos, range: SEMANA, agora: AGORA, hoje: HOJE }));
    expect(degrau(p, "agendaram")?.n).toBe(5);
    expect(degrau(p, "confirmaram")).toMatchObject({ n: 2, texto: "≥ 2", piso: true, taxa: null, semTaxa: "registro-parcial" });
    // O piso é do registro da confirmação: Agendaram e Reuniões realizadas não mudam de natureza.
    expect(degrau(p, "agendaram")?.piso).toBe(false);
    expect(degrau(p, "realizadas")?.piso).toBe(false);
  });
});

// ---------------------------------------------------------------- 6. a ponte (K10)

describe("6 · a ponte 'N pelo convite do robô, de M que aceitaram' (K10)", () => {
  const pelo = () => lead("pt-convite", { ...aceitouAs("2026-11-02", "10:00"), status: "agendado", bookedAt: brt("2026-11-02", "15:00"), meetingFor: brt("2026-11-06", "10:00") });
  // Aceitou, agendou e desistiu: não é Agendaram (isBooked) nem ponte — "outro caminho" no aceite, trava encerrado em `realizou`.
  const desistiu = () => lead("pt-desistiu", { ...aceitouAs(ONTEM, "10:00"), status: "desistencia", bookedAt: brt(ONTEM, "15:00"), lostAt: brt(HOJE, "10:00") });
  // Reaberto pela página: a reunião (31/10) é do episódio antigo; o aceite (ontem) é do novo.
  const reaberta = () =>
    lead("pt-reaberto", { ...aceitouAs(ONTEM, "10:00"), createdAt: brt("2026-10-30", "09:00"), bookedAt: brt("2026-10-31", "10:00"), meetingFor: brt("2026-11-01", "10:00") });
  const soAceitou = () => lead("pt-aceitou", aceitouAs(HOJE, "10:00"));
  const eventos = [reaberto("pt-reaberto", brt(ONTEM, "09:00"), ATOR_LP)];

  it("peloConvite usa isBooked e o agendamento DEPOIS do aceite: o anterior ao aceite e o desistente não contam", () => {
    const e = entradaEm({ leads: [pelo(), desistiu(), reaberta(), soAceitou()], eventos, range: SEMANA, agora: AGORA, hoje: HOJE, robo: ROBO });
    const p = processo(e);
    expect(degrau(p, "aceitaram")?.n).toBe(4);
    expect(p.ponte).toEqual({ aceitaram: 4, peloConvite: 1, texto: "1 pelo convite do robô, de 4 que aceitaram" });
    // Agendaram (isBooked): o do convite e o reaberto (a reunião existiu); o desistente fica no ⓘ.
    expect(degrau(p, "agendaram")?.n).toBe(2);
    expect(p.ponte!.peloConvite).toBeLessThanOrEqual(degrau(p, "agendaram")!.n);
    expect(p.desistiram).toBe(1);
    // A junta do aceite: 1 passou, o desistente é outro caminho, o reaberto e o de hoje travam (> 2 h úteis).
    expect(junta(p, "agendou-apos-aceite")).toMatchObject({ entradas: 4, passaram: 1, outroCaminho: 1, emAndamento: 0, travados: 2, abertos: 2, encerrados: 0, destino: "convite-aceito" });
    // `realizou`: quem chegou a agendar NESTE episódio — o desistente trava encerrado; o reaberto não entra.
    expect(junta(p, "realizou")).toMatchObject({ entradas: 2, passaram: 0, emAndamento: 1, travados: 1, abertos: 0, encerrados: 1 });
  });

  it("sem aceite no período, sem ponte; sem o trecho do robô, sem ponte", () => {
    expect(processo(entradaDoRobo(ROBO, SEMANA, { leads: [lead("x", saudado(ONTEM))] })).ponte).toBeNull();
    expect(processo(entradaEm({ leads: [pelo()], range: SEMANA, agora: AGORA, hoje: HOJE })).ponte).toBeNull();
  });
});

// ---------------------------------------------------------------- 7. casos de borda

describe("7 · casos de borda", () => {
  it("desligado: `ligado: false` é o mesmo que sem o robô — o funil do painel", () => {
    const e = entradaDoRobo(null);
    const sem = processo(e);
    const desligado = processo({ ...e, robo: { ...ROBO, ligado: false } });
    expect(desligado).toEqual(sem);
    expect(sem).toMatchObject({ comRobo: false, parada: false, leituraParada: null, noRobo: 0, ponte: null });
    expect(Object.values(sem.fora).every((n) => n === 0)).toBe(true);
  });

  it("todo antes de 29/10 (o período, ou a campanha só com leads de antes): o funil do painel, `fora` zerado", () => {
    for (const e of [
      entradaDoRobo(ROBO, { from: "2026-10-20", to: "2026-10-28" }, { leads: [...LEADS_DO_ROBO, ...LEADS_DA_ANTERIOR], adDaily: [...ADS_DA_ANTERIOR, ...ADS_DA_SEMANA] }),
      entradaDoRobo(ROBO, null, { leads: LEADS_DA_ANTERIOR, adDaily: ADS_DA_ANTERIOR }),
    ]) {
      const p = processo(e);
      expect(p.comRobo).toBe(false);
      expect(p.noRobo).toBe(0);
      expect(Object.values(p.fora).every((n) => n === 0)).toBe(true);
      expect(p.leads).toBeGreaterThan(0);
    }
  });

  it("período que ainda não começou: tudo 0, sem taxa", () => {
    const p = processo(entradaDoRobo(ROBO, { from: "2026-11-20", to: "2026-11-20" }));
    expect(p.leads).toBe(0);
    for (const d of p.degraus) {
      expect(d.n, d.id).toBe(0);
      expect(d.taxa, d.id).toBeNull();
      expect(d.daAncora, d.id).toBeNull();
    }
    for (const j of p.juntas) expect([j.entradas, j.travados], j.id).toEqual([0, 0]);
    expect(p.ponte).toBeNull();
  });

  it("leitura parada: os degraus do robô em '≥ N', sem taxa; a linha de uma frase é a do Início", () => {
    for (const [robo, texto] of [
      [PARADO, "Robô sem leitura desde 04/11 12:30 ⚠"],
      [ATRASADO, "Robô sem leitura desde 04/11 13:30 ⚠"],
      [NUNCA_LIDO, "Robô ainda não lido ⚠"],
    ] as const) {
      const e = entradaDoRobo(robo);
      const p = processo(e);
      expect(p.parada).toBe(true);
      expect(p.leituraParada?.texto).toBe(texto);
      expect(p.leituraParada).toEqual(montarInicio(e).atendimento.leituraParada);
      expect(linhaDaLeituraParada(robo, AGORA)).toEqual(p.leituraParada);
      for (const id of ["com-robo", "primeira-msg", "responderam", "aceitaram"] as const) {
        const d = degrau(p, id)!;
        expect(d.piso, id).toBe(true);
        expect(d.texto.startsWith("≥ "), id).toBe(true);
        expect(d.taxa, id).toBeNull();
      }
      for (const id of ["primeira-msg", "responderam", "aceitaram"] as const) expect(degrau(p, id)?.semTaxa, id).toBe("leitura-parada");
    }
    // Em dia, desligado ou sem o robô: nenhuma linha.
    expect(linhaDaLeituraParada(ROBO, AGORA)).toBeNull();
    expect(linhaDaLeituraParada(undefined, AGORA)).toBeNull();
    expect(linhaDaLeituraParada({ ...PARADO, ligado: false }, AGORA)).toBeNull();
    expect(processo(entradaDoRobo()).leituraParada).toBeNull();
  });

  it("uma semana só de inscritos da live: 'Com o robô' = 0 e o trecho fica; nenhuma junta os julga (F3-D1)", () => {
    const inscritos = (["A", "B", "C", "A"] as const).map((classe, i) => lead(`insc-${i}`, { createdAt: brt(ONTEM, `1${i}:00`), classe, bem: "imovel" }));
    const p = processo(entradaDoRobo(ROBO, SEMANA, { leads: inscritos }));
    expect(p.comRobo).toBe(true);
    expect(p.noRobo).toBe(0);
    expect(p.fora.live).toBe(4);
    expect(p.foraDasJuntas.live).toBe(4);
    expect(junta(p, "robo-falou").entradas).toBe(0);
    expect(junta(p, "fora-agendou").entradas).toBe(0);
  });

  it("legado com a reunião realizada e sem o agendamento: Reuniões realizadas sem taxa (`nao-aninhada`), também no Início (F3-D10)", () => {
    const legado = [
      ...[0, 1, 2].map((i) => lead(`lg-ag-${i}`, { createdAt: brt("2026-10-30", "10:00"), status: "agendado", bookedAt: brt("2026-10-30", "15:00"), meetingFor: brt("2026-11-10", "10:00") })),
      ...[0, 1, 2, 3].map((i) =>
        lead(`lg-real-${i}`, { createdAt: brt("2026-10-30", "10:00"), status: "sem_interesse", attendedAt: brt("2026-10-31", "10:00"), lostAt: brt("2026-11-01", "10:00") }),
      ),
    ];
    const e = entradaEm({ leads: legado, range: SEMANA, agora: AGORA, hoje: HOJE });
    const p = processo(e);
    expect(degrau(p, "agendaram")?.n).toBe(3);
    expect(degrau(p, "realizadas")).toMatchObject({ n: 4, taxa: null, semTaxa: "nao-aninhada" });
    expect(funilDoAtendimento(e).degraus.find((d) => d.id === "realizadas")?.taxa).toBeNull();
  });

  it("reaberto pela página com reunião antiga e aceite novo (K21): não é outro caminho; trava no aceite, com destino `convite-aceito`, e não entra em `realizou`", () => {
    const reaberta = lead("k21", { ...aceitouAs(ONTEM, "10:00"), createdAt: brt("2026-10-30", "09:00"), bookedAt: brt("2026-10-31", "10:00"), meetingFor: brt("2026-11-01", "10:00") });
    const e = entradaEm({ leads: [reaberta], eventos: [reaberto("k21", brt(ONTEM, "09:00"), ATOR_LP)], range: SEMANA, agora: AGORA, hoje: HOJE, robo: ROBO });
    const p = processo(e);
    expect(degrau(p, "aceitaram")?.n).toBe(1);
    // A reunião existiu (o degrau é o fato, de qualquer episódio)...
    expect(degrau(p, "agendaram")?.n).toBe(1);
    // ...mas não responde pelo aceite novo.
    expect(junta(p, "agendou-apos-aceite")).toMatchObject({ entradas: 1, passaram: 0, outroCaminho: 0, emAndamento: 0, travados: 1, abertos: 1, destino: "convite-aceito" });
    expect(junta(p, "realizou").entradas).toBe(0);
  });

  it("reaberto que agenda DE NOVO (K21): o marco antigo não é regravado, mas a mudança de status depois do reaberto é deste episódio — passa no aceite, entra na ponte e em `realizou`", () => {
    const reagendou = () =>
      lead("k21-de-novo", {
        ...aceitouAs("2026-11-02", "10:00"),
        createdAt: brt("2026-10-29", "10:00"),
        status: "agendado",
        // O marco do episódio antigo: gravado UMA vez (`??=`), nunca regravado pela reunião nova.
        bookedAt: brt("2026-10-31", "10:00"),
        meetingFor: brt("2026-11-06", "10:00"),
      });
    const reab = reaberto("k21-de-novo", brt("2026-11-02", "09:00"), ATOR_LP);
    const agendouDeNovo = mudouStatus("k21-de-novo", brt("2026-11-02", "15:00"), "agendado", "ana", "lead");
    const p = processo(entradaEm({ leads: [reagendou()], eventos: [reab, agendouDeNovo], range: SEMANA, agora: AGORA, hoje: HOJE, robo: ROBO }));
    expect(degrau(p, "agendaram")?.n).toBe(1);
    expect(junta(p, "agendou-apos-aceite")).toMatchObject({ entradas: 1, passaram: 1, outroCaminho: 0, travados: 0 });
    expect(p.ponte).toMatchObject({ aceitaram: 1, peloConvite: 1 });
    // A reunião nova (06/11) ainda não aconteceu: no prazo em `realizou`.
    expect(junta(p, "realizou")).toMatchObject({ entradas: 1, passaram: 0, emAndamento: 1, travados: 0 });
    // Sem a mudança registrada, o status basta para saber que agendou NESTE episódio (a hora,
    // não: fica a do reaberto) — "outro caminho" no aceite, nunca travado; e entra em `realizou`.
    const soStatus = processo(entradaEm({ leads: [reagendou()], eventos: [reab], range: SEMANA, agora: AGORA, hoje: HOJE, robo: ROBO }));
    expect(junta(soStatus, "agendou-apos-aceite")).toMatchObject({ entradas: 1, passaram: 0, outroCaminho: 1, travados: 0 });
    expect(soStatus.ponte).toMatchObject({ aceitaram: 1, peloConvite: 0 });
    expect(junta(soStatus, "realizou")).toMatchObject({ entradas: 1, travados: 0 });
  });

  it("reaberto no painel sem fala nova: fora do robô (`reabertosNoPainel`), julgado em `fora-agendou`", () => {
    const { leads, eventos } = fixtureF();
    const p = processo(entradaEm({ leads: leads.filter((l) => l.id === "f-reabpainel"), eventos, range: SEMANA, agora: AGORA, hoje: HOJE, robo: ROBO }));
    expect(p.fora.reabertosNoPainel).toBe(1);
    expect(p.noRobo).toBe(0);
    expect(junta(p, "fora-agendou")).toMatchObject({ entradas: 1, travados: 1, destino: "resgate" });
  });

  describe("o dia do lead é o de Brasília (K19 — era `fase2-dia-do-lead` 236–257)", () => {
    // 28/10 às 22:30 em Brasília = 29/10 01:30 em UTC: o dia é 28 (antes do robô).
    const noite = () => lead("noite-28", { createdAt: brt("2026-10-28", "22:30") });
    const dia29 = () => lead("dia-29", { createdAt: brt("2026-10-29", "10:00") });

    it("o lead de 28/10 22:30 está em P de 28/10, e o funil é o do painel (o período todo antes do robô)", () => {
      const e = entradaEm({ leads: [noite(), dia29()], range: { from: "2026-10-28", to: "2026-10-28" }, agora: AGORA, hoje: HOJE, robo: ROBO });
      const p = processo(e);
      expect(p.leads).toBe(1);
      expect(p.comRobo).toBe(false);
    });

    it("de 28/10 a 29/10, ele é `fora.antes` (o dia de Brasília, não o de UTC)", () => {
      const p = processo(entradaEm({ leads: [noite(), dia29()], range: { from: "2026-10-28", to: "2026-10-29" }, agora: AGORA, hoje: HOJE, robo: ROBO }));
      expect(p.leads).toBe(2);
      expect(p.comRobo).toBe(true);
      expect(p.fora.antes).toBe(1);
    });

    it("o lead de 08/10 às 22:00 conta em P de 08/10, não de 09/10", () => {
      const l = lead("noite-08", { createdAt: brt("2026-10-08", "22:00") });
      const de = (dia: string) => processo(entradaEm({ leads: [l], range: { from: dia, to: dia }, agora: AGORA, hoje: HOJE })).leads;
      expect(de("2026-10-08")).toBe(1);
      expect(de("2026-10-09")).toBe(0);
    });
  });
});

// ---------------------------------------------------------------- 8. LGPD

describe("8 · LGPD: o objeto só tem contagens e textos", () => {
  it("nenhum id, nome, telefone ou e-mail dos fixtures no JSON", () => {
    const { leads, eventos } = fixtureF();
    // Ids que não colidem com palavra nenhuma da tela.
    const unicos: Lead[] = [
      ...leads,
      lead("idq-01-zz9", aceitouAs(ONTEM, "10:00")),
      lead("idq-02-zz9", { ...aceitouAs("2026-11-02", "10:00"), status: "cliente", bookedAt: brt("2026-11-02", "15:00"), attendedAt: brt(ONTEM, "10:00"), closedAt: brt(HOJE, "10:00"), value: 90_000 }),
      lead("idq-03-zz9", { ...conversouOntem(), roboEtapa: "frio", roboEncerradoEm: brt(ONTEM, "12:00") }),
    ];
    for (const e of [
      entradaEm({ leads: unicos, eventos, range: DESDE_20, agora: AGORA, hoje: HOJE, robo: ROBO }),
      entradaEm({ leads: unicos, eventos, range: DESDE_20, agora: AGORA, hoje: HOJE, robo: PARADO }),
      entradaEm({ leads: unicos, eventos, range: DESDE_20, agora: AGORA, hoje: HOJE }),
      entradaDoRobo(),
      entradaDoRobo(ROBO, null),
    ]) {
      const json = JSON.stringify(funilDoProcesso(e)).toLowerCase();
      for (const l of e.data.leads) {
        expect(json.includes(l.name.toLowerCase()), l.name).toBe(false);
        if (l.email) expect(json.includes(l.email.toLowerCase()), l.email).toBe(false);
        if (l.phone) {
          expect(json.includes(l.phone), l.phone).toBe(false);
          expect(json.includes(l.phone.replace(/\D/g, "").slice(-8)), l.phone).toBe(false);
        }
        if (l.id.startsWith("idq-")) expect(json.includes(l.id), l.id).toBe(false);
      }
      expect(/"(leadid|name|nome|phone|email|telefone)"/.test(json)).toBe(false);
    }
  });
});

function conversouOntem(): Partial<Lead> {
  return { ...saudado(ONTEM), roboRespondeuEm: brt(ONTEM, "09:10"), roboUltimaMsgClienteEm: brt(ONTEM, "09:10"), roboUltimaInteracaoEm: brt(ONTEM, "09:10"), roboEtapa: "em_conversa" };
}

// ---------------------------------------------------------------- 9. regra 11.7 nos kpis (K20)

describe("9 · a regra 11.7 nos kpis (K20, era `fase6-funil.test.ts:349`)", () => {
  it("quem o robô recebeu (`roboVistoEm`) sai da base do 1º contato no prazo", () => {
    const HOJE_O = "2026-10-08";
    const AGORA_O = "2026-10-08T15:00:00.000Z";
    const SEMANA_O = { from: "2026-10-02", to: "2026-10-08" };
    let n = 0;
    const l = (createdAt: string, extra: Partial<Lead> = {}): Lead => ({
      id: `R117-${++n}`,
      brand: "consorcio",
      createdAt: createdAt.length === 10 ? `${createdAt}T13:00:00.000Z` : createdAt,
      name: `Pessoa ${n}`,
      phone: `+55119${String(n).padStart(8, "0")}`,
      status: "lead",
      utmSource: "meta",
      utmContent: "Anúncio A|100001",
      ...extra,
    });
    const data: DashboardData = base({
      leads: [
        l("2026-09-10", { status: "agendado", bookedAt: "2026-10-05T12:00:00.000Z", meetingFor: "2026-10-20T12:00:00.000Z", firstContactAt: "2026-10-05T11:00:00.000Z" }),
        l("2026-09-11", { status: "reuniao_realizada", bookedAt: "2026-10-05T12:00:00.000Z", attendedAt: "2026-10-06T12:00:00.000Z" }),
        l("2026-09-12", { status: "cliente", bookedAt: "2026-10-05T12:00:00.000Z", attendedAt: "2026-10-06T12:00:00.000Z", closedAt: "2026-10-07T12:00:00.000Z", value: 50_000 }),
        ...Array.from({ length: 5 }, () => l("2026-10-05", { firstContactAt: "2026-10-05T13:30:00.000Z" })),
        l("2026-10-06", { status: "agendado", bookedAt: "2026-10-06T12:00:00.000Z", meetingFor: "2026-10-21T12:00:00.000Z" }),
      ],
    });
    let vistos = 0;
    const comRobo: DashboardData = {
      ...data,
      leads: data.leads.map((x) => (x.status === "lead" && vistos < 2 ? (vistos++, { ...x, roboVistoEm: "2026-10-05T13:10:00.000Z" }) : x)),
    };
    const kpis = (d: DashboardData) => kpisDoPeriodo(d, SEMANA_O, { hoje: HOJE_O, agora: AGORA_O, comparar: true });
    expect(vistos).toBe(2);
    expect(kpis(comRobo).primeiroContatoNoPrazo.n).toBe(kpis(data).primeiroContatoNoPrazo.n - 2);
  });
});

// ---------------------------------------------------------------- 10. textoDaTaxa (K31)

describe("10 · `textoDaTaxa`: o texto do % do Início e do Funil (K31)", () => {
  it("de Leads para baixo, sem casa; no topo, uma casa abaixo de 10%", () => {
    expect(textoDaTaxa(0.083)).toBe("8%");
    expect(textoDaTaxa(0.013, { topo: true })).toBe("1,3%");
    expect(textoDaTaxa(0.25, { topo: true })).toBe("25%");
    expect(textoDaTaxa(0.625)).toBe(formatPercent(0.625, 0));
  });

  it("entre 0 e 0,5% não vira '0%' (o mesmo pixel de 'ninguém'): '< 1%'", () => {
    expect(textoDaTaxa(1 / 250)).toBe("< 1%");
    expect(textoDaTaxa(0.004)).toBe("< 1%");
    expect(textoDaTaxa(0.0005)).toBe("< 1%");
    expect(textoDaTaxa(0.005)).toBe("1%");
    expect(textoDaTaxa(0)).toBe("0%");
    // No topo há uma casa: a regra 7.2 do `formatPercent` já cobre.
    expect(textoDaTaxa(0.0005, { topo: true })).toBe("< 0,1%");
  });

  it("o ⓘ do 'Com o robô' no singular com 1 lead (K32)", () => {
    const fora = { antes: 0, semTelefone: 0, live: 0, recentes: 0, depoisDaLeitura: 0, reabertosNoPainel: 0 };
    expect(dicaDoRecorteDoRobo({ noRobo: 1, leads: 1, fora, parada: false })).toBe("1 do 1 lead passa pelo robô.");
    expect(dicaDoRecorteDoRobo({ noRobo: 1, leads: 1, fora, parada: true })).toBe("≥ 1 do 1 lead passa pelo robô.");
    expect(dicaDoRecorteDoRobo({ noRobo: 0, leads: 1, fora: { ...fora, live: 1 }, parada: false })).toBe("0 do 1 lead passam pelo robô; fora: 1 inscrito da live.");
    // O plural de sempre (o texto do golden do Início).
    expect(dicaDoRecorteDoRobo({ noRobo: 8, leads: 12, fora, parada: true })).toBe("≥ 8 dos 12 leads passam pelo robô.");
    expect(dicaDoRecorteDoRobo({ noRobo: 1, leads: 12, fora, parada: false })).toBe("1 dos 12 leads passa pelo robô.");
    const p = processo(entradaDoRobo(ROBO, SEMANA, { leads: [lead("so-um-robo", saudadoAs(HOJE, "12:00"))] }));
    expect(p.leads).toBe(1);
    expect(dicaDoRecorteDoRobo(p)).not.toContain("dos 1 leads");
  });

  it("o Início escreve o % dos degraus com ela (o HTML do golden não muda)", () => {
    for (const e of [entradaDoRobo(), entradaDoRobo(ROBO, null), entradaDoSeed("all")]) {
      for (const d of funilDoAtendimento(e).degraus) if (d.taxa != null) expect(textoDaTaxa(d.taxa)).toBe(formatPercent(d.taxa, 0));
    }
  });
});
