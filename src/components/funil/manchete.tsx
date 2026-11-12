import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Info } from "@/components/ui/info";
import { DONO_LABEL } from "@/lib/dono";
import type { FunilDaTela } from "@/lib/funil";
import { cn } from "@/lib/utils";

/**
 * A MANCHETE do Funil (Fase 3, §2.1): a maior perda em PESSOAS (`ondeTrava`),
 * numa linha — `{título}{ ⚠} · {dono} · {link} ⓘ`. O título é a resposta (em
 * negrito; a frase de vazio entra sem cor). O chip é o dono da ETAPA onde a perda
 * acontece (quem corrige o processo); o link é o grupo da Fila onde as pessoas
 * estão AGORA e não leva número (a Fila é o agora; a perda é a coorte). Com a
 * leitura do robô parada e o trecho dele na tela (`semEtapasDoRobo`), o título
 * ganha "⚠": a resposta vale só fora das etapas do robô — o ⓘ diz isso.
 */
export function Manchete({ manchete, className }: { manchete: FunilDaTela["manchete"]; className?: string }) {
  const { titulo, semEtapasDoRobo, dono, link, dica, situacao } = manchete;
  return (
    <p
      data-parte="manchete"
      className={cn("flex max-w-3xl flex-wrap items-center gap-x-2 gap-y-1 text-base leading-relaxed", className)}
    >
      <strong className={cn("font-semibold", situacao === "trava" && "text-[var(--danger-text)]")}>
        {titulo}
        {semEtapasDoRobo ? " ⚠" : ""}
      </strong>
      {dono ? (
        <>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <Badge variant="outline" className="rounded px-1.5 py-px text-[11px] font-normal tracking-wide uppercase">
            {DONO_LABEL[dono]}
          </Badge>
        </>
      ) : null}
      {link ? (
        <>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <Link href={link.href} className="font-medium underline underline-offset-4 hover:text-foreground">
            {link.rotulo}
          </Link>
        </>
      ) : null}
      <Info texto={dica} rotulo="Sobre a maior perda" className="-my-1" />
    </p>
  );
}
