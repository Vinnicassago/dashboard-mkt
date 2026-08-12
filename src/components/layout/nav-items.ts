import {
  LayoutDashboard,
  Megaphone,
  Images,
  Camera,
  ClipboardCheck,
  FileText,
  Filter,
  Users,
  Link2,
  Settings,
  type LucideIcon,
} from "lucide-react";

import type { BrandDef } from "@/lib/brands";
import { hasPlaybook } from "@/lib/content/playbook";

export interface NavItem {
  label: string;
  href: string;
  Icon: LucideIcon;
  /** Só faz sentido no funil de conversão (lead→reunião) — oculto p/ marcas awareness. */
  conversaoOnly?: boolean;
  /** Depende de um guia de produção — oculto p/ marcas que ainda não têm um. */
  playbookOnly?: boolean;
}

export const NAV: NavItem[] = [
  { label: "Visão Geral", href: "/", Icon: LayoutDashboard },
  { label: "Tráfego Pago", href: "/trafego", Icon: Megaphone, conversaoOnly: true },
  { label: "Criativos", href: "/criativos", Icon: Images, conversaoOnly: true },
  { label: "Instagram", href: "/instagram", Icon: Camera },
  { label: "Produção", href: "/producao", Icon: ClipboardCheck, playbookOnly: true },
  { label: "Posts", href: "/posts", Icon: FileText },
  { label: "Funil & LP", href: "/funil", Icon: Filter, conversaoOnly: true },
  { label: "Leads", href: "/leads", Icon: Users, conversaoOnly: true },
  { label: "UTMs", href: "/utm", Icon: Link2, conversaoOnly: true },
  { label: "Importar / Config", href: "/config", Icon: Settings },
];

/**
 * Itens visíveis para uma marca: awareness esconde os de conversão, e marcas
 * sem guia de produção escondem a Produção.
 */
export function navForBrand(brand: BrandDef): NavItem[] {
  return NAV.filter((n) => {
    if (n.conversaoOnly && brand.type === "awareness") return false;
    if (n.playbookOnly && !hasPlaybook(brand.slug)) return false;
    return true;
  });
}

export function sectionFromPath(pathname: string): string {
  const match = NAV.find((n) =>
    n.href === "/" ? pathname === "/" : pathname.startsWith(n.href),
  );
  return match?.label ?? "Dashboard";
}
