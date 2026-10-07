/** Access roles and what each one is allowed to do. Pure — safe on the client. */

export type Role = "admin" | "marketing" | "comercial";

export const ROLES: Role[] = ["admin", "marketing", "comercial"];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  marketing: "Marketing",
  comercial: "Comercial",
};

export function isRole(v: unknown): v is Role {
  return v === "admin" || v === "marketing" || v === "comercial";
}

/** Coerce an unknown/legacy value to a valid role (least privilege by default). */
export function toRole(v: unknown): Role {
  return isRole(v) ? v : "marketing";
}

export type Capability =
  | "leads:write"
  | "leads:delete"
  | "data:write"
  | "danger:run"
  | "users:manage";

/**
 * - leads:write  → alterar status de lead / adicionar lead   (admin, comercial)
 * - leads:delete → excluir e restaurar lead (reversível)     (admin)
 * - data:write   → importar CSV, sync, metas, snapshot IG     (admin, marketing)
 * - danger:run   → restaurar exemplo, ressincronizar todo o
 *                  histórico de anúncios, corrigir leads em lote (admin)
 * - users:manage → criar/remover/alterar usuários             (admin)
 */
export function hasCapability(role: Role, cap: Capability): boolean {
  switch (cap) {
    case "leads:write":
      return role === "admin" || role === "comercial";
    case "data:write":
      return role === "admin" || role === "marketing";
    case "leads:delete":
    case "danger:run":
    case "users:manage":
      return role === "admin";
    default:
      return false;
  }
}
