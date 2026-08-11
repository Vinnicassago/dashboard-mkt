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
    <div className="inline-flex h-9 items-center gap-0.5 rounded-lg border bg-card p-0.5">
      {RANGE_PRESETS.map((preset) => {
        const active = current === preset.key;
        return (
          <button
            key={preset.key}
            type="button"
            aria-pressed={active}
            onClick={() => select(preset.key)}
            className={cn(
              "flex h-full items-center rounded-md px-2 text-xs font-medium transition-colors sm:px-2.5",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
            )}
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
