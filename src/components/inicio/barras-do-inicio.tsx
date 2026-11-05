"use client";

import { useSyncExternalStore } from "react";
import { BarrasDiarias, type DiaDaBarra } from "@/components/charts/barras-diarias";

/** A partir de `sm` (640 px) as barras têm 160 px; no celular, 120. */
const LARGO = "(min-width: 640px)";

/**
 * O texto que o gráfico desenha conta no orçamento do Início (C13: ≤ 100 palavras
 * em `<main>` fora de tabela): no máximo 4 datas no eixo X, sem os números do
 * eixo Y (o valor do dia está na dica) e sem o "pausado" escrito na faixa (o ⓘ
 * do título diz o que é o cinza). `fase2-inicio-tela.test.ts` soma essas datas.
 */
export const DATAS_NO_EIXO_DO_INICIO = 4;

function assinar(avisar: () => void) {
  const m = window.matchMedia(LARGO);
  m.addEventListener("change", avisar);
  return () => m.removeEventListener("change", avisar);
}
const ehLargo = () => window.matchMedia(LARGO).matches;
/** No servidor (e na hidratação) vale a altura do notebook; o celular encolhe depois. */
const noServidor = () => true;

/**
 * As barras de "Leads chegando": `BarrasDiarias` com a altura do Início (160 px,
 * menor no celular). Recebe só o que é serializável — os dias (data, leads,
 * pausado) e as faixas cinza —, nada de lead.
 */
export function BarrasDoInicio({ dados, faixas }: { dados: DiaDaBarra[]; faixas: { from: string; to: string }[] }) {
  const largo = useSyncExternalStore(assinar, ehLargo, noServidor);
  return (
    <BarrasDiarias
      dados={dados}
      faixas={faixas.map((f) => ({ ...f, tom: "pausa" as const }))}
      valueFormat="int"
      yFormat="int"
      height={largo ? 160 : 120}
      nome="Leads"
      semEixoY
      semRotuloNasFaixas
      maxDatasNoEixo={DATAS_NO_EIXO_DO_INICIO}
    />
  );
}
