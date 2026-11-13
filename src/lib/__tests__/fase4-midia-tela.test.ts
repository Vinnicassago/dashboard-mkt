/**
 * Fase 4 (§5.6 da spec) — a Mídia na TELA, a partir da página de verdade
 * (`app/(dashboard)/midia/page.tsx`) com o carregador trocado por um objeto montado pela
 * função pura (`montarMidiaDaTela`) sobre o seed e sobre a forma da produção de 12/11
 * (`fixtures-midia`). No molde de `fase3-funil-tela.test.ts`, com os helpers de
 * `src/test/tela.ts`.
 *
 *   • LGPD e fronteira: a árvore que o servidor manda não tem telefone, e-mail NEM NOME
 *     de lead (os leads se chamam "Pessoa-midia-NN-zq", K26); nenhuma função cruza; os
 *     clients formam uma lista FECHADA; cada client recebe só as props do contrato.
 *   • TEXTO (§2.7, K36): resumo ≤ 20, conferir ≤ 4, títulos ≤ 30 (cada ≤ 15), robô ≤ 6,
 *     cartões ≤ 125 (cada ≤ 25), "ver todos" ≤ 5, recolhidos ≤ 8, total ≤ 200 e = Σ das
 *     partes; nenhuma frase > 25 — também DENTRO dos ⓘ montados pela lib.
 *   • ÂNCORAS (K37): todo id com `scroll-mt-24`; `#conjuntos` dentro de "Detalhes".
 *   • NÚMEROS: o resumo é o do Início (o investimento de conversão, o CPL e o fato do
 *     custo por reunião, K5); o "fora das linhas" é UM texto (K33); cartão = linha de
 *     Detalhes; nada nos dois lados (Detalhes × Pausados, K39).
 *   • O recorte da live decide pela CHAVE (K8).
 *
 * O banco do robô não é lido em lugar nenhum do `src` (trava em `robo-client.test.ts`).
 */
import fs from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chavesDaLive } from "../atalho-live";
import { criativosDaLive } from "../criativos-live";
import { formatCurrency0, formatInt } from "../format";
import { custoExibivel, fatoDoCustoPorReuniao, mostrar } from "../kpis";
import { montarInicio } from "../inicio";
import { LIVE_PADRAO } from "../live";
import { conjuntosPorId, foraDasLinhasDeConversao, montarMidiaDaTela, textoDaReguaDaFadiga, textoDosForaDasLinhas } from "../midia";
import type { EntradaMidia, LinhaMidia, MidiaDaTela } from "../midia-tela";
import { ORDEM_DO_SINAL, textoDaReguaDoSinal } from "../sinal-do-criativo";
import { refDaVeiculacao } from "../veiculacao";
import { fimDoPeriodo } from "../metrics";
import { CHAVES_PROIBIDAS, blocos, componentesClient, conferirLgpd, inspecionar, palavras, trechos } from "@/test/tela";
import {
  HOJE,
  IDS,
  comCandidatoPeloRobo,
  comLeituraParada,
  comLive,
  comNaoResponde,
  comPisoDeGasto,
  comReunioes,
  comReunioesSoPorNome,
  comRoboDesligado,
  comSemTelefone,
  piorCasoDeTexto,
  producaoSemana,
  type SemanaDaMidia,
} from "@/test/fixtures-midia";
import { entradaInicioDa, entradaMidiaDa, semanaDoSeed } from "@/test/entrada-midia";

// ---------------------------------------------------------------- dublês da página

const h = vi.hoisted(() => ({
  user: { role: "admin" } as null | { role: string },
  brand: "consorcio",
  carregado: null as unknown,
}));
const carregarMidia = vi.hoisted(() => vi.fn<(marca: string, range?: string) => Promise<unknown>>(async () => h.carregado));

vi.mock("next/navigation", () => ({
  usePathname: () => "/midia",
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
// Componente client (o painel de alertas do layout); aqui só importam as props que ele recebe.
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
vi.mock("@/lib/live-server", () => ({ campanhaDaLive: async () => LIVE_PADRAO }));
vi.mock("@/lib/auth/guard", () => ({ can: async () => true }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: () => false }));
vi.mock("@/lib/data/store", () => ({ getData: vi.fn(), listResumosSemanais: vi.fn(async () => []), listConferencias: vi.fn(async () => []) }));
// O carregador da Mídia: devolve o objeto montado pela função pura e grava com que argumentos foi chamado.
vi.mock("@/lib/midia-server", () => ({ carregarMidia }));
// O recorte da live (K8): espia com que {de, ate} a Mídia chama a conta congelada (sem mudar o que ela faz).
vi.mock("@/lib/criativos-live", async (orig) => {
  const m = await orig<typeof import("@/lib/criativos-live")>();
  return { ...m, criativosDaLive: vi.fn(m.criativosDaLive) };
});

// ---------------------------------------------------------------- utilidades

const ORCAMENTO_MIDIA = { total: 200, resumo: 20, conferir: 4, titulos: 30, robo: 6, criativos: 125, verTodos: 5, recolhidos: 8 };

/** Os ÚNICOS componentes client da Mídia: um client novo, de qualquer pasta, quebra aqui. ConferenciaGerenciador NÃO está (mora em Configurações). */
const CLIENTS_PERMITIDOS = [
  "ui/info.tsx:Info",
  "ui/rolar-para-ancora.tsx:RolarParaAncora",
  "midia/miniatura.tsx:MiniaturaDoCriativo",
  "midia/conjuntos-table.tsx:ConjuntosTable",
  "tables/creatives-table.tsx:CreativesTable",
  "midia/tendencia-semanal.tsx:TendenciaSemanal",
  "charts/barras-diarias.tsx:BarrasDiarias",
  "next/link",
  "layout/alertas:RegistrarAlertas",
];
/** "nome" NÃO entra: é o nome do criativo e do conjunto. `fora`/`porConjunto` são internos (a chave `live` do robô e os leads por conjunto). */
const PROIBIDAS = [...CHAVES_PROIBIDAS, "name", "leadId", "lostReasonDetail", "utmContent", "roboSessionId", "fora", "porConjunto"];

/** Os `rotulo` de todos os `Info` da página (§2.5, K24) — mais "Sobre o sinal de {nome}". */
const ROTULOS = new Set([
  "Sobre o resumo",
  "Sobre para onde vai a verba",
  "Sobre os criativos no ar",
  "Sobre os criativos da live",
  "Sobre os pausados",
  "Sobre os detalhes",
  "Sobre a tendência semanal",
  "Sobre os conjuntos de conversão",
  "Sobre os criativos de conversão",
  "Sobre a descoberta",
  "Sobre o alcance somado",
  "Sobre o custo por mil alcançados",
  "Sobre o investimento por dia",
]);

/** As âncoras da página (§2.1): todas com `scroll-mt-24` (K37). */
const ANCORAS = ["resumo", "conferir", "verba", "criativos", "criativos-live", "pausados", "detalhes", "conjuntos", "criativos-tabela"];

let clientes: Map<unknown, string>;
beforeAll(async () => {
  clientes = await componentesClient();
});
afterEach(() => {
  vi.mocked(criativosDaLive).mockClear();
});

async function pagina(sp: Record<string, string | string[] | undefined>) {
  const { default: MidiaPage } = await import("@/app/(dashboard)/midia/page");
  return MidiaPage({ searchParams: Promise.resolve(sp) } as never);
}

const renderizar = (no: unknown) => renderToStaticMarkup(no as ReactElement);

function carregar(e: EntradaMidia): MidiaDaTela {
  const midia = montarMidiaDaTela(e);
  h.brand = e.marca;
  h.carregado = { rangeKey: e.rangeKey, midia };
  return midia;
}

const nPalavras = (t: string) => t.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p)).length;
const frases = (t: string) => t.split(/(?<=[.!?])\s+/).filter((f) => f.trim() !== "");
const sp = (t: string) => t.replace(/ /g, " ");
const conjuntosDe = (linhas: LinhaMidia[]) => linhas.flatMap((c) => c.conjuntos ?? []);

/** As partes medidas da página (§2.7). */
function partes(html: string) {
  const ul = trechos(html, "ul", 'data-parte="criativos"');
  return {
    total: palavras(html),
    resumo: trechos(html, "p", 'data-parte="resumo"').flatMap(palavras),
    conferir: trechos(html, "p", 'data-parte="conferir"').flatMap(palavras),
    titulos: trechos(html, "h2", "data-titulo").flatMap(palavras),
    robo: trechos(html, "p", 'data-parte="robo"').flatMap(palavras),
    criativos: ul.flatMap(palavras),
    verTodos: trechos(html, "p", 'data-parte="ver-todos"').flatMap(palavras),
    recolhidos: trechos(html, "details", 'data-parte="recolhido"').flatMap(palavras),
    cadaTitulo: trechos(html, "h2", "data-titulo").map(palavras),
    cadaCartao: ul.flatMap((u) => trechos(u, "li", "")).map(palavras),
  };
}

/** O texto de um elemento (as palavras, juntas). */
const textoDe = (trecho: string | undefined) => (trecho ? palavras(trecho).join(" ") : "");
/** As palavras de um texto puro, com a régua de `palavras` (o texto é escapado como o React escaparia). */
const palavrasDoTexto = (t: string) => palavras(`<i>${t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</i>`).join(" ");

/** Os `<summary>` dos recolhidos, na ordem. */
const resumosDosRecolhidos = (html: string) =>
  [...html.matchAll(/<details[^>]*data-parte="recolhido"[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => palavras(`<i>${m[1]}</i>`).join(" "));

/** A tag de abertura do elemento com `id`. */
const tagDoId = (html: string, id: string) => html.match(new RegExp(`<[a-z][a-z0-9]*\\b[^>]*\\bid="${id}"[^>]*>`))?.[0];

/** Todas as dicas montadas pela lib (§2.7: nenhuma frase > 25 dentro de um ⓘ, K36). */
function dicasDe(m: MidiaDaTela): [string, string][] {
  const d = m.detalhes;
  return [
    ["resumo", m.resumo.dica],
    ["verba", m.verba?.dica ?? ""],
    ["criativos", m.criativos?.dica ?? ""],
    ...(m.criativos?.todos ?? []).map((c): [string, string] => [`cartão ${c.nomeCompleto}`, c.dica]),
    ["live", m.live?.dica ?? ""],
    ["pausados", m.pausados?.dica ?? ""],
    ["detalhes", d.dica],
    ["tendência", d.tendencia.dica],
    ["conjuntos", d.conjuntos.dica],
    ["criativos de conversão", d.criativos.dica],
    ["descoberta", d.descoberta?.dica ?? ""],
    ["alcance somado", d.descoberta?.dicaAlcance ?? ""],
    ["custo por mil alcançados", d.descoberta?.dicaCustoPorMil ?? ""],
    ["investimento por dia", d.diario.dica],
  ];
}

// ---------------------------------------------------------------- os casos

interface Caso {
  nome: string;
  entrada: () => EntradaMidia;
  /** A URL da página (padrão: `?range=<rangeKey>`). */
  url?: Record<string, string>;
}

const da = (p: () => SemanaDaMidia, chave = "7d") => () => entradaMidiaDa(p(), chave);

const CASOS: Caso[] = [
  { nome: "seed · URL limpa (7 dias: o vazio)", entrada: da(() => semanaDoSeed("consorcio")), url: {} },
  { nome: "seed · campanha", entrada: da(() => semanaDoSeed("consorcio"), "all") },
  { nome: "seed · julho (período livre)", entrada: da(() => semanaDoSeed("consorcio"), "2026-07-01..2026-07-31") },
  { nome: "produção · 7d", entrada: da(producaoSemana) },
  { nome: "produção · campanha", entrada: da(producaoSemana, "all") },
  { nome: "leitura do robô parada", entrada: da(comLeituraParada) },
  { nome: "robô desligado", entrada: da(comRoboDesligado) },
  { nome: "candidato pelo robô", entrada: da(comCandidatoPeloRobo) },
  { nome: "9 maduros sem resposta", entrada: da(() => comNaoResponde(9)) },
  { nome: "sem telefone", entrada: da(comSemTelefone) },
  { nome: "3 reuniões por id", entrada: da(() => comReunioes(3)) },
  { nome: "2 reuniões só pelo nome", entrada: da(() => comReunioesSoPorNome(2)) },
  { nome: "piso de gasto", entrada: da(comPisoDeGasto) },
  { nome: "live · 7d", entrada: da(comLive) },
  { nome: "live · chave da campanha", entrada: da(comLive, chavesDaLive(LIVE_PADRAO).campanha) },
  { nome: "período que ainda não começou", entrada: da(producaoSemana, "2026-11-20..2026-11-25") },
  { nome: "pior caso de texto", entrada: da(piorCasoDeTexto) },
  { nome: "awareness por URL direta", entrada: da(() => semanaDoSeed("krone"), "all") },
];

// ---------------------------------------------------------------- LGPD e a fronteira

describe("LGPD: o que a página da Mídia manda para os componentes client", () => {
  for (const c of CASOS) {
    it(c.nome, async () => {
      const e = c.entrada();
      const m = carregar(e);
      const fr = await inspecionar(await pagina(c.url ?? { range: e.rangeKey }), clientes);
      // Nem nome, nem o ID do lead pelo valor (a Mídia é só agregado por linha).
      conferirLgpd(fr, e.data.leads, { semNomes: true, semIds: true, proibidas: PROIBIDAS });
      // A lista FECHADA de clients.
      const nomes = new Set(fr.clients.map((x) => x.nome));
      for (const n of nomes) expect(CLIENTS_PERMITIDOS, `client fora da lista: ${n}`).toContain(n);
      for (const n of ["ui/info.tsx:Info", "ui/rolar-para-ancora.tsx:RolarParaAncora", "layout/alertas:RegistrarAlertas"]) expect(nomes.has(n), n).toBe(true);
      const props = (nome: string) => fr.clients.filter((x) => x.nome === nome).map((x) => x.props);
      // RolarParaAncora: exatamente { abrirDetalhes: true }.
      for (const p of props("ui/rolar-para-ancora.tsx:RolarParaAncora")) expect(p).toEqual({ abrirDetalhes: true });
      // Os gráficos recebem só os pontos.
      for (const p of props("midia/tendencia-semanal.tsx:TendenciaSemanal")) {
        expect(Object.keys(p)).toEqual(["pontos"]);
        expect((p.pontos as unknown[]).length).toBe(m.detalhes.tendencia.pontos.length);
      }
      for (const p of props("charts/barras-diarias.tsx:BarrasDiarias")) expect(Object.keys(p).sort()).toEqual(["dados", "faixas", "valueFormat", "yFormat"]);
      // As tabelas: só as linhas, o balde, as colunas do robô e o piso do gasto (UM valor
      // cada para a página) e a régua.
      const regras = { sinal: textoDaReguaDoSinal(), fadiga: textoDaReguaDaFadiga() };
      for (const p of props("tables/creatives-table.tsx:CreativesTable")) {
        expect(Object.keys(p).sort()).toEqual(["bucket", "colunasDoRobo", "linhas", "piso", "regras"]);
        expect(p.colunasDoRobo).toBe(m.colunasDoRobo);
        expect(p.piso).toBe(m.pisoDeGasto);
        expect(p.regras).toEqual(regras);
      }
      for (const p of props("midia/conjuntos-table.tsx:ConjuntosTable")) {
        expect(Object.keys(p).sort()).toEqual(["bucket", "colunasDoRobo", "linhas", "piso"]);
        expect(p.colunasDoRobo).toBe(m.colunasDoRobo);
        expect(p.piso).toBe(m.pisoDeGasto);
      }
      // As tabelas de Pausados são as MESMAS de Detalhes (com as linhas fora do ar).
      if (m.pausados) {
        const cri = props("tables/creatives-table.tsx:CreativesTable").filter((p) => p.bucket === "conversao");
        const conj = props("midia/conjuntos-table.tsx:ConjuntosTable").filter((p) => p.bucket === "conversao");
        if (m.pausados.criativos.length > 0) expect(cri.length).toBeGreaterThanOrEqual(2);
        if (m.pausados.conjuntos.length > 0) expect(conj.length).toBeGreaterThanOrEqual(2);
      }
      // A miniatura: só a url e o formato.
      for (const p of props("midia/miniatura.tsx:MiniaturaDoCriativo")) expect(Object.keys(p).sort()).toEqual(["formato", "url"]);
      expect(props("midia/miniatura.tsx:MiniaturaDoCriativo")).toHaveLength(m.criativos?.cards.length ?? 0);
      // Todo ⓘ com rótulo próprio, da tabela do §2.5 (K24).
      for (const p of props("ui/info.tsx:Info")) {
        expect(typeof p.rotulo, JSON.stringify(p)).toBe("string");
        expect(p.rotulo).not.toBe("O que é isto?");
        const r = p.rotulo as string;
        expect(ROTULOS.has(r) || r.startsWith("Sobre o sinal de "), r).toBe(true);
      }
      for (const card of m.criativos?.cards ?? []) {
        expect(props("ui/info.tsx:Info").some((p) => p.rotulo === `Sobre o sinal de ${card.nomeCompleto}` && p.texto === card.dica), card.nomeCompleto).toBe(true);
      }
      // O que o ⚠ recebe é o `alertas` do objeto.
      const reg = props("layout/alertas:RegistrarAlertas")[0];
      expect((reg.alertas as { id: string }[]).map((a) => a.id)).toEqual(m.alertas.map((a) => a.id));
      // `todos` (os cartões que a página não desenha) nunca cruza.
      expect(JSON.stringify(fr.clients)).not.toContain('"todos"');
    });
  }
});

// ---------------------------------------------------------------- o texto

describe("o orçamento de texto (§2.7, K36)", () => {
  for (const c of CASOS) {
    it(c.nome, async () => {
      const e = c.entrada();
      const m = carregar(e);
      const html = renderizar(await pagina(c.url ?? { range: e.rangeKey }));
      const p = partes(html);
      const conta = {
        total: p.total.length,
        resumo: p.resumo.length,
        conferir: p.conferir.length,
        titulos: p.titulos.length,
        robo: p.robo.length,
        criativos: p.criativos.length,
        verTodos: p.verTodos.length,
        recolhidos: p.recolhidos.length,
      };
      for (const [k, max] of Object.entries(ORCAMENTO_MIDIA)) {
        expect(conta[k as keyof typeof conta], `${k}: ${JSON.stringify(p[k as keyof typeof conta])}`).toBeLessThanOrEqual(max);
      }
      // Nada escapa de parte medida: nenhuma descrição solta.
      expect(conta.total, JSON.stringify(p.total)).toBe(
        conta.resumo + conta.conferir + conta.titulos + conta.robo + conta.criativos + conta.verTodos + conta.recolhidos,
      );
      for (const t of p.cadaTitulo) expect(t.length, t.join(" ")).toBeLessThanOrEqual(15);
      for (const li of p.cadaCartao) expect(li.length, li.join(" ")).toBeLessThanOrEqual(25);
      expect(Math.max(0, ...blocos(html).map((b) => b.length))).toBeLessThanOrEqual(25);
      // Nenhum `title=` com mais de 3 palavras fora das tabelas e do bloco congelado da live.
      const semTabelas = html.replace(/<details[^>]*id="criativos-live"[\s\S]*?<\/details>/g, "").replace(/<table[\s\S]*?<\/table>/g, "");
      for (const t of semTabelas.matchAll(/\btitle="([^"]*)"/g)) expect(nPalavras(t[1]), t[1]).toBeLessThanOrEqual(3);
      // Nenhum <p> dentro de lista; nenhum <details> aberto pelo servidor.
      for (const lista of [...trechos(html, "ol", ""), ...trechos(html, "ul", "")]) expect(lista).not.toMatch(/<p[\s>]/);
      expect(html).not.toMatch(/<details[^>]*\sopen/);
      // Os recolhidos, na ordem, com o rótulo de navegação (sem número de resposta).
      expect(resumosDosRecolhidos(html)).toEqual(
        [m.live ? "Criativos da live 01/12" : null, m.pausados ? "Pausados no período" : null, "Detalhes"].filter(Boolean),
      );
      // Os títulos visíveis são os do objeto; nenhum é "Verba × leads: …" (K32).
      const h2 = trechos(html, "h2", "data-titulo").map(textoDe);
      const esperados = [m.verba?.titulo, m.criativos?.titulo].filter((t): t is string => Boolean(t)).map(palavrasDoTexto);
      expect(h2).toEqual(esperados);
      for (const t of [m.verba?.titulo, m.criativos?.titulo]) if (t) expect(t.startsWith("Verba × leads"), t).toBe(false);
      // O resumo e a linha do robô são os do objeto.
      expect(textoDe(trechos(html, "p", 'data-parte="resumo"')[0])).toBe(palavrasDoTexto(m.resumo.texto));
      const robo = trechos(html, "p", 'data-parte="robo"');
      if (m.criativos?.leituraParada) expect(textoDe(robo[0])).toBe(palavrasDoTexto(m.criativos.leituraParada));
      else expect(robo).toEqual([]);
      // Toda frase de todo ⓘ montado pela lib ≤ 25 (K36).
      for (const [onde, d] of dicasDe(m)) for (const f of frases(d)) expect(nPalavras(f), `${onde}: ${f}`).toBeLessThanOrEqual(25);
      // Cartões: nome ≤ 8 palavras (+ "…"), desambiguação ≤ 4, linha ≤ 10; no máximo 5.
      expect(m.criativos?.cards.length ?? 0).toBeLessThanOrEqual(5);
      for (const card of m.criativos?.todos ?? []) {
        expect(nPalavras(card.nome), card.nome).toBeLessThanOrEqual(8);
        // O nome CRU (cortado com "…") é o começo do rótulo inteiro (`rotuloCriativoAgregado`).
        expect(card.nomeCompleto.startsWith(card.nome.replace(/…$/, "")), `${card.nome} × ${card.nomeCompleto}`).toBe(true);
        if (card.desambiguacao) expect(nPalavras(card.desambiguacao), card.desambiguacao).toBeLessThanOrEqual(4);
        if (card.linha) expect(nPalavras(card.linha), card.linha).toBeLessThanOrEqual(10);
      }
    });
  }

  it("o pior caso de texto: cada parte cabe no orçamento e o total é a soma (a conta do fixture)", async () => {
    const e = entradaMidiaDa(piorCasoDeTexto());
    const m = carregar(e);
    expect(m.criativos!.todos.length).toBeGreaterThan(5);
    expect(m.criativos!.leituraParada).not.toBeNull();
    expect(m.criativos!.titulo).toContain("no ar em 11/11");
    expect(m.verba!.titulo.endsWith(" ⚠")).toBe(true);
    for (const card of m.criativos!.todos) expect(card.desambiguacao, card.nomeCompleto).not.toBeNull();
    const html = renderizar(await pagina({ range: e.rangeKey }));
    const p = partes(html);
    const conta = Object.fromEntries(Object.keys(ORCAMENTO_MIDIA).map((k) => [k, (p[k as keyof typeof ORCAMENTO_MIDIA] as string[]).length]));
    console.info("[fase4-midia-tela] pior caso de texto:", JSON.stringify(conta));
    for (const [k, max] of Object.entries(ORCAMENTO_MIDIA)) expect(conta[k], k).toBeLessThanOrEqual(max);
    expect(conta.total).toBe(conta.resumo + conta.conferir + conta.titulos + conta.robo + conta.criativos + conta.verTodos + conta.recolhidos);
    expect(conta.verTodos).toBeGreaterThan(0);
    expect(conta.robo).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- âncoras e links

describe("âncoras e links (K27, K34, K37)", () => {
  for (const c of CASOS) {
    it(c.nome, async () => {
      const e = c.entrada();
      const m = carregar(e);
      const html = renderizar(await pagina(c.url ?? { range: e.rangeKey }));
      const exigidas = [
        "resumo",
        "detalhes",
        ...(m.conferir ? ["conferir"] : []),
        ...(m.verba ? ["verba"] : []),
        ...(m.criativos ? ["criativos", "conjuntos", "criativos-tabela"] : []),
        ...(m.pausados ? ["pausados"] : []),
        ...(m.live ? ["criativos-live"] : []),
      ];
      for (const id of exigidas) expect(tagDoId(html, id), `#${id}`).toBeDefined();
      for (const id of ANCORAS) {
        const tag = tagDoId(html, id);
        if (tag) expect(tag, `#${id}`).toMatch(/\bscroll-mt-24\b/);
      }
      // #conjuntos e #criativos-tabela moram DENTRO de "Detalhes" (o último bloco da página).
      const inicioDosDetalhes = html.search(/<details[^>]*\bid="detalhes"/);
      expect(inicioDosDetalhes).toBeGreaterThan(-1);
      for (const id of ["conjuntos", "criativos-tabela"]) {
        const i = html.indexOf(`id="${id}"`);
        if (i >= 0) expect(i, id).toBeGreaterThan(inicioDosDetalhes);
      }
      // Conferir com o Gerenciador → Configurações → Integrações, com o período.
      if (m.conferir) {
        expect(m.conferir.rotulo).toBe("Conferir com o Gerenciador →");
        const p = trechos(html, "p", 'data-parte="conferir"')[0];
        expect(p).toContain(`href="${m.conferir.href.replace(/&/g, "&amp;")}"`);
        expect(textoDe(p)).toBe("Conferir com o Gerenciador");
      } else expect(trechos(html, "p", 'data-parte="conferir"')).toEqual([]);
      // "Ver todos os N criativos →": só com mais de 5 no ar; N = as linhas da tabela que o link abre (K34).
      const verTodos = trechos(html, "p", 'data-parte="ver-todos"');
      if (m.criativos && m.criativos.todos.length > 5) {
        const n = m.criativos.todos.length;
        expect(n).toBe(m.detalhes.criativos.conversao.length);
        expect(m.criativos.verTodos).toEqual({ texto: `Ver todos os ${n} criativos →`, href: "#criativos-tabela" });
        expect(verTodos[0]).toContain('href="#criativos-tabela"');
        expect(textoDe(verTodos[0])).toBe(`Ver todos os ${n} criativos`);
      } else {
        expect(m.criativos?.verTodos ?? null).toBeNull();
        expect(verTodos).toEqual([]);
      }
      // Nada nos dois lados (K39): nenhum conjunto nem criativo em Detalhes E em Pausados.
      if (m.pausados) {
        const noAr = new Set([...conjuntosDe(m.detalhes.conjuntos.conversao).map((l) => l.chave), ...m.detalhes.criativos.conversao.map((l) => l.chave)]);
        for (const l of [...conjuntosDe(m.pausados.conjuntos), ...m.pausados.criativos]) expect(noAr.has(l.chave), l.nome).toBe(false);
      }
      // Detalhes só com o que está no ar; Pausados só com o que não está.
      for (const l of [...conjuntosDe(m.detalhes.conjuntos.conversao), ...m.detalhes.criativos.conversao]) expect(l.veiculacao.estado, l.nome).toBe("no-ar");
      for (const l of [...conjuntosDe(m.pausados?.conjuntos ?? []), ...(m.pausados?.criativos ?? [])]) expect(l.veiculacao.estado, l.nome).not.toBe("no-ar");
    });
  }

  it("o href do conferir: `?range=7d` na URL limpa; sem `range` em Campanha (o padrão de Configurações)", () => {
    expect(montarMidiaDaTela(entradaMidiaDa(semanaDoSeed("consorcio"), "7d")).conferir?.href).toBe("/configuracoes/integracoes?range=7d#conferir-gasto");
    expect(montarMidiaDaTela(entradaMidiaDa(semanaDoSeed("consorcio"), "all")).conferir?.href).toBe("/configuracoes/integracoes#conferir-gasto");
  });
});

// ---------------------------------------------------------------- os casos, um a um

describe("os casos da tela (§5.6)", () => {
  it("1. seed com a URL limpa: o carregador recebe (marca, undefined) e a tela é a de 7 dias — o vazio em uma linha", async () => {
    // O seed fica em julho e não tem registro de sync: os 7 dias até 12/11 não têm cobertura —
    // zero com buraco de cobertura não é "nenhum gasto" (K6, ADR-06).
    const e = entradaMidiaDa(semanaDoSeed("consorcio"), "7d");
    expect(e.kpis.investimento.valor).toBe(0);
    expect(e.kpis.investimento.confianca?.nivel).toBe("piso");
    const m = carregar(e);
    carregarMidia.mockClear();
    const html = renderizar(await pagina({}));
    expect(carregarMidia.mock.calls).toEqual([["consorcio", undefined]]);
    expect(e.rangeKey).toBe("7d");
    expect(m.resumo.texto).toBe("Sem dados de gasto no período ⚠");
    // Com o sync cobrindo a semana, o mesmo vazio é "Nenhum gasto no período".
    const coberto = montarMidiaDaTela(entradaMidiaDa(semanaDoSeed("consorcio", "2026-11-12", [{ from: "2026-07-01", to: "2026-11-12" }]), "7d"));
    expect(coberto.resumo.texto).toBe("Nenhum gasto no período");
    expect(m.verba).toBeNull();
    expect(m.criativos).toBeNull();
    expect(resumosDosRecolhidos(html)).toEqual(["Detalhes"]);
    // Com ?range=7d o carregador recebe a chave.
    carregarMidia.mockClear();
    await pagina({ range: "7d" });
    expect(carregarMidia.mock.calls).toEqual([["consorcio", "7d"]]);
  });

  it("2. seed em Campanha e em julho (período livre): os títulos dizem 'no ar em 23/07' (sem sync, K7)", () => {
    for (const chave of ["all", "2026-07-01..2026-07-31"]) {
      const m = montarMidiaDaTela(entradaMidiaDa(semanaDoSeed("consorcio"), chave));
      expect(m.criativos, chave).not.toBeNull();
      expect(m.criativos!.titulo, chave).toContain("no ar em 23/07");
      expect(m.resumo.texto, chave).toMatch(/investidos em conversão/);
    }
  });

  it("3. a produção: o Carrossel da Aurora é o candidato da D9, os dois 'Carrossel -' se distinguem, o que parou não tem cartão", () => {
    const m = montarMidiaDaTela(entradaMidiaDa(producaoSemana()));
    expect(m.colunasDoRobo).toBe(true);
    expect(m.roboNosCriativos).toBe("ok");
    const aurora = m.criativos!.todos.find((c) => c.chave === IDS.criativo.carrosselAurora)!;
    expect(aurora.sinal).toMatchObject({ id: "candidato", rotulo: "Candidato a escalar", tom: "ok-vazado" });
    expect(aurora.linha).toBe("sinal de topo de funil, ainda sem reunião");
    expect(m.criativos!.titulo).toBe("4 criativos no ar · 1 candidato a escalar");
    // A ordem dos cartões: pelo sinal e, no mesmo sinal, pelo gasto.
    const ordem = m.criativos!.todos.map((c) => ORDEM_DO_SINAL[c.sinal.id]);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(m.criativos!.pausados).toBe(1);
    expect(m.criativos!.todos.some((c) => c.chave === IDS.criativo.post6)).toBe(false);
  });

  it("4. leitura parada: a linha do robô e '≥ N' nos cartões", () => {
    const m = montarMidiaDaTela(entradaMidiaDa(comLeituraParada()));
    expect(m.criativos!.leituraParada).toBe("Robô sem leitura desde 12/11 12:30 ⚠");
    const comRobo = m.criativos!.cards.filter((c) => c.robo);
    expect(comRobo.length).toBeGreaterThan(0);
    expect(comRobo.some((c) => Object.values(c.robo!).some((t) => t.startsWith("≥ ")))).toBe(true);
    for (const c of comRobo) for (const t of Object.values(c.robo!)) expect(t).not.toContain("%");
  });

  it("5. robô desligado: sem as colunas do robô e sem a 2ª tabela dos cartões", () => {
    const m = montarMidiaDaTela(entradaMidiaDa(comRoboDesligado()));
    expect(m.colunasDoRobo).toBe(false);
    expect(m.roboNosCriativos).toBe("robo-desligado");
    for (const c of m.criativos!.todos) expect(c.robo).toBeNull();
    expect(m.criativos!.dica).toContain("Sem as colunas do robô: robô desligado nesta marca.");
  });

  it("6. candidato pelo robô: 'responde ao robô, ainda sem reunião'", () => {
    const m = montarMidiaDaTela(entradaMidiaDa(comCandidatoPeloRobo()));
    const aurora = m.criativos!.todos.find((c) => c.chave === IDS.criativo.carrosselAurora)!;
    expect(aurora.sinal.id).toBe("candidato");
    expect(aurora.ressalva).toBe("responde ao robô, ainda sem reunião");
    expect(aurora.robo).not.toBeNull();
  });

  it("7. o recorte da live decide pela CHAVE (K8): 7, 30 dias e Campanha dão o MESMO bloco; o período livre recorta", async () => {
    const p = comLive();
    const live = (chave: string) => {
      vi.mocked(criativosDaLive).mockClear();
      const m = montarMidiaDaTela(entradaMidiaDa(p, chave));
      const chamadas = vi.mocked(criativosDaLive).mock.calls;
      expect(chamadas, chave).toHaveLength(1);
      return { m, rangeLive: chamadas[0][2] };
    };
    const seteDias = live("7d");
    expect(seteDias.m.live).not.toBeNull();
    expect(seteDias.rangeLive).toEqual({ de: LIVE_PADRAO.periodo.de, ate: p.hoje });
    for (const chave of ["30d", "all"]) {
      const outro = live(chave);
      expect(outro.rangeLive, chave).toEqual(seteDias.rangeLive);
      expect(outro.m.live!.r, chave).toEqual(seteDias.m.live!.r);
    }
    // A chave da campanha (período livre): a interseção com a campanha da live, até hoje.
    expect(live(chavesDaLive(LIVE_PADRAO).campanha).rangeLive).toEqual({ de: LIVE_PADRAO.periodo.de, ate: p.hoje });
    // Um período livre mais curto recorta.
    expect(live("2026-11-18..2026-11-19").rangeLive).toEqual({ de: "2026-11-18", ate: "2026-11-19" });
    // A página: o recolhido existe, com a âncora; os criativos da live não têm cartão.
    const e = entradaMidiaDa(p, "7d");
    const m = carregar(e);
    const html = renderizar(await pagina({ range: "7d" }));
    expect(tagDoId(html, "criativos-live")).toMatch(/<details/);
    expect(resumosDosRecolhidos(html)[0]).toBe("Criativos da live 01/12");
    for (const c of m.criativos!.todos) expect(c.chave.startsWith("live|"), c.chave).toBe(false);
    for (const l of m.detalhes.criativos.conversao) expect(l.daLive).toBe(false);
    expect(m.detalhes.criativos.liveNoBloco).toBe(true);
    // O criativo MISTO (K20): cartão só com os números de fora da live.
    const misto = m.criativos!.todos.find((c) => c.chave === IDS.criativo.carrosselAurora)!;
    const linha = m.detalhes.criativos.conversao.find((l) => l.chave === IDS.criativo.carrosselAurora)!;
    expect(sp(misto.numeros.gasto)).toBe(sp(formatCurrency0(linha.spend)));
    expect(linha.spend).toBeCloseTo(180, 6);
  });

  it("8. período que ainda não começou: só o resumo vazio, o conferir e Detalhes", async () => {
    const e = entradaMidiaDa(producaoSemana(), "2026-11-20..2026-11-25");
    expect(e.naoComecou).toBe(true);
    const m = carregar(e);
    expect(m.resumo.texto).toBe("Nenhum gasto no período");
    expect(m.conferir).not.toBeNull();
    expect([m.verba, m.criativos, m.pausados, m.live]).toEqual([null, null, null, null]);
    const html = renderizar(await pagina({ range: e.rangeKey }));
    expect(resumosDosRecolhidos(html)).toEqual(["Detalhes"]);
    expect(trechos(html, "h2", "data-titulo")).toEqual([]);
  });

  it("10. awareness por URL direta: 'R$ X investidos no período', sem conferir, verba, criativos, pausados e live (K18)", async () => {
    const e = entradaMidiaDa(semanaDoSeed("krone"), "all");
    const m = carregar(e);
    expect(sp(m.resumo.texto)).toMatch(/^(≥ |≤ )?R\$ [\d.]+ investidos no período$/);
    expect(sp(m.resumo.texto)).toBe(`${sp(mostrar(e.kpis.investimento, "moeda0"))} investidos no período`);
    expect([m.conferir, m.verba, m.criativos, m.pausados, m.live]).toEqual([null, null, null, null, null]);
    expect(m.resumo.dica).toContain("Marca de seguidores: sem captação de leads.");
    const html = renderizar(await pagina({ range: e.rangeKey }));
    expect(trechos(html, "p", 'data-parte="conferir"')).toEqual([]);
    // Nada de "CPL —" para quem não capta lead: nenhuma palavra visível fala em CPL.
    expect(palavras(html).join(" ")).not.toContain("CPL");
    // Zero com piso de cobertura não vira "≥ R$ 0 investidos" (ADR-06, K6) — nem na awareness.
    // O seed termina em julho: a semana de HOJE não tem linha. Sem sync, "sem dados"; com a
    // semana coberta por sync, "nenhum gasto".
    const semSync = entradaMidiaDa(semanaDoSeed("krone"), "7d");
    expect(semSync.kpis.investimento.valor).toBe(0);
    expect(semSync.kpis.investimento.confianca?.nivel).toBe("piso");
    expect(carregar(semSync).resumo.texto).toBe("Sem dados de gasto no período ⚠");
    const coberta = entradaMidiaDa(semanaDoSeed("krone", HOJE, [{ from: "2026-10-01", to: HOJE }]), "7d");
    expect(coberta.kpis.investimento.valor).toBe(0);
    expect(carregar(coberta).resumo.texto).toBe("Nenhum gasto no período");
  });

  it("11. piso de gasto (K13): '≥' no gasto e no CPL dos cartões, nenhum candidato; zero com piso = 'Sem dados de gasto no período ⚠' (K6)", () => {
    const p = comPisoDeGasto();
    const e = entradaMidiaDa(p, "7d");
    expect(e.kpis.investimento.confianca?.nivel).toBe("piso");
    const m = montarMidiaDaTela(e);
    expect(m.criativos!.todos.length).toBeGreaterThan(0);
    for (const c of m.criativos!.todos) {
      expect(c.numeros.gasto.startsWith("≥ "), c.numeros.gasto).toBe(true);
      if (!c.numeros.cpl.startsWith("—")) expect(c.numeros.cpl.startsWith("≥ "), c.numeros.cpl).toBe(true);
      expect(c.sinal.id).not.toBe("candidato");
    }
    expect(m.criativos!.titulo).not.toContain("candidato");
    expect(m.criativos!.dica).toContain("Há dias sem dado de gasto: gasto e CPL são pisos (≥) e não há candidato.");
    expect(m.detalhes.dica).toContain("Há dias sem dado de gasto: os valores são pisos.");
    // Zero com buraco de cobertura não é "nenhum gasto" (ADR-06).
    const zero = montarMidiaDaTela(entradaMidiaDa(p, "2026-11-09..2026-11-10"));
    expect(zero.resumo.texto).toBe("Sem dados de gasto no período ⚠");
  });

  it("só descoberta: 'Nenhum gasto de conversão · R$ X em descoberta', a verba sem tabela e sem cartões", () => {
    const p = producaoSemana();
    p.data.adDaily = p.data.adDaily.filter((r) => r.objective !== "OUTCOME_LEADS");
    const e = entradaMidiaDa(p);
    const m = montarMidiaDaTela(e);
    expect(sp(m.resumo.texto)).toBe(`Nenhum gasto de conversão · ${sp(mostrar(e.kpis.investimentoDescoberta, "moeda0"))} em descoberta`);
    expect(m.verba).toMatchObject({ titulo: "Sem verba de conversão no período", linhas: [] });
    expect(m.criativos).toBeNull();
    expect(m.detalhes.descoberta).not.toBeNull();
  });
});

// ---------------------------------------------------------------- os números da tela

describe("os números da tela são os do Início (um número por métrica, K5)", () => {
  const CASOS_NUMEROS: [string, () => SemanaDaMidia, string][] = [
    ["produção · 7d", producaoSemana, "7d"],
    ["produção · campanha", producaoSemana, "all"],
    ["3 reuniões por id", () => comReunioes(3), "7d"],
    ["pior caso de texto", piorCasoDeTexto, "7d"],
    ["piso de gasto", comPisoDeGasto, "7d"],
    ["seed · campanha", () => semanaDoSeed("consorcio"), "all"],
  ];

  for (const [nome, semana, chave] of CASOS_NUMEROS) {
    it(nome, () => {
      const p = semana();
      const e = entradaMidiaDa(p, chave);
      const k = e.kpis;
      const m = montarMidiaDaTela(e);
      const ini = montarInicio(entradaInicioDa(p, chave));
      expect(k.investimentoConversao.valor).toBeGreaterThan(0);
      // A linha abre com o investimento de CONVERSÃO — o texto do cartão do Início (K5).
      const resumo = sp(m.resumo.texto);
      expect(ini.cartoes.investimento.texto).toBe(mostrar(k.investimentoConversao, "moeda0"));
      expect(resumo.startsWith(`${sp(ini.cartoes.investimento.texto)} investidos em conversão`), resumo).toBe(true);
      // O CPL: o do cartão do Início.
      expect(ini.cartoes.cpl.texto).toBe(mostrar(k.cpl, "moeda"));
      expect(resumo).toContain(` · CPL ${sp(mostrar(k.cpl, "moeda"))} · `);
      // O custo por reunião: a razão quando se sustenta; senão o FATO (a 2ª metade), sem repetir o investimento.
      const c = fatoDoCustoPorReuniao(k);
      const reunioes = c.fato.split(" · ")[1];
      expect(resumo.endsWith(sp(c.exibivel ? `${c.valor} por reunião · ${reunioes}` : reunioes)), resumo).toBe(true);
      expect(resumo.split("investidos").length - 1).toBe(1);
      // O "(orçamento R$ X)" só com orçamento, colado ao investimento de conversão.
      if (resumo.includes("(orçamento")) expect(resumo).toMatch(/investidos em conversão \(orçamento R\$ [\d.]+\) · CPL/);
      // O total (o que a conferência compara) na 1ª frase do ⓘ.
      expect(sp(frases(m.resumo.dica)[0])).toContain(sp(mostrar(k.investimento, "moeda0")));
      expect(m.resumo.dica).toContain("É o gasto que a conferência com o Gerenciador compara.");
      // O MESMO "fora das linhas" no ⓘ da verba e no ⓘ dos conjuntos (K33).
      const fim = fimDoPeriodo(e.range, e.hoje);
      const ref = refDaVeiculacao({ fim, ultimoSyncAds: e.ultimoSyncAds, rows: e.data.adDaily });
      const conj = conjuntosPorId(e.data, e.range, { custoPorReuniaoExibivel: custoExibivel(k.custoPorReuniao), ref, cobertura: e.cobertura, cfgLive: e.cfgLive });
      const fora = foraDasLinhasDeConversao(e.data, e.range, k, conj);
      const texto = textoDosForaDasLinhas(fora);
      if (fora.n > 0) {
        expect(m.verba!.dica).toContain(texto);
        expect(m.detalhes.conjuntos.dica).toContain(texto);
      } else {
        expect(m.verba!.dica).not.toContain("Fora das linhas:");
        expect(m.detalhes.conjuntos.dica).not.toContain("Fora das linhas:");
      }
      // Cartão = a linha de Detalhes: o mesmo gasto, os mesmos leads, o mesmo nome inteiro.
      for (const card of m.criativos?.todos ?? []) {
        const l = m.detalhes.criativos.conversao.find((x) => x.chave === card.chave);
        expect(l, card.nomeCompleto).toBeDefined();
        expect(card.nomeCompleto).toBe(l!.nome);
        const piso = k.investimento.confianca?.nivel === "piso";
        expect(sp(card.numeros.gasto)).toBe(sp(`${piso ? "≥ " : ""}${formatCurrency0(l!.spend)}`));
        expect(card.numeros.leads).toBe(formatInt(l!.leadsPainel));
        // "Parou" nunca está nos cartões.
        expect(l!.veiculacao.estado).toBe("no-ar");
        expect(card.sinal.id).toBe(l!.sinal!.sinal);
      }
      // `todos` = as linhas de conversão no ar sem a live, na ordem dos cartões; os cartões são os 5 primeiros.
      if (m.criativos) {
        expect(m.criativos.todos.map((c) => c.chave).sort()).toEqual(m.detalhes.criativos.conversao.map((l) => l.chave).sort());
        expect(m.criativos.cards).toEqual(m.criativos.todos.slice(0, 5));
      }
    });
  }

  it("os dois 'Carrossel -' saem com desambiguações diferentes, FORA do elemento com `line-clamp` (K30)", async () => {
    const e = entradaMidiaDa(producaoSemana());
    const m = carregar(e);
    const a = m.criativos!.todos.find((c) => c.chave === IDS.criativo.carrosselAurora)!;
    const b = m.criativos!.todos.find((c) => c.chave === IDS.criativo.carrosselMirante)!;
    expect(a.nome).toBe("Carrossel -");
    expect(b.nome).toBe("Carrossel -");
    expect(a.desambiguacao).not.toBeNull();
    expect(b.desambiguacao).not.toBeNull();
    expect(a.desambiguacao).not.toBe(b.desambiguacao);
    expect(a.desambiguacao!.endsWith(IDS.criativo.carrosselAurora.slice(-4))).toBe(true);
    expect(b.desambiguacao!.endsWith(IDS.criativo.carrosselMirante.slice(-4))).toBe(true);
    // Sem homônimo, sem desambiguação.
    expect(m.criativos!.todos.find((c) => c.chave === IDS.criativo.post8)!.desambiguacao).toBeNull();
    const html = renderizar(await pagina({ range: e.rangeKey }));
    const clamps = [...html.matchAll(/<[a-z]+[^>]*class="[^"]*line-clamp[^"]*"[^>]*>([\s\S]*?)<\/[a-z]+>/g)].map((x) => x[1]);
    expect(clamps.length).toBeGreaterThan(0);
    for (const t of clamps) {
      expect(t).not.toContain(a.desambiguacao!);
      expect(t).not.toContain(b.desambiguacao!);
    }
    const ul = trechos(html, "ul", 'data-parte="criativos"')[0];
    expect(ul).toContain(a.desambiguacao!);
    expect(ul).toContain(b.desambiguacao!);
  });
});

// ---------------------------------------------------------------- correções do corretor final

describe("o cartão, o piso, os vazios e o robô parado (correções do corretor final)", () => {
  it("o selo e o ⓘ ficam numa linha própria, na coluna do nome — não dividem a linha com ele (a 375 px o nome ficava com ≈ 90 px)", async () => {
    const e = entradaMidiaDa(piorCasoDeTexto());
    carregar(e);
    const html = renderizar(await pagina({ range: e.rangeKey }));
    const lis = trechos(trechos(html, "ul", 'data-parte="criativos"')[0], "li", "");
    expect(lis.length).toBeGreaterThan(0);
    for (const li of lis) {
      // A coluna do nome abre, e o selo vem DENTRO dela (nenhum </div> no meio): o nome, a desambiguação e o selo empilham.
      const coluna = li.indexOf("min-w-0 flex-1");
      const selo = li.indexOf("inline-flex items-center gap-1.5 text-xs", coluna);
      const nome = li.indexOf("line-clamp-2", coluna);
      expect(coluna, li).toBeGreaterThan(-1);
      expect(nome).toBeGreaterThan(coluna);
      expect(selo).toBeGreaterThan(nome);
      expect(li.slice(coluna, selo)).not.toContain("</div>");
      // E nada encolhe ao lado do nome.
      expect(li).not.toMatch(/class="flex shrink-0/);
    }
  });

  it("o motivo do selo e a tabela do cartão dizem a MESMA fração de 'responderam' (0 de 11, não 0 de 9)", () => {
    const m = montarMidiaDaTela(entradaMidiaDa(comNaoResponde(9)));
    const aurora = m.criativos!.todos.find((c) => c.chave === IDS.criativo.carrosselAurora)!;
    expect(aurora.sinal.id).toBe("manter");
    expect(aurora.motivo).toBe("CPL baixo, mas 0 de 11 responderam ao robô");
    expect(aurora.robo!.responderam.startsWith("0 de 11")).toBe(true);
  });

  it("piso de gasto (K13): o '≥' vai também no motivo do cartão e nas tabelas de Detalhes (Gasto, CPL, custo por agendada)", async () => {
    const e = entradaMidiaDa(comPisoDeGasto());
    const m = carregar(e);
    expect(m.pisoDeGasto).toBe(true);
    for (const c of m.criativos!.todos) if (c.linha && /R\$/.test(c.linha)) expect(sp(c.linha), c.linha).toMatch(/≥ R\$/);
    const html = renderizar(await pagina({ range: e.rangeKey }));
    const detalhes = html.slice(html.search(/<details[^>]*\bid="detalhes"/));
    expect(sp(detalhes)).toMatch(/≥ R\$ \d/);
    // Sem o piso, nenhum "≥ R$" nas tabelas.
    const semPiso = carregar(entradaMidiaDa(producaoSemana()));
    expect(semPiso.pisoDeGasto).toBe(false);
    const html2 = renderizar(await pagina({ range: "7d" }));
    expect(sp(html2.slice(html2.search(/<details[^>]*\bid="detalhes"/)))).not.toMatch(/≥ R\$/);
  });

  it("tudo de conversão parado: Detalhes diz 'nenhum no ar' e aponta Pausados — nunca 'Sincronize ou importe'", async () => {
    const p = producaoSemana();
    p.data.adDaily = p.data.adDaily.filter((r) => r.date <= "2026-11-08");
    const e = entradaMidiaDa(p);
    const m = carregar(e);
    expect(m.detalhes.criativos.conversao).toEqual([]);
    expect(m.pausados!.criativos.length).toBeGreaterThan(0);
    const html = renderizar(await pagina({ range: e.rangeKey }));
    expect(html).toContain("Nenhum criativo de conversão no ar");
    expect(html).not.toContain("Sincronize ou importe");
    expect(html).toMatch(/Fora do ar: [^<]* em (<!-- -->)?\d+(<!-- -->)? (<!-- -->)?criativos/);
  });

  it("awareness (e período só de descoberta): Detalhes não desenha as tabelas de conversão; `#conjuntos` é a descoberta", async () => {
    const e = entradaMidiaDa(semanaDoSeed("krone"), "all");
    const m = carregar(e);
    expect(m.detalhes.comConversao).toBe(false);
    const html = renderizar(await pagina({ range: e.rangeKey }));
    expect(html).not.toContain('id="criativos-tabela"');
    expect(html).not.toContain("Nenhum conjunto de conversão no ar");
    expect(html).not.toContain("Nenhum criativo de conversão no ar");
    if (m.detalhes.descoberta) expect(tagDoId(html, "conjuntos")).toMatch(/scroll-mt-24/);
    // Com conversão, as duas tabelas estão lá.
    const conv = carregar(entradaMidiaDa(producaoSemana()));
    expect(conv.detalhes.comConversao).toBe(true);
  });

  it("um conjunto da live parado: a nota de Detalhes diz '1 da live' (o 'Fora do ar' da verba não tem a live)", async () => {
    const p = comLive();
    p.data.adDaily = p.data.adDaily.filter((r) => !(r.adId === IDS.anuncio.c4b && r.date >= "2026-11-18"));
    const e = entradaMidiaDa(p);
    const m = carregar(e);
    expect(m.detalhes.conjuntos.foraDoAr?.daLive).toBe(1);
    const html = renderizar(await pagina({ range: e.rangeKey }));
    expect(html.replace(/<!-- -->/g, "")).toMatch(/Fora do ar: [^<]* em 2 conjuntos, 1 da live →/);
  });

  it("leitura parada: o ⓘ cita o Funil com o '≥' que o Funil escreve; sem gente dos criativos no trecho, não afirma 'nenhum passou pelo robô'", () => {
    const m = montarMidiaDaTela(entradaMidiaDa(comLeituraParada()));
    expect(m.colunasDoRobo).toBe(true);
    expect(m.criativos!.dica).toMatch(/no Funil, ≥ \d+ de ≥ \d+ responderam\./);
    // Ninguém dos criativos no trecho do robô (todos sem telefone utilizável), com a leitura parada.
    const p = comLeituraParada();
    p.data.leads = p.data.leads.map((l) => ({ ...l, phone: undefined }));
    const vazio = montarMidiaDaTela(entradaMidiaDa(p));
    expect(vazio.roboNosCriativos).toBe("leitura-parada");
    expect(vazio.colunasDoRobo).toBe(false);
    expect(vazio.criativos!.dica).toContain("Sem as colunas do robô: robô sem leitura recente.");
    expect(vazio.criativos!.dica).not.toContain("nenhum lead dos criativos passou pelo robô");
  });
});

// ---------------------------------------------------------------- estático

describe("estático: sem descrição sob título, a fronteira do bundle (K24) e a miniatura (K28)", () => {
  const raiz = process.cwd();
  const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf8");
  const fonteDaPagina = ler("src/app/(dashboard)/midia/page.tsx");
  const componentes = fs
    .readdirSync(path.join(raiz, "src/components/midia"))
    .filter((a) => /\.tsx?$/.test(a))
    .map((a) => [a, ler(`src/components/midia/${a}`)] as const);

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

  it("nem `CardDescription` nem `description=` na página e em `components/midia/*`", () => {
    for (const [nome, fonte] of [["page.tsx", fonteDaPagina] as const, ...componentes]) {
      expect(fonte, nome).not.toContain("CardDescription");
      expect(fonte, nome).not.toContain("description=");
    }
  });

  it("a página só carrega e renderiza: não importa o store, a conferência nem o cliente do robô", () => {
    expect(fonteDaPagina).not.toContain("@/lib/data/store");
    expect(fonteDaPagina).not.toContain("conferencia-actions");
    expect(fonteDaPagina).not.toContain("@/lib/robo/client");
    expect(fonteDaPagina).toContain("@/lib/midia-server");
    expect(fonteDaPagina).toContain("carregarMidia");
  });

  it("nenhum client de `src/components` importa VALOR de `@/lib/midia` — os da Mídia importam de `@/lib/midia-tela` (K24)", () => {
    const clients = arquivos(path.join(raiz, "src/components")).filter((a) => /^\s*["']use client["']/.test(fs.readFileSync(a, "utf8")));
    for (const a of clients) {
      for (const imp of importsDe(fs.readFileSync(a, "utf8"))) {
        if (imp.de === "@/lib/midia") expect(deValor(imp.clausula), `${path.relative(raiz, a)}: import ${imp.clausula}`).toBe(false);
      }
    }
    for (const rel of ["src/components/tables/creatives-table.tsx", "src/components/midia/conjuntos-table.tsx"]) {
      const imps = importsDe(ler(rel));
      expect(imps.some((i) => i.de === "@/lib/midia-tela" && deValor(i.clausula)), rel).toBe(true);
    }
  });

  it("`lib/midia-tela.ts` só importa VALOR de ./format, ./dicionario e ./trust", () => {
    const permitidos = new Set(["./format", "./dicionario", "./trust", "@/lib/format", "@/lib/dicionario", "@/lib/trust"]);
    for (const imp of importsDe(ler("src/lib/midia-tela.ts"))) {
      if (deValor(imp.clausula)) expect(permitidos.has(imp.de), `import ${imp.clausula} from "${imp.de}"`).toBe(true);
    }
  });

  it("a miniatura: `<img>` com o eslint-disable de hoje e o comentário da CSP (K28)", () => {
    const fonte = ler("src/components/midia/miniatura.tsx");
    expect(fonte).toMatch(/^\s*["']use client["']/);
    expect(fonte).toContain("eslint-disable-next-line @next/next/no-img-element");
    expect(fonte).toContain("img-src https://*.fbcdn.net");
    expect(fonte).toMatch(/export function MiniaturaDoCriativo\b/);
  });

  it("nenhum arquivo de `src` tem 'Gancho (3 s)' nem `hookRate` (F4-D14)", () => {
    for (const a of arquivos(path.join(raiz, "src"))) {
      if (a.split(path.sep).includes("__tests__")) continue;
      const fonte = fs.readFileSync(a, "utf8");
      expect(fonte.includes("Gancho (3 s)"), path.relative(raiz, a)).toBe(false);
      expect(fonte.includes("hookRate"), path.relative(raiz, a)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------- abrir os <details> pela âncora (K27)

interface NoFalso {
  tagName: string;
  open?: boolean;
  parentElement: NoFalso | null;
  scrollIntoView?: (o: unknown) => void;
}

describe("abrir o `<details>` da âncora (§3.10, K27)", () => {
  it("detalhesParaAbrir: dentro de 2 `<details>` aninhados → os 2 fechados, de dentro para fora; o alvo que é um `<details>` → ele mesmo; sem ancestral → []", async () => {
    const { detalhesParaAbrir } = await import("@/components/ui/rolar-para-ancora");
    const raiz: NoFalso = { tagName: "MAIN", parentElement: null };
    const externo: NoFalso = { tagName: "DETAILS", open: false, parentElement: raiz };
    const div: NoFalso = { tagName: "DIV", parentElement: externo };
    const interno: NoFalso = { tagName: "DETAILS", open: false, parentElement: div };
    const alvo: NoFalso = { tagName: "DIV", parentElement: interno };
    expect(detalhesParaAbrir(alvo)).toEqual([interno, externo]);
    expect(detalhesParaAbrir(alvo)[0]).toBe(interno);
    expect(detalhesParaAbrir(interno)[0]).toBe(interno);
    expect(detalhesParaAbrir({ tagName: "DIV", parentElement: raiz })).toEqual([]);
    expect(detalhesParaAbrir(null)).toEqual([]);
    // Um ancestral já aberto não entra.
    externo.open = true;
    expect(detalhesParaAbrir(alvo)).toEqual([interno]);
  });

  it("RolarParaAncora com `abrirDetalhes` ouve `hashchange` e o clique em `a[href^=\"#\"]`, abre o caminho, rola — e tira os ouvintes no desmonte", async () => {
    const efeitos: (() => void | (() => void))[] = [];
    vi.resetModules();
    vi.doMock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), useEffect: (f: () => void | (() => void)) => void efeitos.push(f) }));
    const g = globalThis as unknown as { window?: unknown; document?: unknown };
    const antes = { window: g.window, document: g.document };
    try {
      const { RolarParaAncora } = await import("@/components/ui/rolar-para-ancora");
      const detalhes: NoFalso = { tagName: "DETAILS", open: false, parentElement: null };
      const rolou = vi.fn();
      const tabela: NoFalso = { tagName: "DIV", parentElement: detalhes, scrollIntoView: rolou };
      const ouvintes = { win: new Map<string, EventListener>(), doc: new Map<string, EventListener>() };
      const win = {
        location: { hash: "" },
        addEventListener: vi.fn((t: string, f: EventListener) => void ouvintes.win.set(t, f)),
        removeEventListener: vi.fn((t: string) => void ouvintes.win.delete(t)),
      };
      const doc = {
        getElementById: (id: string) => (id === "criativos-tabela" ? tabela : null),
        addEventListener: vi.fn((t: string, f: EventListener) => void ouvintes.doc.set(t, f)),
        removeEventListener: vi.fn((t: string) => void ouvintes.doc.delete(t)),
      };
      g.window = win;
      g.document = doc;
      expect(RolarParaAncora({ abrirDetalhes: true })).toBeNull();
      expect(efeitos).toHaveLength(1);
      const desmontar = efeitos[0]();
      expect(typeof desmontar).toBe("function");
      expect(win.addEventListener).toHaveBeenCalledWith("hashchange", expect.any(Function));
      expect(doc.addEventListener).toHaveBeenCalledWith("click", expect.any(Function));
      // O clique em "Ver todos" (o hash pode ser o mesmo: sem `hashchange`) abre "Detalhes" e rola.
      const link = { getAttribute: (a: string) => (a === "href" ? "#criativos-tabela" : null) };
      const alvoDoClique = { closest: (sel: string) => (sel.includes('href^="#"') || sel.includes("href^='#'") || sel.includes("href^=#") ? link : null) };
      ouvintes.doc.get("click")!({ target: alvoDoClique, button: 0, defaultPrevented: false } as unknown as Event);
      expect(detalhes.open).toBe(true);
      expect(rolou).toHaveBeenCalledWith({ block: "start" });
      // Fechado de novo, o `hashchange` também abre.
      detalhes.open = false;
      win.location.hash = "#criativos-tabela";
      ouvintes.win.get("hashchange")!({} as Event);
      expect(detalhes.open).toBe(true);
      // O desmonte tira os dois ouvintes.
      (desmontar as () => void)();
      expect(win.removeEventListener).toHaveBeenCalledWith("hashchange", expect.any(Function));
      expect(doc.removeEventListener).toHaveBeenCalledWith("click", expect.any(Function));
      expect(ouvintes.win.size + ouvintes.doc.size).toBe(0);
    } finally {
      g.window = antes.window;
      g.document = antes.document;
      vi.doUnmock("react");
      vi.resetModules();
    }
  });
});
