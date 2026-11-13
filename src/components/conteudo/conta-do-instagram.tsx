import { CHART } from "@/components/charts/colors";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { Info } from "@/components/ui/info";
import type { ContaDaTela } from "@/lib/conteudo-tela";

/**
 * O miolo do recolhido "CONTA DO INSTAGRAM" (Fase 5 de nov/26, §2.6): os 5 números da
 * conta num `<dl>` — "Alcance da conta (pago + orgânico)" e "Alcance orgânico dos posts"
 * são somas diferentes, lado a lado de propósito (B11) —, cada um com o ⓘ do dicionário.
 * Só na marca de conversão e com 2+ pontos, o gráfico do TOTAL de seguidores sob um `h3`
 * (sem `data-titulo`: está no miolo de um `<details>` fechado). A marca de awareness já
 * tem os gráficos no Início dela.
 */
export function ContaDoInstagram({ conta }: { conta: ContaDaTela }) {
  return (
    <div className="min-w-0 space-y-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-5">
        {conta.numeros.map((n) => (
          <div key={n.id} className="min-w-0">
            <dt className="flex items-center gap-0.5 text-xs text-muted-foreground">
              <span className="min-w-0 break-words">{n.rotulo}</span>
              <Info texto={n.dica} rotulo={`Sobre “${n.rotulo}”`} className="-my-1" />
            </dt>
            <dd className="tabular text-lg font-semibold">{n.valor}</dd>
          </div>
        ))}
      </dl>
      {conta.serieDeSeguidores ? (
        <div className="min-w-0 space-y-2">
          {conta.tituloDoGrafico ? (
            <h3 className="text-sm font-semibold tracking-tight">{conta.tituloDoGrafico}</h3>
          ) : null}
          <TimeSeriesChart
            data={conta.serieDeSeguidores}
            series={[{ key: "followers", label: "Seguidores", color: CHART.series[0] }]}
            yFormat="int"
          />
        </div>
      ) : null}
    </div>
  );
}
