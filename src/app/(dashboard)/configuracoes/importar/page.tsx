import Link from "next/link";
import { FileSpreadsheet, UserPlus, UsersRound } from "lucide-react";
import { ImportForm, LeadForm, LeadsImportForm } from "@/components/config/importar-forms";
import { SemPermissao } from "@/components/config/sem-permissao";
import { RolarParaAncora } from "@/components/ui/rolar-para-ancora";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ADS_CSV_TEMPLATE } from "@/lib/csv";
import { getData } from "@/lib/data/store";
import { LEAD_STATUSES, statusLabel } from "@/lib/lead-status";
import { LEADS_CSV_TEMPLATE } from "@/lib/leads-csv";
import { comPeriodo } from "@/lib/range";
import { contextoDeConfiguracoes } from "../_carregar";

export const dynamic = "force-dynamic";

/**
 * Configurações → Importar dados (relatório §7.7 item 5): leads por CSV (telefone
 * como texto; validação e prévia com erros ANTES de importar), anúncios por CSV
 * e lead à mão. Reimportar nunca move um lead de marca nem mexe em status (S6).
 */
export default async function ImportarPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await contextoDeConfiguracoes(searchParams);
  const podeAlgo = ctx.papeis.leads || ctx.papeis.dados;
  const creatives = ctx.papeis.leads
    ? (await getData(ctx.brand.slug)).creatives.map((c) => ({ adId: c.adId, name: c.name }))
    : [];
  // Vocabulário aceito na coluna Status do CSV — sai da régua, para a ajuda
  // nunca divergir do que o importador realmente reconhece.
  const statusList = LEAD_STATUSES.map(statusLabel).join(", ");

  return (
    <div className="max-w-3xl space-y-6">
      <RolarParaAncora />
      <p className="text-sm text-muted-foreground">
        O que entra à mão. Registros manuais do Instagram (snapshot, DMs, rotina de presença, marcação de
        posts) ficam em{" "}
        <Link href={comPeriodo("/conteudo/registros", ctx.rangeKey)} className="font-medium text-primary underline-offset-4 hover:underline">
          Conteúdo → Registros
        </Link>
        .
      </p>

      {!podeAlgo ? <SemPermissao quem="Administrador, Comercial e Marketing" oque="importam dados" /> : null}

      {ctx.papeis.leads ? (
        <Card id="importar-leads" className="scroll-mt-24">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UsersRound className="size-4 text-primary" />
              Importar leads (CSV / planilha)
            </CardTitle>
            <CardDescription>
              Backfill dos leads que a landing page registrou antes do rastreio estar ligado. Exporte a
              planilha como CSV (UTF-8) e escolha o arquivo: a prévia mostra o que entra e o que é ignorado,
              linha a linha, antes de importar. Os leads são reconhecidos pelo{" "}
              <code className="font-mono">event_id</code> — reimportar não duplica, não move de marca e não
              mexe em status: só preenche contato em branco.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <LeadsImportForm template={LEADS_CSV_TEMPLATE} />
            <p className="text-xs text-muted-foreground">
              Colunas reconhecidas: created_at, event_id, Status, nome, whatsapp, email, utm_source,
              utm_campaign, utm_content, fbp, fbc. O telefone é lido como texto — se a planilha o salvou como
              número (5,51E+12), os dígitos já se perderam e ele fica em branco. Status vazio entra como
              &quot;Novo&quot;.
            </p>
            <p className="text-xs text-muted-foreground">
              Na coluna Status vale o nome do estágio — {statusList} — ou como o comercial costuma escrever:
              &quot;não atende&quot;, &quot;sem retorno&quot;, &quot;não quis&quot;, &quot;desistiu&quot;,
              &quot;faltou&quot;, &quot;fechado&quot;. O que não for reconhecido entra como &quot;Novo&quot;.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {ctx.papeis.dados ? (
        <Card id="importar-anuncios" className="scroll-mt-24">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="size-4 text-primary" />
              Importar anúncios (CSV do Ads Manager)
            </CardTitle>
            <CardDescription>
              Exporte o relatório em CSV e envie aqui. As linhas são mescladas por data + anúncio (reimportar
              atualiza os valores) e separadas por marca pela regra de campanha.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ImportForm template={ADS_CSV_TEMPLATE} />
            <p className="text-xs text-muted-foreground">
              Colunas reconhecidas (PT ou EN): Dia, Nome/ID do anúncio, Conjunto, Campanha, Valor gasto,
              Impressões, Alcance, Cliques no link, Leads. Baixe o modelo para ver o formato exato.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {ctx.papeis.leads ? (
        <Card id="adicionar-lead" className="scroll-mt-24">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="size-4 text-primary" />
              Adicionar lead / reunião
            </CardTitle>
            <CardDescription>
              Cadastre um lead e marque quando ele agenda ou comparece — é assim que o funil calcula reuniões
              e o custo por reunião.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LeadForm creatives={creatives} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
