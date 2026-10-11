import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import type { CoorteSemana } from "@/lib/funil";
import { dica } from "@/lib/dicionario";
import { formatInt, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Abaixo disto, a taxa lead → reunião de uma semana é anedota, não taxa. */
export const AMOSTRA_COORTE = 5;

const VEICULACAO: Record<CoorteSemana["veiculacao"], { rotulo: string; title: string } | null> = {
  ok: null,
  pausada: { rotulo: "campanha pausada", title: "O sync cobriu a semana e nenhuma linha de anúncio veio: a campanha estava parada" },
  sem_dados: { rotulo: "sem dados do anúncio", title: "Nenhum sync bem-sucedido cobriu esta semana: pode ter havido gasto que o painel não viu" },
};

/**
 * Coorte por semana de ENTRADA, todas as semanas — a de 0 lead aparece com 0 e
 * o motivo (B21). Coortes em maturação ficam sombreadas: não compare a conversão
 * delas com as semanas mais antigas. Cronológica, sem ordenação.
 */
export function CoortesTable({ coortes }: { coortes: CoorteSemana[] }) {
  return (
    <Table>
      <THead>
        <TR className="hover:bg-transparent">
          <TH>Semana</TH>
          <TH className="text-right" title={dica("leads")}>Leads</TH>
          <TH className="text-right" title={dica("primeiro_contato_no_prazo")}>1º contato no prazo</TH>
          <TH className="text-right" title={dica("agendaram")}>Agendadas</TH>
          <TH className="text-right" title={dica("comparecimento")}>Realizadas</TH>
          <TH className="text-right">Vendas</TH>
          <TH className="text-right" title={dica("taxa_lead_agendada")}>Lead → agendada</TH>
        </TR>
      </THead>
      <TBody>
        {coortes.map((c) => {
          const v = VEICULACAO[c.veiculacao];
          const pc = c.primeiroContatoNoPrazo;
          return (
            <TR key={c.semana} className={cn(c.immature && "bg-foreground/[0.04] text-muted-foreground")}>
              <TD className="font-medium">
                {c.label}
                {c.immature ? (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground" title="Coorte recente: ainda maturando">
                    (maturando)
                  </span>
                ) : null}
                {v ? (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground" title={v.title}>
                    ({v.rotulo})
                  </span>
                ) : null}
              </TD>
              <TD className="text-right tabular">{formatInt(c.leads)}</TD>
              <TD className="text-right tabular" title={pc.n > 0 ? `n = ${formatInt(pc.n)} leads julgados` : "nenhum lead com prazo fechado"}>
                {pc.n > 0 ? formatPercent(pc.valor) : "—"}
              </TD>
              <TD className="text-right tabular">{formatInt(c.agendadas)}</TD>
              <TD className="text-right tabular">{formatInt(c.realizadas)}</TD>
              <TD className="text-right tabular">{formatInt(c.vendas)}</TD>
              <TD
                className="text-right tabular"
                title={c.leads > 0 && c.leads < AMOSTRA_COORTE ? `Só ${c.leads} lead(s): ainda não é taxa` : undefined}
              >
                {c.leadAgendada != null && c.leads >= AMOSTRA_COORTE ? formatPercent(c.leadAgendada) : "—"}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
