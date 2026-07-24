import { LeadsDirectory, type LeadDirectoryRow } from "@/components/leads/leads-directory";
import { LeadActivity } from "@/components/leads/lead-activity";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getData, listLeadEvents } from "@/lib/data/store";
import { can } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const data = await getData();
  const canEdit = await can("leads:write");
  const events = await listLeadEvents({ limit: 200 });
  const nameById = new Map(data.creatives.map((c) => [c.adId, c.name]));

  const rows: LeadDirectoryRow[] = data.leads.map((l) => ({
    id: l.id,
    createdAt: l.createdAt,
    name: l.name,
    email: l.email,
    phone: l.phone,
    creativeName: l.utmContent ? (nameById.get(l.utmContent) ?? l.utmContent) : "—",
    status: l.status,
    meetingAt: l.meetingAt,
  }));

  return (
    <div className="space-y-6">
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
