import {
  LayoutDashboard,
  Megaphone,
  Images,
  Camera,
  FileText,
  Filter,
  Users,
  Link2,
  Settings,
  type LucideIcon,
} from "lucide-react";

import type { BrandType } from "@/lib/brands";

export interface NavItem {
  label: string;
  href: string;
  Icon: LucideIcon;
  /** Só faz sentido no funil de conversão (lead→reunião) — oculto p/ marcas awareness. */
  conversaoOnly?: boolean;
}

export const NAV: NavItem[] = [
  { label: "Visão Geral", href: "/", Icon: LayoutDashboard },
  { label: "Tráfego Pago", href: "/trafego", Icon: Megaphone, conversaoOnly: true },
  { label: "Criativos", href: "/criativos", Icon: Images, conversaoOnly: true },
  { label: "Instagram", href: "/instagram", Icon: Camera },
  { label: "Posts", href: "/posts", Icon: FileText },
  { label: "Funil & LP", href: "/funil", Icon: Filter, conversaoOnly: true },
  { label: "Leads", href: "/leads", Icon: Users, conversaoOnly: true },
  { label: "UTMs", href: "/utm", Icon: Link2, conversaoOnly: true },
  { label: "Importar / Config", href: "/config", Icon: Settings },
];

/** Itens de navegação visíveis para uma marca: awareness esconde os de conversão. */
export function navForType(type: BrandType): NavItem[] {
  return type === "awareness" ? NAV.filter((n) => !n.conversaoOnly) : NAV;
}

export function sectionFromPath(pathname: string): string {
  const match = NAV.find((n) =>
    n.href === "/" ? pathname === "/" : pathname.startsWith(n.href),
  );
  return match?.label ?? "Dashboard";
}
