import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Mail, MessageCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/tables/lead-status";
import { DeletedLeads } from "@/components/leads/leads-directory";
import { DescricaoEvento } from "@/components/leads/lead-activity";
import { FichaAcoes } from "@/components/leads/ficha-acoes";
import { getData, getLead, listLeadEvents } from "@/lib/data/store";
import { can } from "@/lib/auth/guard";
import { mensagemWhatsapp } from "@/lib/integracoes";
import { resumoContato, quando } from "@/lib/contato";
import { etapaDoLead, FILA_ETAPAS } from "@/lib/fila";
import { gruposDuplicados, pareceTeste, problemasDeContato } from "@/lib/identidade";
import { everBooked } from "@/lib/metrics";
import { rotuladorDeOrigem } from "@/lib/origem";
import { normalizarTelefone } from "@/lib/phone";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { LeadEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

const data = (iso?: string) => (iso ? formatDateTime(iso) : "—");

/**
 * Ficha do lead — tudo o que aconteceu com UMA pessoa, numa tela: de onde veio,
 * cada tentativa, cada mudança de status, a reunião, as anotações; e as mesmas
 * ações da Fila. Não é página de menu: abre pelo nome em Pessoas, na Fila e no
 * histórico (e pelo link do aviso de lead novo).
 */
export default async function FichaDoLead({ params }: { params: Promise<{ id: string }> }) {
  const { id: bruto } = await params;
  const id = decodeURIComponent(bruto);
  const lead = await getLead(id);
  if (!lead) notFound();

  const [dados, proprios, canEdit, canDelete, mensagem] = await Promise.all([
    getData(lead.brand),
    listLeadEvents({ leadId: id, limit: 0 }),
    can("leads:write"),
    can("leads:delete"),
    mensagemWhatsapp(),
  ]);

  // Cadastros mesclados neste: o histórico deles mora no id deles.
  const mesclados = new Map(
    proprios
      .filter((e) => e.action === "mesclado" && e.payload?.duplicado)
      .map((e) => [e.payload!.duplicado, e.payload?.nome ?? "outro cadastro"]),
  );
  const deles = await Promise.all([...mesclados.keys()].map((m) => listLeadEvents({ leadId: m, limit: 0 })));
  const linhaDoTempo: LeadEvent[] = [...proprios, ...deles.flat()].sort((a, b) =>
    quando(b).localeCompare(quando(a)),
  );

  const contato = resumoContato(proprios);
  const origem = rotuladorDeOrigem(dados)(lead.utmContent);
  const naFila = lead.deletedAt ? null : etapaDoLead(lead, proprios, new Date().toISOString());
  const teste = pareceTeste(lead);
  const problemas = problemasDeContato(lead);
  const grupo = gruposDuplicados(dados.leads).find((g) =>
    [g.principal, ...g.duplicados].some((l) => l.id === lead.id),
  );
  const outros = grupo ? [grupo.principal, ...grupo.duplicados].filter((l) => l.id !== lead.id) : [];

  return (
    <div className="space-y-6">
      <Link
        href="/pessoas"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Pessoas
      </Link>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold tracking-tight">{lead.name}</h2>
          <StatusBadge status={lead.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          Entrou em {formatDateTime(lead.createdAt)} · origem {origem}
          {naFila ? (
            <>
              {" "}
              · na{" "}
              <Link href={`/fila?etapa=${naFila.nome}`} className="text-primary underline-offset-4 hover:underline">
                Fila de contato
              </Link>{" "}
              como “{FILA_ETAPAS[naFila.nome].label}”
            </>
          ) : null}
        </p>
      </div>

      {lead.deletedAt ? (
        <Card className="border-[var(--danger)]/40">
          <CardContent className="space-y-2 p-4">
            <p className="text-sm">
              Este lead está <span className="font-medium">excluído</span>: fora das listas e dos
              números.
            </p>
            <DeletedLeads
              rows={[
                {
                  id: lead.id,
                  name: lead.name,
                  deletedAt: lead.deletedAt,
                  deletedBy: lead.deletedBy,
                  deletedReason: lead.deletedReason,
                },
              ]}
              canRestore={canDelete}
            />
          </CardContent>
        </Card>
      ) : null}

      {teste || problemas.length || outros.length ? (
        <Card className="border-[var(--warning)]/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning-text)]" />
            <ul className="space-y-1 text-sm">
              {teste ? <li>Parece cadastro de teste ({teste}).</li> : null}
              {problemas.map((p) => (
                <li key={p}>Contato: {p}.</li>
              ))}
              {outros.length ? (
                <li>
                  A mesma pessoa tem outro cadastro:{" "}
                  {outros.map((o, i) => (
                    <span key={o.id}>
                      {i > 0 ? ", " : ""}
                      <Link href={`/pessoas/${encodeURIComponent(o.id)}`} className="underline-offset-4 hover:underline">
                        {o.name}
                      </Link>
                    </span>
                  ))}
                  . Dá para mesclar em Pessoas → Revisar.
                </li>
              ) : null}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Contato</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Linha rotulo="Telefone">
                  {lead.phone ? (
                    <a
                      href={`https://wa.me/${normalizarTelefone(lead.phone)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 hover:underline"
                    >
                      <MessageCircle className="size-3.5 text-[var(--success-text)]" />
                      {lead.phone}
                    </a>
                  ) : (
                    "—"
                  )}
                </Linha>
                <Linha rotulo="E-mail">
                  {lead.email ? (
                    <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1.5 hover:underline">
                      <Mail className="size-3.5" />
                      {lead.email}
                    </a>
                  ) : (
                    "—"
                  )}
                </Linha>
                <Linha rotulo="Tentativas">
                  {contato.tentativas}
                  {contato.falou ? " · já falou com a pessoa" : ""}
                </Linha>
                <Linha rotulo="Última tentativa">{data(contato.ultima)}</Linha>
                {contato.proxima ? <Linha rotulo="Próxima pela cadência">{data(contato.proxima)}</Linha> : null}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Marcos</CardTitle>
              <CardDescription>
                Gravados uma vez, quando aconteceram — o status pode mudar, o fato não.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Linha rotulo="Entrada">{data(lead.createdAt)}</Linha>
                <Linha rotulo="1º contato">{data(lead.firstContactAt)}</Linha>
                <Linha rotulo="Agendou">{data(lead.bookedAt)}</Linha>
                <Linha rotulo="Reunião marcada para">
                  {lead.meetingFor ? formatDateTime(lead.meetingFor) : everBooked(lead) ? "data não registrada" : "—"}
                </Linha>
                <Linha rotulo="Reunião realizada">{data(lead.attendedAt)}</Linha>
                <Linha rotulo="Virou cliente">
                  {lead.closedAt
                    ? `${formatDateTime(lead.closedAt)}${lead.value ? ` · ${formatCurrency(lead.value)}` : ""}`
                    : "—"}
                </Linha>
                {lead.lostAt ? (
                  <Linha rotulo="Perdido em">
                    {formatDateTime(lead.lostAt)}
                    {lead.lostReasonDetail ? ` · ${lead.lostReasonDetail}` : ""}
                  </Linha>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Origem</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y">
                <Linha rotulo="Anúncio">{origem}</Linha>
                <Linha rotulo="utm_source">{lead.utmSource ?? "—"}</Linha>
                <Linha rotulo="utm_campaign">{lead.utmCampaign ?? "—"}</Linha>
                <Linha rotulo="Clique da Meta (fbc)">{lead.fbc ? "sim" : "não"}</Linha>
                <Linha rotulo="Id">
                  <span className="font-mono text-xs">{lead.id}</span>
                </Linha>
              </dl>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {!lead.deletedAt ? (
            <Card>
              <CardHeader>
                <CardTitle>Registrar</CardTitle>
              </CardHeader>
              <CardContent>
                <FichaAcoes
                  id={lead.id}
                  name={lead.name}
                  status={lead.status}
                  jaAgendou={everBooked(lead)}
                  tentativas={contato.tentativas}
                  diasComTentativa={contato.diasComTentativa}
                  telefone={lead.phone}
                  mensagemWhatsapp={mensagem}
                  canEdit={canEdit}
                  podeReabrir={canDelete}
                />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Linha do tempo</CardTitle>
              <CardDescription>Cada entrada, tentativa, mudança e anotação — a mais recente primeiro.</CardDescription>
            </CardHeader>
            <CardContent>
              {linhaDoTempo.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nada registrado ainda.</p>
              ) : (
                <ol className="space-y-3">
                  {linhaDoTempo.map((e) => (
                    <li key={e.id} className="border-l-2 pl-3 text-sm">
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(quando(e))} · {e.actor}
                        {e.leadId !== lead.id ? ` · cadastro mesclado (${mesclados.get(e.leadId) ?? e.leadName})` : ""}
                      </p>
                      <div className="mt-0.5">
                        <DescricaoEvento e={e} />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
