import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { AMOSTRA_MINIMA } from "@/lib/cascata";
import type { CoorteSemana } from "@/lib/funil";
import { textoDaTaxa } from "@/lib/funil-processo";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A marca da semana sem linha de anúncio (ADR-06); a explicação está no ⓘ do recolhido. */
const VEICULACAO: Record<CoorteSemana["veiculacao"], string | null> = {
  ok: null,
  pausada: "campanha pausada",
  sem_dados: "sem dados do anúncio",
};

/**
 * Coorte por semana de ENTRADA, todas as semanas — a de 0 lead aparece com 0 e
 * o motivo (B21). Coortes em maturação ficam sombreadas: não compare a conversão
 * delas com as semanas mais antigas. Cronológica, sem ordenação. "Agendaram" é
 * coorte (dos leads daquela semana); "Lead → agendada" só com `AMOSTRA_MINIMA`
 * leads, a MESMA régua do funil, e com o MESMO texto do % (`textoDaTaxa`).
 * Server component: as explicações das colunas e
 * das marcas vão para o ⓘ do recolhido (`coortes.dica`), nunca para `title=`.
 */
export function CoortesTable({ coortes }: { coortes: CoorteSemana[] }) {
  if (coortes.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma semana com lead.</p>;
  return (
    <Table className="text-xs sm:text-sm">
      <THead>
        <TR className="hover:bg-transparent">
          <TH className="px-2 sm:px-3">Semana</TH>
          <TH className="px-2 text-right sm:px-3">Leads</TH>
          <TH className="px-2 text-right sm:px-3">Agendaram</TH>
          <TH className="px-2 text-right sm:px-3">Realizadas</TH>
          <TH className="px-2 text-right sm:px-3">Vendas</TH>
          <TH className="px-2 text-right sm:px-3">Lead → agendada</TH>
        </TR>
      </THead>
      <TBody>
        {coortes.map((c) => {
          const v = VEICULACAO[c.veiculacao];
          return (
            <TR key={c.semana} className={cn(c.immature && "bg-foreground/[0.04] text-muted-foreground")}>
              <TD className="px-2 font-medium sm:px-3">
                {c.label}
                {c.immature ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(maturando)</span> : null}
                {v ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">({v})</span> : null}
              </TD>
              <TD className="px-2 text-right tabular sm:px-3">{formatInt(c.leads)}</TD>
              <TD className="px-2 text-right tabular sm:px-3">{formatInt(c.agendadas)}</TD>
              <TD className="px-2 text-right tabular sm:px-3">{formatInt(c.realizadas)}</TD>
              <TD className="px-2 text-right tabular sm:px-3">{formatInt(c.vendas)}</TD>
              <TD className="px-2 text-right tabular sm:px-3">
                {c.leadAgendada != null && c.leads >= AMOSTRA_MINIMA ? textoDaTaxa(c.leadAgendada) : "—"}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
