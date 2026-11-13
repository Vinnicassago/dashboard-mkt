/**
 * Fase 2 (nov/26), etapa B2 — a navegação e o seletor de período. "Bússola" vira
 * "Início" (sem vistas: a live de 01/12 é atalho de período, não aba), o período
 * padrão tem uma fonte só, o Início do comercial abre o painel da live enquanto o
 * atalho existe, e as regras do seletor (`estadoDoSeletor`, puro) — qual botão
 * acende, quando o "Escolher" acende, se o popover abre vazio e o rótulo do botão
 * único do celular. Fixtures sintéticas (a régua padrão do briefing).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { House } from "lucide-react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  NAV,
  comPeriodoDaTela,
  hrefDoItem,
  inicioDoComercial,
  itemAtivo,
  navItemFromPath,
  periodoPadraoDe,
  vistasForBrand,
} from "@/components/layout/nav-items";
import { estadoDoSeletor, type AtalhoDoSeletor } from "@/components/layout/periodo-do-seletor";
import { RecommendationsCard } from "@/components/kpi/recommendations";
import { atalhoDaLive, chavesDaLive } from "../atalho-live";
import { brandDef } from "../brands";
import { montarInicio } from "../inicio";
import { LIVE_PADRAO, type CampanhaDaLive } from "../live";
import {
  PERIODO_PADRAO_DA_MIDIA,
  PERIODO_PADRAO_DO_INICIO,
  PERIODO_PADRAO_POR_ROTA,
  buildCustomKey,
  comPeriodo,
  periodoPadraoDaRota,
} from "../range";
import type { Recommendation } from "../recommendations";
import { ROBO, entradaDoRobo } from "@/test/fixtures-robo";

// O link do Next fora do roteador: um <a> com o href (o que importa aqui).
vi.mock("next/link", async () => {
  const { createElement: el } = await import("react");
  return {
    default: function Link({ href, children, ...resto }: { href: string; children?: ReactNode }) {
      return el("a", { href, ...resto }, children);
    },
  };
});

const ler = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

const CHAVES = chavesDaLive(LIVE_PADRAO);
const LISTA_DE_CHAVES = Object.values(CHAVES);
/** Antes do fim (hoje, 05/11) e depois do último dia da régua (15/12). */
const ANTES = atalhoDaLive(LIVE_PADRAO, "2026-11-05", "conversao");
const DEPOIS = atalhoDaLive(LIVE_PADRAO, "2026-12-16", "conversao");

const inicio = () => NAV.find((n) => n.href === "/")!;

// ------------------------------------------------------------------ nav-items

describe("navegação — o Início", () => {
  it("'Bússola' vira 'Início', com a casa, a pergunta nova e sem vistas", () => {
    const item = inicio();
    expect(item.label).toBe("Início");
    expect(item.Icon).toBe(House);
    expect(item.grupo).toBe("Visão geral");
    expect(item.pergunta).toBe("O que chegou, quanto custou e quem está esperando agora?");
    expect(item.vistas).toBeUndefined();
    expect(vistasForBrand(item, brandDef("consorcio"))).toEqual([]);
    // Nenhuma aba "Bússola" e nenhuma vista apontando para /live.
    expect(NAV.some((n) => n.label === "Bússola")).toBe(false);
    expect(NAV.flatMap((n) => n.vistas ?? []).some((v) => v.href.startsWith("/live"))).toBe(false);
    // A navegação continua com 7.
    expect(NAV).toHaveLength(7);
  });

  it("o período padrão do Início tem UMA fonte (range.ts), lida pela navegação e pelo carregador", () => {
    expect(PERIODO_PADRAO_DO_INICIO).toBe("7d");
    expect(inicio().periodoPadrao).toBe(PERIODO_PADRAO_DO_INICIO);
    expect(periodoPadraoDe("/")).toBe(PERIODO_PADRAO_DO_INICIO);
    // A Mídia também olha a semana (Fase 4: "o que faço com a verba esta semana?").
    expect(PERIODO_PADRAO_DA_MIDIA).toBe("7d");
    expect(periodoPadraoDe("/midia")).toBe(PERIODO_PADRAO_DA_MIDIA);
    expect(NAV.find((n) => n.href === "/midia")!.periodoPadrao).toBe(PERIODO_PADRAO_DA_MIDIA);
    expect(NAV.find((n) => n.href === "/midia")!.pergunta).toBe("O que faço com a verba esta semana?");
    // O resto olha a campanha inteira; /live (redirect) não é página da navegação.
    expect(periodoPadraoDe("/funil")).toBe("all");
    expect(periodoPadraoDe("/conteudo/posts")).toBe("all");
    expect(periodoPadraoDe("/live")).toBe("all");
    // O carregador lê a mesma constante (o nome que page.tsx importa fica).
    expect(ler("src/lib/bussola-server.ts")).toMatch(/export const PERIODO_PADRAO_DA_BUSSOLA = PERIODO_PADRAO_DO_INICIO;/);
    expect(ler("src/components/layout/nav-items.ts")).not.toMatch(/periodoPadrao:\s*"/);
  });

  it("UMA fonte do comportamento (K38): o campo do NAV, `periodoPadraoDe` e `periodoPadraoDaRota` concordam", () => {
    expect(PERIODO_PADRAO_POR_ROTA).toEqual({ "/": PERIODO_PADRAO_DO_INICIO, "/midia": PERIODO_PADRAO_DA_MIDIA });
    for (const item of NAV) {
      expect(item.periodoPadrao ?? "all", item.href).toBe(periodoPadraoDaRota(item.href));
      expect(periodoPadraoDe(item.href), item.href).toBe(periodoPadraoDaRota(item.href));
      for (const v of item.vistas ?? []) expect(periodoPadraoDe(v.href), v.href).toBe(periodoPadraoDaRota(v.href));
    }
  });

  it("periodoPadraoDaRota: pelo CAMINHO do href — '/' só exato, as outras por prefixo com fronteira", () => {
    expect(periodoPadraoDaRota("/midia/x?y=1#z")).toBe("7d");
    expect(periodoPadraoDaRota("/midia")).toBe("7d");
    expect(periodoPadraoDaRota("/midia#conjuntos")).toBe("7d");
    expect(periodoPadraoDaRota("/")).toBe("7d");
    expect(periodoPadraoDaRota("/#topo")).toBe("7d");
    expect(periodoPadraoDaRota("/?x=1")).toBe("7d");
    expect(periodoPadraoDaRota("/funil")).toBe("all");
    expect(periodoPadraoDaRota("/midiax")).toBe("all");
    expect(periodoPadraoDaRota("/leads/LEAD-1")).toBe("all");
  });

  it("item ativo só pela rota dele: /live não acende o Início", () => {
    expect(itemAtivo("/", inicio())).toBe(true);
    expect(itemAtivo("/live", inicio())).toBe(false);
    expect(navItemFromPath("/live")).toBeUndefined();
    expect(navItemFromPath("/conteudo/posts")?.label).toBe("Conteúdo");
    expect(navItemFromPath("/configuracoes/marcas")?.label).toBe("Configurações");
    expect(navItemFromPath("/leads/LEAD-1")?.label).toBe("Leads");
    expect(navItemFromPath("/filas")).toBeUndefined();
  });

  it("as constantes fixas da live saíram (a régua editável manda)", () => {
    expect(() => ler("src/lib/live-periodo.ts")).toThrow();
    expect(ler("src/components/layout/nav-items.ts")).not.toMatch(/live-periodo|PERIODO_DA_LIVE/);
  });
});

describe("navegação — o Início do comercial", () => {
  const hrefFor = (href: string) => comPeriodo(href, "30d");

  it("enquanto o atalho está visível, aponta para o painel da live (/?range=<chave da campanha>)", () => {
    expect(ANTES.visivel).toBe(true);
    const href = inicioDoComercial("comercial", ANTES);
    expect(href).toBe(`/?range=${CHAVES.campanha}`);
    expect(href).toBe("/?range=2026-11-16..2026-12-15");
    expect(hrefDoItem(inicio(), hrefFor, href)).toBe(href);
    // Só o Início muda; o resto leva o período da tela.
    const fila = NAV.find((n) => n.href === "/fila")!;
    expect(hrefDoItem(fila, hrefFor, href)).toBe("/fila?range=30d");
  });

  it("depois do fim, sem atalho ou em outro papel: o link de sempre", () => {
    expect(DEPOIS.visivel).toBe(false);
    expect(inicioDoComercial("comercial", DEPOIS)).toBeNull();
    expect(inicioDoComercial("comercial", null)).toBeNull();
    expect(inicioDoComercial("marketing", ANTES)).toBeNull();
    expect(inicioDoComercial("admin", ANTES)).toBeNull();
    // Modo aberto (sem AUTH_SECRET): ninguém logado.
    expect(inicioDoComercial(null, ANTES)).toBeNull();
    expect(hrefDoItem(inicio(), hrefFor, null)).toBe("/?range=30d");
    expect(hrefDoItem(inicio(), (h) => h, undefined)).toBe("/");
  });

  it("a régua editada muda a chave do atalho e o link do comercial junto", () => {
    const editada: CampanhaDaLive = { ...LIVE_PADRAO, nome: "Live de dezembro", periodo: { de: "2026-11-20", ate: "2026-12-20" } };
    const atalho = atalhoDaLive(editada, "2026-12-18", "conversao");
    expect(atalho.rotulo).toBe("Live de dezembro");
    expect(inicioDoComercial("comercial", atalho)).toBe("/?range=2026-11-20..2026-12-20");
  });

  it("marca awareness nunca vê o atalho", () => {
    expect(atalhoDaLive(LIVE_PADRAO, "2026-11-05", "awareness").visivel).toBe(false);
    expect(inicioDoComercial("comercial", atalhoDaLive(LIVE_PADRAO, "2026-11-05", "awareness"))).toBeNull();
  });
});

// ------------------------------------------------------------------ seletor

const ids = (ops: { id: string }[]) => ops.map((o) => o.id);
const ativos = (ops: { id: string; ativo: boolean }[]) => ops.filter((o) => o.ativo).map((o) => o.id);

describe("seletor de período — o atalho da live", () => {
  it("com a chave da campanha: o botão da live aceso com o nome, e o 'Escolher' apagado", () => {
    const e = estadoDoSeletor(CHAVES.campanha, ANTES, LISTA_DE_CHAVES);
    expect(e.liveAtiva).toBe(true);
    expect(e.escolherAceso).toBe(false);
    expect(ativos(e.emLinha)).toEqual(["live"]);
    expect(ativos(e.lista)).toEqual(["live"]);
    const live = e.emLinha.find((o) => o.id === "live")!;
    expect(live.rotulo).toBe("Live 01/12");
    expect(live.titulo).toBe("Live 01/12");
    expect(live.chave).toBe(CHAVES.campanha);
    expect(e.emLinha.find((o) => o.id === "escolher")!.rotulo).toBe("Escolher");
    expect(e.rotuloAtual).toBe("Live 01/12");
    expect(e.popover).toEqual({ de: "", ate: "", vazio: true });
  });

  it("depois do fim o botão some — mas com a chave na URL ele aparece aceso com o nome", () => {
    const comChave = estadoDoSeletor(CHAVES.campanha, DEPOIS, LISTA_DE_CHAVES);
    expect(ids(comChave.emLinha)).toContain("live");
    expect(ativos(comChave.emLinha)).toEqual(["live"]);
    expect(comChave.rotuloAtual).toBe("Live 01/12");
    expect(comChave.escolherAceso).toBe(false);
    expect(comChave.popover.vazio).toBe(true);

    const semChave = estadoDoSeletor("7d", DEPOIS, LISTA_DE_CHAVES);
    expect(ids(semChave.emLinha)).not.toContain("live");
    expect(ids(semChave.lista)).not.toContain("live");
    expect(semChave.rotuloAtual).toBe("7 dias");
  });

  it("captação e pós-live: período livre como hoje (datas no 'Escolher'), mas o popover abre vazio", () => {
    const cap = estadoDoSeletor(CHAVES.captacao, ANTES, LISTA_DE_CHAVES);
    expect(cap.liveAtiva).toBe(false);
    expect(cap.escolherAceso).toBe(true);
    expect(ativos(cap.emLinha)).toEqual(["escolher"]);
    expect(cap.emLinha.find((o) => o.id === "escolher")!.rotulo).toBe("16/11 a 01/12");
    expect(cap.rotuloAtual).toBe("16/11 a 01/12");
    expect(cap.popover).toEqual({ de: "", ate: "", vazio: true });

    const pos = estadoDoSeletor(CHAVES.posLive, ANTES, LISTA_DE_CHAVES);
    expect(pos.escolherAceso).toBe(true);
    expect(pos.rotuloAtual).toBe("02/12 a 15/12");
    expect(pos.popover).toEqual({ de: "", ate: "", vazio: true });
  });

  it("as três chaves abrem o popover vazio também depois do fim", () => {
    for (const k of LISTA_DE_CHAVES) {
      expect(estadoDoSeletor(k, DEPOIS, LISTA_DE_CHAVES).popover.vazio).toBe(true);
    }
  });

  it("preset: como hoje — só ele aceso, 'Escolher' apagado, popover sem datas", () => {
    for (const [key, rotulo] of [
      ["all", "Campanha"],
      ["90d", "90 dias"],
      ["30d", "30 dias"],
      ["14d", "14 dias"],
      ["7d", "7 dias"],
    ] as const) {
      const e = estadoDoSeletor(key, ANTES, LISTA_DE_CHAVES);
      expect(ativos(e.emLinha)).toEqual([key]);
      expect(ativos(e.lista)).toEqual([key]);
      expect(e.escolherAceso).toBe(false);
      expect(e.liveAtiva).toBe(false);
      expect(e.rotuloAtual).toBe(rotulo);
      expect(e.popover).toEqual({ de: "", ate: "", vazio: false });
    }
  });

  it("período livre comum: 'Escolher' aceso com as datas e o popover já preenchido", () => {
    const k = buildCustomKey("2026-10-01", "2026-10-15");
    const e = estadoDoSeletor(k, ANTES, LISTA_DE_CHAVES);
    expect(e.escolherAceso).toBe(true);
    expect(ativos(e.emLinha)).toEqual(["escolher"]);
    expect(e.emLinha.find((o) => o.id === "escolher")!.rotulo).toBe("01/10 a 15/10");
    expect(e.rotuloAtual).toBe("01/10 a 15/10");
    expect(e.popover).toEqual({ de: "2026-10-01", ate: "2026-10-15", vazio: false });
    // Só o "De": daquela data em diante.
    const aberto = estadoDoSeletor("2026-10-01..", ANTES, LISTA_DE_CHAVES);
    expect(aberto.rotuloAtual).toBe("desde 01/10");
    expect(aberto.popover).toEqual({ de: "2026-10-01", ate: "", vazio: false });
  });

  it("chave antiga da live (a régua foi editada) é período livre comum", () => {
    const editada: CampanhaDaLive = { ...LIVE_PADRAO, periodo: { de: "2026-11-20", ate: "2026-12-20" } };
    const atalho = atalhoDaLive(editada, "2026-11-05", "conversao");
    const e = estadoDoSeletor(CHAVES.campanha, atalho, Object.values(chavesDaLive(editada)));
    expect(e.liveAtiva).toBe(false);
    expect(e.escolherAceso).toBe(true);
    expect(e.rotuloAtual).toBe("16/11 a 15/12");
    expect(e.popover.vazio).toBe(false);
  });

  it("sem atalho (awareness): nenhum botão da live; a chave dela é período livre comum", () => {
    const e = estadoDoSeletor(CHAVES.campanha, null);
    expect(ids(e.emLinha)).toEqual(["all", "90d", "30d", "14d", "7d", "escolher"]);
    expect(e.liveAtiva).toBe(false);
    expect(e.escolherAceso).toBe(true);
    expect(e.rotuloAtual).toBe("16/11 a 15/12");
  });

  it("ordem: em linha o atalho fica ao lado de 'Campanha'; no celular, antes do 'Escolher…'", () => {
    const e = estadoDoSeletor("7d", ANTES, LISTA_DE_CHAVES);
    expect(ids(e.emLinha)).toEqual(["all", "live", "90d", "30d", "14d", "7d", "escolher"]);
    expect(ids(e.lista)).toEqual(["all", "90d", "30d", "14d", "7d", "live", "escolher"]);
    expect(e.lista.map((o) => o.rotulo)).toEqual(["Campanha", "90 dias", "30 dias", "14 dias", "7 dias", "Live 01/12", "Escolher…"]);
    // Cada opção de período leva a chave que aplica; "Escolher" abre o popover.
    expect(e.emLinha.filter((o) => o.tipo !== "escolher").every((o) => typeof o.chave === "string")).toBe(true);
    expect(e.emLinha.find((o) => o.id === "escolher")!.chave).toBeUndefined();
  });

  it("chave inválida: nada aceso e o botão do celular diz o que a página mostra (a campanha)", () => {
    const e = estadoDoSeletor("lixo", ANTES, LISTA_DE_CHAVES);
    expect(ativos(e.emLinha)).toEqual([]);
    expect(e.rotuloAtual).toBe("Campanha");
    expect(e.popover).toEqual({ de: "", ate: "", vazio: false });
  });

  it("nunca há dois botões acesos", () => {
    const atalhos: (AtalhoDoSeletor | null)[] = [ANTES, DEPOIS, null];
    const chaves = ["all", "7d", "30d", ...LISTA_DE_CHAVES, "2026-10-01..2026-10-15", "lixo"];
    for (const a of atalhos) {
      for (const k of chaves) {
        const e = estadoDoSeletor(k, a, LISTA_DE_CHAVES);
        expect(ativos(e.emLinha).length).toBeLessThanOrEqual(1);
        expect(ativos(e.lista).length).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ------------------------------------------------------------------ cabeçalho e layout

describe("cabeçalho — a pergunta vira o ⓘ do título", () => {
  const header = ler("src/components/layout/header.tsx");

  it("a pergunta sai da linha de baixo e vai para o Info ao lado do título", () => {
    expect(header).toMatch(/<Info texto=\{item\.pergunta\}/);
    expect(header).not.toMatch(/<span[^>]*>\{item\.pergunta\}<\/span>/);
    // O separador do frescor não supõe mais a pergunta antes.
    expect(header).toMatch(/\{i > 0 \? " · " : ""\}/);
    expect(header).not.toMatch(/i > 0 \|\| item/);
  });

  it("o layout passa o atalho da régua editável e o href do Início ao cabeçalho e às navegações", () => {
    const layout = ler("src/app/(dashboard)/layout.tsx");
    expect(layout).toMatch(/atalhoDaLive\(cfg, hojeEmBrasilia\(agora\), brand\.type\)/);
    expect(layout).toMatch(/campanhaDaLive\(\)/);
    expect(layout).toMatch(/<Sidebar brand=\{brand\} hrefDoInicio=\{hrefDoInicio\} \/>/);
    expect(layout).toMatch(/<MobileNav brand=\{brand\} hrefDoInicio=\{hrefDoInicio\} \/>/);
    expect(layout).toMatch(/atalhoLive=\{atalhoLive\}/);
  });
});

describe("o período viaja nos links — Campanha vai explícita para o Início", () => {
  it("de uma página que mostra Campanha (sem ?range=), o Início abre em Campanha, não em 7 dias", () => {
    // /funil sem ?range= mostra a campanha inteira; o link da barra lateral leva isso ao Início.
    const naTela = periodoPadraoDe("/funil");
    expect(naTela).toBe("all");
    const hrefFor = (h: string) => comPeriodoDaTela(h, naTela);
    expect(hrefDoItem(inicio(), hrefFor, null)).toBe("/?range=all");
    // Os destinos cujo padrão também é a campanha seguem sem o parâmetro (a Mídia não: abre na semana).
    for (const h of ["/funil", "/fila", "/leads", "/conteudo/posts", "/configuracoes"]) expect(comPeriodoDaTela(h, "all")).toBe(h);
    expect(comPeriodoDaTela("/midia", "all")).toBe("/midia?range=all");
    // O Início do comercial no modo live não muda.
    expect(hrefDoItem(inicio(), hrefFor, `/?range=${CHAVES.campanha}`)).toBe(`/?range=${CHAVES.campanha}`);
  });

  it("do Início (sem ?range= = a semana) os links levam 7d; com Campanha explícita, ninguém leva range", () => {
    expect(comPeriodoDaTela("/funil", periodoPadraoDe("/"))).toBe("/funil?range=7d");
    expect(comPeriodoDaTela("/fila#live", "all")).toBe("/fila#live");
    expect(comPeriodoDaTela("/#topo", "all")).toBe("/?range=all#topo");
    expect(comPeriodoDaTela("/?x=1", "all")).toBe("/?x=1&range=all");
    // Link que já leva range de propósito sai intacto.
    expect(comPeriodoDaTela("/?range=7d", "all")).toBe("/?range=7d");
    expect(comPeriodoDaTela("/", null)).toBe("/");
    // `comPeriodo` sem o 3º argumento: o padrão do destino sai da rota (F4-D1) — também
    // nos links montados no servidor, "Campanha" vai explícita para o Início e a Mídia.
    expect(comPeriodo("/", "all")).toBe("/?range=all");
    expect(comPeriodo("/#topo", "all")).toBe("/?range=all#topo");
    expect(comPeriodo("/", "all", "7d")).toBe("/?range=all");
    expect(comPeriodo("/funil", "all", "all")).toBe("/funil");
    expect(comPeriodo("/funil", "all")).toBe("/funil");
  });

  it("Campanha vai explícita para a Mídia (padrão 7 dias); da Mídia sem ?range=, os links levam 7d", () => {
    expect(comPeriodoDaTela("/midia", "all")).toBe("/midia?range=all");
    expect(comPeriodoDaTela("/midia#conjuntos", "all")).toBe("/midia?range=all#conjuntos");
    expect(comPeriodoDaTela("/funil", periodoPadraoDe("/midia"))).toBe("/funil?range=7d");
    expect(comPeriodo("/midia", "all")).toBe("/midia?range=all");
    expect(comPeriodo("/midia", "7d")).toBe("/midia?range=7d");
  });

  it("o rodapé do Início em Campanha leva a Mídia em Campanha (`/midia?range=all`)", () => {
    const e = entradaDoRobo(ROBO, null);
    expect(e.rangeKey).toBe("all");
    const hrefs = montarInicio(e).rodape.links.map((l) => l.href);
    expect(hrefs).toContain("/midia?range=all");
    expect(hrefs).not.toContain("/midia");
  });

  it("o 'abrir →' de vanity-objective em Conteúdo (sem ?range= = Campanha) leva `range=all` à Mídia", () => {
    const rec = { id: "vanity-objective", severity: "media", title: "Mude o objetivo de 2 conjuntos de descoberta", detail: "x", dono: "MKT", href: "/midia#conjuntos" } as Recommendation;
    const html = renderToStaticMarkup(createElement(RecommendationsCard, { recs: [rec], rangeKey: periodoPadraoDe("/conteudo") }));
    expect(periodoPadraoDe("/conteudo")).toBe("all");
    expect(html).toContain('href="/midia?range=all#conjuntos"');
  });

  it("o hook da barra lateral usa a regra do destino", () => {
    const hook = ler("src/components/layout/use-periodo.ts");
    expect(hook).toMatch(/comPeriodoDaTela\(href, range\)/);
  });
});
