import { DeletedLeads, LeadsDirectory, type DeletedLeadRow } from "@/components/leads/leads-directory";
import { LeadActivity } from "@/components/leads/lead-activity";
import { Revisar, type RevisarDados, type RevisarLead } from "@/components/leads/revisar";
import { RolarParaAncora } from "@/components/ui/rolar-para-ancora";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info } from "@/components/ui/info";
import { getData, listDeletedLeads, listLeadEvents } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { rotuladorDeOrigem } from "@/lib/origem";
import { estadoDoRoboAgora } from "@/lib/robo/estado";
import { can } from "@/lib/auth/guard";
import { getCurrentUser } from "@/lib/auth/current-user";
import { paraRevisar } from "@/lib/identidade";
import { DICAS_DE_LEADS, montarLinhasDeLeads, sobreALista } from "@/lib/leads-vista";
import { expedienteAtual } from "@/lib/atendimento-server";
import { mascararContato, mascararEmail, mascararNoTexto, mascararTelefone } from "@/lib/lgpd";
import { pageRange } from "@/lib/page-range";
import type { Lead, LeadEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * O histórico de um reenvio pode trazer o contato novo que a pessoa digitou, e
 * o motivo de uma exclusão antiga de "parece teste" foi gravado com o contato
 * cru. Para o papel mascarado, os dois vão mascarados — o resto do evento fica.
 */
function mascararEvento(e: LeadEvent): LeadEvent {
  if (!e.payload) return e;
  const { telefoneNovo, emailNovo, motivo } = e.payload;
  if (!telefoneNovo && !emailNovo && !motivo) return e;
  return {
    ...e,
    payload: {
      ...e.payload,
      ...(telefoneNovo ? { telefoneNovo: mascararTelefone(telefoneNovo) } : {}),
      ...(emailNovo ? { emailNovo: mascararEmail(emailNovo) } : {}),
      ...(motivo ? { motivo: mascararNoTexto(motivo) } : {}),
    },
  };
}

/**
 * Leads — quem é essa pessoa e o que já aconteceu com ela.
 *
 * Saíram daqui as filas que as páginas antigas tinham — "leads sem desfecho",
 * "esperando o primeiro contato" e, em nov/26, a tabela "Com o especialista"
 * (lia o banco do robô no render e mostrava a transcrição, contra a LGPD) —
 * porque a Fila de contato já as junta ("Aceitou o convite"), sem duplicata e
 * na ordem de urgência. A coluna "Atendimento" diz onde cada pessoa está agora.
 *
 * A tabela não calcula nada: cada linha sai de `montarLinhasDeLeads` (puro),
 * que lê as mesmas fontes da Fila e do Funil. O período (`?range=`) filtra
 * pela ENTRADA do lead — a coorte; sem ele, a campanha inteira. Abre com 50 linhas
 * (`LINHAS_POR_VEZ`); o texto que explicava a lista está no ⓘ do título (T3).
 */
export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range: rangeParam } = await searchParams;
  const brand = await activeBrandSlug();
  const data = await getData(brand);
  const { range, rangeKey } = pageRange(data, rangeParam);
  const [canEdit, canDelete, user] = await Promise.all([can("leads:write"), can("leads:delete"), getCurrentUser()]);
  // Marketing vê telefone e e-mail mascarados (LGPD). Sem login (modo aberto), nada mascara.
  const mascarar = user?.role === "marketing";
  const agora = new Date().toISOString();

  // O robô pelo store (o sync grava os fatos no lead): o MESMO estado da Fila e da exportação.
  const [todosEventos, robo, excluidos, expediente] = await Promise.all([
    listLeadEvents({ brand, limit: 0 }),
    estadoDoRoboAgora(brand),
    listDeletedLeads(brand),
    expedienteAtual(),
  ]);
  // O histórico na tela mostra os 200 mais recentes; as linhas usam todos.
  const events = todosEventos.slice(0, 200).map((e) => (mascarar ? mascararEvento(e) : e));
  const deletedRows: DeletedLeadRow[] = excluidos.map((l) => ({
    id: l.id,
    name: l.name,
    deletedAt: l.deletedAt ?? "",
    deletedBy: l.deletedBy,
    // Motivos antigos de "parece teste" foram gravados com o contato cru.
    deletedReason: mascarar ? mascararNoTexto(l.deletedReason) || undefined : l.deletedReason,
  }));
  const origem = rotuladorDeOrigem(data);

  const linhas = montarLinhasDeLeads(data, todosEventos, agora, { range, expediente, robo });
  const rows = mascarar ? linhas.map(mascararContato) : linhas;

  // Revisar só aparece para quem age (comercial/admin); a máscara aqui é a
  // mesma da tabela, para o contato não depender de quem enxerga o bloco.
  const revisarLead = (l: Lead): RevisarLead => {
    const r: RevisarLead = {
      id: l.id,
      name: l.name,
      status: l.status,
      createdAt: l.createdAt,
      phone: l.phone,
      email: l.email,
      origem: origem(l),
    };
    return mascarar ? mascararContato(r) : r;
  };
  const rev = paraRevisar(data.leads);
  const revisar: RevisarDados = {
    testes: rev.testes.map((t) => ({ ...revisarLead(t.lead), porque: t.porque })),
    duplicados: rev.duplicados.map((g) => ({
      principal: revisarLead(g.principal),
      duplicados: g.duplicados.map(revisarLead),
      conflito: g.conflito,
    })),
    desistencias: rev.desistenciaSemReuniao.map(revisarLead),
    contatos: rev.contatoComProblema.map((c) => ({ ...revisarLead(c.lead), problemas: c.problemas })),
  };
  const nRevisar =
    revisar.testes.length + revisar.duplicados.length + revisar.desistencias.length + revisar.contatos.length;

  return (
    <div className="space-y-6">
      <RolarParaAncora />

      <Card id="leads" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex items-center gap-0.5" data-titulo>
            <span className="min-w-0">Leads ({rows.length})</span>
            <Info texto={sobreALista({ mascarar, exporta: canEdit })} rotulo="Sobre a lista de leads" className="-my-1" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <LeadsDirectory
            rows={rows}
            rangeKey={rangeKey}
            canEdit={canEdit}
            canDelete={canDelete}
            canExport={canEdit}
            mascararContato={mascarar}
            roboLigado={robo.ligado}
          />
        </CardContent>
      </Card>

      {/* Higiene da base (D2): recolhida — é revisão, não o trabalho do dia. */}
      {nRevisar > 0 && (canEdit || canDelete) ? (
        <Card id="revisar" className="scroll-mt-24">
          <details>
            <summary className="cursor-pointer p-5 text-sm font-semibold select-none">Revisar ({nRevisar})</summary>
            <CardContent>
              <div className="flex justify-end">
                <Info texto={DICAS_DE_LEADS.revisar} rotulo="Sobre o Revisar" />
              </div>
              <Revisar dados={revisar} podeAgir={canDelete} />
            </CardContent>
          </details>
        </Card>
      ) : null}

      {/* Excluídos: fora das listas e dos números, mas à vista e recuperáveis. */}
      {deletedRows.length ? (
        <Card id="excluidos" className="scroll-mt-24">
          <details>
            <summary className="cursor-pointer p-5 text-sm font-semibold select-none">Excluídos ({deletedRows.length})</summary>
            <CardContent>
              <div className="flex justify-end">
                <Info texto={DICAS_DE_LEADS.excluidos} rotulo="Sobre os excluídos" />
              </div>
              <DeletedLeads rows={deletedRows} canRestore={canDelete} />
            </CardContent>
          </details>
        </Card>
      ) : null}

      {/* Auditoria é consulta, não leitura diária: fica recolhida. */}
      <Card id="historico" className="scroll-mt-24">
        <details>
          <summary className="cursor-pointer p-5 text-sm font-semibold select-none">Histórico de alterações</summary>
          <CardContent>
            <div className="flex justify-end">
              <Info texto={DICAS_DE_LEADS.historico} rotulo="Sobre o histórico de alterações" />
            </div>
            <LeadActivity events={events} />
          </CardContent>
        </details>
      </Card>
    </div>
  );
}
