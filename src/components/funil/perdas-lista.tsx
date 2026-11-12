import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info } from "@/components/ui/info";
import type { FunilDaTela, LinhaDePerdaNaTela } from "@/lib/funil";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";

type CardDasPerdas = NonNullable<FunilDaTela["perdas"]>;

/** "Comercial 4 · Mídia / formulário 2"; com um alvo só, sem o número ("Oferta / pitch"). */
function textoDosAlvos(alvos: LinhaDePerdaNaTela["alvos"]): string {
  return alvos.map((a) => (a.n == null ? a.rotulo : `${a.rotulo} ${formatInt(a.n)}`)).join(" · ");
}

/**
 * "POR QUE PERDEMOS" (Fase 3, §2.3): o título é o total ("Perdemos 23 sem
 * reunião"; sem perdas, "Nenhuma perda sem reunião no período") e a lista tem
 * UMA linha por motivo, do maior para o menor — `{n} {motivo} [quem encerrou] →
 * {onde atacar}` e o ⓘ da linha (a parte nas perdas, o atraso do registro, as
 * tentativas e a regra do "onde atacar"). O maior motivo é a 1ª linha: a página
 * tem uma resposta só de "maior perda", a manchete. Lista server (`<ul>`): nada
 * de tabela client.
 */
export function PerdasLista({ perdas, className }: { perdas: CardDasPerdas; className?: string }) {
  return (
    <Card className={cn("min-w-0", className)} data-bloco="perdas">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-0.5" data-titulo>
          <span className="min-w-0">{perdas.titulo}</span>
          <Info texto={perdas.dica} rotulo="Sobre as perdas" className="-my-1" />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm" data-parte="perdas">
          {perdas.linhas.map((l) => (
            <li key={l.motivo} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5">
              <span className="font-semibold tabular-nums">{formatInt(l.n)}</span>
              <span>{l.rotulo}</span>
              <Badge variant="outline" className="rounded px-1.5 py-px text-[10px] font-normal tracking-wide uppercase">
                {l.quem}
              </Badge>
              <span className="text-muted-foreground">→ {textoDosAlvos(l.alvos)}</span>
              <Info texto={l.dica} rotulo={"Sobre " + l.rotulo} className="-my-1" />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
