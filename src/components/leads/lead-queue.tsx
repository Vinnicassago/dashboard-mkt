import { MessageCircle } from "lucide-react";
import type { LeadAgeBucket, LeadQueue } from "@/lib/metrics";

/**
 * Fila do comercial: leads ainda sem contato, do mais antigo ao mais novo.
 * Speed-to-lead é a alavanca nº1 de agendamento — agir rápido nos leads já
 * pagos derruba o CPR sem gastar mais. Server component (sem estado).
 */

const TONE: Record<LeadAgeBucket, string> = {
  novo: "var(--good)",
  atencao: "var(--warning)",
  atrasado: "var(--critical)",
};
const LABEL: Record<LeadAgeBucket, string> = {
  novo: "< 24h",
  atencao: "24–48h",
  atrasado: "> 48h",
};

function waLink(phone: string): string {
  let d = phone.replace(/\D/g, "").replace(/^0+/, "");
  if (d.length >= 10 && d.length <= 11) d = `55${d}`;
  return `https://wa.me/${d}`;
}

function ageLabel(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 24) return `${Math.round(h)} h`;
  return `${Math.floor(h / 24)} d`;
}

export function LeadQueueCard({ queue }: { queue: LeadQueue }) {
  const top = queue.open.slice(0, 12);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        {(["atrasado", "atencao", "novo"] as LeadAgeBucket[]).map((b) => (
          <span
            key={b}
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium"
          >
            <span className="size-2 rounded-full" style={{ background: TONE[b] }} />
            {queue.counts[b]} {LABEL[b]}
          </span>
        ))}
      </div>

      <ul className="divide-y rounded-lg border">
        {top.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="size-2 shrink-0 rounded-full" style={{ background: TONE[l.bucket] }} />
              <span className="truncate text-sm font-medium">{l.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">há {ageLabel(l.ageHours)}</span>
            </div>
            {l.phone ? (
              <a
                href={waLink(l.phone)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium text-[var(--success-text)] hover:bg-[var(--good)]/10"
              >
                <MessageCircle className="size-3.5" />
                WhatsApp
              </a>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">sem telefone</span>
            )}
          </li>
        ))}
      </ul>
      {queue.open.length > top.length ? (
        <p className="text-xs text-muted-foreground">
          + {queue.open.length - top.length} lead(s) na fila.
        </p>
      ) : null}
    </div>
  );
}
