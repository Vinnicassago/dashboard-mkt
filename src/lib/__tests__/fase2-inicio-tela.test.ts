/**
 * Fase 2 (nov/26), etapa B1 — o Início na TELA (`components/inicio/*`) e o painel
 * da live (`components/live/painel-live.tsx`), a partir da página de verdade
 * (`app/(dashboard)/page.tsx`) com o carregador trocado por objetos montados pelas
 * funções puras (`montarInicio`, `montarModoLive`) sobre o seed e sobre um robô de
 * fixture (colunas `robo_*`).
 *
 *   • LGPD (C14): a árvore que o servidor manda (o payload RSC: o HTML dos server
 *     components e as props de TODO componente client) não tem telefone nem
 *     e-mail de lead nenhum, nem as chaves de contato; nenhum client recebe a base,
 *     os eventos, a Fila ou a linha de Leads; nenhum client recebe função.
 *   • TEXTO (C13): as palavras visíveis do modo normal fora de `<table>` (o ⓘ
 *     fechado não conta; número conta) cabem no orçamento — total ≤ 100; cartões
 *     ≤ 25; títulos ≤ 10; funil ≤ 20; frases ≤ 30; rodapé + resumo ≤ 15.
 *   • C10: o comercial fica no modo live; fora dele vai para a Fila; `/live` só
 *     redireciona.
 */
import fs from "node:fs";
import path from "node:path";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { alertasDaLive, alertasDoInicio, montarModoLive } from "../bussola";
import { chavesDaLive } from "../atalho-live";
import { montarInicio, type EntradaInicio, type Inicio } from "../inicio";
import { kpisDoPeriodo } from "../kpis";
import { LIVE_PADRAO, type CampanhaDaLive } from "../live";
import { pageRange } from "../page-range";
import { EXPEDIENTE_PADRAO } from "../turno";
import type { DashboardData, Lead, ResumoSemanal } from "../types";
import { datasNoEixo } from "@/components/charts/eixo";
import { DATAS_NO_EIXO_DO_INICIO } from "@/components/inicio/barras-do-inicio";
import { componentesClient, conferirLgpd, contatosDe, inspecionar, palavras, trechos } from "@/test/tela";
import {
  ADS_DA_ANTERIOR,
  ADS_DA_SEMANA,
  LEADS_DA_ANTERIOR,
  LEADS_DO_ROBO,
  PARADO,
  ROBO,
  SEMANA,
  ad,
  base,
  brt,
  entradaDoRobo,
  entradaDoSeed,
  lead,
} from "@/test/fixtures-robo";

// ---------------------------------------------------------------- dublês da página

class Redirecionou extends Error {
  constructor(public url: string) {
    super(`redirect ${url}`);
  }
}

const h = vi.hoisted(() => ({
  user: null as null | { role: string },
  brand: "consorcio",
  cfg: null as unknown,
  caps: new Set<string>(),
  ai: false,
  carregado: null as unknown,
  Redirecionou: null as unknown as new (url: string) => Error,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  redirect: (url: string) => {
    throw new h.Redirecionou(url);
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
// Server actions: a tela só as chama no clique.
vi.mock("@/app/(dashboard)/ai-actions", () => ({ gerarResumoSemanalAction: vi.fn() }));
vi.mock("@/app/(dashboard)/configuracoes/live-actions", () => ({ salvarManuaisDaLive: vi.fn(), salvarCampanhaDaLive: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => h.user }));
vi.mock("@/lib/active-brand", async () => {
  const { brandDef } = await import("@/lib/brands");
  return { activeBrandSlug: async () => h.brand, activeBrand: async () => brandDef(h.brand) };
});
vi.mock("@/lib/live-server", () => ({ campanhaDaLive: async () => h.cfg }));
vi.mock("@/lib/auth/guard", () => ({ can: async (c: string) => h.caps.has(c) }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: () => h.ai }));
vi.mock("@/lib/bussola-server", () => ({ PERIODO_PADRAO_DA_BUSSOLA: "7d", carregarBussola: async () => h.carregado }));
vi.mock("@/lib/data/store", () => ({ getData: vi.fn(), listResumosSemanais: vi.fn(async () => []) }));

h.Redirecionou = Redirecionou;

// ---------------------------------------------------------------- fixtures

// O robô de fixture e o seed estão em `src/test/fixtures-robo.ts`; os helpers da
// fronteira server → client, da LGPD e das palavras, em `src/test/tela.ts` (§8.0 da Fase 3).

const RESUMO: ResumoSemanal = {
  id: "r1",
  brand: "consorcio",
  semana: "2026-10-26",
  periodo: { de: "2026-10-26", ate: "2026-11-01" },
  origem: "cron",
  criadoEm: brt("2026-11-02", "08:00"),
  analise: {
    diagnostico: "A semana trouxe leads, mas poucas reuniões.",
    acoes: [{ prioridade: "alta", titulo: "Ligar para os novos", porque: "3 sem contato", comoMedir: "reuniões na semana" }],
    testarNaSemana: "Um criativo novo.",
    naoMudou: "O CPL.",
    modelo: "modelo-x",
    criadoEm: brt("2026-11-02", "08:00"),
  } as ResumoSemanal["analise"],
};

/** O que `carregarBussola` devolve no modo normal — montado pelas funções puras. */
function carregadoNormal(e: EntradaInicio, resumos: ResumoSemanal[] = []) {
  return {
    brand: { slug: "consorcio", type: "conversao" },
    data: e.data,
    range: e.range,
    rangeKey: e.rangeKey,
    naoComecou: false,
    hoje: e.hoje,
    agora: e.agora,
    kpis: e.kpis,
    eventos: e.eventos,
    expediente: e.expediente,
    robo: e.robo ?? { ligado: false, lidoAte: null, confiavel: false, sync: { ultimoOk: null, falha: null } },
    cfgDaLive: LIVE_PADRAO,
    alertas: alertasDoInicio({ data: e.data, range: e.range, kpis: e.kpis, hoje: e.hoje }),
    resumos,
    modo: "normal" as const,
    inicio: montarInicio(e),
    live: null,
  };
}

/** Os inscritos da live (com a ficha), com contato — o painel não pode deixar nenhum sair. */
function dadosDaLive(): DashboardData {
  const inscrito = (id: string, dia: string, over: Partial<Lead> = {}): Lead =>
    lead(`insc${id}`, { createdAt: brt(dia, "10:00"), name: `Inscrito ${id}`, bem: "imovel", classe: "A", ...over });
  return base({
    adDaily: [ad("2026-11-16", "100001", 250, { campaign: "[LIVE] Captação" }), ad("2026-11-17", "100001", 250, { campaign: "[LIVE] Captação" })],
    leads: [inscrito("1", "2026-11-16"), inscrito("2", "2026-11-17"), inscrito("3", "2026-11-17", { classe: "B" }), ...LEADS_DO_ROBO],
  });
}

function carregadoLive(cfg: CampanhaDaLive, chave: string, hoje: string, resumos: ResumoSemanal[] = []) {
  const data = dadosDaLive();
  const agora = brt(hoje, "15:00");
  const periodo = (["campanha", "captacao", "posLive"] as const).find((p) => chavesDaLive(cfg)[p] === chave)!;
  const live = montarModoLive({ data, eventos: [], cfg, expediente: EXPEDIENTE_PADRAO, chave, periodo, hoje, agora });
  const { range, rangeKey } = pageRange(data, chave, hoje);
  const kpis = kpisDoPeriodo(data, range, { hoje, agora, comparar: true });
  return {
    brand: { slug: "consorcio", type: "conversao" },
    data,
    range,
    rangeKey,
    naoComecou: false,
    hoje,
    agora,
    kpis,
    eventos: [],
    expediente: EXPEDIENTE_PADRAO,
    robo: ROBO,
    cfgDaLive: cfg,
    alertas: alertasDaLive({ data, range, kpis, live, hoje }),
    resumos,
    modo: "live" as const,
    inicio: null,
    live,
  };
}

// ---------------------------------------------------------------- palavras visíveis

const ORCAMENTO = { total: 100, cartoes: 25, titulos: 10, funil: 20, frases: 30, rodapeResumo: 15 };

// ---------------------------------------------------------------- testes

let clientes: Map<unknown, string>;
beforeAll(async () => {
  clientes = await componentesClient();
});

async function renderizar(no: ReactNode): Promise<string> {
  return renderToStaticMarkup(no as ReactElement);
}

async function paginaDoInicio(range?: string) {
  const { default: OverviewPage } = await import("@/app/(dashboard)/page");
  return OverviewPage({ searchParams: Promise.resolve(range ? { range } : {}) });
}

function comoAdmin(ai = true) {
  h.user = { role: "admin" };
  h.brand = "consorcio";
  h.cfg = LIVE_PADRAO;
  h.caps = new Set(["data:write", "leads:write", "leads:delete", "danger:run", "users:manage"]);
  h.ai = ai;
}

describe("LGPD: o que a página manda para os componentes client (C14)", () => {
  const casos: [string, () => EntradaInicio][] = [
    ["seed · 7d", () => entradaDoSeed("7d")],
    ["seed · 30d", () => entradaDoSeed("30d")],
    ["seed · campanha", () => entradaDoSeed("all")],
    ["robô · semana", () => entradaDoRobo()],
    ["robô · campanha", () => entradaDoRobo(ROBO, null)],
    ["robô parado", () => entradaDoRobo(PARADO)],
    ["robô desligado", () => entradaDoRobo(null)],
    ["robô · com a semana anterior (seta em todo cartão)", () =>
      entradaDoRobo(ROBO, SEMANA, { leads: [...LEADS_DO_ROBO, ...LEADS_DA_ANTERIOR], adDaily: [...ADS_DA_ANTERIOR, ...ADS_DA_SEMANA] })],
    ["verba sem lead nenhum na semana (CPL em quarentena)", () =>
      entradaDoRobo(ROBO, SEMANA, { leads: LEADS_DA_ANTERIOR, adDaily: [...ADS_DA_ANTERIOR, ...ADS_DA_SEMANA] })],
  ];
  for (const [nome, entrada] of casos) {
    it(`modo normal · ${nome}`, async () => {
      comoAdmin();
      const e = entrada();
      h.carregado = carregadoNormal(e, [RESUMO]);
      const f = await inspecionar(await paginaDoInicio(e.rangeKey), clientes);
      conferirLgpd(f, e.data.leads);
      // A inspeção é de verdade: chegou nos clients do Início.
      const nomes = new Set(f.clients.map((c) => c.nome));
      for (const n of ["ui/info.tsx:Info", "inicio/barras-do-inicio.tsx:BarrasDoInicio", "kpi/resumo-semanal.tsx:ResumoSemanalCard", "next/link", "layout/alertas:RegistrarAlertas"]) {
        expect(nomes.has(n), n).toBe(true);
      }
      // As barras recebem só data, contagem e o "pausado".
      const barras = f.clients.find((c) => c.nome.endsWith(":BarrasDoInicio"))!;
      for (const d of barras.props.dados as Record<string, unknown>[]) expect(Object.keys(d).sort()).toEqual(["date", "semDado", "semVeiculacao", "valor"]);
    });
  }

  it("o nome de quem entrou aparece (a lista é para o comercial), o contato não", async () => {
    comoAdmin();
    const e = entradaDoRobo();
    h.carregado = carregadoNormal(e);
    const html = await renderizar(await paginaDoInicio(e.rangeKey));
    const ini = montarInicio(e);
    expect(ini.leadsChegando.ultimos.length).toBeGreaterThan(0);
    for (const u of ini.leadsChegando.ultimos) expect(html).toContain(u.nome);
    // Sem teste e sem o recém-chegado fora da janela: a lista é a de `montarInicio`, uma linha por pessoa.
    const linhas = html.match(/<tbody[\s\S]*?<\/tbody>/)![0].match(/<tr/g)!;
    expect(linhas.length).toBe(ini.leadsChegando.ultimos.length);
    expect(html).not.toContain("teste@teste.com");
    for (const c of contatosDe(e.data.leads)) expect(html.includes(c)).toBe(false);
  });

  for (const [nome, hoje] of [
    ["antes de começar (05/11)", "2026-11-05"],
    ["na captação (20/11)", "2026-11-20"],
    ["depois do fim (20/12)", "2026-12-20"],
  ] as const) {
    for (const periodo of ["campanha", "captacao", "posLive"] as const) {
      it(`modo live · ${periodo} · ${nome}`, async () => {
        comoAdmin();
        const chave = chavesDaLive(LIVE_PADRAO)[periodo];
        const b = carregadoLive({ ...LIVE_PADRAO, manuais: { presentesPico: 40, atualizadoEm: brt("2026-11-04", "10:00"), atualizadoPor: "admin" } }, chave, hoje, [RESUMO]);
        h.carregado = b;
        const f = await inspecionar(await paginaDoInicio(chave), clientes);
        conferirLgpd(f, b.data.leads);
        const nomes = new Set(f.clients.map((c) => c.nome));
        expect(nomes.has("live/live-forms.tsx:ManuaisForm")).toBe(true);
        expect(nomes.has("live/live-forms.tsx:RelatoriosParaCopiar")).toBe(true);
        // Os números manuais e os textos dos relatórios — nada de lead.
        const manuais = f.clients.find((c) => c.nome.endsWith(":ManuaisForm"))!;
        expect(Object.keys(manuais.props).sort()).toEqual(["atual", "podeEditar"]);
        const rel = f.clients.find((c) => c.nome.endsWith(":RelatoriosParaCopiar"))!;
        for (const r of rel.props.relatorios as Record<string, unknown>[]) expect(Object.keys(r).sort()).toEqual(["id", "quando", "rotulo", "texto"]);
      });
    }
  }
});

describe("o painel da live no Início (C11)", () => {
  it("os sub-atalhos são links do Início; o link fixo leva o período; a faixa 'nenhuma campanha' saiu", async () => {
    comoAdmin();
    const K = chavesDaLive(LIVE_PADRAO);
    const b = carregadoLive({ ...LIVE_PADRAO, linhas: LIVE_PADRAO.linhas.map((l) => ({ ...l, campanhas: ["[NADA]"] })) }, K.captacao, "2026-11-20");
    expect(b.live.painel.semCampanhas).toBe(true);
    h.carregado = b;
    const html = await renderizar(await paginaDoInicio(K.captacao));
    for (const k of [K.campanha, K.captacao, K.posLive]) expect(html).toContain(`href="/?range=${k}"`);
    expect(html).toMatch(new RegExp(`aria-current="page"[^>]*>Captação<|href="/\\?range=${K.captacao.replace(/\./g, "\\.")}"[^>]*aria-current="page"`));
    expect(html).not.toContain('href="/live');
    expect(html).not.toContain("Nenhuma campanha do Gerenciador casou ainda");
    // O aviso foi para o ⚠ (alerta `live-sem-campanhas`).
    expect(b.alertas.map((a) => a.id)).toContain("live-sem-campanhas");
    // Sem rodapé no modo live; o resumo só existe com leitura.
    expect(html).not.toContain('data-bloco="rodape"');
    expect(html).not.toContain('data-bloco="resumo"');
  });

  it("o link 'abrir a Fila' do painel leva o período da live", async () => {
    comoAdmin();
    const K = chavesDaLive(LIVE_PADRAO);
    const data = dadosDaLive();
    const live = montarModoLive({ data, eventos: [], cfg: LIVE_PADRAO, expediente: EXPEDIENTE_PADRAO, chave: K.campanha, periodo: "campanha", hoje: "2026-11-20", agora: brt("2026-11-20", "15:00") });
    const { PainelLive } = await import("@/components/live/painel-live");
    const html = await renderizar(createElement(PainelLive, { live, podeManuais: true, podeLeads: true }));
    if (live.painel.aSemTentativa > 0) expect(html).toContain(`href="/fila?range=${K.campanha}#live"`);
    expect(html).not.toContain('href="/fila#live"');
  });
});

describe("o orçamento de texto do modo normal (C13)", () => {
  it("o gráfico do Início desenha no máximo 4 datas, sem os números do eixo Y nem o 'pausado' escrito", async () => {
    const { intervaloDoEixo } = await import("@/components/charts/eixo");
    for (const n of [1, 2, 7, 8, 9, 14, 30, 90, 120, 121, 365]) {
      expect(datasNoEixo(n, DATAS_NO_EIXO_DO_INICIO), `${n} dias`).toBeLessThanOrEqual(DATAS_NO_EIXO_DO_INICIO);
      // O Recharts mostra a data i quando i % (intervalo + 1) === 0.
      const k = intervaloDoEixo(n, DATAS_NO_EIXO_DO_INICIO) + 1;
      expect(Array.from({ length: n }, (_, i) => i).filter((i) => i % k === 0).length).toBe(datasNoEixo(n, DATAS_NO_EIXO_DO_INICIO));
    }
    expect(datasNoEixo(7, DATAS_NO_EIXO_DO_INICIO)).toBe(4);
    const fonte = fs.readFileSync(path.join(process.cwd(), "src/components/inicio/barras-do-inicio.tsx"), "utf8");
    expect(fonte).toMatch(/semEixoY/);
    expect(fonte).toMatch(/semRotuloNasFaixas/);
    expect(fonte).toMatch(/maxDatasNoEixo=\{DATAS_NO_EIXO_DO_INICIO\}/);
  });

  const casos: [string, () => EntradaInicio][] = [
    ["seed · 7d", () => entradaDoSeed("7d")],
    ["seed · 30d", () => entradaDoSeed("30d")],
    ["seed · campanha", () => entradaDoSeed("all")],
    ["robô · semana", () => entradaDoRobo()],
    ["robô · campanha", () => entradaDoRobo(ROBO, null)],
    ["robô parado", () => entradaDoRobo(PARADO)],
    ["robô desligado", () => entradaDoRobo(null)],
    ["robô · com a semana anterior (seta em todo cartão)", () =>
      entradaDoRobo(ROBO, SEMANA, { leads: [...LEADS_DO_ROBO, ...LEADS_DA_ANTERIOR], adDaily: [...ADS_DA_ANTERIOR, ...ADS_DA_SEMANA] })],
    ["verba sem lead nenhum na semana (CPL em quarentena)", () =>
      entradaDoRobo(ROBO, SEMANA, { leads: LEADS_DA_ANTERIOR, adDaily: [...ADS_DA_ANTERIOR, ...ADS_DA_SEMANA] })],
  ];
  for (const [nome, entrada] of casos) {
    for (const comResumo of [true, false]) {
      it(`${nome} · ${comResumo ? "com resumo" : "sem resumo (o botão)"}`, async () => {
        const { InicioNormal } = await import("@/components/inicio/inicio-normal");
        const { CartoesDoInicio } = await import("@/components/inicio/cartoes");
        const { AtendimentoBloco } = await import("@/components/inicio/atendimento");
        const { LeadsChegandoBloco } = await import("@/components/inicio/leads-chegando");
        const { RodapeDoInicioBloco } = await import("@/components/inicio/rodape");
        const { ResumoSemanalCard } = await import("@/components/kpi/resumo-semanal");
        const e = entrada();
        const ini: Inicio = montarInicio(e);
        const resumos = comResumo ? [RESUMO] : [];
        // O pior caso do resumo: quem pode gerar vê o botão quando não há leitura.
        const props = { resumos, canWrite: true, aiEnabled: true };

        const total = palavras(
          await renderizar(createElement(InicioNormal, { inicio: ini, alertas: [], isSeed: false, rangeKey: e.rangeKey, ...props })),
        );
        const cartoes = palavras(await renderizar(createElement(CartoesDoInicio, { cartoes: ini.cartoes })));
        const htmlLeads = await renderizar(createElement(LeadsChegandoBloco, { bloco: ini.leadsChegando }));
        const htmlAtend = await renderizar(createElement(AtendimentoBloco, { bloco: ini.atendimento }));
        const titulos = [...trechos(htmlLeads, "h3", "data-titulo"), ...trechos(htmlAtend, "h3", "data-titulo")].flatMap(palavras);
        const funil = trechos(htmlAtend, "ol", 'data-parte="funil"').flatMap(palavras);
        const frases = [...trechos(htmlAtend, "p", 'data-parte="frases"'), ...trechos(htmlAtend, "ul", 'data-parte="frases"')].flatMap(palavras);
        const rodapeResumo = [
          ...palavras(await renderizar(createElement(RodapeDoInicioBloco, { rodape: ini.rodape }))),
          ...palavras(await renderizar(createElement(ResumoSemanalCard, props))),
        ];
        // O texto que o GRÁFICO desenha no navegador (no servidor o ResponsiveContainer
        // não desenha nada, e o `<svg>` fica fora de `palavras`): as datas do eixo X. O
        // eixo Y e o "pausado" das faixas não são desenhados no Início (BarrasDoInicio).
        const grafico = datasNoEixo(ini.leadsChegando.dias.length, DATAS_NO_EIXO_DO_INICIO);
        expect(grafico).toBeLessThanOrEqual(DATAS_NO_EIXO_DO_INICIO);
        const conta = {
          total: total.length + grafico,
          cartoes: cartoes.length,
          titulos: titulos.length,
          funil: funil.length,
          frases: frases.length,
          rodapeResumo: rodapeResumo.length,
        };
        for (const [k, max] of Object.entries(ORCAMENTO)) {
          expect(conta[k as keyof typeof conta], `${k}: ${JSON.stringify({ total, cartoes, titulos, funil, frases, rodapeResumo }[k])}`).toBeLessThanOrEqual(max);
        }
        // O que está fora dos blocos (o gráfico no servidor) não esconde palavra: os blocos somam o total.
        expect(conta.total).toBe(conta.cartoes + conta.titulos + conta.funil + conta.frases + conta.rodapeResumo + grafico);
        // Nenhuma descrição embaixo de título: o bloco de Leads só tem o título fora da tabela.
        expect(palavras(htmlLeads)).toEqual(trechos(htmlLeads, "h3", "data-titulo").flatMap(palavras));
      });
    }
  }

  it("sem resumo e sem poder gerar: nada (nem a instrução do cron)", async () => {
    const { ResumoSemanalCard } = await import("@/components/kpi/resumo-semanal");
    for (const [canWrite, aiEnabled] of [
      [false, true],
      [true, false],
      [false, false],
    ] as const) {
      expect(await renderizar(createElement(ResumoSemanalCard, { resumos: [], canWrite, aiEnabled }))).toBe("");
    }
    const botao = await renderizar(createElement(ResumoSemanalCard, { resumos: [], canWrite: true, aiEnabled: true }));
    expect(palavras(botao)).toEqual(["Gerar", "o", "resumo", "da", "semana"]);
    const comResumo = await renderizar(createElement(ResumoSemanalCard, { resumos: [RESUMO], canWrite: false, aiEnabled: false }));
    expect(comResumo).not.toMatch(/cron|ainda não gerado/);
    expect(comResumo).not.toContain("leituras anteriores");
  });
});

describe("os cartões (C4, C5)", () => {
  it("o ⓘ só fala da seta quando há seta: Campanha (sem anterior) não diz 'A seta compara'", async () => {
    const { CartoesDoInicio, deltaDoCartao, infoDoCartao } = await import("@/components/inicio/cartoes");
    const doInfo = async (ini: Inicio) =>
      (await inspecionar(createElement(CartoesDoInicio, { cartoes: ini.cartoes }), clientes)).clients
        .filter((c) => c.nome === "ui/info.tsx:Info")
        .map((c) => String(c.props.texto));
    const campanha = montarInicio(entradaDoSeed("all"));
    const quatro = [campanha.cartoes.investimento, campanha.cartoes.cpl, campanha.cartoes.leads, campanha.cartoes.reunioes];
    for (const c of quatro) {
      expect(deltaDoCartao(c)).toBeUndefined();
      expect(infoDoCartao(c, undefined)).toBe(c.dica);
    }
    const semSeta = await doInfo(campanha);
    expect(semSeta).toHaveLength(4);
    for (const t of semSeta) expect(t).not.toContain("A seta compara");
    // Com a semana anterior: todo cartão com seta diz contra o que ela compara.
    const comAnterior = montarInicio(
      entradaDoRobo(ROBO, SEMANA, { leads: [...LEADS_DO_ROBO, ...LEADS_DA_ANTERIOR], adDaily: [...ADS_DA_ANTERIOR, ...ADS_DA_SEMANA] }),
    );
    const c = comAnterior.cartoes;
    const comSeta = [deltaDoCartao(c.investimento), deltaDoCartao(c.cpl, true), deltaDoCartao(c.leads), deltaDoCartao(c.reunioes)];
    const textos = await doInfo(comAnterior);
    textos.forEach((t, i) => expect(t.includes("A seta compara"), `cartão ${i}`).toBe(Boolean(comSeta[i])));
    expect(comSeta.some(Boolean)).toBe(true);
  });

  it("valor = o texto de `mostrar`; Δ curto; o ⓘ no lugar do hint; Reuniões com UMA linha de custo", async () => {
    const { CartoesDoInicio } = await import("@/components/inicio/cartoes");
    const e = entradaDoRobo();
    const ini = montarInicio(e);
    const html = await renderizar(createElement(CartoesDoInicio, { cartoes: ini.cartoes }));
    for (const c of [ini.cartoes.investimento, ini.cartoes.cpl, ini.cartoes.leads, ini.cartoes.reunioes]) {
      expect(html).toContain(c.texto);
    }
    expect(html).toContain(ini.cartoes.custoReuniao);
    expect(html).not.toContain("vs. anterior<");
    // Quatro ⓘ, um por cartão (a caixa só existe aberta: o texto do ⓘ não está no HTML).
    expect(html.match(/aria-label="Sobre “/g)?.length).toBe(4);
    expect(html).not.toContain(ini.cartoes.cpl.dica);
  });

  it("o custo em quarentena não apaga o Δ das reuniões; a quarentena do CPL apaga o dele", async () => {
    const { CartoesDoInicio, deltaDoCartao } = await import("@/components/inicio/cartoes");
    const e = entradaDoRobo();
    const ini = montarInicio(e);
    // Poucas reuniões de conversão: o custo não se exibe (fato), mas a contagem é válida.
    expect(ini.cartoes.custo.exibivel).toBe(false);
    const reunioes = { ...ini.cartoes.reunioes, valor: 2, anterior: 1, texto: "2" };
    expect(deltaDoCartao(reunioes)?.text).toBe("+100,0%");
    const cpl = { ...ini.cartoes.cpl, texto: "—", confianca: { nivel: "quarentena" as const, motivo: "Nenhum lead registrado no período" } };
    expect(deltaDoCartao(cpl)).toBeUndefined();
    const el = createElement(CartoesDoInicio, { cartoes: { ...ini.cartoes, reunioes, cpl } });
    const html = await renderizar(el);
    expect(html).toContain("+100,0%");
    // O CPL: "—" colado no número, sem seta; o motivo vai para o ⓘ (e o ⚠), não para o corpo.
    expect(html).not.toContain("Nenhum lead registrado no período");
    const infos = (await inspecionar(el, clientes)).clients.filter((c) => c.nome === "ui/info.tsx:Info");
    const doCpl = infos.find((c) => c.props.rotulo === "Sobre “CPL”")!;
    expect(String(doCpl.props.texto).startsWith("Nenhum lead registrado no período. ")).toBe(true);
    expect(String(doCpl.props.texto)).toContain(cpl.dica);
  });
});

describe("C10: quem cai onde", () => {
  it("comercial: fora do modo live vai para a Fila; no modo live fica e grava os números manuais", async () => {
    h.user = { role: "comercial" };
    h.brand = "consorcio";
    h.cfg = LIVE_PADRAO;
    h.caps = new Set(["leads:write"]);
    h.ai = false;
    h.carregado = carregadoNormal(entradaDoRobo());
    await expect(paginaDoInicio("7d")).rejects.toMatchObject({ url: "/fila" });
    await expect(paginaDoInicio()).rejects.toMatchObject({ url: "/fila" });

    const K = chavesDaLive(LIVE_PADRAO);
    h.carregado = carregadoLive(LIVE_PADRAO, K.campanha, "2026-11-20");
    const f = await inspecionar(await paginaDoInicio(K.campanha), clientes);
    const manuais = f.clients.find((c) => c.nome.endsWith(":ManuaisForm"))!;
    expect(manuais.props.podeEditar).toBe(true);
  });

  it("/live só redireciona: a chave da régua fica; o resto vai para a campanha; awareness vai para /", async () => {
    const { default: LivePage } = await import("@/app/(dashboard)/live/page");
    const K = chavesDaLive(LIVE_PADRAO);
    h.cfg = LIVE_PADRAO;
    h.brand = "consorcio";
    const destino = async (range?: string) => {
      try {
        await LivePage({ searchParams: Promise.resolve(range ? { range } : {}) });
      } catch (e) {
        if (e instanceof Redirecionou) return e.url;
        throw e;
      }
      return null;
    };
    expect(await destino(K.posLive)).toBe(`/?range=${K.posLive}`);
    expect(await destino(K.captacao)).toBe(`/?range=${K.captacao}`);
    for (const outro of [undefined, "7d", "all", "2026-10-01..2026-10-31", "lixo"]) expect(await destino(outro)).toBe(`/?range=${K.campanha}`);
    h.brand = "krone";
    expect(await destino(K.campanha)).toBe("/");
  });
});
