import type { TomDoSinal } from "@/lib/sinal-do-criativo";
import { cn } from "@/lib/utils";

/**
 * O SELO do sinal do criativo (Fase 4, §2.4): o ponto (desenho, `aria-hidden`) e o
 * rótulo, sempre com o texto, numa linha só. Sem hook: serve ao cartão (server) e à
 * célula "Sinal" da tabela de Detalhes (client). Cor só com os tokens `--status-*`.
 */
const TOM: Record<TomDoSinal, { ponto: string; texto: string }> = {
  fora: { ponto: "bg-[var(--status-fora)]", texto: "text-[var(--status-fora-text)]" },
  perto: { ponto: "bg-[var(--status-perto)]", texto: "text-[var(--status-perto-text)]" },
  ok: { ponto: "bg-[var(--status-ok)]", texto: "text-[var(--status-ok-text)]" },
  // O Candidato (K42): o anel do Escalar, sem o preenchimento — sinal de topo de funil não tem a cor de 3 reuniões.
  "ok-vazado": { ponto: "border-[1.5px] border-[var(--status-ok)] bg-transparent", texto: "text-foreground" },
  neutro: { ponto: "bg-[var(--muted)]", texto: "text-muted-foreground" },
};

/** Para ordenar a coluna "Sinal" da tabela: do que pede ação ao neutro. */
export const ORDEM_DO_TOM: Record<TomDoSinal, number> = { fora: 0, perto: 1, ok: 2, "ok-vazado": 3, neutro: 4 };

export function SeloDoSinal({ rotulo, tom, className }: { rotulo: string; tom: TomDoSinal; className?: string }) {
  const t = TOM[tom] ?? TOM.neutro;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap", t.texto, className)}>
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", t.ponto)} />
      {rotulo}
    </span>
  );
}
