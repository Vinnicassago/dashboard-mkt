import { Badge } from "@/components/ui/badge";
import type { EstadoExibido, EstadoIntegracao } from "@/lib/configuracoes";

/**
 * Uma linha da lista de integrações: nome, selo com TEXTO (nunca só cor) e a
 * frase humana. Os estados vêm de `lib/configuracoes.ts`.
 */

const VARIANTE: Record<EstadoIntegracao, "good" | "muted" | "critical" | "warning"> = {
  ativo: "good",
  nunca: "warning",
  falhando: "critical",
  desativado: "muted",
  "nao-configurado": "muted",
};

export function StatusRow({
  label,
  estado,
  children,
}: {
  label: string;
  estado: EstadoExibido;
  /** Vai abaixo do selo — a chave liga/desliga do robô, por exemplo. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{estado.detalhe}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Badge variant={VARIANTE[estado.estado]}>{estado.rotulo}</Badge>
        {children}
      </div>
    </div>
  );
}

/** Estado simples (configurado ou não) para linhas que não sincronizam nada. */
export function estadoSimples(ok: boolean, detalheOk: string, detalheFalta: string, rotuloOk = "Ativo"): EstadoExibido {
  return ok
    ? { estado: "ativo", rotulo: rotuloOk, detalhe: detalheOk }
    : { estado: "nao-configurado", rotulo: "Não configurado", detalhe: detalheFalta };
}
