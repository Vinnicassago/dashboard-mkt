"use client";

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART } from "./colors";
import { TooltipBox } from "./tooltip";
import { formatBy, type NumFmt } from "@/lib/format";

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

/**
 * Horizontal bars for comparing categories on one metric. Direct value labels
 * are always shown (the light-mode "relief" rule for sub-3:1 fills).
 * `valueFormat` is a serializable kind so this works from Server Components.
 */
export function HorizontalBars({
  data,
  valueFormat,
  height,
  barColor = CHART.primary,
}: {
  data: BarDatum[];
  valueFormat: NumFmt;
  height?: number;
  barColor?: string;
}) {
  const h = height ?? Math.max(120, data.length * 44 + 16);
  const vf = (v: number) => formatBy(valueFormat, v);

  if (data.length === 0) {
    return (
      <div
        style={{ height: h }}
        className="flex items-center justify-center text-sm text-muted-foreground"
      >
        Sem dados no período
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 4, right: 56, bottom: 4, left: 8 }}
        barCategoryGap={8}
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fontSize: 12, fill: CHART.axis }}
          tickLine={false}
          axisLine={false}
          width={150}
        />
        <Tooltip
          cursor={{ fill: "var(--foreground)", fillOpacity: 0.04 }}
          content={({ active, payload }) => {
            const cat = (payload as unknown as { payload?: { label?: string } }[] | undefined)?.[0]
              ?.payload?.label;
            return (
              <TooltipBox
                active={active}
                payload={payload as never}
                label={cat}
                hideName
                valueFormat={(v) => vf(v)}
              />
            );
          }}
        />
        <Bar dataKey="value" radius={[4, 4, 4, 4]} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.color ?? barColor} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            formatter={(value: unknown) => vf(Number(value))}
            style={{ fontSize: 12, fill: "var(--foreground)", fontVariantNumeric: "tabular-nums" }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
