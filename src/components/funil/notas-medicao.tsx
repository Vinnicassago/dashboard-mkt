import type { NotaMedicao } from "@/lib/funil";

/**
 * Notas de medição, recolhidas: cliques × visitas, Pixel × painel, eventos ×
 * pessoas. É contexto, não decisão — por isso não ocupa a tela aberta.
 */
export function NotasMedicao({ notas }: { notas: NotaMedicao[] }) {
  if (notas.length === 0) return null;
  return (
    <details className="rounded-xl border bg-card px-5 py-4 text-sm">
      <summary className="cursor-pointer select-none font-medium">
        Notas de medição
        <span className="ml-2 font-normal text-muted-foreground">
          {notas.length} {notas.length === 1 ? "nota" : "notas"} — o que parece perda e é diferença de contagem
        </span>
      </summary>
      <ul className="mt-3 space-y-3">
        {notas.map((n) => (
          <li key={n.titulo} className="space-y-0.5">
            <p className="font-medium text-foreground">{n.titulo}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{n.detalhe}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
