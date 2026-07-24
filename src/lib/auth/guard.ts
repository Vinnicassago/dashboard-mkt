import "server-only";
import { isAuthEnabled } from "./config";
import { getCurrentUser } from "./current-user";
import { hasCapability, type Capability } from "./roles";

/**
 * Whether the current request is allowed to perform `cap`.
 *
 * With auth disabled (no AUTH_SECRET) the app runs in "open mode" and every
 * capability is granted — matching the behaviour before login existed.
 */
export async function can(cap: Capability): Promise<boolean> {
  if (!isAuthEnabled()) return true;
  const user = await getCurrentUser();
  return !!user && hasCapability(user.role, cap);
}

/** Throws-free guard for actions: returns an error message when denied, else null. */
export async function deny(cap: Capability): Promise<string | null> {
  return (await can(cap)) ? null : "Você não tem permissão para esta ação.";
}
