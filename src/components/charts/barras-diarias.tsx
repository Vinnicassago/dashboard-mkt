"use client";

import { Bar, BarChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART } from "./colors";
import { TooltipBox } from "./tooltip";
import { formatBy, formatDateShort, type NumFmt } from "@/lib/format";

export interface DiaDaBarra {
  date: string;
  valor: number;
  /** Nenhum sync cobriu o dia: pode ter havido gasto que o painel não viu. */
  semDado: boolean;
  /** Sem linha, mas coberto por um sync: a campanha estava parada. */
  semVeiculacao: boolean;
}

/**
 * Gráfico diário (B12): uma barra por dia, eixo de tempo LINEAR (todo dia do
 * período tem o seu lugar — `dailySeries` já preenche os buracos), dias sem
 * dado com hachura âmbar e dias pausados com faixa cinza "pausado". Sem curva
 * suavizada: curva entre dois dias inventa um valor que não existiu.
 */
export function BarrasDiarias({
  dados,
  faixas = [],
  valueFormat = "currency",
  yFormat = "currency0",
  height = 240,
  nome = "Investimento",
}: {
  dados: DiaDaBarra[];
  /** Trechos marcados: `pausa` = faixa cinza "pausado"; `falha` = hachura "sem dados". */
  faixas?: { from: string; to: string; tom: "pausa" | "falha" }[];
  valueFormat?: NumFmt;
  yFormat?: NumFmt;
  height?: number;
  nome?: string;
}) {
  if (dados.length === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-sm text-muted-foreground">
        Sem dados no período
      </div>
    );
  }
  const yFn = (v: number) => formatBy(yFormat, v);
  const tipFn = (v: number) => formatBy(valueFormat, v);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={dados} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap={dados.length > 60 ? 1 : 3}>
        <defs>
          <pattern id="hachura-sem-dado" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--warning)" strokeWidth="2" strokeOpacity={0.55} />
          </pattern>
        </defs>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(v) => formatDateShort(String(v))}
          tick={{ fontSize: 11, fill: CHART.axis }}
          tickLine={false}
          axisLine={{ stroke: CHART.grid }}
          minTickGap={24}
          interval="preserveStartEnd"
        />
        <YAxis tickFormatter={(v) => yFn(Number(v))} tick={{ fontSize: 11, fill: CHART.axis }} tickLine={false} axisLine={false} width={56} />
        <Tooltip
          cursor={{ fill: "var(--foreground)", fillOpacity: 0.04 }}
          content={({ active, payload, label }) => {
            const dia = (payload as unknown as { payload?: DiaDaBarra }[] | undefined)?.[0]?.payload;
            const estado = dia?.semDado ? " · sem dados (nenhum sync cobriu o dia)" : dia?.semVeiculacao ? " · pausado (sem veiculação)" : "";
            return (
              <TooltipBox
                active={active}
                payload={dia?.semDado ? [] : (payload as never)}
                label={label as string}
                labelFormat={(v) => `${formatDateShort(v)}${estado}`}
                valueFormat={tipFn}
              />
            );
          }}
        />
        {faixas.map((f) => (
          <ReferenceArea
            key={`${f.tom}-${f.from}-${f.to}`}
            x1={f.from}
            x2={f.to}
            fill={f.tom === "falha" ? "url(#hachura-sem-dado)" : "var(--muted-foreground)"}
            fillOpacity={f.tom === "pausa" ? 0.08 : 1}
            stroke="none"
            label={{ value: f.tom === "falha" ? "sem dados" : "pausado", position: "insideTop", fontSize: 10, fill: CHART.axis }}
          />
        ))}
        <Bar dataKey="valor" name={nome} fill={CHART.series[0]} radius={[2, 2, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
