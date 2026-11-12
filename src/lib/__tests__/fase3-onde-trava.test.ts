/**
 * Fase 3 (§8.3 da spec + o adendo F3-D31) — "onde trava" (`lib/onde-trava.ts`): a
 * maior perda em PESSOAS, saída das juntas do funil do processo — sem meta, sem
 * média. Confere a escolha (maior, empate pela mais funda, amostra), a leitura
 * parada (K6), o "ainda no prazo" de cada junta (K7, K16), o outro caminho (K21),
 * o link (o grupo da Fila com mais travados, sem número — F3-D22), o texto (K9,
 * K32) e que Funil, Início e IA leem a MESMA função (K8).
 *
 * O "⚠" no HTML da manchete com a leitura parada é conferido na tela
 * (`fase3-funil-tela.test.ts`), onde a página é renderizada.
 *
 * Fixtures sintéticas (`src/test/fixtures-robo.ts`, `src/test/fixtures-funil.ts`).
 * AGORA = quarta 04/11/2026 15:00 de Brasília; o robô lido às 14:55.
 */
import { describe, expect, it } from "vitest";
import { inicioParaIA } from "../ai/briefing";
import { ATOR_LP } from "../diagnostico-leads";
import { dica } from "../dicionario";
import { DONO_LABEL } from "../dono";
import { FILA_ETAPAS, montarFila, type FilaEtapa } from "../fila";
import { formatInt } from "../format";
import { montarFunilDaTela } from "../funil";
import { funilDoProcesso, type FunilDoProcesso, type JuntaDoProcesso, type JuntaId } from "../funil-processo";
import { montarInicio, type EntradaInicio } from "../inicio";
import type { DateRange } from "../metrics";
import { TITULO_DA_JUNTA, ondeTrava, resumoDaTrava, type OndeTrava } from "../onde-trava";
import { comPeriodo } from "../range";
import type { RoboAgora } from "../robo/situacao";
import type { Lead, LeadEvent } from "../types";
import { AGORA, HOJE, LEADS_DO_ROBO, ONTEM, PARADO, ROBO, SEMANA, brt, entradaDoRobo, lead, reaberto, saudado } from "@/test/fixtures-robo";
import { aceitouAs, conversou, entradaEm, saudadoAs, tentativa } from "@/test/fixtures-funil";

// ---------------------------------------------------------------- utilidades

function semana(leads: Lead[], o: { robo?: RoboAgora | null; eventos?: LeadEvent[]; range?: DateRange | null } = {}): EntradaInicio {
  return entradaEm({
    leads,
    range: o.range === undefined ? SEMANA : o.range,
    agora: AGORA,
    hoje: HOJE,
    robo: o.robo === undefined ? ROBO : o.robo,
    eventos: o.eventos,
  });
}

/** Todas as respostas com trava deste arquivo, para as conferências de texto e de link no fim. */
const COM_TRAVA: { o: OndeTrava; comRobo: boolean }[] = [];

function trava(e: EntradaInicio): { p: FunilDoProcesso; o: OndeTrava } {
  const p = funilDoProcesso(e);
  const o = ondeTrava(p, { rangeKey: e.rangeKey });
  if (o.situacao === "trava") COM_TRAVA.push({ o, comRobo: Boolean(e.robo?.ligado) });
  return { p, o };
}

const junta = (p: FunilDoProcesso, id: JuntaId): JuntaDoProcesso => {
  const j = p.juntas.find((x) => x.id === id);
  if (!j) throw new Error(`junta ${id} ausente`);
  return j;
};

/** A régua de palavras da tela (`palavras()` de `src/test/tela.ts`), sobre texto puro. */
const nPalavras = (t: string) => t.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p)).length;

const linkDe = (g: FilaEtapa, rangeKey: string) => ({ href: comPeriodo(`/fila?etapa=${g}#${g}`, rangeKey), rotulo: `${FILA_ETAPAS[g].label} →` });

// ---------------------------------------------------------------- grupos de leads (ids próprios por chamada)

let grupo = 0;
const varios = (n: number, f: (i: number) => Partial<Lead>): Lead[] => {
  const g = ++grupo;
  return Array.from({ length: n }, (_, i) => lead(`g${g}-${i}`, f(i)));
};
/** Saudados ontem 09:00, sem resposta: no Resgate (> 24 h) → travam em `respondeu`. */
const semResposta = (n: number) => varios(n, () => saudado(ONTEM));
/** Entraram hoje 10:00 e nada no robô: no Resgate (o robô não falou em 2 h) → travam em `robo-falou`. */
const naoFalou = (n: number) => varios(n, () => ({ createdAt: brt(HOJE, "10:00") }));
/** Sem telefone desde ontem 10:00: no Resgate há 14 h úteis → travam em `fora-agendou`. */
const semTel = (n: number) => varios(n, () => ({ createdAt: brt(ONTEM, "10:00"), phone: undefined }));
/** Robô desligado: "Novos" há 5 h úteis → travam em `agendou`. */
const novosAtrasados = (n: number) => varios(n, () => ({ createdAt: brt(HOJE, "10:00") }));
/** Reunião em 30/10, sem desfecho há 32 h úteis → travam em `realizou` (Fila: sem desfecho). */
const semDesfecho = (n: number) =>
  varios(n, () => ({ createdAt: brt("2026-10-29", "10:00"), status: "agendado", bookedAt: brt("2026-10-29", "12:00"), meetingFor: brt("2026-10-30", "10:00") }));
/** Faltaram à reunião de 30/10 → travam em `realizou` (Fila: Resgate "não compareceu"). */
const faltaram = (n: number) =>
  varios(n, () => ({ createdAt: brt("2026-10-29", "10:00"), status: "no_show", bookedAt: brt("2026-10-29", "12:00"), meetingFor: brt("2026-10-30", "10:00") }));
/** Conversa sem atividade nenhuma há 50 h (02/11 13:00). */
const conversa50h = (over: Partial<Lead> = {}): Partial<Lead> =>
  saudadoAs("2026-11-02", "13:00", {
    roboRespondeuEm: brt("2026-11-02", "13:00"),
    roboUltimaMsgClienteEm: brt("2026-11-02", "13:00"),
    roboUltimaInteracaoEm: brt("2026-11-02", "13:00"),
    roboEtapa: "em_conversa",
    ...over,
  });

// ---------------------------------------------------------------- 1. a escolha

describe("1 · a escolha: maior número de pessoas, empate pela mais funda, amostra de 3", () => {
  it("vence o maior travados", () => {
    const e = semana([...semResposta(4), ...naoFalou(3)]);
    const { p, o } = trava(e);
    expect(junta(p, "robo-falou").travados).toBe(3);
    expect(o.situacao).toBe("trava");
    expect(o.junta?.id).toBe("respondeu");
    expect(o.junta?.travados).toBe(4);
    expect(o.titulo).toBe("4 não responderam ao robô");
    expect(o.titulo).toBe(TITULO_DA_JUNTA.respondeu(formatInt(4)));
    expect(o.dono).toBe("BOT");
    expect(o.link).toEqual(linkDe("resgate", e.rangeKey));
    expect(o.semEtapasDoRobo).toBe(false);
    expect(resumoDaTrava(o)).toEqual({
      situacao: "trava",
      semEtapasDoRobo: false,
      titulo: o.titulo,
      dono: "BOT",
      junta: "respondeu",
      travados: o.junta!.travados,
      entradas: o.junta!.entradas,
      emAndamento: o.junta!.emAndamento,
      abertos: o.junta!.abertos,
      encerrados: o.junta!.encerrados,
    });
  });

  it("empate: vence a junta mais funda (respondeu > robo-falou; fora-agendou > respondeu)", () => {
    expect(trava(semana([...semResposta(3), ...naoFalou(3)])).o.junta?.id).toBe("respondeu");
    const e = semana([...semResposta(3), ...semTel(3)]);
    const { o } = trava(e);
    expect(o.junta?.id).toBe("fora-agendou");
    expect(o.titulo).toBe("3 fora do robô não agendaram");
    expect(o.dono).toBe("COM");
    expect(o.link).toEqual(linkDe("resgate", e.rangeKey));
  });

  it("abaixo de 3 pessoas paradas em toda junta: nenhuma trava, e o vazio diz isso", () => {
    const { o } = trava(semana(semResposta(2)));
    expect(o).toMatchObject({ situacao: "abaixo-da-amostra", junta: null, dono: null, link: null, semEtapasDoRobo: false });
    expect(o.titulo).toBe("Nenhuma etapa com 3 ou mais pessoas paradas");
    expect(o.dica).toBe(`${dica("onde_trava")} Nenhuma etapa tem 3 ou mais pessoas paradas.`);
    expect(resumoDaTrava(o)).toEqual({
      situacao: "abaixo-da-amostra",
      semEtapasDoRobo: false,
      titulo: o.titulo,
      dono: null,
      junta: null,
      travados: 0,
      entradas: 0,
      emAndamento: 0,
      abertos: 0,
      encerrados: 0,
    });
    // A base do Início (LEADS_DO_ROBO) não tem 3 parados em junta nenhuma.
    expect(trava(entradaDoRobo()).o.situacao).toBe("abaixo-da-amostra");
  });

  it("nenhum lead no período: 'Nenhum lead no período'", () => {
    const { o } = trava(entradaDoRobo(ROBO, { from: "2026-11-20", to: "2026-11-20" }));
    expect(o).toMatchObject({ situacao: "sem-leads", titulo: "Nenhum lead no período", junta: null, dono: null, link: null });
    expect(o.dica).toBe(dica("onde_trava"));
  });
});

// ---------------------------------------------------------------- 2. a leitura parada (K6)

describe("2 · leitura do robô parada: as três juntas do robô não concorrem (K6)", () => {
  it("com vencedora fora do robô: `semEtapasDoRobo` e o ⓘ diz que as etapas do robô não entram", () => {
    const { p, o } = trava(semana([...semResposta(4), ...semTel(3)], { robo: PARADO }));
    expect(p.parada).toBe(true);
    expect(junta(p, "respondeu").travados).toBe(4); // maior, e fora da disputa
    expect(o).toMatchObject({ situacao: "trava", semEtapasDoRobo: true, titulo: "3 fora do robô não agendaram" });
    expect(o.junta?.id).toBe("fora-agendou");
    expect(o.dica).toContain("A leitura do robô está parada: as etapas do robô não entram.");
    // O "⚠" é da tela (o componente o põe com `semEtapasDoRobo`), não do título.
    expect(o.titulo).not.toContain("⚠");
  });

  it("o aceite lido é fato: `agendou-apos-aceite` concorre com a leitura parada", () => {
    const { o } = trava(semana([...semResposta(4), ...varios(3, () => aceitouAs(ONTEM, "10:00"))], { robo: PARADO }));
    expect(o.junta?.id).toBe("agendou-apos-aceite");
    expect(o.titulo).toBe("3 aceitaram o convite sem reunião registrada");
    expect(o.semEtapasDoRobo).toBe(true);
  });

  it("sem nenhuma fora do robô: 'Nenhuma trava fora das etapas do robô', sem repetir o 'sem leitura desde…'", () => {
    const { o } = trava(semana(semResposta(4), { robo: PARADO }));
    expect(o).toMatchObject({ situacao: "leitura-parada", semEtapasDoRobo: true, junta: null, dono: null, link: null });
    expect(o.titulo).toBe("Nenhuma trava fora das etapas do robô");
    expect(o.titulo).not.toMatch(/sem leitura|⚠/);
    expect(o.dica).toBe(
      `${dica("onde_trava")} A leitura do robô está parada: as etapas do robô não entram, e fora delas nenhuma tem 3 ou mais parados.`,
    );
  });

  it("em dia, desligado, ou sem o trecho do robô (período todo antes de 29/10): `semEtapasDoRobo` falso", () => {
    expect(trava(semana(semResposta(4))).o.semEtapasDoRobo).toBe(false);
    expect(trava(semana(novosAtrasados(3), { robo: null })).o.semEtapasDoRobo).toBe(false);
    const antes = varios(3, () => ({ createdAt: brt("2026-10-21", "10:00") }));
    const { p, o } = trava(semana(antes, { robo: PARADO, range: { from: "2026-10-20", to: "2026-10-28" } }));
    expect(p.comRobo).toBe(false);
    expect(o.semEtapasDoRobo).toBe(false);
  });
});

// ---------------------------------------------------------------- 3. em andamento

describe("3 · 'ainda no prazo' por junta: só trava quem já passou do prazo natural", () => {
  it("o robô falou há 3 h: no prazo; há 25 h: trava (está no Resgate)", () => {
    const { p } = trava(semana([lead("falou-3h", saudadoAs(HOJE, "12:00")), lead("falou-25h", saudadoAs(ONTEM, "14:00"))]));
    expect(junta(p, "respondeu")).toMatchObject({ entradas: 2, passaram: 0, emAndamento: 1, travados: 1, abertos: 1, destino: "resgate" });
  });

  it("aceite há 1 hora útil: no prazo; há 3: trava (Aceitou o convite)", () => {
    const { p } = trava(semana([lead("aceite-1h", aceitouAs(HOJE, "14:00")), lead("aceite-3h", aceitouAs(HOJE, "12:00"))]));
    expect(junta(p, "agendou-apos-aceite")).toMatchObject({ entradas: 2, passaram: 0, emAndamento: 1, travados: 1, abertos: 1, destino: "convite-aceito" });
  });

  it("reunião futura: no prazo; passada há mais de 24 h úteis sem desfecho: trava", () => {
    const futura = lead("reuniao-futura", { createdAt: brt("2026-10-29", "10:00"), status: "agendado", bookedAt: brt(ONTEM, "10:00"), meetingFor: brt("2026-11-05", "10:00") });
    const { p } = trava(semana([futura, ...semDesfecho(1)]));
    expect(junta(p, "realizou")).toMatchObject({ entradas: 2, passaram: 0, emAndamento: 1, travados: 1, abertos: 1, encerrados: 0, destino: "sem-desfecho" });
  });

  it("quem faltou (`no_show`) trava ABERTO em `realizou`, mesmo com um opt-out de antes de agendar (K16)", () => {
    const faltou = lead("faltou-optout", {
      ...saudadoAs("2026-10-30", "09:00"),
      roboOptOutEm: brt("2026-10-30", "12:00"),
      roboEtapa: "opt_out",
      status: "no_show",
      bookedAt: brt("2026-10-31", "10:00"),
      meetingFor: brt("2026-11-02", "10:00"),
    });
    const { p } = trava(semana([faltou]));
    expect(junta(p, "realizou")).toMatchObject({ entradas: 1, travados: 1, abertos: 1, encerrados: 0, destino: "resgate" });
    // Antes de agendar, a reunião é "outro caminho" — o opt-out não o encerra lá.
    expect(junta(p, "respondeu")).toMatchObject({ outroCaminho: 1, travados: 0 });
  });

  it("`aceitou` (K7): pausado com atividade há 10 h está no prazo; pausado ou conversa aberta sem atividade há 50 h trava aberto, sem link", () => {
    const e = semana([
      lead("pausado-10h", conversou(ONTEM, { roboUltimaInteracaoEm: brt(HOJE, "05:00"), roboPausado: true })),
      lead("pausado-50h-a", conversa50h({ roboPausado: true })),
      lead("pausado-50h-b", conversa50h({ roboPausado: true })),
      lead("aberta-50h", conversa50h()),
    ]);
    const { p, o } = trava(e);
    expect(junta(p, "aceitou")).toMatchObject({ entradas: 4, passaram: 0, outroCaminho: 0, emAndamento: 1, travados: 3, abertos: 3, encerrados: 0, destino: null });
    expect(o.junta?.id).toBe("aceitou");
    expect(o.titulo).toBe("3 pararam na conversa com o robô");
    expect(o.link).toBeNull();
    expect(o.dica).toContain("Parado = sem atividade do robô, da pessoa ou do comercial há 48 h (pausado incluído).");
    expect(o.dica).toContain("Nenhum deles está na Fila agora.");
    expect(o.dica).not.toContain("O link abre");
  });

  it("respondeu sem a fala do robô no episódio (reaberto pela página com o robô pausado; ou escreveu primeiro): sem Resgate, o prazo é o da conversa — 48 h sem atividade e trava aberto", () => {
    // Saudados em 29/10, reabertos pela página em 31/10 10:00; escreveram às 11:00 e o robô (pausado) não mexeu mais.
    const reabPausado = (id: string, ultimaMsg: string) =>
      lead(id, {
        ...saudadoAs("2026-10-29", "09:00"),
        roboRespondeuEm: brt("2026-10-29", "09:10"),
        roboUltimaInteracaoEm: brt("2026-10-29", "09:10"),
        roboUltimaMsgClienteEm: ultimaMsg,
        roboEtapa: "em_conversa",
        roboPausado: true,
      });
    const leads = [
      ...["rp-1", "rp-2", "rp-3"].map((id) => reabPausado(id, brt("2026-10-31", "11:00"))),
      // Escreveu hoje: a conversa está viva.
      reabPausado("rp-vivo", brt(HOJE, "10:00")),
      // Sem reaberto: escreveu primeiro (sem a saudação do robô) em 31/10 e nada mais.
      lead("escreveu-primeiro", {
        createdAt: brt("2026-10-31", "10:00"),
        roboVistoEm: brt("2026-10-31", "10:00"),
        roboRecebidoEm: brt("2026-10-31", "10:00"),
        roboRespondeuEm: brt("2026-10-31", "10:05"),
        roboUltimaMsgClienteEm: brt("2026-10-31", "10:05"),
        roboEtapa: "em_conversa",
      }),
    ];
    const eventos = ["rp-1", "rp-2", "rp-3", "rp-vivo"].map((id) => reaberto(id, brt("2026-10-31", "10:00"), ATOR_LP));
    const e = semana(leads, { eventos });
    // Ninguém deles está na Fila (o Resgate do robô exige "sem resposta").
    expect(montarFila({ nowIso: e.agora, leads: e.data.leads, eventos, robo: ROBO }).itens).toEqual([]);
    const { p, o } = trava(e);
    expect(junta(p, "robo-falou")).toMatchObject({ entradas: 5, passaram: 0, outroCaminho: 0, emAndamento: 1, travados: 4, abertos: 4, encerrados: 0, destino: null });
    // Falaram com o robô: não são "não chegaram ao robô".
    expect(junta(p, "robo-falou").semFala).toEqual({ semWhatsapp: 0, naoChegou: 0, naoFalou: 4 });
    expect(o.junta?.id).toBe("robo-falou");
    expect(o.dica).toContain("Dos parados: 4 sem fala do robô.");
    expect(o.link).toBeNull();
  });

  it("esfriou depois do convite: trava e é encerrado", () => {
    const esfriou = lead("esfriou-convite", conversou(ONTEM, { roboConviteEm: brt(ONTEM, "10:00"), roboUltimaInteracaoEm: brt(ONTEM, "11:00"), roboEtapa: "declinou" }));
    const { p } = trava(semana([esfriou]));
    expect(junta(p, "aceitou")).toMatchObject({ entradas: 1, travados: 1, encerrados: 1, abertos: 0 });
  });

  it("`fechou` (K7): reunião realizada há 10 dias sem desfecho está no prazo; há 31 dias trava aberto, sem link", () => {
    const realizou = (id: string, dia: string): Lead =>
      lead(id, { createdAt: brt("2026-09-25", "10:00"), status: "reuniao_realizada", bookedAt: brt("2026-09-28", "10:00"), meetingFor: brt(dia, "10:00"), attendedAt: brt(dia, "10:30") });
    const e = semana([realizou("realizou-10d", "2026-10-25"), realizou("realizou-31d-a", "2026-10-04"), realizou("realizou-31d-b", "2026-10-04"), realizou("realizou-31d-c", "2026-10-04"), lead("chegou-agora", { createdAt: brt(HOJE, "14:50") })], {
      range: { from: "2026-09-01", to: HOJE },
    });
    const { p, o } = trava(e);
    expect(p.comRobo).toBe(true);
    expect(junta(p, "realizou")).toMatchObject({ entradas: 4, passaram: 4, travados: 0 });
    expect(junta(p, "fechou")).toMatchObject({ entradas: 4, passaram: 0, emAndamento: 1, travados: 3, abertos: 3, encerrados: 0, destino: null });
    expect(o.junta?.id).toBe("fechou");
    expect(o.titulo).toBe("3 fizeram a reunião e não fecharam");
    expect(o.dono).toBe("ESP");
    expect(o.link).toBeNull();
    expect(o.dica).toContain("Negociando até 30 dias depois da reunião.");
    expect(o.dica).not.toContain("O link abre");
  });

  it("`fora-agendou` (F3-D31): o recente corre; o 'antes' fora da Fila não entra; o 'antes' no Resgate e atrasado trava; o sem telefone no prazo do Resgate corre", () => {
    const leads = [
      lead("recente-5min", { createdAt: brt(HOJE, "14:55") }),
      lead("antes-aberto", { createdAt: brt("2026-10-20", "10:00") }),
      lead("antes-retorno", { createdAt: brt("2026-10-22", "10:00"), status: "em_contato", firstContactAt: brt("2026-10-22", "10:30") }),
      lead("semtel-no-prazo", { createdAt: brt(HOJE, "14:00"), phone: undefined }),
    ];
    const eventos = [tentativa("antes-retorno", brt("2026-10-22", "10:30")), tentativa("antes-retorno", brt("2026-11-02", "10:00"))];
    const { p } = trava(semana(leads, { eventos, range: { from: "2026-10-20", to: HOJE } }));
    expect(p.foraDasJuntas.antes).toBe(1);
    expect(junta(p, "fora-agendou")).toMatchObject({ entradas: 3, passaram: 0, outroCaminho: 0, emAndamento: 2, travados: 1, abertos: 1, encerrados: 0, destino: "resgate" });
  });
});

// ---------------------------------------------------------------- 4. outro caminho

describe("4 · outro caminho: quem chegou a agendar NESTE episódio não trava antes de Agendaram", () => {
  it("não respondeu ao robô, mas agendou pelo resgate: não trava em `respondeu`", () => {
    const viaResgate = lead("via-resgate", { ...saudado(ONTEM), status: "agendado", bookedAt: brt(HOJE, "10:00"), meetingFor: brt("2026-11-06", "10:00") });
    const { p } = trava(semana([viaResgate]));
    expect(junta(p, "respondeu")).toMatchObject({ entradas: 1, passaram: 0, outroCaminho: 1, travados: 0 });
  });

  it("outro cadastro com o mesmo telefone agendou depois do aceite: outro caminho (a régua da Fila)", () => {
    const aceitou = lead("aceitou-principal", { ...aceitouAs(ONTEM, "10:00"), status: "em_contato", firstContactAt: brt(ONTEM, "11:00") });
    // A cópia (mesmo telefone) agendou às 15:00 e se perdeu depois — é ela que leva o marco.
    const outro = lead("outro-cadastro", { createdAt: brt(ONTEM, "12:00"), phone: aceitou.phone, status: "sem_interesse", bookedAt: brt(ONTEM, "15:00"), lostAt: brt(HOJE, "10:00") });
    const { p } = trava(semana([aceitou, outro]));
    expect(p.foraDasJuntas.duplicados).toBe(1);
    expect(junta(p, "agendou-apos-aceite")).toMatchObject({ entradas: 1, passaram: 0, outroCaminho: 1, travados: 0 });
  });

  it("a reunião de um episódio anterior ao `reaberto` NÃO é outro caminho (K21)", () => {
    const reaberta = lead("reaberta-k21", { ...aceitouAs(ONTEM, "10:00"), createdAt: brt("2026-10-30", "09:00"), bookedAt: brt("2026-10-31", "10:00"), meetingFor: brt("2026-11-01", "10:00") });
    const { p } = trava(semana([reaberta], { eventos: [reaberto("reaberta-k21", brt(ONTEM, "09:00"), ATOR_LP)] }));
    expect(junta(p, "agendou-apos-aceite")).toMatchObject({ entradas: 1, outroCaminho: 0, travados: 1, destino: "convite-aceito" });
    expect(junta(p, "realizou").entradas).toBe(0);
  });
});

// ---------------------------------------------------------------- 5. o link

describe("5 · o link: o grupo da Fila com mais travados AGORA, sem número (F3-D22)", () => {
  it("destino = o grupo com mais travados na `montarFila` da mesma entrada; href com o período; rótulo sem dígito", () => {
    const e = semana([...faltaram(3), ...semDesfecho(1)]);
    const { o } = trava(e);
    expect(o.junta?.id).toBe("realizou");
    expect(o.titulo).toBe("4 agendaram e a reunião não aconteceu");
    // A Fila da MESMA entrada: 3 no Resgate ("não compareceu"), 1 em "sem desfecho".
    const fila = montarFila({ nowIso: e.agora, leads: e.data.leads, eventos: e.eventos, robo: ROBO });
    const porGrupo = new Map<FilaEtapa, number>();
    for (const i of fila.itens) porGrupo.set(i.etapa, (porGrupo.get(i.etapa) ?? 0) + 1);
    expect(Object.fromEntries(porGrupo)).toEqual({ resgate: 3, "sem-desfecho": 1 });
    expect(o.junta?.destino).toBe("resgate");
    expect(o.link).toEqual(linkDe("resgate", e.rangeKey));
    expect(o.link?.href).toBe(`/fila?etapa=resgate&range=${encodeURIComponent(e.rangeKey)}#resgate`);
    expect(o.link?.rotulo).not.toMatch(/\d/);
  });

  it("empate entre grupos: vence o mais fundo da Fila", () => {
    const e = semana([...faltaram(2), ...semDesfecho(2)]);
    const { o } = trava(e);
    expect(o.junta?.destino).toBe("sem-desfecho");
    expect(o.link).toEqual(linkDe("sem-desfecho", e.rangeKey));
    expect(o.link?.rotulo).toBe("Reuniões sem desfecho →");
  });

  it("robô desligado: o link vai para os Novos", () => {
    const e = semana(novosAtrasados(3), { robo: null });
    const { o } = trava(e);
    expect(o.junta?.id).toBe("agendou");
    expect(o.titulo).toBe("3 entraram e não agendaram");
    expect(o.link).toEqual(linkDe("novo", e.rangeKey));
  });

  it("sem link, o ⓘ não diz 'O link abre'; com link, diz qual grupo e que a Fila é o agora", () => {
    // Os dois casos, montados aqui (o teste vale rodado sozinho): com link (Resgate) e sem (`aceitou`).
    expect(trava(semana(semResposta(4))).o.link).not.toBeNull();
    expect(trava(semana([lead("sl-1", conversa50h()), lead("sl-2", conversa50h()), lead("sl-3", conversa50h())])).o.link).toBeNull();
    expect(COM_TRAVA.some((x) => x.o.link)).toBe(true);
    expect(COM_TRAVA.some((x) => !x.o.link)).toBe(true);
    for (const { o } of COM_TRAVA) {
      if (o.link) {
        expect(o.dica).toContain(
          `O link abre o grupo ${FILA_ETAPAS[o.junta!.destino!].label} da Fila (do comercial), onde eles estão agora — a Fila conta quem espera hoje, de qualquer período.`,
        );
      } else {
        expect(o.dica).not.toContain("O link abre");
        expect(o.dica).toContain("Nenhum deles está na Fila agora.");
      }
    }
  });

  it("com o robô ligado, nunca um link para 'Novos' nem 'Retornar' (grupos que não existem)", () => {
    const comRobo = COM_TRAVA.filter((x) => x.comRobo);
    expect(comRobo.length).toBeGreaterThan(5);
    for (const { o } of comRobo) {
      expect(["novo", "retornar"]).not.toContain(o.junta?.destino);
      expect(o.link?.href ?? "").not.toMatch(/etapa=(novo|retornar)/);
    }
  });
});

// ---------------------------------------------------------------- 6. o texto

describe("6 · o texto: sem meta nem média, ≤ 12 palavras com o dono e o link (K9, K32)", () => {
  it("os títulos das oito juntas", () => {
    const n = "5";
    expect(Object.fromEntries((Object.keys(TITULO_DA_JUNTA) as JuntaId[]).map((id) => [id, TITULO_DA_JUNTA[id](n)]))).toEqual({
      "robo-falou": "5 pararam antes da 1ª mensagem do robô",
      respondeu: "5 não responderam ao robô",
      aceitou: "5 pararam na conversa com o robô",
      "agendou-apos-aceite": "5 aceitaram o convite sem reunião registrada",
      "fora-agendou": "5 fora do robô não agendaram",
      agendou: "5 entraram e não agendaram",
      realizou: "5 agendaram e a reunião não aconteceu",
      fechou: "5 fizeram a reunião e não fecharam",
    });
  });

  it("robo-falou: o título não é o 'Sem a 1ª mensagem do robô' do alerta; o ⓘ parte os parados (K9)", () => {
    const e = semana([
      lead("nao-chegou-1", { createdAt: brt(HOJE, "10:00") }),
      lead("nao-chegou-2", { createdAt: brt(HOJE, "10:00") }),
      lead("sem-whatsapp", { createdAt: brt(HOJE, "10:00"), roboVistoEm: brt(HOJE, "10:05"), roboRecebidoEm: brt(HOJE, "10:00"), roboSemWhatsappEm: brt(HOJE, "10:05"), roboEtapa: "sem_whatsapp" }),
      lead("viu-nao-falou", { createdAt: brt(HOJE, "10:00"), roboVistoEm: brt(HOJE, "10:05"), roboRecebidoEm: brt(HOJE, "10:00"), roboEtapa: "sem_mensagem" }),
    ]);
    const { o } = trava(e);
    expect(o.junta?.id).toBe("robo-falou");
    expect(o.junta?.semFala).toEqual({ semWhatsapp: 1, naoChegou: 2, naoFalou: 1 });
    expect(o.titulo).toBe("4 pararam antes da 1ª mensagem do robô");
    expect(o.titulo).not.toContain("Sem a 1ª mensagem");
    expect(o.dica).toContain("Dos parados: 1 sem WhatsApp, 2 não chegaram ao robô, 1 sem fala do robô.");
  });

  it("o ⓘ no singular quando o número é 1 (K32)", () => {
    const e = semana([
      ...semResposta(3),
      // Pediu para não receber mensagens sem responder: trava encerrado.
      lead("pediu-sair", saudado(ONTEM, { roboOptOutEm: brt(ONTEM, "12:00"), roboEtapa: "opt_out" })),
      // Saudado há 3 h: ainda no prazo.
      lead("no-prazo", saudadoAs(HOJE, "12:00")),
      // Não respondeu e agendou mesmo assim: outro caminho.
      lead("agendou-assim", { ...saudado(ONTEM), status: "agendado", bookedAt: brt(HOJE, "10:00"), meetingFor: brt("2026-11-06", "10:00") }),
      // Respondeu: passou.
      lead("respondeu-hoje", conversou(HOJE)),
    ]);
    const { p, o } = trava(e);
    expect(o.junta).toMatchObject({ id: "respondeu", entradas: 7, passaram: 1, outroCaminho: 1, emAndamento: 1, travados: 4, abertos: 3, encerrados: 1 });
    expect(
      o.dica.startsWith(
        "Dos 7 que receberam a 1ª mensagem: 1 respondeu, 1 chegou a agendar por outro caminho ou desistiu depois, 1 ainda no prazo. Os 4 parados: 3 abertos, 1 encerrado.",
      ),
      o.dica,
    ).toBe(true);
    expect(o.dica).toContain(`A maior perda em pessoas dos ${p.recorte}, sem meta nem média; o dono é o da etapa.`);
    for (const errado of ["1 chegaram", "1 desistiram", "1 encerrados", "1 abertos", "1 responderam"]) expect(o.dica).not.toContain(errado);
  });

  it("o 'Sem … de antes do robô fora da Fila' só no ⓘ de `fora-agendou`: a reunião deles é julgada em `realizou` (F3-D31)", () => {
    // Campanha com o robô: 2 de antes de 29/10 que nunca agendaram e 4 que agendaram e desistiram (todos fora da Fila).
    const antesNunca = varios(2, () => ({ createdAt: brt("2026-10-10", "10:00") }));
    const antesDesistiu = varios(4, () => ({ createdAt: brt("2026-10-10", "10:00"), status: "desistencia", bookedAt: brt("2026-10-12", "10:00"), lostAt: brt("2026-10-20", "10:00") }));
    const depois = lead("depois-recente", { createdAt: brt(HOJE, "14:58") });
    const { p, o } = trava(semana([...antesNunca, ...antesDesistiu, depois], { range: null }));
    expect(p.comRobo).toBe(true);
    expect(p.foraDasJuntas.antes).toBe(6);
    expect(o.junta?.id).toBe("realizou");
    expect(o.junta).toMatchObject({ entradas: 4, travados: 4, encerrados: 4 });
    expect(o.dica).not.toContain("de antes do robô");
    expect(o.dica).not.toMatch(/\bSem \d/);
    // Em `fora-agendou`, sim: eles não estão na base dela.
    const r = trava(semana([...semTel(3), ...varios(2, () => ({ createdAt: brt("2026-10-10", "10:00") }))], { range: { from: "2026-10-01", to: HOJE } }));
    expect(r.o.junta?.id).toBe("fora-agendou");
    expect(r.o.dica).toContain("Sem 2 leads de antes do robô (29/10) fora da Fila.");
  });

  it("toda trava deste arquivo: título sem 'meta' nem 'média', e título + dono + link ≤ 12 palavras", () => {
    expect(COM_TRAVA.length).toBeGreaterThan(5);
    for (const { o } of COM_TRAVA) {
      expect(o.titulo).not.toMatch(/meta|média/i);
      expect(o.titulo).toBe(TITULO_DA_JUNTA[o.junta!.id](formatInt(o.junta!.travados)));
      expect(o.junta!.travados).toBeGreaterThanOrEqual(3);
      const palavras = nPalavras(o.titulo) + 1 + (o.link ? nPalavras(o.link.rotulo) : 0);
      expect(palavras, o.titulo).toBeLessThanOrEqual(12);
    }
  });
});

// ---------------------------------------------------------------- 7. uma função, três leitores (K8)

describe("7 · uma função, três leitores: Funil, Início e IA dizem a mesma trava (K8)", () => {
  function tresLeitores(e: EntradaInicio) {
    const tela = montarFunilDaTela(e).manchete;
    const ini = montarInicio(e).atendimento.ondeTrava;
    const ia = inicioParaIA(montarInicio(e)).atendimento.ondeTrava;
    expect(ini).toEqual(resumoDaTrava(tela));
    expect(ini.junta).toBe(tela.junta?.id ?? null);
    expect([ini.travados, ini.entradas]).toEqual([tela.junta?.travados ?? 0, tela.junta?.entradas ?? 0]);
    expect([tela.situacao, ini.situacao, ia.situacao]).toEqual([tela.situacao, tela.situacao, tela.situacao]);
    expect([ini.semEtapasDoRobo, ia.semEtapasDoRobo]).toEqual([tela.semEtapasDoRobo, tela.semEtapasDoRobo]);
    expect(ia.frase).toBe(tela.titulo);
    expect(ia.dono).toBe(tela.dono ? DONO_LABEL[tela.dono] : null);
    expect(ia.pessoasParadas).toBe(tela.situacao === "trava" ? tela.junta!.travados : null);
    expect(ia.entraram).toBe(tela.situacao === "trava" ? tela.junta!.entradas : null);
    expect(ia.aindaNoPrazo).toBe(tela.situacao === "trava" ? tela.junta!.emAndamento : null);
    expect(ia.abertos).toBe(tela.situacao === "trava" ? tela.junta!.abertos : null);
    expect(ia.encerrados).toBe(tela.situacao === "trava" ? tela.junta!.encerrados : null);
    return tela;
  }

  it("robô em dia, a semana com trava", () => {
    const tela = tresLeitores(entradaDoRobo(ROBO, SEMANA, { leads: [...LEADS_DO_ROBO, ...semResposta(3)] }));
    expect(tela.situacao).toBe("trava");
    expect(tela.junta?.id).toBe("respondeu");
    expect(tela.junta?.travados).toBe(4); // o "semresposta" do fixture + os 3
  });

  it("robô desligado: `agendou` e `realizou`", () => {
    expect(tresLeitores(semana(novosAtrasados(3), { robo: null })).junta?.id).toBe("agendou");
    expect(tresLeitores(semana([...novosAtrasados(3), ...semDesfecho(4)], { robo: null })).junta?.id).toBe("realizou");
  });

  it("leitura parada e sem trava, sem leads e abaixo da amostra: a mesma `situacao` nos três", () => {
    expect(tresLeitores(entradaDoRobo(PARADO, SEMANA, { leads: [...LEADS_DO_ROBO, ...semResposta(3)] })).situacao).toBe("leitura-parada");
    expect(tresLeitores(entradaDoRobo(ROBO, { from: "2026-11-20", to: "2026-11-20" })).situacao).toBe("sem-leads");
    // 0 lead com a leitura parada: "nenhum lead" é fato do painel, sem "⚠" (o card do robô nem existe, K34) — nos três.
    const parado0 = entradaDoRobo(PARADO, { from: "2026-11-20", to: "2026-11-20" });
    expect(funilDoProcesso(parado0)).toMatchObject({ leads: 0, parada: true, comRobo: true });
    expect(tresLeitores(parado0)).toMatchObject({ situacao: "sem-leads", semEtapasDoRobo: false });
    expect(tresLeitores(entradaDoRobo()).situacao).toBe("abaixo-da-amostra");
  });
});
