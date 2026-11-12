import { Fragment } from "react";
import { CHART } from "@/components/charts/colors";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info } from "@/components/ui/info";
import type { FunilDaTela, LinhaDoFunil } from "@/lib/funil";
import { cn } from "@/lib/utils";

type CardDoFunil = NonNullable<FunilDaTela["funil"]>;

/** A largura da barra em % (0–100, uma casa): nunca negativa nem acima da âncora. */
const largura = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 1000) / 10}%`;

/**
 * Uma linha do funil (§2.2): rótulo, ⓘ e selo à esquerda; número, % e o extra
 * (CPL, receita) à direita — quebra no celular, nunca rola de lado. A junta
 * tracejada fica ANTES da linha cuja fonte troca de sistema; a barra (de Leads
 * para baixo, Leads = 100%) é só desenho (`aria-hidden`), na cor da série.
 */
function Linha({ l }: { l: LinhaDoFunil }) {
  return (
    <li
      data-linha={l.id}
      className={cn("py-1", l.recuo && "pl-4", l.trocaDeSistema && "mt-1 border-t border-dashed pt-2")}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
        <span className="flex min-w-0 items-center gap-1">
          <span className={cn(l.id === "leads" ? "font-medium" : "text-muted-foreground")}>{l.rotulo}</span>
          <Info texto={l.dica} rotulo={"Sobre " + l.rotulo} className="-my-1" />
          <Badge variant="outline" className="rounded px-1.5 py-px text-[10px] font-normal tracking-wide uppercase">
            {l.selo}
          </Badge>
        </span>
        <span className="ml-auto text-right tabular-nums">
          <span className="font-semibold">{l.texto}</span>
          {l.taxa ? <span className="text-muted-foreground"> · {l.taxa}</span> : null}
          {l.extra ? <span className="text-muted-foreground"> · {l.extra}</span> : null}
        </span>
      </div>
      {l.barra != null ? (
        <div aria-hidden="true" className="mt-1 h-1.5 overflow-hidden rounded-full bg-foreground/[0.06]">
          <div
            className="h-full rounded-full"
            style={{ width: largura(l.barra), backgroundColor: CHART.primary }}
          />
        </div>
      ) : null}
    </li>
  );
}

/**
 * O card do FUNIL (Fase 3, §2.2): o título é a resposta ("120 leads → 15
 * agendaram → 2 vendas"); a leitura do robô parada, quando houver, é UMA frase
 * logo abaixo dele e ACIMA da lista (nunca dentro do `<ol>`); depois, uma linha
 * por degrau — o topo da cascata (impressões → visitas → leads, sobre as
 * impressões) e o funil do processo (de Leads para baixo, Leads = 100%), com a
 * ponte do convite do robô logo depois de "Agendaram". Tudo vem pronto de
 * `montarFunilDaTela`; aqui só se desenha. As explicações estão nos ⓘ.
 */
export function FunilDoProcesso({ funil, className }: { funil: CardDoFunil; className?: string }) {
  return (
    <Card className={cn("min-w-0", className)} data-bloco="funil">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-0.5" data-titulo>
          <span className="min-w-0">{funil.titulo}</span>
          <Info texto={funil.dica} rotulo="Sobre o funil" className="-my-1" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {funil.leituraParada ? (
          <p className="text-xs font-medium text-[var(--status-perto-text)]" data-parte="funil">
            {funil.leituraParada.texto}
          </p>
        ) : null}
        <ol className="text-sm" aria-label="Funil do processo" data-parte="funil">
          {funil.linhas.map((l) => (
            <Fragment key={l.id}>
              <Linha l={l} />
              {l.id === "agendaram" && funil.ponte ? (
                <li className="pb-1 pl-4 text-xs text-muted-foreground" data-linha="ponte">
                  {funil.ponte}
                </li>
              ) : null}
            </Fragment>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
