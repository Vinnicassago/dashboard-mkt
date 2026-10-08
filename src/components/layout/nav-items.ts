import {
  Camera,
  Compass,
  Filter,
  Megaphone,
  PhoneCall,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { BrandDef } from "@/lib/brands";
import { hasPlaybook } from "@/lib/content/playbook";
import type { RangeKey } from "@/lib/range";

/**
 * A navegação é nomeada pela PERGUNTA que cada página responde — ou pelo dono do
 * trabalho que ela abriga —, não pela fonte do dado.
 *
 * Eram 14 abas, uma por sistema (Tráfego, Funil, Robô, Atendimento…), e a mesma
 * pessoa aparecia contada em três delas com números diferentes. São 7, nos nomes
 * do relatório de out/2026 (decisão 4.4), agrupadas: Visão geral · Diagnóstico ·
 * Operação · Configurações. Um fato mora num lugar só. Aba nova = fundir outra.
 * Sub-vista só onde o trabalho é outro — Produção é pauta, Registros é entrada
 * manual, Configurações se divide por assunto.
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
  /** A pergunta que a página responde. Vira o subtítulo do cabeçalho. */
  pergunta: string;
  /** Só faz sentido no funil de conversão (lead→reunião) — oculto p/ marcas awareness. */
  conversaoOnly?: boolean;
  /** Vistas dentro da página, em abas no topo do conteúdo. */
  vistas?: NavVista[];
  /**
   * Período que a página assume sem `?range=` na URL. A Bússola olha a semana
   * ("7 dias vs 7 anteriores"); as outras páginas, a campanha inteira. O seletor
   * lê daqui para marcar o preset certo quando a URL está limpa.
   */
  periodoPadrao?: RangeKey;
}

export const NAV: NavItem[] = [
  {
    label: "Bússola",
    href: "/",
    Icon: Compass,
    grupo: "Visão geral",
    pergunta: "Estamos no ritmo, onde trava e o que fazer esta semana?",
    periodoPadrao: "7d",
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

export function navItemFromPath(pathname: string): NavItem | undefined {
  return NAV.find((n) => isActive(pathname, n.href));
}

/** O período de uma página sem `?range=`: o padrão dela, ou a campanha inteira. */
export function periodoPadraoDe(pathname: string): RangeKey {
  return navItemFromPath(pathname)?.periodoPadrao ?? "all";
}
