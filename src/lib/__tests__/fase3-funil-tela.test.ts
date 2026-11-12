/**
 * Fase 3 (§8.4 da spec) — o Funil na TELA, a partir da página de verdade
 * (`app/(dashboard)/funil/page.tsx`) com o carregador trocado por um objeto
 * montado pela função pura (`montarFunilDaTela`) sobre o seed e sobre o robô de
 * fixture. No molde de `fase2-inicio-tela.test.ts`, com os helpers de `src/test/tela.ts`.
 *
 *   • LGPD: a árvore que o servidor manda não tem telefone, e-mail NEM NOME de lead
 *     (o Funil é só agregado); nenhuma função cruza; os clients formam uma lista
 *     FECHADA (K26) e o gráfico recebe só os pontos da tendência.
 *   • TEXTO (§2.7, K41): manchete ≤ 12, títulos ≤ 12, funil ≤ 75, perdas ≤ 60,
 *     recolhidos ≤ 8, total ≤ 200 e = Σ das partes (nada fora de parte medida, ou
 *     seja, nenhuma descrição sob título); cada linha de perda ≤ 12; nenhuma frase
 *     > 25; nenhum `title=` longo; nenhum `<p>` dentro de lista (K30).
 *   • `?vista=` é ignorado (K33); os números da tela são os do Início e dos kpis.
 *
 * O banco do robô não é lido em lugar nenhum do `src` (trava em `robo-client.test.ts`, K23).
 */
import fs from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { chavesDaLive } from "../atalho-live";
import { alertasDoInicio } from "../bussola";
import { dica } from "../dicionario";
import { formatInt } from "../format";
import { montarFunilDaTela, type FunilDaTela } from "../funil";
import { funilDoProcesso, textoDaTaxa, type DegrauDoProcesso, type DegrauId } from "../funil-processo";
import { montarInicio, type EntradaInicio } from "../inicio";
import { custoExibivel, kpisDoPeriodo, mostrar } from "../kpis";
import { LIVE_PADRAO } from "../live";
import { pageRange } from "../page-range";
import { EXPEDIENTE_PADRAO } from "../turno";
import type { Lead, LeadEvent } from "../types";
import { CHAVES_PROIBIDAS, blocos, componentesClient, conferirLgpd, inspecionar, palavras, trechos } from "@/test/tela";
import {
  ADS_DA_ANTERIOR,
  ADS_DA_SEMANA,
  AGORA,
  HOJE,
  LEADS_DA_ANTERIOR,
  LEADS_DO_ROBO,
  NUNCA_LIDO,
  ONTEM,
  ad,
  PARADO,
  ROBO,
  SEMANA,
  base,
  brt,
  entradaDoRobo,
  entradaDoSeed,
  lead,
  saudado,
} from "@/test/fixtures-robo";
import { aceitouAs, conversou, entradaEm, lpDia, mudouStatus, roboLido, tentativa } from "@/test/fixtures-funil";

// ---------------------------------------------------------------- dublês da página

const h = vi.hoisted(() => ({
  user: { role: "admin" } as null | { role: string },
  brand: "consorcio",
  carregado: null as unknown,
}));
const carregarFunil = vi.hoisted(() => vi.fn<(marca: string, range?: string) => Promise<unknown>>(async () => h.carregado));

vi.mock("next/navigation", () => ({
  usePathname: () => "/funil",
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
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => h.user }));
vi.mock("@/lib/active-brand", async () => {
  const { brandDef } = await import("@/lib/brands");
  return { activeBrandSlug: async () => h.brand, activeBrand: async () => brandDef(h.brand) };
});
vi.mock("@/lib/live-server", () => ({ campanhaDaLive: async () => LIVE_PADRAO }));
vi.mock("@/lib/auth/guard", () => ({ can: async () => true }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: () => false }));
vi.mock("@/lib/data/store", () => ({ getData: vi.fn(), listResumosSemanais: vi.fn(async () => []) }));
// O carregador do Funil: devolve o objeto montado pela função pura e grava com que argumentos foi chamado (K33).
vi.mock("@/lib/funil-server", () => ({ carregarFunil }));

// ---------------------------------------------------------------- utilidades

const ORCAMENTO_FUNIL = { total: 200, manchete: 12, titulos: 12, funil: 75, perdas: 60, recolhidos: 8 };

/** Os ÚNICOS componentes client do Funil (K26): um client novo, de qualquer pasta, quebra aqui. */
const CLIENTS_PERMITIDOS = ["ui/info.tsx:Info", "funil/tendencia-chart.tsx:TendenciaChart", "next/link", "layout/alertas:RegistrarAlertas"];
/** Mais estrito que o Início: nem o nome, nem o id, nem o texto livre do motivo (`data` e `detalhe` são legítimos: os pontos do gráfico e o alerta). */
const PROIBIDAS = [...CHAVES_PROIBIDAS, "name", "nome", "leadId", "lostReasonDetail"];

let clientes: Map<unknown, string>;
beforeAll(async () => {
  clientes = await componentesClient();
});

async function pagina(sp: Record<string, string | string[] | undefined>) {
  const { default: FunilPage } = await import("@/app/(dashboard)/funil/page");
  return FunilPage({ searchParams: Promise.resolve(sp) } as never);
}

const renderizar = (no: unknown) => renderToStaticMarkup(no as ReactElement);

function carregar(e: EntradaInicio): FunilDaTela {
  const funil = montarFunilDaTela(e);
  h.carregado = { rangeKey: e.rangeKey, funil };
  return funil;
}

/** As partes medidas da página (§2.7). */
function partes(html: string) {
  const funilP = trechos(html, "p", 'data-parte="funil"');
  const funilOl = trechos(html, "ol", 'data-parte="funil"');
  const perdasUl = trechos(html, "ul", 'data-parte="perdas"');
  return {
    total: palavras(html),
    manchete: trechos(html, "p", 'data-parte="manchete"').flatMap(palavras),
    titulos: trechos(html, "h3", "data-titulo").flatMap(palavras),
    funil: [...funilP, ...funilOl].flatMap(palavras),
    perdas: perdasUl.flatMap(palavras),
    recolhidos: trechos(html, "details", 'data-parte="recolhido"').flatMap(palavras),
    linhasDePerda: perdasUl.flatMap((ul) => trechos(ul, "li", "")).map(palavras),
    funilP,
    funilOl,
    perdasUl,
  };
}

const nPalavras = (t: string) => t.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p)).length;

// ---------------------------------------------------------------- fixtures próprias

/** Os inscritos da live (com a ficha) — a chave da campanha da live, em 20/11. */
function entradaDaLive(): EntradaInicio {
  const hoje = "2026-11-20";
  const agora = brt(hoje, "15:00");
  const inscrito = (id: string, dia: string, classe: "A" | "B") => lead(`insc-${id}`, { createdAt: brt(dia, "10:00"), bem: "imovel", classe });
  const data = base({
    leads: [inscrito("1", "2026-11-16", "A"), inscrito("2", "2026-11-17", "A"), inscrito("3", "2026-11-17", "B"), ...LEADS_DO_ROBO],
    adDaily: ADS_DA_SEMANA,
  });
  const { range, rangeKey } = pageRange(data, chavesDaLive(LIVE_PADRAO).campanha, hoje);
  const eventos: LeadEvent[] = [];
  return {
    data,
    range,
    rangeKey,
    kpis: kpisDoPeriodo(data, range, { hoje, agora }),
    eventos,
    robo: roboLido(brt(hoje, "14:55")),
    expediente: EXPEDIENTE_PADRAO,
    filaLive: [],
    agora,
    hoje,
  };
}

let seqW = 0;
const varios = (n: number, f: () => Partial<Lead>): Lead[] => Array.from({ length: n }, () => lead(`v${++seqW}`, f()));
const semResposta = (n: number) => varios(n, () => saudado(ONTEM));
const semTel = (n: number) => varios(n, () => ({ createdAt: brt(ONTEM, "10:00"), phone: undefined }));

/**
 * O PIOR CASO de texto (§2.7): o robô ligado com a leitura parada, a LP com visitas,
 * a ponte, receita, as 7 linhas de perda (a de "Sem resposta" com dois alvos) e um
 * alerta (registro em lote). 12 leads, 4 agendaram (todos pelo convite), 3
 * realizadas, 2 vendas (R$ 180.000), 1 confirmação — todas as reuniões de 04/11
 * em diante (Confirmaram com %).
 */
function piorCaso(): EntradaInicio {
  const agendou = (id: string, over: Partial<Lead>) =>
    lead(id, { ...aceitouAs("2026-11-02", "10:00"), bookedAt: brt("2026-11-02", "15:00"), meetingFor: brt(HOJE, "09:00"), ...over });
  const realizada = { attendedAt: brt(HOJE, "10:00") };
  const leads: Lead[] = [
    agendou("w-cli1", { ...realizada, status: "cliente", closedAt: brt(HOJE, "11:00"), value: 90_000 }),
    agendou("w-cli2", { ...realizada, status: "cliente", closedAt: brt(HOJE, "11:00"), value: 90_000 }),
    agendou("w-real", { ...realizada, status: "reuniao_realizada" }),
    agendou("w-ag", { status: "agendado", meetingFor: brt("2026-11-06", "10:00"), reuniaoConfirmadaEm: brt(HOJE, "09:00") }),
    // As 7 linhas de perda.
    lead("w-sr1", { createdAt: brt(ONTEM, "10:00"), status: "sem_resposta", lostAt: brt(HOJE, "10:00") }),
    lead("w-sr2", { createdAt: brt(ONTEM, "11:00"), roboVistoEm: brt(ONTEM, "11:05"), status: "sem_resposta", lostAt: brt(HOJE, "10:00") }),
    lead("w-ci", { createdAt: brt(ONTEM, "10:00"), status: "contato_invalido", lostReasonDetail: "numero_inexistente", lostAt: brt(HOJE, "10:00") }),
    lead("w-si", { createdAt: brt(ONTEM, "10:00"), status: "sem_interesse", lostAt: brt(HOJE, "10:00") }),
    lead("w-des", { createdAt: brt(ONTEM, "10:00"), status: "desistencia", lostAt: brt(HOJE, "10:00") }),
    lead("w-pos", conversou(ONTEM, { roboConviteEm: brt(ONTEM, "10:00"), roboEtapa: "declinou", roboUltimaInteracaoEm: brt(ONTEM, "11:00") })),
    lead("w-esf", conversou(ONTEM, { roboEtapa: "frio", roboEncerradoEm: brt(ONTEM, "12:00"), roboUltimaInteracaoEm: brt(ONTEM, "12:00") })),
    lead("w-opt", saudado(ONTEM, { roboOptOutEm: brt(ONTEM, "12:00"), roboEtapa: "opt_out" })),
  ];
  // "Sem resposta" com 3 tentativas (a 1ª no prazo, o robô a recebeu): vai para a mídia/formulário.
  const eventos: LeadEvent[] = [
    tentativa("w-sr2", brt(ONTEM, "11:30")),
    tentativa("w-sr2", brt(ONTEM, "15:30")),
    tentativa("w-sr2", brt(HOJE, "09:30")),
    // 10 mudanças do mesmo usuário em 9 min: registro em lote → alerta `registro-suspeito`.
    ...["w-cli1", "w-cli2", "w-real", "w-ag", "w-pos", "w-esf", "w-opt", "w-sr1", "w-ci", "w-si"].map((id, i) =>
      mudouStatus(id, brt(HOJE, `10:0${i}`), "em_contato", "lote"),
    ),
  ];
  return entradaEm({ leads, eventos, range: SEMANA, agora: AGORA, hoje: HOJE, robo: PARADO, adDaily: ADS_DA_SEMANA, lpDaily: [lpDia(ONTEM, 1500, 30)] });
}

const CASOS: [string, () => EntradaInicio][] = [
  ["seed · 7d", () => entradaDoSeed("7d")],
  ["seed · 30d", () => entradaDoSeed("30d")],
  ["seed · campanha", () => entradaDoSeed("all")],
  ["robô · semana", () => entradaDoRobo()],
  ["robô · campanha", () => entradaDoRobo(ROBO, null)],
  ["robô parado", () => entradaDoRobo(PARADO)],
  ["robô nunca lido", () => entradaDoRobo(NUNCA_LIDO)],
  ["robô desligado", () => entradaDoRobo(null)],
  [
    "todo antes de 29/10",
    () => entradaDoRobo(ROBO, { from: "2026-10-20", to: "2026-10-28" }, { leads: [...LEADS_DO_ROBO, ...LEADS_DA_ANTERIOR], adDaily: [...ADS_DA_ANTERIOR, ...ADS_DA_SEMANA] }),
  ],
  ["a chave da campanha da live", entradaDaLive],
  ["0 lead no período", () => entradaDoRobo(ROBO, { from: "2026-11-20", to: "2026-11-20" })],
  ["pior caso de texto", piorCaso],
];

// ---------------------------------------------------------------- LGPD e a fronteira

describe("LGPD: o que a página do Funil manda para os componentes client", () => {
  for (const [nome, entrada] of CASOS) {
    it(nome, async () => {
      const e = entrada();
      const f = carregar(e);
      const fr = await inspecionar(await pagina({ range: e.rangeKey }), clientes);
      conferirLgpd(fr, e.data.leads, { semNomes: true, proibidas: PROIBIDAS });
      // A lista FECHADA de clients (K26).
      const nomes = new Set(fr.clients.map((c) => c.nome));
      for (const n of nomes) expect(CLIENTS_PERMITIDOS, `client fora da lista: ${n}`).toContain(n);
      for (const n of ["ui/info.tsx:Info", "funil/tendencia-chart.tsx:TendenciaChart", "layout/alertas:RegistrarAlertas"]) expect(nomes.has(n), n).toBe(true);
      // O gráfico recebe só os pontos da tendência.
      const grafico = fr.clients.find((c) => c.nome === "funil/tendencia-chart.tsx:TendenciaChart")!;
      expect(Object.keys(grafico.props)).toEqual(["data"]);
      const pontos = grafico.props.data as Record<string, unknown>[];
      expect(pontos).toHaveLength(f.semanas.pontos.length);
      pontos.forEach((p, i) => expect(Object.keys(p).sort()).toEqual(Object.keys(f.semanas.pontos[i]).sort()));
      // Todo ⓘ com rótulo próprio (K39).
      for (const c of fr.clients.filter((x) => x.nome === "ui/info.tsx:Info")) {
        expect(typeof c.props.rotulo, JSON.stringify(c.props)).toBe("string");
        expect(c.props.rotulo).not.toBe("O que é isto?");
      }
      // O que o ⚠ recebe é o `alertas` do objeto.
      const reg = fr.clients.find((c) => c.nome === "layout/alertas:RegistrarAlertas")!;
      expect((reg.props.alertas as { id: string }[]).map((a) => a.id)).toEqual(f.alertas.map((a) => a.id));
    });
  }
});

// ---------------------------------------------------------------- o texto

describe("o orçamento de texto (§2.7, K41)", () => {
  for (const [nome, entrada] of CASOS) {
    it(nome, async () => {
      const e = entrada();
      const f = carregar(e);
      const html = renderizar(await pagina({ range: e.rangeKey }));
      const c = partes(html);
      const conta = {
        total: c.total.length,
        manchete: c.manchete.length,
        titulos: c.titulos.length,
        funil: c.funil.length,
        perdas: c.perdas.length,
        recolhidos: c.recolhidos.length,
      };
      for (const [k, max] of Object.entries(ORCAMENTO_FUNIL)) {
        expect(conta[k as keyof typeof conta], `${k}: ${JSON.stringify(c[k as keyof typeof conta])}`).toBeLessThanOrEqual(max);
      }
      // Nada escapa de parte medida: nenhuma descrição embaixo de título, em card nenhum.
      expect(conta.total, JSON.stringify(c.total)).toBe(conta.manchete + conta.titulos + conta.funil + conta.perdas + conta.recolhidos);
      // Cada linha de perda ≤ 12; a manchete ≤ 12; nenhuma frase > 25.
      for (const li of c.linhasDePerda) expect(li.length, li.join(" ")).toBeLessThanOrEqual(12);
      expect(Math.max(0, ...blocos(html).map((b) => b.length))).toBeLessThanOrEqual(25);
      // Nenhum `title=` com mais de 3 palavras (a explicação mora no ⓘ).
      for (const m of html.matchAll(/\btitle="([^"]*)"/g)) expect(nPalavras(m[1]), m[1]).toBeLessThanOrEqual(3);
      // Nenhum <p> dentro de lista (K30), e a linha da leitura parada ACIMA do <ol>.
      for (const lista of [...trechos(html, "ol", ""), ...trechos(html, "ul", "")]) expect(lista).not.toMatch(/<p[\s>]/);
      if (c.funilP.length > 0) expect(html.search(/<p[^>]*data-parte="funil"/)).toBeLessThan(html.search(/<ol[^>]*data-parte="funil"/));
      // Os dois recolhidos, fechados, com o rótulo de navegação.
      expect(trechos(html, "details", 'data-parte="recolhido"')).toHaveLength(2);
      expect(html).not.toMatch(/<details[^>]*\sopen/);
      expect(trechos(html, "summary", "").map(palavras).map((p) => p.join(" "))).toEqual(["Semana a semana", "Coorte por semana de entrada"]);
      // O título do card do funil é a resposta; sem leads, o card não existe (K34).
      if (f.funil) expect(c.titulos.join(" ")).toContain(palavras(`<i>${f.funil.titulo}</i>`).join(" "));
    });
  }

  it("0 lead no período (K34): só a manchete e os recolhidos — sem o card do funil nem o de perdas", async () => {
    const e = entradaDoRobo(ROBO, { from: "2026-11-20", to: "2026-11-20" });
    const f = carregar(e);
    expect(f.funil).toBeNull();
    expect(f.perdas).toBeNull();
    expect(f.manchete.titulo).toBe("Nenhum lead no período");
    const html = renderizar(await pagina({ range: e.rangeKey }));
    const c = partes(html);
    expect(c.funilOl).toEqual([]);
    expect(c.perdasUl).toEqual([]);
    expect(c.titulos).toEqual([]);
    expect(c.manchete).toEqual(["Nenhum", "lead", "no", "período"]);
    expect(c.total.length).toBeLessThanOrEqual(12);
  });

  it("o pior caso: a conta do §2.7 (funil 68, perdas 53, títulos 10, recolhidos 8) — total ≤ 151", async () => {
    const e = piorCaso();
    const f = carregar(e);
    expect(f.alertas.map((a) => a.id)).toContain("registro-suspeito");
    expect(f.funil?.leituraParada).not.toBeNull();
    // Com a leitura parada, "pelo convite" também é o mínimo (o aceite de quem agendou depois da leitura não foi lido).
    expect(f.funil?.ponte).toBe("≥ 4 pelo convite do robô, de ≥ 4 que aceitaram");
    expect(montarFunilDaTela(entradaDoRobo()).funil?.ponte).toBe("1 pelo convite do robô, de 2 que aceitaram");
    expect(f.perdas?.linhas).toHaveLength(7);
    const html = renderizar(await pagina({ range: e.rangeKey }));
    const c = partes(html);
    expect(c.funil.length, c.funil.join(" ")).toBe(68);
    expect(c.perdas.length, c.perdas.join(" ")).toBe(53);
    expect(c.titulos.length, c.titulos.join(" ")).toBe(10);
    expect(c.recolhidos.length).toBe(8);
    expect(c.manchete.length).toBeLessThanOrEqual(12);
    expect(c.total.length).toBe(c.manchete.length + 10 + 68 + 53 + 8);
    expect(c.total.length).toBeLessThanOrEqual(151);
    // A maior linha de perda é a de 10 palavras ("Esfriou depois do convite · robô → Não dá para dizer").
    expect(Math.max(...c.linhasDePerda.map((l) => l.length))).toBe(10);
  });
});

// ---------------------------------------------------------------- a manchete com a leitura parada (K6)

describe("a manchete com a leitura do robô parada leva '⚠' (K6)", () => {
  it("com vencedora fora das etapas do robô", async () => {
    const e = entradaEm({ leads: [...semResposta(4), ...semTel(3)], range: SEMANA, agora: AGORA, hoje: HOJE, robo: PARADO });
    const f = carregar(e);
    expect(f.manchete).toMatchObject({ situacao: "trava", semEtapasDoRobo: true });
    const manchete = trechos(renderizar(await pagina({ range: e.rangeKey })), "p", 'data-parte="manchete"')[0];
    expect(manchete).toContain("⚠");
    expect(manchete).toContain(f.manchete.titulo);
  });

  it("vazia: 'Nenhuma trava fora das etapas do robô ⚠', sem o 'sem leitura desde…'", async () => {
    const e = entradaEm({ leads: semResposta(4), range: SEMANA, agora: AGORA, hoje: HOJE, robo: PARADO });
    const f = carregar(e);
    expect(f.manchete.situacao).toBe("leitura-parada");
    const manchete = trechos(renderizar(await pagina({ range: e.rangeKey })), "p", 'data-parte="manchete"')[0];
    expect(manchete).toContain("⚠");
    expect(palavras(manchete)).toEqual(["Nenhuma", "trava", "fora", "das", "etapas", "do", "robô"]);
    expect(manchete).not.toContain("sem leitura");
  });

  it("em dia: sem '⚠' na manchete", async () => {
    const e = entradaEm({ leads: [...semResposta(4), ...semTel(3)], range: SEMANA, agora: AGORA, hoje: HOJE, robo: ROBO });
    carregar(e);
    expect(trechos(renderizar(await pagina({ range: e.rangeKey })), "p", 'data-parte="manchete"')[0]).not.toContain("⚠");
  });
});

// ---------------------------------------------------------------- estático

describe("estático: sem descrição sob título, sem `vista`", () => {
  const raiz = process.cwd();
  const fonteDaPagina = fs.readFileSync(path.join(raiz, "src/app/(dashboard)/funil/page.tsx"), "utf8");
  const componentes = fs
    .readdirSync(path.join(raiz, "src/components/funil"))
    .filter((a) => /\.tsx?$/.test(a))
    .map((a) => [a, fs.readFileSync(path.join(raiz, "src/components/funil", a), "utf8")] as const);

  it("nem `CardDescription` nem `description=` na página e em `components/funil/*`", () => {
    for (const [nome, fonte] of [["page.tsx", fonteDaPagina] as const, ...componentes]) {
      expect(fonte, nome).not.toContain("CardDescription");
      expect(fonte, nome).not.toContain("description=");
    }
  });

  it("a página não lê `vista` (K33)", () => {
    expect(fonteDaPagina).not.toContain("vista");
  });
});

// ---------------------------------------------------------------- ?vista= (K33)

describe("`?vista=` antigo é ignorado (K33)", () => {
  it("o HTML é o mesmo sem `vista`, e o carregador recebe só a marca e o período", async () => {
    carregar(entradaDoSeed("7d"));
    const com7 = renderizar(await pagina({ range: "7d" }));
    const sem = renderizar(await pagina({}));
    carregarFunil.mockClear();
    expect(renderizar(await pagina({ range: "7d", vista: "coorte" }))).toBe(com7);
    expect(renderizar(await pagina({ vista: "x" }))).toBe(sem);
    expect(renderizar(await pagina({ vista: ["coorte", "periodo"] }))).toBe(sem);
    expect(carregarFunil.mock.calls).toEqual([
      ["consorcio", "7d"],
      ["consorcio", undefined],
      ["consorcio", undefined],
    ]);
    for (const html of [com7, sem]) expect(html).not.toMatch(/href="[^"]*vista=/);
  });
});

// ---------------------------------------------------------------- os números da tela

describe("os números da tela são os dos kpis e os do Início (um número por métrica)", () => {
  const linha = (f: FunilDaTela, id: string) => f.funil?.linhas.find((l) => l.id === id);

  it("Leads e Agendaram = os kpis; os degraus do robô = os do Início, com o MESMO texto do % (K31)", async () => {
    for (const e of [entradaDoRobo(), entradaDoRobo(ROBO, null), entradaDoRobo(null), entradaDoSeed("all")]) {
      const f = carregar(e);
      const k = e.kpis;
      expect(linha(f, "leads")?.texto).toBe(formatInt(k.leads.valor));
      expect(linha(f, "agendaram")?.texto).toBe(formatInt(k.agendaram.valor));
      const ini = montarInicio(e).atendimento;
      for (const d of ini.funil) {
        const l = linha(f, d.id as DegrauId)!;
        expect(l, d.id).toBeDefined();
        expect(l.texto, d.id).toBe(d.texto);
        if (d.id === "leads") continue; // no Funil, a taxa da linha Leads é a do topo (sobre visitas ou impressões)
        const esperado = d.taxa == null ? null : d.id === "agendaram" && ini.funilComRobo ? `${textoDaTaxa(d.taxa)} dos leads` : textoDaTaxa(d.taxa);
        expect(l.taxa, d.id).toBe(esperado);
      }
      // A tela imprime o que o objeto diz.
      const ol = trechos(renderizar(await pagina({ range: e.rangeKey })), "ol", 'data-parte="funil"')[0] ?? "";
      for (const l of f.funil?.linhas ?? []) {
        expect(ol, l.id).toContain(l.texto);
        if (l.taxa) expect(ol, l.id).toContain(l.taxa);
      }
    }
  });

  it("leitura parada: as linhas do robô com '≥' e sem %", () => {
    const f = carregar(entradaDoRobo(PARADO));
    for (const id of ["com-robo", "primeira-msg", "responderam", "aceitaram"]) {
      expect(linha(f, id)?.texto.startsWith("≥ "), id).toBe(true);
      expect(linha(f, id)?.taxa, id).toBeNull();
    }
    expect(f.funil?.leituraParada?.texto).toBe("Robô sem leitura desde 04/11 12:30 ⚠");
  });

  it("o CPL da linha Leads é o do cartão do Início — inclusive com 1 lead de conversão (K18)", () => {
    const casos = [entradaDoRobo(), entradaDoSeed("7d"), entradaDoRobo(ROBO, SEMANA, { leads: [lead("so-um", saudado(ONTEM))] })];
    for (const e of casos) {
      const f = carregar(e);
      const k = e.kpis;
      expect(linha(f, "leads")?.extra).toBe(custoExibivel(k.cpl) ? `CPL ${mostrar(k.cpl, "moeda")}` : null);
      if (custoExibivel(k.cpl)) expect(linha(f, "leads")?.extra).toBe(`CPL ${montarInicio(e).cartoes.cpl.texto}`);
    }
    const umLead = casos[2];
    expect(umLead.kpis.leadsConversao.valor).toBe(1);
    const f = montarFunilDaTela(umLead);
    expect(linha(f, "leads")?.extra).toBe(`CPL ${mostrar(umLead.kpis.cpl, "moeda")}`);
    expect(linha(f, "leads")?.dica).toContain("Sobre 1 lead de conversão.");
  });

  it("LP com histórico e sem linha no período: a linha Leads fica sem %, e o ⚠ tem `lp-sem-dado` (K13)", () => {
    const e = entradaEm({ leads: LEADS_DO_ROBO, range: SEMANA, agora: AGORA, hoje: HOJE, robo: ROBO, adDaily: ADS_DA_SEMANA, lpDaily: [lpDia("2026-10-10", 200, 10)] });
    const f = carregar(e);
    expect(linha(f, "visitas")).toBeUndefined();
    expect(linha(f, "leads")?.taxa).toBeNull();
    expect(linha(f, "leads")?.dica).toContain("Sem %: a landing page não registrou visitas no período (o rastreio pode ter parado).");
    expect(f.alertas.map((a) => a.id)).toContain("lp-sem-dado");
  });

  it("Leads: o ⓘ diz sobre o quê é o % (as visitas na LP, ou as impressões sem LP)", () => {
    const semLp = montarFunilDaTela(entradaDoRobo());
    expect(linha(semLp, "visitas")).toBeUndefined();
    expect(linha(semLp, "leads")?.taxa).not.toBeNull();
    expect(linha(semLp, "leads")?.dica).toContain("O % é sobre as impressões.");
    const comLp = montarFunilDaTela(piorCaso());
    expect(linha(comLp, "leads")?.taxa).not.toBeNull();
    expect(linha(comLp, "leads")?.dica).toContain("O % é sobre as visitas na LP.");
    // Sem %, não diz a base: diz por quê.
    const parou = montarFunilDaTela(entradaEm({ leads: LEADS_DO_ROBO, range: SEMANA, agora: AGORA, hoje: HOJE, robo: ROBO, adDaily: ADS_DA_SEMANA, lpDaily: [lpDia("2026-10-10", 200, 10)] }));
    expect(linha(parou, "leads")?.dica).not.toContain("O % é sobre");
  });

  it("toda linha sem % diz por quê no ⓘ, com o sufixo do motivo (K38)", () => {
    const SUFIXO: Record<string, string> = {
      amostra: " Sem %: menos de 3 na etapa de cima.",
      "nao-aninhada": " Sem %: há mais aqui do que na etapa de cima (registro antigo sem a data do agendamento).",
      "leitura-parada": " Sem %: a leitura do robô está parada; o número é o mínimo.",
      "registro-parcial": " Sem %: há reunião de antes de 04/11, quando o painel não registrava a confirmação; o número é o mínimo.",
      recorte: " Sem %: é um recorte dos leads, não uma etapa.",
    };
    // Legado: a reunião realizada sem o agendamento (mais Realizadas que Agendaram).
    const legado = entradaEm({
      leads: [
        ...[0, 1, 2].map((i) => lead(`sx-ag-${i}`, { createdAt: brt("2026-10-30", "10:00"), status: "agendado", bookedAt: brt("2026-10-30", "15:00"), meetingFor: brt("2026-11-10", "10:00") })),
        ...[0, 1, 2, 3].map((i) => lead(`sx-real-${i}`, { createdAt: brt("2026-10-30", "10:00"), status: "sem_interesse", attendedAt: brt("2026-10-31", "10:00"), lostAt: brt("2026-11-01", "10:00") })),
      ],
      range: SEMANA,
      agora: AGORA,
      hoje: HOJE,
    });
    const vistos = new Set<string>();
    for (const e of [entradaDoRobo(), entradaDoRobo(PARADO), entradaDoSeed("all"), legado, piorCaso()]) {
      const f = montarFunilDaTela(e);
      for (const d of funilDoProcesso(e).degraus as DegrauDoProcesso[]) {
        if (d.taxa !== null || d.semTaxa === null || d.semTaxa === "ancora") continue;
        vistos.add(d.semTaxa);
        const l = linha(f, d.id)!;
        expect(l.taxa, d.id).toBeNull();
        expect(l.dica.endsWith(SUFIXO[d.semTaxa]), `${d.id}: ${l.dica}`).toBe(true);
      }
    }
    expect([...vistos].sort()).toEqual(Object.keys(SUFIXO).sort());
    // No topo: mais leads que visitas é gente que não passou pela LP; menos de 3 visitas, amostra.
    const topo = (visitas: number) =>
      linha(montarFunilDaTela(entradaEm({ leads: LEADS_DO_ROBO, range: SEMANA, agora: AGORA, hoje: HOJE, robo: ROBO, adDaily: ADS_DA_SEMANA, lpDaily: [lpDia(ONTEM, visitas, 1)] })), "leads")!;
    expect(topo(5)).toMatchObject({ taxa: null });
    expect(topo(5).dica.endsWith(" Sem %: há mais aqui do que na etapa de cima (nem todos passaram por ela).")).toBe(true);
    expect(topo(2).dica.endsWith(" Sem %: menos de 3 na etapa de cima.")).toBe(true);
  });

  it("os ⓘ de Confirmaram e de Reuniões realizadas não repetem o verbete", () => {
    for (const e of [piorCaso(), entradaDoSeed("all"), entradaDoRobo()]) {
      const f = montarFunilDaTela(e);
      const conf = linha(f, "confirmaram")!.dica;
      expect(conf.startsWith(dica("confirmaram"))).toBe(true);
      expect(conf.split("desde 04/11").length - 1, conf).toBe(1);
      const real = linha(f, "realizadas")!.dica;
      expect(real.startsWith(dica("reunioes_realizadas"))).toBe(true);
      expect(real.split("sobre os que agendaram").length - 1, real).toBe(1);
      expect(real).toContain("É o comparecimento da coorte.");
    }
  });

  it("o ⓘ de Vendas (K11): receita, sem valor, CAC com o prefixo da verba, ROAS com o inverso, ticket sem; tudo com 3 ou mais vendas", () => {
    const cli = (id: string, value?: number): Lead =>
      lead(id, {
        createdAt: brt("2026-10-30", "10:00"),
        status: "cliente",
        bookedAt: brt("2026-10-30", "15:00"),
        meetingFor: brt("2026-11-02", "10:00"),
        attendedAt: brt("2026-11-02", "10:30"),
        closedAt: brt("2026-11-03", "10:00"),
        value,
      });
    const quatro = () => [cli("vd-1", 90_000), cli("vd-2", 60_000), cli("vd-3", 30_000), cli("vd-4")];
    // O texto do ⓘ com espaço comum (o `formatCurrency` separa "R$" do número com espaço fino inquebrável).
    const vendas = (e: EntradaInicio) => linha(montarFunilDaTela(e), "vendas")!.dica.replace(/\u00a0/g, " ");
    // Anúncio em 2 dos dias, sem sync cobrindo os outros: a verba é piso (`cobertura-de-dias`).
    const adDaily = [ad("2026-10-30", "100001", 300), ad("2026-11-02", "100001", 300)];
    const piso = entradaEm({ leads: quatro(), range: SEMANA, agora: AGORA, hoje: HOJE, adDaily });
    expect(piso.kpis.investimentoConversao.confianca?.nivel).toBe("piso");
    expect(vendas(piso)).toBe(
      `${dica("vendas")} Receita R$ 180.000. 1 sem valor registrado. CAC ≥ R$ 150 · ROAS ≤ 300,00× · ticket médio R$ 45.000. Valor por reunião: R$ 45.000.`,
    );
    // O sync cobriu o período: sem prefixo.
    const coberto = entradaEm({ leads: quatro(), range: SEMANA, agora: AGORA, hoje: HOJE, adDaily, cobertura: [{ from: "2026-10-01", to: HOJE }] });
    expect(vendas(coberto)).toContain("CAC R$ 150 · ROAS 300,00× · ticket médio R$ 45.000.");
    // Teto (gasto de outra marca no total): o CAC é "≤" e o ROAS, "≥".
    const teto = { nivel: "teto" as const, motivo: "outra marca" };
    const comTeto = {
      ...coberto,
      kpis: {
        ...coberto.kpis,
        investimentoConversao: { ...coberto.kpis.investimentoConversao, confianca: teto },
        investimento: { ...coberto.kpis.investimento, confianca: teto },
      },
    };
    expect(vendas(comTeto)).toContain("CAC ≤ R$ 150 · ROAS ≥ 300,00× · ticket médio R$ 45.000.");
    // Sem verba: CAC e ROAS "—"; o ticket não depende dela.
    const semVerba = entradaEm({ leads: quatro().slice(0, 3), range: SEMANA, agora: AGORA, hoje: HOJE, cobertura: [{ from: "2026-10-01", to: HOJE }] });
    expect(vendas(semVerba)).toContain("CAC — · ROAS — · ticket médio R$ 60.000.");
    // Duas vendas: nem CAC, nem ROAS, nem ticket; menos de 3 agendaram, sem valor por reunião.
    const duas = vendas(entradaEm({ leads: quatro().slice(0, 2), range: SEMANA, agora: AGORA, hoje: HOJE, adDaily, cobertura: [{ from: "2026-10-01", to: HOJE }] }));
    expect(duas).toContain("Receita R$ 150.000.");
    expect(duas).toContain("CAC, ROAS e ticket médio só com 3 ou mais vendas.");
    expect(duas).not.toContain("CAC R$");
    expect(duas).not.toContain("Valor por reunião");
    expect(duas).not.toContain("sem valor registrado");
  });

  it("o ⓘ das perdas cabe em 70 palavras com todos os opcionais (K39)", () => {
    const principal = lead("pi-principal", conversou(ONTEM));
    const leads = [
      lead("pi-teste", { createdAt: brt(ONTEM, "10:00"), email: "teste@teste.com", status: "sem_interesse", lostAt: brt(HOJE, "10:00") }),
      principal,
      lead("pi-copia", { ...conversou(HOJE), createdAt: brt(HOJE, "10:00"), phone: principal.phone }),
      lead("pi-agendou-perdeu", { ...conversou(ONTEM), status: "sem_interesse", bookedAt: brt(ONTEM, "15:00"), lostAt: brt(HOJE, "10:00") }),
      lead("pi-live-optout", { createdAt: brt(ONTEM, "10:00"), classe: "A", bem: "imovel", roboVistoEm: brt(ONTEM, "10:05"), roboOptOutEm: brt(ONTEM, "12:00"), roboEtapa: "opt_out" }),
      lead("pi-sr", { createdAt: brt(ONTEM, "10:00"), status: "sem_resposta", lostAt: brt(HOJE, "10:00") }),
    ];
    // 10 mudanças de status do mesmo usuário em 9 minutos: registro em lote.
    const eventos = Array.from({ length: 10 }, (_, i) => mudouStatus(leads[i % leads.length].id, brt(HOJE, `11:0${i}`), "em_contato", "lote"));
    const f = montarFunilDaTela(entradaEm({ leads, eventos, range: SEMANA, agora: AGORA, hoje: HOJE, robo: ROBO }));
    const d = f.perdas!.dica;
    expect(d).toContain("(sem 1 teste e 1 cópia de duplicado)");
    expect(d).toContain("1 encerrado depois de agendar fica fora");
    expect(d).toContain("1 encerrado pelo robô fora do trecho dele (live e outros) não entra.");
    expect(d).toContain("Registro: 100% de 10 em lote ou com atraso > 72 h.");
    expect(nPalavras(d), d).toBeLessThanOrEqual(70);
    // Sem registro no período, a frase curta.
    expect(montarFunilDaTela(entradaEm({ leads, range: SEMANA, agora: AGORA, hoje: HOJE, robo: ROBO })).perdas!.dica).toContain(
      "Registro: nenhuma mudança de status no período.",
    );
  });

  it("o ⚠ do Funil TEM as travas que mexem na verba ou no CPL — as mesmas do Início (K3)", () => {
    // Anúncio em 2 dos dias e nenhum sync cobrindo os outros: `cobertura-de-dias` (afeta verba e CPL).
    const e = entradaEm({
      leads: LEADS_DO_ROBO,
      range: SEMANA,
      agora: AGORA,
      hoje: HOJE,
      robo: ROBO,
      adDaily: [ad("2026-10-30", "100001", 300), ad("2026-11-02", "100001", 300)],
    });
    const doInicio = alertasDoInicio({ data: e.data, range: e.range, kpis: e.kpis, hoje: e.hoje }).find((a) => a.id === "trava-cobertura-de-dias");
    expect(doInicio).toBeDefined();
    expect(montarFunilDaTela(e).alertas.find((a) => a.id === "trava-cobertura-de-dias")).toEqual(doInicio);
    // Verba de conversão e nenhum lead: o CPL sem denominador (`sem-lead`).
    const semLead = entradaEm({ leads: [], range: SEMANA, agora: AGORA, hoje: HOJE, robo: ROBO, adDaily: ADS_DA_SEMANA, cobertura: [{ from: "2026-10-01", to: HOJE }] });
    expect(montarFunilDaTela(semLead).alertas.map((a) => a.id)).toContain("trava-sem-lead");
  });

  it("o ⚠ do Funil nunca tem as travas do custo por reunião nem a atribuição (K3) — que o Início tem", () => {
    const comMacro = entradaDoRobo(ROBO, SEMANA, { leads: [...LEADS_DO_ROBO, lead("macro", { createdAt: brt(ONTEM, "10:00"), utmContent: "{{ad.name}}" })] });
    const doInicio = alertasDoInicio({ data: comMacro.data, range: comMacro.range, kpis: comMacro.kpis, hoje: comMacro.hoje }).map((a) => a.id);
    expect(doInicio).toContain("atribuicao-macro");
    expect(doInicio.some((id) => id === "trava-sem-reuniao" || id === "trava-cpr-amostra")).toBe(true);
    for (const e of [comMacro, ...CASOS.map(([, entrada]) => entrada())]) {
      const ids = montarFunilDaTela(e).alertas.map((a) => a.id);
      expect(ids).not.toContain("trava-sem-reuniao");
      expect(ids).not.toContain("trava-cpr-amostra");
      expect(ids).not.toContain("trava-fontes-divergem");
      expect(ids.filter((id) => id.startsWith("atribuicao-"))).toEqual([]);
    }
  });
});
