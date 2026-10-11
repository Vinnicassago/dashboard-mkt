/**
 * Fase 6.6 — Configurações em vistas. Fixtures sintéticas (nenhum dado real).
 */
import { describe, expect, it } from "vitest";
import { NAV } from "@/components/layout/nav-items";
import {
  VISTA_CONFIG,
  VISTA_DA_ANCORA,
  ehLinkDeConfiguracoes,
  estadoDaSincronizacao,
  estadoDoRobo,
  linkDeConfiguracoes,
  pendenciasDeConfiguracoes,
  visibilidadePorPapel,
} from "../configuracoes";
import { parseLeadsCsv, previaLeadsCsv } from "../leads-csv";
import type { Trava } from "../trust";

describe("6.6 — âncoras e vistas", () => {
  it("as vistas do módulo são as que a navegação declara", () => {
    const nav = NAV.find((n) => n.href === "/configuracoes")!;
    expect(Object.values(VISTA_CONFIG)).toEqual(nav.vistas!.map((v) => v.href));
    // Toda âncora aponta para uma vista existente.
    for (const vista of Object.values(VISTA_DA_ANCORA)) expect(VISTA_CONFIG[vista]).toBeDefined();
  });

  it("cada âncora cai na vista que a abriga, com a query preservada", () => {
    expect(linkDeConfiguracoes("/configuracoes#metas")).toBe("/configuracoes#metas");
    expect(linkDeConfiguracoes("/configuracoes#orcamento")).toBe("/configuracoes#orcamento");
    expect(linkDeConfiguracoes("/configuracoes#pendencias")).toBe("/configuracoes#pendencias");
    expect(linkDeConfiguracoes("/configuracoes?range=7d#metas-conteudo")).toBe("/configuracoes?range=7d#metas-conteudo");
    expect(linkDeConfiguracoes("/configuracoes#utm")).toBe("/configuracoes/ferramentas#utm");
    expect(linkDeConfiguracoes("/configuracoes#whatsapp")).toBe("/configuracoes/ferramentas#whatsapp");
    expect(linkDeConfiguracoes("/configuracoes#diagnostico-leads")).toBe("/configuracoes/ferramentas#diagnostico-leads");
    expect(linkDeConfiguracoes("/configuracoes#marcas")).toBe("/configuracoes/marcas#marcas");
    expect(linkDeConfiguracoes("/configuracoes#integracoes")).toBe("/configuracoes/integracoes#integracoes");
    expect(linkDeConfiguracoes("/configuracoes#perigo")).toBe("/configuracoes/perigo#perigo");
    // Já na vista certa: fica como está.
    expect(linkDeConfiguracoes("/configuracoes/ferramentas#utm")).toBe("/configuracoes/ferramentas#utm");
    expect(linkDeConfiguracoes("/configuracoes/integracoes")).toBe("/configuracoes/integracoes");
    // Rota antiga.
    expect(linkDeConfiguracoes("/config#marcas")).toBe("/configuracoes/marcas#marcas");
    expect(linkDeConfiguracoes("/config?range=30d")).toBe("/configuracoes?range=30d");
    // Fora de Configurações ou âncora desconhecida: intocado.
    expect(linkDeConfiguracoes("/fila")).toBe("/fila");
    expect(linkDeConfiguracoes("/configuracoes#desconhecida")).toBe("/configuracoes#desconhecida");
    expect(ehLinkDeConfiguracoes("/configuracoes/marcas")).toBe(true);
    expect(ehLinkDeConfiguracoes("/configuracoesx")).toBe(false);
    expect(ehLinkDeConfiguracoes("/fila?etapa=novo")).toBe(false);
  });
});

describe("6.6 — O que falta aqui", () => {
  const trava = (id: string, nivel: Trava["nivel"], href?: string): Trava => ({
    id,
    nivel,
    titulo: `Trava ${id}`,
    detalhe: "detalhe",
    afeta: [],
    cta: href ? { label: `Ir ${id}`, href } : undefined,
  });
  const travas: Trava[] = [
    trava("metas-ausentes", "config", "/configuracoes#metas"),
    trava("budget-ausente", "config", "/configuracoes#orcamento"),
    trava("marca-sem-regra", "teto", "/configuracoes/marcas"),
    trava("cobertura-de-dias", "piso", "/configuracoes/integracoes"),
    trava("sem-lead", "quarentena", "/configuracoes/integracoes"),
    trava("cpr-amostra", "quarentena", "/fila"),
    trava("sem-cta", "piso"),
  ];

  it("separa preencher (config) de corrigir (trava cujo conserto mora aqui)", () => {
    const p = pendenciasDeConfiguracoes(travas);
    expect(p.preencher.map((t) => t.id)).toEqual(["metas-ausentes", "budget-ausente"]);
    expect(p.corrigir.map((t) => t.id)).toEqual(["marca-sem-regra", "cobertura-de-dias", "sem-lead"]);
    expect(p.preencher[0]).toMatchObject({ titulo: "Trava metas-ausentes", link: { label: "Ir metas-ausentes", href: "/configuracoes#metas" } });
  });

  it("cada link já sai na vista da âncora e carrega o período", () => {
    const p = pendenciasDeConfiguracoes([...travas, trava("utm-velho", "piso", "/configuracoes#utm")], "7d");
    const hrefs = Object.fromEntries([...p.preencher, ...p.corrigir].map((t) => [t.id, t.link?.href]));
    expect(hrefs).toEqual({
      "metas-ausentes": "/configuracoes?range=7d#metas",
      "budget-ausente": "/configuracoes?range=7d#orcamento",
      "marca-sem-regra": "/configuracoes/marcas?range=7d",
      "cobertura-de-dias": "/configuracoes/integracoes?range=7d",
      "sem-lead": "/configuracoes/integracoes?range=7d",
      "utm-velho": "/configuracoes/ferramentas?range=7d#utm",
    });
    // "all" é o padrão da página: não suja a URL.
    expect(pendenciasDeConfiguracoes(travas, "all").preencher[0].link?.href).toBe("/configuracoes#metas");
  });
});

describe("6.6 — estado das integrações", () => {
  it("fonte sincronizada: não configurada, nunca, ativa ou falhando desde — com frase humana", () => {
    expect(estadoDaSincronizacao("Meta", false, undefined, "META_AD_ACCOUNT_ID")).toMatchObject({
      estado: "nao-configurado",
      rotulo: "Não configurado",
      detalhe: "Faltam META_AD_ACCOUNT_ID.",
    });
    expect(estadoDaSincronizacao("Meta", true, { ultimoOk: null, falha: null }, "x")).toMatchObject({
      estado: "nunca",
      rotulo: "Nunca sincronizado",
    });
    const ativo = estadoDaSincronizacao("Instagram", true, { ultimoOk: "2026-10-07T12:00:00.000Z", falha: null }, "x");
    expect(ativo).toMatchObject({ estado: "ativo", rotulo: "Ativo" });
    expect(ativo.detalhe).toContain("Última sincronização que deu certo: 07 de out de 2026");

    const falhando = estadoDaSincronizacao(
      "Meta",
      true,
      { ultimoOk: "2026-10-05T12:00:00.000Z", falha: { desde: "2026-10-07T12:00:00.000Z", erro: "TypeError: fetch failed" } },
      "x",
    );
    expect(falhando.estado).toBe("falhando");
    expect(falhando.rotulo).toMatch(/^Falhando desde 07 de out de 2026/);
    expect(falhando.detalhe).toContain("Não consegui falar com o Meta");
    expect(falhando.detalhe).toContain("05 de out de 2026");
    expect(falhando.detalhe).not.toContain("TypeError");
  });

  it("robô: desligado não é erro; falhando traz o motivo humano", () => {
    expect(estadoDoRobo({ configurado: false, desativado: false })).toMatchObject({ estado: "nao-configurado", rotulo: "Não configurado" });
    expect(estadoDoRobo({ configurado: true, desativado: true, erro: "fetch failed" })).toMatchObject({ estado: "desativado", rotulo: "Desativado" });
    expect(estadoDoRobo({ configurado: true, desativado: false })).toMatchObject({ estado: "ativo", rotulo: "Ativo" });
    const f = estadoDoRobo({ configurado: true, desativado: false, erro: 'relation "vw_robo_diario" does not exist' });
    expect(f).toMatchObject({ estado: "falhando", rotulo: "Falhando agora" });
    expect(f.detalhe).toContain("estrutura do banco");
    expect(f.detalhe).not.toContain("vw_robo_diario");
  });

  it("quem vê telefone e e-mail: administrador e comercial; marketing vê mascarado", () => {
    const por = Object.fromEntries(visibilidadePorPapel().map((v) => [v.papel, v]));
    expect(por.admin).toMatchObject({ veContato: true, exportaLeads: true, operaDados: true, administra: true });
    expect(por.comercial).toMatchObject({ veContato: true, exportaLeads: true, alteraLeads: true, operaDados: false, administra: false });
    expect(por.marketing).toMatchObject({ veContato: false, exportaLeads: false, alteraLeads: false, operaDados: true, administra: false });
  });
});

describe("6.6 — prévia do CSV de leads", () => {
  const csv = [
    "created_at,event_id,Status,nome,whatsapp,email",
    '2026-07-27T21:53:40-03:00,ev-0001,,Pessoa Um,="5511999990001",um@exemplo.test',
    "2026-07-28T00:02:32-03:00,ev-0002,não atende,Pessoa Dois,011999990002,",
    "2026-07-28T09:15:07-03:00,ev-0003,agendado,Pessoa Tres,\"5,51299E+12\",tres@exemplo.test",
    "2026-07-29T09:15:07-03:00,ev-0004,,,5511999990004,",
    "27/07/2026,ev-0005,,Pessoa Cinco,5511999990005,",
    "2026-07-30T09:15:07-03:00,ev-0006,qualquer coisa,Pessoa Seis,,seis-sem-arroba",
    "2026-07-31T09:15:07-03:00,ev-0002,,Pessoa Dois de novo,011999990002,",
  ].join("\n");

  it("telefone é lido como texto, erros e avisos saem por linha", () => {
    const p = previaLeadsCsv("﻿" + csv);
    expect(p.faltam).toEqual([]);
    expect(p.linhas).toHaveLength(7);
    const [l1, l2, l3, l4, l5, l6, l7] = p.linhas;

    // ="…" do Excel desfeito; zero à esquerda e dígitos preservados — texto, não número.
    expect(l1).toMatchObject({ linha: 2, nome: "Pessoa Um", telefone: "5511999990001", status: "lead", erros: [], avisos: [] });
    expect(l2).toMatchObject({ linha: 3, telefone: "011999990002", status: "sem_resposta", erros: [], avisos: [] });

    // Notação científica: o Excel já cortou os dígitos — fica em branco, com aviso; a linha entra.
    expect(l3.telefone).toBeUndefined();
    expect(l3.status).toBe("agendado");
    expect(l3.erros).toEqual([]);
    expect(l3.avisos.join(" ")).toContain("notação científica");

    expect(l4.erros).toEqual(["Nome em branco."]);
    expect(l5.erros[0]).toContain("fora do formato AAAA-MM-DD");

    expect(l6.erros).toEqual([]);
    expect(l6).toMatchObject({ status: "lead", statusOriginal: "qualquer coisa" });
    expect(l6.avisos.join(" ")).toContain("não reconhecido");
    expect(l6.avisos.join(" ")).toContain("sem @");

    // Mesmo event_id de uma linha anterior.
    expect(l7.avisos.join(" ")).toContain("Mesmo event_id");
    expect(p.repetidas).toBe(1);
    expect(p.comErro).toBe(2);
    expect(p.comAviso).toBe(3);
  });

  it("o que a prévia diz que entra é o que o importador importa", () => {
    const p = previaLeadsCsv(csv);
    const real = parseLeadsCsv(csv);
    expect(p.validas).toBe(real.leads.length);
    expect(p.comErro).toBe(real.skipped);
    expect(p.linhas.filter((l) => l.erros.length === 0 && l.avisos.some((a) => a.includes("notação científica")))).toHaveLength(real.telefonesIlegiveis);
  });

  it("sem as colunas obrigatórias não lança: diz o que falta", () => {
    expect(previaLeadsCsv("foo,bar\n1,2")).toMatchObject({ faltam: ["nome", "created_at (data)"], linhas: [], validas: 0 });
    expect(previaLeadsCsv("nome,whatsapp\nAlguém,11")).toMatchObject({ faltam: ["created_at (data)"], validas: 0 });
  });
});
