"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RANGE_PRESETS } from "@/lib/range";
import { cn } from "@/lib/utils";

export function PeriodSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("range") ?? "all";

  function select(key: string) {
    const next = new URLSearchParams(params.toString());
    if (key === "all") next.delete("range");
    else next.set("range", key);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="inline-flex items-center rounded-lg border p-0.5">
      {RANGE_PRESETS.map((preset) => {
        const active = current === preset.key;
        return (
          <button
            key={preset.key}
            type="button"
            onClick={() => select(preset.key)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
