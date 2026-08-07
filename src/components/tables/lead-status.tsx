"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { changeLeadStatus } from "@/app/(dashboard)/funil/actions";
import type { LeadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const statusMeta: Record<
  LeadStatus,
  { label: string; variant: "muted" | "default" | "good" | "critical" }
> = {
  lead: { label: "Lead", variant: "muted" },
  agendou: { label: "Agendou", variant: "default" },
  compareceu: { label: "Compareceu", variant: "good" },
  cliente: { label: "Cliente", variant: "good" },
  perdido: { label: "Perdido", variant: "critical" },
};

export const statusOrder: Record<LeadStatus, number> = {
  cliente: 4,
  compareceu: 3,
  agendou: 2,
  lead: 1,
  perdido: 0,
};

/**
 * Changing a lead to "agendou" is what reports the meeting back to Meta/GA4,
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
  if (!canEdit) {
    return <Badge variant={statusMeta[status].variant}>{statusMeta[status].label}</Badge>;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Badge variant={statusMeta[status].variant}>{statusMeta[status].label}</Badge>
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
            "h-7 rounded-md border bg-background px-1.5 text-xs outline-none",
            pending && "opacity-50",
          )}
        >
          <option value="lead">Lead</option>
          <option value="agendou">Agendou</option>
          <option value="compareceu">Compareceu</option>
          <option value="cliente">Cliente</option>
          <option value="perdido">Perdido</option>
        </select>
      </div>
      {note ? <span className="text-[11px] text-muted-foreground">{note}</span> : null}
    </div>
  );
}
