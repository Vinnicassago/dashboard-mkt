import Link from "next/link";
import { ListChecks } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PendenciaLink, Pendencias } from "@/lib/configuracoes";

/** Um grupo da lista "O que falta aqui": o que é, por que importa, e o link ao campo. */
function Grupo({ titulo, itens }: { titulo: string; itens: PendenciaLink[] }) {
  if (itens.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {titulo} ({itens.length})
      </p>
      <ul className="space-y-3">
        {itens.map((t) => (
          <li key={t.id} className="space-y-0.5">
            <p className="text-sm font-medium">{t.titulo}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">{t.detalhe}</p>
            {t.link ? (
              <Link
                href={t.link.href}
                className="inline-block pt-0.5 text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                {t.link.label} →
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "O que falta aqui" — a mesma avaliação de confiança da home, filtrada pelo
 * que se conserta em Configurações. O link de cada item já aponta para a vista
 * da âncora, com o período (`pendenciasDeConfiguracoes`).
 */
export function PendenciasCard({ pendencias }: { pendencias: Pendencias }) {
  const total = pendencias.preencher.length + pendencias.corrigir.length;
  if (total === 0) {
    return (
      <p id="pendencias" className="scroll-mt-24 text-sm text-muted-foreground">
        Nada pendente: nenhum número do painel está escondido por falta de configuração.
      </p>
    );
  }
  return (
    <Card id="pendencias" className="scroll-mt-24 border-[var(--warning)]/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="size-4 text-primary" />
          O que falta aqui
        </CardTitle>
        <CardDescription>
          Cada item desliga um número ou uma regra em outra tela. O link leva direto ao campo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Grupo titulo="Preencher" itens={pendencias.preencher} />
        <Grupo titulo="Corrigir" itens={pendencias.corrigir} />
      </CardContent>
    </Card>
  );
}
