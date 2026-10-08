import type { AvaliacaoMeta, StatusMeta } from "@/lib/metas";
import { cn } from "@/lib/utils";

/**
 * Status contra a meta — SEMPRE cor + texto (CLAUDE.md: cor nunca sozinha). As
 * cores são os tokens --status-* (globals.css), separados do âmbar da marca e do
 * --warning; o validador da paleta é src/lib/__tests__/paleta.test.ts.
 */

const COR: Record<StatusMeta, { ponto: string; texto: string }> = {
  verde: { ponto: "var(--status-ok)", texto: "text-[var(--status-ok-text)]" },
  ambar: { ponto: "var(--status-perto)", texto: "text-[var(--status-perto-text)]" },
  vermelho: { ponto: "var(--status-fora)", texto: "text-[var(--status-fora-text)]" },
};

export interface MetaExibida {
  /** "meta 66" / "alvo R$ 40" — já formatado. Ausente = só o status. */
  alvoTexto?: string;
  avaliacao?: AvaliacaoMeta;
  provisoria?: boolean;
}

export function StatusMetaBadge({ meta, className }: { meta: MetaExibida; className?: string }) {
  const c = meta.avaliacao ? COR[meta.avaliacao.status] : null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1.5 text-xs", className)}>
      {meta.alvoTexto ? (
        <span className="text-muted-foreground">
          {meta.alvoTexto}
          {meta.provisoria ? (
            <span title="Sem amostra para sustentar a taxa: é um ponto de partida, recalibre depois de 8 semanas">
              {" "}
              (provisória)
            </span>
          ) : null}
        </span>
      ) : null}
      {meta.avaliacao && c ? (
        <span className={cn("inline-flex items-center gap-1 font-medium", c.texto)}>
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: c.ponto }} />
          {meta.avaliacao.rotulo}
        </span>
      ) : null}
    </span>
  );
}
