import "server-only";
import { getCurrentUser } from "./current-user";

/** Name to record in the audit log for the current request. */
export async function currentActor(fallback = "sistema"): Promise<string> {
  const user = await getCurrentUser();
  return user?.username ?? fallback;
}

/** A reasonably unique id for an audit event. */
export function newEventId(): string {
  return `EVT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
