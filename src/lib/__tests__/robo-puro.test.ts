/**
 * Fase 1 (nov/26), etapa A — o robô de WhatsApp no lead: a parte PURA.
 * Etapa do robô (cada ramo), normalização da linha, casamento por telefone,
 * frescor com a régua do robô e a fonte do pedido de sync. Fixture sintética.
 */
import { describe, expect, it } from "vitest";
import {
  aceitouConvite,
  etapaDoRobo,
  isoOuNull,
  lerRoboEtapa,
  normalizarLinhaRobo,
  recebeuConvite,
  type LinhaRobo,
} from "../robo/etapa";
import { casarLeadsDoRobo, patchDoLead } from "../robo/casar";
import { reabertosPorLead } from "../robo/situacao";
import { chaveTelefoneValida } from "../phone";
import { aplicarRobo, patchRoboVazio } from "../data/backend";
import { HORAS_MUITO_VELHO, HORAS_VELHO, LIMITES_DO_ROBO, frescorDaFonte } from "../frescor";
import { FONTES_DO_SYNC, lerFonteDoSync } from "../fonte-do-sync";
import type { Lead } from "../types";

const AGORA = "2026-11-04T15:00:00.000Z";

const linha = (extra: Partial<LinhaRobo> = {}): LinhaRobo => ({
  sessionId: "S-1",
  telefone: "5511987654321",
  status: null,
  statusAtendimento: null,
  turno: 2,
  conviteEnviado: false,
  conviteEnviadoEm: null,
  transferidoEm: null,
  criadoEm: "2026-11-03T12:00:00.000Z",
  ultimaInteracao: "2026-11-03T13:00:00.000Z",
  saudacaoEm: "2026-11-03T12:01:00.000Z",
  ultimaMsgClienteEm: "2026-11-03T12:30:00.000Z",
  followupsEnviados: 0,
  ultimoFollowupEm: null,
  roboEncerradoEm: null,
  optOut: false,
  optOutEm: null,
  botPausado: false,
  ...extra,
});

const lead = (id: string, extra: Partial<Lead> = {}): Lead => ({
  id,
  brand: "consorcio",
  createdAt: "2026-11-03T11:59:00.000Z",
  name: `Pessoa ${id}`,
  phone: "(11) 98765-4321",
  status: "lead",
  ...extra,
});

describe("etapaDoRobo — cada ramo", () => {
  it("Telefone sem WhatsApp vem antes de tudo", () => {
    expect(etapaDoRobo(linha({ status: "Telefone sem WhatsApp", turno: 0, saudacaoEm: null }))).toBe("sem_whatsapp");
    expect(etapaDoRobo(linha({ status: "telefone sem whatsapp", optOut: true }))).toBe("sem_whatsapp");
  });
  it("opt-out vem antes do CASE (pela flag ou pela data)", () => {
    expect(etapaDoRobo(linha({ optOut: true, transferidoEm: "2026-11-03T14:00:00.000Z" }))).toBe("opt_out");
    expect(etapaDoRobo(linha({ optOut: null, optOutEm: "2026-11-03T14:00:00.000Z" }))).toBe("opt_out");
  });
  it("turno 0: sem saudação é 'sem mensagem' (o robô não mandou); com saudação, 'não respondeu'", () => {
    expect(etapaDoRobo(linha({ turno: 0, saudacaoEm: null, ultimaMsgClienteEm: null }))).toBe("sem_mensagem");
    expect(etapaDoRobo(linha({ turno: 0, ultimaMsgClienteEm: null }))).toBe("nao_respondeu");
  });
  it("turno nulo conta como 0 só enquanto a pessoa não mandou nada", () => {
    expect(etapaDoRobo(linha({ turno: null, saudacaoEm: null, ultimaMsgClienteEm: null }))).toBe("sem_mensagem");
    expect(etapaDoRobo(linha({ turno: null }))).toBe("em_conversa");
  });
  it("aceitou o convite → transferido", () => {
    expect(etapaDoRobo(linha({ conviteEnviado: true, transferidoEm: "2026-11-03T14:00:00.000Z" }))).toBe("transferido");
    expect(etapaDoRobo(linha({ statusAtendimento: "Transferido" }))).toBe("transferido");
  });
  it("frio com convite → declinou; frio sem convite → frio (status_atendimento, como a view)", () => {
    expect(etapaDoRobo(linha({ statusAtendimento: "frio", conviteEnviado: true }))).toBe("declinou");
    expect(etapaDoRobo(linha({ statusAtendimento: "Frio", conviteEnviadoEm: "2026-11-03T13:30:00.000Z" }))).toBe("declinou");
    expect(etapaDoRobo(linha({ statusAtendimento: "frio" }))).toBe("frio");
  });
  it("convite enviado → convite pendente; senão em conversa", () => {
    expect(etapaDoRobo(linha({ conviteEnviado: true }))).toBe("convite_pendente");
    expect(etapaDoRobo(linha({ conviteEnviadoEm: "2026-11-03T13:30:00.000Z" }))).toBe("convite_pendente");
    expect(etapaDoRobo(linha())).toBe("em_conversa");
  });
  it("igualdade com os valores reais de status_atendimento, como o CASE da view (nada de 'contém')", () => {
    expect(etapaDoRobo(linha({ statusAtendimento: "qualificando" }))).toBe("em_conversa");
    expect(etapaDoRobo(linha({ statusAtendimento: "aguardando_autorizacao" }))).toBe("em_conversa");
    expect(etapaDoRobo(linha({ statusAtendimento: "Não transferido" }))).toBe("em_conversa");
    // `status` não decide frio nem transferido (só "Telefone sem WhatsApp")
    expect(etapaDoRobo(linha({ status: "Lead frio" }))).toBe("em_conversa");
    expect(etapaDoRobo(linha({ status: "Lead capturado landing page" }))).toBe("em_conversa");
  });
  it("UM predicado para a etapa e para os fatos: transferido só pelo status ainda é 'aceitou'", () => {
    const soStatus = linha({ turno: 3, statusAtendimento: "Transferido", transferidoEm: null });
    expect(aceitouConvite(soStatus)).toBe(true);
    expect(etapaDoRobo(soStatus)).toBe("transferido");
    // sem a data no robô, o fato leva a leitura (como sem WhatsApp e opt-out)
    expect(patchDoLead(lead("A"), soStatus, AGORA)?.roboAceitouEm).toBe(AGORA);
    // e conta como transferido sem lead quando não casa
    const r = casarLeadsDoRobo([{ ...soStatus, telefone: "5531933334444" }], [lead("A")], AGORA);
    expect(r).toMatchObject({ semLeadNoPainel: 1, transferidosSemLead: 1 });
    // convite pela flag, sem a data: etapa e fato juntos
    const soFlag = linha({ conviteEnviado: true, conviteEnviadoEm: null });
    expect(recebeuConvite(soFlag)).toBe(true);
    expect(etapaDoRobo(soFlag)).toBe("convite_pendente");
    expect(patchDoLead(lead("A"), soFlag, AGORA)?.roboConviteEm).toBe(AGORA);
    // com a data do robô, vale a data
    expect(patchDoLead(lead("A"), linha({ transferidoEm: "2026-11-03T14:00:00.000Z" }), AGORA)?.roboAceitouEm).toBe(
      "2026-11-03T14:00:00.000Z",
    );
  });
  it("a etapa gravada é lista fechada", () => {
    expect(lerRoboEtapa("em_conversa")).toBe("em_conversa");
    expect(lerRoboEtapa("quente")).toBeUndefined();
    expect(lerRoboEtapa(null)).toBeUndefined();
  });
});

describe("normalização da linha do PostgREST", () => {
  it("datas viram ISO de toISOString (microssegundos e fuso somem); tipos tolerantes", () => {
    expect(isoOuNull("2026-11-04T12:30:00.123456+00:00")).toBe("2026-11-04T12:30:00.123Z");
    expect(isoOuNull("2026-11-04 09:30:00-03")).toBe("2026-11-04T12:30:00.000Z");
    // sem fuso (`timestamp without time zone`): UTC, nunca o fuso do processo
    expect(isoOuNull("2026-11-04T09:30:00")).toBe("2026-11-04T09:30:00.000Z");
    expect(isoOuNull("2026-11-04 09:30:00.123456")).toBe("2026-11-04T09:30:00.123Z");
    expect(isoOuNull("2026-11-04 09:30")).toBe("2026-11-04T09:30:00.000Z");
    expect(isoOuNull("")).toBeNull();
    expect(isoOuNull("não é data")).toBeNull();
    const l = normalizarLinhaRobo({
      Session_id: "abc",
      Telefone: " 5511987654321 ",
      status: "Em conversa",
      turno: "3",
      convite_enviado: "sim",
      criado_em: "2026-11-03T12:00:00+00:00",
      followups_enviados: 2,
      opt_out: false,
      bot_pausado: null,
    });
    expect(l).toMatchObject({
      sessionId: "abc",
      telefone: "5511987654321",
      turno: 3,
      conviteEnviado: true,
      criadoEm: "2026-11-03T12:00:00.000Z",
      followupsEnviados: 2,
      optOut: false,
      botPausado: null,
      saudacaoEm: null,
    });
  });
});

describe("casamento pelo telefone", () => {
  it("13 dígitos no lead × 12 no robô (e o contrário) casam; lixo e vazio não", () => {
    const r = casarLeadsDoRobo(
      [linha({ sessionId: "S-12", telefone: "551187654321" })],
      [lead("L13", { phone: "+55 (11) 98765-4321" })],
      AGORA,
    );
    expect(r.casaram).toBe(1);
    expect(r.itens.map((i) => i.id)).toEqual(["L13"]);
    const r2 = casarLeadsDoRobo([linha({ telefone: "5511987654321" })], [lead("L12", { phone: "1187654321" })], AGORA);
    expect(r2.itens.map((i) => i.id)).toEqual(["L12"]);
    expect(chaveTelefoneValida("")).toBeNull();
    expect(chaveTelefoneValida("123")).toBeNull();
    expect(chaveTelefoneValida(null)).toBeNull();
  });

  it("linha sem telefone = semTelefone; sem lead = semLeadNoPainel (e os que aceitaram, à parte)", () => {
    const r = casarLeadsDoRobo(
      [
        linha({ sessionId: "S-a", telefone: "" }),
        linha({ sessionId: "S-b", telefone: null }),
        linha({ sessionId: "S-c", telefone: "5521911112222" }),
        linha({ sessionId: "S-d", telefone: "5531933334444", transferidoEm: "2026-11-03T14:00:00.000Z" }),
        linha({ sessionId: "S-e" }),
      ],
      [lead("A")],
      AGORA,
    );
    expect(r).toMatchObject({ lidos: 5, casaram: 1, semTelefone: 2, semLeadNoPainel: 2, transferidosSemLead: 1 });
    // nada de telefone no que sai daqui
    expect(JSON.stringify(r)).not.toMatch(/9111|3333|98765/);
  });

  it("duas linhas do robô com o mesmo telefone: vale a de ultima_interacao mais recente", () => {
    const velha = linha({ sessionId: "S-velha", ultimaInteracao: "2026-11-02T10:00:00.000Z", followupsEnviados: 2 });
    const nova = linha({ sessionId: "S-nova", telefone: "551187654321", ultimaInteracao: "2026-11-03T20:00:00.000Z", followupsEnviados: 1 });
    const r = casarLeadsDoRobo([nova, velha], [lead("A")], AGORA);
    expect(r.casaram).toBe(1);
    expect(r.itens[0].patch.roboCobrancas).toBe(1);
    expect(casarLeadsDoRobo([velha, nova], [lead("A")], AGORA).itens[0].patch.roboCobrancas).toBe(1);
    // empate na interação: criado_em, depois Session_id
    const a = linha({ sessionId: "S-a", followupsEnviados: 5 });
    const b = linha({ sessionId: "S-b", followupsEnviados: 6 });
    expect(casarLeadsDoRobo([a, b], [lead("A")], AGORA).itens[0].patch.roboCobrancas).toBe(6);
    expect(casarLeadsDoRobo([b, a], [lead("A")], AGORA).itens[0].patch.roboCobrancas).toBe(6);
  });

  it("duas linhas com a mesma chave: o opt-out de QUALQUER uma vale (12 × 13 dígitos, opt-out na linha mais antiga)", () => {
    // S-1: pediu para não receber mensagens em 01/11. S-2: outra sessão, sem o nono
    // dígito, mais recente e sem opt-out. Antes, valia só a S-2 e o opt-out se perdia.
    const comOptOut = linha({
      sessionId: "S-1",
      telefone: "5511987650001",
      optOut: true,
      optOutEm: "2026-11-01T14:00:00.000Z",
      ultimaInteracao: "2026-11-01T13:00:00.000Z",
    });
    const semOptOut = linha({ sessionId: "S-2", telefone: "551187650001", optOut: false, ultimaInteracao: "2026-11-03T13:00:00.000Z" });
    expect(chaveTelefoneValida(comOptOut.telefone)).toBe(chaveTelefoneValida(semOptOut.telefone));
    const l1 = lead("L1", { phone: "(11) 98765-0001" });
    for (const ordem of [
      [comOptOut, semOptOut],
      [semOptOut, comOptOut],
    ]) {
      const r = casarLeadsDoRobo(ordem, [l1], AGORA);
      expect(r.casaram).toBe(1);
      expect(r.itens[0].patch).toMatchObject({
        roboOptOutEm: "2026-11-01T14:00:00.000Z",
        roboEtapa: "opt_out",
        roboUltimaInteracaoEm: "2026-11-03T13:00:00.000Z", // o resto continua da mais recente
      });
    }
    // Flag sem data nas duas: a leitura. Com uma data e uma flag sem data: a data.
    const soFlag = { ...comOptOut, optOutEm: null };
    expect(casarLeadsDoRobo([soFlag, semOptOut], [l1], AGORA).itens[0].patch.roboOptOutEm).toBe(AGORA);
    expect(casarLeadsDoRobo([soFlag, { ...semOptOut, optOut: true, optOutEm: "2026-11-02T10:00:00.000Z" }], [l1], AGORA).itens[0].patch.roboOptOutEm).toBe(
      "2026-11-02T10:00:00.000Z",
    );
    // Sem opt-out em nenhuma, nada muda.
    expect(casarLeadsDoRobo([{ ...comOptOut, optOut: false, optOutEm: null }, semOptOut], [l1], AGORA).itens[0].patch).not.toHaveProperty("roboOptOutEm");
  });

  it("dois leads ATIVOS com o mesmo telefone recebem o MESMO estado (nenhum fica 'não recebido')", () => {
    const r = casarLeadsDoRobo(
      [linha()],
      [lead("A"), lead("B", { phone: "5511987654321", createdAt: "2026-11-03T12:10:00.000Z" }), lead("X", { deletedAt: AGORA })],
      AGORA,
    );
    expect(r.casaram).toBe(1);
    expect(r.itens.map((i) => i.id).sort()).toEqual(["A", "B"]);
    expect(r.itens[0].patch).toEqual(r.itens[1].patch);
    expect(r.itens[0].patch.roboVistoEm).toBe(AGORA);
  });

  it("o patch traz os fatos e o estado da linha; o status nunca entra", () => {
    const p = patchDoLead(
      lead("A"),
      linha({
        followupsEnviados: 2,
        ultimoFollowupEm: "2026-11-03T18:00:00.000Z",
        conviteEnviado: true,
        conviteEnviadoEm: "2026-11-03T13:30:00.000Z",
        botPausado: true,
      }),
      AGORA,
    );
    expect(p).toEqual({
      roboVistoEm: AGORA,
      roboRecebidoEm: "2026-11-03T12:00:00.000Z",
      roboSaudacaoEm: "2026-11-03T12:01:00.000Z",
      roboRespondeuEm: "2026-11-03T12:30:00.000Z",
      roboConviteEm: "2026-11-03T13:30:00.000Z",
      roboUltimaMsgClienteEm: "2026-11-03T12:30:00.000Z",
      roboUltimaInteracaoEm: "2026-11-03T13:00:00.000Z",
      roboEtapa: "convite_pendente",
      roboCobrancas: 2,
      roboUltimaCobrancaEm: "2026-11-03T18:00:00.000Z",
      roboPausado: true,
    });
    expect(p).not.toHaveProperty("status");
  });

  it("sem WhatsApp: a data é o criado_em do robô; sem ele, a leitura. Opt-out sem data = a leitura", () => {
    expect(patchDoLead(lead("A"), linha({ status: "Telefone sem WhatsApp" }), AGORA)?.roboSemWhatsappEm).toBe(
      "2026-11-03T12:00:00.000Z",
    );
    expect(patchDoLead(lead("A"), linha({ status: "Telefone sem WhatsApp", criadoEm: null }), AGORA)?.roboSemWhatsappEm).toBe(AGORA);
    expect(patchDoLead(lead("A"), linha({ optOut: true }), AGORA)?.roboOptOutEm).toBe(AGORA);
    expect(patchDoLead(lead("A"), linha({ optOut: true, optOutEm: "2026-11-03T19:00:00.000Z" }), AGORA)?.roboOptOutEm).toBe(
      "2026-11-03T19:00:00.000Z",
    );
  });

  it("só o que MUDOU: a 2ª leitura igual não gera patch; UMA VEZ fica; o estado troca e null limpa", () => {
    const l = lead("A");
    const primeira = patchDoLead(l, linha(), AGORA)!;
    aplicarRobo(l, primeira);
    expect(patchDoLead(l, linha(), "2026-11-04T15:15:00.000Z")).toBeNull();
    expect(casarLeadsDoRobo([linha()], [l], "2026-11-04T15:15:00.000Z").itens).toEqual([]);

    // nova mensagem do cliente: a última troca; o "respondeu" (UMA VEZ) fica
    const depois = patchDoLead(
      l,
      linha({ ultimaMsgClienteEm: "2026-11-04T10:00:00.000Z", ultimaInteracao: "2026-11-04T10:00:00.000Z", botPausado: null }),
      "2026-11-04T15:15:00.000Z",
    )!;
    expect(depois).toEqual({
      roboUltimaMsgClienteEm: "2026-11-04T10:00:00.000Z",
      roboUltimaInteracaoEm: "2026-11-04T10:00:00.000Z",
      roboPausado: null,
    });
    aplicarRobo(l, depois);
    expect(l.roboRespondeuEm).toBe("2026-11-03T12:30:00.000Z");
    expect(l.roboVistoEm).toBe(AGORA);
    expect(l.roboPausado).toBeUndefined();
    expect(l.status).toBe("lead");
  });

  it("datas pelo INSTANTE: o lead lido do Supabase ('…+00:00') e a mesma leitura não geram patch", () => {
    const l = lead("A", {
      roboVistoEm: "2026-11-04T14:00:00+00:00",
      roboRecebidoEm: "2026-11-03T12:00:00+00:00",
      roboSaudacaoEm: "2026-11-03T12:01:00+00:00",
      roboRespondeuEm: "2026-11-03T12:30:00+00:00",
      roboUltimaMsgClienteEm: "2026-11-03T12:30:00+00:00",
      roboUltimaInteracaoEm: "2026-11-03T13:00:00+00:00",
      roboUltimaCobrancaEm: "2026-11-03T18:00:00+00:00",
      roboEncerradoEm: "2026-11-03T19:00:00+00:00",
      roboEtapa: "em_conversa",
      roboCobrancas: 1,
      roboPausado: false,
    });
    const igual = linha({
      followupsEnviados: 1,
      ultimoFollowupEm: "2026-11-03T18:00:00.000Z",
      roboEncerradoEm: "2026-11-03T19:00:00.000Z",
    });
    expect(patchDoLead(l, igual, AGORA)).toBeNull();
    expect(casarLeadsDoRobo([igual], [l], AGORA).itens).toEqual([]);
    // mudou de verdade: só o campo que mudou
    expect(patchDoLead(l, { ...igual, ultimaInteracao: "2026-11-03T13:05:00.000Z" }, AGORA)).toEqual({
      roboUltimaInteracaoEm: "2026-11-03T13:05:00.000Z",
    });
  });

  it("reaberto (11.3): os fatos de antes recomeçam com o 1º do episódio novo; opt-out e sem WhatsApp, não", () => {
    const REAB = "2026-11-10T12:00:00.000Z";
    const DEPOIS = "2026-11-10T12:15:00.000Z";
    const l = lead("A", {
      roboVistoEm: "2026-10-30T12:00:00.000Z",
      roboRecebidoEm: "2026-10-30T11:59:00.000Z",
      roboSaudacaoEm: "2026-10-30T12:01:00.000Z",
      roboRespondeuEm: "2026-10-30T12:30:00.000Z",
      roboUltimaMsgClienteEm: "2026-10-30T12:30:00.000Z",
      roboUltimaInteracaoEm: "2026-10-30T13:00:00.000Z",
      roboOptOutEm: "2026-10-30T14:00:00.000Z",
      roboEtapa: "opt_out",
      roboCobrancas: 0,
      roboPausado: false,
    });
    // a MESMA conversa antiga, lida depois do reaberto: só o "visto" recomeça (o robô tem a pessoa)
    const antiga = linha({
      criadoEm: "2026-10-30T11:59:00.000Z",
      saudacaoEm: "2026-10-30T12:01:00.000Z",
      ultimaMsgClienteEm: "2026-10-30T12:30:00.000Z",
      ultimaInteracao: "2026-10-30T13:00:00.000Z",
      optOutEm: "2026-10-30T14:00:00.000Z",
    });
    const p1 = patchDoLead(l, antiga, DEPOIS, REAB)!;
    expect(p1).toEqual({ roboVistoEm: DEPOIS, reabertoEm: REAB });
    aplicarRobo(l, p1);
    expect(l.roboVistoEm).toBe(DEPOIS);
    expect(l.roboSaudacaoEm).toBe("2026-10-30T12:01:00.000Z");
    expect(patchDoLead(l, antiga, "2026-11-10T12:30:00.000Z", REAB)).toBeNull();

    // o robô saúda de novo e a pessoa aceita: entram; o opt-out (vale sempre) fica
    const nova = linha({
      criadoEm: "2026-11-10T12:01:00.000Z",
      saudacaoEm: "2026-11-10T12:02:00.000Z",
      ultimaMsgClienteEm: "2026-11-10T12:20:00.000Z",
      ultimaInteracao: "2026-11-10T12:40:00.000Z",
      transferidoEm: "2026-11-10T12:40:00.000Z",
      optOutEm: "2026-11-10T12:10:00.000Z",
    });
    const p2 = patchDoLead(l, nova, "2026-11-10T12:45:00.000Z", REAB)!;
    expect(p2).toMatchObject({
      reabertoEm: REAB,
      roboRecebidoEm: "2026-11-10T12:01:00.000Z",
      roboSaudacaoEm: "2026-11-10T12:02:00.000Z",
      roboRespondeuEm: "2026-11-10T12:20:00.000Z",
      roboAceitouEm: "2026-11-10T12:40:00.000Z",
    });
    expect(p2).not.toHaveProperty("roboOptOutEm");
    expect(p2).not.toHaveProperty("roboVistoEm"); // já é do episódio novo
    aplicarRobo(l, p2);
    expect(l).toMatchObject({ roboSaudacaoEm: "2026-11-10T12:02:00.000Z", roboOptOutEm: "2026-10-30T14:00:00.000Z" });

    // dentro do episódio novo, UMA VEZ volta a valer
    aplicarRobo(l, { reabertoEm: REAB, roboSaudacaoEm: "2026-11-11T09:00:00.000Z" });
    expect(l.roboSaudacaoEm).toBe("2026-11-10T12:02:00.000Z");
    // sem reaberto, nada recomeça
    expect(patchDoLead(lead("B", { roboSaudacaoEm: "2026-10-30T12:01:00.000Z" }), nova, AGORA)).not.toHaveProperty(
      "roboSaudacaoEm",
    );
  });

  it("reaberto com o aceite só pelo STATUS (sem transferido_em): o 'transferido' antigo não vira aceite novo; a conversa nova, sim", () => {
    // 1ª leitura (30/10): sem a data no robô, o aceite e o convite levam a hora da leitura.
    const soStatus = linha({
      turno: 3,
      statusAtendimento: "transferido",
      conviteEnviado: true,
      conviteEnviadoEm: null,
      transferidoEm: null,
      ultimaInteracao: "2026-10-30T14:00:00.000Z",
    });
    const l = lead("A");
    aplicarRobo(l, patchDoLead(l, soStatus, "2026-10-30T15:00:00.000Z")!);
    expect(l).toMatchObject({ roboAceitouEm: "2026-10-30T15:00:00.000Z", roboConviteEm: "2026-10-30T15:00:00.000Z" });
    // Perdido e reaberto em 10/11; o robô NÃO mexeu na conversa: só o "visto" recomeça.
    const REAB = "2026-11-10T12:00:00.000Z";
    const p = patchDoLead(l, soStatus, "2026-11-10T12:15:00.000Z", REAB)!;
    expect(p).not.toHaveProperty("roboAceitouEm");
    expect(p).not.toHaveProperty("roboConviteEm");
    expect(p).toMatchObject({ roboVistoEm: "2026-11-10T12:15:00.000Z", reabertoEm: REAB });
    // O robô interagiu depois do reaberto e a linha diz "transferido": o aceite é do episódio novo.
    const novo = { ...soStatus, ultimaInteracao: "2026-11-10T13:00:00.000Z" };
    expect(patchDoLead(l, novo, "2026-11-10T13:15:00.000Z", REAB)).toMatchObject({
      roboAceitouEm: "2026-11-10T13:15:00.000Z",
      roboConviteEm: "2026-11-10T13:15:00.000Z",
    });
    // Com a data do robô, vale a data (a antiga nunca recomeça; a nova, sim).
    expect(patchDoLead(l, { ...soStatus, transferidoEm: "2026-10-30T14:00:00.000Z" }, "2026-11-10T12:15:00.000Z", REAB)).not.toHaveProperty(
      "roboAceitouEm",
    );
  });

  it("reabertosPorLead (a MESMA leitura do sync, da Fila e de situacaoDoRobo): o último `reaberto` de cada lead, e só deles", () => {
    const ev = (leadId: string, action: string, createdAt: string) =>
      ({ leadId, action, createdAt }) as Parameters<typeof reabertosPorLead>[0][number];
    const m = reabertosPorLead([
      ev("A", "reaberto", "2026-11-05T10:00:00.000Z"),
      ev("A", "reaberto", "2026-11-10T12:00:00.000Z"),
      ev("A", "reaberto", "2026-11-07T12:00:00.000Z"),
      ev("B", "tentativa", "2026-11-10T12:00:00.000Z"),
    ]);
    expect([...m]).toEqual([["A", "2026-11-10T12:00:00.000Z"]]);
  });

  it("aplicarRobo: ausente fica, null limpa só o que sobrescreve; patch vazio é vazio", () => {
    const l = lead("A", { roboSaudacaoEm: "2026-11-03T12:01:00.000Z", roboEtapa: "em_conversa", roboCobrancas: 1 });
    aplicarRobo(l, { roboSaudacaoEm: "2026-11-04T00:00:00.000Z", roboEtapa: null, roboCobrancas: 0 });
    expect(l.roboSaudacaoEm).toBe("2026-11-03T12:01:00.000Z");
    expect(l.roboEtapa).toBeUndefined();
    expect(l.roboCobrancas).toBe(0);
    expect(patchRoboVazio({})).toBe(true);
    expect(patchRoboVazio({ reabertoEm: AGORA })).toBe(true);
    expect(patchRoboVazio({ roboPausado: null })).toBe(false);
  });
});

describe("frescor com a régua do robô (minutos)", () => {
  const agora = new Date("2026-11-04T15:00:00Z");
  it("velho depois de 45 min, muito velho depois de 3 h; a idade sai em minutos", () => {
    expect(frescorDaFonte("Robô", "2026-11-04T14:30:00Z", agora, null, LIMITES_DO_ROBO).nivel).toBe("ok");
    const velho = frescorDaFonte("Robô", "2026-11-04T14:10:00Z", agora, null, LIMITES_DO_ROBO);
    expect(velho.nivel).toBe("velho");
    expect(velho.detalhe).toMatch(/há 50 min/);
    expect(velho.detalhe).not.toMatch(/há 0 h/);
    const muito = frescorDaFonte("Robô", "2026-11-04T11:50:00Z", agora, null, LIMITES_DO_ROBO);
    expect(muito.nivel).toBe("muito-velho");
    expect(muito.detalhe).toMatch(/há 3 h 10 min/);
    expect(muito.quando).toBe("04/11 08:50");
  });
  it("sem limites, a régua do cron diário (26/50 h) não muda", () => {
    expect([HORAS_VELHO, HORAS_MUITO_VELHO]).toEqual([26, 50]);
    expect(frescorDaFonte("Meta", "2026-11-04T11:50:00Z", agora).nivel).toBe("ok");
    expect(frescorDaFonte("Meta", "2026-11-03T11:00:00Z", agora).detalhe).toMatch(/há 28 h/);
  });
  it("falhando continua dito, com a régua do robô", () => {
    const f = frescorDaFonte("Robô", "2026-11-04T14:50:00Z", agora, { desde: "2026-11-04T14:55:00Z", erro: "x" }, LIMITES_DO_ROBO);
    expect(f).toMatchObject({ nivel: "ok", falhando: true });
    expect(f.detalhe).toMatch(/falhando desde 04\/11 11:55/);
  });
});

describe("fonte do pedido de sync", () => {
  it("sem fonte = all; as quatro conhecidas passam; o resto é erro de uso (nunca 'all')", () => {
    expect(lerFonteDoSync(null)).toBe("all");
    expect(lerFonteDoSync("")).toBe("all");
    for (const f of FONTES_DO_SYNC) expect(lerFonteDoSync(f)).toBe(f);
    expect(lerFonteDoSync("robô")).toBeNull();
    expect(lerFonteDoSync("ROBO")).toBeNull();
    expect(lerFonteDoSync("tudo")).toBeNull();
  });
});
