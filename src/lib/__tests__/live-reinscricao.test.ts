/**
 * Live 01/12 — quem já era lead de outra campanha e se inscreve na live conta como
 * inscrição NOVA da live, pela data da inscrição (`inscritoLiveEm`), sem mexer na
 * entrada (`createdAt`). Puro: a régua, o painel, a Fila da live, a ficha do n8n e
 * a linha do tempo. A gravação (API do n8n, página e store) está em live-api,
 * live-pagina e store-contract.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DescricaoEvento } from "@/components/leads/lead-activity";
import { LIVE_PADRAO, ehInscritoDaLive, entradaNaLive, inicioDaLive, ultimaEntrada } from "../live";
import { montarPainelLive } from "../live-painel";
import { etapaDaLive, montarFilaDaLive, resumoDaCadencia } from "../fila-live";
import { fichaParaN8n } from "../n8n/ficha";
import { EXPEDIENTE_PADRAO, prazoDaPrimeiraTentativa } from "../turno";
import type { DashboardData, Lead, LeadEvent } from "../types";

const cfg = LIVE_PADRAO;
const HOJE = "2026-11-24";
const AGORA = "2026-11-25T02:00:00.000Z"; // 24/11 23h em Brasília

/** Entrou em 17/11 19h pela página da live: o cadastro novo nasce com a inscrição. */
const novo: Lead = {
  id: "NOVO",
  brand: "consorcio",
  createdAt: "2026-11-17T22:00:00.000Z",
  inscritoLiveEm: "2026-11-17T22:00:00.000Z",
  name: "Inscrita nova",
  status: "lead",
  classe: "A",
  bem: "imovel",
};

/** O caso real: entrou em 27/10 pelo link da bio, foi trabalhado, e se inscreveu na live em 16/11 15h30. */
const reinscrito: Lead = {
  id: "ANTIGO",
  brand: "consorcio",
  createdAt: "2026-10-27T15:00:00.000Z",
  inscritoLiveEm: "2026-11-16T18:30:00.000Z",
  name: "Já era lead",
  status: "em_contato",
  firstContactAt: "2026-10-27T16:00:00.000Z",
  classe: "A",
  bem: "imovel",
  utmContent: "link_in_bio",
};

/** Lead de outubro que nunca se inscreveu na live (a ficha veio do comercial). */
const antigoSemLive: Lead = {
  id: "SEM-LIVE",
  brand: "consorcio",
  createdAt: "2026-10-20T15:00:00.000Z",
  name: "Só da campanha antiga",
  status: "em_contato",
  firstContactAt: "2026-10-20T16:00:00.000Z",
  classe: "A",
  bem: "carro",
};

const tentativa = (leadId: string, em: string, falou: boolean, id = `t-${leadId}-${em}`): LeadEvent => ({
  id,
  leadId,
  brand: "consorcio",
  leadName: leadId,
  actor: "Eduardo",
  action: "tentativa",
  createdAt: em,
  occurredAt: em,
  payload: { canal: "ligacao", falou: falou ? "sim" : "nao" },
});

/** A conversa da campanha antiga: ligou e falou em outubro. */
const conversaAntiga = [tentativa("ANTIGO", "2026-10-27T16:00:00.000Z", true), tentativa("SEM-LIVE", "2026-10-20T16:00:00.000Z", true)];

const dados = (leads: Lead[]): DashboardData => ({
  campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-11-16", budgetTotal: 5000 },
  igAccountDaily: [],
  igPosts: [],
  adDaily: [],
  creatives: [],
  lpDaily: [],
  leads,
  goals: [],
  metas: [],
  updatedAt: AGORA,
});

const painel = (leads: Lead[], eventos: LeadEvent[]) =>
  montarPainelLive({
    data: dados(leads),
    eventos,
    cfg,
    expediente: EXPEDIENTE_PADRAO,
    range: { de: cfg.periodo.de, ate: HOJE },
    hoje: HOJE,
    agora: AGORA,
  });

const prazoA = (l: Lead) => prazoDaPrimeiraTentativa({ createdAt: entradaNaLive(l), classe: "A" }, EXPEDIENTE_PADRAO)!;

describe("a régua: quem é inscrito da live, e desde quando", () => {
  it("o lead novo conta pela entrada; quem já era lead, pela inscrição; sem inscrição na live, continua fora", () => {
    expect(ehInscritoDaLive(novo, cfg)).toBe(true);
    expect(ehInscritoDaLive(reinscrito, cfg)).toBe(true);
    expect(ehInscritoDaLive(antigoSemLive, cfg)).toBe(false);
    // Sem a data da inscrição (antes da correção), a entrada de outubro deixava a pessoa de fora.
    expect(ehInscritoDaLive({ ...reinscrito, inscritoLiveEm: undefined }, cfg)).toBe(false);
    expect(entradaNaLive(reinscrito)).toBe("2026-11-16T18:30:00.000Z");
    expect(entradaNaLive(antigoSemLive)).toBe(antigoSemLive.createdAt);
  });

  it("a inscrição gravada antes do período é de outra live: a régua da troca é o 1º dia do período", () => {
    expect(inicioDaLive(cfg)).toBe("2026-11-16T00:00:00.000Z");
    expect(ehInscritoDaLive({ ...reinscrito, inscritoLiveEm: "2026-11-15T23:59:00.000Z" }, cfg)).toBe(false);
  });

  it("a mesma inscrição pelo outro caminho se mede pela entrada mais recente (o cadastro ou a inscrição)", () => {
    expect(ultimaEntrada(reinscrito)).toBe(reinscrito.inscritoLiveEm);
    expect(ultimaEntrada(antigoSemLive)).toBe(antigoSemLive.createdAt);
  });
});

describe("o painel da live conta a reinscrição", () => {
  it("entra em Inscrições e Qualificados; o lead antigo sem inscrição não", () => {
    const p = painel([novo, reinscrito, antigoSemLive], conversaAntiga);
    expect(p.inscritos).toBe(2);
    expect(p.metas.find((m) => m.id === "inscricoes")?.valor).toBe(2);
    expect(p.metas.find((m) => m.id === "qualificados")?.valor).toBe(2);
    expect(p.porClasse.A.inscritos).toBe(2);
  });

  it("a conversa da campanha antiga não vale como 1ª tentativa no prazo nem como contato em 48 h", () => {
    const p = painel([novo, reinscrito], conversaAntiga);
    // Os dois passaram do prazo sem tentativa NA LIVE: base 2, nenhum no prazo.
    expect(p.atendimento.find((t) => t.id === "a1h")).toMatchObject({ n: 2, valor: 0 });
    expect(p.atendimento.find((t) => t.id === "c48")).toMatchObject({ n: 2, valor: 0 });
    // "A sem tentativa" pega quem está "Em contato" só pelas tentativas antigas.
    expect(p.aSemTentativa).toBe(2);
  });

  it("\"A sem tentativa\" segue igual para o lead da live que voltou a \"Novo\" (reaberto)", () => {
    const reaberto: Lead = { ...novo, firstContactAt: "2026-11-17T23:00:00.000Z" };
    expect(painel([reaberto], []).aSemTentativa).toBe(1);
  });

  it("a 1ª tentativa depois da inscrição conta no prazo, que sai da data da inscrição", () => {
    const prazo = prazoA(reinscrito);
    expect(Date.parse(prazo)).toBeGreaterThan(Date.parse(reinscrito.inscritoLiveEm!));
    const naHora = new Date(Date.parse(prazo) - 60_000).toISOString();
    const p = painel([reinscrito], [...conversaAntiga, tentativa("ANTIGO", naHora, true)]);
    expect(p.atendimento.find((t) => t.id === "a1h")).toMatchObject({ n: 1, valor: 1 });
    expect(p.atendimento.find((t) => t.id === "c48")).toMatchObject({ n: 1, valor: 1 });
    expect(p.aSemTentativa).toBe(0);
  });

  it("a reunião, a realizada e a venda da campanha antiga não contam; a marcada depois da inscrição, sim", () => {
    // Agendou, foi e virou cliente em outubro; o marco (gravado uma vez) é de lá.
    const comHistoria: Lead = {
      ...reinscrito,
      status: "cliente",
      bookedAt: "2026-10-28T15:00:00.000Z",
      attendedAt: "2026-10-30T15:00:00.000Z",
      closedAt: "2026-10-31T15:00:00.000Z",
      value: 100_000,
    };
    const antes = painel([comHistoria], []);
    expect(antes.inscritos).toBe(1);
    expect(antes.metas.find((m) => m.id === "agendadas")?.valor).toBe(0);
    expect(antes.metas.find((m) => m.id === "realizadas")?.valor).toBe(0);
    expect(antes.fechamento.vendas).toBeNull();
    expect(antes.reunioes.realizada).toBe(0);
    // A reunião antiga não o tira da base das ligações do pós-live.
    expect(antes.ligacoesPosLive.semReuniao).toBe(1);

    // Voltou a agendar depois da inscrição: o marco não é regravado, vale a mudança de status.
    // A presença de outubro (marco gravado uma vez) fica no lead: a reunião nova não pode parecer realizada.
    const reagendou: Lead = { ...comHistoria, status: "agendado", meetingFor: "2026-11-26T22:00:00.000Z", closedAt: undefined };
    const mudou: LeadEvent = {
      id: "s1",
      leadId: "ANTIGO",
      brand: "consorcio",
      leadName: "Já era lead",
      actor: "Eduardo",
      action: "status_changed",
      fromStatus: "em_contato",
      toStatus: "agendado",
      createdAt: "2026-11-18T20:00:00.000Z",
    };
    const depois = painel([reagendou], [mudou]);
    expect(depois.metas.find((m) => m.id === "agendadas")?.valor).toBe(1);
    expect(depois.metas.find((m) => m.id === "realizadas")?.valor).toBe(0);
    expect(depois.reunioes).toMatchObject({ agendada: 1, realizada: 0 });
    expect(depois.ligacoesPosLive.semReuniao).toBe(0); // agendou na live, antes do pós-live

    // O lead novo segue igual: o marco dele é depois da entrada.
    const novoAgendou = painel([{ ...novo, status: "agendado", bookedAt: "2026-11-18T20:00:00.000Z" }], []);
    expect(novoAgendou.metas.find((m) => m.id === "agendadas")?.valor).toBe(1);
  });

  it("custo por inscrito divide pelos inscritos do período, reinscrição incluída", () => {
    const comGasto = montarPainelLive({
      data: {
        ...dados([novo, reinscrito]),
        adDaily: [
          { brand: "consorcio", date: "2026-11-17", campaign: "[LIVE] Captação", adset: "Aberto", adId: "1", spend: 100, impressions: 1, reach: 1, frequency: 1, clicks: 0, leads: 0 },
        ],
      },
      eventos: [],
      cfg,
      expediente: EXPEDIENTE_PADRAO,
      range: { de: cfg.periodo.de, ate: HOJE },
      hoje: HOJE,
      agora: AGORA,
    });
    expect(comGasto.custos.porInscrito.valor).toBe(50);
  });
});

describe("a Fila da live: quem se reinscreve começa do zero", () => {
  it("A reinscrito entra como 1ª tentativa, com o prazo da inscrição, mesmo com tentativas antigas", () => {
    const [item, ...resto] = montarFilaDaLive([reinscrito], conversaAntiga, AGORA, EXPEDIENTE_PADRAO);
    expect(resto).toHaveLength(0);
    expect(item).toMatchObject({ leadId: "ANTIGO", etapa: "primeira", prazo: prazoA(reinscrito), desde: reinscrito.inscritoLiveEm });
    expect(item.contato.tentativas).toBe(0);
    expect(item.contato.falou).toBe(false);
  });

  it("depois da 1ª tentativa da live, a cadência conta só as da live", () => {
    const depois = tentativa("ANTIGO", "2026-11-16T20:00:00.000Z", false);
    const e = etapaDaLive(reinscrito, [...conversaAntiga, { ...depois, payload: { ...depois.payload, proxima: "2026-11-17T20:00:00.000Z" } }], EXPEDIENTE_PADRAO);
    expect(e).toMatchObject({ etapa: "cadencia", prazo: "2026-11-17T20:00:00.000Z" });
    expect(e?.contato.tentativas).toBe(1);
  });

  it("o lead novo segue igual: 1ª tentativa pela entrada", () => {
    const [item] = montarFilaDaLive([novo], [], AGORA, EXPEDIENTE_PADRAO);
    expect(item).toMatchObject({ etapa: "primeira", prazo: prazoA(novo), desde: novo.createdAt });
  });
});

describe("a régua do \"Sem resposta\" e o registro da tentativa", () => {
  it("o lead da live conta só as tentativas da inscrição; o lead sem classe, o histórico inteiro", () => {
    const outubro = [
      tentativa("ANTIGO", "2026-10-27T16:00:00.000Z", false),
      tentativa("ANTIGO", "2026-10-28T16:00:00.000Z", false),
      tentativa("ANTIGO", "2026-10-28T20:00:00.000Z", false),
    ];
    expect(resumoDaCadencia(reinscrito, outubro)).toMatchObject({ tentativas: 0, diasComTentativa: 0 });
    const semClasse: Lead = { ...reinscrito, classe: undefined };
    expect(resumoDaCadencia(semClasse, outubro)).toMatchObject({ tentativas: 3, diasComTentativa: 2 });
  });
});

describe("a ficha que o n8n lê", () => {
  it("traz inscrito_live_em; o histórico inteiro fica em `tentativas`, e as da cadência contam desde a inscrição", () => {
    const f = fichaParaN8n(reinscrito, conversaAntiga.filter((t) => t.leadId === "ANTIGO"), EXPEDIENTE_PADRAO, AGORA);
    expect(f.inscrito_em).toBe(reinscrito.createdAt);
    expect(f.inscrito_live_em).toBe(reinscrito.inscritoLiveEm);
    expect(f.tentativas).toHaveLength(1);
    expect(f.tentativa_1_em).toBeNull();
    expect(f).toMatchObject({ na_fila: true, etapa_fila: "primeira" });
  });
});

describe("a linha do tempo", () => {
  const evento = (payload: Record<string, string>): LeadEvent => ({
    id: "r1",
    leadId: "ANTIGO",
    brand: "consorcio",
    leadName: "Já era lead",
    actor: "n8n",
    action: "reenvio",
    createdAt: "2026-11-16T18:30:00.000Z",
    payload,
  });
  const texto = (e: LeadEvent) => renderToStaticMarkup(createElement(DescricaoEvento, { e })).replace(/<[^>]+>/g, "");

  it("a reinscrição na live diz de quando a pessoa já era lead (dia de Brasília)", () => {
    // 27/10 01h UTC = 26/10 22h em Brasília.
    expect(texto(evento({ pelo: "telefone", origem: "n8n", inscricaoLive: "Live 01/12", leadDesde: "2026-10-27T01:00:00.000Z" }))).toBe(
      "Inscreveu-se na live 01/12 (já era lead desde 26/10)",
    );
  });

  it("o reenvio de sempre continua com o texto de antes", () => {
    expect(texto(evento({ pelo: "telefone", origem: "n8n" }))).toContain("Preencheu o formulário de novo (reconhecido pelo telefone)");
  });
});
