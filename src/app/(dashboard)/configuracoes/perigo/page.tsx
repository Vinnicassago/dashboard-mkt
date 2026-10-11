import { ShieldAlert } from "lucide-react";
import { CleanResyncAdsButton, ResetButton } from "@/components/config/perigo-forms";
import { SemPermissao } from "@/components/config/sem-permissao";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listAuditEntries } from "@/lib/data/store";
import { formatDateTime } from "@/lib/format";
import { contextoDeConfiguracoes } from "../_carregar";

export const dynamic = "force-dynamic";

/**
 * Configurações → Zona de perigo (relatório §7.7 item 7): restaurar o exemplo e
 * refazer o histórico de anúncios. Só administrador; a palavra de confirmação
 * (`CONFIRMACAO_PERIGO`) e o papel são conferidos no servidor, e cada execução
 * fica no registro de auditoria abaixo. Nenhum lead é apagado — excluído de
 * forma reversível, com o porquê.
 */
export default async function PerigoPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await contextoDeConfiguracoes(searchParams);

  if (!ctx.papeis.perigo) {
    return (
      <div className="max-w-3xl space-y-6">
        <SemPermissao quem="Administrador" oque="executa as ações da zona de perigo" />
      </div>
    );
  }

  const auditoria = await listAuditEntries(10);

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">
        Ações que mexem em muitos dados de uma vez. Cada uma pede confirmação e fica registrada com quem
        executou.
      </p>

      <Card id="perigo" className="scroll-mt-24 border-[var(--danger-text)]/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-[var(--danger-text)]" />
            Zona de perigo
          </CardTitle>
          <CardDescription>
            Banco ativo: <strong>{ctx.banco.nome}</strong>
            {ctx.banco.conectado ? "." : " (defina DATABASE_URL para persistir os dados de verdade)."} Leads
            nunca são apagados: restaurar o exemplo os exclui de forma reversível, e eles voltam em Leads.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ResetButton />
          <CleanResyncAdsButton />
          <div className="border-t pt-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Últimas ações</p>
            {auditoria.length ? (
              <ul className="space-y-1 text-xs">
                {auditoria.map((a) => (
                  <li key={a.id}>
                    <span className="text-muted-foreground">{formatDateTime(a.at)}</span> ·{" "}
                    <strong>{a.actor}</strong> · {a.action}
                    {a.detail ? <span className="text-muted-foreground"> — {a.detail}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Nenhuma ainda.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
