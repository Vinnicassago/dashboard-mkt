import { Badge } from "@/components/ui/badge";
import { CLASSE_HINT, type Classe } from "@/lib/qualificacao";

/** Cor por classe — sempre com a letra escrita (cor nunca é a única pista). */
const VARIANTE: Record<Classe, "good" | "default" | "muted" | "warning"> = {
  A: "good",
  B: "default",
  C: "muted",
  X: "warning",
};

export function ClasseBadge({ classe, origem }: { classe?: Classe; origem?: "n8n" }) {
  if (!classe) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge variant={VARIANTE[classe]} title={CLASSE_HINT[classe]}>
      Classe {classe}
      {origem === "n8n" ? " (n8n)" : ""}
    </Badge>
  );
}
