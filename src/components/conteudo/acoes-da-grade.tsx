import Link from "next/link";
import { Info } from "@/components/ui/info";
import type { AcaoDaGrade } from "@/lib/conteudo-tela";

/**
 * AS AÇÕES da grade (Fase 5 de nov/26, §2.5): até 2, só na marca de conversão, uma
 * linha cada (≤ 12 palavras) que abre com o verbo e leva o número — "Publique hoje: 9
 * dias sem post da grade → Produção". O `detail` da regra vai para o ⓘ dela. Sem
 * destino (marca sem playbook), a linha é texto: nunca um link para a própria página.
 * Sem ação, o bloco não aparece.
 */
export function AcoesDaGrade({ acoes }: { acoes: AcaoDaGrade[] }) {
  if (acoes.length === 0) return null;
  return (
    <ul id="acoes" data-parte="acoes" className="scroll-mt-24 space-y-1.5 text-sm">
      {acoes.map((a) => (
        <li key={a.id} className="leading-relaxed">
          {a.destino ? (
            <Link href={a.destino.href} className="font-medium text-primary underline-offset-4 hover:underline">
              {`${a.linha} → ${a.destino.rotulo}`}
            </Link>
          ) : (
            <span className="font-medium">{a.linha}</span>
          )}{" "}
          <Info texto={a.dica} rotulo={a.rotulo} className="-my-1" />
        </li>
      ))}
    </ul>
  );
}
