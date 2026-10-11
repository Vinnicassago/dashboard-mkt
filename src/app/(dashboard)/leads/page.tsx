import { mensagemHumana } from "@/lib/erros";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { DeletedLeads, LeadsDirectory, type DeletedLeadRow } from "@/components/leads/leads-directory";
import { LeadActivity } from "@/components/leads/lead-activity";
import { Revisar, type RevisarDados, type RevisarLead } from "@/components/leads/revisar";
import { ComercialTable } from "@/components/robo/comercial-table";
import { RolarParaAncora } from "@/components/ui/rolar-para-ancora";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getData, listDeletedLeads, listLeadEvents } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { rotuladorDeOrigem } from "@/lib/origem";
import { getComercial } from "@/lib/robo/client";
import { can } from "@/lib/auth/guard";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatarEspera } from "@/lib/format";
import { paraRevisar } from "@/lib/identidade";
import { montarLinhasDeLeads } from "@/lib/leads-vista";
import { mascararContato, mascararEmail, mascararTelefone } from "@/lib/lgpd";
import { pageRange } from "@/lib/page-range";
import { comPeriodo, rangeLabel } from "@/lib/range";
import type { Lead, LeadEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Minutos do robô → a mesma escrita de espera do resto do painel. */
const duracao = (min: number | null) => formatarEspera(min == null ? null : min / 60);

/**
 * O histórico de um reenvio pode trazer o contato novo que a pessoa digitou.
 * Para o papel mascarado, ele vai mascarado também — o resto do evento fica.
 */
function mascararEvento(e: LeadEvent): LeadEvent {
  if (!e.payload) return e;
  const { telefoneNovo, emailNovo } = e.payload;
  if (!telefoneNovo && !emailNovo) return e;
  return {
    ...e,
    payload: {
      ...e.payload,
      ...(telefoneNovo ? { telefoneNovo: mascararTelefone(telefoneNovo) } : {}),
      ...(emailNovo ? { emailNovo: mascararEmail(emailNovo) } : {}),
    },
  };
}

/**
 * Leads — quem é essa pessoa e o que já aconteceu com ela.
 *
 * Funde Leads (o cadastro do painel) e Atendimento Comercial (quem o robô passou
 * ao especialista). Saíram daqui as duas filas que as páginas antigas tinham —
 * "leads sem desfecho" e "esperando o primeiro contato" — porque a Fila de
 * contato já as junta, sem duplicata e na ordem de urgência. Duas listas de
 * espera com contagens diferentes era parte dos "dados desconexos".
 *
 * A tabela não calcula nada: cada linha sai de `montarLinhasDeLeads` (puro),
 * que lê as mesmas fontes da Fila e do Funil. O período (`?range=`) filtra
 * pela ENTRADA do lead — a coorte; sem ele, a campanha inteira.
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

  const [todosEventos, comercial, excluidos] = await Promise.all([
    listLeadEvents({ brand, limit: 0 }),
    getComercial(),
    listDeletedLeads(brand),
  ]);
  // O histórico na tela mostra os 200 mais recentes; as linhas usam todos.
  const events = todosEventos.slice(0, 200).map((e) => (mascarar ? mascararEvento(e) : e));
  const deletedRows: DeletedLeadRow[] = excluidos.map((l) => ({
    id: l.id,
    name: l.name,
    deletedAt: l.deletedAt ?? "",
    deletedBy: l.deletedBy,
    deletedReason: l.deletedReason,
  }));
  const origem = rotuladorDeOrigem(data);

  const linhas = montarLinhasDeLeads(data, todosEventos, agora, { range });
  const rows = mascarar ? linhas.map(mascararContato) : linhas;

  // Para o papel mascarado, a tabela do especialista (componente compartilhado,
  // que linka o telefone) vai sem contato: um link com "•••" não leva a nada.
  const comercialRows = mascarar
    ? comercial.rows.map((r) => ({ ...r, telefone: null, email: null }))
    : comercial.rows;
  const { kpis } = comercial;

  const revisarLead = (l: Lead): RevisarLead => ({
    id: l.id,
    name: l.name,
    status: l.status,
    createdAt: l.createdAt,
    phone: l.phone,
    email: l.email,
    origem: origem(l),
  });
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
      <p className="max-w-3xl text-sm text-muted-foreground">
        A ficha de cada pessoa que a campanha trouxe, para consultar e registrar o que
        aconteceu. Quem está esperando contato fica na{" "}
        <Link href={comPeriodo("/fila", rangeKey)} className="text-primary underline-offset-4 hover:underline">
          Fila de contato
        </Link>
        , na ordem de quem ligar primeiro.
      </p>

      <Card id="leads" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Leads ({rows.length})</CardTitle>
          <CardDescription>
            {rangeKey === "all"
              ? "Todos os leads da campanha"
              : `Leads que entraram em ${rangeLabel(rangeKey)} (o período do cabeçalho)`}
            , com status, até onde chegaram, tentativas, a próxima ação da Fila e a origem.
            {mascarar
              ? " Telefone e e-mail aparecem mascarados para o papel Marketing."
              : " Clique no telefone para abrir o WhatsApp."}
            {canEdit ? " A exportação em CSV leva só o que o filtro mostra e fica registrada." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeadsDirectory
            rows={rows}
            rangeKey={rangeKey}
            canEdit={canEdit}
            canDelete={canDelete}
            canExport={canEdit}
            mascararContato={mascarar}
          />
        </CardContent>
      </Card>

      {/* Leitura que falhou não vira "0 pessoas com o especialista": some com a
          lista e diz por quê. Os leads do painel acima não dependem do robô. */}
      {comercial.falha?.tipo === "erro" ? (
        <Card className="border-[var(--warning)]/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning-text)]" />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                Não consegui ler o atendimento do especialista.
              </span>{" "}
              A lista dele não aparece para não passar zeros por números reais; os leads do
              painel acima estão completos. {mensagemHumana("robô", comercial.falha.detalhe)}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {kpis ? (
        <Card id="especialista" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Com o especialista ({comercialRows.length})</CardTitle>
            <CardDescription>
              Cada pessoa que o robô qualificou e passou ao especialista. É aqui que se
              registram abordagem, reunião e decisão — e o que se marca aqui atualiza também o
              lead no painel. O primeiro contato vem em média{" "}
              {duracao(kpis.minutos_medios_ate_abordagem)} depois da transferência (pior caso:{" "}
              {duracao(kpis.pior_tempo_minutos)}).
              {mascarar ? " O contato fica oculto para o papel Marketing." : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ComercialTable rows={comercialRows} canEdit={canEdit} />
          </CardContent>
        </Card>
      ) : null}

      {/* Higiene da base (D2): recolhida — é revisão, não o trabalho do dia. */}
      {nRevisar > 0 && (canEdit || canDelete) ? (
        <Card id="revisar" className="scroll-mt-24">
          <details>
            <summary className="cursor-pointer p-5 text-sm font-semibold select-none">
              Revisar ({nRevisar}){" "}
              <span className="font-normal text-muted-foreground">
                · possíveis testes, a mesma pessoa duas vezes, desistência sem reunião e contato
                com problema
              </span>
            </summary>
            <CardContent>
              <Revisar dados={revisar} podeAgir={canDelete} />
            </CardContent>
          </details>
        </Card>
      ) : null}

      {/* Excluídos: fora das listas e dos números, mas à vista e recuperáveis. */}
      {deletedRows.length ? (
        <Card id="excluidos" className="scroll-mt-24">
          <details>
            <summary className="cursor-pointer p-5 text-sm font-semibold select-none">
              Excluídos ({deletedRows.length}){" "}
              <span className="font-normal text-muted-foreground">
                · fora das listas e dos números; dá para restaurar
              </span>
            </summary>
            <CardContent>
              <DeletedLeads rows={deletedRows} canRestore={canDelete} />
            </CardContent>
          </details>
        </Card>
      ) : null}

      {/* Auditoria é consulta, não leitura diária: fica recolhida. */}
      <Card id="historico" className="scroll-mt-24">
        <details>
          <summary className="cursor-pointer p-5 text-sm font-semibold select-none">
            Histórico de alterações{" "}
            <span className="font-normal text-muted-foreground">
              · quem criou, reenviou, mudou o status ou excluiu cada lead
            </span>
          </summary>
          <CardContent>
            <LeadActivity events={events} />
          </CardContent>
        </details>
      </Card>
    </div>
  );
}
