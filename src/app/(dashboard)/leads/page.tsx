import { Clock } from "lucide-react";
import { LeadsDirectory, type LeadDirectoryRow } from "@/components/leads/leads-directory";
import { LeadActivity } from "@/components/leads/lead-activity";
import { LeadQueueCard } from "@/components/leads/lead-queue";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getData, listLeadEvents } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { adIdFromUtmContent, leadQueue } from "@/lib/metrics";
import { can } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/** Nome do criativo a partir do utm_content ("nome|adid"): resolve pelo id do
 *  anúncio, senão mostra a parte de nome (antes do "|"). */
function originLabel(utmContent: string | undefined, nameById: Map<string, string>): string {
  if (!utmContent) return "—";
  const id = adIdFromUtmContent(utmContent);
  return (id ? nameById.get(id) : nameById.get(utmContent)) ?? utmContent.split("|")[0];
}

export default async function LeadsPage() {
  const data = await getData(await activeBrandSlug());
  const canEdit = await can("leads:write");
  const events = await listLeadEvents({ limit: 200 });
  const nameById = new Map(data.creatives.map((c) => [c.adId, c.name]));
  const queue = leadQueue(data.leads, new Date().toISOString());

  const rows: LeadDirectoryRow[] = data.leads.map((l) => ({
    id: l.id,
    createdAt: l.createdAt,
    name: l.name,
    email: l.email,
    phone: l.phone,
    creativeName: originLabel(l.utmContent, nameById),
    status: l.status,
    meetingAt: l.meetingAt,
  }));

  return (
    <div className="space-y-6">
      {canEdit && queue.open.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4 text-primary" />
              Fila do comercial ({queue.open.length})
            </CardTitle>
            <CardDescription>
              Leads ainda sem contato, do mais antigo ao mais novo. Responder rápido é o
              que mais aumenta o agendamento — e derruba o custo por reunião sem gastar mais.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LeadQueueCard queue={queue} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Leads da campanha ({rows.length})</CardTitle>
          <CardDescription>
            Todos os contatos gerados, com nome, telefone e e-mail. Clique no telefone
            para abrir o WhatsApp, ou exporte tudo em CSV para o time comercial.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeadsDirectory rows={rows} canEdit={canEdit} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico de alterações</CardTitle>
          <CardDescription>
            Quem criou e quem mudou o status de cada lead (mais recentes primeiro).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeadActivity events={events} />
        </CardContent>
      </Card>
    </div>
  );
}
