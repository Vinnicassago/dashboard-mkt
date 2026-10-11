"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART } from "@/components/charts/colors";
import type { PontoTendencia } from "@/lib/funil";
import { formatDateShort, formatInt, formatPercent } from "@/lib/format";

/**
 * As três taxas-chave, semana a semana. Semana sem denominador fica sem ponto
 * (lacuna na linha), não em 0%. A dica mostra a amostra de cada taxa: 100% com
 * 1 lead se vê, mas se vê como 1 lead.
 */

const SERIES = [
  { key: "visitaLead", label: "Visita → lead", n: "visitas", color: CHART.series[1] },
  { key: "leadContatoNoPrazo", label: "Lead → 1º contato no prazo", n: "contato", color: CHART.series[2] },
  { key: "leadAgendada", label: "Lead → agendada", n: "leads", color: CHART.series[0] },
] as const;

function Dica({ active, payload, label }: { active?: boolean; payload?: { payload?: PontoTendencia }[]; label?: string }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-foreground">
        semana de {formatDateShort(String(label))}
        {p.incompleta ? " (em curso)" : ""}
      </p>
      <div className="space-y-0.5">
        {SERIES.map((s) => {
          const v = p[s.key];
          const n = p.n[s.n];
          return (
            <div key={s.key} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="inline-block size-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="tabular font-medium text-foreground">
                {v === undefined ? "—" : formatPercent(v)}
                <span className="ml-1 font-normal text-muted-foreground">n = {formatInt(n)}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TendenciaChart({ data, height = 240 }: { data: PontoTendencia[]; height?: number }) {
  if (data.length === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-sm text-muted-foreground">
        Sem dados no período
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis
          dataKey="semana"
          tickFormatter={(v) => formatDateShort(String(v))}
          tick={{ fontSize: 11, fill: CHART.axis }}
          tickLine={false}
          axisLine={{ stroke: CHART.grid }}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={(v) => formatPercent(Number(v), 0)}
          tick={{ fontSize: 11, fill: CHART.axis }}
          tickLine={false}
          axisLine={false}
          width={48}
          domain={[0, (max: number) => Math.min(1, Math.max(0.1, max))]}
        />
        <Tooltip
          cursor={{ stroke: CHART.axis, strokeWidth: 1, strokeDasharray: "3 3" }}
          content={({ active, payload, label }) => <Dica active={active} payload={payload as never} label={label as string} />}
        />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} formatter={(value) => <span className="text-muted-foreground">{value}</span>} />
        {SERIES.map((s) => (
          <Line
            key={s.key}
            type="linear"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={{ r: 2.5, strokeWidth: 0, fill: s.color }}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
