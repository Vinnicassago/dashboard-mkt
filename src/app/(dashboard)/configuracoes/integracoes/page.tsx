import { Plug } from "lucide-react";
import { ReenviarCapi, RoboToggle, SyncPanel } from "@/components/config/integracoes-forms";
import { StatusRow, estadoSimples } from "@/components/config/integracoes-status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isAiConfigured } from "@/lib/ai/config";
import { isAuthEnabled } from "@/lib/auth/config";
import { BRANDS } from "@/lib/brands";
import { estadoDaSincronizacao, estadoDoRobo, type EstadoExibido } from "@/lib/configuracoes";
import { roboDesativado } from "@/lib/integracoes";
import { integrationStatus, metaBrandConfig } from "@/lib/meta/config";
import { hojeEmBrasilia } from "@/lib/range";
import { getTransferidos, isRoboConfigured } from "@/lib/robo/client";
import { estadoDaFonte, type EstadoFonte } from "@/lib/sincronizacao";
import { DEFAULT_BRAND } from "@/lib/types";
import { VERSAO } from "@/lib/version";
import { getState, listCapiEnvios } from "@/lib/data/store";
import { STATE_KEYS } from "@/lib/data/backend";
import { capiEmModoTeste } from "@/lib/meta/capi";
import { estadoDaCapi, estadoDoCronCapi, resumoDosEnvios } from "@/lib/capi-politica";
import { contextoDeConfiguracoes } from "../_carregar";

// Estado das fontes e última sincronização refletem o banco agora, nunca o build.
export const dynamic = "force-dynamic";

/**
 * Configurações → Integrações e saúde (relatório §7.7 item 2): toda fonte com
 * um estado que diz o que fazer — "Ativo", "Desativado", "Falhando desde …" —,
 * a última sincronização que deu certo por fonte e por marca (ADR-04), e as
 * ações (sincronizar, ligar o robô). Mensagens humanas; o erro cru fica no log.
 */
export default async function IntegracoesPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await contextoDeConfiguracoes(searchParams);
  const status = integrationStatus();

  // Estado de cada fonte POR MARCA, do registro de sincronizações.
  const estadoIg = new Map<string, EstadoFonte>();
  for (const b of BRANDS) estadoIg.set(b.slug, await estadoDaFonte("instagram", b.slug));
  const estadoAds = await estadoDaFonte("ads", ctx.brand.slug);
  // Instagram das outras marcas: IG_USER_ID_<MARCA> e token reconhecidos pelo código em execução.
  const outrasMarcasIg = BRANDS.filter((b) => b.slug !== DEFAULT_BRAND).map((b) => {
    const m = metaBrandConfig(b.slug);
    return { slug: b.slug, label: b.label, configurada: Boolean(m.igUserId && m.igToken) };
  });

  // Robô: credencial + chave (D5) + uma leitura agora, para dizer "Falhando" com motivo.
  const roboConfigurado = isRoboConfigured();
  const roboOff = await roboDesativado();
  let roboErro: string | null = null;
  if (roboConfigurado && !roboOff) {
    try {
      const r = await getTransferidos(hojeEmBrasilia());
      if (r.falha?.tipo === "erro") roboErro = r.falha.detalhe;
    } catch (e) {
      roboErro = e instanceof Error ? e.message : String(e);
    }
    if (roboErro) console.error("[integracoes] leitura do robô falhou:", roboErro);
  }
  const robo = estadoDoRobo({ configurado: roboConfigurado, desativado: roboOff, erro: roboErro });

  // CAPI: o selo sai dos ENVIOS da última semana MAIS todo pendente de qualquer
  // idade (todas as marcas: o dataset é um só), lidos como estão AGORA.
  const agoraCapi = new Date();
  const desde = new Date(agoraCapi.getTime() - 7 * 86_400_000).toISOString();
  const enviosCapi = status.capi
    ? [
        ...(await listCapiEnvios({ desde, limit: 0 })),
        ...(await listCapiEnvios({ status: "pendente", limit: 0 })),
      ]
    : [];
  const resumoCapi = resumoDosEnvios(enviosCapi, agoraCapi.toISOString());
  const capi = estadoDaCapi({ configurada: status.capi, teste: capiEmModoTeste(), resumo: resumoCapi });
  const cronCapi = estadoDoCronCapi({
    capiConfigurada: status.capi,
    cronSecret: status.cronSecret,
    ultimaExecucao: await getState<string>(STATE_KEYS.capiUltimoReenvio),
    agora: agoraCapi.toISOString(),
  });

  const ingestKey = Boolean(process.env.TRACK_INGEST_KEY?.trim());
  const ia = isAiConfigured();
  const authEnabled = isAuthEnabled();

  const banco: EstadoExibido = ctx.banco.conectado
    ? { estado: "ativo", rotulo: ctx.banco.nome, detalhe: `${ctx.banco.nome} conectado — servindo os dados.` }
    : {
        estado: "nao-configurado",
        rotulo: "JSON local",
        detalhe: "Usando o arquivo JSON local (modo desenvolvimento). Defina DATABASE_URL para persistir de verdade.",
      };
  const rastreio: EstadoExibido = !status.lpTracking
    ? { estado: "nao-configurado", rotulo: "Não configurado", detalhe: "A landing page ainda não envia leads para /api/track." }
    : ingestKey
      ? { estado: "ativo", rotulo: "Protegido", detalhe: "TRACK_INGEST_KEY definido — só a LP com a chave consegue enviar leads." }
      : {
          estado: "nunca",
          rotulo: "Aberto",
          detalhe:
            "Sem TRACK_INGEST_KEY o endereço de envio aceita lead de QUALQUER origem: defina a chave no servidor (a mesma que está na LP).",
        };

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">
        Conecte as APIs da Meta para a coleta rodar sozinha, ou alimente o painel à mão pelo CSV em Importar.
      </p>

      <Card id="integracoes" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="size-4 text-primary" />
            Integrações e saúde dos dados
          </CardTitle>
          <CardDescription>
            As credenciais ficam só em variáveis de ambiente — nunca aparecem aqui nem no navegador. O selo
            diz o estado da fonte para a marca ativa; os números de uma fonte falhando param na última
            sincronização que deu certo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <StatusRow label="Banco de dados" estado={banco} />
            <StatusRow
              label={outrasMarcasIg.length ? `Instagram · ${BRANDS[0].label}` : "Instagram (orgânico)"}
              estado={estadoDaSincronizacao("Instagram", status.instagram, estadoIg.get(BRANDS[0].slug), "IG_USER_ID e IG_ACCESS_TOKEN")}
            />
            {outrasMarcasIg.map((b) => (
              <StatusRow
                key={b.slug}
                label={`Instagram · ${b.label}`}
                estado={estadoDaSincronizacao(
                  "Instagram",
                  b.configurada,
                  estadoIg.get(b.slug),
                  `IG_USER_ID_${b.slug.toUpperCase()} e IG_ACCESS_TOKEN_${b.slug.toUpperCase()} (confira o nome exato e reinicie o serviço)`,
                )}
              />
            ))}
            <StatusRow
              label="Tráfego pago (Marketing API)"
              estado={estadoDaSincronizacao("Meta", status.ads, estadoAds, "META_AD_ACCOUNT_ID e META_ADS_ACCESS_TOKEN")}
            />
            <StatusRow
              label="Coleta automática diária"
              estado={estadoSimples(
                status.cronSecret,
                "CRON_SECRET definido — /api/sync está protegido. Agende uma vez por dia (cron-job.org ou o vercel.json, 09:00 UTC): GET /api/sync?secret=CRON_SECRET&source=all.",
                "Defina CRON_SECRET para liberar o cron em produção; depois agende GET /api/sync?secret=… uma vez por dia.",
                "Chave definida",
              )}
            />
            <StatusRow label="Conversions API (CAPI)" estado={capi}>
              {status.capi && ctx.papeis.dados && resumoCapi.pendentes > 0 ? (
                <ReenviarCapi pendentes={resumoCapi.pendentes} />
              ) : null}
            </StatusRow>
            <StatusRow label="Reenvio da CAPI por cron" estado={cronCapi} />
            <StatusRow
              label="GA4 (Measurement Protocol)"
              estado={estadoSimples(
                status.ga4,
                "Eventos generate_lead (lead) e qualify_lead (reunião agendada) enviados ao GA4.",
                "Faltam GA4_MEASUREMENT_ID e GA4_API_SECRET.",
                "Conectado",
              )}
            />
            <StatusRow label="Rastreio da landing page" estado={rastreio} />
            {/* Robô e atendimento: escolha operacional, não só credencial (D5). */}
            <StatusRow label="Robô de WhatsApp e atendimento do especialista" estado={robo}>
              {roboConfigurado && ctx.papeis.dados ? <RoboToggle ativo={!roboOff} /> : null}
            </StatusRow>
            <StatusRow
              label="Análise por IA (Claude)"
              estado={estadoSimples(
                ia,
                "ANTHROPIC_API_KEY definido — resumo da semana e revisão de peças.",
                "Defina ANTHROPIC_API_KEY para o resumo da semana e a revisão de peças.",
                "Conectado",
              )}
            />
            <StatusRow
              label="Resumo da semana (IA) por cron"
              estado={estadoSimples(
                ia && status.cronSecret,
                "Agende no cron-job.org: segunda 08:00 (Brasília) → GET /api/resumo-semanal?secret=CRON_SECRET (≈ US$ 0,09 por execução).",
                "Precisa de ANTHROPIC_API_KEY e CRON_SECRET; depois agende GET /api/resumo-semanal?secret=… na segunda às 08:00.",
                "Pronto para agendar",
              )}
            />
            <StatusRow
              label="Acesso ao painel (login)"
              estado={estadoSimples(
                authEnabled,
                "AUTH_SECRET definido — o painel exige usuário e senha.",
                "Defina AUTH_SECRET para exigir login (o painel está aberto).",
              )}
            />
          </div>

          {ctx.papeis.dados ? (
            <div id="sync" className="scroll-mt-24">
              <SyncPanel />
            </div>
          ) : null}

          {!status.instagram && !status.ads ? (
            <p className="text-xs text-muted-foreground">
              Nenhuma API conectada ainda. O passo a passo (criar o app na Meta, obter os tokens e criar o
              projeto no Supabase) está no README e no arquivo <code className="font-mono">.env.example</code>.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* A versão é como se confere que o deploy pegou o código novo. */}
      <p className="text-xs text-muted-foreground">Versão do painel: {VERSAO}</p>
    </div>
  );
}
