"use server";

import { revalidatePath } from "next/cache";
import {
  addLead,
  addLeadEvent,
  getData,
  getLead,
  getState,
  listDeletedLeads,
  listLeadEvents,
  replaceAdData,
  resetToSeed,
  setCampaignBudget,
  setLeadCreatedAt,
  setLeadStatus,
  setState,
  upsertAdDaily,
  upsertGoal,
  upsertIgAccountDaily,
  upsertIgPosts,
} from "@/lib/data/store";
import { STATE_KEYS } from "@/lib/data/backend";
import { parseAdsCsv } from "@/lib/csv";
import { parseLeadsCsv } from "@/lib/leads-csv";
import { resyncAdsHistory, runSync, type SyncSource } from "@/lib/meta/sync";
import { resolveMetaBrands, brandForCampaign } from "@/lib/meta/config";
import { BRANDS } from "@/lib/brands";
import { can } from "@/lib/auth/guard";
import { currentActor, newEventId } from "@/lib/auth/actor";
import { activeBrandSlug } from "@/lib/active-brand";
import { normalizeLeadStatus } from "@/lib/lead-status";
import { candidatosIdLead, resolverIdLead } from "@/lib/lead-id";
import { CONFIRMACAO_PERIGO } from "@/lib/perigo";
import { diagnosticarLeads, type DiagnosticoLeads } from "@/lib/diagnostico-leads";
import { registrarAuditoria } from "@/lib/auditoria";
import { setMensagemWhatsapp, setRoboDesativado } from "@/lib/integracoes";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_BRAND,
  type AdDaily,
  type Creative,
  type CtaType,
  type GoalMetric,
  type IgPost,
  type Lead,
} from "@/lib/types";

const DENIED: ActionState = { ok: false, message: "Você não tem permissão para esta ação." };

export interface ActionState {
  ok: boolean;
  message: string;
}

function num(formData: FormData, key: string): number {
  const v = Number(formData.get(key));
  return Number.isFinite(v) ? v : 0;
}

function revalidateAll() {
  revalidatePath("/", "layout");
}

export async function importAdsCsv(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Selecione um arquivo CSV." };
  }
  try {
    const text = await file.text();
    const { rows, skipped } = parseAdsCsv(text);
    // Separa por campanha (mesma regra do sync da API): o CSV do ad account
    // compartilhado traz campanhas das duas marcas.
    const brands = await resolveMetaBrands();
    await upsertAdDaily(rows.map((r) => ({ ...r, brand: brandForCampaign(r.campaign, undefined, brands) })));
    revalidateAll();
    const extra = skipped > 0 ? ` (${skipped} linha(s) ignorada(s))` : "";
    return { ok: true, message: `${rows.length} linha(s) importada(s) com sucesso${extra}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Falha ao importar o CSV." };
  }
}

export async function importLeadsCsv(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("leads:write"))) return DENIED;
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Selecione um arquivo CSV de leads." };
  }
  try {
    const text = await file.text();
    const { leads, eventIds, skipped, telefonesIlegiveis } = parseLeadsCsv(text);
    const brand = await activeBrandSlug();
    const actor = await currentActor();
    let novos = 0;
    for (const parsed of leads) {
      // Mesmo esquema do /api/track: reconhece o lead que já existe (inclusive no
      // formato de id antigo) e não confunde duas pessoas com o mesmo id.
      const eventId = eventIds.get(parsed.id);
      let id = parsed.id;
      if (eventId) {
        const existentes = new Map<string, Lead | null>();
        for (const cand of candidatosIdLead(eventId)) existentes.set(cand, await getLead(cand));
        id = resolverIdLead(
          eventId,
          parsed,
          (cand) => existentes.get(cand),
          () => randomUUID().slice(0, 8),
        ).id;
      }
      // Lead novo entra na marca ativa; lead que já existe mantém a marca, o
      // status e a entrada — reimportar só preenche contato vazio.
      const { created } = await addLead({ ...parsed, id, brand });
      if (!created) continue;
      novos++;
      await addLeadEvent({
        id: newEventId(),
        leadId: id,
        brand,
        leadName: parsed.name,
        actor,
        action: "created",
        toStatus: parsed.status,
        createdAt: parsed.createdAt,
      });
    }
    revalidateAll();
    const existentes = leads.length - novos;
    const extra =
      (skipped > 0 ? ` ${skipped} linha(s) ignorada(s).` : "") +
      (telefonesIlegiveis > 0
        ? ` ${telefonesIlegiveis} telefone(s) em notação científica (ex.: 5,51E+12) ficaram em branco — o Excel já tinha cortado os dígitos; corrija na planilha e reimporte.`
        : "");
    const jaHavia =
      existentes > 0
        ? ` ${existentes} já existia(m) e foram mantido(s) como estão — status muda pela Fila ou por Pessoas.`
        : "";
    return { ok: true, message: `${novos} lead(s) novo(s) importado(s).${jaHavia}${extra}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Falha ao importar os leads." };
  }
}

export async function addManualIgDay(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const date = String(formData.get("date") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: "Informe uma data válida." };
  }
  await upsertIgAccountDaily([
    {
      brand: await activeBrandSlug(),
      date,
      followers: num(formData, "followers"),
      reach: num(formData, "reach"),
      views: num(formData, "views"),
      profileLinkTaps: num(formData, "profileLinkTaps"),
      accountsEngaged: num(formData, "accountsEngaged"),
      totalInteractions: num(formData, "totalInteractions"),
      profileViews: num(formData, "profileViews"),
    },
  ]);
  revalidateAll();
  return { ok: true, message: `Snapshot de ${date} salvo.` };
}

/**
 * Registra as conversas de DM iniciadas num dia (métrica de negócio — a API do
 * Instagram não expõe DMs). Faz MERGE no snapshot existente do dia; sem
 * snapshot, orienta a criar um primeiro (uma linha só com DMs zeraria
 * seguidores/alcance do dia e sujaria as séries).
 */
export async function setDmConversationsAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const date = String(formData.get("date") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: "Informe uma data válida." };
  }
  const count = num(formData, "dmConversations");
  const brand = await activeBrandSlug();
  const data = await getData(brand);
  const row = data.igAccountDaily.find((r) => r.date === date);
  if (!row) {
    return {
      ok: false,
      message: `Sem snapshot do Instagram em ${date}. Registre o snapshot do dia (ou rode a sincronização) e tente de novo.`,
    };
  }
  await upsertIgAccountDaily([{ ...row, dmConversations: count }]);
  revalidateAll();
  return { ok: true, message: `${count} conversa(s) registrada(s) em ${date}.` };
}

/**
 * Registra a rotina diária de presença do guia (stories, comentários no nicho,
 * contas seguidas, "respondi tudo"). Nada disso vem da API — é o trabalho manual
 * de aquecer a base, e sem registro não há como cobrar aderência.
 *
 * Faz MERGE no snapshot do dia, como o registro de DMs: uma linha só com a
 * rotina zeraria seguidores/alcance e sujaria todas as séries.
 */
export async function setPresenceRoutineAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const date = String(formData.get("date") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: "Informe uma data válida." };
  }
  const brand = await activeBrandSlug();
  const data = await getData(brand);
  const row = data.igAccountDaily.find((r) => r.date === date);
  if (!row) {
    return {
      ok: false,
      message: `Sem snapshot do Instagram em ${date}. Registre o snapshot do dia (ou rode a sincronização) e tente de novo.`,
    };
  }
  // Campo em branco fica como estava; "0" é um registro legítimo de zero.
  const opt = (key: string) => {
    const raw = formData.get(key);
    if (raw == null || String(raw).trim() === "") return undefined;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? v : undefined;
  };
  await upsertIgAccountDaily([
    {
      ...row,
      storiesPosted: opt("storiesPosted") ?? row.storiesPosted,
      storiesInteractive: opt("storiesInteractive") ?? row.storiesInteractive,
      nicheComments: opt("nicheComments") ?? row.nicheComments,
      accountsFollowed: opt("accountsFollowed") ?? row.accountsFollowed,
      repliedAll: formData.get("repliedAll") === "on",
    },
  ]);
  revalidateAll();
  return { ok: true, message: `Rotina de ${date} registrada.` };
}

const CTA_VALUES: CtaType[] = ["dm", "comentario", "salvamento", "marcacao", "outro"];

/**
 * Salva os metadados manuais de conteúdo (duração do reel, pilar/série e CTA)
 * de todos os posts do formulário de uma vez. Só faz upsert dos que mudaram.
 */
export async function updatePostsMetaAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const brand = await activeBrandSlug();
  const data = await getData(brand);
  const changed: IgPost[] = [];
  for (const post of data.igPosts) {
    const durRaw = formData.get(`duration_${post.id}`);
    const pillarRaw = formData.get(`pillar_${post.id}`);
    const ctaRaw = formData.get(`cta_${post.id}`);
    const testRaw = formData.get(`test_${post.id}`);
    // Campos ausentes do form (post fora da lista) não tocam o post.
    if (durRaw == null && pillarRaw == null && ctaRaw == null && testRaw == null) continue;

    const durNum = Number(durRaw);
    const durationSec =
      durRaw != null && String(durRaw).trim() !== "" && Number.isFinite(durNum) && durNum > 0
        ? durNum
        : undefined;
    const pillar = pillarRaw != null ? String(pillarRaw).trim() || undefined : post.pillar;
    const ctaStr = ctaRaw != null ? String(ctaRaw).trim() : "";
    const ctaType =
      ctaRaw != null
        ? CTA_VALUES.includes(ctaStr as CtaType)
          ? (ctaStr as CtaType)
          : undefined
        : post.ctaType;

    const nextDuration = durRaw != null ? durationSec : post.durationSec;
    // "1" = teste; "" = não; ausente = mantém. Guardado como true|undefined.
    const isTest = testRaw != null ? (String(testRaw) === "1" ? true : undefined) : post.isTest;
    if (
      nextDuration !== post.durationSec ||
      pillar !== post.pillar ||
      ctaType !== post.ctaType ||
      isTest !== post.isTest
    ) {
      changed.push({ ...post, durationSec: nextDuration, pillar, ctaType, isTest });
    }
  }
  if (changed.length === 0) return { ok: true, message: "Nada para atualizar." };
  await upsertIgPosts(changed);
  revalidateAll();
  return { ok: true, message: `${changed.length} post(s) atualizado(s).` };
}

export async function addLeadAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("leads:write"))) return DENIED;
  const name = String(formData.get("name") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  const status = normalizeLeadStatus(String(formData.get("status") ?? ""));
  const utmContent = String(formData.get("utmContent") ?? "").trim() || undefined;
  // datetime-local chega sem fuso: é horário de Brasília (sem horário de verão desde 2019).
  const meetingRaw = String(formData.get("meetingFor") ?? "").trim();
  const meetingFor = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(meetingRaw)
    ? new Date(`${meetingRaw}:00-03:00`).toISOString()
    : undefined;
  const phone = String(formData.get("phone") ?? "").trim() || undefined;
  const email = String(formData.get("email") ?? "").trim() || undefined;
  const valueRaw = Number(formData.get("value"));
  const value = Number.isFinite(valueRaw) && valueRaw > 0 ? valueRaw : undefined;
  if (!name) return { ok: false, message: "Informe o nome do lead." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: "Informe a data do lead." };
  if (status === "agendado" && !meetingFor) {
    return { ok: false, message: "Lead agendado precisa da data e da hora da reunião." };
  }
  if (status === "desistencia") {
    return { ok: false, message: "Desistência é de quem chegou a agendar: cadastre como Agendado e registre a desistência depois." };
  }

  const leadId = `LEAD-M-${Date.now()}`;
  const brand = await activeBrandSlug();
  await addLead({
    id: leadId,
    brand,
    createdAt: `${date}T12:00:00`,
    name,
    email,
    phone,
    utmSource: "manual",
    utmContent,
    status,
    meetingFor,
    value,
  });
  await addLeadEvent({
    id: newEventId(),
    leadId,
    brand,
    leadName: name,
    actor: await currentActor(),
    action: "created",
    toStatus: status,
    createdAt: new Date().toISOString(),
  });
  revalidateAll();
  return { ok: true, message: `Lead "${name}" adicionado.` };
}

export async function setGoalsAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const brand = await activeBrandSlug();
  const specs: { metric: GoalMetric; lowerIsBetter?: boolean }[] = [
    { metric: "leads" },
    { metric: "meetings" },
    { metric: "cpl", lowerIsBetter: true },
    { metric: "cpr", lowerIsBetter: true },
    { metric: "followers" },
    // metas orgânicas do plano de 90 dias
    { metric: "retencao_reels" },
    { metric: "alcance_base" },
    { metric: "saves_1k" },
    { metric: "comentarios_post" },
    { metric: "compartilhamentos_post" },
    { metric: "posts_semana" },
    { metric: "conversas_dm" },
  ];
  for (const s of specs) {
    const raw = formData.get(`target_${s.metric}`);
    if (raw == null || String(raw).trim() === "") continue;
    const target = Number(raw);
    if (!Number.isFinite(target) || target <= 0) continue;
    await upsertGoal({ brand, metric: s.metric, period: "campanha", target, lowerIsBetter: s.lowerIsBetter });
  }
  revalidateAll();
  return { ok: true, message: "Metas atualizadas." };
}

/**
 * Orçamento da campanha. Existia a trava "orçamento não cadastrado" e o botão
 * "Cadastrar orçamento", mas nenhum campo que gravasse o valor — o painel pedia
 * uma coisa que não dava para fazer.
 */
export async function setBudgetAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const brand = await activeBrandSlug();

  const total = Number(formData.get("budgetTotal"));
  if (!Number.isFinite(total) || total <= 0) {
    return { ok: false, message: "Informe o orçamento total (maior que zero)." };
  }
  const diarioRaw = String(formData.get("dailyBudget") ?? "").trim();
  const diario = diarioRaw ? Number(diarioRaw) : undefined;
  if (diario !== undefined && (!Number.isFinite(diario) || diario <= 0)) {
    return { ok: false, message: "Budget diário inválido." };
  }
  const fim = String(formData.get("endDate") ?? "").trim() || undefined;
  if (fim && !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
    return { ok: false, message: "Data de fim inválida." };
  }

  try {
    await setCampaignBudget(brand, { budgetTotal: total, dailyBudget: diario, endDate: fim });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Não consegui salvar o orçamento." };
  }
  revalidateAll();
  return { ok: true, message: "Orçamento salvo." };
}

/**
 * Troca os dados de campanha pelo exemplo. Só administrador, com a palavra de
 * confirmação conferida AQUI (não só no navegador). O histórico dos leads e o
 * registro de auditoria sobrevivem.
 */
export async function resetSeedAction(confirmacao: string): Promise<ActionState> {
  if (!(await can("danger:run"))) {
    return { ok: false, message: "Só um administrador pode restaurar os dados de exemplo." };
  }
  if (confirmacao.trim().toUpperCase() !== CONFIRMACAO_PERIGO) {
    return { ok: false, message: `Nada foi apagado: digite ${CONFIRMACAO_PERIGO} para confirmar.` };
  }
  await resetToSeed();
  await registrarAuditoria("Restaurar dados de exemplo", "dados de campanha trocados pelo exemplo");
  revalidateAll();
  return { ok: true, message: "Dados de exemplo restaurados. O histórico dos leads foi preservado." };
}

/**
 * Conserta gasto dobrado (linhas de CSV somadas às da API): baixa da Meta TODO o
 * histórico guardado e só então troca, numa operação, as linhas desse período
 * pelas novas. Se a Meta não estiver configurada ou a busca falhar, nada é
 * apagado. Leads e o resto não são tocados.
 */
export async function resyncAdsCleanAction(): Promise<ActionState> {
  if (!(await can("danger:run"))) {
    return { ok: false, message: "Só um administrador pode ressincronizar o histórico de anúncios." };
  }
  try {
    const r = await resyncAdsHistory();
    if (!r.ok) return { ok: false, message: `Nada foi apagado. ${r.detail}` };
    await registrarAuditoria("Ressincronizar histórico de anúncios", r.detail);
    revalidateAll();
    return { ok: true, message: `Histórico de anúncios refeito a partir da Meta · ${r.detail}` };
  } catch (e) {
    return {
      ok: false,
      message: `Nada foi apagado. ${e instanceof Error ? e.message : "Falha ao ressincronizar."}`,
    };
  }
}

/**
 * Salva as regras de "quais campanhas são de cada marca" (por marca não-padrão),
 * guardadas no banco e usadas pelo sync/CSV/reclassificação. A marca padrão
 * (consorcio) é sempre a catch-all: recebe tudo que não casa com outra marca.
 */
export async function setBrandMatchAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const cur = (await getState<Record<string, string[]>>(STATE_KEYS.brandCampaignMatch)) ?? {};
  const next: Record<string, string[]> = { ...cur };
  for (const b of BRANDS) {
    if (b.slug === DEFAULT_BRAND) continue;
    const raw = formData.get(`match_${b.slug}`);
    if (raw == null) continue;
    next[b.slug] = String(raw).split(",").map((s) => s.trim()).filter(Boolean);
  }
  await setState(STATE_KEYS.brandCampaignMatch, next);
  revalidateAll();
  return {
    ok: true,
    message:
      'Regra de separação salva. Clique em "Reclassificar anúncios por marca" (ou "Zerar e ressincronizar") para aplicar aos dados já coletados.',
  };
}

/**
 * Re-etiqueta os anúncios JÁ armazenados pela campanha (mesma regra do sync), sem
 * precisar da API. Resolve dados antigos (coletados/importados antes de configurar
 * a separação) e limpa as linhas duplicadas que um "Sincronizar agora" deixa
 * quando um anúncio muda de marca (a marca faz parte da chave da linha).
 */
export async function reclassifyAdsAction(): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  try {
    const brands = await resolveMetaBrands();
    const ads: AdDaily[] = [];
    const creatives: Creative[] = [];
    for (const b of BRANDS) {
      const d = await getData(b.slug);
      ads.push(...d.adDaily);
      creatives.push(...d.creatives);
    }
    const retaggedAds = ads.map((r) => ({
      ...r,
      brand: brandForCampaign(r.campaign, undefined, brands),
    }));
    // O criativo não guarda a campanha — herda a marca do seu anúncio.
    const adBrand = new Map<string, string>();
    for (const r of retaggedAds) if (!adBrand.has(r.adId)) adBrand.set(r.adId, r.brand);
    const retaggedCreatives = creatives.map((c) => ({ ...c, brand: adBrand.get(c.adId) ?? c.brand }));

    // Troca tudo numa operação só: se falhar no meio, nada some.
    await replaceAdData(retaggedAds, retaggedCreatives);

    const dist: Record<string, number> = {};
    for (const r of retaggedAds) dist[r.brand] = (dist[r.brand] ?? 0) + 1;
    const summary = Object.entries(dist).map(([s, n]) => `${s}: ${n} linha(s)`).join(" · ");
    await registrarAuditoria("Reclassificar anúncios por marca", summary || "nenhuma linha");
    revalidateAll();
    return { ok: true, message: `Anúncios reclassificados por campanha — ${summary || "nenhuma linha"}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Falha ao reclassificar." };
  }
}

/** Run the Meta collection on demand (same code path as the daily cron). */
export async function syncNowAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  const raw = String(formData.get("source") ?? "all");
  const source: SyncSource =
    raw === "ads" || raw === "instagram" ? raw : "all";

  try {
    const report = await runSync({ source });
    const parts: string[] = [];
    if (report.ads) {
      parts.push(`Anúncios: ${report.ads.ok ? report.ads.detail : `erro — ${report.ads.detail}`}`);
    }
    if (report.instagram) {
      parts.push(
        `Instagram: ${report.instagram.ok ? report.instagram.detail : `erro — ${report.instagram.detail}`}`,
      );
    }
    if (report.token) parts.push(`Token: ${report.token}`);
    if (report.skipped.length) parts.push(`Ignorado: ${report.skipped.join(", ")}`);

    const ok =
      (report.ads?.ok ?? true) &&
      (report.instagram?.ok ?? true) &&
      Boolean(report.ads || report.instagram);

    revalidateAll();
    return {
      ok,
      message: parts.join(" · ") || "Nenhuma integração configurada ainda.",
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Falha na sincronização.",
    };
  }
}

// ---- diagnóstico dos leads (D8) -------------------------------------------

/** Todos os leads de todas as marcas, inclusive excluídos — base do diagnóstico. */
async function todosOsLeads(): Promise<Lead[]> {
  const out: Lead[] = [];
  for (const b of BRANDS) {
    out.push(...(await getData(b.slug)).leads, ...(await listDeletedLeads(b.slug)));
  }
  return out;
}

/** Lê o histórico inteiro e diz o que os reenvios da LP fizeram com os leads. Só leitura. */
export async function diagnosticoLeadsAction(): Promise<
  { ok: true; diagnostico: DiagnosticoLeads } | { ok: false; message: string }
> {
  if (!(await can("danger:run"))) {
    return { ok: false, message: "Só um administrador pode rodar o diagnóstico." };
  }
  const [leads, events] = await Promise.all([todosOsLeads(), listLeadEvents({ limit: 0 })]);
  return { ok: true, diagnostico: diagnosticarLeads(leads, events) };
}

/**
 * Aplica os reparos que o diagnóstico propôs para os ids escolhidos. Recalcula a
 * proposta aqui (nunca confia no que veio do navegador) e registra cada mudança
 * de status no histórico do lead.
 */
export async function repararLeadsAction(ids: string[]): Promise<ActionState> {
  if (!(await can("danger:run"))) {
    return { ok: false, message: "Só um administrador pode reparar leads." };
  }
  const [leads, events] = await Promise.all([todosOsLeads(), listLeadEvents({ limit: 0 })]);
  const { reparos } = diagnosticarLeads(leads, events);
  const escolhidos = reparos.filter((r) => ids.includes(r.leadId));
  if (escolhidos.length === 0) return { ok: false, message: "Nenhum reparo pendente para esses leads." };

  const actor = await currentActor();
  const byId = new Map(leads.map((l) => [l.id, l]));
  for (const r of escolhidos) {
    const lead = byId.get(r.leadId);
    if (!lead) continue;
    const status = r.statusProposto ?? lead.status;
    await setLeadStatus(r.leadId, status, {
      bookedAt: r.bookedAt,
      attendedAt: r.attendedAt,
      closedAt: r.closedAt,
      // Data da reunião no esquema antigo = momento em que foi marcada.
      meetingAt: !lead.meetingAt && (r.bookedAt ?? lead.bookedAt) ? (r.bookedAt ?? lead.bookedAt) : undefined,
      lostAt: r.lostAt,
    });
    if (r.entradaProposta) await setLeadCreatedAt(r.leadId, r.entradaProposta);
    if (r.statusProposto) {
      await addLeadEvent({
        id: newEventId(),
        leadId: r.leadId,
        brand: lead.brand,
        leadName: lead.name,
        actor,
        action: "status_changed",
        fromStatus: lead.status,
        toStatus: r.statusProposto,
        payload: { motivo: "restaurado do histórico (reenvio da LP tinha zerado o lead)" },
        createdAt: new Date().toISOString(),
      });
    }
  }
  await registrarAuditoria(
    "Reparar leads zerados por reenvio",
    `${escolhidos.length} lead(s): ${escolhidos.map((r) => r.leadId).join(", ")}`,
  );
  revalidateAll();
  return { ok: true, message: `${escolhidos.length} lead(s) reparado(s).` };
}

// ---- integrações operacionais (D5) ----------------------------------------

/**
 * Liga/desliga o robô de WhatsApp e o atendimento do especialista. Desligado,
 * as etapas dele somem do painel (sem "SEM LEITURA", sem "fila incompleta").
 */
export async function setRoboAtivoAction(ativo: boolean): Promise<ActionState> {
  if (!(await can("data:write"))) return DENIED;
  await setRoboDesativado(!ativo);
  await registrarAuditoria(ativo ? "Robô de WhatsApp ativado" : "Robô de WhatsApp desativado");
  revalidateAll();
  return {
    ok: true,
    message: ativo
      ? "Robô ativado: as etapas dele voltam para a cascata, a Fila e Pessoas."
      : "Robô desativado: as etapas dele saem do painel até você religar.",
  };
}

/** Mensagem que o botão de WhatsApp da Fila já deixa escrita. */
export async function setMensagemWhatsappAction(
  _prev: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  if (!(await can("leads:write")) && !(await can("data:write"))) return DENIED;
  const texto = String(formData.get("mensagem") ?? "").trim();
  if (texto.length > 600) return { ok: false, message: "Mensagem longa demais (máx. 600 caracteres)." };
  await setMensagemWhatsapp(texto);
  revalidateAll();
  return { ok: true, message: texto ? "Mensagem salva." : "Mensagem padrão restaurada." };
}
