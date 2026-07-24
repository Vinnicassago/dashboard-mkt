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

export type Capability = "leads:write" | "data:write" | "users:manage";

/**
 * - leads:write  → alterar status de lead / adicionar lead   (admin, comercial)
 * - data:write   → importar CSV, sync, metas, snapshot IG     (admin, marketing)
 * - users:manage → criar/remover/alterar usuários             (admin)
 */
export function hasCapability(role: Role, cap: Capability): boolean {
  switch (cap) {
    case "leads:write":
      return role === "admin" || role === "comercial";
    case "data:write":
      return role === "admin" || role === "marketing";
    case "users:manage":
      return role === "admin";
    default:
      return false;
  }
}
