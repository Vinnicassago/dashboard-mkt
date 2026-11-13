import type { ReactNode } from "react";
import { BarrasDiarias } from "@/components/charts/barras-diarias";
import { Recolhido } from "@/components/funil/recolhido";
import { ConjuntosTable } from "@/components/midia/conjuntos-table";
import { TendenciaSemanal } from "@/components/midia/tendencia-semanal";
import { CreativesTable } from "@/components/tables/creatives-table";
import { Info } from "@/components/ui/info";
import { formatCurrency0, formatInt, formatIntComSinal } from "@/lib/format";
import { moedaOuTraco, prefixoDoPiso, type DetalhesDaTela } from "@/lib/midia-tela";
import { cn } from "@/lib/utils";

/** Um sub-bloco de Detalhes: `h3` (sem `data-titulo`: está no miolo de um `<details>` fechado) + ⓘ + o conteúdo. */
function SubBloco({
  titulo,
  dica,
  rotulo,
  id,
  children,
}: {
  titulo: string;
  dica: string;
  rotulo: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <div id={id} className={cn("min-w-0 space-y-2", id && "scroll-mt-24")}>
      <div className="flex items-center gap-0.5">
        <h3 className="min-w-0 text-sm font-semibold tracking-tight">{titulo}</h3>
        <Info texto={dica} rotulo={rotulo} className="-my-1" />
      </div>
      {children}
    </div>
  );
}

/**
 * "Fora do ar: R$ X em k conjuntos → Pausados no período" — embaixo da tabela das linhas
 * no ar (K39). É o que está em Pausados: com conjuntos da live parados, diz quantos ("…,
 * 1 da live"), porque o "Fora do ar" da verba não tem a live (lá ela é uma linha só).
 */
function ForaDoAr({ fora, singular, plural }: { fora: { gasto: string; n: number; daLive?: number }; singular: string; plural: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      Fora do ar: {fora.gasto} em {formatInt(fora.n)} {fora.n === 1 ? singular : plural}
      {fora.daLive ? `, ${formatInt(fora.daLive)} da live` : ""} →{" "}
      <a href="#pausados" className="text-primary underline-offset-4 hover:underline">
        Pausados no período
      </a>
    </p>
  );
}

/** Um número da descoberta: rótulo (com o ⓘ, quando há) e valor. Sem `title=`: a explicação vai para o ⓘ. */
function Stat({ rotulo, valor, dica, rotuloDaDica, destaque }: { rotulo: string; valor: string; dica?: string; rotuloDaDica?: string; destaque?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-0.5 text-xs text-muted-foreground">
        <span className="min-w-0">{rotulo}</span>
        {dica && rotuloDaDica ? <Info texto={dica} rotulo={rotuloDaDica} className="-my-1" /> : null}
      </dt>
      <dd className={cn("tabular text-lg font-semibold", destaque && "text-primary")}>{valor}</dd>
    </div>
  );
}

/**
 * "DETALHES" (Fase 4, §2.5): recolhido, com as linhas de conversão NO AR — as que
 * pararam estão em "Pausados no período" — e a descoberta inteira, nesta ordem:
 * tendência semanal; conjuntos de conversão (`#conjuntos`, a âncora das ações M2 e
 * M4); criativos de conversão (`#criativos-tabela`, o destino do "Ver todos"); a
 * descoberta (tabelas e os 6 números); o investimento por dia. Sem verba de conversão
 * (`comConversao` falso: a awareness, um período só de descoberta), as tabelas de
 * conversão não aparecem e `#conjuntos` é a descoberta. Cada sub-bloco tem o seu ⓘ; o
 * `RolarParaAncora abrirDetalhes` da página abre este `<details>` quando a âncora cai
 * aqui dentro. Com `piso`, "≥" no gasto das tabelas e no investimento da descoberta.
 */
export function Detalhes({ detalhes, colunasDoRobo, piso }: { detalhes: DetalhesDaTela; colunasDoRobo: boolean; piso: boolean }) {
  const d = detalhes;
  const regras = d.criativos.regras;
  return (
    <Recolhido id="detalhes" resumo="Detalhes" dica={d.dica} rotulo="Sobre os detalhes">
      <div className="space-y-8">
        <SubBloco titulo="Tendência semanal" dica={d.tendencia.dica} rotulo="Sobre a tendência semanal">
          <TendenciaSemanal pontos={d.tendencia.pontos} />
        </SubBloco>

        {d.comConversao ? (
          <>
            <SubBloco
              id="conjuntos"
              titulo="Conjuntos de conversão no ar"
              dica={d.conjuntos.dica}
              rotulo="Sobre os conjuntos de conversão"
            >
              <ConjuntosTable linhas={d.conjuntos.conversao} bucket="conversao" colunasDoRobo={colunasDoRobo} piso={piso} />
              {d.conjuntos.foraDoAr ? <ForaDoAr fora={d.conjuntos.foraDoAr} singular="conjunto" plural="conjuntos" /> : null}
            </SubBloco>

            <SubBloco
              id="criativos-tabela"
              titulo="Criativos de conversão no ar"
              dica={d.criativos.dica}
              rotulo="Sobre os criativos de conversão"
            >
              <CreativesTable linhas={d.criativos.conversao} bucket="conversao" colunasDoRobo={colunasDoRobo} piso={piso} regras={regras} />
              {d.criativos.foraDoAr ? <ForaDoAr fora={d.criativos.foraDoAr} singular="criativo" plural="criativos" /> : null}
              {d.criativos.liveNoBloco ? (
                <p className="text-xs text-muted-foreground">
                  Criativos da live:{" "}
                  <a href="#criativos-live" className="text-primary underline-offset-4 hover:underline">
                    no bloco próprio
                  </a>
                  .
                </p>
              ) : null}
            </SubBloco>
          </>
        ) : null}

        {d.descoberta ? (
          <SubBloco id={d.comConversao ? undefined : "conjuntos"} titulo="Descoberta" dica={d.descoberta.dica} rotulo="Sobre a descoberta">
            <div className="space-y-4">
              <ConjuntosTable linhas={d.conjuntos.descoberta} bucket="descoberta" colunasDoRobo={colunasDoRobo} piso={piso} />
              <CreativesTable linhas={d.criativos.descoberta} bucket="descoberta" colunasDoRobo={colunasDoRobo} piso={piso} regras={regras} />
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
                <Stat rotulo="Investimento" valor={`${prefixoDoPiso(piso)}${formatCurrency0(d.descoberta.numeros.investimento)}`} />
                <Stat
                  rotulo="Alcance somado por anúncio e por dia"
                  valor={formatInt(d.descoberta.numeros.alcanceSomado)}
                  dica={d.descoberta.dicaAlcance}
                  rotuloDaDica="Sobre o alcance somado"
                />
                <Stat rotulo="CPM" valor={moedaOuTraco(d.descoberta.numeros.cpm)} />
                <Stat
                  rotulo="Custo / mil alcançados"
                  valor={moedaOuTraco(d.descoberta.numeros.custoPorMilAlcancados)}
                  dica={d.descoberta.dicaCustoPorMil}
                  rotuloDaDica="Sobre o custo por mil alcançados"
                />
                <Stat rotulo="Seguidores no período" valor={formatIntComSinal(d.descoberta.numeros.seguidores)} />
                <Stat rotulo="Custo / seguidor (est.)" valor={moedaOuTraco(d.descoberta.numeros.custoPorSeguidorEst)} destaque />
              </dl>
            </div>
          </SubBloco>
        ) : null}

        <SubBloco titulo="Investimento por dia" dica={d.diario.dica} rotulo="Sobre o investimento por dia">
          <BarrasDiarias dados={d.diario.dados} faixas={d.diario.faixas} valueFormat="currency" yFormat="currency0" />
        </SubBloco>
      </div>
    </Recolhido>
  );
}
