import "server-only";
import { randomUUID } from "node:crypto";
import { addResumoSemanal, getData, listDrafts } from "../data/store";
import { brandDef, isAwareness } from "../brands";
import { buildCustomKey, hojeEmBrasilia } from "../range";
import { semanaAnteriorFechada } from "../semana";
import { dataQualityChecks, type DataWarning } from "../metrics";
import { estadoDaFonte } from "../sincronizacao";
import { estadoDoRoboAgora } from "../robo/estado";
import { leituraDoRoboParada } from "../robo/situacao";
import { formatarEspera } from "../format";
import { carregarBussola } from "../bussola-server";
import { isAiConfigured } from "./config";
import { buildBriefing } from "./briefing";
import { analyzeBriefing } from "./analyst";
import type { ResumoSemanal } from "../types";

/**
 * O resumo da semana (H7): a IA lê a semana FECHADA mais recente (segunda a
 * domingo anteriores) — a camada de métricas, a régua e o que o Início mostra
 * (cartões, leads chegando, o atendimento como está NA HORA da geração, o
 * último post) — e escreve a leitura. Uma linha por geração; o Início mostra a
 * última e guarda as 12 anteriores.
 *
 * Quem chama: o cron de segunda 08:00 (`/api/resumo-semanal`) ou o botão
 * "Gerar de novo" (ação, `data:write`). Nunca o render: cada chamada custa.
 */
export async function gerarResumoSemanal(
  brandSlug: string,
  origem: ResumoSemanal["origem"],
  opts: { hoje?: string } = {},
): Promise<ResumoSemanal> {
  if (!isAiConfigured()) throw new Error("IA desligada — falta ANTHROPIC_API_KEY.");
  const brand = brandDef(brandSlug);
  const hoje = opts.hoje ?? hojeEmBrasilia();
  const { semana, from, to } = semanaAnteriorFechada(hoje);
  const nowIso = new Date().toISOString();

  // A IA precisa saber se o dado está velho — na tela isso é o cabeçalho.
  const ads = await estadoDaFonte("ads", brand.slug);
  const horas = ads.ultimoOk ? (Date.parse(nowIso) - Date.parse(ads.ultimoOk)) / 3_600_000 : null;
  const avisosDeSync: DataWarning[] = [
    ...(ads.falha ? [{ level: "warn" as const, message: `A sincronização da Meta está falhando: ${ads.falha.erro}` }] : []),
    ...(horas != null && horas > 36
      ? [{ level: "warn" as const, message: `Anúncios sincronizados há ${Math.round(horas)}h — os números podem estar defasados.` }]
      : []),
  ];
  // O robô (só a marca dele, só ligado): o resgate e o atendimento leem a última leitura.
  const robo = await estadoDoRoboAgora(brand.slug, new Date(nowIso));
  if (robo.ligado && leituraDoRoboParada(robo, nowIso)) {
    const lidoHa = robo.sync.ultimoOk ? (Date.parse(nowIso) - Date.parse(robo.sync.ultimoOk)) / 3_600_000 : null;
    avisosDeSync.push({
      level: "warn",
      message: robo.sync.falha
        ? `A leitura do robô de WhatsApp está falhando: ${robo.sync.falha.erro} O resgate e o atendimento usam o último dado lido.`
        : lidoHa != null
          ? `O robô de WhatsApp foi lido há ${formatarEspera(lidoHa)} — o resgate e o atendimento podem estar defasados.`
          : "O painel ainda não leu o robô de WhatsApp — o resgate e o atendimento estão sem dado do robô.",
    });
  }
  const drafts = await listDrafts(brand.slug);

  let briefing;
  if (isAwareness(brand.slug)) {
    const data = await getData(brand.slug);
    briefing = buildBriefing(data, { from, to }, { nowIso, drafts, warnings: [...avisosDeSync, ...dataQualityChecks(data)] });
  } else {
    // O MESMO caminho da home: os kpis e os blocos que o Início mostra. A semana
    // fechada nunca abre o painel da live, mesmo que coincida com uma janela da régua.
    const b = await carregarBussola(brand.slug, buildCustomKey(from, to), { semModoLive: true });
    briefing = buildBriefing(b.data, b.range ?? { from, to }, {
      nowIso,
      drafts,
      warnings: [...avisosDeSync, ...dataQualityChecks(b.data)],
      kpis: b.kpis,
      inicio: b.inicio ?? undefined,
    });
  }

  const analise = await analyzeBriefing(briefing, brand.slug);
  const resumo: ResumoSemanal = {
    id: `RES-${randomUUID()}`,
    brand: brand.slug,
    semana,
    periodo: { de: from, ate: to },
    analise,
    origem,
    criadoEm: nowIso,
  };
  await addResumoSemanal(resumo);
  return resumo;
}
