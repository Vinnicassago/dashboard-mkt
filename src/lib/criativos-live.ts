/**
 * Os criativos da live na Mídia (E3-02) — puro. Um criativo por id do criativo
 * na Meta (o mesmo criativo em vários anúncios soma), com o lead ligado ao anúncio
 * pela junção única (`lib/atribuicao.ts`: o id gravado na entrada vence, depois o
 * utm_content; ambíguo ou macro não é atribuído a ninguém).
 *
 * O sinal é SUGESTÃO — o painel não pausa nada no Meta:
 *   • "cedo demais" até ter 5 dias no ar E R$ 60 gastos;
 *   • "pausar" quando o custo por qualificado passa do DOBRO da média dos
 *     criativos julgáveis (sem nenhum qualificado e julgável, também);
 *   • o criativo de carro (9) só é julgado a partir de 28/11, contra os de imóvel
 *     da MESMA semana.
 */
import { atribuidor } from "./atribuicao";
import { casaToken } from "./regra-de-marca";
import { classeDoLead } from "./qualificacao";
import { segundaDaSemana } from "./semana";
import { ehInscritoDaLive, linhaDaCampanha, type CampanhaDaLive } from "./live";
import type { AdDaily, DashboardData, Lead } from "./types";

/** Julgável a partir daqui (os dois, juntos). */
export const DIAS_MIN_CRIATIVO = 5;
export const GASTO_MIN_CRIATIVO = 60;
/** "Pausar" acima deste múltiplo da média. */
export const MULTIPLO_PAUSAR = 2;

export type SinalCriativo = "cedo" | "ok" | "pausar" | "sem_base";

export interface CriativoDaLive {
  /** Id do criativo na Meta (ou do anúncio, sem ele). */
  chave: string;
  nome: string;
  anuncios: string[];
  conjuntos: string[];
  gasto: number;
  /** Dias com veiculação (gasto > 0) no período. */
  diasNoAr: number;
  inscritos: number;
  qualificados: number;
  /** Gasto ÷ qualificados; null sem qualificado. */
  custoPorQualificado: number | null;
  /** Dos inscritos com finalidade, quantos querem quitar dívidas (0–1). */
  quitarDividas: number | null;
  carro: boolean;
  imovel: boolean;
  sinal: SinalCriativo;
  /** Por que o sinal (para a dica da coluna). */
  porque: string;
}

export interface Comparacao {
  titulo: string;
  lados: { rotulo: string; tokens: string[]; gasto: number; inscritos: number; qualificados: number; custoPorQualificado: number | null; quitarDividas: number | null; anuncios: number }[];
}

export interface CriativosDaLive {
  criativos: CriativoDaLive[];
  /** Média do custo por qualificado dos criativos julgáveis (sem o carro). */
  media: number | null;
  /** Média dos de imóvel na semana do carro — a régua do criativo 9. */
  mediaImovelDaSemana: number | null;
  comparacoes: Comparacao[];
  naoAtribuidos: number;
}

interface Acumulado {
  chave: string;
  nome: string;
  anuncios: Set<string>;
  conjuntos: Set<string>;
  gasto: number;
  dias: Set<string>;
  leads: Lead[];
  carro: boolean;
  imovel: boolean;
}

const dentro = (d: string, de: string, ate: string) => d >= de && d <= ate;

function medidas(gasto: number, leads: Lead[]) {
  const qualificados = leads.filter((l) => {
    const c = classeDoLead(l);
    return c === "A" || c === "B";
  }).length;
  const comFinalidade = leads.filter((l) => l.finalidade);
  return {
    qualificados,
    custoPorQualificado: qualificados > 0 && gasto > 0 ? gasto / qualificados : null,
    quitarDividas: comFinalidade.length ? comFinalidade.filter((l) => l.finalidade === "quitar_dividas").length / comFinalidade.length : null,
  };
}

const media = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export function criativosDaLive(
  data: DashboardData,
  cfg: CampanhaDaLive,
  range: { de: string; ate: string },
  hoje: string,
): CriativosDaLive {
  const rows = data.adDaily.filter((r) => linhaDaCampanha(r, cfg) && dentro(r.date, range.de, range.ate));
  const creativeIdDe = new Map(data.creatives.map((c) => [c.adId, c.creativeId ?? c.adId]));
  const nomeDe = new Map(data.creatives.map((c) => [c.adId, c.name]));
  const chaveDe = (adId: string) => creativeIdDe.get(adId) ?? adId;
  const ehCarro = (r: AdDaily) =>
    cfg.carro.anuncios.some((t) => casaToken(nomeDe.get(r.adId) ?? "", r.adId, t)) ||
    cfg.carro.conjuntos.some((t) => casaToken(r.adset, r.adsetId, t));
  const ehImovel = (r: AdDaily) => cfg.comparacoes.imovel.some((t) => casaToken(nomeDe.get(r.adId) ?? "", r.adId, t));

  const porChave = new Map<string, Acumulado>();
  for (const r of rows) {
    const k = chaveDe(r.adId);
    const a =
      porChave.get(k) ??
      ({ chave: k, nome: nomeDe.get(r.adId) ?? r.adId, anuncios: new Set(), conjuntos: new Set(), gasto: 0, dias: new Set(), leads: [], carro: false, imovel: false } as Acumulado);
    a.anuncios.add(r.adId);
    if (r.adset) a.conjuntos.add(r.adset);
    a.gasto += r.spend;
    if (r.spend > 0) a.dias.add(r.date);
    a.carro ||= ehCarro(r);
    a.imovel ||= ehImovel(r);
    porChave.set(k, a);
  }

  // Inscritos do período ligados a um anúncio da live.
  const atribuir = atribuidor(data.creatives);
  const anuncioDaLive = new Set(rows.map((r) => r.adId));
  let naoAtribuidos = 0;
  const inscritos = data.leads.filter((l) => ehInscritoDaLive(l, cfg) && dentro(l.createdAt.slice(0, 10), range.de, range.ate));
  for (const l of inscritos) {
    const a = atribuir(l);
    if (!a.adId || !anuncioDaLive.has(a.adId)) {
      naoAtribuidos += 1;
      continue;
    }
    porChave.get(chaveDe(a.adId))?.leads.push(l);
  }

  const base = [...porChave.values()].map((a) => {
    const m = medidas(a.gasto, a.leads);
    return {
      chave: a.chave,
      nome: a.nome,
      anuncios: [...a.anuncios],
      conjuntos: [...a.conjuntos],
      gasto: a.gasto,
      diasNoAr: a.dias.size,
      inscritos: a.leads.length,
      ...m,
      carro: a.carro,
      imovel: a.imovel,
      julgavel: a.dias.size >= DIAS_MIN_CRIATIVO && a.gasto >= GASTO_MIN_CRIATIVO,
    };
  });

  // A média da régua: os julgáveis com qualificado, fora o carro (ele tem a régua dele).
  const mediaGeral = media(base.filter((c) => c.julgavel && !c.carro && c.custoPorQualificado != null).map((c) => c.custoPorQualificado!));

  // O carro contra os de imóvel da MESMA semana (segunda a domingo do fim do período).
  const seg = segundaDaSemana(range.ate);
  const semana = { de: seg, ate: range.ate };
  const daSemana = criativosDaSemana(data, cfg, semana, rows, chaveDe, atribuir, inscritos);
  const mediaImovel = media(
    daSemana.filter((c) => c.imovel && !c.carro && c.custoPorQualificado != null).map((c) => c.custoPorQualificado!),
  );

  const criativos: CriativoDaLive[] = base
    .map((c) => {
      let sinal: SinalCriativo;
      let porque: string;
      if (c.carro && hoje < cfg.carro.julgarDesde) {
        sinal = "cedo";
        porque = `o criativo de carro só é julgado a partir de ${cfg.carro.julgarDesde.split("-").reverse().slice(0, 2).join("/")}`;
      } else if (!c.julgavel) {
        sinal = "cedo";
        porque = `cedo demais: ${c.diasNoAr} de ${DIAS_MIN_CRIATIVO} dias no ar, R$ ${Math.round(c.gasto)} de R$ ${GASTO_MIN_CRIATIVO} gastos`;
      } else {
        const semanaDoCarro = c.carro ? daSemana.find((x) => x.chave === c.chave) : undefined;
        const regua = c.carro ? mediaImovel : mediaGeral;
        const custo = c.carro ? (semanaDoCarro?.custoPorQualificado ?? null) : c.custoPorQualificado;
        const gasto = c.carro ? (semanaDoCarro?.gasto ?? 0) : c.gasto;
        if (regua == null) {
          sinal = "sem_base";
          porque = c.carro ? "sem criativo de imóvel com qualificado na semana para comparar" : "sem outro criativo julgável com qualificado para comparar";
        } else if (custo == null ? gasto > MULTIPLO_PAUSAR * regua : custo > MULTIPLO_PAUSAR * regua) {
          sinal = "pausar";
          porque =
            (custo == null ? `R$ ${Math.round(gasto)} sem nenhum qualificado` : `custo por qualificado de R$ ${Math.round(custo)}`) +
            ` — mais que ${MULTIPLO_PAUSAR}× a média (R$ ${Math.round(regua)})${c.carro ? " dos de imóvel na mesma semana" : " dos criativos julgáveis"}`;
        } else {
          sinal = "ok";
          porque = `dentro de ${MULTIPLO_PAUSAR}× a média (R$ ${Math.round(regua)})${c.carro ? " dos de imóvel na mesma semana" : ""}`;
        }
      }
      return {
        chave: c.chave,
        nome: c.nome,
        anuncios: c.anuncios,
        conjuntos: c.conjuntos,
        gasto: c.gasto,
        diasNoAr: c.diasNoAr,
        inscritos: c.inscritos,
        qualificados: c.qualificados,
        custoPorQualificado: c.custoPorQualificado,
        quitarDividas: c.quitarDividas,
        carro: c.carro,
        imovel: c.imovel,
        sinal,
        porque,
      };
    })
    .sort((a, b) => b.gasto - a.gasto);

  // Lado a lado: teste A × B (pelo nome do anúncio) e Persona × Público aberto (pelo conjunto).
  const lado = (rotulo: string, tokens: string[], porConjunto: boolean) => {
    const casa = (r: AdDaily) =>
      porConjunto ? tokens.some((t) => casaToken(r.adset, r.adsetId, t)) : tokens.some((t) => casaToken(nomeDe.get(r.adId) ?? "", r.adId, t));
    const doLado = rows.filter(casa);
    const ids = new Set(doLado.map((r) => r.adId));
    const leads = inscritos.filter((l) => {
      const a = atribuir(l).adId;
      return a != null && ids.has(a);
    });
    const gasto = doLado.reduce((s, r) => s + r.spend, 0);
    return { rotulo, tokens, gasto, inscritos: leads.length, anuncios: ids.size, ...medidas(gasto, leads) };
  };
  const comparacoes: Comparacao[] = [
    { titulo: "Teste A × B", lados: [lado("A", cfg.comparacoes.testeA, false), lado("B", cfg.comparacoes.testeB, false)] },
    { titulo: "Persona × Público aberto", lados: [lado("Persona", cfg.comparacoes.persona, true), lado("Público aberto", cfg.comparacoes.aberto, true)] },
  ];

  return { criativos, media: mediaGeral, mediaImovelDaSemana: mediaImovel, comparacoes, naoAtribuidos };
}

/** Os criativos de UMA semana (gasto e qualificados só dela) — a régua do carro. */
function criativosDaSemana(
  data: DashboardData,
  cfg: CampanhaDaLive,
  semana: { de: string; ate: string },
  rowsDoPeriodo: AdDaily[],
  chaveDe: (adId: string) => string,
  atribuir: ReturnType<typeof atribuidor>,
  inscritos: Lead[],
) {
  const nomeDe = new Map(data.creatives.map((c) => [c.adId, c.name]));
  const rows = rowsDoPeriodo.filter((r) => dentro(r.date, semana.de, semana.ate));
  const porChave = new Map<string, { gasto: number; ids: Set<string>; imovel: boolean; carro: boolean }>();
  for (const r of rows) {
    const k = chaveDe(r.adId);
    const a = porChave.get(k) ?? { gasto: 0, ids: new Set<string>(), imovel: false, carro: false };
    a.gasto += r.spend;
    a.ids.add(r.adId);
    a.imovel ||= cfg.comparacoes.imovel.some((t) => casaToken(nomeDe.get(r.adId) ?? "", r.adId, t));
    a.carro ||=
      cfg.carro.anuncios.some((t) => casaToken(nomeDe.get(r.adId) ?? "", r.adId, t)) ||
      cfg.carro.conjuntos.some((t) => casaToken(r.adset, r.adsetId, t));
    porChave.set(k, a);
  }
  const daSemana = inscritos.filter((l) => dentro(l.createdAt.slice(0, 10), semana.de, semana.ate));
  return [...porChave.entries()].map(([chave, a]) => {
    const leads = daSemana.filter((l) => {
      const id = atribuir(l).adId;
      return id != null && a.ids.has(id);
    });
    return { chave, gasto: a.gasto, imovel: a.imovel, carro: a.carro, ...medidas(a.gasto, leads) };
  });
}
