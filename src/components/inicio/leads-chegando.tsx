import Link from "next/link";
import type { DiaDaBarra } from "@/components/charts/barras-diarias";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info } from "@/components/ui/info";
import type { LeadDaHome, LeadsChegando } from "@/lib/inicio";
import { cn } from "@/lib/utils";
import { BarrasDoInicio } from "./barras-do-inicio";

/**
 * O que as barras recebem (client): um ponto por dia do período com a contagem de
 * leads do painel e o "pausado" (anúncio de conversão parado, dia coberto por
 * sync). "Sem dados" NÃO é marcado aqui (ADR-06: o que não se sabe não vira pausa).
 */
export function barrasDosLeads(b: Pick<LeadsChegando, "dias">): DiaDaBarra[] {
  return b.dias.map((d) => ({ date: d.date, valor: d.leads, semDado: false, semVeiculacao: d.pausado }));
}

function Atendimento({ a }: { a: LeadDaHome["atendimento"] }) {
  if (!a) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      {a.href ? (
        <Link href={a.href} className="underline-offset-4 hover:underline">
          {a.texto}
        </Link>
      ) : (
        a.texto
      )}
      {a.atrasado ? <span className="text-[var(--danger-text)]"> · fora do prazo</span> : null}
    </>
  );
}

/**
 * LEADS CHEGANDO (F10–F12, C8): o título com o último lead, as barras por dia de
 * Brasília (Σ = o cartão de Leads; cinza = pausado) e os 8 mais recentes do
 * período numa tabela — UMA linha por pessoa: nome (a ficha), há quanto tempo,
 * origem curta e o atendimento de Leads. A lista já chega sem telefone, e-mail
 * nem motivo de teste (`LeadDaHome`).
 */
export function LeadsChegandoBloco({ bloco, className }: { bloco: LeadsChegando; className?: string }) {
  return (
    <Card className={cn("min-w-0", className)} data-bloco="leads-chegando">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="flex items-center gap-0.5" data-titulo>
          <span className="min-w-0">{bloco.titulo}</span>
          <Info texto={bloco.dica} rotulo="Sobre “Leads chegando”" className="-my-1" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        <BarrasDoInicio dados={barrasDosLeads(bloco)} faixas={bloco.faixasPausa} />
        {bloco.ultimos.length > 0 ? (
          <table className="w-full table-fixed text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="w-[38%] py-1 pr-2 font-medium sm:w-[30%]">
                  Nome
                </th>
                <th scope="col" className="w-[5.5rem] py-1 pr-2 font-medium">
                  Entrou
                </th>
                <th scope="col" className="hidden py-1 pr-2 font-medium sm:table-cell">
                  Origem
                </th>
                <th scope="col" className="py-1 font-medium">
                  Atendimento
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {bloco.ultimos.map((u) => (
                <tr key={u.id}>
                  <td className="truncate py-1 pr-2" title={u.nome}>
                    <Link href={u.href} className="font-medium underline-offset-4 hover:underline">
                      {u.nome}
                    </Link>
                  </td>
                  <td className="truncate py-1 pr-2 tabular-nums text-muted-foreground">{u.ha}</td>
                  <td className="hidden truncate py-1 pr-2 text-muted-foreground sm:table-cell" title={u.origem}>
                    {u.origem}
                  </td>
                  <td
                    className="truncate py-1"
                    title={u.atendimento ? `${u.atendimento.texto}${u.atendimento.atrasado ? " · fora do prazo" : ""}` : undefined}
                  >
                    <Atendimento a={u.atendimento} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </CardContent>
    </Card>
  );
}
