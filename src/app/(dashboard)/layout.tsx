import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { MobileNav, Sidebar } from "@/components/layout/sidebar";
import { SubNav } from "@/components/layout/sub-nav";
import { inicioDoComercial } from "@/components/layout/nav-items";
import type { AtalhoDoSeletor } from "@/components/layout/periodo-do-seletor";
import { atalhoDaLive, chavesDaLive } from "@/lib/atalho-live";
import { campanhaDaLive } from "@/lib/live-server";
import { hojeEmBrasilia } from "@/lib/range";
import { NAO_CLASSIFICADO, integrationStatus } from "@/lib/meta/config";
import { estadoDaFonte } from "@/lib/sincronizacao";
import { AlertasProvider } from "@/components/layout/alertas";
import { alertaDeClasse, alertaRoboSem1aMsg, type Alerta } from "@/lib/alertas";
import { expirarCapiVencidos, getData, listCapiEnvios, listLeadEvents, listLeads } from "@/lib/data/store";
import { leituraDoRoboParada, reabertosNoPainel, reabertosPorLead, semMensagemDoRobo } from "@/lib/robo/situacao";
import { JANELA_REENVIO_HORAS, alertasDaCapi, resumoDosEnvios } from "@/lib/capi-politica";
import { capiEmModoTeste } from "@/lib/meta/capi";
import { can } from "@/lib/auth/guard";
import { formatCurrency0, formatDateTime } from "@/lib/format";
import { LIMITES_DO_ROBO, frescorDaFonte, type Frescor } from "@/lib/frescor";
import { estadoDoRoboAgora } from "@/lib/robo/estado";
import { activeBrand } from "@/lib/active-brand";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isAuthEnabled } from "@/lib/auth/config";
import type { Lead } from "@/lib/types";

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
  // `chave` vai no id do alerta (ASCII, estável); `rotulo` é o texto ("da Meta", "do robô").
  const alertaDeFalha = (chave: string, rotulo: string, falha: { desde: string; erro: string }): Alerta => ({
    id: `sync-${chave}`,
    nivel: "falha",
    titulo: `A sincronização ${rotulo} está falhando`,
    detalhe: `Falhando desde ${formatDateTime(falha.desde)}: ${falha.erro} Os números dessa fonte param no último sync que deu certo.`,
    cta: { label: "Ver integrações", href: "/configuracoes/integracoes" },
  });
  if (status.ads) {
    const e = await estadoDaFonte("ads", brand.slug);
    frescor.push(frescorDaFonte("Meta", e.ultimoOk, agora, e.falha));
    if (e.falha) globais.push(alertaDeFalha("Meta", "da Meta", e.falha));
  }
  if (status.instagram) {
    const e = await estadoDaFonte("instagram", brand.slug);
    frescor.push(frescorDaFonte("Instagram", e.ultimoOk, agora, e.falha));
    if (e.falha) globais.push(alertaDeFalha("Instagram", "do Instagram", e.falha));
  }
  // Os leads da marca, lidos UMA vez para os alertas abaixo (robô e classe).
  let leadsDaMarca: Promise<Lead[]> | null = null;
  const leadsDoLayout = () => (leadsDaMarca ??= listLeads(brand.slug));

  // Robô de WhatsApp: só na marca dele e só ligado (desligado não é erro). Lido a
  // cada 15 min, então a régua é em minutos (velho > 45 min, muito velho > 3 h).
  try {
    const robo = await estadoDoRoboAgora(brand.slug, agora);
    if (robo.ligado) {
      frescor.push(frescorDaFonte("Robô", robo.sync.ultimoOk, agora, robo.sync.falha, LIMITES_DO_ROBO));
      if (robo.sync.falha) globais.push(alertaDeFalha("robo", "do robô", robo.sync.falha));
      // Gente sem a 1ª mensagem do robô — a MESMA contagem da frase do Início e de
      // Integrações (e da B1 do motor, dormente), e só com a leitura em dia (parada,
      // quem fala é o sync-robo).
      // Do histórico só os `reaberto` (o relógio recomeça ali): o layout roda a cada
      // navegação e não lê o histórico inteiro.
      const agoraIso = agora.toISOString();
      if (!leituraDoRoboParada(robo, agoraIso)) {
        const [leads, reabertos] = await Promise.all([
          leadsDoLayout(),
          listLeadEvents({ brand: brand.slug, action: "reaberto", limit: 0 }),
        ]);
        globais.push(
          ...alertaRoboSem1aMsg(
            semMensagemDoRobo(leads, reabertosPorLead(reabertos), robo, agoraIso, reabertosNoPainel(reabertos)),
          ),
        );
      }
    }
  } catch (e) {
    console.warn("[layout] leitura do estado do robô falhou:", e instanceof Error ? e.message : e);
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

  // Classe do n8n diferente da do painel (ficha da live): vale em qualquer tela.
  if (brand.type !== "awareness") {
    try {
      globais.push(...alertaDeClasse(await leadsDoLayout()));
    } catch (e) {
      console.warn("[layout] leitura das classes falhou:", e instanceof Error ? e.message : e);
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

  // O atalho "Live 01/12" do seletor de período (C10): a régua EDITÁVEL
  // (Configurações → Metas e orçamento), visível até o último dia dela e nunca na
  // marca awareness. A chave continua valendo depois (o seletor mostra o nome com
  // ela na URL); o Início do comercial abre o painel da live enquanto o botão existe.
  let atalhoLive: AtalhoDoSeletor | null = null;
  let chavesLive: string[] = [];
  if (brand.type !== "awareness") {
    try {
      const cfg = await campanhaDaLive();
      atalhoLive = atalhoDaLive(cfg, hojeEmBrasilia(agora), brand.type);
      chavesLive = Object.values(chavesDaLive(cfg));
    } catch (e) {
      console.warn("[layout] leitura da régua da live falhou:", e instanceof Error ? e.message : e);
    }
  }
  const hrefDoInicio = inicioDoComercial(sessionUser?.role, atalhoLive);

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
      <Sidebar brand={brand} hrefDoInicio={hrefDoInicio} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav brand={brand} hrefDoInicio={hrefDoInicio} />
        <Header
          frescor={frescor}
          username={sessionUser?.username ?? null}
          brand={brand.slug}
          geradoEm={agora.toISOString()}
          atalhoLive={atalhoLive}
          chavesDaLive={chavesLive}
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
