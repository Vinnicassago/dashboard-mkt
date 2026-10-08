import "server-only";
import { randomUUID } from "node:crypto";
import { addResumoSemanal, getData, listDrafts } from "../data/store";
import { brandDef, isAwareness } from "../brands";
import { buildCustomKey, hojeEmBrasilia } from "../range";
import { semanaAnteriorFechada } from "../semana";
import { dataQualityChecks, type DataWarning } from "../metrics";
import { estadoDaFonte } from "../sincronizacao";
import { carregarBussola } from "../bussola-server";
import { resumoDasAcoes } from "../motor";
import { isAiConfigured } from "./config";
import { buildBriefing } from "./briefing";
import { analyzeBriefing } from "./analyst";
import type { ResumoSemanal } from "../types";

/**
 * O resumo da semana (H7): a IA lê a semana FECHADA mais recente (segunda a
 * domingo anteriores) — só a camada de métricas, a régua e as ações do motor —
 * e escreve a leitura. Uma linha por geração; a Bússola mostra a última e
 * guarda as 12 anteriores.
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
  const drafts = await listDrafts(brand.slug);

  let briefing;
  if (isAwareness(brand.slug)) {
    const data = await getData(brand.slug);
    briefing = buildBriefing(data, { from, to }, { nowIso, drafts, warnings: [...avisosDeSync, ...dataQualityChecks(data)] });
  } else {
    // O MESMO caminho da home: placar, gargalo e ações que a tela mostra.
    // Os estados (feita/ignorada) são os da semana RESUMIDA, não os da semana nova.
    const b = await carregarBussola(brand.slug, buildCustomKey(from, to), { semanaDosEstados: semana });
    briefing = buildBriefing(b.data, b.range ?? { from, to }, {
      nowIso,
      drafts,
      warnings: [...avisosDeSync, ...dataQualityChecks(b.data)],
      acoes: resumoDasAcoes(b.acoes),
      bussola: {
        veredito: `${b.placar.verbo} — ${b.placar.frase}`,
        gargalo: b.placar.gargalo
          ? `${b.placar.gargalo.rotulo} (${b.placar.gargalo.dono})${b.placar.gargalo.impactoTexto ? ` — ${b.placar.gargalo.impactoTexto}` : ""}`
          : undefined,
      },
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
