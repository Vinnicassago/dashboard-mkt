"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART } from "./colors";
import { TooltipBox } from "./tooltip";
import { formatBy, formatDateShort, type NumFmt } from "@/lib/format";

export interface SeriesDef {
  key: string;
  label: string;
  color?: string;
  kind?: "area" | "line";
}

/**
 * Single-axis time series (x is always a date). Never pass series of different
 * scales — that would need a dual axis, which we don't do.
 * Format kinds are strings (serializable) so this can be used from Server
 * Components.
 */
export function TimeSeriesChart({
  data,
  xKey = "date",
  series,
  height = 260,
  yFormat = "compact",
  valueFormat,
}: {
  data: readonly unknown[];
  xKey?: string;
  series: SeriesDef[];
  height?: number;
  yFormat?: NumFmt;
  valueFormat?: NumFmt;
}) {
  const showLegend = series.length >= 2;
  const yFn = (v: number) => formatBy(yFormat, v);
  const tipFn = (v: number) => formatBy(valueFormat ?? yFormat, v);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data as unknown as Record<string, unknown>[]}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
      >
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color ?? CHART.series[i]} stopOpacity={0.28} />
              <stop offset="100%" stopColor={s.color ?? CHART.series[i]} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis
          dataKey={xKey}
          tickFormatter={(v) => formatDateShort(String(v))}
          tick={{ fontSize: 11, fill: CHART.axis }}
          tickLine={false}
          axisLine={{ stroke: CHART.grid }}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={(v) => yFn(Number(v))}
          tick={{ fontSize: 11, fill: CHART.axis }}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <Tooltip
          cursor={{ stroke: CHART.axis, strokeWidth: 1, strokeDasharray: "3 3" }}
          content={({ active, payload, label }) => (
            <TooltipBox
              active={active}
              payload={payload as never}
              label={label as string}
              labelFormat={formatDateShort}
              valueFormat={(v) => tipFn(v)}
            />
          )}
        />
        {showLegend ? (
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 12 }}
            formatter={(value) => <span className="text-muted-foreground">{value}</span>}
          />
        ) : null}
        {series.map((s, i) => {
          const color = s.color ?? CHART.series[i];
          if (s.kind === "line") {
            return (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            );
          }
          return (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={color}
              strokeWidth={2}
              fill={`url(#grad-${s.key})`}
              dot={false}
              activeDot={{ r: 4 }}
            />
          );
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
