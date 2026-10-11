import Link from "next/link";
import { ObjectiveSplitBar } from "@/components/kpi/objective-split";
import { StatusMetaBadge } from "@/components/kpi/status-meta";
import { Card, CardContent } from "@/components/ui/card";
import { dica } from "@/lib/dicionario";
import { comPeriodo } from "@/lib/range";
import { MIN_REUNIOES } from "@/lib/trust";
import { formatInt } from "@/lib/format";
import type { ResumoMidia } from "@/lib/midia";
import { cn } from "@/lib/utils";

/**
 * O RESUMO da Mídia — primeiro viewport, uma linha de resposta: quanto foi
 * investido, em quê, a quanto por lead e por reunião, e se a verba está no
 * ritmo combinado. Tudo de `kpisDoPeriodo` (via `resumoDaMidia`): o CPL daqui
 * é o da Bússola. Custo por reunião em quarentena vira o FATO ("R$ 160
 * investidos · 1 reunião"), nunca a razão.
 */

function Numero({
  rotulo,
  dica: titulo,
  valor,
  fato,
  rodape,
  destaque,
}: {
  rotulo: string;
  dica?: string;
  valor: string;
  /** O valor é um fato em texto (menor), não um número. */
  fato?: boolean;
  rodape?: React.ReactNode;
  destaque?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted-foreground" title={titulo}>
        {rotulo}
      </p>
      <p
        className={cn(
          "mt-1 tabular font-semibold tracking-tight",
          fato ? "text-sm leading-snug" : "text-2xl",
          destaque && !fato && "text-primary",
        )}
      >
        {valor}
      </p>
      {rodape ? <div className="mt-1 flex min-h-[1rem] flex-wrap items-center gap-x-2 text-xs text-muted-foreground">{rodape}</div> : null}
    </div>
  );
}

export function ResumoMidiaCard({ resumo, rangeKey }: { resumo: ResumoMidia; rangeKey?: string }) {
  const c = resumo.custoPorReuniao;
  return (
    <Card id="resumo" className="scroll-mt-24">
      <CardContent className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
          <Numero
            rotulo="Investimento total"
            dica={dica("investimento")}
            valor={resumo.investimento.texto}
            rodape={
              resumo.investimento.medida.confianca ? (
                <span className="text-[var(--warning-text)]">{resumo.investimento.medida.confianca.motivo}</span>
              ) : (
                <span>conversão + descoberta no período</span>
              )
            }
          />
          <Numero
            rotulo="CPL (painel)"
            dica={dica("cpl")}
            valor={resumo.cpl.texto}
            destaque
            rodape={
              <>
                <span>sobre {formatInt(resumo.cpl.medida.n)} leads de conversão</span>
                {resumo.cpl.meta ? <StatusMetaBadge meta={resumo.cpl.meta} /> : <span>· sem meta</span>}
              </>
            }
          />
          <Numero
            rotulo="Custo por reunião agendada"
            dica={dica("custo_por_reuniao")}
            valor={c.texto}
            fato={!c.exibivel}
            destaque={c.exibivel}
            rodape={
              c.exibivel ? (
                <>
                  <span>n = {formatInt(c.n)}</span>
                  {c.meta ? <StatusMetaBadge meta={c.meta} /> : <span>· sem meta</span>}
                </>
              ) : (
                <span>o custo volta com {MIN_REUNIOES} reuniões de conversão no período</span>
              )
            }
          />
          {resumo.ritmo ? (
            <Numero
              rotulo="Ritmo contra o orçamento"
              dica="Investimento em conversão do período contra o orçamento de conversão (meta semanal somada dia a dia)."
              valor={resumo.ritmo.gastoTexto}
              rodape={
                <>
                  <span>
                    de {resumo.ritmo.alvoTexto} previstos{resumo.ritmo.parcial ? " (parte do período sem meta)" : ""}
                  </span>
                  {resumo.ritmo.avaliacao ? <StatusMetaBadge meta={{ avaliacao: resumo.ritmo.avaliacao }} /> : null}
                </>
              }
            />
          ) : (
            // B9: sem orçamento, o gasto NÃO vira orçamento — vira convite.
            <Numero
              rotulo="Ritmo contra o orçamento"
              valor="Orçamento não cadastrado"
              fato
              rodape={
                <Link href={comPeriodo("/configuracoes#orcamento", rangeKey)} className="font-medium text-primary underline-offset-4 hover:underline">
                  cadastrar o orçamento de conversão para ver o ritmo →
                </Link>
              }
            />
          )}
        </div>
        <ObjectiveSplitBar conversao={resumo.conversao} descoberta={resumo.descoberta} />
      </CardContent>
    </Card>
  );
}
