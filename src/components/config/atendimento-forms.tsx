"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { salvarTabelaDeParcela } from "@/app/(dashboard)/configuracoes/atendimento-actions";
import {
  FAIXAS_VALOR_ORDEM,
  GRUPO_LABEL,
  calcularClasse,
  rotuloCelula,
  type CelulaDeParcela,
  type GrupoDoBem,
  type TabelaDeParcela,
} from "@/lib/classe";
import { FAIXAS_PARCELA, FAIXAS_VALOR, type FaixaParcela } from "@/lib/qualificacao";
import { cn } from "@/lib/utils";

const OPCOES: CelulaDeParcela[] = ["minimo", "qualquer", ...(Object.keys(FAIXAS_PARCELA) as FaixaParcela[])];
const GRUPOS = Object.keys(GRUPO_LABEL) as GrupoDoBem[];

/**
 * A tabela de parcela como grade: para cada bem e faixa de valor, a parcela
 * mínima que a pessoa precisa marcar (ou "abaixo do mínimo", que dá C). A
 * prévia ao lado mostra a classe de quem marcou a menor parcela que passa — a
 * mesma função (`calcularClasse`) que o servidor roda.
 */
export function TabelaDeParcelaForm({ atual, podeEditar }: { atual: TabelaDeParcela; podeEditar: boolean }) {
  const router = useRouter();
  const [celulas, setCelulas] = useState<TabelaDeParcela["celulas"]>(() => structuredClone(atual.celulas));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const mudou = JSON.stringify(celulas) !== JSON.stringify(atual.celulas);

  function salvar() {
    if (!window.confirm("Salvar a tabela recalcula a classe de todos os leads com respostas. Continuar?")) return;
    start(async () => {
      const r = await salvarTabelaDeParcela(celulas);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1.5 pr-3 font-medium">Valor do bem</th>
              {GRUPOS.map((g) => (
                <th key={g} className="py-1.5 pr-3 font-medium">
                  {GRUPO_LABEL[g]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {FAIXAS_VALOR_ORDEM.map((f) => (
              <tr key={f}>
                <td className="py-1.5 pr-3 text-muted-foreground">{FAIXAS_VALOR[f]}</td>
                {GRUPOS.map((g) => {
                  const c = celulas[g][f];
                  // A classe de quem marcou a menor parcela que a célula aceita (imóvel, 1 a 3 anos).
                  const parcela: FaixaParcela = c === "minimo" || c === "qualquer" ? "ate_1500" : c;
                  const prev = calcularClasse(
                    { bem: g === "imovel" ? "imovel" : "carro", faixaValor: f, faixaParcela: parcela, finalidade: "morar", prazoCompra: "1_3_anos" },
                    { celulas },
                  );
                  return (
                    <td key={g} className="py-1.5 pr-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={c}
                          disabled={!podeEditar || pending}
                          onChange={(e) =>
                            setCelulas((cur) => ({ ...cur, [g]: { ...cur[g], [f]: e.target.value as CelulaDeParcela } }))
                          }
                          aria-label={`${GRUPO_LABEL[g]}, ${FAIXAS_VALOR[f]}`}
                          className="h-8 rounded-md border bg-background px-2 text-xs disabled:opacity-70"
                        >
                          {OPCOES.map((o) => (
                            <option key={o} value={o}>
                              {rotuloCelula(o)}
                            </option>
                          ))}
                        </select>
                        <span
                          className={cn("text-xs tabular-nums", prev.classe === "C" ? "text-muted-foreground" : "text-[var(--success-text)]")}
                          title={prev.motivo}
                        >
                          → {prev.classe}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        “→ A/C” é a classe de quem marca a menor parcela aceita, com prazo de 1 a 3 anos. Parcela abaixo
        da mínima dá C; bem “Outro” ou prazo “Preciso agora”/“Mais de 3 anos” dão B; “Quitar dívidas” dá X.
        {atual.atualizadaEm ? ` Última alteração: ${new Date(atual.atualizadaEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}${atual.atualizadaPor ? ` por ${atual.atualizadaPor}` : ""}.` : " Valendo a tabela provisória do briefing da live."}
      </p>
      {podeEditar ? (
        <button
          type="button"
          disabled={pending || !mudou}
          onClick={salvar}
          className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Salvando e recalculando…" : "Salvar tabela"}
        </button>
      ) : null}
      {msg ? (
        <p className={cn("text-xs", msg.ok ? "text-muted-foreground" : "text-[var(--danger-text)]")}>{msg.text}</p>
      ) : null}
    </div>
  );
}
