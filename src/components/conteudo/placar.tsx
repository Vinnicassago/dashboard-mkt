import { Info } from "@/components/ui/info";
import type { PlacarDaTela } from "@/lib/conteudo-tela";

/**
 * O PLACAR do Conteúdo (Fase 5 de nov/26, §2.2): UMA linha, sem régua (sem Δ, sem
 * meta, sem cor) — "N posts no período · Último post há N dias · Seguidores +N (pago +
 * orgânico)", pronta em `montarConteudoDaTela`. Texto corrido: a linha quebra entre as
 * partes e nenhuma parte quebra no meio (`whitespace-nowrap`). O ⓘ diz o que conta,
 * quem ficou de fora e desde quando a variação de seguidores conta.
 *
 * Logo embaixo, só com grupo que ainda tem 2+ posts na grade, a linha "N grupos de
 * posts iguais no mesmo dia para conferir →": um `<a href="#variacoes">` simples — o
 * `RolarParaAncora abrirDetalhes` da página abre o recolhido no clique.
 */
export function Placar({ placar, variacoes }: { placar: PlacarDaTela; variacoes: string | null }) {
  return (
    <div className="space-y-1">
      <p id="placar" data-parte="placar" className="max-w-3xl scroll-mt-24 text-base leading-relaxed font-semibold">
        <span className="whitespace-nowrap">{placar.posts}</span>
        {" · "}
        <span className="whitespace-nowrap">{placar.ultimo}</span>
        {" · "}
        <span className="whitespace-nowrap">{placar.seguidores}</span>{" "}
        <Info texto={placar.dica} rotulo="Sobre o placar" className="-my-1" />
      </p>
      {variacoes ? (
        <p data-parte="variacoes" className="text-sm">
          <a href="#variacoes" className="font-medium text-primary underline-offset-4 hover:underline">
            {`${variacoes} →`}
          </a>
        </p>
      ) : null}
    </div>
  );
}
