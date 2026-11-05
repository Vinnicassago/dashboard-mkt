import {
  Camera,
  Filter,
  House,
  Megaphone,
  PhoneCall,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { AtalhoDaLive } from "@/lib/atalho-live";
import type { Role } from "@/lib/auth/roles";
import type { BrandDef } from "@/lib/brands";
import { hasPlaybook } from "@/lib/content/playbook";
import { PERIODO_PADRAO_DO_INICIO, comPeriodo, type RangeKey } from "@/lib/range";

/**
 * A navegação é nomeada pela PERGUNTA que cada página responde — ou pelo dono do
 * trabalho que ela abriga —, não pela fonte do dado.
 *
 * Eram 14 abas, uma por sistema (Tráfego, Funil, Robô, Atendimento…), e a mesma
 * pessoa aparecia contada em três delas com números diferentes. São 7, nos nomes
 * do relatório de out/2026 (decisão 4.4), agrupadas: Visão geral · Diagnóstico ·
 * Operação · Configurações. Um fato mora num lugar só. Aba nova = fundir outra.
 * Sub-vista só onde o trabalho é outro — Produção é pauta, Registros é entrada
 * manual, Configurações se divide por assunto. A live de 01/12 não é vista nem
 * página: é um atalho de PERÍODO no seletor do cabeçalho (`lib/atalho-live.ts`),
 * e o Início com a chave dela mostra o painel da live.
 */

export type NavGrupo = "Visão geral" | "Diagnóstico" | "Operação" | "Configurações";

export interface NavVista {
  label: string;
  href: string;
  /** Depende de um guia de produção — oculta para marcas que ainda não têm um. */
  playbookOnly?: boolean;
}

export interface NavItem {
  label: string;
  href: string;
  Icon: LucideIcon;
  grupo: NavGrupo;
  /** A pergunta que a página responde. Vira o ⓘ ao lado do título do cabeçalho. */
  pergunta: string;
  /** Só faz sentido no funil de conversão (lead→reunião) — oculto p/ marcas awareness. */
  conversaoOnly?: boolean;
  /** Vistas dentro da página, em abas no topo do conteúdo. */
  vistas?: NavVista[];
  /**
   * Período que a página assume sem `?range=` na URL. O Início olha a semana
   * ("7 dias vs 7 anteriores", `PERIODO_PADRAO_DO_INICIO`); as outras páginas, a
   * campanha inteira. O seletor lê daqui para marcar o preset certo quando a URL
   * está limpa.
   */
  periodoPadrao?: RangeKey;
}

export const NAV: NavItem[] = [
  {
    // A home (nomes internos `bussola*` mantidos). Sem vistas: a live de 01/12 é
    // o atalho de período do cabeçalho, não uma aba.
    label: "Início",
    href: "/",
    Icon: House,
    grupo: "Visão geral",
    pergunta: "O que chegou, quanto custou e quem está esperando agora?",
    periodoPadrao: PERIODO_PADRAO_DO_INICIO,
  },
  {
    label: "Funil",
    href: "/funil",
    Icon: Filter,
    grupo: "Diagnóstico",
    pergunta: "Onde exatamente estamos perdendo reuniões?",
    conversaoOnly: true,
  },
  {
    label: "Mídia",
    href: "/midia",
    Icon: Megaphone,
    grupo: "Diagnóstico",
    pergunta: "Onde a verba vira reunião, e o que escalar ou pausar?",
    conversaoOnly: true,
  },
  {
    label: "Conteúdo",
    href: "/conteudo",
    Icon: Camera,
    grupo: "Diagnóstico",
    pergunta: "O conteúdo está melhorando, e alimenta o funil?",
    vistas: [
      { label: "Conta", href: "/conteudo" },
      { label: "Posts", href: "/conteudo/posts" },
      { label: "Registros", href: "/conteudo/registros" },
      { label: "Produção", href: "/conteudo/producao", playbookOnly: true },
    ],
  },
  {
    label: "Fila de contato",
    href: "/fila",
    Icon: PhoneCall,
    grupo: "Operação",
    pergunta: "Para quem eu ligo agora, nesta ordem?",
    conversaoOnly: true,
  },
  {
    label: "Leads",
    href: "/leads",
    Icon: Users,
    grupo: "Operação",
    pergunta: "Quem é essa pessoa e o que já aconteceu com ela?",
    conversaoOnly: true,
  },
  {
    label: "Configurações",
    href: "/configuracoes",
    Icon: Settings,
    grupo: "Configurações",
    pergunta: "O que falta preencher para o painel parar de mostrar “—”?",
    vistas: [
      { label: "Metas e orçamento", href: "/configuracoes" },
      { label: "Atendimento e classe", href: "/configuracoes/atendimento" },
      { label: "Integrações e saúde", href: "/configuracoes/integracoes" },
      { label: "Marcas e atribuição", href: "/configuracoes/marcas" },
      { label: "Usuários", href: "/configuracoes/usuarios" },
      { label: "Importar", href: "/configuracoes/importar" },
      { label: "Ferramentas", href: "/configuracoes/ferramentas" },
      { label: "Zona de perigo", href: "/configuracoes/perigo" },
    ],
  },
];

export const NAV_GRUPOS: NavGrupo[] = ["Visão geral", "Diagnóstico", "Operação", "Configurações"];

/** Itens visíveis para uma marca: awareness esconde os de conversão. */
export function navForBrand(brand: BrandDef): NavItem[] {
  return NAV.filter((n) => !(n.conversaoOnly && brand.type === "awareness"));
}

/** Vistas visíveis de um item: marca sem guia de produção não vê a Produção. */
export function vistasForBrand(item: NavItem, brand: BrandDef): NavVista[] {
  return (item.vistas ?? []).filter((v) => !(v.playbookOnly && !hasPlaybook(brand.slug)));
}

/** `/conteudo/posts` pertence a `/conteudo`; `/filas` não pertenceria a `/fila`. */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** O item está ativo pela rota dele (toda vista mora debaixo da rota do item). */
export function itemAtivo(pathname: string, item: NavItem): boolean {
  return isActive(pathname, item.href);
}

export function navItemFromPath(pathname: string): NavItem | undefined {
  return NAV.find((n) => isActive(pathname, n.href));
}

/** O período de uma página sem `?range=`: o da página, ou a campanha inteira. */
export function periodoPadraoDe(pathname: string): RangeKey {
  return navItemFromPath(pathname)?.periodoPadrao ?? "all";
}

/**
 * O link interno com o período que a tela está MOSTRANDO (`rangeAtual`, já com o
 * padrão da página de origem): `comPeriodo` com o padrão do DESTINO — "Campanha"
 * vai explícita para o Início (padrão = a semana), e some do link para as páginas
 * cujo padrão também é a campanha.
 */
export function comPeriodoDaTela(href: string, rangeAtual: string | null | undefined): string {
  const destino = href.split(/[?#]/)[0] || "/";
  return comPeriodo(href, rangeAtual, periodoPadraoDe(destino));
}

/**
 * Para onde o Início aponta para quem é do COMERCIAL: enquanto o atalho da live
 * está visível, o painel da live (`/?range=<chave da campanha>`) — fora do modo
 * live a home manda o comercial para a Fila, e no painel ele grava os números
 * manuais. Depois do fim (ou sem o atalho, ou outro papel): `null`, o link de
 * sempre.
 */
export function inicioDoComercial(role: Role | null | undefined, atalho: AtalhoDaLive | null | undefined): string | null {
  if (role !== "comercial" || !atalho?.visivel) return null;
  return comPeriodo("/", atalho.chave);
}

/**
 * O href de um item da navegação: o do Início do comercial no modo live
 * (`inicioDoComercial`), senão a rota com o período da tela (`hrefFor`).
 */
export function hrefDoItem(item: NavItem, hrefFor: (href: string) => string, hrefDoInicio?: string | null): string {
  if (item.href === "/" && hrefDoInicio) return hrefDoInicio;
  return hrefFor(item.href);
}
