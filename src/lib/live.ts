/**
 * A campanha da live de 01/12 — a régua que a aba Live, a Mídia e Configurações
 * leem: períodos, verba por linha, metas e como reconhecer o que é da live. Puro.
 *
 * Os números de fábrica são os do briefing (LIVE_PADRAO) e ficam editáveis em
 * Configurações → Metas e orçamento. Os NOMES no Gerenciador ainda não existiam
 * quando isto foi escrito: os tokens são uma proposta (`[LIVE] Captação`,
 * conjunto `Carro`, anúncio `C9`…) e a tela deixa trocar sem deploy.
 */
import { casaToken, tokensDoCampo } from "./regra-de-marca";
import { classeDoLead } from "./qualificacao";
import type { AdDaily, Lead } from "./types";

export type IdDaLinha = "captacao" | "remarketing" | "pos_live";

export interface LinhaDeVerba {
  id: IdDaLinha;
  rotulo: string;
  /** AAAA-MM-DD, inclusivos. */
  de: string;
  ate: string;
  verba: number;
  /** Ritmo esperado (R$/dia); ausente = verba ÷ dias da linha. */
  porDia?: number;
  /** Trechos do NOME da campanha no Gerenciador (ou ids de campanha). */
  campanhas: string[];
}

export interface Intervalo {
  de: string;
  ate: string;
}

export interface CampanhaDaLive {
  nome: string;
  /** Data e hora da live (ISO). */
  dataDaLive: string;
  /** "Campanha da live": o período padrão da aba. */
  periodo: Intervalo;
  captacao: Intervalo;
  posLive: Intervalo;
  linhas: LinhaDeVerba[];
  /** O conjunto do carro (criativo 9): ritmo próprio a partir de uma data. */
  carro: {
    desde: string;
    porDia: number;
    /** Trechos do NOME do conjunto (ou ids de conjunto). */
    conjuntos: string[];
    /** Trechos do nome do anúncio do criativo 9 (o de carro). */
    anuncios: string[];
    /** O criativo de carro só é julgado a partir desta data. */
    julgarDesde: string;
  };
  metas: {
    inscricoes: number;
    qualificados: number;
    comunidade: number;
    presentes: number;
    agendadas: number;
    realizadas: number;
    /** Sem meta no briefing: vendas só são contadas. */
    vendas: number | null;
  };
  custos: { porInscrito: number; porQualificadoMax: number };
  atendimento: {
    msgAutomatica: number;
    aNoPrazo: number;
    bNoPrazo: number;
    contatoValido48h: number;
  };
  qualidade: { quitarDividasMax: number };
  /** Como saber que um lead é inscrito da live (e não lead de outra campanha). */
  inscritos: {
    /** `ficha` = veio com as respostas do formulário da live (classe ou bem); `utm` = utm_campaign casa com os trechos. */
    criterio: "ficha" | "utm";
    utmCampaign: string[];
  };
  /** Comparações da Mídia (E3-02): trechos do nome do anúncio/conjunto. */
  comparacoes: {
    testeA: string[];
    testeB: string[];
    persona: string[];
    aberto: string[];
    imovel: string[];
  };
  /** O que o sistema não sabe — digitado na aba Live. */
  manuais: {
    presentesPico?: number;
    presentesTotal?: number;
    vendasQtd?: number;
    vendasValor?: number;
    atualizadoEm?: string;
    atualizadoPor?: string;
  };
  atualizadoEm?: string;
  atualizadoPor?: string;
}

/** O briefing de 03/11/2026. */
export const LIVE_PADRAO: CampanhaDaLive = {
  nome: "Live 01/12",
  dataDaLive: "2026-12-01T22:00:00.000Z", // terça 01/12, 19h em Brasília
  periodo: { de: "2026-11-16", ate: "2026-12-15" },
  captacao: { de: "2026-11-16", ate: "2026-12-01" },
  posLive: { de: "2026-12-02", ate: "2026-12-15" },
  linhas: [
    { id: "captacao", rotulo: "Captação", de: "2026-11-16", ate: "2026-12-01", verba: 4000, porDia: 250, campanhas: ["[LIVE] Captação", "[LIVE] Captacao"] },
    { id: "remarketing", rotulo: "Remarketing", de: "2026-11-27", ate: "2026-12-01", verba: 500, campanhas: ["[LIVE] Remarketing"] },
    { id: "pos_live", rotulo: "Pós-live", de: "2026-12-02", ate: "2026-12-15", verba: 500, campanhas: ["[LIVE] Pós-live", "[LIVE] Pos-live"] },
  ],
  carro: { desde: "2026-11-23", porDia: 40, conjuntos: ["Carro"], anuncios: ["C9"], julgarDesde: "2026-11-28" },
  metas: { inscricoes: 200, qualificados: 80, comunidade: 140, presentes: 50, agendadas: 15, realizadas: 11, vendas: null },
  custos: { porInscrito: 20, porQualificadoMax: 50 },
  atendimento: { msgAutomatica: 1, aNoPrazo: 0.9, bNoPrazo: 1, contatoValido48h: 0.6 },
  qualidade: { quitarDividasMax: 0.1 },
  inscritos: { criterio: "ficha", utmCampaign: [] },
  comparacoes: { testeA: ["C4A"], testeB: ["C4B"], persona: ["Persona"], aberto: ["Aberto"], imovel: ["Imóvel", "Imovel"] },
  manuais: {},
};

// ---------------------------------------------------------------- reconhecer

/** A linha de verba de uma campanha do Gerenciador (ou nenhuma: não é da live). */
export function linhaDaCampanha(r: Pick<AdDaily, "campaign" | "campaignId">, cfg: CampanhaDaLive): LinhaDeVerba | undefined {
  return cfg.linhas.find((l) => l.campanhas.some((t) => casaToken(r.campaign, r.campaignId, t)));
}

/** A linha de anúncio é da live (de alguma das três linhas de verba)? */
export const ehDaLive = (r: Pick<AdDaily, "campaign" | "campaignId">, cfg: CampanhaDaLive) => Boolean(linhaDaCampanha(r, cfg));

/** A linha de anúncio é do conjunto do carro? */
export const ehDoCarro = (r: Pick<AdDaily, "adset" | "adsetId">, cfg: CampanhaDaLive) =>
  cfg.carro.conjuntos.some((t) => casaToken(r.adset, r.adsetId, t));

/** O lead é inscrito da live? Pela ficha (respostas do formulário) ou pelo utm_campaign. */
export function ehInscritoDaLive(l: Lead, cfg: CampanhaDaLive): boolean {
  if (l.deletedAt) return false;
  const dia = l.createdAt.slice(0, 10);
  if (dia < cfg.periodo.de || dia > cfg.periodo.ate) return false;
  if (cfg.inscritos.criterio === "utm") {
    // Id numérico compara com o id gravado na entrada e, sem ele, com o próprio utm_campaign.
    return cfg.inscritos.utmCampaign.some((t) => casaToken(l.utmCampaign, l.campaignId ?? l.utmCampaign, t));
  }
  return Boolean(classeDoLead(l) || l.bem || l.faixaValor || l.finalidade);
}

// ---------------------------------------------------------------- ler do banco

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const dia = (v: unknown, padrao: string) => (typeof v === "string" && DIA.test(v) ? v : padrao);
const num = (v: unknown, padrao: number, min = 0, max = 1e9) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : padrao;
const numOuNada = (v: unknown, padrao: number | undefined) =>
  v === null ? undefined : typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : padrao;
const lista = (v: unknown, padrao: string[]) =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim()) : typeof v === "string" ? tokensDoCampo(v) : padrao;
const intervalo = (v: unknown, padrao: Intervalo): Intervalo => {
  const o = (v ?? {}) as Partial<Intervalo>;
  const de = dia(o.de, padrao.de);
  const ate = dia(o.ate, padrao.ate);
  return de <= ate ? { de, ate } : padrao;
};

/** Lê a campanha gravada: o que vier torto cai no padrão do briefing, campo a campo. */
export function lerCampanhaDaLive(v: unknown): CampanhaDaLive {
  const c = (v && typeof v === "object" ? v : {}) as Partial<CampanhaDaLive>;
  const P = LIVE_PADRAO;
  const linhas = P.linhas.map((padrao) => {
    const g = (Array.isArray(c.linhas) ? c.linhas.find((l) => l?.id === padrao.id) : undefined) as Partial<LinhaDeVerba> | undefined;
    const periodo = intervalo({ de: g?.de, ate: g?.ate }, { de: padrao.de, ate: padrao.ate });
    return {
      id: padrao.id,
      rotulo: padrao.rotulo,
      ...periodo,
      verba: num(g?.verba, padrao.verba),
      porDia: numOuNada(g?.porDia, padrao.porDia),
      campanhas: lista(g?.campanhas, padrao.campanhas),
    };
  });
  const m = (c.metas ?? {}) as Partial<CampanhaDaLive["metas"]>;
  const a = (c.atendimento ?? {}) as Partial<CampanhaDaLive["atendimento"]>;
  const k = (c.carro ?? {}) as Partial<CampanhaDaLive["carro"]>;
  const cmp = (c.comparacoes ?? {}) as Partial<CampanhaDaLive["comparacoes"]>;
  const man = (c.manuais ?? {}) as CampanhaDaLive["manuais"];
  return {
    nome: typeof c.nome === "string" && c.nome.trim() ? c.nome.trim().slice(0, 60) : P.nome,
    dataDaLive: typeof c.dataDaLive === "string" && Number.isFinite(Date.parse(c.dataDaLive)) ? new Date(c.dataDaLive).toISOString() : P.dataDaLive,
    periodo: intervalo(c.periodo, P.periodo),
    captacao: intervalo(c.captacao, P.captacao),
    posLive: intervalo(c.posLive, P.posLive),
    linhas,
    carro: {
      desde: dia(k.desde, P.carro.desde),
      porDia: num(k.porDia, P.carro.porDia),
      conjuntos: lista(k.conjuntos, P.carro.conjuntos),
      anuncios: lista(k.anuncios, P.carro.anuncios),
      julgarDesde: dia(k.julgarDesde, P.carro.julgarDesde),
    },
    metas: {
      inscricoes: num(m.inscricoes, P.metas.inscricoes),
      qualificados: num(m.qualificados, P.metas.qualificados),
      comunidade: num(m.comunidade, P.metas.comunidade),
      presentes: num(m.presentes, P.metas.presentes),
      agendadas: num(m.agendadas, P.metas.agendadas),
      realizadas: num(m.realizadas, P.metas.realizadas),
      vendas: m.vendas === null ? null : numOuNada(m.vendas, P.metas.vendas ?? undefined) ?? null,
    },
    custos: {
      porInscrito: num(c.custos?.porInscrito, P.custos.porInscrito),
      porQualificadoMax: num(c.custos?.porQualificadoMax, P.custos.porQualificadoMax),
    },
    atendimento: {
      msgAutomatica: num(a.msgAutomatica, P.atendimento.msgAutomatica, 0, 1),
      aNoPrazo: num(a.aNoPrazo, P.atendimento.aNoPrazo, 0, 1),
      bNoPrazo: num(a.bNoPrazo, P.atendimento.bNoPrazo, 0, 1),
      contatoValido48h: num(a.contatoValido48h, P.atendimento.contatoValido48h, 0, 1),
    },
    qualidade: { quitarDividasMax: num(c.qualidade?.quitarDividasMax, P.qualidade.quitarDividasMax, 0, 1) },
    inscritos: {
      criterio: c.inscritos?.criterio === "utm" ? "utm" : "ficha",
      utmCampaign: lista(c.inscritos?.utmCampaign, P.inscritos.utmCampaign),
    },
    comparacoes: {
      testeA: lista(cmp.testeA, P.comparacoes.testeA),
      testeB: lista(cmp.testeB, P.comparacoes.testeB),
      persona: lista(cmp.persona, P.comparacoes.persona),
      aberto: lista(cmp.aberto, P.comparacoes.aberto),
      imovel: lista(cmp.imovel, P.comparacoes.imovel),
    },
    manuais: {
      presentesPico: numOuNada(man.presentesPico, undefined),
      presentesTotal: numOuNada(man.presentesTotal, undefined),
      vendasQtd: numOuNada(man.vendasQtd, undefined),
      vendasValor: numOuNada(man.vendasValor, undefined),
      atualizadoEm: typeof man.atualizadoEm === "string" ? man.atualizadoEm : undefined,
      atualizadoPor: typeof man.atualizadoPor === "string" ? man.atualizadoPor : undefined,
    },
    atualizadoEm: typeof c.atualizadoEm === "string" ? c.atualizadoEm : undefined,
    atualizadoPor: typeof c.atualizadoPor === "string" ? c.atualizadoPor : undefined,
  };
}
