import { CHART } from "@/components/charts/colors";
import { Info } from "@/components/ui/info";
import type { LinhaDaVerba, VerbaDaTela } from "@/lib/midia-tela";
import { cn } from "@/lib/utils";

/** A largura da barra em % (0–100, uma casa): a fração exata, presa entre 0 e 1. */
const largura = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 1000) / 10}%`;

/** O % escrito e, embaixo, a barra (só desenho: `aria-hidden`, cor da série). */
function Porcentagem({ texto, barra, cor, semBarra }: { texto: string; barra: number; cor: string; semBarra: boolean }) {
  return (
    <>
      <span className="block break-words tabular-nums">{texto}</span>
      {semBarra ? null : (
        <span aria-hidden="true" className="mt-1 block h-1.5 overflow-hidden rounded-full bg-foreground/[0.06]">
          <span className="block h-full rounded-full" style={{ width: largura(barra), backgroundColor: cor }} />
        </span>
      )}
    </>
  );
}

function Linha({ l }: { l: LinhaDaVerba }) {
  const apagada = l.tipo === "fora-das-linhas";
  return (
    <tr data-linha={l.tipo} className={cn("border-b last:border-0 align-top", apagada && "text-muted-foreground")}>
      <td className="py-2 pr-3 break-words">{l.rotulo}</td>
      <td className="py-2 pr-3">
        <Porcentagem texto={l.pctVerba} barra={l.barraVerba} cor={CHART.primary} semBarra={apagada} />
      </td>
      <td className="py-2">
        <Porcentagem texto={l.pctLeads} barra={l.barraLeads} cor={CHART.series[1]} semBarra={apagada} />
      </td>
    </tr>
  );
}

/**
 * "PARA ONDE VAI A VERBA" (Fase 4, §2.3): o título dá a resposta (o conjunto no ar
 * cujo % dos leads mais se afasta do % da verba, ou "Leads acompanham a verba"; " ⚠"
 * no fim quando mais de 25% dos leads de conversão estão fora das linhas). A tabela
 * (server, sem client) tem uma linha por conjunto de conversão no ar, a live numa
 * linha só, "Fora do ar" e "Fora das linhas" (apagada, fora dos 100%). Tudo vem
 * pronto de `paraOndeVaiAVerba`; aqui só se desenha.
 */
export function Verba({ verba }: { verba: VerbaDaTela }) {
  return (
    <section id="verba" className="min-w-0 scroll-mt-24 space-y-3 rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
      <div className="flex items-center gap-0.5">
        <h2 data-titulo className="min-w-0 text-base font-semibold tracking-tight">
          {verba.titulo}
        </h2>
        <Info texto={verba.dica} rotulo="Sobre para onde vai a verba" className="-my-1" />
      </div>
      {verba.linhas.length > 0 ? (
        <table data-parte="verba" className="w-full table-fixed text-sm">
          <colgroup>
            <col className="w-[46%]" />
            <col className="w-[27%]" />
            <col className="w-[27%]" />
          </colgroup>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Conjunto</th>
              <th className="py-2 pr-3 font-medium">% da verba</th>
              <th className="py-2 font-medium">% dos leads</th>
            </tr>
          </thead>
          <tbody>
            {verba.linhas.map((l) => (
              <Linha key={l.chave} l={l} />
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
