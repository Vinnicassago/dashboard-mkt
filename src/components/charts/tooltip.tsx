"use client";

/** Shared tooltip card for Recharts charts. */
export interface TooltipEntry {
  name?: string;
  value?: number;
  color?: string;
  dataKey?: string | number;
}

export function TooltipBox({
  active,
  payload,
  label,
  labelFormat,
  valueFormat,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  labelFormat?: (v: string) => string;
  valueFormat?: (v: number, key?: string) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const heading = typeof label === "string" && labelFormat ? labelFormat(label) : label;

  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
      {heading != null ? (
        <p className="mb-1 font-medium text-foreground">{heading}</p>
      ) : null}
      <div className="space-y-0.5">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: entry.color }}
              />
              {entry.name}
            </span>
            <span className="tabular font-medium text-foreground">
              {valueFormat && typeof entry.value === "number"
                ? valueFormat(entry.value, String(entry.dataKey))
                : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
