/**
 * Fase 5 de nov/26 (§5.4 da spec, F5-D11, F5-D33, F5-D36) — Registros: o formulário
 * "Conteúdo dos posts" e as duas ações que escrevem a marcação de teste.
 *
 *   • A escrita perdida (lost update): o formulário manda, por post, o valor de quando a
 *     página abriu (`orig_<campo>_<id>`); `updatePostsMetaAction` só grava o campo que a
 *     pessoa MUDOU. Uma aba de Registros aberta antes de uma marcação feita no Conteúdo
 *     não desfaz a marcação ao salvar a duração de outro reel.
 *   • `marcarComoTesteAction` (o recolhido "Posts iguais no mesmo dia") marca só os ids
 *     que recebe — sem `orig_`, a semântica de sempre —, limpa repetidos e vazios, e
 *     confere `data:write` no servidor.
 *   • A duração volta a aparecer (o tipo cru na linha: `tipo === "reel"`).
 *
 * O store, a sessão, a marca e o cache do Next são dublês; nada é gravado de verdade.
 */
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updatePostsMetaAction } from "@/app/(dashboard)/configuracoes/actions";
import { marcarComoTesteAction } from "@/app/(dashboard)/conteudo/registros/actions";
import { registrosDoPeriodo } from "../conteudo";
import type { DashboardData, IgPost } from "../types";
import { base } from "@/test/fixtures-robo";
import { LEGENDA_LONGA, post } from "@/test/fixtures-conteudo";

const h = vi.hoisted(() => ({ pode: true, data: null as unknown }));
const getData = vi.hoisted(() => vi.fn(async () => h.data));
const upsertIgPosts = vi.hoisted(() => vi.fn<(posts: IgPost[]) => Promise<void>>(async () => {}));
const can = vi.hoisted(() => vi.fn<(cap: string) => Promise<boolean>>(async () => h.pode));
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/guard", () => ({ can }));
vi.mock("@/lib/active-brand", () => ({ activeBrandSlug: async () => "consorcio" }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/data/store", () => ({ getData, upsertIgPosts }));

/** Os posts do banco: P1 já marcado como teste (pelo Conteúdo); P4, P5 e P6 são posts iguais no mesmo dia. */
function banco(over: Partial<Record<string, Partial<IgPost>>> = {}): DashboardData {
  const igual = "Corte do gancho da parcela\nVersão de teste.";
  const posts = [
    post("P1", "2026-11-10", "10:00", "reel", "Reel um\nAssista.", { isTest: true }),
    post("P2", "2026-11-10", "12:00", "reel", "Reel dois\nAssista."),
    post("P3", "2026-11-11", "12:00", "feed", "Feed três\nAssista.", { pillar: "Mito ou verdade" }),
    post("P4", "2026-11-12", "10:00", "reel", igual),
    post("P5", "2026-11-12", "10:30", "reel", igual),
    post("P6", "2026-11-12", "11:00", "reel", igual),
  ].map((p) => ({ ...p, ...(over[p.id] ?? {}) }));
  return base({ igPosts: posts });
}

/** Um FormData com os campos dados. */
function form(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

/** Os campos de um post como o formulário os manda, com os `orig_` de quando a página abriu (sem mudança). */
function linhaSemMudanca(p: IgPost): Record<string, string> {
  const teste = p.isTest ? "1" : "";
  const campos: Record<string, string> = {
    [`test_${p.id}`]: teste,
    [`orig_test_${p.id}`]: teste,
    [`pillar_${p.id}`]: p.pillar ?? "",
    [`orig_pillar_${p.id}`]: p.pillar ?? "",
    [`cta_${p.id}`]: p.ctaType ?? "",
    [`orig_cta_${p.id}`]: p.ctaType ?? "",
  };
  if (p.type === "reel") {
    campos[`duration_${p.id}`] = p.durationSec != null ? String(p.durationSec) : "";
    campos[`orig_duration_${p.id}`] = campos[`duration_${p.id}`];
  }
  return campos;
}

const gravados = () => upsertIgPosts.mock.calls.flatMap((c) => c[0]);
const porId = (id: string) => gravados().find((p) => p.id === id);

beforeEach(() => {
  h.pode = true;
  h.data = banco();
  upsertIgPosts.mockClear();
  getData.mockClear();
  can.mockClear();
  revalidatePath.mockClear();
});

describe("updatePostsMetaAction: só o campo que a pessoa mudou (a escrita perdida, F5-D11)", () => {
  it("1. a aba velha de Registros salva a duração de P2 e NÃO desfaz o teste de P1 (marcado depois que ela abriu)", async () => {
    // A aba abriu com P1 fora do teste; depois o Conteúdo marcou P1. Agora a aba salva só a duração de P2.
    const aberta = banco({ P1: { isTest: undefined } });
    const campos = { ...Object.assign({}, ...aberta.igPosts.map(linhaSemMudanca)), duration_P2: "20", orig_duration_P2: "" };
    expect(campos.test_P1).toBe("");
    expect(campos.orig_test_P1).toBe("");
    const r = await updatePostsMetaAction(null, form(campos));
    expect(r.ok).toBe(true);
    expect(can).toHaveBeenCalledWith("data:write");
    expect(upsertIgPosts).toHaveBeenCalledTimes(1);
    expect(gravados().map((p) => p.id)).toEqual(["P2"]);
    expect(porId("P2")).toMatchObject({ durationSec: 20 });
    expect(porId("P2")!.isTest).toBeUndefined();
    // P1 continua teste no banco: nada foi gravado para ele.
    expect(porId("P1")).toBeUndefined();
    expect((h.data as DashboardData).igPosts.find((p) => p.id === "P1")!.isTest).toBe(true);
  });

  it("2. a pessoa muda de verdade: 'Teste = Não' com o original 'Sim' tira o teste de P1", async () => {
    const r = await updatePostsMetaAction(null, form({ test_P1: "", orig_test_P1: "1" }));
    expect(r.ok).toBe(true);
    expect(gravados().map((p) => p.id)).toEqual(["P1"]);
    expect(porId("P1")!.isTest).toBeUndefined();
  });

  it("4. pilar e CTA: igual ao original → não toca; diferente → grava; sem `orig_` → a semântica de sempre (o campo presente grava)", async () => {
    // Outra aba já trocou o pilar de P3 para "Mito ou verdade"; esta abriu com "Bastidor" e não mexeu.
    await updatePostsMetaAction(null, form({ pillar_P3: "Bastidor", orig_pillar_P3: "Bastidor" }));
    expect(upsertIgPosts).not.toHaveBeenCalled();
    // A pessoa troca o pilar.
    await updatePostsMetaAction(null, form({ pillar_P3: "Bastidor", orig_pillar_P3: "Mito ou verdade" }));
    expect(porId("P3")).toMatchObject({ pillar: "Bastidor" });
    upsertIgPosts.mockClear();
    // Sem o `orig_`: o campo presente grava.
    await updatePostsMetaAction(null, form({ pillar_P3: "Prova social" }));
    expect(porId("P3")).toMatchObject({ pillar: "Prova social" });
    upsertIgPosts.mockClear();

    // CTA: o banco tem "comentario" em P2 (outra aba); esta abriu com Auto e não mexeu.
    h.data = banco({ P2: { ctaType: "comentario" } });
    await updatePostsMetaAction(null, form({ cta_P2: "", orig_cta_P2: "" }));
    expect(upsertIgPosts).not.toHaveBeenCalled();
    await updatePostsMetaAction(null, form({ cta_P2: "dm", orig_cta_P2: "comentario" }));
    expect(porId("P2")).toMatchObject({ ctaType: "dm" });
    upsertIgPosts.mockClear();
    // Sem o `orig_`, "Auto" (vazio) grava: volta à heurística da legenda.
    await updatePostsMetaAction(null, form({ cta_P2: "" }));
    expect(porId("P2")!.ctaType).toBeUndefined();
    upsertIgPosts.mockClear();
    // A duração igual à de quando a página abriu também não toca o post.
    h.data = banco({ P2: { durationSec: 18 } });
    await updatePostsMetaAction(null, form({ duration_P2: "18", orig_duration_P2: "18" }));
    expect(upsertIgPosts).not.toHaveBeenCalled();
  });

  it("sem `data:write`: a mensagem de permissão e nada é gravado", async () => {
    h.pode = false;
    const r = await updatePostsMetaAction(null, form({ test_P2: "1", orig_test_P2: "" }));
    expect(r).toEqual({ ok: false, message: "Você não tem permissão para esta ação." });
    expect(upsertIgPosts).not.toHaveBeenCalled();
  });
});

describe("marcarComoTesteAction: o recolhido 'Posts iguais no mesmo dia' marca só os posts marcados (F5-D36)", () => {
  it("3. marca P3 como hoje; repetidos e vazios são limpos; id de outra marca é ignorado; sem `data:write`, nada", async () => {
    const r = await marcarComoTesteAction(["P3"]);
    expect(r.ok).toBe(true);
    expect(gravados().map((p) => [p.id, p.isTest])).toEqual([["P3", true]]);
    // O resto do post não muda (sem `orig_`, campo ausente não toca).
    expect(porId("P3")).toMatchObject({ pillar: "Mito ou verdade" });
    upsertIgPosts.mockClear();

    await marcarComoTesteAction(["P2", "P2", "", "  ", "OUTRA-MARCA-1"]);
    expect(gravados().map((p) => p.id)).toEqual(["P2"]);
    upsertIgPosts.mockClear();

    const vazio = await marcarComoTesteAction(["", " "]);
    expect(vazio.ok).toBe(false);
    expect(upsertIgPosts).not.toHaveBeenCalled();

    h.pode = false;
    const negado = await marcarComoTesteAction(["P2"]);
    expect(negado).toEqual({ ok: false, message: "Você não tem permissão para esta ação." });
    expect(upsertIgPosts).not.toHaveBeenCalled();
  });

  it("3b. dois dos três posts de um grupo: só esses dois viram teste (o que fica na grade não é tocado)", async () => {
    const r = await marcarComoTesteAction(["P4", "P5"]);
    expect(r.ok).toBe(true);
    expect(gravados().map((p) => [p.id, p.isTest]).sort()).toEqual([
      ["P4", true],
      ["P5", true],
    ]);
    expect(porId("P6")).toBeUndefined();
  });
});

describe("o formulário de Registros (§2.11)", () => {
  it("5. a duração volta a aparecer no reel (o tipo cru); a legenda curta é o link do post; 'dd/mm hh:mm · Tipo'", async () => {
    const { PostsMetaForm } = await import("@/components/config/registros-forms");
    const data = base({
      igPosts: [
        post("IG-REEL-NOITE", "2026-11-13", "21:30", "reel", LEGENDA_LONGA, { durationSec: 22 }),
        post("IG-FEED-DIA", "2026-11-12", "12:00", "feed", "Bastidor da semana\nAssista até o fim."),
      ],
    });
    const { linhas } = registrosDoPeriodo(data, { from: "2026-11-07", to: "2026-11-13" });
    expect(linhas.map((l) => l.id)).toEqual(["IG-REEL-NOITE", "IG-FEED-DIA"]);
    const html = renderToStaticMarkup(createElement(PostsMetaForm, { posts: linhas }));
    expect(html).toContain('name="duration_IG-REEL-NOITE"');
    expect(html).not.toContain('name="duration_IG-FEED-DIA"');
    // Os valores de quando a página abriu, por post.
    for (const id of ["IG-REEL-NOITE", "IG-FEED-DIA"]) {
      for (const campo of ["test", "pillar", "cta"]) expect(html, `${campo} ${id}`).toContain(`name="orig_${campo}_${id}"`);
    }
    expect(html).toMatch(/name="orig_duration_IG-REEL-NOITE"[^>]*value="22"|value="22"[^>]*name="orig_duration_IG-REEL-NOITE"/);
    // Nenhuma legenda inteira (nem a 2ª linha); a curta é o link do post, numa aba nova.
    const [, segunda] = LEGENDA_LONGA.split("\n");
    expect(html).not.toContain(LEGENDA_LONGA);
    expect(html).not.toContain(segunda);
    const link = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes('href="https://www.instagram.com/p/FIXTUREREELNOITE/"'));
    expect(link).toBeDefined();
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
    expect(html).toContain(">Planejamento patrimonial começa pela conta certa</a>");
    expect(html).toContain("13/11 21:30 · Reel");
    expect(html).toContain("12/11 12:00 · Feed");
    // Nenhum `title=` longo (a legenda inteira não se esconde em atributo).
    for (const t of html.matchAll(/\btitle="([^"]*)"/g)) expect(t[1].split(/\s+/).length, t[1]).toBeLessThanOrEqual(3);
  });
});

describe("o formulário de Registros depois de salvar (revisão final)", () => {
  it("7. a linha remonta quando o valor gravado muda: o <select> (defaultValue) e o `orig_` (controlado) andam juntos", () => {
    // O React não reaplica o `defaultValue` de um <select> numa atualização, e o reset do form
    // depois da action volta o select ao valor da MONTAGEM — enquanto o `orig_` já segue o banco.
    // Sem remontar, o salvamento seguinte mandaria "Não" contra o original "Sim" e desfaria a
    // marcação. A chave da linha leva os valores gravados: valor novo = linha nova.
    const fonte = fs.readFileSync(path.join(process.cwd(), "src/components/config/registros-forms.tsx"), "utf8");
    const chave = fonte.match(/<tr\s+key=\{`([^`]*)`\}/)?.[1];
    expect(chave, "a <tr> do formulário tem uma chave com os valores gravados").toBeDefined();
    for (const v of ["${p.id}", "${teste}", "${cta}", "${pilar}", "${duracao}"]) expect(chave, v).toContain(v);
    // E os quatro `orig_` saem das MESMAS variáveis que a chave e o padrão visível de cada campo.
    expect(fonte).toContain("name={`orig_test_${p.id}`} value={teste}");
    expect(fonte).toContain("name={`test_${p.id}`} defaultValue={teste}");
    expect(fonte).toContain("name={`orig_cta_${p.id}`} value={cta}");
    expect(fonte).toContain("name={`cta_${p.id}`} defaultValue={cta}");
  });

  it("8. período sem post: o título diz 'Nenhum post no período' UMA vez (sem a linha repetida embaixo)", async () => {
    const { default: RegistrosPage } = await import("@/app/(dashboard)/conteudo/registros/page");
    const vazio = renderToStaticMarkup(await RegistrosPage({ searchParams: Promise.resolve({ range: "2099-01-01..2099-01-31" }) }));
    expect(vazio.match(/Nenhum post no período/g)).toHaveLength(1);
    expect(vazio).not.toContain("<form");
    // Com post no período: o título com a contagem e o formulário.
    const cheio = renderToStaticMarkup(await RegistrosPage({ searchParams: Promise.resolve({ range: "all" }) }));
    expect(cheio).not.toContain("Nenhum post no período");
    expect(cheio).toContain("<form");
    expect(cheio).toContain("5 posts da grade · 1 de teste");
  });
});

describe("estático: Registros só com o essencial (§3.11)", () => {
  const ler = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  it("6. saíram o snapshot manual, as DMs e a rotina de presença (formulários, actions e o campo da meta)", async () => {
    const forms = await import("@/components/config/registros-forms");
    for (const nome of ["ManualIgForm", "DmForm", "RoutineForm"]) expect(Object.keys(forms), nome).not.toContain(nome);
    expect(Object.keys(forms)).toContain("PostsMetaForm");
    const fonteForms = ler("src/components/config/registros-forms.tsx");
    expect(fonteForms).not.toContain("PostMetaRow");
    for (const nome of ["ManualIgForm", "DmForm", "RoutineForm"]) expect(fonteForms, nome).not.toMatch(new RegExp(`export function ${nome}\\b`));

    const actions = await import("@/app/(dashboard)/configuracoes/actions");
    for (const nome of ["addManualIgDay", "setDmConversationsAction", "setPresenceRoutineAction"]) expect(Object.keys(actions), nome).not.toContain(nome);
    const fonteActions = ler("src/app/(dashboard)/configuracoes/actions.ts");
    for (const nome of ["addManualIgDay", "setDmConversationsAction", "setPresenceRoutineAction"]) expect(fonteActions, nome).not.toContain(nome);
    const setGoals = fonteActions.slice(fonteActions.indexOf("export async function setGoalsAction"));
    const corpo = setGoals.slice(0, setGoals.indexOf("\nexport ", 1) > 0 ? setGoals.indexOf("\nexport ", 1) : undefined);
    expect(corpo.length).toBeGreaterThan(0);
    expect(corpo).not.toContain("conversas_dm");
    expect(ler("src/components/config/metas-forms.tsx")).not.toContain("conversas_dm");

    const pagina = ler("src/app/(dashboard)/conteudo/registros/page.tsx");
    expect(pagina).toMatch(/import\s*\{[^}]*\bPostsMetaForm\b[^}]*\}\s*from\s*"@\/components\/config\/registros-forms"/);
    // O barril `config-forms` saiu (não tinha mais importador).
    expect(fs.existsSync(path.join(process.cwd(), "src/components/config/config-forms.tsx"))).toBe(false);
    for (const nome of ["ManualIgForm", "DmForm", "RoutineForm"]) expect(pagina, nome).not.toContain(nome);
    expect(pagina).toContain("PERIODO_PADRAO_DO_CONTEUDO");
    expect(pagina).toContain("registrosDoPeriodo");
    // A página não monta a linha à mão (o tipo como rótulo escondia a duração de todo reel).
    expect(pagina).not.toContain("TYPE_LABEL");
  });
});
