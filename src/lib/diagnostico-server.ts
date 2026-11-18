import "server-only";
import { listCliquesComunidade, listDiagnosticos } from "./data/store";
import { campanhaDaLive } from "./live-server";
import { DEFAULT_BRAND, type CliqueComunidade, type DiagnosticoTentativa } from "./types";
import type { CampanhaDaLive } from "./live";

export interface DepoisDaInscricao {
  cfg: CampanhaDaLive;
  diagnosticos: DiagnosticoTentativa[];
  cliques: CliqueComunidade[];
}

/**
 * O que as páginas da live mandaram depois da inscrição (o clique na comunidade e
 * o diagnóstico) e a régua da live — o carregador ÚNICO de Leads, da ficha e da
 * exportação. Só a marca da live (a padrão) tem; as outras, nada.
 */
export async function carregarDepoisDaInscricao(brand: string): Promise<DepoisDaInscricao | undefined> {
  if (brand !== DEFAULT_BRAND) return undefined;
  const [cfg, diagnosticos, cliques] = await Promise.all([campanhaDaLive(), listDiagnosticos(), listCliquesComunidade()]);
  return { cfg, diagnosticos, cliques };
}
