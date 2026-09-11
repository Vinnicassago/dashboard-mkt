import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { LeadsDirectory, type LeadDirectoryRow } from "@/components/leads/leads-directory";
import { LeadActivity } from "@/components/leads/lead-activity";
import { ComercialTable } from "@/components/robo/comercial-table";
import { RolarParaAncora } from "@/components/ui/rolar-para-ancora";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getData, listLeadEvents } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { adIdFromUtmContent, creativePerformance, rotuloCriativo } from "@/lib/metrics";
import { getComercial } from "@/lib/robo/client";
import { can } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/** Nome do criativo a partir do utm_content ("nome|adid"): resolve pelo id do
 *  anúncio, senão mostra a parte de nome (antes do "|"). */
function originLabel(utmContent: string | undefined, nameById: Map<string, string>): string {
  if (!utmContent) return "—";
  const id = adIdFromUtmContent(utmContent);
  return (id ? nameById.get(id) : nameById.get(utmContent)) ?? utmContent.split("|")[0];
}

/** 135 → "2 h 15 min"; acima de um dia mostra "2 d 3 h". */
function duracao(min: number | null): string {
  if (min == null) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) {
    const m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(h / 24);
  const hr = h % 24;
  return hr ? `${d} d ${hr} h` : `${d} d`;
}

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
  const data = await getData(await activeBrandSlug());
  const canEdit = await can("leads:write");
  const [events, comercial] = await Promise.all([listLeadEvents({ limit: 200 }), getComercial()]);
  // O mesmo nome pode estar em dois anúncios ("Carrossel -"): a origem usa o
  // rótulo com o conjunto quando o nome se repete, como as ações e o Dinheiro.
  const perf = creativePerformance(data);
  const nameById = new Map<string, string>(data.creatives.map((c) => [c.adId, c.name]));
  for (const c of perf) nameById.set(c.adId, rotuloCriativo(c, perf));

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

  const { kpis } = comercial;

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
              painel abaixo estão completos. Detalhe: {comercial.falha.detalhe}
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

      <Card id="leads" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Todos os leads ({rows.length})</CardTitle>
          <CardDescription>
            Todos os contatos gerados, com nome, telefone e e-mail. Clique no telefone para
            abrir o WhatsApp, ou exporte tudo em CSV para o time comercial.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeadsDirectory rows={rows} canEdit={canEdit} />
        </CardContent>
      </Card>

      {/* Auditoria é consulta, não leitura diária: fica recolhida. */}
      <Card id="historico" className="scroll-mt-24">
        <details>
          <summary className="cursor-pointer p-5 text-sm font-semibold select-none">
            Histórico de alterações{" "}
            <span className="font-normal text-muted-foreground">
              · quem criou e quem mudou o status de cada lead
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
