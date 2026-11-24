/**
 * Leads num período da live (o atalho "Live 01/12" e os sub-atalhos): a lista é
 * dos INSCRITOS da live, pela data da inscrição — o mesmo número das "Inscrições"
 * do painel da live no Início. Antes, a lista era todo lead que ENTROU nessas
 * datas: a outra campanha, que segue rodando, aparecia como se fosse da live
 * (45 na tela, 4 inscritos), e quem já era lead e se inscreveu não aparecia.
 */
import { describe, expect, it } from "vitest";
import { LIVE_PADRAO } from "@/lib/live";
import { chavesDaLive } from "@/lib/atalho-live";
import { montarPainelLive } from "@/lib/live-painel";
import { rangeDoPainelLive } from "@/lib/atalho-live";
import { EXPEDIENTE_PADRAO } from "@/lib/turno";
import { janelaDaLiveEmLeads, montarLinhasDeLeads, sobreALista } from "@/lib/leads-vista";
import { resumoDepoisDaInscricao } from "@/lib/diagnostico-live";
import { base } from "@/test/fixtures-robo";
import type { Lead } from "@/lib/types";

const cfg = LIVE_PADRAO;
const HOJE = "2026-11-24";
const AGORA = "2026-11-24T18:00:00.000Z";
const chaves = chavesDaLive(cfg);

let n = 0;
const lead = (id: string, over: Partial<Lead> = {}): Lead => ({
  id,
  brand: "consorcio",
  createdAt: "2026-11-20T13:00:00.000Z",
  name: `Pessoa ${id}`,
  phone: `55119000000${String(++n).padStart(2, "0")}`,
  status: "lead",
  ...over,
});

// Inscritos da live (vieram com a ficha) e leads da outra campanha nas MESMAS datas.
const inscrito = lead("LEAD-LP-insc01", { bem: "imovel" });
const inscritoC = lead("LEAD-LP-insc02", { classe: "C", createdAt: "2026-11-17T12:00:00.000Z" });
const reinscrito = lead("LEAD-LP-antigo", { createdAt: "2026-10-01T13:00:00.000Z", inscritoLiveEm: "2026-11-21T15:00:00.000Z", bem: "carro" });
const outraCampanha = lead("LEAD-LP-q1", { createdAt: "2026-11-19T13:00:00.000Z" });
const outraCampanha2 = lead("LEAD-LP-q2", { createdAt: "2026-11-23T13:00:00.000Z" });
const excluido = lead("LEAD-LP-excl", { bem: "imovel", deletedAt: "2026-11-21T10:00:00.000Z" });
const antesDaLive = lead("LEAD-LP-velho", { createdAt: "2026-11-02T13:00:00.000Z", bem: "imovel" });
const data = base({ leads: [inscrito, inscritoC, reinscrito, outraCampanha, outraCampanha2, excluido, antesDaLive] });
const live = { cfg, diagnosticos: [], cliques: [] };

const linhasCom = (rangeKey: string | undefined, range?: { from: string; to: string }) =>
  montarLinhasDeLeads(data, [], AGORA, { range, live, janelaDaLive: janelaDaLiveEmLeads(rangeKey, cfg, HOJE) });

describe("o período da live em Leads", () => {
  it("só as três chaves da régua ligam o recorte da live; período comum segue pela entrada", () => {
    expect(janelaDaLiveEmLeads("7d", cfg, HOJE)).toBeNull();
    expect(janelaDaLiveEmLeads("all", cfg, HOJE)).toBeNull();
    expect(janelaDaLiveEmLeads(undefined, cfg, HOJE)).toBeNull();
    // as mesmas datas digitadas à mão, com outra chave, é período comum
    expect(janelaDaLiveEmLeads("2026-11-16..2026-11-30", cfg, HOJE)).toBeNull();
    // a janela vai até hoje, como no painel
    expect(janelaDaLiveEmLeads(chaves.campanha, cfg, HOJE)).toEqual({ de: "2026-11-16", ate: HOJE });
    expect(janelaDaLiveEmLeads(chaves.captacao, cfg, HOJE)).toEqual({ de: "2026-11-16", ate: HOJE });
  });

  it("a lista é dos inscritos pela data da inscrição: a outra campanha sai, quem já era lead entra", () => {
    const ids = linhasCom(chaves.campanha).map((l) => l.id).sort();
    expect(ids).toEqual(["LEAD-LP-antigo", "LEAD-LP-insc01", "LEAD-LP-insc02"]);
    // antes: as mesmas datas pela entrada traziam a outra campanha e deixavam o reinscrito de fora
    const pelaEntrada = montarLinhasDeLeads(data, [], AGORA, { range: { from: "2026-11-16", to: HOJE }, live }).map((l) => l.id).sort();
    expect(pelaEntrada).toEqual(["LEAD-LP-insc01", "LEAD-LP-insc02", "LEAD-LP-q1", "LEAD-LP-q2"]);
    // e o resumo "Live · …" lê as MESMAS linhas: inscritos = a lista
    expect(resumoDepoisDaInscricao(linhasCom(chaves.campanha)).inscritos).toBe(3);
  });

  it("o pós-live ainda não começou: lista vazia (nunca a campanha inteira)", () => {
    expect(linhasCom(chaves.posLive)).toEqual([]);
  });

  it("sem a régua da live (outra marca), a chave é um período comum", () => {
    const linhas = montarLinhasDeLeads(data, [], AGORA, { range: { from: "2026-11-16", to: HOJE }, janelaDaLive: { de: "2026-11-16", ate: HOJE } });
    expect(linhas.map((l) => l.id)).toContain("LEAD-LP-q1");
  });

  it("um número só: a lista de cada janela é o número das Inscrições do painel da live", () => {
    for (const chave of Object.values(chaves)) {
      const r = rangeDoPainelLive(chave, HOJE, cfg.periodo);
      const painel = montarPainelLive({ data, eventos: [], cfg, expediente: EXPEDIENTE_PADRAO, range: { de: r.de, ate: r.ate }, hoje: HOJE, agora: AGORA });
      expect(linhasCom(chave).length, chave).toBe(painel.inscritos);
    }
  });

  it("o ⓘ da lista diz o recorte, em frases curtas", () => {
    const texto = sobreALista({ mascarar: false, exporta: true, live: true });
    expect(texto).toMatch(/só os inscritos na live/);
    for (const frase of texto.split(/(?<=[.!?])\s+/)) expect(frase.split(/\s+/).length, frase).toBeLessThanOrEqual(25);
  });
});
