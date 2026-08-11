import { cn } from "@/lib/utils";

type Variant = "default" | "muted" | "good" | "warning" | "critical" | "outline";

const styles: Record<Variant, string> = {
  default: "bg-primary/10 text-primary",
  muted: "bg-foreground/[0.06] text-muted-foreground",
  good: "bg-[var(--good)]/12 text-[var(--success-text)]",
  warning: "bg-[var(--warning)]/15 text-[var(--warning-text)]",
  critical: "bg-[var(--critical)]/12 text-[var(--danger-text)]",
  outline: "border text-muted-foreground",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}
