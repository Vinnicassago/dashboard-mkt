"use client";

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART } from "@/components/charts/colors";
import { TooltipBox } from "@/components/charts/tooltip";
import { formatCompact, formatCurrency, formatCurrency0, formatDateShort, formatInt } from "@/lib/format";
import type { PontoSemanalMidia } from "@/lib/midia";

/**
 * Tendência semanal da Mídia: gasto (barras), leads (linha) e CPL (linha
 * secundária, com o valor escrito em cada ponto — a escala dele é outra). Uma
 * semana = segunda a domingo; a corrente, incompleta, sai vazada.
 *
 * Três escalas num gráfico só é o que o relatório pede (§7.3). Para não mentir
 * com um eixo escondido, o CPL leva rótulo direto em cada ponto e o eixo da
 * direita é o de leads.
 */
export function TendenciaSemanal({ pontos }: { pontos: PontoSemanalMidia[] }) {
  if (pontos.length === 0 || pontos.every((p) => p.semLinha && p.leads === 0)) {
    return <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">Sem dados nas últimas semanas</div>;
  }
  const dados = pontos.map((p) => ({ ...p, cplLinha: p.cpl ?? undefined }));
  const fmt = (v: number, key?: string) => {
    if (key === "leads") return formatInt(v);
    if (key === "cplLinha") return formatCurrency(v);
    return formatCurrency0(v);
  };
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={dados} margin={{ top: 16, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis
          dataKey="semana"
          tickFormatter={(v) => formatDateShort(String(v))}
          tick={{ fontSize: 11, fill: CHART.axis }}
          tickLine={false}
          axisLine={{ stroke: CHART.grid }}
          minTickGap={16}
        />
        <YAxis
          yAxisId="reais"
          tickFormatter={(v) => formatCompact(Number(v))}
          tick={{ fontSize: 11, fill: CHART.axis }}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <YAxis
          yAxisId="leads"
          orientation="right"
          allowDecimals={false}
          tickFormatter={(v) => formatInt(Number(v))}
          tick={{ fontSize: 11, fill: CHART.axis }}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        {/* Escala própria do CPL: o número vai escrito no ponto. */}
        <YAxis yAxisId="cpl" hide domain={[0, (max: number) => max * 1.6]} />
        <Tooltip
          cursor={{ fill: "var(--foreground)", fillOpacity: 0.04 }}
          content={({ active, payload, label }) => (
            <TooltipBox
              active={active}
              payload={payload as never}
              label={label as string}
              labelFormat={(v) => `semana de ${formatDateShort(v)}`}
              valueFormat={fmt}
            />
          )}
        />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} formatter={(value) => <span className="text-muted-foreground">{value}</span>} />
        <Bar yAxisId="reais" dataKey="gasto" name="Gasto" fill={CHART.series[0]} radius={[2, 2, 0, 0]} isAnimationActive={false}>
          {dados.map((p) => (
            <Cell key={p.semana} fill={CHART.series[0]} fillOpacity={p.incompleta ? 0.35 : 0.85} stroke={p.incompleta ? CHART.series[0] : "none"} strokeDasharray={p.incompleta ? "3 2" : undefined} />
          ))}
        </Bar>
        <Line yAxisId="leads" type="linear" dataKey="leads" name="Leads (painel)" stroke={CHART.series[1]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 4 }} isAnimationActive={false} />
        <Line yAxisId="cpl" type="linear" dataKey="cplLinha" name="CPL (painel)" stroke={CHART.series[2]} strokeWidth={1.5} strokeDasharray="4 3" dot={{ r: 2 }} connectNulls={false} isAnimationActive={false}>
          <LabelList dataKey="cplLinha" position="top" formatter={(v: unknown) => (typeof v === "number" ? formatCurrency0(v) : "")} style={{ fontSize: 10, fill: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }} />
        </Line>
      </ComposedChart>
    </ResponsiveContainer>
  );
}
