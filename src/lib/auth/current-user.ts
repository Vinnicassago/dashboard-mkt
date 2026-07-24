import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "./session";
import { authSecret } from "./config";
import { toRole, type Role } from "./roles";
import { getUser } from "@/lib/data/store";

export interface SessionUser {
  username: string;
  role: Role;
}

/**
 * The logged-in user (with role), or null. Null also means auth is disabled or
 * the user no longer exists. The role is read fresh from the store, so removing
 * or changing a user takes effect on the next request (not only at expiry).
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const secret = authSecret();
  if (!secret) return null;
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const username = await verifySessionToken(token, secret);
  if (!username) return null;
  const user = await getUser(username);
  if (!user) return null;
  return { username, role: toRole(user.role) };
}
