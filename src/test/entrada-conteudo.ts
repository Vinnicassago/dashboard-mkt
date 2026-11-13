/**
 * Helpers da Fase 5 de nov/26 que CHAMAM a lib da tela do Conteúdo (fora da coleta do
 * vitest, que só pega `*.test.ts`). `fixtures-conteudo.ts` é só DADO; daqui saem as
 * entradas montadas sobre ele (e sobre o seed):
 *
 *   • `entradaConteudoDa` — a `EntradaConteudo` de `montarConteudoDaTela`, a MESMA conta
 *     do carregador (`pageRange` com `PERIODO_PADRAO_DO_CONTEUDO` sem chave, e
 *     `hasPlaybook(marca)`);
 *   • `conteudoDa` — `montarConteudoDaTela` sobre ela;
 *   • `seedDaMarca` — o seed recortado por marca (`porMarca`).
 */
import { hasPlaybook } from "@/lib/content/playbook";
import { montarConteudoDaTela } from "@/lib/conteudo";
import type { ConteudoDaTela, EntradaConteudo } from "@/lib/conteudo-tela";
import { buildSeedData } from "@/lib/data/seed";
import { pageRange } from "@/lib/page-range";
import { PERIODO_PADRAO_DO_CONTEUDO } from "@/lib/range";
import type { DashboardData, PostDraft } from "@/lib/types";
import { porMarca } from "./fixtures-robo";
import { HOJE } from "./fixtures-conteudo";

export interface OpcoesDaEntrada {
  /** Padrão: a marca da campanha do dado (`porMarca` a grava), senão "consorcio". */
  marca?: string;
  /** AAAA-MM-DD em Brasília (padrão: `HOJE`, 13/11). */
  hoje?: string;
  /** ISO (padrão: 12:00 de `hoje` em Brasília — `AGORA` quando `hoje` = `HOJE`). */
  agora?: string;
  /** As peças da Produção (padrão: nenhuma, como em produção). */
  drafts?: PostDraft[];
}

/** A `EntradaConteudo` de um dado numa chave de período (sem chave = o padrão do Conteúdo, 30 dias). */
export function entradaConteudoDa(d: DashboardData, rangeKey?: string, o: OpcoesDaEntrada = {}): EntradaConteudo {
  const marca = o.marca ?? (d.campaign.brand || "consorcio");
  const hoje = o.hoje ?? HOJE;
  const { range, rangeKey: chave, naoComecou } = pageRange(d, rangeKey ?? PERIODO_PADRAO_DO_CONTEUDO, hoje);
  return {
    data: d,
    drafts: o.drafts ?? [],
    range,
    rangeKey: chave,
    naoComecou,
    marca,
    comPlaybook: hasPlaybook(marca),
    hoje,
    agora: o.agora ?? `${hoje}T15:00:00.000Z`,
  };
}

/** `montarConteudoDaTela` sobre um dado numa chave. */
export const conteudoDa = (d: DashboardData, rangeKey?: string, o: OpcoesDaEntrada = {}): ConteudoDaTela =>
  montarConteudoDaTela(entradaConteudoDa(d, rangeKey, o));

/** O seed recortado por marca (o mesmo `porMarca` do Início e da Mídia). */
export function seedDaMarca(marca = "consorcio"): DashboardData {
  return porMarca(buildSeedData(), marca);
}
