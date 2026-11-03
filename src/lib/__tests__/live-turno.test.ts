/**
 * Live 01/12 — o relógio do atendimento (turno 16h–22h seg–sex, sem 20/11), o
 * prazo da 1ª tentativa por classe, a cadência e a Fila da live. Datas em UTC;
 * Brasília = UTC−3 (19h BRT = 22h UTC).
 */
import { describe, expect, it } from "vitest";
import {
  EXPEDIENTE_PADRAO,
  dentroDoTurno,
  faixasForaDoTurno,
  fimDoTurno,
  horasDoTurnoEntre,
  inicioDaFaixa,
  lerExpediente,
  prazoDaPrimeiraTentativa,
  proximaTentativaDoTurno,
  somarHorasDoTurno,
} from "../turno";
import { montarFilaDaLive, tempoAtePrazo } from "../fila-live";
import type { Lead, LeadEvent } from "../types";

const cfg = EXPEDIENTE_PADRAO;
// 17/11/2026 é terça; 20/11 (sexta) é feriado; 21–22/11 fim de semana.

describe("turno — o relógio do atendimento", () => {
  it("dentro e fora do turno, feriado e fim de semana", () => {
    expect(dentroDoTurno("2026-11-17T22:00:00.000Z", cfg)).toBe(true); // ter 19h
    expect(dentroDoTurno("2026-11-17T18:00:00.000Z", cfg)).toBe(false); // ter 15h
    expect(dentroDoTurno("2026-11-18T01:30:00.000Z", cfg)).toBe(false); // ter 22h30
    expect(dentroDoTurno("2026-11-20T22:00:00.000Z", cfg)).toBe(false); // 20/11 feriado
    expect(dentroDoTurno("2026-11-21T22:00:00.000Z", cfg)).toBe(false); // sábado
  });

  it("somar horas do turno pula a noite, o feriado e o fim de semana", () => {
    // ter 21h30 + 1 h do turno = 30 min ter + 30 min qua → qua 16h30
    expect(somarHorasDoTurno("2026-11-18T00:30:00.000Z", 1, cfg)).toBe("2026-11-18T19:30:00.000Z");
    // qui 21h30 + 1 h → sexta é feriado e o fim de semana não conta → seg 23/11 16h30
    expect(somarHorasDoTurno("2026-11-20T00:30:00.000Z", 1, cfg)).toBe("2026-11-23T19:30:00.000Z");
    // fora do turno conta da abertura: ter 10h + 1 h → ter 17h
    expect(somarHorasDoTurno("2026-11-17T13:00:00.000Z", 1, cfg)).toBe("2026-11-17T20:00:00.000Z");
    expect(horasDoTurnoEntre("2026-11-17T13:00:00.000Z", "2026-11-18T20:00:00.000Z", cfg)).toBe(7);
  });

  it("fim do turno: o do dia, se ainda não acabou; senão o do próximo dia útil", () => {
    expect(fimDoTurno("2026-11-17T13:00:00.000Z", cfg)).toBe("2026-11-18T01:00:00.000Z"); // ter 10h → ter 22h
    expect(fimDoTurno("2026-11-18T01:30:00.000Z", cfg)).toBe("2026-11-19T01:00:00.000Z"); // ter 22h30 → qua 22h
    expect(fimDoTurno("2026-11-20T15:00:00.000Z", cfg)).toBe("2026-11-24T01:00:00.000Z"); // feriado → seg 22h
  });

  it("início da faixa escolhida: hoje se ainda não começou, num dia útil", () => {
    expect(inicioDaFaixa("2026-11-17T13:00:00.000Z", "noite", cfg)).toBe("2026-11-17T21:00:00.000Z"); // ter 18h
    expect(inicioDaFaixa("2026-11-17T22:00:00.000Z", "noite", cfg)).toBe("2026-11-18T21:00:00.000Z"); // já começou → qua
    expect(inicioDaFaixa("2026-11-19T22:00:00.000Z", "manha", cfg)).toBe("2026-11-23T12:00:00.000Z"); // qui → seg 9h
  });
});

describe("prazo da 1ª tentativa (prazo_tentativa)", () => {
  const p = (createdAt: string, classe: Lead["classe"], horarioPreferido?: Lead["horarioPreferido"]) =>
    prazoDaPrimeiraTentativa({ createdAt, classe, horarioPreferido }, cfg);

  it("A dentro do turno = inscrição + 1 h", () => {
    expect(p("2026-11-17T22:10:00.000Z", "A")).toBe("2026-11-17T23:10:00.000Z"); // 19h10 → 20h10
  });
  it("A fora do turno = início do turno seguinte + 1 h", () => {
    expect(p("2026-11-17T13:00:00.000Z", "A")).toBe("2026-11-17T20:00:00.000Z"); // 10h → 17h
    expect(p("2026-11-18T02:00:00.000Z", "A")).toBe("2026-11-18T20:00:00.000Z"); // 23h → qua 17h
  });
  it("A com horário escolhido = início da faixa no próximo dia útil + 1 h", () => {
    expect(p("2026-11-17T13:00:00.000Z", "A", "noite")).toBe("2026-11-17T22:00:00.000Z"); // 18h + 1 h
  });
  it("B = fim do turno do dia (ou do próximo dia útil)", () => {
    expect(p("2026-11-17T22:10:00.000Z", "B")).toBe("2026-11-18T01:00:00.000Z");
    expect(p("2026-11-18T01:30:00.000Z", "B")).toBe("2026-11-19T01:00:00.000Z");
  });
  it("C, X e sem classe não têm prazo (fora da Fila da live)", () => {
    expect(p("2026-11-17T22:10:00.000Z", "C")).toBeUndefined();
    expect(p("2026-11-17T22:10:00.000Z", "X")).toBeUndefined();
    expect(p("2026-11-17T22:10:00.000Z", undefined)).toBeUndefined();
  });
});

describe("cadência: ligação → áudio 4 h do turno depois → ligação 24 h depois", () => {
  it("2ª e 3ª tentativas, e o fim da cadência", () => {
    // ligou ter 19h → áudio 4 h do turno depois: 3 h ter + 1 h qua → qua 17h
    expect(proximaTentativaDoTurno("2026-11-17T22:00:00.000Z", 1, cfg)).toBe("2026-11-18T20:00:00.000Z");
    // áudio qua 17h → ligação 24 h depois: qui 17h (dentro do turno)
    expect(proximaTentativaDoTurno("2026-11-18T20:00:00.000Z", 2, cfg)).toBe("2026-11-19T20:00:00.000Z");
    // áudio qui 21h → 24 h depois cai na sexta (feriado): vai para a abertura de seg
    expect(proximaTentativaDoTurno("2026-11-20T00:00:00.000Z", 2, cfg)).toBe("2026-11-23T19:00:00.000Z");
    expect(proximaTentativaDoTurno("2026-11-19T20:00:00.000Z", 3, cfg)).toBeUndefined();
  });
});

describe("expediente gravado e faixas fora do turno", () => {
  it("o que vier torto cai no padrão, campo a campo", () => {
    const e = lerExpediente({ dias: { 1: { inicio: "08:00", fim: "17:00" }, 2: { inicio: "18:00", fim: "10:00" } }, feriados: ["2026-12-25", "lixo"], prazoAHoras: -1 });
    expect(e.dias[1]).toEqual({ inicio: "08:00", fim: "17:00" });
    expect(e.dias[2]).toBeUndefined(); // fim antes do início: sem expediente
    expect(e.feriados).toEqual(["2026-12-25"]);
    expect(e.prazoAHoras).toBe(1);
  });
  it("com turno 16h–22h, a Manhã não cruza turno nenhum (a tela avisa)", () => {
    expect(faixasForaDoTurno(cfg)).toEqual(["manha"]);
  });
});

describe("Fila da live — A e B, por prazo", () => {
  const lead = (id: string, createdAt: string, extra: Partial<Lead>): Lead => ({
    id,
    brand: "consorcio",
    createdAt,
    name: `Pessoa ${id}`,
    status: "lead",
    ...extra,
  });
  const tentativa = (leadId: string, em: string, payload: Record<string, string>): LeadEvent => ({
    id: `t-${leadId}-${em}`,
    leadId,
    leadName: "P",
    actor: "eduardo",
    action: "tentativa",
    payload,
    occurredAt: em,
    createdAt: em,
  });
  const AGORA = "2026-11-18T00:30:00.000Z"; // ter 21h30

  it("só A e B, ordenados pelo prazo; C, X e sem classe ficam fora", () => {
    const leads = [
      lead("b", "2026-11-17T22:00:00.000Z", { classe: "B" }), // prazo ter 22h
      lead("a", "2026-11-17T22:10:00.000Z", { classe: "A" }), // prazo ter 20h10 — atrasado
      lead("c", "2026-11-17T22:10:00.000Z", { classe: "C" }),
      lead("x", "2026-11-17T22:10:00.000Z", { classe: "X" }),
      lead("s", "2026-11-17T22:10:00.000Z", {}),
      lead("n", "2026-11-17T22:20:00.000Z", { classeN8n: "A" }), // sem classe do painel: vale a do n8n
    ];
    const fila = montarFilaDaLive(leads, [], AGORA, cfg);
    expect(fila.map((i) => i.leadId)).toEqual(["a", "n", "b"]);
    expect(fila[0]).toMatchObject({ etapa: "primeira", atrasado: true, minutosParaPrazo: -80 });
    expect(fila[2]).toMatchObject({ atrasado: false, minutosParaPrazo: 30 });
  });

  it("tentou e não falou → próxima da cadência; falou sem desfecho → retornar; janela vencida → encerrar", () => {
    const leads = [
      lead("cad", "2026-11-17T22:00:00.000Z", { classe: "A", status: "em_contato" }),
      lead("ret", "2026-11-17T22:00:00.000Z", { classe: "B", status: "em_contato" }),
      lead("enc", "2026-11-13T22:00:00.000Z", { classe: "A", status: "em_contato" }),
      lead("ag", "2026-11-17T22:00:00.000Z", { classe: "A", status: "agendado", meetingFor: "2026-11-25T22:00:00.000Z" }),
    ];
    const eventos = [
      tentativa("cad", "2026-11-17T23:00:00.000Z", { canal: "ligacao", falou: "nao", resultado: "nao_atendeu", proxima: "2026-11-18T21:00:00.000Z" }),
      tentativa("ret", "2026-11-17T23:00:00.000Z", { canal: "ligacao", falou: "sim", resultado: "falou" }),
      tentativa("enc", "2026-11-13T23:00:00.000Z", { canal: "ligacao", falou: "nao", resultado: "nao_atendeu", proxima: "2026-11-16T20:00:00.000Z" }),
    ];
    const porId = Object.fromEntries(montarFilaDaLive(leads, eventos, AGORA, cfg).map((i) => [i.leadId, i]));
    expect(porId.cad).toMatchObject({ etapa: "cadencia", prazo: "2026-11-18T21:00:00.000Z" });
    expect(porId.ret).toMatchObject({ etapa: "retornar", prazo: "2026-11-18T23:00:00.000Z" });
    // a próxima da cadência (16/11) já passou do fim da janela de 48 h (15/11 22h): encerrar
    expect(porId.enc).toMatchObject({ etapa: "encerrar", prazo: "2026-11-15T22:00:00.000Z", atrasado: true });
    expect(porId.ag).toBeUndefined(); // reunião é etapa da Fila de sempre
  });

  it("tempo até o prazo em palavras", () => {
    expect(tempoAtePrazo(40)).toBe("faltam 40 min");
    expect(tempoAtePrazo(-130)).toBe("atrasado 2 h 10 min");
    expect(tempoAtePrazo(-60 * 26)).toBe("atrasado 1 d 2 h");
  });
});
