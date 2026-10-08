/**
 * Alertas do painel — um lugar só, no cabeçalho ("⚠ N"). Puro.
 *
 * Antes eles moravam em quatro lugares: a faixa "Antes de decidir" (só na home de
 * conversão), o card "Qualidade dos dados" (só na home da Krone — na de conversão
 * eram calculados e jogados fora), o rodapé de pendências e o cabeçalho. Agora
 * todo aviso vira um `Alerta` e aparece no mesmo painel, em qualquer tela: os
 * GLOBAIS (sync falhando, campanha sem marca, rastreio aberto) vêm do layout; os
 * do PERÍODO (confiança dos números, atribuição) vêm da página que os calculou.
 */

import type { Trava } from "./trust";
import type { DataWarning, DateRange } from "./metrics";
import { filterLeads } from "./metrics";
import { atribuidor } from "./atribuicao";
import type { DashboardData } from "./types";

export type NivelAlerta = "falha" | "quarentena" | "teto" | "piso" | "aviso" | "config";

export interface Alerta {
  id: string;
  nivel: NivelAlerta;
  titulo: string;
  detalhe: string;
  cta?: { label: string; href: string };
}

/** Do mais grave ao menos grave — a ordem do painel. */
export const ORDEM_ALERTA: Record<NivelAlerta, number> = {
  falha: 5,
  quarentena: 4,
  teto: 3,
  piso: 2,
  aviso: 1,
  config: 0,
};

/** As travas de confiança (`assessTrust`) do período da página. */
export function alertasDeConfianca(travas: Trava[]): Alerta[] {
  return travas.map((t) => ({ id: `trava-${t.id}`, nivel: t.nivel, titulo: t.titulo, detalhe: t.detalhe, cta: t.cta }));
}

/** As checagens de saúde do dado (`dataQualityChecks`). */
export function alertasDeQualidade(warnings: DataWarning[]): Alerta[] {
  return warnings.map((w) => ({
    id: `qualidade-${w.message.slice(0, 40)}`,
    nivel: "aviso",
    titulo: w.message.split(" — ")[0],
    detalhe: w.message,
    cta: { label: "Ver integrações", href: "/config#integracoes" },
  }));
}

/**
 * Leads do período cuja origem não aponta para um anúncio: a macro do link não
 * foi resolvida ({{ad.name}} literal) ou o nome bate com mais de um anúncio.
 * Eles contam como lead, mas ficam fora do custo por criativo e por conjunto.
 */
export function alertasDeAtribuicao(data: DashboardData, range?: DateRange): Alerta[] {
  const atribuir = atribuidor(data.creatives);
  let macro = 0;
  let ambigua = 0;
  for (const l of filterLeads(data.leads, range)) {
    const t = atribuir(l).tipo;
    if (t === "macro") macro += 1;
    else if (t === "ambigua") ambigua += 1;
  }
  const out: Alerta[] = [];
  if (macro > 0) {
    out.push({
      id: "atribuicao-macro",
      nivel: "aviso",
      titulo: `${macro} ${macro === 1 ? "lead chegou" : "leads chegaram"} com a origem “{{…}}” sem resolver`,
      detalhe:
        "O link do anúncio usa uma macro que a Meta não preencheu (ex.: {{ad.name}} literal no utm_content). Esses leads aparecem com origem “Desconhecida” e ficam fora do custo por criativo e por conjunto. Corrija o utm_content no anúncio — use {{ad.id}}.",
      cta: { label: "Gerar o link certo", href: "/config#utm" },
    });
  }
  if (ambigua > 0) {
    out.push({
      id: "atribuicao-ambigua",
      nivel: "aviso",
      titulo: `${ambigua} ${ambigua === 1 ? "lead tem" : "leads têm"} origem ambígua`,
      detalhe:
        "O utm_content traz só o NOME do anúncio, e mais de um anúncio tem esse nome. Sem o id não dá para dizer qual trouxe o lead — atribuir ao primeiro poderia mandar pausar o errado. Eles ficam fora do custo por criativo; inclua o id do anúncio no link.",
      cta: { label: "Gerar o link certo", href: "/config#utm" },
    });
  }
  return out;
}

/** Junta, tira repetidos (mesmo id) e ordena do mais grave. */
export function ordenarAlertas(listas: Alerta[][]): Alerta[] {
  const porId = new Map<string, Alerta>();
  for (const a of listas.flat()) if (!porId.has(a.id)) porId.set(a.id, a);
  return [...porId.values()].sort((a, b) => ORDEM_ALERTA[b.nivel] - ORDEM_ALERTA[a.nivel]);
}
