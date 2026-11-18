/**
 * Depois da inscrição na live (nov/26): o clique em "Entrar na comunidade" e o
 * Diagnóstico do Próximo Patrimônio — as regras puras (`lib/diagnostico-live.ts`):
 * a chave do telefone, a ligação com o lead, "o último evento da tentativa vale",
 * a tentativa mais avançada, a validação dos eventos e as linhas de Leads.
 */
import { describe, expect, it } from "vitest";
import {
  aplicarCliqueComunidade,
  aplicarEventoDiagnostico,
  chegouAPergunta,
  cliquesPorLead,
  diagnosticoParaAFicha,
  diagnosticosSemInscricao,
  fichaAceitaDiagnosticoDaPagina,
  indiceDeEventIds,
  leadDoEventId,
  leadDoTelefone,
  lerEventoComunidade,
  lerEventoDiagnostico,
  ligarDiagnosticos,
  maisAvancada,
  resumoDepoisDaInscricao,
  situacaoDoDiagnostico,
  textoDoDiagnostico,
  textoDoRaioX,
} from "@/lib/diagnostico-live";
import { chaveDddMais8 } from "@/lib/phone";
import { LIVE_PADRAO } from "@/lib/live";
import {
  CSV_CABECALHO,
  FILTRO_VAZIO,
  aplicarFiltro,
  filtroDoPedido,
  montarCsvDeLeads,
  montarLinhasDeLeads,
} from "@/lib/leads-vista";
import { base } from "@/test/fixtures-robo";
import type { DiagnosticoTentativa, EventoDiagnostico, Lead, LeadEvent } from "@/lib/types";

const cfg = LIVE_PADRAO;

const lead = (id: string, over: Partial<Lead> = {}): Lead => ({
  id,
  brand: "consorcio",
  createdAt: "2026-11-17T13:00:00.000Z",
  name: `Pessoa ${id}`,
  phone: "5511987654321",
  status: "lead",
  ...over,
});

const resposta = (n: number, extra: Partial<{ acertou: boolean; resposta: string }> = {}) => ({
  n,
  pergunta: `Pergunta ${n}`,
  resposta: extra.resposta ?? `Resposta ${n}`,
  ...(extra.acertou === undefined ? {} : { acertou: extra.acertou }),
});

const ev = (over: Partial<EventoDiagnostico> = {}): EventoDiagnostico => ({
  tentativa: "t-1",
  etapa: "resposta",
  telefone: "5511987654321",
  respondidas: 1,
  total: 9,
  respostas: [resposta(1)],
  ...over,
});

/** Aplica eventos em sequência, com a hora de chegada de cada um. */
function aplicar(...eventos: [EventoDiagnostico, string][]): DiagnosticoTentativa {
  let t: DiagnosticoTentativa | undefined;
  for (const [e, em] of eventos) t = aplicarEventoDiagnostico(t, e, em);
  return t!;
}

const corpoValido = (over: Record<string, unknown> = {}) => ({
  type: "diagnostico",
  tentativa: "5d0c3c9e-1b7a-4c1e-9a51-2f0f4d3e8b10",
  etapa: "resposta",
  phone: "5511987654321",
  respondidas: 2,
  total: 9,
  respostas: [resposta(1), resposta(6, { acertou: true, resposta: "Falso" })],
  pageUrl: "https://diagnostico.exemplo/",
  ...over,
});

// ---------------------------------------------------------------- telefone

describe("chave do diagnóstico: DDD + 8 últimos dígitos", () => {
  it("com e sem 55, com e sem o nono dígito, com máscara: a mesma chave", () => {
    const k = "1187654321";
    for (const fone of [
      "5511987654321",
      "+55 (11) 98765-4321",
      "11987654321",
      "(11) 98765-4321",
      "551187654321",
      "1187654321",
      "011 98765-4321",
    ]) {
      expect(chaveDddMais8(fone), fone).toBe(k);
    }
  });

  it("só tira o 55 quando sobram mais de 11 dígitos (o DDD 55 fica)", () => {
    expect(chaveDddMais8("55987654321")).toBe("5587654321"); // DDD 55, 11 dígitos
    expect(chaveDddMais8("5555987654321")).toBe("5587654321"); // 55 + DDD 55
  });

  it("sem DDD, curto demais ou longo demais: sem chave (não liga a ninguém)", () => {
    for (const fone of ["987654321", "123", "", null, undefined, "55119876543210000"]) expect(chaveDddMais8(fone)).toBeNull();
  });

  it("números diferentes no mesmo DDD não se confundem", () => {
    expect(chaveDddMais8("11987654321")).not.toBe(chaveDddMais8("11987654322"));
    expect(chaveDddMais8("11987654321")).not.toBe(chaveDddMais8("21987654321"));
  });
});

// ---------------------------------------------------------------- o último evento vale

describe("tentativa: o último evento que chega vale", () => {
  it("a lista de respostas é a do último evento (a pessoa voltou e mudou a 1)", () => {
    const t = aplicar(
      [ev({ etapa: "inicio", respondidas: 0, respostas: [] }), "2026-11-20T22:00:00.000Z"],
      [ev({ respondidas: 2, respostas: [resposta(1), resposta(2)] }), "2026-11-20T22:01:00.000Z"],
      [ev({ respondidas: 2, respostas: [resposta(1, { resposta: "Mudei" }), resposta(2)] }), "2026-11-20T22:02:00.000Z"],
    );
    expect(t.respostas.map((r) => r.resposta)).toEqual(["Mudei", "Resposta 2"]);
    expect(t.respondidas).toBe(2);
    expect(t.etapa).toBe("resposta");
    expect(t.eventos).toBe(3);
    // o começo é o 1º evento; a última atividade, o último
    expect(t.iniciadoEm).toBe("2026-11-20T22:00:00.000Z");
    expect(t.atualizadoEm).toBe("2026-11-20T22:02:00.000Z");
    expect(situacaoDoDiagnostico(t)).toBe("parcial");
    expect(textoDoDiagnostico({ situacao: "parcial", respondidas: 2, total: 9, iniciadoEm: t.iniciadoEm, tentativas: 1 })).toBe(
      "Respondeu 2 de 9",
    );
  });

  it("concluir é fato: o beacon da 9ª resposta que chega DEPOIS do resultado não desfaz", () => {
    const nove = Array.from({ length: 9 }, (_, i) => resposta(i + 1));
    const t = aplicar(
      [ev({ respondidas: 8, respostas: nove.slice(0, 8) }), "2026-11-20T22:08:00.000Z"],
      [
        ev({
          etapa: "resultado",
          respondidas: 9,
          respostas: nove,
          perfil: "Construtor de patrimônio",
          notas: { reserva: 85, lance: 40, conhecimento: 65, plano: 30 },
          conquistas: 7,
          conquistasTotal: 12,
        }),
        "2026-11-20T22:09:00.000Z",
      ],
      [ev({ etapa: "resposta", respondidas: 9, respostas: nove }), "2026-11-20T22:09:01.000Z"],
    );
    expect(t.etapa).toBe("resposta"); // o último evento
    expect(t.concluidoEm).toBe("2026-11-20T22:09:00.000Z"); // o fato fica
    expect(situacaoDoDiagnostico(t)).toBe("concluiu");
    expect(t.perfil).toBe("Construtor de patrimônio"); // o resultado é o do último `resultado`
    expect(textoDoRaioX(t.notas)).toBe("Reserva 85 · Lance 40 · Conhecimento 65 · Plano 30");
    expect(t.conquistas).toBe(7);
  });

  it("um 2º resultado (refez o fim) troca o perfil e as notas, mas não o horário em que concluiu", () => {
    const t = aplicar(
      [ev({ etapa: "resultado", respondidas: 9, perfil: "A", notas: { reserva: 10 } }), "2026-11-20T22:00:00.000Z"],
      [ev({ etapa: "resultado", respondidas: 9, perfil: "B", notas: { reserva: 90 } }), "2026-11-20T22:05:00.000Z"],
    );
    expect(t.perfil).toBe("B");
    expect(t.notas).toEqual({ reserva: 90 });
    expect(t.concluidoEm).toBe("2026-11-20T22:00:00.000Z");
  });

  it("o clique: o 1º horário fica e o lead achado não se perde", () => {
    const a = aplicarCliqueComunidade(undefined, { eventId: "k3x9qa", em: "2026-11-20T10:00:00.000Z" });
    const b = aplicarCliqueComunidade(a, { eventId: "k3x9qa", leadId: "LEAD-LP-k3x9qa", em: "2026-11-20T10:05:00.000Z" });
    const c = aplicarCliqueComunidade(b, { eventId: "k3x9qa", em: "2026-11-20T10:09:00.000Z" });
    expect(c).toMatchObject({ primeiroEm: "2026-11-20T10:00:00.000Z", ultimoEm: "2026-11-20T10:09:00.000Z", cliques: 3, leadId: "LEAD-LP-k3x9qa" });
  });
});

// ---------------------------------------------------------------- várias tentativas

describe("a tentativa mais avançada", () => {
  const t = (id: string, atualizadoEm: string, concluidoEm?: string): DiagnosticoTentativa => ({
    tentativa: id,
    telefone: "5511987654321",
    chaveTelefone: "1187654321",
    etapa: concluidoEm ? "resultado" : "resposta",
    respondidas: concluidoEm ? 9 : 3,
    total: 9,
    respostas: [],
    iniciadoEm: atualizadoEm,
    atualizadoEm,
    eventos: 1,
    ...(concluidoEm ? { concluidoEm } : {}),
  });

  it("concluída vence incompleta, mesmo mais antiga", () => {
    expect(maisAvancada([t("nova-incompleta", "2026-11-21T10:00:00.000Z"), t("velha", "2026-11-20T10:00:00.000Z", "2026-11-20T10:00:00.000Z")])?.tentativa).toBe("velha");
  });
  it("entre iguais, a mais recente", () => {
    expect(maisAvancada([t("a", "2026-11-20T10:00:00.000Z"), t("b", "2026-11-21T10:00:00.000Z")])?.tentativa).toBe("b");
    expect(
      maisAvancada([
        t("a", "2026-11-20T10:00:00.000Z", "2026-11-20T10:00:00.000Z"),
        t("b", "2026-11-21T10:00:00.000Z", "2026-11-21T10:00:00.000Z"),
      ])?.tentativa,
    ).toBe("b");
  });
});

// ---------------------------------------------------------------- ligação com o lead

describe("ligação diagnóstico → lead pelo telefone", () => {
  const antigo = lead("LEAD-LP-antigo", { createdAt: "2026-10-01T13:00:00.000Z", phone: "11 8765-4321" }); // sem o 9, campanha anterior
  const daLive = lead("LEAD-LP-live", { createdAt: "2026-11-18T13:00:00.000Z", bem: "imovel", phone: "+55 11 98765-4321" });
  const daLiveMaisNova = lead("LEAD-LP-live2", { createdAt: "2026-11-19T13:00:00.000Z", bem: "imovel" });

  it("um lead só: casa com e sem o 9", () => {
    expect(leadDoTelefone("5511987654321", [antigo], cfg)?.id).toBe("LEAD-LP-antigo");
  });

  it("mais de um: o da campanha da live vence o antigo; entre os da live, o mais recente", () => {
    expect(leadDoTelefone("5511987654321", [antigo, daLive], cfg)?.id).toBe("LEAD-LP-live");
    expect(leadDoTelefone("5511987654321", [antigo, daLive, daLiveMaisNova], cfg)?.id).toBe("LEAD-LP-live2");
  });

  it("quem já era lead e se reinscreveu conta pela inscrição na live", () => {
    const reinscrito = { ...antigo, inscritoLiveEm: "2026-11-20T13:00:00.000Z", bem: "imovel" as const };
    expect(leadDoTelefone("5511987654321", [reinscrito, daLive], cfg)?.id).toBe("LEAD-LP-antigo");
  });

  it("excluído não recebe diagnóstico", () => {
    expect(leadDoTelefone("5511987654321", [{ ...daLive, deletedAt: "2026-11-19T00:00:00.000Z" }], cfg)).toBeUndefined();
  });

  it("sem lead do número: vai para 'sem inscrição', uma linha por pessoa, no período", () => {
    const tentativas = [
      aplicarEventoDiagnostico(undefined, ev({ tentativa: "x1", telefone: "5521999990000" }), "2026-11-20T22:00:00.000Z"),
      aplicarEventoDiagnostico(undefined, ev({ tentativa: "x2", telefone: "21 99999-0000", etapa: "resultado", perfil: "P" }), "2026-11-21T22:00:00.000Z"),
      aplicarEventoDiagnostico(undefined, ev({ tentativa: "y1" }), "2026-11-20T22:00:00.000Z"),
    ];
    const lig = ligarDiagnosticos(tentativas, [daLive], cfg);
    expect(lig.porLead.get("LEAD-LP-live")?.map((t) => t.tentativa)).toEqual(["y1"]);
    expect(lig.semInscricao).toHaveLength(1);
    const linhas = diagnosticosSemInscricao(tentativas, [daLive], cfg);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].resumo).toMatchObject({ situacao: "concluiu", perfil: "P", tentativas: 2 });
    // o período pelo dia de Brasília do começo da tentativa mais avançada (21/11 19h)
    expect(diagnosticosSemInscricao(tentativas, [daLive], cfg, { from: "2026-11-21", to: "2026-11-21" })).toHaveLength(1);
    expect(diagnosticosSemInscricao(tentativas, [daLive], cfg, { from: "2026-11-22", to: "2026-11-30" })).toHaveLength(0);
    // quando o lead aparece, o diagnóstico passa para ele
    const depois = ligarDiagnosticos(tentativas, [daLive, lead("LEAD-LP-rio", { phone: "5521999990000" })], cfg);
    expect(depois.semInscricao).toHaveLength(0);
    expect(depois.porLead.get("LEAD-LP-rio")).toHaveLength(2);
  });
});

describe("ligação clique → lead pelo eventId", () => {
  const evento = (leadId: string, action: LeadEvent["action"], payload: Record<string, string>, createdAt = "2026-11-20T10:00:00.000Z"): LeadEvent => ({
    id: `${leadId}-${action}-${createdAt}`,
    leadId,
    leadName: "x",
    actor: "Landing page",
    action,
    payload,
    createdAt,
  });

  it("lead novo: o id que o eventId gera", () => {
    const l = lead("LEAD-LP-k3x9qa");
    expect(leadDoEventId("k3x9qa", new Map([[l.id, l]]), new Map())?.id).toBe("LEAD-LP-k3x9qa");
  });

  it("quem já era lead: o reenvio caiu no cadastro antigo, e o eventId da entrada leva até ele", () => {
    const antigo = lead("LEAD-LP-antigo");
    const indice = indiceDeEventIds([evento("LEAD-LP-antigo", "reenvio", { eventId: "k3x9qa" })]);
    expect(leadDoEventId("k3x9qa", new Map([[antigo.id, antigo]]), indice)?.id).toBe("LEAD-LP-antigo");
  });

  it("cadastro mesclado: o clique vai ao principal", () => {
    const principal = lead("LEAD-LP-principal");
    const indice = indiceDeEventIds([
      evento("LEAD-LP-dup", "created", { eventId: "k3x9qa" }),
      evento("LEAD-LP-principal", "mesclado", { duplicado: "LEAD-LP-dup" }),
    ]);
    expect(leadDoEventId("k3x9qa", new Map([[principal.id, principal]]), indice)?.id).toBe("LEAD-LP-principal");
  });

  it("o clique que chegou antes do lead é ligado na leitura", () => {
    const l = lead("LEAD-LP-k3x9qa");
    const cliques = [{ eventId: "k3x9qa", primeiroEm: "2026-11-20T10:00:00.000Z", ultimoEm: "2026-11-20T10:00:00.000Z", cliques: 1 }];
    expect(cliquesPorLead(cliques, new Map([[l.id, l]]), new Map()).get(l.id)).toBe("2026-11-20T10:00:00.000Z");
  });
});

// ---------------------------------------------------------------- validação

describe("validação dos eventos novos: inválido = nada gravado", () => {
  it("o exemplo do briefing passa", () => {
    const r = lerEventoDiagnostico(corpoValido());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor).toMatchObject({ etapa: "resposta", respondidas: 2, telefone: "5511987654321" });
  });

  it("o resultado leva perfil, notas e conquistas; fora dele, são ignorados", () => {
    const res = lerEventoDiagnostico(
      corpoValido({ etapa: "resultado", perfil: "Construtor", notas: { reserva: 85, Lance: 40 }, conquistas: 7, conquistas_total: 12 }),
    );
    expect(res.ok && res.valor).toMatchObject({ perfil: "Construtor", notas: { reserva: 85, lance: 40 }, conquistas: 7, conquistasTotal: 12 });
    const meio = lerEventoDiagnostico(corpoValido({ perfil: "Construtor", notas: { reserva: 85 } }));
    expect(meio.ok && (meio.valor.perfil ?? meio.valor.notas)).toBeFalsy();
  });

  const invalidos: [string, Record<string, unknown>][] = [
    ["etapa fora dos três valores", { etapa: "fim" }],
    ["respondidas acima de 9", { respondidas: 10 }],
    ["respondidas negativa", { respondidas: -1 }],
    ["respondidas fracionária", { respondidas: 2.5 }],
    ["mais de 9 respostas", { respostas: Array.from({ length: 10 }, (_, i) => resposta((i % 9) + 1)) }],
    ["a mesma pergunta duas vezes", { respostas: [resposta(1), resposta(1)] }],
    ["número de pergunta fora de 1–9", { respostas: [resposta(10)] }],
    ["resposta com mais de 200 caracteres", { respostas: [{ n: 1, pergunta: "P", resposta: "x".repeat(201) }] }],
    ["pergunta com mais de 200 caracteres", { respostas: [{ n: 1, pergunta: "x".repeat(201), resposta: "R" }] }],
    ["acertou que não é booleano", { respostas: [{ n: 6, pergunta: "P", resposta: "Falso", acertou: "sim" }] }],
    ["perfil com mais de 200 caracteres", { etapa: "resultado", perfil: "x".repeat(201) }],
    ["nota acima de 100", { etapa: "resultado", notas: { reserva: 101 } }],
    ["nota negativa", { etapa: "resultado", notas: { lance: -1 } }],
    ["nota desconhecida", { etapa: "resultado", notas: { sorte: 50 } }],
    ["conquistas acima de 12", { etapa: "resultado", conquistas: 13 }],
    ["telefone sem DDD", { phone: "987654321" }],
    ["sem telefone", { phone: undefined }],
    ["sem tentativa", { tentativa: "" }],
    ["tentativa com caractere estranho", { tentativa: "abc def" }],
    ["respondidas maior que o total", { respondidas: 5, total: 4 }],
  ];
  it.each(invalidos)("%s → recusado", (_, over) => {
    const r = lerEventoDiagnostico(corpoValido(over));
    expect(r.ok).toBe(false);
  });

  it("o erro diz o campo, nunca o valor (pode ser PII)", () => {
    const r = lerEventoDiagnostico(corpoValido({ respostas: [{ n: 1, pergunta: "P", resposta: "segredo-".repeat(40) }], phone: "999" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.join(" ")).not.toMatch(/segredo|999/);
  });

  it("comunidade: precisa do eventId", () => {
    expect(lerEventoComunidade({ type: "comunidade", eventId: "k3x9qa" }).ok).toBe(true);
    expect(lerEventoComunidade({ type: "comunidade" }).ok).toBe(false);
    expect(lerEventoComunidade({ type: "comunidade", eventId: "x".repeat(201) }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------- a ficha e a tela de Leads

describe("o diagnóstico na ficha e na tela de Leads", () => {
  it("vai à ficha no formato do n8n, marcado como da página — e não apaga o do n8n", () => {
    const t = aplicarEventoDiagnostico(
      undefined,
      ev({ etapa: "resultado", respondidas: 2, respostas: [resposta(1), resposta(6, { acertou: false, resposta: "Verdadeiro" })], perfil: "P" }),
      "2026-11-20T22:00:00.000Z",
    );
    const d = diagnosticoParaAFicha(t);
    expect(d).toMatchObject({ origem: "pagina", perfil: "P", feitoEm: "2026-11-20T22:00:00.000Z" });
    expect(d.respostas[1]).toEqual({ pergunta: "6. Pergunta 6", resposta: "Verdadeiro (errou)" });
    expect(fichaAceitaDiagnosticoDaPagina(undefined)).toBe(true);
    expect(fichaAceitaDiagnosticoDaPagina(d)).toBe(true);
    expect(fichaAceitaDiagnosticoDaPagina({ respostas: [], perfil: "do n8n", alertas: ["reserva"] })).toBe(false);
  });

  // Três pessoas da live (concluiu, parou na 4ª, não começou) e uma da campanha antiga.
  const concluiu = lead("LEAD-LP-concluiu", { phone: "5511900000001", bem: "imovel", comunidadeEm: "2026-11-18T13:05:00.000Z" });
  const parou = lead("LEAD-LP-parou", { phone: "5511900000002", bem: "imovel" });
  const nada = lead("LEAD-LP-nada", { phone: "5511900000003", bem: "imovel" });
  const antiga = lead("LEAD-LP-antiga", { phone: "5511900000004", createdAt: "2026-10-01T13:00:00.000Z" });
  const nove = Array.from({ length: 9 }, (_, i) => resposta(i + 1));
  const diagnosticos = [
    aplicarEventoDiagnostico(
      undefined,
      ev({ tentativa: "c", telefone: "11900000001", etapa: "resultado", respondidas: 9, respostas: nove, perfil: "Construtor", notas: { reserva: 85, lance: 40, conhecimento: 65, plano: 30 }, conquistas: 7, conquistasTotal: 12 }),
      "2026-11-18T14:00:00.000Z",
    ),
    aplicarEventoDiagnostico(undefined, ev({ tentativa: "p", telefone: "5511900000002", respondidas: 3, respostas: nove.slice(0, 3) }), "2026-11-18T14:00:00.000Z"),
    // o clique de "parou" chegou antes do lead existir: guardado só pelo eventId
  ];
  const cliques = [{ eventId: "parou", primeiroEm: "2026-11-18T13:10:00.000Z", ultimoEm: "2026-11-18T13:10:00.000Z", cliques: 1 }];
  const data = base({ leads: [concluiu, parou, nada, antiga] });
  const linhas = montarLinhasDeLeads(data, [], "2026-11-18T15:00:00.000Z", {
    live: { cfg, diagnosticos, cliques: cliques.map((c) => ({ ...c, eventId: "parou" })) },
  });
  const linha = (id: string) => linhas.find((l) => l.id === id)!;

  it("cada linha: comunidade (data e hora) e diagnóstico (não começou · respondeu X de 9 · concluiu com o perfil)", () => {
    expect(linha("LEAD-LP-concluiu")).toMatchObject({ daLive: true, diagnostico: "concluiu", comunidadeEm: "2026-11-18T13:05:00.000Z" });
    expect(textoDoDiagnostico(linha("LEAD-LP-concluiu").diagnosticoResumo)).toBe("Concluiu · Construtor");
    expect(textoDoDiagnostico(linha("LEAD-LP-parou").diagnosticoResumo)).toBe("Respondeu 3 de 9");
    expect(linha("LEAD-LP-nada")).toMatchObject({ daLive: true, diagnostico: "nao", comunidade: false });
    expect(textoDoDiagnostico(linha("LEAD-LP-nada").diagnosticoResumo)).toBe("Não começou");
    // a campanha antiga não foi convidada: nem "não começou"
    expect(linha("LEAD-LP-antiga").daLive).toBe(false);
    expect(linha("LEAD-LP-antiga").diagnostico).toBeUndefined();
  });

  it("o filtro pela situação do diagnóstico (também no pedido de exportação)", () => {
    const so = (diagnostico: string) => aplicarFiltro(linhas, { ...FILTRO_VAZIO, ...filtroDoPedido({ diagnostico }) }).map((l) => l.id);
    expect(so("concluiu")).toEqual(["LEAD-LP-concluiu"]);
    expect(so("parcial")).toEqual(["LEAD-LP-parou"]);
    expect(so("nao")).toEqual(["LEAD-LP-nada"]);
    expect(filtroDoPedido({ diagnostico: "inventado" }).diagnostico).toBeUndefined();
  });

  it("o resumo do período: inscritos, comunidade, começaram, concluíram e quem chegou a cada pergunta", () => {
    const r = resumoDepoisDaInscricao(linhas);
    // comunidade: o fato da ficha de "concluiu" + o clique guardado de "parou", ligado na leitura
    expect(r).toMatchObject({ inscritos: 3, comunidade: 2, comecaram: 2, concluiram: 1 });
    expect(linha("LEAD-LP-parou").comunidadeEm).toBe("2026-11-18T13:10:00.000Z");
    // pergunta 1–4: os dois (respondeu 3 → chegou à 4); 5–9: só quem concluiu
    expect(r.chegaram).toEqual([2, 2, 2, 2, 1, 1, 1, 1, 1]);
    expect(chegouAPergunta({ situacao: "parcial", respondidas: 0 }, 1)).toBe(true);
    expect(chegouAPergunta({ situacao: "parcial", respondidas: 0 }, 2)).toBe(false);
  });

  it("o CSV leva o clique e o diagnóstico", () => {
    const csv = montarCsvDeLeads([linha("LEAD-LP-concluiu"), linha("LEAD-LP-antiga")]).replace(/^﻿/, "").split("\r\n");
    const cab = csv[0].split(";");
    expect(cab).toEqual([...CSV_CABECALHO]);
    const col = (nome: string, i: number) => csv[i].split(";")[cab.indexOf(nome)];
    expect(col("Diagnóstico", 1)).toBe("Concluiu");
    expect(col("Perguntas respondidas", 1)).toBe("9 de 9");
    expect(col("Perfil", 1)).toBe("Construtor");
    expect([col("Reserva", 1), col("Lance", 1), col("Conhecimento", 1), col("Plano", 1)]).toEqual(["85", "40", "65", "30"]);
    expect(col("Conquistas", 1)).toBe("7 de 12");
    expect(col("Clique na comunidade", 1)).toMatch(/18 de nov\.? de 2026|18 nov/);
    expect(col("Diagnóstico", 2)).toBe("");
  });
});
