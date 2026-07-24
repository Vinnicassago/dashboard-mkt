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

export interface NavItem {
  label: string;
  href: string;
  Icon: LucideIcon;
}

export const NAV: NavItem[] = [
  { label: "Visão Geral", href: "/", Icon: LayoutDashboard },
  { label: "Tráfego Pago", href: "/trafego", Icon: Megaphone },
  { label: "Criativos", href: "/criativos", Icon: Images },
  { label: "Instagram", href: "/instagram", Icon: Camera },
  { label: "Posts", href: "/posts", Icon: FileText },
  { label: "Funil & LP", href: "/funil", Icon: Filter },
  { label: "Leads", href: "/leads", Icon: Users },
  { label: "UTMs", href: "/utm", Icon: Link2 },
  { label: "Importar / Config", href: "/config", Icon: Settings },
];

export function sectionFromPath(pathname: string): string {
  const match = NAV.find((n) =>
    n.href === "/" ? pathname === "/" : pathname.startsWith(n.href),
  );
  return match?.label ?? "Dashboard";
}
