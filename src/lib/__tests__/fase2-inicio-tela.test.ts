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
import { createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildSeedData, buildSeedLeadEvents } from "../data/seed";
import { alertasDaLive, alertasDoInicio, montarModoLive } from "../bussola";
import { chavesDaLive } from "../atalho-live";
import { montarFilaDaLive } from "../fila-live";
import { montarInicio, type EntradaInicio, type Inicio } from "../inicio";
import { kpisDoPeriodo } from "../kpis";
import { LIVE_PADRAO, type CampanhaDaLive } from "../live";
import type { DateRange } from "../metrics";
import { pageRange } from "../page-range";
import type { RoboAgora } from "../robo/situacao";
import { EXPEDIENTE_PADRAO } from "../turno";
import type { Intervalo } from "../cobertura";
import type { AdDaily, DashboardData, Lead, LeadEvent, ResumoSemanal } from "../types";
import { datasNoEixo } from "@/components/charts/eixo";
import { DATAS_NO_EIXO_DO_INICIO } from "@/components/inicio/barras-do-inicio";

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

const brt = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`).toISOString();

function base(over: Partial<DashboardData> = {}): DashboardData {
  return {
    campaign: { id: "c", brand: "consorcio", name: "C", objective: "L", status: "ativa", startDate: "2026-09-01", budgetTotal: 0 },
    igAccountDaily: [],
    igPosts: [],
    adDaily: [],
    creatives: [],
    lpDaily: [],
    leads: [],
    goals: [],
    metas: [],
    updatedAt: "2026-10-08T12:00:00.000Z",
    ...over,
  };
}

const ad = (date: string, adId: string, spend: number, extra: Partial<AdDaily> = {}): AdDaily => ({
  brand: "consorcio",
  date,
  campaign: "Campanha",
  adset: "Conjunto",
  adId,
  objective: "OUTCOME_LEADS",
  spend,
  impressions: 1000,
  reach: 800,
  frequency: 1.25,
  clicks: 10,
  leads: 1,
  ...extra,
});

function porMarca(d: DashboardData, brand: string): DashboardData {
  return {
    ...d,
    campaign: { ...d.campaign, brand },
    igAccountDaily: d.igAccountDaily.filter((r) => r.brand === brand),
    igPosts: d.igPosts.filter((r) => r.brand === brand),
    adDaily: d.adDaily.filter((r) => r.brand === brand),
    creatives: d.creatives.filter((r) => r.brand === brand),
    lpDaily: d.lpDaily.filter((r) => r.brand === brand),
    leads: d.leads.filter((r) => r.brand === brand && !r.deletedAt),
    goals: d.goals.filter((r) => r.brand === brand),
  };
}

// O robô de fixture: as colunas `robo_*` que o sync grava no lead (nunca o banco do robô).
const HOJE = "2026-11-04";
const ONTEM = "2026-11-03";
const AGORA = brt(HOJE, "15:00");
const LIDO = brt(HOJE, "14:55");
const ROBO: RoboAgora = { ligado: true, lidoAte: LIDO, confiavel: true, sync: { ultimoOk: LIDO, falha: null } };
const PARADO: RoboAgora = {
  ligado: true,
  lidoAte: brt(HOJE, "12:00"),
  confiavel: false,
  sync: { ultimoOk: brt(HOJE, "12:00"), falha: { desde: brt(HOJE, "12:30"), erro: "timeout" } },
};
const SEMANA: DateRange = { from: "2026-10-29", to: HOJE };

let seq = 0;
const lead = (id: string, over: Partial<Lead> = {}): Lead => ({
  id,
  brand: "consorcio",
  createdAt: brt(HOJE, "09:00"),
  name: `Pessoa ${id}`,
  email: `pessoa.${id}@exemplo.com.br`,
  phone: `55119888${String(++seq).padStart(5, "0")}`,
  status: "lead",
  utmSource: "meta",
  utmContent: "Anúncio com um nome bem comprido para a coluna de origem truncar",
  ...over,
});
const saudado = (dia: string, over: Partial<Lead> = {}): Partial<Lead> => ({
  createdAt: brt(dia, "09:00"),
  roboVistoEm: brt(dia, "09:05"),
  roboRecebidoEm: brt(dia, "09:00"),
  roboSaudacaoEm: brt(dia, "09:00"),
  roboEtapa: "nao_respondeu",
  ...over,
});

const LEADS_DO_ROBO: Lead[] = [
  lead("conversa", {
    ...saudado(HOJE),
    roboRespondeuEm: brt(HOJE, "09:30"),
    roboUltimaMsgClienteEm: brt(HOJE, "12:00"),
    roboUltimaInteracaoEm: brt(HOJE, "12:00"),
    roboEtapa: "em_conversa",
  }),
  lead("esperando", saudado(HOJE)),
  lead("semresposta", saudado(ONTEM)),
  lead("aceitou", {
    ...saudado(ONTEM),
    roboRespondeuEm: brt(ONTEM, "09:10"),
    roboUltimaMsgClienteEm: brt(HOJE, "13:00"),
    roboUltimaInteracaoEm: brt(HOJE, "13:00"),
    roboConviteEm: brt(HOJE, "12:00"),
    roboAceitouEm: brt(HOJE, "13:00"),
    roboEtapa: "transferido",
  }),
  lead("naofalou", { createdAt: brt(HOJE, "11:00") }),
  lead("naorecebeu", { createdAt: brt(HOJE, "14:30") }),
  lead("novinho", { createdAt: brt(HOJE, "14:50") }),
  lead("semtel", { createdAt: brt(HOJE, "10:00"), phone: undefined }),
  lead("liveA", { createdAt: brt(HOJE, "10:00"), classe: "A", bem: "imovel" }),
  lead("liveB", { createdAt: brt(ONTEM, "16:00"), classe: "B", bem: "imovel" }),
  lead("agendado", {
    ...saudado("2026-11-01"),
    roboRespondeuEm: brt("2026-11-01", "09:10"),
    roboAceitouEm: brt("2026-11-01", "10:00"),
    roboEtapa: "transferido",
    status: "agendado",
    bookedAt: brt("2026-11-02", "10:00"),
    meetingFor: brt("2026-11-05", "10:00"),
  }),
  lead("teste", { createdAt: brt(HOJE, "13:00"), name: "teste teste", email: "teste@teste.com" }),
  lead("antes", { createdAt: brt("2026-10-20", "10:00") }),
];

const ADS_DA_SEMANA = [ad("2026-10-30", "100001", 80), ad("2026-11-01", "100001", 100), ad("2026-11-02", "100001", 100), ad(ONTEM, "100001", 100), ad(HOJE, "100001", 50)];

/**
 * A semana ANTERIOR (22–28/10) com verba, leads e uma reunião: todos os cartões
 * ganham a seta — o pior caso do orçamento de palavras, junto com o fato do custo.
 */
const ADS_DA_ANTERIOR = ["2026-10-22", "2026-10-24", "2026-10-26", "2026-10-28"].map((d) => ad(d, "100001", 90));
const LEADS_DA_ANTERIOR: Lead[] = [
  lead("ant1", { createdAt: brt("2026-10-23", "10:00") }),
  lead("ant2", { createdAt: brt("2026-10-24", "10:00") }),
  lead("ant3", { createdAt: brt("2026-10-25", "10:00"), status: "agendado", bookedAt: brt("2026-10-26", "10:00"), meetingFor: brt("2026-10-30", "10:00") }),
];

/** `robo: null` = o robô desligado (sem credencial, desativado ou outra marca). */
function entradaDoRobo(
  robo: RoboAgora | null = ROBO,
  range: DateRange | null = SEMANA,
  over: { leads?: Lead[]; adDaily?: AdDaily[] } = {},
): EntradaInicio {
  const data = base({ leads: over.leads ?? LEADS_DO_ROBO, adDaily: over.adDaily ?? ADS_DA_SEMANA });
  const eventos: LeadEvent[] = [];
  return {
    data,
    range: range ?? undefined,
    rangeKey: range ? `${range.from}..${range.to}` : "all",
    kpis: kpisDoPeriodo(data, range ?? undefined, { hoje: HOJE, agora: AGORA, comparar: true }),
    eventos,
    robo: robo ?? undefined,
    cobertura: [{ from: "2026-10-01", to: ONTEM }],
    expediente: EXPEDIENTE_PADRAO,
    filaLive: montarFilaDaLive(data.leads, eventos, AGORA, EXPEDIENTE_PADRAO),
    agora: AGORA,
    hoje: HOJE,
  };
}

const SEED = porMarca(buildSeedData(), "consorcio");
const SEED_EVENTOS = buildSeedLeadEvents(SEED.leads);
const SEED_HOJE = "2026-07-23";
const SEED_AGORA = brt(SEED_HOJE, "15:00");
const SEED_COBERTURA: Intervalo[] = [{ from: "2026-07-09", to: "2026-07-21" }];

function entradaDoSeed(chave: string): EntradaInicio {
  const { range, rangeKey } = pageRange(SEED, chave, SEED_HOJE);
  return {
    data: SEED,
    range,
    rangeKey,
    kpis: kpisDoPeriodo(SEED, range, { cobertura: SEED_COBERTURA, hoje: SEED_HOJE, agora: SEED_AGORA, comparar: true }),
    eventos: SEED_EVENTOS,
    cobertura: SEED_COBERTURA,
    expediente: EXPEDIENTE_PADRAO,
    filaLive: montarFilaDaLive(SEED.leads, SEED_EVENTOS, SEED_AGORA, EXPEDIENTE_PADRAO),
    agora: SEED_AGORA,
    hoje: SEED_HOJE,
  };
}

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

/** Telefones (crus e só dígitos) e e-mails de TODOS os leads da base. */
function contatosDe(leads: readonly Lead[]): string[] {
  const out = new Set<string>();
  for (const l of leads) {
    if (l.email) out.add(l.email.toLowerCase());
    if (l.phone) {
      out.add(l.phone);
      const d = l.phone.replace(/\D/g, "");
      if (d.length >= 8) out.add(d);
    }
  }
  return [...out];
}

// ---------------------------------------------------------------- a fronteira server → client

/**
 * Os componentes client que a tela pode usar: todo export de um arquivo "use
 * client" das pastas do Início, do painel da live, dos cartões, da ui e dos
 * gráficos, mais os dublês (`next/link`, `RegistrarAlertas`). Um client que
 * faltasse aqui seria CHAMADO como server pelo inspetor e quebraria no 1º hook.
 */
async function componentesClient(): Promise<Map<unknown, string>> {
  const raiz = path.resolve(__dirname, "../../components");
  const out = new Map<unknown, string>();
  for (const dir of ["inicio", "live", "kpi", "ui", "charts"]) {
    for (const arq of fs.readdirSync(path.join(raiz, dir))) {
      if (!arq.endsWith(".tsx")) continue;
      const fonte = fs.readFileSync(path.join(raiz, dir, arq), "utf8");
      if (!/^\s*["']use client["']/.test(fonte)) continue;
      const mod = (await import(path.join(raiz, dir, arq))) as Record<string, unknown>;
      for (const [nome, v] of Object.entries(mod)) if (typeof v === "function") out.set(v, `${dir}/${arq}:${nome}`);
    }
  }
  out.set((await import("next/link")).default, "next/link");
  out.set((await import("@/components/layout/alertas")).RegistrarAlertas, "layout/alertas:RegistrarAlertas");
  return out;
}

interface Fronteira {
  /** A árvore como o servidor a manda: tags, props e, para cada client, as props serializadas. */
  arvore: unknown;
  /** Cada componente client encontrado, com as props que ele recebe (sem `children`). */
  clients: { nome: string; props: Record<string, unknown> }[];
  /** Funções em props (Server Components não passam função para Client Components). */
  funcoes: string[];
}

const FORWARD_REF = Symbol.for("react.forward_ref");
const MEMO = Symbol.for("react.memo");

/**
 * Expande os server components (chamando-os) até chegar em tags e em componentes
 * client — que NÃO são chamados: as props deles são o que cruza a fronteira.
 */
async function inspecionar(raizDaTela: ReactNode, clientes: Map<unknown, string>): Promise<Fronteira> {
  const clients: Fronteira["clients"] = [];
  const funcoes: string[] = [];

  async function valor(v: unknown, onde: string): Promise<unknown> {
    if (v == null) return null;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
    if (typeof v === "function") {
      funcoes.push(onde);
      return "[função]";
    }
    if (isValidElement(v)) return no(v);
    if (Array.isArray(v)) return Promise.all(v.map((x, i) => valor(x, `${onde}[${i}]`)));
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = await valor(x, `${onde}.${k}`);
      return out;
    }
    return String(v);
  }

  async function no(n: ReactNode): Promise<unknown> {
    if (n == null || typeof n === "boolean") return null;
    if (typeof n === "string" || typeof n === "number") return n;
    if (Array.isArray(n)) return Promise.all(n.map(no));
    if (!isValidElement(n)) return valor(n, "?");
    const el = n as ReactElement<Record<string, unknown>>;
    const { children, ...props } = el.props;
    if (el.type === Fragment) return no(children as ReactNode);
    if (typeof el.type === "string") return { tag: el.type, props: await valor(props, el.type), filhos: await no(children as ReactNode) };
    const tipo = el.type as unknown as { $$typeof?: symbol; type?: unknown; displayName?: string; name?: string };
    if (clientes.has(el.type)) {
      const nome = clientes.get(el.type)!;
      const p = (await valor(props, nome)) as Record<string, unknown>;
      clients.push({ nome, props: p });
      return { client: nome, props: p, filhos: await no(children as ReactNode) };
    }
    if (tipo.$$typeof === FORWARD_REF) return { icone: tipo.displayName ?? "forwardRef", props: await valor(props, "icone") };
    if (tipo.$$typeof === MEMO) return no(createElement(tipo.type as never, el.props));
    if (typeof el.type === "function") {
      const saida = await (el.type as (p: unknown) => ReactNode | Promise<ReactNode>)(el.props);
      return no(saida);
    }
    throw new Error(`tipo de elemento desconhecido: ${String(tipo.displayName ?? tipo.name ?? tipo.$$typeof?.toString())}`);
  }

  return { arvore: await no(raizDaTela), clients, funcoes };
}

/** Chaves que nenhum client pode receber: contato, a base, os eventos, a Fila e a linha de Leads. */
const CHAVES_PROIBIDAS = [
  "phone",
  "email",
  "telefone",
  "adDaily",
  "igPosts",
  "lpDaily",
  "eventos",
  "grupos",
  "itens",
  "sinalizadores",
  "atendimentoAgora",
  "kpis",
  "inicio",
  "live",
  "painel",
];

function chavesDe(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => chavesDe(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      chavesDe(x, out);
    }
  }
  return out;
}

function conferirLgpd(f: Fronteira, leads: readonly Lead[]) {
  expect(f.funcoes, "função passada de server para client").toEqual([]);
  const payload = JSON.stringify(f.arvore).toLowerCase();
  for (const c of contatosDe(leads)) expect(payload.includes(c.toLowerCase()), `contato no payload: ${c}`).toBe(false);
  for (const c of f.clients) {
    const chaves = chavesDe(c.props);
    for (const k of CHAVES_PROIBIDAS) expect(chaves.has(k), `${c.nome} recebe "${k}"`).toBe(false);
  }
  expect(/"(phone|email|telefone)"/.test(JSON.stringify(f.clients))).toBe(false);
}

// ---------------------------------------------------------------- palavras visíveis

const VAZIOS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/**
 * As palavras que se LEEM no HTML: fora de `<table>`, de `<svg>`, do que é
 * `aria-hidden` e do miolo de `<details>` fechado (só o `<summary>` aparece). O ⓘ
 * fechado não tem texto no HTML (a caixa só existe aberta). Palavra = pedaço
 * separado por espaço com pelo menos uma letra ou um algarismo (número conta;
 * "·", "→", "—" e "≥" sozinhos, não).
 */
function palavras(html: string): string[] {
  const pilha: { tag: string; oculto: boolean; detalhesFechado: boolean }[] = [];
  const out: string[] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>|([^<]+)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const [, fecha, tagBruta, attrs, autoFecha, texto] = m;
    const topo = pilha.at(-1);
    if (texto !== undefined) {
      if (topo?.oculto) continue;
      const limpo = texto
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'");
      out.push(...limpo.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p)));
      continue;
    }
    const tag = tagBruta.toLowerCase();
    if (fecha) {
      while (pilha.length && pilha.pop()!.tag !== tag) {
        /* desempilha até a tag */
      }
      continue;
    }
    if (autoFecha || VAZIOS.has(tag)) continue;
    const pai = topo;
    const dentroDeDetalheFechado = pai?.detalhesFechado && tag !== "summary";
    const oculto =
      Boolean(pai?.oculto) ||
      Boolean(dentroDeDetalheFechado) ||
      tag === "table" ||
      tag === "svg" ||
      /aria-hidden="true"/.test(attrs);
    pilha.push({ tag, oculto, detalhesFechado: tag === "details" && !/\sopen(=|\s|$)/.test(attrs) });
  }
  return out;
}

/** O trecho do HTML de cada elemento que casa (sem aninhamento da mesma tag). */
function trechos(html: string, tag: string, attr: string): string[] {
  const re = new RegExp(`<${tag}[^>]*${attr}[^>]*>[\\s\\S]*?</${tag}>`, "g");
  return html.match(re) ?? [];
}

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
