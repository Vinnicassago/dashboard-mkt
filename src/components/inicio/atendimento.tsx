import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info } from "@/components/ui/info";
import type { AtendimentoDoInicio, DegrauCurto } from "@/lib/inicio";
import { textoDaTaxa } from "@/lib/funil-processo";
import { cn } from "@/lib/utils";

/** Sobre quem a taxa do degrau é — no `title` (o ⓘ do bloco explica o funil). */
const SOBRE: Record<NonNullable<DegrauCurto["base"]>, string> = {
  anterior: "do degrau anterior",
  leads: "dos leads do período",
};

/** O ⓘ do título: o que é o funil (a coorte, com o recorte) e o que são as frases (agora). */
export function dicaDoAtendimento(a: Pick<AtendimentoDoInicio, "dica" | "recorte">): string {
  return `${a.dica} Recorte do funil: ${a.recorte}.`;
}

/**
 * ATENDIMENTO (C1, C2): o título com quem espera o comercial (o número da Fila);
 * a leitura do robô parada como 1ª linha; o funil curto da COORTE do período
 * (degraus do robô recuados; "Agendaram" é ramo paralelo, sobre os leads); e até
 * três frases de AGORA, cada uma com o número da página que o link abre.
 */
export function AtendimentoBloco({ bloco, className }: { bloco: AtendimentoDoInicio; className?: string }) {
  return (
    <Card className={cn("min-w-0", className)} data-bloco="atendimento">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-0.5" data-titulo>
          <span className="min-w-0">{bloco.titulo}</span>
          <Info texto={dicaDoAtendimento(bloco)} rotulo="Sobre “Atendimento”" className="-my-1" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        {bloco.leituraParada ? (
          <p className="text-xs font-medium text-[var(--status-perto-text)]" data-parte="frases">
            {bloco.leituraParada.texto}
          </p>
        ) : null}
        <ol className="space-y-0.5 text-sm" aria-label={`Funil — ${bloco.recorte}`} data-parte="funil">
          {bloco.funil.map((d) => (
            <li
              key={d.id}
              className={cn(
                "flex items-baseline justify-between gap-2 py-0.5",
                d.doRobo && d.id !== "com-robo" && "pl-3",
                d.base === "leads" && "mt-1 border-t border-dashed pt-1.5",
              )}
            >
              <span className="min-w-0 truncate text-muted-foreground">{d.rotulo}</span>
              <span className="shrink-0 tabular-nums">
                <span className="font-semibold">{d.texto}</span>
                {d.taxa !== null && d.base ? (
                  <span className="text-muted-foreground" title={SOBRE[d.base]}>
                    {" "}
                    · {textoDaTaxa(d.taxa)}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
        <ul className="space-y-1 border-t pt-3 text-sm" data-parte="frases">
          {bloco.frases.map((f) => (
            <li key={f.id}>
              <Link href={f.href} className="font-medium underline-offset-4 hover:underline">
                {f.texto}
              </Link>
            </li>
          ))}
          {bloco.vazio ? <li className="text-muted-foreground">{bloco.vazio}</li> : null}
        </ul>
      </CardContent>
    </Card>
  );
}
