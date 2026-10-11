import { Eye, Users } from "lucide-react";
import { SemPermissao } from "@/components/config/sem-permissao";
import { UsersManager } from "@/components/config/users-manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isAuthEnabled } from "@/lib/auth/config";
import { getCurrentUser } from "@/lib/auth/current-user";
import { visibilidadePorPapel } from "@/lib/configuracoes";
import { listUsers } from "@/lib/data/store";
import { contextoDeConfiguracoes } from "../_carregar";

export const dynamic = "force-dynamic";

const SIM = "sim";
const NAO = "—";

/**
 * Configurações → Usuários e papéis (relatório §7.7 item 4): quem acessa, o
 * papel de cada um e — para todo mundo — quem vê telefone e e-mail e quem
 * exporta. A tabela sai de `auth/roles.ts`, a mesma regra que o servidor aplica.
 */
export default async function UsuariosPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await contextoDeConfiguracoes(searchParams);
  const papeis = visibilidadePorPapel();
  const veem = papeis.filter((p) => p.veContato).map((p) => p.rotulo);
  const mascarados = papeis.filter((p) => !p.veContato).map((p) => p.rotulo);
  const exportam = papeis.filter((p) => p.exportaLeads).map((p) => p.rotulo);
  const lista = (nomes: string[]) => nomes.join(" e ");

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">
        {lista(veem)} veem telefone e e-mail e podem exportar a lista de leads; {lista(mascarados)} vê contato
        mascarado (LGPD) e não exporta.
      </p>

      {ctx.papeis.admin ? (
        <Card id="usuarios" className="scroll-mt-24">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4 text-primary" />
              Usuários do painel
            </CardTitle>
            <CardDescription>
              Quem pode acessar e o papel de cada um. Senhas guardadas com hash (scrypt). Mudar o papel vale
              na próxima requisição.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UsersManager
              users={await listUsers()}
              currentUser={(await getCurrentUser())?.username ?? null}
              authEnabled={isAuthEnabled()}
            />
          </CardContent>
        </Card>
      ) : (
        <SemPermissao quem="Administrador" oque="cria, remove e troca o papel dos usuários" />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="size-4 text-primary" />
            Quem vê e faz o quê
          </CardTitle>
          <CardDescription>
            A regra é conferida no servidor em toda mutação — a tela só reflete. Exportação de leads fica
            registrada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Papel</th>
                  <th className="pb-2 font-medium">Telefone e e-mail</th>
                  <th className="pb-2 font-medium">Exporta leads</th>
                  <th className="pb-2 font-medium">Altera leads</th>
                  <th className="pb-2 font-medium">Importa, sincroniza, metas</th>
                  <th className="pb-2 font-medium">Usuários e zona de perigo</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {papeis.map((p) => (
                  <tr key={p.papel}>
                    <td className="py-1.5 font-medium">{p.rotulo}</td>
                    <td className="py-1.5">{p.veContato ? "vê inteiros" : "mascarados"}</td>
                    <td className="py-1.5">{p.exportaLeads ? SIM : NAO}</td>
                    <td className="py-1.5">{p.alteraLeads ? SIM : NAO}</td>
                    <td className="py-1.5">{p.operaDados ? SIM : NAO}</td>
                    <td className="py-1.5">{p.administra ? SIM : NAO}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Exportam a lista: {lista(exportam)}.</p>
        </CardContent>
      </Card>
    </div>
  );
}
