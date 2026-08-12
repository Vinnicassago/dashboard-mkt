import { Camera, Clapperboard, Database, FileSpreadsheet, Layers, MessageCircle, Plug, Target, UserPlus, Users, UsersRound } from "lucide-react";
import {
  BrandMatchForm,
  DmForm,
  GoalsForm,
  ImportForm,
  LeadForm,
  LeadsImportForm,
  ManualIgForm,
  PostsMetaForm,
  ReclassifyAdsButton,
  ResetButton,
  SyncPanel,
  type PostMetaRow,
} from "@/components/config/config-forms";
import { UsersManager } from "@/components/config/users-manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { activeBackend, getData, getState, listUsers } from "@/lib/data/store";
import { STATE_KEYS } from "@/lib/data/backend";
import { activeBrandSlug } from "@/lib/active-brand";
import { BRANDS } from "@/lib/brands";
import { DEFAULT_BRAND } from "@/lib/types";
import { ADS_CSV_TEMPLATE } from "@/lib/csv";
import { LEADS_CSV_TEMPLATE } from "@/lib/leads-csv";
import { integrationStatus, metaBrandConfig } from "@/lib/meta/config";
import { getLastSync } from "@/lib/meta/sync";
import { isAuthEnabled } from "@/lib/auth/config";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/guard";
import { formatCurrency0, formatDateShort, formatDateTime } from "@/lib/format";
import { CTA_LABEL, detectCta } from "@/lib/metrics";

// Integration status and last-sync times must reflect runtime, never build time.
export const dynamic = "force-dynamic";

function StatusRow({
  label,
  ok,
  hint,
}: {
  label: string;
  ok: boolean;
  hint: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Badge variant={ok ? "good" : "muted"}>{ok ? "Conectado" : "Não configurado"}</Badge>
    </div>
  );
}

export default async function ConfigPage() {
  const data = await getData(await activeBrandSlug());
  const status = integrationStatus();
  const lastSync = await getLastSync();
  const backend = activeBackend();
  const dbConnected = backend !== "local";
  const dbLabel = backend === "postgres" ? "Postgres" : backend === "supabase" ? "Supabase" : "JSON local";
  const users = await listUsers();
  const sessionUser = await getCurrentUser();
  const currentUser = sessionUser?.username ?? null;
  const authEnabled = isAuthEnabled();
  const isAdmin = await can("users:manage");
  const canData = await can("data:write");
  const canLeads = await can("leads:write");

  const creatives = data.creatives.map((c) => ({ adId: c.adId, name: c.name }));
  const currentGoals: Record<string, number> = {};
  for (const g of data.goals) currentGoals[g.metric] = g.target;

  // Metadados manuais de conteúdo: duração de reel, pilar e CTA por post.
  const TYPE_LABEL: Record<string, string> = { feed: "Feed", carrossel: "Carrossel", reel: "Reel", story: "Story" };
  const postMeta: PostMetaRow[] = [...data.igPosts]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .map((p) => {
      // Sempre a heurística pura: o rótulo "Auto (…)" mostra o que valeria ao
      // voltar para Auto, mesmo com override manual ativo.
      const detected = detectCta(p.caption);
      return {
        id: p.id,
        dateLabel: formatDateShort(p.publishedAt),
        type: TYPE_LABEL[p.type] ?? p.type,
        caption: p.caption,
        durationSec: p.durationSec,
        pillar: p.pillar,
        ctaType: p.ctaType,
        detectedCta: detected ? CTA_LABEL[detected] : undefined,
        isTest: p.isTest,
      };
    });

  // Separação por marca: gasto + campanhas atribuídas a cada marca + regra atual.
  const multiBrand = BRANDS.length > 1;
  const brandSpend = multiBrand
    ? await Promise.all(
        BRANDS.map(async (b) => {
          const d = await getData(b.slug);
          const byCamp = new Map<string, number>();
          for (const r of d.adDaily) {
            const name = r.campaign || "(sem nome)";
            byCamp.set(name, (byCamp.get(name) ?? 0) + r.spend);
          }
          const campaigns = [...byCamp.entries()]
            .map(([name, spend]) => ({ name, spend }))
            .sort((a, b) => b.spend - a.spend);
          return {
            slug: b.slug,
            label: b.label,
            spend: campaigns.reduce((s, c) => s + c.spend, 0),
            campaigns,
          };
        }),
      )
    : [];
  const matchState = (await getState<Record<string, string[]>>(STATE_KEYS.brandCampaignMatch)) ?? {};
  const currentMatch: Record<string, string> = {};
  for (const [slug, list] of Object.entries(matchState)) currentMatch[slug] = (list ?? []).join(", ");

  // Status do Instagram POR MARCA — mostra se IG_USER_ID_<MARCA>/token foram
  // reconhecidos pelo código em execução (diagnóstico da conexão da krone).
  const brandIg = BRANDS.filter((b) => b.slug !== DEFAULT_BRAND).map((b) => {
    const m = metaBrandConfig(b.slug);
    return { slug: b.slug, label: b.label, configured: Boolean(m.igUserId && m.igToken) };
  });

  const syncHint = (iso: string | null) =>
    iso ? `Última sincronização: ${formatDateTime(iso)}` : "Ainda não sincronizado";

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">
        Conecte as APIs da Meta para a coleta rodar sozinha, ou alimente o
        dashboard à mão com o CSV do Ads Manager enquanto isso.
      </p>

      {/* Integrações */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="size-4 text-primary" />
            Integrações
          </CardTitle>
          <CardDescription>
            As credenciais ficam só em variáveis de ambiente — nunca aparecem aqui
            nem no navegador.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <StatusRow
              label="Banco de dados"
              ok={dbConnected}
              hint={
                dbConnected
                  ? `${dbLabel} conectado — servindo os dados`
                  : "Usando o arquivo JSON local (modo desenvolvimento)"
              }
            />
            <StatusRow
              label={brandIg.length ? `Instagram · ${BRANDS[0].label}` : "Instagram (orgânico)"}
              ok={status.instagram}
              hint={status.instagram ? syncHint(lastSync.instagram) : "Faltam IG_USER_ID e IG_ACCESS_TOKEN"}
            />
            {brandIg.map((b) => (
              <StatusRow
                key={b.slug}
                label={`Instagram · ${b.label}`}
                ok={b.configured}
                hint={
                  b.configured
                    ? `IG_USER_ID_${b.slug.toUpperCase()} e token reconhecidos${lastSync.instagram ? ` · última sync: ${formatDateTime(lastSync.instagram)}` : ""}`
                    : `Faltam IG_USER_ID_${b.slug.toUpperCase()} e IG_ACCESS_TOKEN_${b.slug.toUpperCase()} (confira o nome exato e reinicie o serviço)`
                }
              />
            ))}
            <StatusRow
              label="Tráfego pago (Marketing API)"
              ok={status.ads}
              hint={status.ads ? syncHint(lastSync.ads) : "Faltam META_AD_ACCOUNT_ID e META_ADS_ACCESS_TOKEN"}
            />
            <StatusRow
              label="Coleta automática diária"
              ok={status.cronSecret}
              hint={
                status.cronSecret
                  ? "CRON_SECRET definido — /api/sync protegido e agendado"
                  : "Defina CRON_SECRET para liberar o cron em produção"
              }
            />
            <StatusRow
              label="Conversions API (CAPI)"
              ok={status.capi}
              hint={
                status.capi
                  ? "Lead e Schedule enviados pelo servidor, deduplicados com o Pixel"
                  : "Faltam META_DATASET_ID e META_CAPI_TOKEN"
              }
            />
            <StatusRow
              label="GA4 (Measurement Protocol)"
              ok={status.ga4}
              hint={
                status.ga4
                  ? "Eventos generate_lead e schedule enviados ao GA4"
                  : "Faltam GA4_MEASUREMENT_ID e GA4_API_SECRET"
              }
            />
            <StatusRow
              label="Rastreio da landing page"
              ok={status.lpTracking}
              hint={
                status.lpTracking
                  ? "TRACK_INGEST_KEY definido — instale lp-tracking.js na LP"
                  : "Defina TRACK_INGEST_KEY e instale public/lp-tracking.js na LP"
              }
            />
            <StatusRow
              label="Acesso ao painel (login)"
              ok={authEnabled}
              hint={
                authEnabled
                  ? "AUTH_SECRET definido — o painel exige usuário e senha"
                  : "Defina AUTH_SECRET para exigir login (o painel está aberto)"
              }
            />
          </div>

          {canData ? <SyncPanel /> : null}

          {!status.instagram && !status.ads ? (
            <p className="text-xs text-muted-foreground">
              Nenhuma API conectada ainda. O passo a passo (criar o app na Meta,
              obter os tokens e criar o projeto no Supabase) está no README e no
              arquivo <code className="font-mono">.env.example</code>.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Usuários — só administrador */}
      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-4 text-primary" />
              Usuários do painel
            </CardTitle>
            <CardDescription>
              Quem pode acessar e o papel de cada um. Senhas guardadas com hash
              (scrypt). Só <strong>Comercial</strong> e <strong>Administrador</strong>{" "}
              alteram leads; <strong>Marketing</strong> opera dados de marketing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UsersManager users={users} currentUser={currentUser} authEnabled={authEnabled} />
          </CardContent>
        </Card>
      ) : null}

      {/* Manual lead — admin/comercial */}
      {canLeads ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="size-4 text-primary" />
              Adicionar lead / reunião
            </CardTitle>
            <CardDescription>
              Cadastre um lead e marque quando ele agenda ou comparece — é assim que o
              funil calcula reuniões e o custo por reunião.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LeadForm creatives={creatives} />
          </CardContent>
        </Card>
      ) : null}

      {/* Importar leads (CSV do rastreamento da LP) — admin/comercial */}
      {canLeads ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UsersRound className="size-4 text-primary" />
              Importar leads (CSV / planilha)
            </CardTitle>
            <CardDescription>
              Backfill dos leads que a landing page registrou antes do rastreio estar
              ligado. Exporte a planilha como CSV (UTF-8) e envie. Os leads são
              mesclados pelo <code className="font-mono">event_id</code> — reimportar
              atualiza, não duplica, e um lead já capturado ao vivo vira a mesma linha.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <LeadsImportForm template={LEADS_CSV_TEMPLATE} />
            <p className="text-xs text-muted-foreground">
              Colunas reconhecidas: created_at, event_id, Status, nome, whatsapp,
              email, utm_source, utm_campaign, utm_content, fbp, fbc. Status vazio
              entra como &quot;lead&quot;.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Dados de marketing — admin/marketing */}
      {canData ? (
        <>
          {multiBrand ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Layers className="size-4 text-primary" />
                  Separação de marcas (tráfego pago)
                </CardTitle>
                <CardDescription>
                  Como as marcas dividem o mesmo ad account, o gasto é separado pela
                  campanha. Defina como reconhecer as campanhas de cada marca e
                  reclassifique os anúncios já coletados.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {brandSpend.map((b) => (
                    <div key={b.slug} className="rounded-lg border p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-medium">{b.label}</p>
                        <p className="tabular text-lg font-semibold">{formatCurrency0(b.spend)}</p>
                      </div>
                      <p className="text-xs text-muted-foreground">gasto atribuído · campanhas:</p>
                      <ul className="mt-1.5 space-y-1">
                        {b.campaigns.length === 0 ? (
                          <li className="text-xs text-muted-foreground">nenhuma campanha</li>
                        ) : (
                          b.campaigns.map((c) => (
                            <li key={c.name} className="flex items-baseline justify-between gap-2 text-xs">
                              <span className="truncate text-muted-foreground" title={c.name}>{c.name}</span>
                              <span className="tabular shrink-0 text-muted-foreground">{formatCurrency0(c.spend)}</span>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Confira acima se cada campanha está na marca certa. Uma campanha na marca
                  errada? Ajuste a regra abaixo (ou renomeie a campanha no Ads Manager) e clique
                  em Reclassificar.
                </p>
                <BrandMatchForm current={currentMatch} />
                <ReclassifyAdsButton />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="size-4 text-primary" />
                Importar anúncios (CSV do Ads Manager)
              </CardTitle>
              <CardDescription>
                Exporte o relatório em CSV e envie aqui. As linhas são mescladas por
                data + anúncio (reimportar atualiza os valores).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ImportForm template={ADS_CSV_TEMPLATE} />
              <p className="text-xs text-muted-foreground">
                Colunas reconhecidas (PT ou EN): Dia, Nome/ID do anúncio, Conjunto,
                Campanha, Valor gasto, Impressões, Alcance, Cliques no link, Leads.
                Baixe o modelo para ver o formato exato.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="size-4 text-primary" />
                Snapshot diário do Instagram
              </CardTitle>
              <CardDescription>
                Registre os números do dia (Instagram Insights). Guardar snapshots é o
                que constrói o histórico de crescimento — a API só retém ~90 dias.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ManualIgForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="size-4 text-primary" />
                Conversas de DM
              </CardTitle>
              <CardDescription>
                A métrica de negócio do perfil — a API do Instagram não expõe DMs, então o
                registro é manual. Anote as conversas iniciadas por dia (ou a soma da semana
                num dia só); o painel agrega por semana.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DmForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clapperboard className="size-4 text-primary" />
                Conteúdo dos posts
              </CardTitle>
              <CardDescription>
                A duração do reel habilita a retenção % real (a API não a fornece); pilar/série e
                CTA alimentam a comparação por categoria e os alertas (ex.: DM em excesso).
                O CTA em &quot;Auto&quot; é detectado pela legenda. Marque{" "}
                <strong>Teste? = Sim</strong> nos reels de validação de formato/gancho — eles
                ganham selo e ficam FORA de toda a análise orgânica.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PostsMetaForm posts={postMeta} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="size-4 text-primary" />
                Metas
              </CardTitle>
              <CardDescription>
                Usadas no bloco "Metas vs. realizado" da Visão Geral. As metas orgânicas seguem o
                plano de 90 dias do diagnóstico (retenção 40%, salvos/1k 8+, 4 posts/semana…).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GoalsForm current={currentGoals} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="size-4 text-primary" />
                Dados
              </CardTitle>
              <CardDescription>
                Backend ativo: <strong>{dbLabel}</strong>.
                {dbConnected
                  ? " Restaurar o exemplo apaga os dados do banco."
                  : " Defina DATABASE_URL (Postgres) para persistir os dados de verdade."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResetButton destructive={dbConnected} />
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
