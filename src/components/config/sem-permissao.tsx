import { Lock } from "lucide-react";

/**
 * O que uma vista mostra a quem não tem o papel para mexer nela. A regra é
 * conferida no servidor (`can()`); aqui só se diz quem pode, para a pessoa saber
 * a quem pedir — não um "sem permissão" seco.
 */
export function SemPermissao({ quem, oque }: { quem: string; oque: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
      <Lock className="mt-0.5 size-4 shrink-0" />
      <p>
        Só <strong className="text-foreground">{quem}</strong> {oque}. Se precisar, peça a um deles.
      </p>
    </div>
  );
}
