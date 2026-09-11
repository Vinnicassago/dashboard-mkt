import {
  Camera,
  LayoutDashboard,
  PhoneCall,
  Route,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { BrandDef } from "@/lib/brands";
import { hasPlaybook } from "@/lib/content/playbook";

/**
 * A navegação é nomeada pela PERGUNTA que cada página responde, não pela fonte
 * do dado.
 *
 * Eram 14 abas, uma por sistema (Tráfego, Funil, Robô, Atendimento…), e a mesma
 * pessoa aparecia contada em três delas com números diferentes. Agora são 7:
 * cada uma responde uma pergunta, e um fato mora num lugar só. Aba nova = fundir
 * outra. Sub-vista só onde o trabalho é outro — Produção é pauta, não leitura de
 * resultado.
 */

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
  /** A pergunta que a página responde. Vira o subtítulo do cabeçalho. */
  pergunta: string;
  /** Só faz sentido no funil de conversão (lead→reunião) — oculto p/ marcas awareness. */
  conversaoOnly?: boolean;
  /** Vistas dentro da página, em abas no topo do conteúdo. */
  vistas?: NavVista[];
}

export const NAV: NavItem[] = [
  {
    label: "Hoje",
    href: "/",
    Icon: LayoutDashboard,
    pergunta: "Estou bem ou mal — e o que eu faço agora?",
  },
  {
    label: "Dinheiro",
    href: "/dinheiro",
    Icon: Wallet,
    pergunta: "Quanto por conjunto na segunda, e qual criativo escalo ou mato?",
    conversaoOnly: true,
  },
  {
    label: "Jornada",
    href: "/jornada",
    Icon: Route,
    pergunta: "Onde exatamente o dinheiro vaza?",
    conversaoOnly: true,
  },
  {
    label: "Fila de contato",
    href: "/fila",
    Icon: PhoneCall,
    pergunta: "Para quem eu ligo agora, nesta ordem?",
    conversaoOnly: true,
  },
  {
    label: "Pessoas",
    href: "/pessoas",
    Icon: Users,
    pergunta: "Quem é essa pessoa e o que já aconteceu com ela?",
    conversaoOnly: true,
  },
  {
    label: "Conteúdo",
    href: "/conteudo",
    Icon: Camera,
    pergunta: "O conteúdo está melhorando, e alimenta o funil?",
    vistas: [
      { label: "Conta", href: "/conteudo" },
      { label: "Posts", href: "/conteudo/posts" },
      { label: "Produção", href: "/conteudo/producao", playbookOnly: true },
    ],
  },
  {
    label: "Ajustes",
    href: "/config",
    Icon: Settings,
    pergunta: "O que falta preencher para o painel parar de mostrar “—”?",
  },
];

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

export function navItemFromPath(pathname: string): NavItem | undefined {
  return NAV.find((n) => isActive(pathname, n.href));
}
