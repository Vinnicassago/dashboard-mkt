/**
 * Live 01/12 — etapas 6 e 9: a régua da live (Configurações) e o painel da live
 * (atalho Live 01/12 no Início). Fixture sintética: hoje é 24/11 (9 de 16 dias de captação).
 */
import { describe, expect, it } from "vitest";
import { LIVE_PADRAO, ehDoCarro, ehInscritoDaLive, lerCampanhaDaLive, linhaDaCampanha } from "../live";
import { montarPainelLive, relatoriosDaLive, resumoSemanalDaLive } from "../live-painel";
import { EXPEDIENTE_PADRAO } from "../turno";
import type { AdDaily, DashboardData, Lead, LeadEvent } from "../types";

const HOJE = "2026-11-24";
const AGORA = "2026-11-25T02:00:00.000Z"; // 24/11 23h em Brasília
const cfg = LIVE_PADRAO;

const ad = (date: string, campaign: string, adset: string, spend: number, adId = "1"): AdDaily => ({
  brand: "consorcio",
  date,
  campaign,
  adset,
  adId,
  spend,
  impressions: 1000,
  reach: 800,
  frequency: 1.2,
  clicks: 10,
  leads: 1,
});

let n = 0;
const lead = (extra: Partial<Lead>): Lead => {
  n += 1;
  return {
    id: `L${n}`,
    brand: "consorcio",
    createdAt: "2026-11-17T22:00:00.000Z", // ter 19h
    name: `Pessoa ${n}`,
    status: "lead",
    ...extra,
  };
};

function base(leads: Lead[], adDaily: AdDaily[]): DashboardData {
  return {
    campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-11-16", budgetTotal: 5000 },
    igAccountDaily: [],
    igPosts: [],
    adDaily,
    creatives: [],
    lpDaily: [],
    leads,
    goals: [],
    metas: [],
    updatedAt: AGORA,
  };
}

describe("régua da live (Configurações)", () => {
  it("sem nada salvo, o briefing; o que vier torto cai no briefing, campo a campo", () => {
    expect(lerCampanhaDaLive(null)).toMatchObject({ metas: { inscricoes: 200, qualificados: 80, agendadas: 15 } });
    const c = lerCampanhaDaLive({
      metas: { inscricoes: 250, qualificados: -1 },
      linhas: [{ id: "captacao", verba: 4500, campanhas: "[LV] Capt, 12345" }],
      periodo: { de: "2026-12-20", ate: "2026-12-01" },
    });
    expect(c.metas.inscricoes).toBe(250);
    expect(c.metas.qualificados).toBe(80);
    expect(c.linhas.find((l) => l.id === "captacao")).toMatchObject({ verba: 4500, campanhas: ["[LV] Capt", "12345"], porDia: 250 });
    expect(c.periodo).toEqual(LIVE_PADRAO.periodo); // de depois de até: inválido
  });

  it("linha da campanha pelo nome (tolerante) ou id; conjunto do carro; quem é inscrito", () => {
    expect(linhaDaCampanha({ campaign: "[live] captação - imóvel" }, cfg)?.id).toBe("captacao");
    expect(linhaDaCampanha({ campaign: "[LIVE] Remarketing 27/11" }, cfg)?.id).toBe("remarketing");
    expect(linhaDaCampanha({ campaign: "[BRN] Leads" }, cfg)).toBeUndefined();
    expect(ehDoCarro({ adset: "Carro - C9" }, cfg)).toBe(true);
    expect(ehInscritoDaLive(lead({ classe: "A" }), cfg)).toBe(true);
    expect(ehInscritoDaLive(lead({}), cfg)).toBe(false); // sem ficha: lead da campanha de sempre
    expect(ehInscritoDaLive(lead({ classe: "A", createdAt: "2026-11-10T12:00:00.000Z" }), cfg)).toBe(false); // antes da live
    const porUtm = { ...cfg, inscritos: { criterio: "utm" as const, utmCampaign: ["120200099"] } };
    expect(ehInscritoDaLive(lead({ utmCampaign: "120200099" }), porUtm)).toBe(true);
  });
});

describe("painel da live — metas, atendimento, verba, custos e qualidade", () => {
  const tentativa = (leadId: string, em: string, resultado: string): LeadEvent => ({
    id: `t-${leadId}`,
    leadId,
    leadName: "P",
    actor: "eduardo",
    action: "tentativa",
    payload: { canal: "ligacao", falou: resultado === "nao_atendeu" ? "nao" : "sim", resultado },
    occurredAt: em,
    createdAt: em,
  });
  const a1 = lead({ classe: "A", firstContactAt: "2026-11-17T22:30:00.000Z", status: "em_contato", msg1EnviadaEm: "2026-11-17T22:00:10.000Z", comunidadeEm: "2026-11-17T22:20:00.000Z", bem: "imovel", finalidade: "morar" });
  const a2 = lead({ classe: "A", status: "lead", msg1EnviadaEm: "2026-11-17T22:00:10.000Z", finalidade: "morar" }); // sem tentativa, prazo vencido
  const b1 = lead({ classe: "B", firstContactAt: "2026-11-18T00:30:00.000Z", status: "agendado", bookedAt: "2026-11-18T00:30:00.000Z", meetingFor: "2026-11-26T22:00:00.000Z", msg1Status: "falhou", bem: "carro", faixaParcela: "1500_3000", finalidade: "trocar_carro" });
  const c1 = lead({ classe: "C", bem: "carro", faixaParcela: "ate_1500", finalidade: "trocar_carro", diagnostico: { respostas: [{ resposta: "r" }] } });
  const x1 = lead({ classe: "X", finalidade: "quitar_dividas" });
  const fora = lead({}); // lead comum: fora da live
  const eventos = [tentativa(a1.id, "2026-11-17T22:30:00.000Z", "falou"), tentativa(b1.id, "2026-11-18T00:30:00.000Z", "agendou")];
  const ads = [
    ad("2026-11-16", "[LIVE] Captação", "Persona", 210, "11"),
    ad("2026-11-23", "[LIVE] Captação", "Persona", 205, "11"),
    ad("2026-11-23", "[LIVE] Captação", "Carro", 40, "19"),
    ad("2026-11-20", "[BRN] Leads", "Aberto", 500, "99"), // de outra campanha: não conta
  ];
  const cfgComManuais = { ...cfg, manuais: { presentesTotal: 12, presentesPico: 9, vendasQtd: 1, vendasValor: 250000 } };
  const p = montarPainelLive({
    data: base([a1, a2, b1, c1, x1, fora], ads),
    eventos,
    cfg: cfgComManuais,
    expediente: EXPEDIENTE_PADRAO,
    range: { de: cfg.periodo.de, ate: HOJE },
    hoje: HOJE,
    agora: AGORA,
  });

  it("metas × realizado, com o ritmo proporcional aos dias de captação", () => {
    expect(p.fracaoCaptacao).toBeCloseTo(9 / 16);
    const m = Object.fromEntries(p.metas.map((x) => [x.id, x]));
    expect(m.inscricoes).toMatchObject({ valor: 5, meta: 200, ritmo: "atras" });
    expect(m.inscricoes.esperado).toBeCloseTo(112.5, 0);
    expect(m.qualificados.valor).toBe(3);
    expect(m.comunidade.valor).toBe(1);
    expect(m.presentes).toMatchObject({ valor: 12, esperado: null });
    expect(m.agendadas.valor).toBe(1);
    expect(m.vendas.valor).toBe(1);
    expect(m.vendas.nota).toContain("R$");
  });

  it("atendimento: taxas com base honesta e o A sem tentativa", () => {
    const t = Object.fromEntries(p.atendimento.map((x) => [x.id, x]));
    expect(t.msg).toMatchObject({ n: 5 }); // falhou não conta como enviada
    expect(t.msg.valor).toBeCloseTo(2 / 5);
    expect(t.a1h).toMatchObject({ n: 2, valor: 0.5 }); // a1 no prazo; a2 vencido sem tentativa
    expect(t.bdia).toMatchObject({ n: 1, valor: 1 });
    expect(t.c48).toMatchObject({ n: 3 });
    expect(t.c48.valor).toBeCloseTo(2 / 3);
    expect(p.aSemTentativa).toBe(1);
    expect(p.reunioes.agendada).toBe(1);
  });

  it("verba: só as campanhas da live, do começo da linha até hoje; o carro a partir de 23/11", () => {
    const capt = p.verba.find((v) => v.id === "captacao")!;
    expect(capt.gasto).toBe(455);
    expect(capt.esperado).toBe(250 * 9);
    expect(capt.ritmo).toBe("atras");
    expect(p.semCampanhas).toBe(false);
    expect(p.dias).toHaveLength(9);
    expect(p.dias.find((d) => d.date === "2026-11-23")).toMatchObject({ gasto: 245, carro: { gasto: 40, alvo: 40 } });
    expect(p.dias.find((d) => d.date === "2026-11-22")?.carro).toBeUndefined();
  });

  it("custos: denominador zero é —, reunião abaixo da régua é fato", () => {
    expect(p.custos.porInscrito.valor).toBe(455 / 5);
    expect(p.custos.porQualificado.valor).toBeCloseTo(455 / 3);
    expect(p.custos.porQualificado.ok).toBe(false);
    expect(p.custos.porReuniao.valor).toBeNull();
    // (o real sai com espaço não separável, como em toda a tela)
    expect(p.custos.porReuniao.texto.replace(/ /g, " ")).toBe("R$ 455 investidos · 1 reunião");
  });

  it("qualidade: % quitar dívidas contra o teto; carro com parcela a partir de R$ 1.500", () => {
    const q = Object.fromEntries(p.qualidade.map((x) => [x.id, x]));
    expect(q.quitar.valor).toBeCloseTo(1 / 5);
    expect(q.quitar.ok).toBe(false); // 20% > 10%
    expect(q.carro1500).toMatchObject({ n: 2, valor: 0.5 });
  });

  it("o resumo para o ClickUp, no formato combinado", () => {
    expect(resumoSemanalDaLive(p, cfgComManuais, HOJE)).toBe(
      [
        "Semana até 24/11:",
        "Inscrições: 5 (meta 200) · Qualificados: 3 (meta 80) · Na comunidade: 1 (meta 140)",
        "Diagnósticos feitos: 1 · Reuniões agendadas: 1 (meta 15)",
        "Mensagem automática: 40% (meta 100%) · A em até 1 h útil: 50% (meta 90%) · Contato válido 48 h: 67% (meta 60%)",
        "Gasto: R$ 455 · Custo por qualificado: R$ 152 (meta até R$ 50)",
      ].join("\n"),
    );
  });

  it("os textos das tarefas (E3-07, E4-05, E5-08), com os números da aba", () => {
    const r = Object.fromEntries(relatoriosDaLive(p, cfgComManuais, HOJE).map((x) => [x.id, x.texto]));
    expect(r.semana).toBe(resumoSemanalDaLive(p, cfgComManuais, HOJE));
    expect(r.atendimento).toBe(
      [
        "Semana até 24/11:",
        "Classe A: 2 inscritos · 1 chamado em até 1 h útil (50%, meta 90%)",
        "Classe B: 1 inscrito · 1 chamado no mesmo dia",
        "Contato válido em 48 h: 67% (meta 60%)",
        "Reuniões já agendadas: 1",
        "Problemas: 1 classe A sem tentativa com o prazo vencido",
      ].join("\n"),
    );
    expect(r.live).toBe(
      [
        "| Indicador | Resultado | Meta |",
        "| Inscritos | 5 | 200 |",
        "| Qualificados (A e B) | 3 | 80 |",
        "| Na comunidade | 1 | 140 |",
        "| Assistiram ao vivo (únicos) | 12 | 50 |",
        "| Pico simultâneo | 9 | — |",
        "| Reuniões marcadas até 24/11 | 1 | 15 |",
      ].join("\n"),
    );
    expect(r.pos_live).toBe(
      [
        "| Indicador | Resultado | Meta |",
        "| Inscrições | 5 | 200 |",
        "| Qualificados (A e B) | 3 | 80 |",
        "| Na comunidade | 1 | 140 |",
        "| Presentes ao vivo | 12 | 50 |",
        "| Reuniões agendadas | 1 | 15 |",
        "| Reuniões realizadas | 0 | 11 |",
        "| Vendas | 1 | — |",
        "| Gasto total | R$ 455 | R$ 5.000 |",
        "| Custo por inscrito | R$ 91 | R$ 20 |",
        "| Custo por reunião agendada | R$ 455 investidos · 1 reunião | — |",
        "",
        "Funcionou: __",
        "Não funcionou: __",
        "Até 15/12: __",
      ].join("\n"),
    );
  });

  it("o que o painel não sabe (presentes, vendas) fica __ para quem cola", () => {
    const semManuais = montarPainelLive({
      data: base([a1, a2, b1, c1, x1, fora], ads),
      eventos,
      cfg,
      expediente: EXPEDIENTE_PADRAO,
      range: { de: cfg.periodo.de, ate: HOJE },
      hoje: HOJE,
      agora: AGORA,
    });
    const r = Object.fromEntries(relatoriosDaLive(semManuais, cfg, HOJE).map((x) => [x.id, x.texto]));
    expect(r.live).toContain("| Assistiram ao vivo (únicos) | __ | 50 |");
    expect(r.live).toContain("| Pico simultâneo | __ | — |");
    expect(r.pos_live).toContain("| Vendas | __ | — |");
  });

  it("sem campanha da live no Gerenciador: custo é —, não R$ 0", () => {
    const vazio = montarPainelLive({
      data: base([a1], [ad("2026-11-20", "[BRN] Leads", "Aberto", 500)]),
      eventos: [],
      cfg,
      expediente: EXPEDIENTE_PADRAO,
      range: { de: cfg.periodo.de, ate: HOJE },
      hoje: HOJE,
      agora: AGORA,
    });
    expect(vazio.semCampanhas).toBe(true);
    expect(vazio.custos.porInscrito.valor).toBeNull();
    expect(vazio.custos.porInscrito.texto).toContain("sem gasto das campanhas da live");
  });
});
