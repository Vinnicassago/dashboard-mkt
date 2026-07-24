import { Inbox, type LucideIcon } from "lucide-react";

/** Honest empty state — used when a metric has no data yet (e.g. new account). */
export function EmptyState({
  title,
  hint,
  Icon = Inbox,
}: {
  title: string;
  hint?: string;
  Icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-center">
      <Icon className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="max-w-xs text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
