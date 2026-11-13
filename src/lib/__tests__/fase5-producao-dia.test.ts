/**
 * Fase 5 de nov/26 (revisão final, F5-D25/C9) — a Produção conta o post no dia de
 * Brasília também no SERVIDOR. A página monta a prévia do validador com `diaDoPost`;
 * `saveDraftAction`/`setDraftStatusAction` recalculam a nota com `contextFor`. Se o
 * servidor usasse o prefixo UTC (`dayOf`), um reel das 22h de 10/11 (01:00Z de 11/11)
 * ocuparia 11/11 no servidor e 10/11 na prévia: a peça de 11/11 sairia "pronta" na tela
 * e com o bloqueio "Única peça do dia" gravado (e a aprovação recusada).
 *
 * O store, a sessão, a marca, o cache do Next e a IA são dublês; nada é gravado de verdade.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveDraftAction } from "@/app/(dashboard)/conteudo/producao/actions";
import { buildValidationContext, validateDraft } from "../content/validator";
import { ctaOf, diaDoPost } from "../metrics";
import type { DashboardData, PostDraft } from "../types";
import { base } from "@/test/fixtures-robo";
import { peca, post } from "@/test/fixtures-conteudo";

const h = vi.hoisted(() => ({ data: null as unknown }));
const getData = vi.hoisted(() => vi.fn(async () => h.data));
const listDrafts = vi.hoisted(() => vi.fn(async () => [] as PostDraft[]));
const getDraft = vi.hoisted(() => vi.fn(async () => null));
const upsertDraft = vi.hoisted(() => vi.fn<(d: PostDraft) => Promise<void>>(async () => {}));

vi.mock("@/lib/data/store", () => ({ getData, listDrafts, getDraft, upsertDraft, deleteDraft: vi.fn() }));
vi.mock("@/lib/auth/guard", () => ({ can: async () => true }));
vi.mock("@/lib/active-brand", () => ({ activeBrandSlug: async () => "consorcio" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: () => false }));
vi.mock("@/lib/ai/client", () => ({ aiErrorMessage: () => "erro" }));
vi.mock("@/lib/ai/review-draft", () => ({ reviewDraft: vi.fn() }));

/** O reel publicado às 22h de 10/11 em Brasília (01:00Z de 11/11). */
const REEL_DA_NOITE = post("IG-REEL-22H", "2026-11-10", "22:00", "reel", "Simulação da semana: carta de 250 mil\nSalve para consultar depois.");

const dados = (): DashboardData => base({ igPosts: [REEL_DA_NOITE] });

/** A prévia que a PÁGINA da Produção monta no cliente (`producao/page.tsx` → `ProducaoBoard`). */
function previaDaPagina(d: DashboardData, draft: PostDraft) {
  const published = d.igPosts
    .filter((p) => !p.isTest)
    .map((p) => ({ day: diaDoPost(p), cta: ctaOf(p) }))
    .sort((a, b) => b.day.localeCompare(a.day));
  return validateDraft(draft, buildValidationContext({ published, drafts: [] }));
}

const gravada = () => upsertDraft.mock.calls.at(-1)?.[0];

beforeEach(() => {
  h.data = dados();
  upsertDraft.mockClear();
});

describe("a nota gravada pela Produção usa o MESMO dia do post que a prévia da página (Brasília)", () => {
  it("o reel das 22h de 10/11 ocupa 10/11: a peça de 11/11 grava sem 'Única peça do dia'; a de 10/11 grava com o bloqueio", async () => {
    expect(REEL_DA_NOITE.publishedAt).toBe("2026-11-11T01:00:00.000Z");

    for (const [dia, bloqueia] of [
      ["2026-11-11", false],
      ["2026-11-10", true],
    ] as const) {
      const p = peca(`PD-${dia}`, dia, "reel");
      const r = await saveDraftAction({
        status: "rascunho",
        plannedFor: dia,
        type: "reel",
        hookText: p.hookText,
        hookSpoken: p.hookSpoken,
        script: p.script,
        caption: p.caption,
      });
      expect(r.ok, r.message).toBe(true);
      const d = gravada()!;
      expect(d.plannedFor).toBe(dia);
      expect(d.validationFailed?.includes("unica-do-dia") ?? false, dia).toBe(bloqueia);
      // A prévia da página diz o mesmo sobre o dia ocupado.
      const previa = previaDaPagina(h.data as DashboardData, { ...p, id: d.id });
      expect(previa.issues.some((i) => i.id === "unica-do-dia"), `prévia ${dia}`).toBe(bloqueia);
    }
  });

  it("um post de TESTE não ocupa o dia, como na prévia da página e na grade da semana", async () => {
    h.data = base({ igPosts: [{ ...REEL_DA_NOITE, isTest: true }] });
    const p = peca("PD-teste", "2026-11-10", "reel");
    const r = await saveDraftAction({ status: "rascunho", plannedFor: "2026-11-10", type: "reel", hookText: p.hookText, script: p.script, caption: p.caption });
    expect(r.ok, r.message).toBe(true);
    expect(gravada()!.validationFailed ?? []).not.toContain("unica-do-dia");
    expect(previaDaPagina(h.data as DashboardData, p).issues.some((i) => i.id === "unica-do-dia")).toBe(false);
  });
});
