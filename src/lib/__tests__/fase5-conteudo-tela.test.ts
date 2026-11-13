/**
 * Fase 5 de nov/26 (§5.2 da spec) — o Conteúdo na TELA, a partir da página de verdade
 * (`app/(dashboard)/conteudo/page.tsx`) com o carregador trocado por um objeto montado pela
 * função pura (`montarConteudoDaTela`) sobre o seed e sobre a forma da produção de 13/11
 * (`fixtures-conteudo`). No molde de `fase4-midia-tela.test.ts`, com os helpers de
 * `src/test/tela.ts`.
 *
 *   • LGPD e fronteira: a árvore que o servidor manda não tem telefone, e-mail, NOME nem
 *     id de lead (os leads se chamam "Pessoa-conteudo-NN-zq"); nenhuma função cruza; os
 *     clients formam uma lista FECHADA; cada client recebe só as props do contrato; nem
 *     legenda inteira, nem URL do CDN de post, nem marca, nem peça da Produção.
 *   • TEXTO (§2.8): placar ≤ 15, variações ≤ 10, título ≤ 8, melhores ≤ 48 (cada cartão
 *     ≤ 16), ações ≤ 24 (cada ≤ 12), recolhidos ≤ 11, total ≤ 116 e = Σ das partes;
 *     nenhuma frase > 25 — também DENTRO dos ⓘ montados pela lib; nenhuma legenda inteira.
 *   • ÂNCORAS: todo id com `scroll-mt-24`; a linha das variações abre o recolhido; o link
 *     do post abre no Instagram (`target="_blank"`, `rel="noopener noreferrer"`).
 *   • ESTÁTICO: a página só carrega e renderiza; a fronteira do bundle; o que saiu.
 */
import fs from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../../next.config";
import { NAV } from "@/components/layout/nav-items";
import { montarConteudoDaTela, normalizarLegenda, type ConteudoDaTela, type EntradaConteudo } from "../conteudo";
import { CHAVES_PROIBIDAS, blocos, componentesClient, conferirLgpd, inspecionar, palavras, trechos } from "@/test/tela";
import * as F from "@/test/fixtures-conteudo";
import { entradaConteudoDa, seedDaMarca } from "@/test/entrada-conteudo";

// ---------------------------------------------------------------- dublês da página

const h = vi.hoisted(() => ({
  user: { role: "admin" } as null | { role: string },
  brand: "consorcio",
  pode: true,
  carregado: null as unknown,
}));
const carregarConteudo = vi.hoisted(() => vi.fn<(marca: string, range?: string) => Promise<unknown>>(async () => h.carregado));

vi.mock("next/navigation", () => ({
  usePathname: () => "/conteudo",
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: function Link({ href, children, ...resto }: { href: string; children?: ReactNode }) {
      return el("a", { href, ...resto }, children);
    },
  };
});
// Componente client (o painel de alertas do layout); a página do Conteúdo não registra alerta (F5-D22).
vi.mock("@/components/layout/alertas", () => ({
  RegistrarAlertas: function RegistrarAlertas() {
    return null;
  },
}));
// Server actions e módulos de servidor que os componentes client de `src/components` importam
// (`componentesClient()` importa TODOS): a tela só os chama no clique.
vi.mock("@/app/(dashboard)/ai-actions", () => ({ gerarResumoSemanalAction: vi.fn() }));
vi.mock("@/app/(dashboard)/configuracoes/live-actions", () => ({ salvarManuaisDaLive: vi.fn(), salvarCampanhaDaLive: vi.fn() }));
vi.mock("@/app/(dashboard)/configuracoes/conferencia-actions", () => ({ registrarConferencia: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => h.user }));
vi.mock("@/lib/active-brand", async () => {
  const { brandDef } = await import("@/lib/brands");
  return { activeBrandSlug: async () => h.brand, activeBrand: async () => brandDef(h.brand) };
});
vi.mock("@/lib/live-server", async () => {
  const { LIVE_PADRAO } = await import("@/lib/live");
  return { campanhaDaLive: async () => LIVE_PADRAO };
});
vi.mock("@/lib/auth/guard", () => ({ can: async () => h.pode }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: () => false }));
vi.mock("@/lib/data/store", () => ({
  getData: vi.fn(),
  listDrafts: vi.fn(async () => []),
  listResumosSemanais: vi.fn(async () => []),
  listConferencias: vi.fn(async () => []),
}));
// O carregador do Conteúdo: devolve o objeto montado pela função pura e grava com que argumentos foi chamado.
vi.mock("@/lib/conteudo-server", () => ({ carregarConteudo }));

// ---------------------------------------------------------------- utilidades

const ORCAMENTO_CONTEUDO = { total: 116, placar: 15, variacoes: 10, titulos: 8, melhores: 48, acoes: 24, recolhidos: 11 };

/** Os ÚNICOS componentes client do Conteúdo: um client novo, de qualquer pasta, quebra aqui. */
const CLIENTS_PERMITIDOS = [
  "ui/info.tsx:Info",
  "ui/rolar-para-ancora.tsx:RolarParaAncora",
  "midia/miniatura.tsx:MiniaturaDoCriativo",
  "conteudo/variacoes.tsx:VariacoesParaConferir",
  "tables/posts-table.tsx:PostsTable",
  "charts/time-series-chart.tsx:TimeSeriesChart",
  "next/link",
];
/** Legenda inteira, URL do CDN, marca e peça da Produção nunca cruzam; nem dado de lead. */
const PROIBIDAS = [...CHAVES_PROIBIDAS, "name", "leadId", "caption", "mediaUrl", "thumbnailUrl", "brand", "drafts", "script"];

/** Os `rotulo` fixos dos `Info` da página (§2.6) — mais "Sobre a ação “…”" e "Sobre “…”" (os números da conta). */
const ROTULOS = new Set([
  "Sobre o placar",
  "Sobre os posts que mais funcionaram",
  "Sobre os posts iguais no mesmo dia",
  "Sobre todos os posts",
  "Sobre a conta do Instagram",
]);

/** As âncoras da página (§2.1): todas com `scroll-mt-24`. */
const ANCORAS = ["placar", "melhores", "acoes", "variacoes", "todos-os-posts", "conta"];

let clientes: Map<unknown, string>;
beforeAll(async () => {
  clientes = await componentesClient();
});
beforeEach(() => {
  h.pode = true;
  h.user = { role: "admin" };
});

async function pagina(sp: Record<string, string | string[] | undefined>) {
  const { default: ConteudoPage } = await import("@/app/(dashboard)/conteudo/page");
  return ConteudoPage({ searchParams: Promise.resolve(sp) } as never);
}

const renderizar = (no: unknown) => renderToStaticMarkup(no as ReactElement);

function carregar(e: EntradaConteudo): ConteudoDaTela {
  const conteudo = montarConteudoDaTela(e);
  h.brand = e.marca;
  h.carregado = { rangeKey: e.rangeKey, conteudo };
  return conteudo;
}

const nPalavras = (t: string) => t.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p)).length;
const frases = (t: string) => t.split(/(?<=[.!?])\s+/).filter((f) => f.trim() !== "");
/** O texto como o React o escapa no HTML. */
const escapar = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

/** As partes medidas da página (§2.8). */
function partes(html: string) {
  const melhores = trechos(html, "ul", 'data-parte="melhores"');
  const acoes = trechos(html, "ul", 'data-parte="acoes"');
  return {
    total: palavras(html),
    placar: trechos(html, "p", 'data-parte="placar"').flatMap(palavras),
    variacoes: trechos(html, "p", 'data-parte="variacoes"').flatMap(palavras),
    titulos: trechos(html, "h2", "data-titulo").flatMap(palavras),
    melhores: melhores.flatMap(palavras),
    acoes: acoes.flatMap(palavras),
    recolhidos: trechos(html, "details", 'data-parte="recolhido"').flatMap(palavras),
    cadaCartao: melhores.flatMap((u) => trechos(u, "li", "")).map(palavras),
    cadaAcao: acoes.flatMap((u) => trechos(u, "li", "")).map(palavras),
  };
}

/** O texto de um elemento (as palavras, juntas). */
const textoDe = (trecho: string | undefined) => (trecho ? palavras(trecho).join(" ") : "");
/** As palavras de um texto puro, com a régua de `palavras` (escapado como o React escaparia). */
const palavrasDoTexto = (t: string) => palavras(`<i>${escapar(t)}</i>`).join(" ");

/** Os `<summary>` dos recolhidos, na ordem. */
const resumosDosRecolhidos = (html: string) =>
  [...html.matchAll(/<details[^>]*data-parte="recolhido"[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => palavras(`<i>${m[1]}</i>`).join(" "));

/** A tag de abertura do elemento com `id`. */
const tagDoId = (html: string, id: string) => html.match(new RegExp(`<[a-z][a-z0-9]*\\b[^>]*\\bid="${id}"[^>]*>`))?.[0];

/** O `<details>` de um recolhido (com o miolo, que o servidor manda mesmo fechado). */
const recolhido = (html: string, id: string) => html.match(new RegExp(`<details[^>]*\\bid="${id}"[\\s\\S]*?</details>`))?.[0];

/** As tags `<a …>` que apontam para `href`. */
const linksPara = (html: string, href: string) => [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]).filter((t) => t.includes(`href="${escapar(href)}"`));

/** Todas as dicas montadas pela lib (§2.8: nenhuma frase > 25 dentro de um ⓘ). */
function dicasDe(c: ConteudoDaTela): [string, string][] {
  return [
    ["placar", c.placar.dica],
    ["variações", c.variacoes?.dica ?? ""],
    ["melhores", c.melhores?.dica ?? ""],
    ...c.acoes.map((a): [string, string] => [`ação ${a.id}`, a.dica]),
    ["todos", c.todos?.dica ?? ""],
    ["conta", c.conta?.dica ?? ""],
    ...(c.conta?.numeros ?? []).map((n): [string, string] => [`número ${n.id}`, n.dica]),
  ];
}

// ---------------------------------------------------------------- os casos

interface Caso {
  nome: string;
  entrada: () => EntradaConteudo;
  /** A URL da página (padrão: `?range=<rangeKey>`). */
  url?: Record<string, string>;
  /** Sem `data:write` (o papel comercial). */
  semEscrita?: boolean;
}

const CASOS: Caso[] = [
  { nome: "seed · URL limpa (30 dias: o vazio)", entrada: () => entradaConteudoDa(seedDaMarca()), url: {} },
  { nome: "seed · campanha", entrada: () => entradaConteudoDa(seedDaMarca(), "all") },
  { nome: "seed da Krone · campanha", entrada: () => entradaConteudoDa(seedDaMarca("krone"), "all") },
  { nome: "produção · 30 dias", entrada: () => entradaConteudoDa(F.producaoConteudo(), "30d") },
  { nome: "produção · 7 dias", entrada: () => entradaConteudoDa(F.producaoConteudo(), "7d") },
  { nome: "produção · campanha", entrada: () => entradaConteudoDa(F.producaoConteudo(), "all") },
  { nome: "produção · comercial (sem data:write)", entrada: () => entradaConteudoDa(F.producaoConteudo(), "30d"), semEscrita: true },
  { nome: "semana sem post · 7 dias", entrada: () => entradaConteudoDa(F.semPostNaSemana(), "7d") },
  { nome: "variações resolvidas", entrada: () => entradaConteudoDa(F.variacoesResolvidas()) },
  { nome: "sem Instagram", entrada: () => entradaConteudoDa(F.semInstagram()) },
  { nome: "sem o total de seguidores", entrada: () => entradaConteudoDa(F.semTotalDeSeguidores()) },
  { nome: "Krone · 30 dias", entrada: () => entradaConteudoDa(F.kroneConteudo()) },
  { nome: "sem interação", entrada: () => entradaConteudoDa(F.semInteracao()) },
  { nome: "um post da grade", entrada: () => entradaConteudoDa(F.umPostDaGrade()) },
  { nome: "empate no topo", entrada: () => entradaConteudoDa(F.empateNoTopo()) },
  { nome: "post da noite · 7 dias", entrada: () => entradaConteudoDa(F.postDaNoite(), "7d", { agora: F.AGORA_NOITE }) },
  { nome: "pileup sem variação", entrada: () => entradaConteudoDa(F.pileupSemVariacao()) },
  { nome: "período que ainda não começou", entrada: () => entradaConteudoDa(seedDaMarca(), F.CHAVE_NAO_COMECOU) },
  { nome: "pior caso de texto", entrada: () => entradaConteudoDa(F.piorCasoDeTexto(), F.CHAVE_DO_PIOR_CASO) },
];

async function abrir(c: Caso) {
  const e = c.entrada();
  if (c.semEscrita) {
    h.pode = false;
    h.user = { role: "comercial" };
  }
  const conteudo = carregar(e);
  return { e, c: conteudo, no: await pagina(c.url ?? { range: e.rangeKey }) };
}

// ---------------------------------------------------------------- LGPD e a fronteira

describe("LGPD: o que a página do Conteúdo manda para os componentes client", () => {
  for (const caso of CASOS) {
    it(caso.nome, async () => {
      const { e, c, no } = await abrir(caso);
      const fr = await inspecionar(no, clientes);
      // Nem nome, nem o ID do lead pelo valor (o Conteúdo não leva dado de lead nenhum).
      conferirLgpd(fr, e.data.leads, { semNomes: true, semIds: true, proibidas: PROIBIDAS });
      // A lista FECHADA de clients (`RegistrarAlertas` não é usado: a página não registra alerta).
      const nomes = new Set(fr.clients.map((x) => x.nome));
      for (const n of nomes) expect(CLIENTS_PERMITIDOS, `client fora da lista: ${n}`).toContain(n);
      expect(nomes.has("layout/alertas:RegistrarAlertas")).toBe(false);
      for (const n of ["ui/info.tsx:Info", "ui/rolar-para-ancora.tsx:RolarParaAncora"]) expect(nomes.has(n), n).toBe(true);
      const props = (nome: string) => fr.clients.filter((x) => x.nome === nome).map((x) => x.props);

      // RolarParaAncora: exatamente { abrirDetalhes: true }.
      for (const p of props("ui/rolar-para-ancora.tsx:RolarParaAncora")) expect(p).toEqual({ abrirDetalhes: true });
      // A miniatura: só a url e o formato — uma por cartão, na ordem.
      const minis = props("midia/miniatura.tsx:MiniaturaDoCriativo");
      for (const p of minis) expect(Object.keys(p).sort()).toEqual(["formato", "url"]);
      expect(minis.map((p) => [p.url, p.formato])).toEqual((c.melhores?.cards ?? []).map((x) => [x.miniatura, x.formato]));
      // As variações: só as variações, o papel e o link de Registros; cada post só o que a linha mostra.
      const vars = props("conteudo/variacoes.tsx:VariacoesParaConferir");
      expect(vars).toHaveLength(c.variacoes ? 1 : 0);
      for (const p of vars) {
        expect(Object.keys(p).sort()).toEqual(["podeEditar", "registrosHref", "variacoes"]);
        expect(p.podeEditar).toBe(!caso.semEscrita);
        expect(p.registrosHref).toBe("/conteudo/registros?range=all#posts");
        const lista = p.variacoes as { posts: Record<string, unknown>[] }[];
        expect(lista).toHaveLength(c.variacoes!.lista.length);
        for (const g of lista) {
          expect(Object.keys(g).sort()).toEqual(["chave", "diaTexto", "legenda", "naGrade", "posts"]);
          for (const post of g.posts) expect(Object.keys(post).sort()).toEqual(["estado", "hora", "href", "id", "tipo"]);
        }
      }
      // A tabela: só as linhas prontas (sem o post inteiro, sem URL do CDN, sem marca).
      const tabelas = props("tables/posts-table.tsx:PostsTable");
      expect(tabelas).toHaveLength(c.todos ? 1 : 0);
      for (const p of tabelas) {
        expect(Object.keys(p)).toEqual(["linhas"]);
        expect((p.linhas as unknown[]).length).toBe(c.todos!.linhas.length);
      }
      // O gráfico do total de seguidores: só os pontos (data e total), a série e o formato.
      const graficos = props("charts/time-series-chart.tsx:TimeSeriesChart");
      expect(graficos).toHaveLength(c.conta?.serieDeSeguidores ? 1 : 0);
      for (const p of graficos) {
        expect(Object.keys(p).sort()).toEqual(["data", "series", "yFormat"]);
        for (const ponto of p.data as Record<string, unknown>[]) expect(Object.keys(ponto).sort()).toEqual(["date", "followers"]);
      }
      // Todo ⓘ com rótulo próprio, da lista do §2.6.
      const infos = props("ui/info.tsx:Info");
      for (const p of infos) {
        expect(typeof p.rotulo, JSON.stringify(p)).toBe("string");
        const r = p.rotulo as string;
        expect(r).not.toBe("O que é isto?");
        expect(ROTULOS.has(r) || r.startsWith("Sobre a ação “") || r.startsWith("Sobre “"), r).toBe(true);
      }
      const temInfo = (rotulo: string, texto: string) => infos.some((p) => p.rotulo === rotulo && p.texto === texto);
      expect(temInfo("Sobre o placar", c.placar.dica)).toBe(true);
      if (c.melhores) expect(temInfo("Sobre os posts que mais funcionaram", c.melhores.dica)).toBe(true);
      if (c.variacoes) expect(temInfo("Sobre os posts iguais no mesmo dia", c.variacoes.dica)).toBe(true);
      if (c.todos) expect(temInfo("Sobre todos os posts", c.todos.dica)).toBe(true);
      if (c.conta) expect(temInfo("Sobre a conta do Instagram", c.conta.dica)).toBe(true);
      for (const a of c.acoes) expect(temInfo(a.rotulo, a.dica), a.rotulo).toBe(true);
      for (const n of c.conta?.numeros ?? []) expect(temInfo(`Sobre “${n.rotulo}”`, n.dica), n.rotulo).toBe(true);
      // Nenhuma legenda inteira, nenhuma URL do CDN de post, nenhuma peça da Produção no payload.
      const json = JSON.stringify(fr.arvore);
      for (const post of e.data.igPosts) {
        if (nPalavras(post.caption) >= 9) {
          expect(json.includes(JSON.stringify(post.caption).slice(1, -1)), post.id).toBe(false);
          // Nem a forma NORMALIZADA (minúscula, uma linha só — a que serviria de chave de grupo),
          // nem a 2ª linha em minúscula: a legenda inteira não vai ao client por nenhum caminho.
          expect(json.includes(JSON.stringify(normalizarLegenda(post.caption)).slice(1, -1)), `${post.id}: normalizada`).toBe(false);
          const [, segunda = ""] = post.caption.split(/\r?\n/).filter((l) => l.trim() !== "");
          if (nPalavras(segunda) >= 3) expect(json.includes(JSON.stringify(normalizarLegenda(segunda)).slice(1, -1)), `${post.id}: 2ª linha`).toBe(false);
        }
        if (post.thumbnailUrl && !(c.melhores?.cards ?? []).some((x) => x.miniatura === post.thumbnailUrl)) expect(json.includes(post.thumbnailUrl), post.id).toBe(false);
      }
      for (const post of e.data.igPosts) if (post.mediaUrl?.match(/\.mp4\?/)) expect(json.includes(post.mediaUrl), post.id).toBe(false);
    });
  }
});

// ---------------------------------------------------------------- o texto

describe("o orçamento de texto (§2.8)", () => {
  for (const caso of CASOS) {
    it(caso.nome, async () => {
      const { e, c, no } = await abrir(caso);
      const html = renderizar(no);
      const p = partes(html);
      const conta = {
        total: p.total.length,
        placar: p.placar.length,
        variacoes: p.variacoes.length,
        titulos: p.titulos.length,
        melhores: p.melhores.length,
        acoes: p.acoes.length,
        recolhidos: p.recolhidos.length,
      };
      for (const [k, max] of Object.entries(ORCAMENTO_CONTEUDO)) {
        expect(conta[k as keyof typeof conta], `${k}: ${JSON.stringify(p[k as keyof typeof conta])}`).toBeLessThanOrEqual(max);
      }
      // Nada escapa de parte medida: nenhuma descrição solta.
      expect(conta.total, JSON.stringify(p.total)).toBe(conta.placar + conta.variacoes + conta.titulos + conta.melhores + conta.acoes + conta.recolhidos);
      for (const li of p.cadaCartao) expect(li.length, li.join(" ")).toBeLessThanOrEqual(16);
      for (const li of p.cadaAcao) expect(li.length, li.join(" ")).toBeLessThanOrEqual(12);
      expect(Math.max(0, ...blocos(html).map((b) => b.length))).toBeLessThanOrEqual(25);
      // Toda frase de todo ⓘ montado pela lib ≤ 25.
      for (const [onde, d] of dicasDe(c)) for (const f of frases(d)) expect(nPalavras(f), `${onde}: ${f}`).toBeLessThanOrEqual(25);
      // Cartões: legenda ≤ 8 (+ "…"), linha ≤ 8; ações: linha ≤ 10.
      for (const card of c.melhores?.cards ?? []) {
        expect(nPalavras(card.legenda.replace(/…$/, "")), card.legenda).toBeLessThanOrEqual(8);
        expect(nPalavras(card.linha), card.linha).toBeLessThanOrEqual(8);
      }
      for (const a of c.acoes) expect(nPalavras(a.linha), a.linha).toBeLessThanOrEqual(10);
      // Nenhum `title=` com mais de 3 palavras fora das tabelas (os recolhidos incluídos).
      const semTabelas = html.replace(/<table[\s\S]*?<\/table>/g, "");
      for (const t of semTabelas.matchAll(/\btitle="([^"]*)"/g)) expect(nPalavras(t[1]), t[1]).toBeLessThanOrEqual(3);
      // Nenhum <p> dentro de lista; nenhum <details> aberto pelo servidor.
      for (const lista of [...trechos(html, "ol", ""), ...trechos(html, "ul", "")]) expect(lista).not.toMatch(/<p[\s>]/);
      expect(html).not.toMatch(/<details[^>]*\sopen/);
      // Os recolhidos, na ordem, com o rótulo de navegação (sem número).
      expect(resumosDosRecolhidos(html)).toEqual(
        [c.variacoes ? "Posts iguais no mesmo dia" : null, c.todos ? "Todos os posts" : null, c.conta ? "Conta do Instagram" : null].filter(Boolean),
      );
      // O único título visível é o dos melhores, igual ao do objeto.
      expect(trechos(html, "h2", "data-titulo").map(textoDe)).toEqual(c.melhores ? [palavrasDoTexto(c.melhores.titulo)] : []);
      expect(html.match(/data-titulo/g)?.length ?? 0).toBe(c.melhores ? 1 : 0);
      // O placar e a linha das variações são os do objeto.
      expect(textoDe(trechos(html, "p", 'data-parte="placar"')[0])).toBe(palavrasDoTexto(`${c.placar.posts} · ${c.placar.ultimo} · ${c.placar.seguidores}`));
      const linha = trechos(html, "p", 'data-parte="variacoes"');
      if (c.variacoes) expect(textoDe(linha[0])).toBe(palavrasDoTexto(`${c.variacoes.linha} →`));
      else expect(linha).toEqual([]);
      // As ações: "{linha} → Produção", uma por `li`.
      const lis = trechos(html, "ul", 'data-parte="acoes"').flatMap((u) => trechos(u, "li", ""));
      expect(lis.map(textoDe)).toEqual(c.acoes.map((a) => palavrasDoTexto(a.destino ? `${a.linha} → ${a.destino.rotulo}` : a.linha)));
      // Nenhuma legenda inteira no HTML (nem em atributo), nem a 2ª linha dela.
      let conferidas = 0;
      for (const post of e.data.igPosts) {
        if (nPalavras(post.caption) < 30) continue;
        conferidas += 1;
        const [, segunda = ""] = post.caption.split(/\r?\n/).filter((l) => l.trim() !== "");
        expect(html.includes(escapar(post.caption)), post.id).toBe(false);
        expect(html.includes(escapar(post.caption.replace(/\s+/g, " "))), post.id).toBe(false);
        if (segunda) expect(html.includes(escapar(segunda.trim())), `${post.id}: 2ª linha`).toBe(false);
      }
      if (caso.nome.startsWith("produção · 30") || caso.nome === "produção · campanha") expect(conferidas).toBeGreaterThan(0);
    });
  }

  it("o pior caso de texto: cada parte cabe no orçamento e o total é a soma (a conta do fixture)", async () => {
    const e = entradaConteudoDa(F.piorCasoDeTexto(), F.CHAVE_DO_PIOR_CASO);
    const c = carregar(e);
    expect(c.placar.posts).toBe("1.234 posts no período");
    expect(c.placar.ultimo).toBe("Último post há 123 dias");
    expect(c.placar.seguidores).toBe("Seguidores +12.345 (pago + orgânico)");
    expect(c.variacoes!.linha).toBe("123 grupos de posts iguais no mesmo dia para conferir");
    expect(c.melhores!.titulo).toBe("Carrossel de 20/04 lidera: 1.234 salvos, 1.234 compartilhamentos");
    expect(c.acoes.map((a) => a.id)).toEqual(["no-recent-post", "retention-drop"]);
    const html = renderizar(await pagina({ range: e.rangeKey }));
    const p = partes(html);
    const conta = Object.fromEntries(Object.keys(ORCAMENTO_CONTEUDO).map((k) => [k, (p[k as keyof typeof ORCAMENTO_CONTEUDO] as string[]).length]));
    console.info("[fase5-conteudo-tela] pior caso de texto:", JSON.stringify(conta));
    for (const [k, max] of Object.entries(ORCAMENTO_CONTEUDO)) expect(conta[k], k).toBeLessThanOrEqual(max);
    expect(conta.total).toBe(conta.placar + conta.variacoes + conta.titulos + conta.melhores + conta.acoes + conta.recolhidos);
    expect(conta.placar).toBe(13);
    expect(conta.variacoes).toBe(10);
    expect(conta.titulos).toBe(8);
    expect(conta.melhores).toBe(48);
    expect(conta.recolhidos).toBe(11);
    // As 2 ações de maior severidade: o teto de 2 × 12.
    expect(p.cadaAcao).toHaveLength(2);
    for (const li of p.cadaAcao) expect(li.length).toBeLessThanOrEqual(12);
    expect(conta.acoes).toBeLessThanOrEqual(24);
  });
});

// ---------------------------------------------------------------- âncoras e links

describe("âncoras e links (§2.1)", () => {
  for (const caso of CASOS) {
    it(caso.nome, async () => {
      const { e, c, no } = await abrir(caso);
      const html = renderizar(no);
      const exigidas = [
        "placar",
        ...(c.melhores ? ["melhores"] : []),
        ...(c.acoes.length > 0 ? ["acoes"] : []),
        ...(c.variacoes ? ["variacoes"] : []),
        ...(c.todos ? ["todos-os-posts"] : []),
        ...(c.conta ? ["conta"] : []),
      ];
      for (const id of ANCORAS) {
        const tag = tagDoId(html, id);
        if (exigidas.includes(id)) expect(tag, `#${id}`).toBeDefined();
        else expect(tag, `#${id} sem conteúdo`).toBeUndefined();
        if (tag) expect(tag, `#${id}`).toMatch(/\bscroll-mt-24\b/);
      }
      // A linha das variações abre o recolhido; dentro dele, o link de Registros (o grupo pode ser antigo).
      if (c.variacoes) {
        expect(trechos(html, "p", 'data-parte="variacoes"')[0]).toContain('href="#variacoes"');
        expect(recolhido(html, "variacoes")).toContain(`href="${escapar("/conteudo/registros?range=all#posts")}"`);
      }
      // As ações → Produção, com o período.
      for (const a of c.acoes) {
        expect(a.destino?.href).toBe(`/conteudo/producao?range=${e.rangeKey}`);
        expect(linksPara(html, a.destino!.href).length).toBeGreaterThan(0);
      }
      // "Planejar a próxima peça → Produção" no fim de "Todos os posts" (com playbook).
      if (c.todos?.producao) {
        expect(c.todos.producao.href).toBe(`/conteudo/producao?range=${e.rangeKey}`);
        expect(recolhido(html, "todos-os-posts")).toContain("Planejar a próxima peça");
      }
      // O link de cada cartão e o "abrir" de cada post das variações: o permalink, numa aba nova.
      const hrefs = [...(c.melhores?.cards ?? []).map((x) => x.href), ...(c.variacoes?.lista ?? []).flatMap((g) => g.posts.map((x) => x.href))].filter(
        (x): x is string => Boolean(x),
      );
      for (const href of hrefs) {
        const tags = linksPara(html, href);
        expect(tags.length, href).toBeGreaterThan(0);
        for (const t of tags) {
          expect(t, href).toContain('target="_blank"');
          expect(t, href).toContain('rel="noopener noreferrer"');
        }
      }
    });
  }
});

// ---------------------------------------------------------------- os casos, um a um

describe("os casos da tela (§5.2)", () => {
  it("1. seed com a URL limpa: o carregador recebe (marca, undefined) e a tela é a de 30 dias — o placar e as ações do agora", async () => {
    const e = entradaConteudoDa(seedDaMarca());
    expect(e.rangeKey).toBe("30d");
    carregar(e);
    carregarConteudo.mockClear();
    const html = renderizar(await pagina({}));
    expect(carregarConteudo.mock.calls).toEqual([["consorcio", undefined]]);
    expect(textoDe(trechos(html, "p", 'data-parte="placar"')[0])).toBe(palavrasDoTexto("Nenhum post no período · Último post há 113 dias · Seguidores —"));
    const lis = trechos(html, "ul", 'data-parte="acoes"').flatMap((u) => trechos(u, "li", ""));
    expect(lis.map(textoDe)).toEqual([
      palavrasDoTexto("Publique hoje: 113 dias sem post da grade → Produção"),
      palavrasDoTexto("Complete a grade da semana: 0 de 6 com peça → Produção"),
    ]);
    expect(trechos(html, "h2", "data-titulo")).toEqual([]);
    expect(resumosDosRecolhidos(html)).toEqual([]);
    // Com ?range=30d o carregador recebe a chave; em array, a 1ª.
    carregarConteudo.mockClear();
    await pagina({ range: "30d" });
    await pagina({ range: ["7d", "all"] });
    expect(carregarConteudo.mock.calls).toEqual([
      ["consorcio", "30d"],
      ["consorcio", "7d"],
    ]);
  });

  it("2. seed em Campanha: placar, melhores, ações, 'Todos os posts' e 'Conta do Instagram' com o gráfico do total", async () => {
    const e = entradaConteudoDa(seedDaMarca(), "all");
    carregar(e);
    const no = await pagina({ range: "all" });
    const html = renderizar(no);
    expect(textoDe(trechos(html, "p", 'data-parte="placar"')[0])).toBe(palavrasDoTexto("8 posts no período · Último post há 113 dias · Seguidores +486 (pago + orgânico)"));
    expect(textoDe(trechos(html, "h2", "data-titulo")[0])).toBe(palavrasDoTexto("Carrossel de 23/07 lidera: 93 salvos, 67 compartilhamentos"));
    expect(trechos(html, "ul", 'data-parte="acoes"')).toHaveLength(1);
    expect(resumosDosRecolhidos(html)).toEqual(["Todos os posts", "Conta do Instagram"]);
    expect(recolhido(html, "conta")).toContain("Total de seguidores · 524");
    const fr = await inspecionar(no, clientes);
    expect(fr.clients.some((x) => x.nome === "charts/time-series-chart.tsx:TimeSeriesChart")).toBe(true);
    // As ações de Campanha levam `range=all` (o padrão do Conteúdo é 30 dias).
    expect(html).toContain('href="/conteudo/producao?range=all"');
    expect(html).not.toContain("Mude o objetivo de");
    // Os chips de filtro de "Todos os posts" anunciam o estado: "Todos" ativo, os outros não.
    const chips = [...recolhido(html, "todos-os-posts")!.matchAll(/<button\b[^>]*>([^<]*)<\/button>/g)];
    expect(chips.length).toBeGreaterThan(1);
    for (const [tag, rotulo] of chips) expect(tag, rotulo).toContain(`aria-pressed="${rotulo === "Todos"}"`);
  });

  it("3. a produção em 30 dias: a linha e o recolhido das variações, um checkbox marcado por post da grade, 2 ações e a miniatura", async () => {
    const e = entradaConteudoDa(F.producaoConteudo(), "30d");
    const c = carregar(e);
    const no = await pagina({ range: "30d" });
    const html = renderizar(no);
    expect(textoDe(trechos(html, "p", 'data-parte="variacoes"')[0])).toBe(palavrasDoTexto("13 grupos de posts iguais no mesmo dia para conferir →"));
    const bloco = recolhido(html, "variacoes")!;
    expect(bloco).toBeDefined();
    expect(trechos(bloco, "li", "")).toHaveLength(13);
    // Um checkbox por post da grade, todos marcados de início; nenhum no impulsionado.
    const caixas = [...bloco.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).filter((t) => t.includes('type="checkbox"'));
    const naGrade = c.variacoes!.lista.reduce((s, g) => s + g.naGrade.length, 0);
    expect(caixas).toHaveLength(naGrade);
    for (const t of caixas) {
      expect(t).toMatch(/\bchecked\b/);
      expect(t).not.toMatch(/\bdisabled\b/);
    }
    const totalDePosts = c.variacoes!.lista.reduce((s, g) => s + g.posts.length, 0);
    expect(totalDePosts).toBe(naGrade + 1); // + o impulsionado do grupo de 12/08
    expect(bloco).toContain("impulsionado");
    // O botão diz quantos marca, sem `title`.
    expect(bloco).toContain("Marcar 2 como teste");
    expect(bloco).toContain("Marcar 7 como teste");
    expect(bloco).not.toMatch(/<button[^>]*\btitle=/);
    // O "abrir" do post, numa aba nova.
    const abrir = linksPara(bloco, "https://www.instagram.com/p/FIXTUREG064/");
    expect(abrir).toHaveLength(1);
    expect(abrir[0]).toContain('target="_blank"');
    expect(abrir[0]).toContain('rel="noopener noreferrer"');
    // 2 ações, nenhuma "Espace os posts" (há grupo de posts iguais no período).
    expect(c.acoes).toHaveLength(2);
    expect(html).not.toContain("Espace os posts");
    // A miniatura válida vira <img>; a vencida chega ao client como `url: null` (o quadrado do ícone).
    expect(html).toContain(`src="${escapar(c.melhores!.cards[0].miniatura!)}"`);
    const fr = await inspecionar(no, clientes);
    const minis = fr.clients.filter((x) => x.nome === "midia/miniatura.tsx:MiniaturaDoCriativo").map((x) => x.props.url);
    expect(minis).toEqual([c.melhores!.cards[0].miniatura, c.melhores!.cards[1].miniatura, null]);
    expect(minis[0]).toMatch(/^https:\/\/scontent\.cdninstagram\.com\/v\/fixture-101\.jpg/);
    // A legenda longa (40+ palavras) do 1º cartão: só a 1ª linha, com o link para o post.
    expect(html).toContain(">Planejamento patrimonial começa pela conta certa</a>");
  });

  it("4. semana sem post (7 dias): 'Último post há 9 dias' — nunca 'há 0 dias' (pedido 3 do plano)", async () => {
    carregar(entradaConteudoDa(F.semPostNaSemana(), "7d"));
    const html = renderizar(await pagina({ range: "7d" }));
    expect(html).toContain("Último post há 9 dias");
    expect(html).not.toContain("há 0 dias");
    expect(html).toContain("Publique hoje: 9 dias sem post da grade");
  });

  it("5. variações resolvidas: sem a linha e sem o recolhido", async () => {
    carregar(entradaConteudoDa(F.variacoesResolvidas()));
    const html = renderizar(await pagina({ range: "30d" }));
    expect(trechos(html, "p", 'data-parte="variacoes"')).toEqual([]);
    expect(html).not.toContain('id="variacoes"');
    expect(html).not.toContain('href="#variacoes"');
  });

  it("6. sem Instagram: 'Seguidores —' e sem 'Conta do Instagram'", async () => {
    carregar(entradaConteudoDa(F.semInstagram()));
    const html = renderizar(await pagina({ range: "30d" }));
    expect(trechos(html, "p", 'data-parte="placar"')[0]).toContain("Seguidores —");
    expect(resumosDosRecolhidos(html)).not.toContain("Conta do Instagram");
    expect(html).not.toContain('id="conta"');
  });

  it("7. Krone (awareness): placar e melhores, sem ações e sem o gráfico de seguidores", async () => {
    for (const e of [entradaConteudoDa(F.kroneConteudo()), entradaConteudoDa(seedDaMarca("krone"), "all")]) {
      carregar(e);
      const no = await pagina({ range: e.rangeKey });
      const html = renderizar(no);
      expect(trechos(html, "ul", 'data-parte="acoes"'), e.rangeKey).toEqual([]);
      expect(trechos(html, "p", 'data-parte="placar"')).toHaveLength(1);
      expect(trechos(html, "h2", "data-titulo")).toHaveLength(1);
      expect(resumosDosRecolhidos(html)).toContain("Conta do Instagram");
      const fr = await inspecionar(no, clientes);
      expect(fr.clients.some((x) => x.nome === "charts/time-series-chart.tsx:TimeSeriesChart")).toBe(false);
      expect(html).not.toContain("cartão Leads do Início");
    }
  });

  it("8. os títulos dos melhores (§2.4): sem interação, 1 post, empate", async () => {
    const casos: [() => EntradaConteudo, string][] = [
      [() => entradaConteudoDa(F.semInteracao()), "Nenhum post da grade teve interação no período"],
      [() => entradaConteudoDa(F.umPostDaGrade()), "1 post da grade, com 42 interações"],
      [() => entradaConteudoDa(F.empateNoTopo()), "2 posts empatam com 11 interações"],
    ];
    for (const [entrada, titulo] of casos) {
      const c = carregar(entrada());
      const html = renderizar(await pagina({ range: "30d" }));
      expect(textoDe(trechos(html, "h2", "data-titulo")[0])).toBe(palavrasDoTexto(titulo));
      if (c.melhores!.cards.length === 0) expect(trechos(html, "ul", 'data-parte="melhores"')).toEqual([]);
    }
  });

  it("9. período que ainda não começou: o placar e as ações do agora; sem melhores, sem 'Todos os posts', sem 'Conta do Instagram'", async () => {
    const e = entradaConteudoDa(seedDaMarca(), F.CHAVE_NAO_COMECOU);
    expect(e.naoComecou).toBe(true);
    const c = carregar(e);
    const html = renderizar(await pagina({ range: e.rangeKey }));
    expect(trechos(html, "p", 'data-parte="placar"')).toHaveLength(1);
    expect(c.acoes.map((a) => a.id)).toEqual(["no-recent-post", "grade-da-semana"]);
    expect(trechos(html, "ul", 'data-parte="acoes"').flatMap((u) => trechos(u, "li", ""))).toHaveLength(2);
    expect(trechos(html, "h2", "data-titulo")).toEqual([]);
    expect(resumosDosRecolhidos(html)).toEqual([]);
  });

  it("11. papel sem `data:write`: checkboxes e botão desabilitados e a linha 'Só admin e marketing marcam posts como teste.'", async () => {
    h.pode = false;
    h.user = { role: "comercial" };
    carregar(entradaConteudoDa(F.producaoConteudo(), "30d"));
    const no = await pagina({ range: "30d" });
    const html = renderizar(no);
    const bloco = recolhido(html, "variacoes")!;
    expect(bloco).toContain("Só admin e marketing marcam posts como teste.");
    const caixas = [...bloco.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]).filter((t) => t.includes('type="checkbox"'));
    expect(caixas.length).toBeGreaterThan(0);
    for (const t of caixas) expect(t).toMatch(/\bdisabled\b/);
    const botoes = [...bloco.matchAll(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?Marcar \d+ como teste<\/button>/g)].map((m) => m[0]);
    expect(botoes).toHaveLength(13);
    for (const b of botoes) expect(b.match(/^<button\b[^>]*>/)![0]).toMatch(/\bdisabled\b/);
    const fr = await inspecionar(no, clientes);
    expect(fr.clients.find((x) => x.nome === "conteudo/variacoes.tsx:VariacoesParaConferir")?.props.podeEditar).toBe(false);
    // Com `data:write`, a linha não aparece.
    h.pode = true;
    const comEscrita = recolhido(renderizar(await pagina({ range: "30d" })), "variacoes")!;
    expect(comEscrita).not.toContain("Só admin e marketing marcam posts como teste.");
  });

  it("12. o post das 21:30 de hoje (7 dias): '1 post no período · Último post hoje' e a data '13/11' na tabela", async () => {
    carregar(entradaConteudoDa(F.postDaNoite(), "7d", { agora: F.AGORA_NOITE }));
    const html = renderizar(await pagina({ range: "7d" }));
    expect(textoDe(trechos(html, "p", 'data-parte="placar"')[0]).startsWith(palavrasDoTexto("1 post no período · Último post hoje"))).toBe(true);
    const tabela = trechos(recolhido(html, "todos-os-posts")!, "table", "").join("");
    expect(tabela).toContain(">13/11<");
    expect(tabela).not.toContain(">06/11<");
  });
});

// ---------------------------------------------------------------- estático

describe("estático: a página só carrega e renderiza, a fronteira do bundle e o que saiu (§5.2)", () => {
  const raiz = process.cwd();
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf8");
  const existe = (rel: string) => fs.existsSync(path.join(raiz, rel));
  const fonteDaPagina = ler("src/app/(dashboard)/conteudo/page.tsx");
  const pastaConteudo = path.join(raiz, "src/components/conteudo");
  const componentes = fs
    .readdirSync(pastaConteudo)
    .filter((a) => /\.tsx?$/.test(a))
    .map((a) => [`src/components/conteudo/${a}`, ler(`src/components/conteudo/${a}`)] as const);

  /** Os arquivos .ts/.tsx de uma pasta, com as subpastas. */
  const arquivos = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) return arquivos(p);
      return /\.tsx?$/.test(d.name) ? [p] : [];
    });

  /** As declarações `import … from "<mod>"` (multilinha; sem os `import "x"` de efeito) de um fonte. */
  const importsDe = (fonte: string) =>
    [...fonte.matchAll(/^import\s+(?!["'])([^;]*?)\s+from\s+["']([^"']+)["']/gm)].map((x) => ({ clausula: x[1].trim(), de: x[2] }));
  /** O import traz VALOR? (não é `import type`, nem `{ type A, type B }`). */
  const deValor = (clausula: string) => {
    if (/^type\s/.test(clausula)) return false;
    const chaves = clausula.match(/^\{([\s\S]*)\}$/);
    if (!chaves) return true;
    const nomes = chaves[1].split(",").map((s) => s.trim()).filter(Boolean);
    return nomes.some((n) => !/^type\s/.test(n));
  };

  it("nem `CardDescription` nem `description=` na página e em `components/conteudo/*`", () => {
    for (const [nome, fonte] of [["page.tsx", fonteDaPagina] as const, ...componentes]) {
      expect(fonte, nome).not.toContain("CardDescription");
      expect(fonte, nome).not.toContain("description=");
    }
  });

  it("a página só carrega e renderiza: nada de store, métricas, recomendações nem kpis; lê `carregarConteudo`", () => {
    for (const m of ["@/lib/data/store", "@/lib/metrics", "@/lib/recommendations", "@/lib/kpis"]) expect(fonteDaPagina, m).not.toContain(`"${m}"`);
    expect(fonteDaPagina).toContain("@/lib/conteudo-server");
    expect(fonteDaPagina).toContain("carregarConteudo");
  });

  it("nenhum client do Conteúdo, da tabela de posts nem de Registros importa VALOR de @/lib/conteudo, @/lib/metrics ou @/lib/midia", () => {
    const alvos = [...componentes.map(([rel]) => rel), "src/components/tables/posts-table.tsx", "src/components/config/registros-forms.tsx"];
    let clients = 0;
    for (const rel of alvos) {
      const fonte = ler(rel);
      if (!/^\s*["']use client["']/.test(fonte)) continue;
      clients += 1;
      for (const imp of importsDe(fonte)) {
        if (["@/lib/conteudo", "@/lib/metrics", "@/lib/midia"].includes(imp.de)) expect(deValor(imp.clausula), `${rel}: import ${imp.clausula} from "${imp.de}"`).toBe(false);
      }
    }
    // A variação, a tabela e o formulário de Registros são clients.
    expect(clients).toBeGreaterThanOrEqual(3);
    // O que eles precisam de valor do contrato vem de `@/lib/conteudo-tela`.
    expect(importsDe(ler("src/components/tables/posts-table.tsx")).some((i) => i.de === "@/lib/conteudo-tela" && deValor(i.clausula))).toBe(true);
  });

  it("`lib/conteudo-tela.ts` só importa VALOR de ./format", () => {
    const permitidos = new Set(["./format", "@/lib/format"]);
    for (const imp of importsDe(ler("src/lib/conteudo-tela.ts"))) {
      if (deValor(imp.clausula)) expect(permitidos.has(imp.de), `import ${imp.clausula} from "${imp.de}"`).toBe(true);
    }
  });

  it("a Produção lê a grade da semana de `gradeDaSemana` (sem `weekStart` nem o 'hoje' em UTC)", () => {
    const producao = ler("src/app/(dashboard)/conteudo/producao/page.tsx");
    expect(producao).toContain("gradeDaSemana");
    expect(producao).not.toMatch(/\bweekStart\b/);
    expect(producao).not.toContain("new Date().toISOString().slice(0, 10)");
  });

  it("a Produção inteira conta o post no dia de Brasília: a nota do servidor, a prévia da página e as datas exibidas", () => {
    // A nota gravada (`contextFor`) usa o MESMO dia da prévia do validador na página.
    const actions = ler("src/app/(dashboard)/conteudo/producao/actions.ts");
    expect(actions).toContain("diaDoPost(p)");
    expect(actions).not.toMatch(/\bdayOf\(/);
    expect(ler("src/app/(dashboard)/conteudo/producao/page.tsx")).not.toMatch(/\bdayOf\(/);
    // A data ao lado da sugestão "mesmo dia e formato" e das peças publicadas: nunca o prefixo UTC.
    for (const rel of ["src/components/producao/producao-board.tsx", "src/components/producao/outcomes-panel.tsx"]) {
      const fonte = ler(rel);
      expect(fonte, rel).not.toContain("publishedAt.slice(0, 10)");
      expect(fonte, rel).toContain("diaDoPost(");
    }
    // As variações agrupam pelo `diaDoPost` (o `diaBrt` dependia do fuso do processo e lançava com "+00").
    expect(ler("src/lib/conteudo.ts")).not.toMatch(/\bdiaBrt\(/);
  });

  it("os chips de filtro de 'Todos os posts' anunciam o estado (aria-pressed)", () => {
    const fonte = ler("src/components/tables/posts-table.tsx");
    const chip = fonte.slice(fonte.indexOf("function Chip("));
    expect(chip).toMatch(/<button[\s\S]*?aria-pressed=\{ativo\}[\s\S]*?>/);
  });

  it("os arquivos que saíram não existem (a vista Posts, o KpiComDica e o card antigo das variações)", () => {
    for (const rel of ["src/app/(dashboard)/conteudo/posts/page.tsx", "src/components/conteudo/kpi-com-dica.tsx", "src/components/conteudo/variacoes-card.tsx"]) {
      expect(existe(rel), rel).toBe(false);
    }
  });

  it("os redirects: /conteudo/posts e /posts caem em /conteudo (um 307 só; nenhum destino com #)", async () => {
    const r = await nextConfig.redirects!();
    expect(r).toContainEqual({ source: "/conteudo/posts", destination: "/conteudo", permanent: false });
    expect(r).toContainEqual({ source: "/posts", destination: "/conteudo", permanent: false });
    for (const x of r) expect(x.destination, x.source).not.toContain("#");
    // Nenhuma cadeia: o destino de um redirect não é a origem de outro.
    const origens = new Set(r.map((x) => x.source));
    for (const x of r) expect(origens.has(x.destination), `${x.source} → ${x.destination}`).toBe(false);
  });

  it("a navegação: Conteúdo = Posts · Registros; a Produção fora das abas; sem `playbookOnly`", () => {
    const item = NAV.find((n) => n.href === "/conteudo")!;
    expect(item.vistas?.map((v) => v.label)).toEqual(["Posts", "Registros"]);
    expect(item.vistas?.map((v) => v.href)).toEqual(["/conteudo", "/conteudo/registros"]);
    expect((item.vistas ?? []).some((v) => v.href.startsWith("/conteudo/producao"))).toBe(false);
    expect(ler("src/components/layout/nav-items.ts")).not.toContain("playbookOnly");
  });

  it("nenhum arquivo de `src` fala dos cliques no link da bio, das funções que saíram ou da regra de stories", () => {
    const proibidos = ["Cliques no link da bio", "cliques_link_bio", "buildProfileClickFunnel", "dias-sem-story", "weeklyDmSeries", "igEngagementSeries"];
    for (const a of arquivos(path.join(raiz, "src"))) {
      if (a.split(path.sep).includes("__tests__")) continue;
      const fonte = fs.readFileSync(a, "utf8");
      for (const p of proibidos) expect(fonte.includes(p), `${path.relative(raiz, a)}: ${p}`).toBe(false);
    }
  });

  it("em `lib/metrics.ts`, `dayOf(p.publishedAt)` só na junção com as linhas diárias (`followersAt`)", () => {
    const linhas = ler("src/lib/metrics.ts").split(/\r?\n/).filter((l) => l.includes("dayOf(p.publishedAt)"));
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain("followersAt");
  });
});
