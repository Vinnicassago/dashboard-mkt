/**
 * T3 de nov/26 (§1 e §4.2 da spec) — Leads com menos texto, na TELA: a página de verdade
 * (`app/(dashboard)/leads/page.tsx`) com o store trocado por uma base sintética de 60 leads
 * (`lead()` de `fixtures-robo`: "Fulano-…-zq", @exemplo.com.br, 55119888…). No molde de
 * `fase5-conteudo-tela.test.ts`, com os helpers de `src/test/tela.ts`.
 *
 *   • O CORTE: o `DataTable` desenha `limite` linhas DEPOIS de ordenar; Leads abre com 50 (as
 *     mais novas) e "Mostrar mais · faltam N"; o filtro da URL vale ANTES do corte (abas,
 *     "Exportar CSV (N)" e o botão contam a lista inteira); `?linhas=` acima de 50 e o reset.
 *   • O FILTRO "Classe: ≠ n8n" (`?classe=diverge`) acha quem está além da 50ª, e o alerta
 *     `classe-diverge` aponta para ele, não para a coluna.
 *   • O TEXTO: sem a frase de abertura nem a descrição; os recolhidos sem cauda; tudo no ⓘ
 *     ("Sobre …"), cada frase ≤ 25 palavras; a página inteira ≤ o orçamento medido.
 *   • LGPD e fronteira: as MESMAS 7 props do `LeadsDirectory`; o Marketing com o contato
 *     mascarado; os `Info` só com string; nenhuma função cruza.
 */
import fs from "node:fs";
import path from "node:path";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DataTable, type Column } from "@/components/ui/data-table";
import { alertaDeClasse } from "@/lib/alertas";
import {
  DICAS_DE_LEADS,
  FILTROS_DA_FICHA,
  FILTRO_VAZIO,
  LINHAS_POR_VEZ,
  descreverFiltro,
  filtroDoPedido,
  linhasDaUrl,
  mudaOFiltro,
  rotuloMostrarMais,
  sobreALista,
} from "@/lib/leads-vista";
import { SOBRE_A_MASCARA } from "@/lib/lgpd";
import { aplicarEventoDiagnostico } from "@/lib/diagnostico-live";
import { chavesDaLive } from "@/lib/atalho-live";
import { LIVE_PADRAO } from "@/lib/live";
import { SOBRE_DEPOIS_DA_INSCRICAO, SOBRE_SEM_INSCRICAO } from "@/components/leads/depois-da-inscricao";
import { blocos, componentesClient, contatosDe, inspecionar, palavras, type Fronteira } from "@/test/tela";
import { AGORA, ROBO, brt, lead } from "@/test/fixtures-robo";
import type { Lead } from "@/lib/types";

// ---------------------------------------------------------------- dublês da página

const h = vi.hoisted(() => ({
  query: "",
  leads: [] as unknown[],
  excluidos: [] as unknown[],
  user: { role: "comercial" } as null | { role: string },
  pode: { "leads:write": true, "leads:delete": true } as Record<string, boolean>,
  robo: null as unknown,
  diagnosticos: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/leads",
  useSearchParams: () => new URLSearchParams(h.query),
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  notFound: () => {
    throw new Error("notFound");
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
vi.mock("@/components/layout/alertas", () => ({ RegistrarAlertas: () => null }));
// Server actions que os componentes client de `src/components` importam (`componentesClient()`
// importa TODOS): a tela só os chama no clique.
vi.mock("@/app/(dashboard)/leads/actions", () => ({
  anotarLead: vi.fn(),
  changeLeadStatus: vi.fn(),
  deleteLeadAction: vi.fn(),
  restoreLeadAction: vi.fn(),
  desfazerTentativa: vi.fn(),
  marcarReuniao: vi.fn(),
  registrarResultadoDoContato: vi.fn(),
  registrarResultadoDaReuniao: vi.fn(),
  registrarTentativa: vi.fn(),
  reabrirLead: vi.fn(),
  salvarRespostas: vi.fn(),
  mesclarLeads: vi.fn(),
  corrigirDesistenciaSemReuniao: vi.fn(),
}));
vi.mock("@/app/(dashboard)/configuracoes/live-actions", () => ({ salvarManuaisDaLive: vi.fn(), salvarCampanhaDaLive: vi.fn() }));
vi.mock("@/app/(dashboard)/ai-actions", () => ({ gerarResumoSemanalAction: vi.fn() }));
vi.mock("@/app/(dashboard)/configuracoes/conferencia-actions", () => ({ registrarConferencia: vi.fn() }));
vi.mock("@/lib/auth/guard", () => ({ can: async (cap: string) => h.pode[cap] ?? false }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => h.user }));
vi.mock("@/lib/active-brand", () => ({ activeBrandSlug: async () => "consorcio" }));
vi.mock("@/lib/atendimento-server", async () => {
  const { EXPEDIENTE_PADRAO } = await import("@/lib/turno");
  return { expedienteAtual: async () => EXPEDIENTE_PADRAO };
});
vi.mock("@/lib/robo/estado", () => ({ estadoDoRoboAgora: async () => h.robo }));
vi.mock("@/lib/data/store", async () => {
  const { base } = await import("@/test/fixtures-robo");
  return {
    getData: async () => base({ leads: h.leads as never }),
    listDeletedLeads: async () => h.excluidos,
    listLeadEvents: async () => [],
    getState: async () => null,
    // Depois da inscrição (0025): o diagnóstico e o clique na comunidade.
    listDiagnosticos: async () => h.diagnosticos,
    listCliquesComunidade: async () => [],
  };
});

// ---------------------------------------------------------------- a base (nada real)

/**
 * Palavras fora de tabela da página (comercial, Campanha, robô ligado, 60 leads, com ficha),
 * do `<select>` só a opção escolhida: o MEDIDO depois do T3 (81 — rótulos, abas, filtros e o
 * botão; nenhuma prosa; o pior bloco, 3), arredondado para cima à dezena. O teto da spec é 100.
 */
const ORCAMENTO_LEADS = 90;
/**
 * Com gente da live na lista (nov/26), o bloco "Live · N de M concluíram o diagnóstico" — o
 * título, o rótulo do recolhido "Diagnóstico sem inscrição" e o filtro "Diagnóstico" (os números
 * ficam em tabela): MEDIDO 93. O teto da spec, 100.
 */
const ORCAMENTO_LEADS_COM_LIVE = 100;

const N = 60;
const id = (i: number) => `t3-${String(i).padStart(2, "0")}`; // t3-01 = o mais antigo, t3-60 = o mais novo
function base60(): Lead[] {
  return Array.from({ length: N }, (_, k) => {
    const i = k + 1;
    return lead(id(i), {
      createdAt: new Date(Date.parse(AGORA) - (N + 1 - i) * 3_600_000).toISOString(),
      ...(i === 1 ? { name: "Teste" } : {}), // "parece teste": o Revisar aparece
      ...(i === 2 ? { status: "em_contato" as const } : {}), // para o ?status=lead
      ...(i === 3 ? { classe: "A" as const, bem: "imovel" as const } : {}), // com ficha: os filtros "Ficha:" aparecem
      ...(i === 4 ? { classe: "A" as const, classeN8n: "B" as const, bem: "imovel" as const } : {}), // ≠ n8n, fora das 50 de início
    });
  });
}

/** Do mais novo para o mais antigo: `t3-60 … t3-(61-n)`. */
const maisNovos = (n: number) => Array.from({ length: n }, (_, k) => id(N - k));

// ---------------------------------------------------------------- utilidades

const pagina = async (range?: string) => {
  const { default: LeadsPage } = await import("@/app/(dashboard)/leads/page");
  return (await LeadsPage({ searchParams: Promise.resolve(range ? { range } : {}) })) as ReactElement;
};
const renderizar = async (range?: string) => renderToStaticMarkup(await pagina(range));
/** Do <select> só se lê a opção escolhida (a régua do script; o React marca `selected=""`). */
const semOpcoesNaoEscolhidas = (html: string) => html.replace(/<option(?![^>]*\sselected)[^>]*>[\s\S]*?<\/option>/g, "");
const texto = (html: string) =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const corpoDaTabela = (html: string) => html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>")); // a 1ª é a de Leads
const idsNaTabela = (html: string) => [...new Set([...corpoDaTabela(html).matchAll(/\/leads\/(t3-\d\d)[?"]/g)].map((m) => m[1]))];
const frases = (t: string) => t.split(/(?<=[.!?])\s+/).filter(Boolean);
const rotulosDosInfo = (html: string) =>
  [...html.matchAll(/<button[^>]*aria-label="([^"]*)"[^>]*><span aria-hidden="true">ⓘ<\/span><\/button>/g)].map((m) => m[1]);
/** Palavras de uma frase, com a régua de `palavras`. */
const nPalavras = (f: string) => palavras(`<i>${f}</i>`).length;

const infos = (fr: Fronteira) => fr.clients.filter((c) => c.nome === "ui/info.tsx:Info");
const infoDoTitulo = (fr: Fronteira) => infos(fr).find((c) => c.props.rotulo === "Sobre a lista de leads");

const raiz = path.resolve(__dirname, "../../..");
const ler = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf8");

let clientes: Map<unknown, string>;
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(AGORA));
  clientes = await componentesClient();
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(() => {
  h.query = "";
  h.leads = base60();
  h.excluidos = [lead("t3-x", { deletedAt: brt("2026-11-03", "10:00"), deletedBy: "ana", deletedReason: "duplicado" })];
  h.user = { role: "comercial" };
  h.pode = { "leads:write": true, "leads:delete": true };
  h.robo = ROBO;
  h.diagnosticos = [];
});

// ---------------------------------------------------------------- 1. o corte do DataTable

describe("T3 · o `limite` do DataTable corta DEPOIS de ordenar", () => {
  type Linha = { n: number };
  const colunas: Column<Linha>[] = [{ key: "n", header: "N", sortable: true, sortValue: (r) => r.n, render: (r) => `linha-${r.n}` }];
  const tabela = (rows: Linha[], limite?: number) =>
    renderToStaticMarkup(
      createElement(DataTable<Linha>, {
        columns: colunas,
        rows,
        initialSortKey: "n",
        initialSortDir: "desc",
        rowKey: (r) => String(r.n),
        emptyTitle: "Nada por aqui",
        ...(limite == null ? {} : { limite }),
      }),
    );
  const linhasDoCorpo = (html: string) => (corpoDaTabela(html).match(/<tr/g) ?? []).length;
  const numeros = (html: string) => [...corpoDaTabela(html).matchAll(/linha-(\d+)</g)].map((m) => Number(m[1]));
  // Em ordem CRESCENTE: um corte feito antes de ordenar daria linha-1 … linha-50.
  const sessenta = Array.from({ length: 60 }, (_, k) => ({ n: k + 1 }));

  it("com limite 50: as 50 do topo da ordenação (60 … 11)", () => {
    const html = tabela(sessenta, 50);
    expect(linhasDoCorpo(html)).toBe(50);
    const ns = numeros(html);
    expect(ns).toContain(60);
    expect(ns).toContain(11);
    expect(ns).not.toContain(10);
    expect(ns).not.toContain(1);
  });

  it("sem limite: todas", () => {
    expect(linhasDoCorpo(tabela(sessenta))).toBe(60);
  });

  it("vazio com limite: o estado vazio olha as linhas inteiras", () => {
    expect(tabela([], 50)).toContain("Nada por aqui");
    // Com linhas e nada à vista (limite 0), não é "vazio": o vazio olha `sorted`, não as visíveis.
    const nenhumaAVista = tabela(sessenta, 0);
    expect(nenhumaAVista).not.toContain("Nada por aqui");
    expect(linhasDoCorpo(nenhumaAVista)).toBe(0);
  });
});

// ---------------------------------------------------------------- 2 a 5. a tabela de Leads

describe("T3 · Leads abre com 50 linhas e “Mostrar mais”", () => {
  it("50 linhas, as mais novas; abas, CSV e o botão contam a lista inteira", async () => {
    expect(LINHAS_POR_VEZ).toBe(50);
    const html = await renderizar();
    expect(idsNaTabela(html)).toEqual(maisNovos(50)); // t3-60 … t3-11
    const t = texto(html);
    expect(t).toContain("Todos (60)");
    expect(t).toContain("Exportar CSV (60)");
    expect(rotuloMostrarMais(10)).toBe("Mostrar mais · faltam 10");
    expect(t).toContain(rotuloMostrarMais(10));
  });

  it("o filtro da URL vale ANTES do corte (?status=lead)", async () => {
    h.query = "status=lead";
    const html = await renderizar();
    expect(idsNaTabela(html)).toHaveLength(50);
    const t = texto(html);
    for (const s of ["Todos (60)", "Novo (59)", "Em contato (1)", "Exportar CSV (59)", "Mostrar mais · faltam 9"]) expect(t).toContain(s);
  });

  it("o limite na URL (?linhas=) e o reset", async () => {
    for (const v of [null, undefined, "", "abc", "10", "50", "-5"]) expect(linhasDaUrl(v)).toBe(50);
    expect(linhasDaUrl("100")).toBe(100);
    expect(linhasDaUrl("73")).toBe(100);

    h.query = "linhas=100";
    let html = await renderizar();
    expect(idsNaTabela(html)).toHaveLength(60);
    expect(html).not.toContain("Mostrar mais");

    h.query = "linhas=abc";
    html = await renderizar();
    expect(idsNaTabela(html)).toHaveLength(50);
    expect(texto(html)).toContain("Mostrar mais · faltam 10");

    // Sem DOM não dá para clicar: o reset e a URL conferidos no código.
    const fonte = ler("src/components/leads/leads-directory.tsx");
    expect(fonte).toContain("rows={filtradas}");
    expect(fonte).toContain("limite={limite}");
    expect(fonte).not.toContain("filtradas.slice");
    expect(fonte).toContain('useState(() => linhasDaUrl(params.get("linhas")))');
    const inicioMudar = fonte.indexOf("const mudar =");
    expect(inicioMudar).toBeGreaterThan(0);
    const corpoMudar = fonte.slice(inicioMudar, fonte.indexOf("};", inicioMudar));
    expect(corpoMudar).toContain("setLimite(LINHAS_POR_VEZ)");
    const inicioLimpar = fonte.indexOf("setFiltro(FILTRO_VAZIO)");
    expect(inicioLimpar).toBeGreaterThan(0);
    const linhaLimpar = fonte.slice(inicioLimpar, fonte.indexOf("\n", inicioLimpar));
    expect(linhaLimpar).toContain("setLimite(LINHAS_POR_VEZ)");
    expect(fonte).toContain("periodoVisto !== rangeKey");
    expect(fonte).toContain('set("linhas", limite > LINHAS_POR_VEZ ? String(limite) : undefined)');
    // A URL que muda por fora (voltar do navegador, o menu) sem remontar: o efeito roda de novo
    // e a URL volta a dizer o que a tela mostra.
    expect(fonte).toContain("const qs = params.toString();");
    expect(fonte).toContain("}, [semBusca, limite, qs]);");
  });

  it("a aba que já está ativa não é troca: o limite fica (só filtro, aba ou busca NOVOS voltam a 50)", () => {
    const f = FILTRO_VAZIO; // aba "Todos"
    expect(mudaOFiltro(f, { status: "todos" })).toBe(false);
    expect(mudaOFiltro(f, { status: "lead" })).toBe(true);
    expect(mudaOFiltro(f, { campanha: undefined, conjunto: undefined })).toBe(false);
    expect(mudaOFiltro(f, { busca: "fulano" })).toBe(true);
    expect(mudaOFiltro({ ...f, sinalizadores: ["teste"] }, { sinalizadores: ["teste"] })).toBe(false);
    expect(mudaOFiltro(f, { sinalizadores: ["teste"] })).toBe(true);

    const fonte = ler("src/components/leads/leads-directory.tsx");
    const inicioMudar = fonte.indexOf("const mudar =");
    const corpoMudar = fonte.slice(inicioMudar, fonte.indexOf("};", inicioMudar));
    expect(corpoMudar).toContain("if (!mudaOFiltro(filtro, patch)) return;");
    expect(corpoMudar.indexOf("mudaOFiltro")).toBeLessThan(corpoMudar.indexOf("setLimite(LINHAS_POR_VEZ)"));
  });

  it("o filtro “Classe: ≠ n8n” acha quem está além da 50ª, e o alerta aponta para ele", async () => {
    h.query = "classe=diverge";
    const html = await renderizar();
    expect(idsNaTabela(html)).toEqual(["t3-04"]);
    expect(texto(html)).toContain("Exportar CSV (1)");

    expect(FILTROS_DA_FICHA.classe.vocab.diverge).toBe("≠ n8n");
    expect(filtroDoPedido({ classe: "diverge" }).classe).toBe("diverge");
    expect(descreverFiltro(filtroDoPedido({ classe: "diverge" }), "Campanha")).toContain("classe: ≠ n8n");

    const detalhe = alertaDeClasse([{ classe: "B", classeN8n: "A", status: "lead" }])[0].detalhe;
    expect(detalhe).toContain("o filtro Classe: ≠ n8n");
    expect(detalhe).not.toContain("a coluna Classe de Leads marca");
    // O alerta conta a marca inteira, sem período; Leads abre no período do link (7 dias, vindo
    // do Início): o texto diz em qual período o filtro acha todo mundo.
    expect(detalhe).toContain("em Leads, no período Campanha, o filtro Classe: ≠ n8n");
    for (const f of frases(String(detalhe))) expect(nPalavras(f), f).toBeLessThanOrEqual(25);
  });
});

// ---------------------------------------------------------------- 6 e 7. o texto e os ⓘ

describe("T3 · o texto de Leads mora no ⓘ", () => {
  it("sem a frase de abertura, a descrição e as caudas; dentro do orçamento; nenhuma frase > 25", async () => {
    const html = await renderizar();
    const t = texto(html);
    for (const saiu of [
      "A ficha de cada pessoa",
      "Todos os leads da campanha",
      "Clique no telefone",
      "possíveis testes, a mesma pessoa",
      "fora das listas e dos números; dá",
      "quem criou, reenviou",
      "Troque o período no cabeçalho",
    ])
      expect(t, saiu).not.toContain(saiu);
    for (const fica of ["Revisar (1)", "Excluídos (1)", "Histórico de alterações"]) expect(t).toContain(fica);

    const h2 = semOpcoesNaoEscolhidas(html);
    expect(palavras(h2).length).toBeLessThanOrEqual(ORCAMENTO_LEADS);
    expect(Math.max(...blocos(h2).map((b) => b.length))).toBeLessThanOrEqual(25);

    expect(DICAS_DE_LEADS.revisar).toContain("o administrador decide");
  });

  it("todo ⓘ é “Sobre …”; o do título é `sobreALista`; cada frase ≤ 25 palavras", async () => {
    const html = await renderizar();
    const rotulos = rotulosDosInfo(html);
    expect(rotulos.length).toBeGreaterThan(0);
    for (const r of rotulos) expect(r.startsWith("Sobre "), r).toBe(true);
    // O SSR desenha também os ⓘ de dentro do Revisar (o <details> fechado não some do HTML).
    for (const r of [
      "Sobre a lista de leads",
      "Sobre o Revisar",
      "Sobre os excluídos",
      "Sobre o histórico de alterações",
      "Sobre os possíveis testes",
    ])
      expect(rotulos).toContain(r);

    const fr = await inspecionar(await pagina(), clientes);
    expect(infoDoTitulo(fr)?.props.texto).toBe(sobreALista({ mascarar: false, exporta: true }));

    const textos = [
      ...infos(fr).map((c) => String(c.props.texto)),
      ...Object.values(DICAS_DE_LEADS),
      ...[false, true].flatMap((mascarar) => [false, true].map((exporta) => sobreALista({ mascarar, exporta }))),
    ];
    for (const tx of textos) for (const f of frases(tx)) expect(nPalavras(f), f).toBeLessThanOrEqual(25);
  });
});

// ---------------------------------------------------------------- depois da inscrição (nov/26)

describe("Depois da inscrição: o bloco da live em Leads", () => {
  /** Três inscritos da live (a ficha, no período da live), um diagnóstico concluído e um sem inscrição. */
  function comLive() {
    const vivos = [0, 1, 2].map((i) =>
      lead(`live-${i}`, {
        createdAt: "2026-11-20T13:00:00.000Z",
        bem: "imovel",
        ...(i === 0 ? { comunidadeEm: "2026-11-20T13:05:00.000Z" } : {}),
      }),
    );
    h.leads = [...base60(), ...vivos];
    const evento = (tentativa: string, telefone: string) => ({
      tentativa,
      etapa: "resultado" as const,
      telefone,
      respondidas: 9,
      total: 9,
      respostas: [{ n: 1, pergunta: "Onde está o dinheiro", resposta: "CDB" }],
      perfil: "Construtor de patrimônio",
    });
    h.diagnosticos = [
      aplicarEventoDiagnostico(undefined, evento("t-live", vivos[0].phone!), "2026-11-20T14:00:00.000Z"),
      aplicarEventoDiagnostico(undefined, evento("t-sem", "5541999990404"), "2026-11-20T14:00:00.000Z"),
    ];
  }

  it("o título responde, o resumo e o 'sem inscrição' são tabela; a página fica no orçamento e sem frase > 25", async () => {
    comLive();
    const html = await renderizar();
    const t = texto(html);
    expect(t).toContain("Live · 1 de 3 concluíram o diagnóstico");
    expect(t).toContain("Diagnóstico sem inscrição");
    const h2 = semOpcoesNaoEscolhidas(html);
    expect(palavras(h2).length).toBeLessThanOrEqual(ORCAMENTO_LEADS_COM_LIVE);
    expect(Math.max(...blocos(h2).map((b) => b.length))).toBeLessThanOrEqual(25);
    for (const tx of [SOBRE_DEPOIS_DA_INSCRICAO, SOBRE_SEM_INSCRICAO]) {
      for (const f of frases(tx)) expect(nPalavras(f), f).toBeLessThanOrEqual(25);
    }
    // sem gente da live (a base de sempre), o bloco não aparece
    h.leads = base60();
    h.diagnosticos = [];
    expect(texto(await renderizar())).not.toContain("concluíram o diagnóstico");
  });

  it("no período da live (o atalho), a lista é só dos inscritos — a outra campanha das mesmas datas fica de fora", async () => {
    comLive();
    const outra = lead("outra-campanha", { createdAt: "2026-11-20T13:30:00.000Z" });
    h.leads = [...h.leads, outra];
    const chave = chavesDaLive(LIVE_PADRAO).campanha;
    // o relógio da suíte é 04/11 (antes da live: a janela sai vazia); aqui, 24/11
    vi.setSystemTime(new Date("2026-11-24T18:00:00.000Z"));
    try {
      const t = texto(await renderizar(chave));
      expect(t).toContain("Inscritos na live (3)");
      expect(t).not.toContain(outra.name!);
      expect(t).toContain("Live · 1 de 3 concluíram o diagnóstico");
      // "Campanha" é período comum, pela entrada: a outra campanha aparece
      expect(texto(await renderizar("all"))).toContain(outra.name!);
    } finally {
      vi.setSystemTime(new Date(AGORA));
    }
  });

  it("Marketing: o WhatsApp do diagnóstico sem inscrição vai mascarado, sem link", async () => {
    comLive();
    h.user = { role: "marketing" };
    h.pode = {};
    const html = await renderizar();
    expect(html).not.toContain("5541999990404");
    expect(html).not.toContain("wa.me/5541999990404");
  });
});

// ---------------------------------------------------------------- 8 e 9. Marketing e a fronteira

describe("T3 · LGPD e fronteira", () => {
  it("Marketing: sem exportar nem Revisar; o ⓘ diz a máscara; o contato vai mascarado", async () => {
    h.user = { role: "marketing" };
    h.pode = {};
    const html = await renderizar();
    const t = texto(html);
    expect(t).not.toContain("Exportar CSV");
    expect(t).not.toContain("Revisar (");

    const fr = await inspecionar(await pagina(), clientes);
    const dica = String(infoDoTitulo(fr)?.props.texto);
    expect(dica).toBe(sobreALista({ mascarar: true, exporta: false }));
    expect(dica).toContain(SOBRE_A_MASCARA);
    expect(dica).not.toContain("WhatsApp");
    expect(dica).not.toContain("CSV");

    const payload = JSON.stringify(fr.arvore).toLowerCase();
    for (const c of contatosDe(h.leads as Lead[])) expect(payload.includes(c.toLowerCase()), `contato no payload: ${c}`).toBe(false);
  });

  it("nada novo vai ao client: as mesmas 7 props, os Info só com string, nenhuma função", async () => {
    const fr = await inspecionar(await pagina(), clientes);
    expect(fr.funcoes).toEqual([]);
    const permitidos = [
      "ui/rolar-para-ancora.tsx:RolarParaAncora",
      "ui/info.tsx:Info",
      "leads/leads-directory.tsx:LeadsDirectory",
      "leads/leads-directory.tsx:DeletedLeads",
      "leads/revisar.tsx:Revisar",
      "leads/lead-activity.tsx:LeadActivity",
    ];
    for (const nome of new Set(fr.clients.map((c) => c.nome))) expect(permitidos, nome).toContain(nome);

    const diretorio = fr.clients.find((c) => c.nome === "leads/leads-directory.tsx:LeadsDirectory");
    expect(Object.keys(diretorio?.props ?? {}).sort()).toEqual([
      "canDelete",
      "canEdit",
      "canExport",
      "mascararContato",
      "rangeKey",
      "roboLigado",
      "rows",
    ]);

    expect(infos(fr).length).toBeGreaterThan(0);
    for (const c of infos(fr)) {
      for (const k of Object.keys(c.props)) expect(["texto", "rotulo", "className"], k).toContain(k);
      for (const v of Object.values(c.props)) expect(typeof v).toBe("string");
      expect(typeof c.props.texto).toBe("string");
      expect(typeof c.props.rotulo).toBe("string");
    }
  });
});

// ---------------------------------------------------------------- 10. estático

describe("T3 · estático", () => {
  it("sem descrição sob título, sem dica no vazio; `limite` opcional e sem padrão", () => {
    for (const rel of [
      "src/app/(dashboard)/leads/page.tsx",
      "src/components/leads/leads-directory.tsx",
      "src/components/leads/revisar.tsx",
    ]) {
      const fonte = ler(rel);
      expect(fonte, rel).not.toContain("CardDescription");
      expect(fonte, rel).not.toContain("description=");
    }
    expect(ler("src/components/leads/leads-directory.tsx")).not.toContain("emptyHint=");

    const fonte = ler("src/components/ui/data-table.tsx");
    expect(fonte).toMatch(/\blimite\?: number/);
    // A regex não casa com o `limite == null` do useMemo; `not.toContain("limite =")` casaria.
    expect(fonte).not.toMatch(/\blimite\s*=(?!=)/);
  });
});
