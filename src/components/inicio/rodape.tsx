import Link from "next/link";
import type { RodapeDoInicio } from "@/lib/inicio";
import { cn } from "@/lib/utils";

/** RODAPÉ (F16): três links numa linha (quebra no celular) — Funil, Mídia e o último post. */
export function RodapeDoInicioBloco({ rodape, className }: { rodape: RodapeDoInicio; className?: string }) {
  return (
    <nav aria-label="Mais detalhes" className={cn("text-xs text-muted-foreground", className)} data-bloco="rodape">
      <ul className="flex flex-wrap gap-x-5 gap-y-1">
        {rodape.links.map((l) => (
          <li key={l.id}>
            <Link href={l.href} className="hover:text-foreground">
              {l.rotulo} →
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
