/**
 * Fase 1 (nov/26), etapa B — `situacaoDoRobo` (onde a pessoa está com o robô),
 * o predicado único dos filtros do robô e a contagem única "sem a 1ª mensagem".
 * Puro; datas em Brasília (UTC−3). Robô ligado sempre com AGORA ≥ 29/10.
 */
import { describe, expect, it } from "vitest";
import {
  FILTROS_DO_ROBO,
  ROBO_INICIO,
  casaFiltroRobo,
  leituraDoRoboParada,
  primeiroNome,
  reabertoDe,
  reabertoNoPainelDe,
  reabertosNoPainel,
  reabertosPorLead,
  refDoRobo,
  semMensagemDoRobo,
  situacaoDoRobo,
  type FiltroRobo,
} from "../robo/situacao";
import type { Lead, LeadEvent } from "../types";

const brt = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();
const AGORA = brt("2026-11-04", "15:00"); // quarta

let seq = 0;
const lead = (extra: Partial<Lead> = {}): Lead => ({
  id: `L${++seq}`,
  brand: "consorcio",
  createdAt: brt("2026-11-04", "09:00"),
  name: "Pessoa Teste",
  phone: `55119876${String(5000 + seq).padStart(5, "0")}`,
  status: "lead",
  ...extra,
});

/** Leitura em dia (5 min atrás): a referência é a leitura. */
const ctx = (extra: Partial<Parameters<typeof situacaoDoRobo>[1]> = {}) => ({
  agora: AGORA,
  ref: brt("2026-11-04", "14:55"),
  ligado: true,
  ...extra,
});

const reaberto = (leadId: string, at: string): LeadEvent => ({
  id: `R-${leadId}-${at}`,
  leadId,
  leadName: "x",
  actor: "Landing page",
  action: "reaberto",
  fromStatus: "sem_resposta",
  toStatus: "lead",
  createdAt: at,
});

describe("situacaoDoRobo — o corte, a referência e quem fica sem dono", () => {
  it("o corte de 29/10 é o dia em BRASÍLIA: 28/10 às 23h é antes do robô (o ISO já é 29/10)", () => {
    const tarde = lead({ createdAt: brt("2026-10-28", "23:00") });
    expect(tarde.createdAt.slice(0, 10)).toBe("2026-10-29");
    expect(ROBO_INICIO).toBe("2026-10-29");
    expect(situacaoDoRobo(tarde, ctx()).antesDoRobo).toBe(true);
    expect(situacaoDoRobo(lead({ createdAt: brt("2026-10-29", "00:30") }), ctx()).antesDoRobo).toBe(false);
    // Quem o robô viu nunca é "antes do robô".
    expect(situacaoDoRobo(lead({ createdAt: brt("2026-10-20", "10:00"), roboVistoEm: brt("2026-10-30", "10:00") }), ctx()).antesDoRobo).toBe(false);
  });

  it("'não recebido' mede contra a LEITURA (ref), não contra agora — o cron ainda não viu quem entrou depois", () => {
    const l = lead({ createdAt: brt("2026-11-04", "14:45") });
    // Lido às 14:55: o lead tinha 10 min — o robô ainda tinha tempo.
    expect(situacaoDoRobo(l, ctx()).naoRecebido).toBe(false);
    // Lido às 15:00: 15 min — agora sim.
    expect(situacaoDoRobo(l, ctx({ ref: AGORA })).naoRecebido).toBe(true);
    // A referência: a leitura só quando confiável; senão, agora.
    expect(refDoRobo({ lidoAte: brt("2026-11-04", "14:55"), confiavel: true }, AGORA)).toBe(brt("2026-11-04", "14:55"));
    expect(refDoRobo({ lidoAte: brt("2026-11-04", "09:00"), confiavel: false }, AGORA)).toBe(AGORA);
    expect(refDoRobo({ lidoAte: null, confiavel: false }, AGORA)).toBe(AGORA);
  });

  it("os quatro motivos do robô: sem resposta em 24 h, sem WhatsApp, sem telefone, o robô não falou", () => {
    const semResposta = lead({
      createdAt: brt("2026-11-03", "10:00"),
      roboVistoEm: brt("2026-11-03", "10:05"),
      roboSaudacaoEm: brt("2026-11-03", "10:01"),
      roboEtapa: "nao_respondeu",
    });
    expect(situacaoDoRobo(semResposta, ctx()).resgate).toEqual({ motivo: "sem-resposta-24h", desde: brt("2026-11-04", "10:01") });

    const semWhats = lead({ roboVistoEm: brt("2026-11-04", "09:10"), roboEtapa: "sem_whatsapp", roboSemWhatsappEm: brt("2026-11-04", "09:01") });
    expect(situacaoDoRobo(semWhats, ctx()).resgate).toEqual({ motivo: "sem-whatsapp", desde: brt("2026-11-04", "09:01") });

    const semTel = lead({ phone: undefined });
    expect(situacaoDoRobo(semTel, ctx()).resgate).toEqual({ motivo: "sem-telefone", desde: semTel.createdAt });
    // Telefone que não serve para casar (curto demais) também é "sem telefone".
    expect(situacaoDoRobo(lead({ phone: "1234" }), ctx()).resgate?.motivo).toBe("sem-telefone");

    // Sem registro no robô há 2 h (contra a leitura): o robô não falou.
    const naoFalou = lead({ createdAt: brt("2026-11-04", "12:00") });
    expect(situacaoDoRobo(naoFalou, ctx()).resgate).toEqual({ motivo: "robo-nao-falou", desde: brt("2026-11-04", "14:00") });
    // Visto sem saudação: conta do recebimento no robô.
    const vistoMudo = lead({
      createdAt: brt("2026-11-04", "12:00"),
      roboVistoEm: brt("2026-11-04", "12:20"),
      roboRecebidoEm: brt("2026-11-04", "12:30"),
      roboEtapa: "sem_mensagem",
    });
    const s = situacaoDoRobo(vistoMudo, ctx());
    expect(s.semPrimeiraMsg).toBe(true);
    expect(s.resgate).toEqual({ motivo: "robo-nao-falou", desde: brt("2026-11-04", "14:30") });
    // Menos de 2 h: ainda não é resgate (é só "sem a 1ª mensagem").
    const cedo = lead({ createdAt: brt("2026-11-04", "13:30") });
    expect(situacaoDoRobo(cedo, ctx())).toMatchObject({ naoRecebido: true, resgate: null });
  });

  it("sai do resgate quando responde ao robô; opt-out nunca entra; encerrado sem nunca responder continua", () => {
    const base = {
      createdAt: brt("2026-11-03", "10:00"),
      roboVistoEm: brt("2026-11-03", "10:05"),
      roboSaudacaoEm: brt("2026-11-03", "10:01"),
    };
    const respondeu = lead({ ...base, roboUltimaMsgClienteEm: brt("2026-11-04", "14:00"), roboEtapa: "em_conversa", roboUltimaInteracaoEm: brt("2026-11-04", "14:01") });
    expect(situacaoDoRobo(respondeu, ctx())).toMatchObject({ resgate: null, respondeu: true, balde: "em-conversa", desde: brt("2026-11-04", "14:01") });

    const optOut = lead({ ...base, roboEtapa: "opt_out", roboOptOutEm: brt("2026-11-03", "11:00") });
    expect(situacaoDoRobo(optOut, ctx())).toMatchObject({ resgate: null, balde: "encerrado", etapa: "opt_out" });

    // Encerrado/pausado pelo robô NÃO tira daqui quem nunca respondeu (11.2).
    const encerrado = lead({ ...base, roboEtapa: "nao_respondeu", roboEncerradoEm: brt("2026-11-04", "08:00") });
    expect(situacaoDoRobo(encerrado, ctx()).resgate?.motivo).toBe("sem-resposta-24h");
    // Quem respondeu e esfriou: com o robô, encerrado.
    const frio = lead({ ...base, roboRespondeuEm: brt("2026-11-03", "11:00"), roboEtapa: "frio", roboEncerradoEm: brt("2026-11-04", "08:00") });
    expect(situacaoDoRobo(frio, ctx())).toMatchObject({ resgate: null, balde: "encerrado", desde: brt("2026-11-04", "08:00") });
    // Aceitou o convite: é do grupo "Aceitou o convite", nunca do resgate.
    const aceitou = lead({ ...base, roboEtapa: "transferido", roboAceitouEm: brt("2026-11-04", "10:00") });
    expect(situacaoDoRobo(aceitou, ctx())).toMatchObject({ resgate: null, balde: null, aceitouEm: brt("2026-11-04", "10:00"), desde: brt("2026-11-04", "10:00") });
  });

  it("esperando resposta: saudação há menos de 24 h; a data que cada etapa conta (11.16)", () => {
    const esperando = lead({ roboVistoEm: brt("2026-11-04", "09:05"), roboSaudacaoEm: brt("2026-11-04", "09:01"), roboEtapa: "nao_respondeu" });
    expect(situacaoDoRobo(esperando, ctx())).toMatchObject({ balde: "esperando", desde: brt("2026-11-04", "09:01"), resgate: null });
    const convite = lead({
      roboVistoEm: brt("2026-11-04", "09:05"),
      roboSaudacaoEm: brt("2026-11-04", "09:01"),
      roboRespondeuEm: brt("2026-11-04", "09:10"),
      roboConviteEm: brt("2026-11-04", "09:30"),
      roboEtapa: "convite_pendente",
    });
    expect(situacaoDoRobo(convite, ctx())).toMatchObject({ balde: "em-conversa", desde: brt("2026-11-04", "09:30") });
    const semMsg = lead({ createdAt: brt("2026-11-04", "14:50"), roboVistoEm: brt("2026-11-04", "14:55"), roboRecebidoEm: brt("2026-11-04", "14:51"), roboEtapa: "sem_mensagem" });
    expect(situacaoDoRobo(semMsg, ctx())).toMatchObject({ etapa: "sem_mensagem", desde: brt("2026-11-04", "14:51"), semPrimeiraMsg: false });
  });

  it("fora do recorte (com classe, encerrado, excluído, desligado): nada de resgate nem de barra", () => {
    const naoFalou = { createdAt: brt("2026-11-04", "10:00") };
    expect(situacaoDoRobo(lead({ ...naoFalou, classe: "A" }), ctx())).toMatchObject({ noRecorte: false, resgate: null, naoRecebido: false });
    expect(situacaoDoRobo(lead({ ...naoFalou, status: "cliente" }), ctx()).resgate).toBeNull();
    expect(situacaoDoRobo(lead({ ...naoFalou, deletedAt: AGORA }), ctx()).resgate).toBeNull();
    expect(situacaoDoRobo(lead(naoFalou), ctx({ ligado: false }))).toMatchObject({ ligado: false, resgate: null, naoRecebido: false, antesDoRobo: false });
  });

  it("reaberto (11.3): o relógio recomeça e os fatos UMA VEZ da conversa antiga são ignorados — o opt-out vale sempre", () => {
    // O "voltou hoje" de identidade.test com o robô ligado: entrou em 30/10, o
    // robô conversou e o convite foi aceito; perdido, preencheu de novo hoje 14h.
    const antigo = {
      createdAt: brt("2026-10-30", "10:00"),
      roboVistoEm: brt("2026-10-30", "10:05"),
      roboRecebidoEm: brt("2026-10-30", "10:00"),
      roboSaudacaoEm: brt("2026-10-30", "10:01"),
      roboRespondeuEm: brt("2026-10-30", "10:20"),
      roboUltimaMsgClienteEm: brt("2026-10-30", "11:00"),
      roboUltimaInteracaoEm: brt("2026-10-30", "11:05"),
      roboEtapa: "transferido" as const,
      roboAceitouEm: brt("2026-10-30", "11:05"),
    };
    const l = lead(antigo);
    const reab = brt("2026-11-04", "14:00");
    const s = situacaoDoRobo(l, ctx({ reabertoEm: reab }));
    // A conversa antiga não conta: sem o aceite, sem a resposta, há 55 min sem o
    // robô registrar o episódio novo — e o resgate só vem às 2 h. Como o robô JÁ
    // falou com ela (a saudação de 30/10), isso não é falha dele: fora do "não
    // recebido" (B1 e alerta).
    expect(s).toMatchObject({ aceitouEm: null, respondeu: false, etapa: null, naoRecebido: false, semPrimeiraMsg: false, resgate: null });
    // 2 h depois do reaberto sem o robô falar de novo: resgate, contado do reaberto.
    const depois = situacaoDoRobo(l, { agora: brt("2026-11-04", "16:30"), ref: brt("2026-11-04", "16:30"), ligado: true, reabertoEm: reab });
    expect(depois.resgate).toEqual({ motivo: "robo-nao-falou", desde: brt("2026-11-04", "16:00") });
    // Respondeu DEPOIS do reaberto: volta ao robô.
    const voltou = lead({ ...antigo, roboUltimaMsgClienteEm: brt("2026-11-04", "14:30"), roboUltimaInteracaoEm: brt("2026-11-04", "14:31"), roboEtapa: "em_conversa" });
    expect(situacaoDoRobo(voltou, ctx({ reabertoEm: reab }))).toMatchObject({ respondeu: true, resgate: null, etapa: "em_conversa" });
    // O opt-out de antes do reaberto continua valendo.
    const optou = lead({ ...antigo, roboOptOutEm: brt("2026-10-31", "09:00"), roboEtapa: "opt_out" });
    expect(situacaoDoRobo(optou, ctx({ reabertoEm: reab }))).toMatchObject({ etapa: "opt_out", resgate: null });
    // O corte "antes do robô" olha max(createdAt, reaberto): o lead de setembro reaberto hoje não é "antes".
    const velho = lead({ createdAt: brt("2026-09-01", "09:00") });
    expect(situacaoDoRobo(velho, ctx()).antesDoRobo).toBe(true);
    expect(situacaoDoRobo(velho, ctx({ reabertoEm: reab })).antesDoRobo).toBe(false);
  });

  it("o robô registra tarde quem já estava no resgate: continua no resgate, com o MESMO motivo e o MESMO desde", () => {
    // Entrou às 10:00 e o n8n → robô ficou fora do ar: às 12:05 está no resgate desde 12:00.
    const semNada = lead({ createdAt: brt("2026-11-04", "10:00") });
    const antes = situacaoDoRobo(semNada, ctx({ agora: brt("2026-11-04", "12:05"), ref: brt("2026-11-04", "12:05") }));
    expect(antes.resgate).toEqual({ motivo: "robo-nao-falou", desde: brt("2026-11-04", "12:00") });
    // Às 12:20 o robô criou a linha (criado_em 12:15) e ainda não saudou: não volta ao
    // "dentro do prazo" (sairia da Fila sem dono e voltaria às 14:15 com outro aviso).
    const tarde = lead({ ...semNada, roboVistoEm: brt("2026-11-04", "12:20"), roboRecebidoEm: brt("2026-11-04", "12:15"), roboEtapa: "sem_mensagem" });
    const depois = situacaoDoRobo(tarde, ctx({ agora: brt("2026-11-04", "12:25"), ref: brt("2026-11-04", "12:20") }));
    expect(depois.resgate).toEqual(antes.resgate);
    expect(depois.semPrimeiraMsg).toBe(true);
    // O registro DENTRO do prazo das 2 h adia o relógio, como sempre (recebido 11:00 → resgate 13:00).
    const noPrazo = lead({ ...semNada, roboVistoEm: brt("2026-11-04", "11:05"), roboRecebidoEm: brt("2026-11-04", "11:00"), roboEtapa: "sem_mensagem" });
    expect(situacaoDoRobo(noPrazo, ctx({ agora: brt("2026-11-04", "12:30"), ref: brt("2026-11-04", "12:30") })).resgate).toBeNull();
    expect(situacaoDoRobo(noPrazo, ctx({ agora: brt("2026-11-04", "13:05"), ref: brt("2026-11-04", "13:05") })).resgate).toEqual({
      motivo: "robo-nao-falou",
      desde: brt("2026-11-04", "13:00"),
    });
  });

  it("reaberto e o robô seguiu a MESMA conversa (falou depois do reaberto, sem regravar a saudação): não é 'robô não falou'", () => {
    const reab = brt("2026-11-04", "14:00");
    const l = lead({
      createdAt: brt("2026-10-30", "10:00"),
      roboVistoEm: brt("2026-11-04", "14:10"), // renovado pelo sync no episódio novo
      roboRecebidoEm: brt("2026-10-30", "10:00"),
      roboSaudacaoEm: brt("2026-10-30", "10:01"), // a antiga: o robô não a regravou
      roboUltimaMsgClienteEm: brt("2026-10-30", "11:00"),
      roboUltimaInteracaoEm: brt("2026-11-04", "14:05"), // o robô mandou mensagem depois do reaberto
      roboEtapa: "nao_respondeu",
    });
    const s = situacaoDoRobo(l, ctx({ ref: brt("2026-11-04", "14:55"), reabertoEm: reab }));
    expect(s).toMatchObject({ etapa: "nao_respondeu", respondeu: false, semPrimeiraMsg: false, naoRecebido: false, resgate: null, balde: "esperando", desde: reab });
    // Às 16:30 o robô continua esperando — não entra no resgate como "o robô não falou".
    const t = brt("2026-11-04", "16:30");
    expect(situacaoDoRobo(l, { agora: t, ref: t, ligado: true, reabertoEm: reab }).resgate).toBeNull();
    // 24 h sem resposta, contadas do reaberto (estável: a cobrança do robô não reinicia o prazo).
    const amanha = brt("2026-11-05", "14:10");
    const cobrou = { ...l, roboUltimaInteracaoEm: brt("2026-11-05", "10:00"), roboUltimaCobrancaEm: brt("2026-11-05", "10:00") };
    expect(situacaoDoRobo(cobrou, { agora: amanha, ref: amanha, ligado: true, reabertoEm: reab }).resgate).toEqual({
      motivo: "sem-resposta-24h",
      desde: brt("2026-11-05", "14:00"),
    });
  });

  it("reaberto pelo admin com a saudação de outro episódio: fora da contagem 'sem a 1ª mensagem' (não é falha do robô) — e no resgate às 2 h", () => {
    const reab = brt("2026-11-04", "12:00");
    const l = lead({
      createdAt: brt("2026-10-30", "10:00"),
      roboVistoEm: brt("2026-11-04", "13:10"), // o sync renovou o "visto"
      roboRecebidoEm: brt("2026-10-30", "10:00"),
      roboSaudacaoEm: brt("2026-10-30", "10:01"),
      roboUltimaInteracaoEm: brt("2026-10-31", "10:00"),
      roboEtapa: "frio",
    });
    const robo = { ligado: true, lidoAte: brt("2026-11-04", "14:55"), confiavel: true };
    const c = semMensagemDoRobo([l], new Map([[l.id, reab]]), robo, AGORA);
    expect(c.total).toBe(0);
    expect(situacaoDoRobo(l, ctx({ reabertoEm: reab })).resgate).toEqual({ motivo: "robo-nao-falou", desde: brt("2026-11-04", "14:00") });
    // Sem saudação antiga (o robô nunca falou com ela) e reaberto por uma inscrição
    // nova (a página, o n8n — que chega ao robô), a contagem continua.
    const nunca = lead({ ...l, roboSaudacaoEm: undefined });
    expect(semMensagemDoRobo([nunca], new Map([[nunca.id, reab]]), robo, AGORA).total).toBe(1);
  });

  it("lead de antes do robô reaberto no PAINEL (o admin): o robô nunca recebe — fora da B1, do alerta e de Integrações; no resgate às 2 h", () => {
    // Criado em 20/10, encerrado; o admin reabre hoje às 10:00. Às 15:00, com a leitura em dia.
    const l = lead({ createdAt: brt("2026-10-20", "10:00") });
    const reab = brt("2026-11-04", "10:00");
    const doAdmin: LeadEvent = { ...reaberto(l.id, reab), actor: "ana", toStatus: "lead" };
    const robo = { ligado: true, lidoAte: brt("2026-11-04", "14:55"), confiavel: true };
    expect(reabertoNoPainelDe([doAdmin])).toBe(true);
    const s = situacaoDoRobo(l, ctx({ reabertoEm: reab, reabertoNoPainel: true }));
    expect(s).toMatchObject({ antesDoRobo: false, naoRecebido: false, semPrimeiraMsg: false });
    // ninguém fica sem dono: o resgate das 2 h continua
    expect(s.resgate).toEqual({ motivo: "robo-nao-falou", desde: brt("2026-11-04", "12:00") });
    const c = semMensagemDoRobo([l], reabertosPorLead([doAdmin]), robo, AGORA, reabertosNoPainel([doAdmin]));
    expect(c).toEqual({ total: 0, naoChegaram: 0, ids: [] });
    // Reaberto pela página (uma inscrição nova, que chega ao robô): falha do robô, conta.
    const daLp = reaberto(l.id, reab);
    expect(reabertoNoPainelDe([daLp])).toBe(false);
    expect(semMensagemDoRobo([l], reabertosPorLead([daLp]), robo, AGORA, reabertosNoPainel([daLp]))).toMatchObject({ total: 1, naoChegaram: 1 });
    // Vale o ÚLTIMO reaberto: o admin reabriu, perdeu de novo e a pessoa se inscreveu outra vez.
    const depois = { ...daLp, id: "R-depois", createdAt: brt("2026-11-04", "11:00") };
    expect([...reabertosNoPainel([doAdmin, depois])]).toEqual([]);
    expect([...reabertosNoPainel([depois, doAdmin, { ...doAdmin, id: "R2", leadId: "outro", actor: "n8n" }])]).toEqual([]);
    expect([...reabertosNoPainel([doAdmin, { ...doAdmin, id: "R3", leadId: "outro", actor: "n8n" }])]).toEqual([l.id]);
  });

  it("reaberto com o 'transferido' da conversa antiga e a pessoa voltou a escrever: em conversa com o robô, não sem dono", () => {
    // Aceitou o convite em 30/10 (o robô não limpa o `transferido_em`), perdido, reaberto hoje 10:00
    // e escreveu ao robô às 11:00. O aceite é da conversa antiga (11.3): não é "Aceitou o convite".
    const reab = brt("2026-11-04", "10:00");
    const l = lead({
      createdAt: brt("2026-10-30", "10:00"),
      roboVistoEm: brt("2026-11-04", "10:15"),
      roboSaudacaoEm: brt("2026-10-30", "10:01"),
      roboRespondeuEm: brt("2026-10-30", "10:20"),
      roboAceitouEm: brt("2026-10-30", "11:05"),
      roboUltimaMsgClienteEm: brt("2026-11-04", "11:00"),
      roboUltimaInteracaoEm: brt("2026-11-04", "11:00"),
      roboEtapa: "transferido",
    });
    const s = situacaoDoRobo(l, ctx({ reabertoEm: reab }));
    expect(s).toMatchObject({ etapa: "em_conversa", respondeu: true, aceitouEm: null, resgate: null, balde: "em-conversa" });
    expect(casaFiltroRobo(l, "em-conversa", s, { agora: AGORA, reabertoEm: reab })).toBe(true);
    // Com o convite renovado no episódio, "convite enviado" (o mesmo balde).
    const comConvite = lead({ ...l, roboConviteEm: brt("2026-11-04", "11:30") });
    expect(situacaoDoRobo(comConvite, ctx({ reabertoEm: reab }))).toMatchObject({ etapa: "convite_pendente", balde: "em-conversa" });
    // Sem reaberto, "transferido" continua sendo o aceite.
    expect(situacaoDoRobo(lead({ ...l, createdAt: brt("2026-11-04", "09:00") }), ctx()).etapa).toBe("transferido");
  });

  it("o último reaberto, por lead e entre vários leads", () => {
    const evs = [reaberto("a", brt("2026-11-01", "10:00")), reaberto("a", brt("2026-11-03", "10:00")), reaberto("b", brt("2026-11-02", "10:00"))];
    expect(reabertoDe(evs.filter((e) => e.leadId === "a"))).toBe(brt("2026-11-03", "10:00"));
    expect(reabertoDe([])).toBeUndefined();
    expect([...reabertosPorLead(evs)]).toEqual([
      ["a", brt("2026-11-03", "10:00")],
      ["b", brt("2026-11-02", "10:00")],
    ]);
  });
});

describe("o predicado único dos filtros do robô e a contagem 'sem a 1ª mensagem'", () => {
  const casa = (l: Lead, chave: FiltroRobo, extra: Partial<Parameters<typeof situacaoDoRobo>[1]> = {}) => {
    const c = ctx(extra);
    return casaFiltroRobo(l, chave, situacaoDoRobo(l, c), { agora: c.agora, reabertoEm: c.reabertoEm });
  };
  const quais = (l: Lead) => FILTROS_DO_ROBO.filter((k) => casa(l, k));

  it("cada pessoa cai na chave certa (as chaves com hífen batem com os links)", () => {
    expect(quais(lead({ roboVistoEm: brt("2026-11-04", "09:05"), roboSaudacaoEm: brt("2026-11-04", "09:01"), roboEtapa: "nao_respondeu" }))).toEqual(["esperando"]);
    expect(
      quais(lead({ roboVistoEm: brt("2026-11-04", "09:05"), roboSaudacaoEm: brt("2026-11-04", "09:01"), roboRespondeuEm: brt("2026-11-04", "09:10"), roboEtapa: "em_conversa" })),
    ).toEqual(["em-conversa"]);
    expect(quais(lead({ roboVistoEm: brt("2026-11-04", "09:05"), roboEtapa: "sem_whatsapp", roboSemWhatsappEm: brt("2026-11-04", "09:01") }))).toEqual([
      "resgate",
      "sem-whatsapp",
    ]);
    expect(quais(lead({ createdAt: brt("2026-10-20", "10:00") }))).toEqual(["antes"]);
    // Sem registro há 6 h: sem a 1ª mensagem E no resgate (passou de 2 h).
    expect(quais(lead())).toEqual(["resgate", "sem-1a-msg"]);
  });

  it("'aceitou o convite' vale para todo lead — com classe também —, até agendar ou encerrar", () => {
    const aceite = { roboVistoEm: brt("2026-11-04", "09:05"), roboEtapa: "transferido" as const, roboAceitouEm: brt("2026-11-04", "10:00") };
    expect(casa(lead(aceite), "convite-aceito")).toBe(true);
    expect(casa(lead({ ...aceite, classe: "A" }), "convite-aceito")).toBe(true);
    expect(casa(lead({ ...aceite, status: "agendado", bookedAt: AGORA }), "convite-aceito")).toBe(false);
    expect(casa(lead({ ...aceite, status: "sem_interesse" }), "convite-aceito")).toBe(false);
    // Agendou num episódio ANTERIOR (o marco fica), reaberto e aceitou de novo: confere o Calendly.
    expect(casa(lead({ ...aceite, bookedAt: brt("2026-10-31", "10:00") }), "convite-aceito")).toBe(true);
    // Agendou depois do aceite (outro jeito de chegar a um aberto com `bookedAt`, a mescla): já virou reunião.
    expect(casa(lead({ ...aceite, bookedAt: brt("2026-11-04", "11:00") }), "convite-aceito")).toBe(false);
    // Com classe, o resto do filtro do robô não se aplica (a live está congelada).
    expect(quais(lead({ classe: "B" }))).toEqual([]);
    expect(casa(lead(aceite), "convite-aceito", { ligado: false })).toBe(false);
  });

  it("'sem a 1ª mensagem': mais de 15 min contra a leitura e menos de 48 h contra agora", () => {
    expect(casa(lead({ createdAt: brt("2026-11-04", "14:45") }), "sem-1a-msg")).toBe(false); // 10 min na leitura
    expect(casa(lead({ createdAt: brt("2026-11-04", "14:40") }), "sem-1a-msg")).toBe(true);
    expect(casa(lead({ createdAt: brt("2026-11-02", "15:30") }), "sem-1a-msg")).toBe(true); // 47h30
    expect(casa(lead({ createdAt: brt("2026-11-02", "14:30") }), "sem-1a-msg")).toBe(false); // 48h30: falha antiga não é alerta eterno
  });

  it("semMensagemDoRobo: a contagem única (B1, alerta, Integrações), com quem nem chegou ao robô", () => {
    const leads = [
      lead({ createdAt: brt("2026-11-04", "14:00") }), // não chegou
      lead({ createdAt: brt("2026-11-04", "13:00"), roboVistoEm: brt("2026-11-04", "13:05"), roboRecebidoEm: brt("2026-11-04", "13:00"), roboEtapa: "sem_mensagem" }), // chegou, sem mensagem
      lead({ createdAt: brt("2026-11-04", "13:00"), roboVistoEm: brt("2026-11-04", "13:05"), roboSaudacaoEm: brt("2026-11-04", "13:01"), roboEtapa: "nao_respondeu" }), // saudou
      lead({ createdAt: brt("2026-11-04", "14:00"), classe: "A" }), // live: fora
      lead({ createdAt: brt("2026-11-04", "14:00"), phone: undefined }), // sem telefone: resgate, não B1
    ];
    const robo = { ligado: true, lidoAte: brt("2026-11-04", "14:55"), confiavel: true };
    const c = semMensagemDoRobo(leads, new Map(), robo, AGORA);
    expect(c).toMatchObject({ total: 2, naoChegaram: 1 });
    expect(c.ids.sort()).toEqual([leads[0].id, leads[1].id].sort());
    expect(semMensagemDoRobo(leads, new Map(), { ...robo, ligado: false }, AGORA).total).toBe(0);
    // O reaberto muda a base: o lead de setembro reaberto há 30 min também conta.
    const velho = lead({ createdAt: brt("2026-09-01", "09:00") });
    expect(semMensagemDoRobo([velho], new Map([[velho.id, brt("2026-11-04", "14:30")]]), robo, AGORA).total).toBe(1);
    expect(semMensagemDoRobo([velho], new Map(), robo, AGORA).total).toBe(0); // antes do robô
  });

  it("leitura parada: falhando, nunca feita ou há mais de 45 min", () => {
    const ok = (min: number) => ({ sync: { ultimoOk: new Date(Date.parse(AGORA) - min * 60_000).toISOString(), falha: null } });
    expect(leituraDoRoboParada(ok(10), AGORA)).toBe(false);
    expect(leituraDoRoboParada(ok(45), AGORA)).toBe(false);
    expect(leituraDoRoboParada(ok(46), AGORA)).toBe(true);
    expect(leituraDoRoboParada({ sync: { ultimoOk: null, falha: null } }, AGORA)).toBe(true);
    expect(leituraDoRoboParada({ sync: { ultimoOk: AGORA, falha: { desde: AGORA, erro: "x" } } }, AGORA)).toBe(true);
  });

  it("primeiro nome para o aviso: 'Lead sem nome' não é nome de ninguém", () => {
    expect(primeiroNome("  Maria  da Silva ")).toBe("Maria");
    expect(primeiroNome("Lead sem nome")).toBeNull();
    expect(primeiroNome("")).toBeNull();
  });
});
