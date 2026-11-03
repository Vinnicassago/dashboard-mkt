import { Badge } from "@/components/ui/badge";
import type { CriativosDaLive, SinalCriativo } from "@/lib/criativos-live";
import { DIAS_MIN_CRIATIVO, GASTO_MIN_CRIATIVO, MULTIPLO_PAUSAR } from "@/lib/criativos-live";
import { formatCurrency0, formatInt } from "@/lib/format";

const SINAL: Record<SinalCriativo, { label: string; variant: "muted" | "good" | "critical" | "outline" }> = {
  cedo: { label: "cedo demais", variant: "muted" },
  ok: { label: "manter", variant: "good" },
  pausar: { label: "sugestão: pausar", variant: "critical" },
  sem_base: { label: "sem base", variant: "outline" },
};

const moeda = (v: number | null) => (v == null ? "—" : formatCurrency0(v));
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

/**
 * Os criativos da live (E3-02): gasto, inscritos, qualificados, custo por
 * qualificado, % quitar dívidas e dias no ar, com o sinal como SUGESTÃO — o
 * painel não pausa nada no Meta. Conta em `lib/criativos-live.ts`.
 */
export function CriativosDaLiveCard({ r }: { r: CriativosDaLive }) {
  return (
    <div className="space-y-4">
      {r.criativos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum anúncio das campanhas da live no período. Os nomes que o painel procura estão em Configurações →
          Metas e orçamento (Campanha da live).
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm tabular-nums">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Criativo</th>
                <th className="py-2 pr-3 text-right font-medium">Gasto</th>
                <th className="py-2 pr-3 text-right font-medium">Inscritos</th>
                <th className="py-2 pr-3 text-right font-medium">Qualificados</th>
                <th className="py-2 pr-3 text-right font-medium">Custo/qualif.</th>
                <th className="py-2 pr-3 text-right font-medium">Quitar dívidas</th>
                <th className="py-2 pr-3 text-right font-medium">Dias no ar</th>
                <th className="py-2 font-medium">Sinal</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {r.criativos.map((c) => (
                <tr key={c.chave}>
                  <td className="max-w-[18rem] py-2 pr-3">
                    <span className="block truncate" title={`${c.nome} · ${c.conjuntos.join(", ")}`}>
                      {c.nome}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.conjuntos.join(", ")}
                      {c.anuncios.length > 1 ? ` · ${c.anuncios.length} anúncios` : ""}
                      {c.carro ? " · carro" : c.imovel ? " · imóvel" : ""}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right">{formatCurrency0(c.gasto)}</td>
                  <td className="py-2 pr-3 text-right">{formatInt(c.inscritos)}</td>
                  <td className="py-2 pr-3 text-right">{formatInt(c.qualificados)}</td>
                  <td className="py-2 pr-3 text-right">{moeda(c.custoPorQualificado)}</td>
                  <td className="py-2 pr-3 text-right">{pct(c.quitarDividas)}</td>
                  <td className="py-2 pr-3 text-right">{formatInt(c.diasNoAr)}</td>
                  <td className="py-2">
                    <Badge variant={SINAL[c.sinal].variant} title={c.porque}>
                      {SINAL[c.sinal].label}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Sinal é sugestão — nada é pausado no Meta. Julgável com {DIAS_MIN_CRIATIVO} dias no ar e{" "}
        {formatCurrency0(GASTO_MIN_CRIATIVO)} gastos; “pausar” acima de {MULTIPLO_PAUSAR}× a média do custo por qualificado
        dos julgáveis ({moeda(r.media)}). O de carro é julgado a partir da data dele contra os de imóvel da mesma semana (
        {moeda(r.mediaImovelDaSemana)}).
        {r.naoAtribuidos > 0 ? ` ${formatInt(r.naoAtribuidos)} inscrito(s) sem anúncio identificado ficam fora da tabela.` : ""}
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {r.comparacoes.map((cmp) => (
          <div key={cmp.titulo} className="rounded-lg border p-3">
            <p className="mb-2 text-sm font-medium">{cmp.titulo}</p>
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pb-1 font-medium" />
                  {cmp.lados.map((l) => (
                    <th key={l.rotulo} className="pb-1 text-right font-medium" title={`Trechos: ${l.tokens.join(", ")}`}>
                      {l.rotulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {(
                  [
                    ["Anúncios", (l: (typeof cmp.lados)[number]) => formatInt(l.anuncios)],
                    ["Gasto", (l: (typeof cmp.lados)[number]) => formatCurrency0(l.gasto)],
                    ["Inscritos", (l: (typeof cmp.lados)[number]) => formatInt(l.inscritos)],
                    ["Qualificados", (l: (typeof cmp.lados)[number]) => formatInt(l.qualificados)],
                    ["Custo/qualif.", (l: (typeof cmp.lados)[number]) => moeda(l.custoPorQualificado)],
                    ["Quitar dívidas", (l: (typeof cmp.lados)[number]) => pct(l.quitarDividas)],
                  ] as const
                ).map(([rotulo, valor]) => (
                  <tr key={rotulo}>
                    <td className="py-1 text-muted-foreground">{rotulo}</td>
                    {cmp.lados.map((l) => (
                      <td key={l.rotulo} className="py-1 text-right">
                        {valor(l)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
