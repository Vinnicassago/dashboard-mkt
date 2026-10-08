import { mensagemHumana } from "@/lib/erros";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import {
  DeletedLeads,
  LeadsDirectory,
  type DeletedLeadRow,
  type LeadDirectoryRow,
} from "@/components/leads/leads-directory";
import { LeadActivity } from "@/components/leads/lead-activity";
import { Revisar, type RevisarDados, type RevisarLead } from "@/components/leads/revisar";
import { ComercialTable } from "@/components/robo/comercial-table";
import { RolarParaAncora } from "@/components/ui/rolar-para-ancora";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getData, listDeletedLeads, listLeadEvents } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { everBooked } from "@/lib/metrics";
import { rotuladorDeOrigem } from "@/lib/origem";
import { getComercial } from "@/lib/robo/client";
import { can } from "@/lib/auth/guard";
import { formatarEspera } from "@/lib/format";
import { eventosPorLead, resumoContato } from "@/lib/contato";
import { paraRevisar } from "@/lib/identidade";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Minutos do robô → a mesma escrita de espera do resto do painel. */
const duracao = (min: number | null) => formatarEspera(min == null ? null : min / 60);

/**
 * Pessoas — quem é essa pessoa e o que já aconteceu com ela.
 *
 * Funde Leads (o cadastro do painel) e Atendimento Comercial (quem o robô passou
 * ao especialista). Saíram daqui as duas filas que as páginas antigas tinham —
 * "leads sem desfecho" e "esperando o primeiro contato" — porque a Fila de
 * contato já as junta, sem duplicata e na ordem de urgência. Duas listas de
 * espera com contagens diferentes era parte dos "dados desconexos".
 */
export default async function PessoasPage() {
  const brand = await activeBrandSlug();
  const data = await getData(brand);
  const canEdit = await can("leads:write");
  const canDelete = await can("leads:delete");
  const [todosEventos, comercial, excluidos] = await Promise.all([
    listLeadEvents({ brand, limit: 0 }),
    getComercial(),
    listDeletedLeads(brand),
  ]);
  // O histórico na tela mostra os 200 mais recentes; o resumo de contato usa todos.
  const events = todosEventos.slice(0, 200);
  const porLead = eventosPorLead(todosEventos);
  const deletedRows: DeletedLeadRow[] = excluidos.map((l) => ({
    id: l.id,
    name: l.name,
    deletedAt: l.deletedAt ?? "",
    deletedBy: l.deletedBy,
    deletedReason: l.deletedReason,
  }));
  const origem = rotuladorDeOrigem(data);

  const rows: LeadDirectoryRow[] = data.leads.map((l) => ({
    id: l.id,
    createdAt: l.createdAt,
    name: l.name,
    email: l.email,
    phone: l.phone,
    creativeName: origem(l.utmContent),
    status: l.status,
    jaAgendou: everBooked(l),
    meetingFor: l.meetingFor,
    ...(() => {
      const c = resumoContato(porLead.get(l.id) ?? []);
      return { tentativas: c.tentativas, diasComTentativa: c.diasComTentativa };
    })(),
  }));

  const { kpis } = comercial;

  const revisarLead = (l: Lead): RevisarLead => ({
    id: l.id,
    name: l.name,
    status: l.status,
    createdAt: l.createdAt,
    phone: l.phone,
    email: l.email,
    origem: origem(l.utmContent),
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
        <Link href="/fila" className="text-primary underline-offset-4 hover:underline">
          Fila de contato
        </Link>
        , na ordem de quem ligar primeiro.
      </p>

      {/* Leitura que falhou não vira "0 pessoas com o especialista": some com a
          lista e diz por quê. Os leads do painel abaixo não dependem do robô. */}
      {comercial.falha?.tipo === "erro" ? (
        <Card className="border-[var(--warning)]/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning-text)]" />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                Não consegui ler o atendimento do especialista.
              </span>{" "}
              A lista dele não aparece para não passar zeros por números reais; os leads do
              painel abaixo estão completos. {mensagemHumana("robô", comercial.falha.detalhe)}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {kpis ? (
        <Card id="especialista" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>Com o especialista ({comercial.rows.length})</CardTitle>
            <CardDescription>
              Cada pessoa que o robô qualificou e passou ao especialista. É aqui que se
              registram abordagem, reunião e decisão — e o que se marca aqui atualiza também o
              lead no painel. O primeiro contato vem em média{" "}
              {duracao(kpis.minutos_medios_ate_abordagem)} depois da transferência (pior caso:{" "}
              {duracao(kpis.pior_tempo_minutos)}).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ComercialTable rows={comercial.rows} canEdit={canEdit} />
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

      <Card id="leads" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Todos os leads ({rows.length})</CardTitle>
          <CardDescription>
            Todos os contatos gerados, com nome, telefone e e-mail. Clique no telefone para
            abrir o WhatsApp, ou exporte tudo em CSV para o time comercial.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeadsDirectory rows={rows} canEdit={canEdit} canDelete={canDelete} />
        </CardContent>
      </Card>

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
