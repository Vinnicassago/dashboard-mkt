/**
 * Fase 3 (§5 e §8.6 da spec + o adendo F3-D31) — "Por que perdemos":
 *
 *   • `encerramentoDoRobo` (`lib/robo/situacao.ts`): o fim da conversa pelo robô —
 *     opt-out, esfriou depois do convite (K24), esfriou na conversa; só com
 *     resposta NO episódio; pausado não é fim; as datas são do episódio (K15);
 *   • `perdasConfiaveis` com o trecho do robô (`idsDoTrechoDoRobo`, K5): uma pessoa,
 *     uma linha (vale o PRIMEIRO encerramento), quem encerrou (robô ou comercial),
 *     a API do n8n no ⓘ, o "outro" do contato inválido numa entrada só (K25);
 *   • a coerência com as juntas: Σ das linhas = Σ dos encerrados das juntas sem
 *     reunião + os inscritos da live com status de perda + os de antes do robô fora
 *     da Fila com status de perda.
 *
 * Fixtures sintéticas (`src/test/fixtures-robo.ts`, `src/test/fixtures-funil.ts`).
 */
import { describe, expect, it } from "vitest";
import { ALVO_LABEL, perdasConfiaveis, type PerdasConfiaveis } from "../funil";
import { funilDoProcesso, idsDoTrechoDoRobo, type JuntaId } from "../funil-processo";
import type { EntradaInicio } from "../inicio";
import type { DateRange } from "../metrics";
import { ATOR_N8N } from "../n8n/entrada";
import { encerramentoDoRobo, type RoboAgora } from "../robo/situacao";
import type { Lead, LeadEvent } from "../types";
import { AGORA, HOJE, ONTEM, ROBO, brt, lead, saudado } from "@/test/fixtures-robo";
import { aceitouAs, conversou, entradaEm, mudouStatus, roboLido, saudadoAs } from "@/test/fixtures-funil";

// ---------------------------------------------------------------- encerramentoDoRobo

describe("encerramentoDoRobo: o fim da conversa pelo robô (predicado único)", () => {
  const REAB = brt(ONTEM, "09:00");

  it("opt-out vale sempre, com ou sem resposta", () => {
    const l = lead("optout", saudado(ONTEM, { roboOptOutEm: brt(ONTEM, "12:00"), roboEtapa: "opt_out" }));
    expect(encerramentoDoRobo(l)).toEqual({ motivo: "opt-out", em: brt(ONTEM, "12:00") });
    // Só a etapa (sem a data): é opt-out, sem data.
    expect(encerramentoDoRobo(lead("optout-sem-data", saudado(ONTEM, { roboEtapa: "opt_out" })))).toEqual({ motivo: "opt-out", em: null });
  });

  it("'declinou' com resposta → esfriou depois do convite (`pos-convite`, K24)", () => {
    const l = lead("declinou", conversou(ONTEM, { roboConviteEm: brt(ONTEM, "10:00"), roboEtapa: "declinou", roboUltimaInteracaoEm: brt(ONTEM, "11:00") }));
    expect(encerramentoDoRobo(l)).toEqual({ motivo: "pos-convite", em: brt(ONTEM, "11:00") });
  });

  it("'frio' ou `encerrado_em` com resposta → esfriou na conversa", () => {
    expect(encerramentoDoRobo(lead("frio", conversou(ONTEM, { roboEtapa: "frio", roboUltimaInteracaoEm: brt(ONTEM, "12:00") })))).toEqual({
      motivo: "esfriou",
      em: brt(ONTEM, "12:00"),
    });
    expect(encerramentoDoRobo(lead("encerrado", conversou(ONTEM, { roboEncerradoEm: brt(ONTEM, "13:00") })))).toEqual({ motivo: "esfriou", em: brt(ONTEM, "13:00") });
  });

  it("encerrado SEM resposta → null (está no Resgate do comercial, não é linha do robô)", () => {
    expect(encerramentoDoRobo(lead("sem-resposta", saudado(ONTEM, { roboEtapa: "frio", roboEncerradoEm: brt(ONTEM, "20:00") })))).toBeNull();
  });

  it("pausado sozinho → null (alguém assumiu)", () => {
    expect(encerramentoDoRobo(lead("pausado", conversou(ONTEM, { roboPausado: true })))).toBeNull();
  });

  it("os fatos de antes do `reaberto` são da conversa antiga → null", () => {
    const l = lead("antigo", conversou("2026-10-30", { roboEtapa: "frio", roboEncerradoEm: brt("2026-10-30", "12:00"), roboUltimaInteracaoEm: brt("2026-10-30", "12:00") }));
    expect(encerramentoDoRobo(l)).not.toBeNull();
    expect(encerramentoDoRobo(l, REAB)).toBeNull();
  });

  it("aceite no episódio → null (o convite virou Calendly)", () => {
    expect(encerramentoDoRobo(lead("aceitou", aceitouAs(ONTEM, "10:00", { roboEtapa: "frio", roboEncerradoEm: brt(ONTEM, "12:00") })))).toBeNull();
  });

  it("aceite no episódio e opt-out depois → null: a pessoa está no 'Aceitou o convite' (o comercial liga), não é fim pelo robô", () => {
    const l = lead("aceitou-optout", aceitouAs(ONTEM, "10:00", { roboOptOutEm: brt(ONTEM, "12:00"), roboEtapa: "opt_out" }));
    expect(encerramentoDoRobo(l)).toBeNull();
    // O aceite de um episódio ANTERIOR ao reaberto não protege: o opt-out vale.
    expect(encerramentoDoRobo(l, brt(ONTEM, "11:00"))).toEqual({ motivo: "opt-out", em: brt(ONTEM, "12:00") });
  });

  it("K15: `encerrado_em` e a última interação de antes do `reaberto` nunca viram o `em`", () => {
    // Respondeu de novo depois do reaberto (a última mensagem dela), mas o robô não mexeu na conversa depois.
    const velho = lead("velho", {
      ...saudado("2026-10-30"),
      roboRespondeuEm: brt("2026-10-30", "09:10"),
      roboUltimaMsgClienteEm: brt(ONTEM, "10:00"),
      roboUltimaInteracaoEm: brt("2026-10-30", "12:00"),
      roboEncerradoEm: brt("2026-10-30", "12:00"),
      roboEtapa: "frio",
    });
    const r = encerramentoDoRobo(velho, REAB);
    expect(r?.em ?? null).toBeNull();
    // O robô mexeu depois do reaberto (frio NESTE episódio): o `em` é a interação do episódio, não o `encerrado_em` antigo.
    const novo = lead("novo", { ...velho, id: "novo", roboUltimaInteracaoEm: brt(ONTEM, "11:00") });
    expect(encerramentoDoRobo(novo, REAB)).toEqual({ motivo: "esfriou", em: brt(ONTEM, "11:00") });
  });
});

// ---------------------------------------------------------------- perdas com o trecho do robô

const HOJE2 = "2026-11-10"; // terça
const AGORA2 = brt(HOJE2, "15:00");
const ROBO2: RoboAgora = roboLido(brt(HOJE2, "14:55"));
const DO_ROBO: DateRange = { from: "2026-10-29", to: HOJE2 };

function perdasDe(
  leads: Lead[],
  o: { eventos?: LeadEvent[]; range?: DateRange; robo?: RoboAgora | null; agora?: string; hoje?: string } = {},
): { e: EntradaInicio; trecho: ReadonlySet<string>; p: PerdasConfiaveis } {
  const e = entradaEm({
    leads,
    eventos: o.eventos ?? [],
    range: o.range ?? DO_ROBO,
    agora: o.agora ?? AGORA2,
    hoje: o.hoje ?? HOJE2,
    robo: o.robo === undefined ? ROBO2 : o.robo,
  });
  const trecho = idsDoTrechoDoRobo(e);
  return { e, trecho, p: perdasConfiaveis(e.data, e.range, e.eventos, { trechoDoRobo: trecho }) };
}

describe("perdas: uma linha por motivo, com quem encerrou (robô ou comercial)", () => {
  it("lead ABERTO no trecho do robô, com fim de conversa pelo robô → linha do robô (o status não muda)", () => {
    const l = lead("aberto-declinou", conversou("2026-11-05", { roboConviteEm: brt("2026-11-05", "10:00"), roboEtapa: "declinou", roboUltimaInteracaoEm: brt("2026-11-05", "11:00") }));
    const { trecho, p } = perdasDe([l]);
    expect(trecho.has(l.id)).toBe(true);
    expect(p.total).toBe(1);
    expect(p.linhas).toHaveLength(1);
    expect(p.linhas[0]).toMatchObject({
      motivo: "robo-pos-convite",
      label: "Esfriou depois do convite",
      quem: "robo",
      n: 1,
      share: 1,
      abertos: 1,
      registradoComAtraso: null,
      atrasoN: 0,
      ondeAtacar: { indefinido: 1 },
    });
    expect(p.linhas[0].status).toBeUndefined();
    expect(ALVO_LABEL.robo).toBe("Robô (roteiro)");
    expect(ALVO_LABEL.indefinido).toBe("Não dá para dizer");
  });

  it("o robô encerrou em 06/11 e o comercial marcou 'Sem resposta' em 09/11 → conta UMA vez, na do robô (vale o primeiro)", () => {
    const l = lead("frio-e-sr", {
      ...conversou("2026-11-05", { roboEtapa: "frio", roboEncerradoEm: brt("2026-11-06", "10:00"), roboUltimaInteracaoEm: brt("2026-11-06", "10:00") }),
      status: "sem_resposta",
      lostAt: brt("2026-11-09", "10:00"),
    });
    const { p } = perdasDe([l], { eventos: [mudouStatus(l.id, brt("2026-11-09", "10:00"), "sem_resposta", "ana", "em_contato")] });
    expect(p.total).toBe(1);
    expect(p.linhas.map((x) => [x.motivo, x.quem, x.n])).toEqual([["robo-esfriou", "robo", 1]]);
    expect(p.linhas[0]).toMatchObject({ label: "Esfriou na conversa", ondeAtacar: { robo: 1 }, abertos: 0 });
  });

  it("o comercial registrou a perda ANTES do opt-out → só a linha do comercial", () => {
    const l = lead("comercial-primeiro", {
      ...saudado("2026-11-05"),
      status: "sem_interesse",
      lostAt: brt("2026-11-06", "10:00"),
      roboOptOutEm: brt("2026-11-08", "10:00"),
      roboEtapa: "opt_out",
    });
    const { p } = perdasDe([l], { eventos: [mudouStatus(l.id, brt("2026-11-06", "10:00"), "sem_interesse")] });
    expect(p.linhas.map((x) => [x.motivo, x.status, x.quem, x.n])).toEqual([["sem_interesse", "sem_interesse", "comercial", 1]]);
  });

  it("fim pelo robô SEM data e status de perda → a linha do status", () => {
    const l = lead("optout-sem-data", { ...saudado("2026-11-05"), roboEtapa: "opt_out", status: "contato_invalido", lostReasonDetail: "sem_whatsapp", lostAt: brt("2026-11-06", "10:00") });
    const { p } = perdasDe([l]);
    expect(p.linhas.map((x) => [x.motivo, x.quem])).toEqual([["contato_invalido", "comercial"]]);
  });

  it("inscrito da live, ou lead de antes de 29/10, com opt-out e aberto: nenhuma linha, e `roboForaDoTrecho` = 1 (K5)", () => {
    const live = lead("live-optout", {
      createdAt: brt("2026-11-05", "10:00"),
      classe: "A",
      bem: "imovel",
      roboVistoEm: brt("2026-11-05", "10:05"),
      roboSaudacaoEm: brt("2026-11-05", "10:05"),
      roboOptOutEm: brt("2026-11-05", "12:00"),
      roboEtapa: "opt_out",
    });
    const l1 = perdasDe([live]);
    expect(l1.trecho.has(live.id)).toBe(false);
    expect(l1.p).toMatchObject({ total: 0, linhas: [], roboForaDoTrecho: 1 });

    const antes = lead("antes-optout", { createdAt: brt("2026-10-20", "10:00"), roboOptOutEm: brt("2026-11-05", "12:00"), roboEtapa: "opt_out" });
    const a1 = perdasDe([antes, lead("depois", { createdAt: brt("2026-11-09", "10:00") })], { range: { from: "2026-10-20", to: HOJE2 } });
    expect(a1.trecho.has(antes.id)).toBe(false);
    expect(a1.p).toMatchObject({ total: 0, linhas: [], roboForaDoTrecho: 1 });
  });

  it("teste, cópia de duplicado e quem chegou a agendar ficam fora, mesmo com fim de conversa pelo robô", () => {
    const frio = { roboEtapa: "frio" as const, roboEncerradoEm: brt("2026-11-05", "12:00"), roboUltimaInteracaoEm: brt("2026-11-05", "12:00") };
    const principal = lead("principal", conversou("2026-11-05"));
    const leads = [
      lead("teste-frio", conversou("2026-11-05", { ...frio, email: "teste@teste.com" })),
      principal,
      lead("copia-frio", conversou("2026-11-05", { ...frio, createdAt: brt("2026-11-05", "10:00"), phone: principal.phone })),
      lead("agendou-frio", conversou("2026-11-05", { ...frio, status: "agendado", bookedAt: brt("2026-11-06", "10:00"), meetingFor: brt("2026-11-12", "10:00") })),
    ];
    const { p } = perdasDe(leads);
    expect(p.total).toBe(0);
    expect(p.linhas).toEqual([]);
    expect(p.excluidos).toMatchObject({ testes: 1, duplicados: 1 });
    expect(p.roboForaDoTrecho).toBe(0);
  });

  it("`peloN8n` conta os status registrados pela API do n8n (só no ⓘ)", () => {
    const a = lead("sr-n8n", { createdAt: brt("2026-11-05", "10:00"), status: "sem_resposta", lostAt: brt("2026-11-07", "10:00") });
    const b = lead("sr-ana", { createdAt: brt("2026-11-05", "11:00"), status: "sem_resposta", lostAt: brt("2026-11-07", "11:00") });
    const { p } = perdasDe([a, b], {
      eventos: [mudouStatus(a.id, brt("2026-11-07", "10:00"), "sem_resposta", ATOR_N8N), mudouStatus(b.id, brt("2026-11-07", "11:00"), "sem_resposta", "ana")],
    });
    expect(p.linhas).toHaveLength(1);
    expect(p.linhas[0]).toMatchObject({ motivo: "sem_resposta", quem: "comercial", n: 2, peloN8n: 1 });
  });

  it("'Contato inválido': o texto livre e a chave 'outro' viram UMA entrada 'Outro' (K25) — o texto nunca sai", () => {
    const leads = [
      lead("ci-livre", { createdAt: brt("2026-11-05", "10:00"), status: "contato_invalido", lostReasonDetail: "xyz", lostAt: brt("2026-11-05", "12:00") }),
      lead("ci-outro", { createdAt: brt("2026-11-05", "11:00"), status: "contato_invalido", lostReasonDetail: "outro", lostAt: brt("2026-11-05", "12:00") }),
    ];
    const { p } = perdasDe(leads);
    const linha = p.linhas.find((x) => x.motivo === "contato_invalido")!;
    expect(linha.detalhes).toEqual([{ motivo: "outro", label: "Outro", n: 2 }]);
    expect(JSON.stringify(p)).not.toContain("xyz");
  });

  it("robô desligado (ou sem o trecho): só os status de perda — as linhas de hoje", () => {
    const leads = [
      lead("aberto-frio", conversou("2026-11-05", { roboEtapa: "frio", roboEncerradoEm: brt("2026-11-05", "12:00") })),
      lead("sr", { createdAt: brt("2026-11-05", "10:00"), status: "sem_resposta", lostAt: brt("2026-11-07", "10:00") }),
      lead("si", { createdAt: brt("2026-11-05", "11:00"), status: "sem_interesse", lostAt: brt("2026-11-07", "10:00") }),
    ];
    const desligado = perdasDe(leads, { robo: null });
    expect(desligado.trecho.size).toBe(0);
    const semOpts = perdasConfiaveis(desligado.e.data, desligado.e.range, desligado.e.eventos);
    for (const p of [desligado.p, semOpts, perdasConfiaveis(desligado.e.data, desligado.e.range, desligado.e.eventos, {})]) {
      expect(p.linhas.map((x) => [x.motivo, x.status, x.quem])).toEqual([
        ["sem_resposta", "sem_resposta", "comercial"],
        ["sem_interesse", "sem_interesse", "comercial"],
      ]);
      expect(p.total).toBe(2);
    }
    // Com o robô ligado, a mesma base ganha a linha do robô.
    expect(perdasDe(leads).p.linhas.map((x) => x.motivo)).toContain("robo-esfriou");
  });
});

// ---------------------------------------------------------------- coerência com as juntas (K5 + F3-D31)

describe("coerência: as perdas e os encerrados das juntas contam as MESMAS pessoas", () => {
  it("Σ linhas = Σ encerrados das juntas sem reunião + live com status de perda + 'antes' fora da Fila com status de perda", () => {
    const frio = (dia: string) => ({ roboEtapa: "frio" as const, roboEncerradoEm: brt(dia, "12:00"), roboUltimaInteracaoEm: brt(dia, "12:00") });
    const principal = lead("co-principal", conversou(HOJE));
    const leads: Lead[] = [
      // Live: uma com opt-out e aberta (nenhuma linha, `roboForaDoTrecho`), uma com status de perda (linha do status).
      lead("co-live-optout", { createdAt: brt(ONTEM, "10:00"), classe: "A", bem: "imovel", roboVistoEm: brt(ONTEM, "10:05"), roboOptOutEm: brt(ONTEM, "12:00"), roboEtapa: "opt_out" }),
      lead("co-live-perdida", { createdAt: brt(ONTEM, "11:00"), classe: "B", bem: "imovel", status: "sem_interesse", lostAt: brt(HOJE, "10:00") }),
      // Teste e cópia de duplicado com fim de conversa pelo robô: fora das duas contas.
      lead("co-teste", conversou(ONTEM, { ...frio(ONTEM), email: "teste@teste.com" })),
      principal,
      lead("co-copia", conversou(HOJE, { ...frio(HOJE), createdAt: brt(HOJE, "10:00"), phone: principal.phone })),
      // No trecho do robô.
      lead("co-esfriou", conversou(ONTEM, frio(ONTEM))),
      lead("co-pos-convite", conversou(ONTEM, { roboConviteEm: brt(ONTEM, "10:00"), roboEtapa: "declinou", roboUltimaInteracaoEm: brt(ONTEM, "11:00") })),
      lead("co-sem-resposta", saudado(ONTEM, { status: "sem_resposta", lostAt: brt(HOJE, "10:00") })),
      lead("co-invalido", { createdAt: brt(HOJE, "10:00"), status: "contato_invalido", lostReasonDetail: "numero_inexistente", lostAt: brt(HOJE, "11:00") }),
      lead("co-optout", saudado(ONTEM, { roboOptOutEm: brt(ONTEM, "12:00"), roboEtapa: "opt_out" })),
      // Aceitou o convite e pediu para não receber mensagens depois: aberto no "Aceitou o convite" —
      // nem linha de perda, nem encerrado na junta do aceite (a mesma pessoa, do mesmo jeito).
      lead("co-aceitou-optout", aceitouAs(ONTEM, "10:00", { roboOptOutEm: brt(ONTEM, "12:00"), roboEtapa: "opt_out" })),
      // Fora do robô: sem telefone e perdido.
      lead("co-semtel", { createdAt: brt(ONTEM, "10:00"), phone: undefined, status: "sem_interesse", lostAt: brt(HOJE, "10:00") }),
      // De antes do robô, perdido, fora da Fila.
      lead("co-antes", { createdAt: brt("2026-10-21", "10:00"), status: "sem_resposta", lostAt: brt("2026-10-25", "10:00") }),
      // Agendou e se perdeu depois: não é "perda sem reunião" (fica em `realizou`).
      lead("co-agendou", conversou(ONTEM, { status: "sem_interesse", bookedAt: brt(ONTEM, "15:00"), lostAt: brt(HOJE, "10:00") })),
      // Aberto, no prazo.
      lead("co-no-prazo", saudadoAs(HOJE, "12:00")),
    ];
    const e = entradaEm({ leads, range: { from: "2026-10-20", to: HOJE }, agora: AGORA, hoje: HOJE, robo: ROBO });
    const processo = funilDoProcesso(e);
    const p = perdasConfiaveis(e.data, e.range, e.eventos, { trechoDoRobo: idsDoTrechoDoRobo(e) });

    expect(processo.comRobo).toBe(true);
    expect(processo.foraDasJuntas).toEqual({ testes: 1, duplicados: 1, live: 2, antes: 1 });
    const semReuniao: JuntaId[] = ["robo-falou", "respondeu", "aceitou", "agendou-apos-aceite", "fora-agendou"];
    const encerrados = processo.juntas.filter((j) => semReuniao.includes(j.id)).reduce((s, j) => s + j.encerrados, 0);
    const liveComPerda = 1; // co-live-perdida
    const antesComPerda = 1; // co-antes (fora da Fila)
    const linhas = p.linhas.reduce((s, l) => s + l.n, 0);
    expect(linhas).toBe(p.total);
    expect(linhas).toBe(encerrados + liveComPerda + antesComPerda);
    expect(linhas).toBe(8);
    expect(p.roboForaDoTrecho).toBe(1);
    expect(processo.juntas.find((j) => j.id === "agendou-apos-aceite")).toMatchObject({ entradas: 1, travados: 1, abertos: 1, encerrados: 0, destino: "convite-aceito" });
    expect(p.excluidos).toMatchObject({ testes: 1, duplicados: 1, comReuniao: 1 });
    // A ordem: n desc; no empate, a ordem fixa dos motivos.
    expect(p.linhas.map((l) => [l.motivo, l.n])).toEqual([
      ["sem_resposta", 2],
      ["sem_interesse", 2],
      ["contato_invalido", 1],
      ["robo-pos-convite", 1],
      ["robo-esfriou", 1],
      ["robo-opt-out", 1],
    ]);
    expect(p.linhas.map((l) => l.quem)).toEqual(["comercial", "comercial", "comercial", "robo", "robo", "robo"]);
    expect(p.linhas.find((l) => l.motivo === "robo-opt-out")).toMatchObject({ label: "Pediu para não receber mensagens", ondeAtacar: { midia_formulario: 1 } });
  });
});
