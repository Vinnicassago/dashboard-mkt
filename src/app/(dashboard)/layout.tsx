import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { MobileNav, Sidebar } from "@/components/layout/sidebar";
import { SubNav } from "@/components/layout/sub-nav";
import { NAO_CLASSIFICADO, integrationStatus } from "@/lib/meta/config";
import { estadoDaFonte } from "@/lib/sincronizacao";
import { AlertasProvider } from "@/components/layout/alertas";
import type { Alerta } from "@/lib/alertas";
import { expirarCapiVencidos, getData, listCapiEnvios } from "@/lib/data/store";
import { JANELA_REENVIO_HORAS, alertasDaCapi, resumoDosEnvios } from "@/lib/capi-politica";
import { capiEmModoTeste } from "@/lib/meta/capi";
import { can } from "@/lib/auth/guard";
import { formatCurrency0, formatDateTime } from "@/lib/format";
import { frescorDaFonte, type Frescor } from "@/lib/frescor";
import { activeBrand } from "@/lib/active-brand";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isAuthEnabled } from "@/lib/auth/config";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getCurrentUser();
  // Auth on but no valid user (e.g. a deleted account with a still-signed
  // cookie) → send them to log in. Middleware handles the no-cookie case.
  if (isAuthEnabled() && !sessionUser) redirect("/login");

  const brand = await activeBrand();
  // Uma linha por fonte configurada, da MARCA ativa; o painel (leads) é ao vivo.
  const status = integrationStatus();
  const frescor: Frescor[] = [];
  const agora = new Date();
  // Alertas que valem em qualquer tela (os do período vêm de cada página).
  const globais: Alerta[] = [];
  const alertaDeFalha = (fonte: string, falha: { desde: string; erro: string }): Alerta => ({
    id: `sync-${fonte}`,
    nivel: "falha",
    titulo: `A sincronização ${fonte === "Meta" ? "da Meta" : "do Instagram"} está falhando`,
    detalhe: `Falhando desde ${formatDateTime(falha.desde)}: ${falha.erro} Os números dessa fonte param no último sync que deu certo.`,
    cta: { label: "Ver integrações", href: "/configuracoes/integracoes" },
  });
  if (status.ads) {
    const e = await estadoDaFonte("ads", brand.slug);
    frescor.push(frescorDaFonte("Meta", e.ultimoOk, agora, e.falha));
    if (e.falha) globais.push(alertaDeFalha("Meta", e.falha));
  }
  if (status.instagram) {
    const e = await estadoDaFonte("instagram", brand.slug);
    frescor.push(frescorDaFonte("Instagram", e.ultimoOk, agora, e.falha));
    if (e.falha) globais.push(alertaDeFalha("Instagram", e.falha));
  }

  // Gasto que nenhuma regra de marca reivindica: fora de TODOS os números.
  if (status.ads) {
    const corte = new Date(agora.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
    const semMarca = (await getData(NAO_CLASSIFICADO)).adDaily.filter((r) => r.date >= corte);
    const gasto = semMarca.reduce((s, r) => s + r.spend, 0);
    if (gasto > 0) {
      const campanhas = new Set(semMarca.map((r) => r.campaign)).size;
      globais.push({
        id: "marca-nao-classificada",
        nivel: "teto",
        titulo: `${formatCurrency0(gasto)} em ${campanhas} ${campanhas === 1 ? "campanha" : "campanhas"} sem marca (30 dias)`,
        detalhe:
          "Nenhuma regra de marca reivindica essas campanhas: o gasto delas está fora do investimento, do CPL e do custo por reunião de todas as marcas. Diga de quem são em Configurações → Marcas e reclassifique.",
        cta: { label: "Classificar as campanhas", href: "/configuracoes/marcas" },
      });
    }
  }

  // Rastreio aberto: qualquer um pode criar lead (e entrar no CPL).
  if (process.env.NODE_ENV === "production" && !process.env.TRACK_INGEST_KEY?.trim() && (await can("data:write"))) {
    globais.push({
      id: "track-sem-chave",
      nivel: "aviso",
      titulo: "O rastreio da landing page aceita envios de qualquer origem",
      detalhe:
        "Sem TRACK_INGEST_KEY, /api/track aceita lead de qualquer site — um lead falso entra nos números. Defina a chave no servidor e na LP.",
      cta: { label: "Ver integrações", href: "/configuracoes/integracoes" },
    });
  }

  // LGPD: o pendente que passou da janela fecha e perde o payload (IP, navegador)
  // mesmo sem cron, sem lead novo e com a CAPI desligada — basta alguém abrir o
  // painel. Barato (indexado) e idempotente.
  try {
    await expirarCapiVencidos({
      eventoAntesDe: new Date(agora.getTime() - JANELA_REENVIO_HORAS * 3_600_000).toISOString(),
      motivo: `Ficou na fila além da janela de ${JANELA_REENVIO_HORAS} h sem chegar à Meta.`,
      atualizadoEm: agora.toISOString(),
    });
  } catch (e) {
    console.warn("[layout] limpeza dos envios vencidos da CAPI falhou:", e instanceof Error ? e.message : e);
  }

  // CAPI: evento que não chegou à Meta (ou modo de teste em produção) — para quem cuida dos dados.
  if (status.capi && (await can("data:write"))) {
    const desde = new Date(agora.getTime() - 7 * 86_400_000).toISOString();
    // Os últimos 7 dias MAIS todo pendente de qualquer idade — o mesmo recorte de Integrações.
    const envios = [
      ...(await listCapiEnvios({ desde, limit: 0 })),
      ...(await listCapiEnvios({ status: "pendente", limit: 0 })),
    ];
    globais.push(
      ...alertasDaCapi({
        configurada: true,
        teste: capiEmModoTeste(),
        producao: process.env.NODE_ENV === "production",
        resumo: resumoDosEnvios(envios, agora.toISOString()),
      }),
    );
  }

  return (
    <AlertasProvider globais={globais}>
    <div className="flex min-h-screen">
      <Sidebar brand={brand} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav brand={brand} />
        <Header
          frescor={frescor}
          username={sessionUser?.username ?? null}
          brand={brand.slug}
          geradoEm={agora.toISOString()}
        />
        <main className="flex-1 p-4 md:p-6">
          <div className="mx-auto w-full max-w-[1600px]">
            <Suspense fallback={null}>
              <SubNav brand={brand} />
            </Suspense>
            {children}
          </div>
        </main>
      </div>
    </div>
    </AlertasProvider>
  );
}
