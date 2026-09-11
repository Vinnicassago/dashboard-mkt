"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { changeLeadStatus } from "@/app/(dashboard)/pessoas/actions";
import { LEAD_STATUS_META, LOST_STATUSES, OPEN_STATUSES } from "@/lib/lead-status";
import type { LeadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Rótulo e cor vêm da régua (`lib/lead-status.ts`) — este arquivo só desenha.
 * Reexportado porque metade da UI já importava daqui.
 */
export { LEAD_STATUS_META as statusMeta } from "@/lib/lead-status";

export function StatusBadge({ status }: { status: LeadStatus }) {
  const meta = LEAD_STATUS_META[status];
  return (
    <Badge variant={meta.variant} title={meta.hint}>
      {meta.label}
    </Badge>
  );
}

/**
 * Changing a lead to "agendado" is what reports the meeting back to Meta/GA4,
 * so the campaign learns to optimise for leads that actually schedule.
 */
export function StatusSelect({
  id,
  name,
  status,
  canEdit = true,
}: {
  id: string;
  name: string;
  status: LeadStatus;
  canEdit?: boolean;
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const router = useRouter();

  // Read-only for roles without leads:write (e.g. marketing).
  if (!canEdit) return <StatusBadge status={status} />;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <StatusBadge status={status} />
        <select
          aria-label={`Alterar status de ${name}`}
          value={status}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.value as LeadStatus;
            let value: number | undefined;
            if (next === "cliente") {
              const raw = window.prompt("Valor da carta/contrato (R$):", "");
              if (raw === null) return; // cancelou — não muda o status
              const parsed = Number(
                raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."),
              );
              value = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
            }
            start(async () => {
              const result = await changeLeadStatus(id, next, value);
              setNote(result.message);
              router.refresh();
            });
          }}
          className={cn(
            "h-7 rounded-md border bg-background px-1.5 text-xs focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
            pending && "opacity-50",
          )}
        >
          {/* Caminho feliz e motivos de perda separados — são 8 opções, e sem
              a divisão o comercial erra o clique. */}
          <optgroup label="Em andamento">
            {OPEN_STATUSES.map((s) => (
              <option key={s} value={s} title={LEAD_STATUS_META[s].hint}>
                {LEAD_STATUS_META[s].label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Perdido — por quê">
            {LOST_STATUSES.map((s) => (
              <option key={s} value={s} title={LEAD_STATUS_META[s].hint}>
                {LEAD_STATUS_META[s].label}
              </option>
            ))}
          </optgroup>
        </select>
      </div>
      {note ? <span className="text-[11px] text-muted-foreground">{note}</span> : null}
    </div>
  );
}
