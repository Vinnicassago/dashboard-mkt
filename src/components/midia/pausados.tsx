import { Recolhido } from "@/components/funil/recolhido";
import { ConjuntosTable } from "@/components/midia/conjuntos-table";
import { CreativesTable } from "@/components/tables/creatives-table";
import type { PausadosDaTela } from "@/lib/midia-tela";

/**
 * "PAUSADOS NO PERÍODO" (Fase 4, §2.5, K39): recolhido, com as MESMAS `DataTable` de
 * Detalhes (todas as colunas), só com as linhas de CONVERSÃO fora do ar ou sem
 * leitura — uma linha pausada mora aqui, não nos dois lugares. A coluna Veiculação
 * diz "Último gasto em dd/mm" ou "Sem leitura depois de dd/mm"; a Sinal sai "—" (fora
 * do ar não tem sinal) e nenhuma cor de status aparece. Cada tabela só com linha. Com
 * `piso`, "≥" no gasto, no CPL e no custo por agendada (o MESMO valor de Detalhes).
 */
export function Pausados({
  pausados,
  colunasDoRobo,
  piso,
  regras,
}: {
  pausados: PausadosDaTela;
  colunasDoRobo: boolean;
  piso: boolean;
  /** As réguas dos cabeçalhos "Sinal" e "Saúde" — o MESMO objeto de Detalhes. */
  regras: { sinal: string; fadiga: string };
}) {
  return (
    <Recolhido id="pausados" resumo="Pausados no período" dica={pausados.dica} rotulo="Sobre os pausados">
      <div className="space-y-6">
        {pausados.conjuntos.length > 0 ? (
          <div className="min-w-0 space-y-2">
            <h3 className="text-sm font-semibold tracking-tight">Conjuntos</h3>
            <ConjuntosTable linhas={pausados.conjuntos} bucket="conversao" colunasDoRobo={colunasDoRobo} piso={piso} />
          </div>
        ) : null}
        {pausados.criativos.length > 0 ? (
          <div className="min-w-0 space-y-2">
            <h3 className="text-sm font-semibold tracking-tight">Criativos</h3>
            <CreativesTable linhas={pausados.criativos} bucket="conversao" colunasDoRobo={colunasDoRobo} piso={piso} regras={regras} />
          </div>
        ) : null}
      </div>
    </Recolhido>
  );
}
