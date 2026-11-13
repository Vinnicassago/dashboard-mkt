import "server-only";
import { getData, listDrafts } from "./data/store";
import { hasPlaybook } from "./content/playbook";
import { montarConteudoDaTela } from "./conteudo";
import type { ConteudoDaTela } from "./conteudo-tela";
import { pageRange } from "./page-range";
import { PERIODO_PADRAO_DO_CONTEUDO, hojeEmBrasilia } from "./range";

/**
 * O carregador do Conteúdo (Fase 5, nov/26) — o I/O da página num lugar só; a tela
 * sai INTEIRA da função pura `montarConteudoDaTela` (`lib/conteudo.ts`).
 *
 * Lê a marca (`getData`) e, com o guia de produção (`hasPlaybook`), as peças
 * (`listDrafts`) — que só entram como contagem na grade da semana. Sem `?range=` vale
 * 30 dias (`PERIODO_PADRAO_DO_CONTEUDO`, F5-D2). Não importa `robo/client` nem
 * `robo/sync` e não lê `can()` (a página lê).
 */
export interface ConteudoCarregado {
  /** A chave do período resolvida (sem `?range=` = "30d"). */
  rangeKey: string;
  conteudo: ConteudoDaTela;
}

export async function carregarConteudo(brandSlug: string, rangeKeyParam?: string): Promise<ConteudoCarregado> {
  const agoraDate = new Date();
  const agora = agoraDate.toISOString();
  const hoje = hojeEmBrasilia(agoraDate);
  const comPlaybook = hasPlaybook(brandSlug);

  const [data, drafts] = await Promise.all([
    getData(brandSlug),
    comPlaybook ? listDrafts(brandSlug) : Promise.resolve([]),
  ]);

  const { range, rangeKey, naoComecou } = pageRange(data, rangeKeyParam ?? PERIODO_PADRAO_DO_CONTEUDO, hoje);

  return {
    rangeKey,
    conteudo: montarConteudoDaTela({
      data,
      drafts,
      range,
      rangeKey,
      naoComecou,
      marca: brandSlug,
      comPlaybook,
      hoje,
      agora,
    }),
  };
}
