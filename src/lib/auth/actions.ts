"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authSecret, normalizeUsername } from "./config";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSessionToken,
} from "./session";
import { hashPassword, verifyPassword } from "./passwords";
import { getCurrentUser } from "./current-user";
import { can } from "./guard";
import { toRole, type Role } from "./roles";
import {
  countUsers,
  createUser,
  deleteUser,
  getUser,
  listUsers,
  setUserRole,
} from "@/lib/data/store";

export interface AuthState {
  ok: boolean;
  message: string;
}

const MIN_USERNAME = 3;
const MIN_PASSWORD = 8;

async function startSession(username: string) {
  const secret = authSecret();
  if (!secret) return;
  const token = await createSessionToken(username, secret);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/** Only allow same-origin relative paths as a post-login redirect target. */
function safeNext(next: string): string {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function loginAction(
  _prev: AuthState | null,
  formData: FormData,
): Promise<AuthState> {
  const username = normalizeUsername(String(formData.get("username") ?? ""));
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? "/"));
  if (!username || !password) {
    return { ok: false, message: "Preencha usuário e senha." };
  }

  const user = await getUser(username);
  // verify even when the user is missing, to keep timing uniform
  const ok = user ? verifyPassword(password, user.passwordHash) : false;
  if (!ok) return { ok: false, message: "Usuário ou senha inválidos." };

  await startSession(username);
  redirect(next);
}

export async function setupFirstUserAction(
  _prev: AuthState | null,
  formData: FormData,
): Promise<AuthState> {
  if ((await countUsers()) > 0) {
    return { ok: false, message: "Já existe usuário cadastrado. Faça login." };
  }
  const username = normalizeUsername(String(formData.get("username") ?? ""));
  const password = String(formData.get("password") ?? "");
  if (username.length < MIN_USERNAME) {
    return { ok: false, message: `Usuário precisa de ${MIN_USERNAME}+ caracteres.` };
  }
  if (password.length < MIN_PASSWORD) {
    return { ok: false, message: `Senha precisa de ${MIN_PASSWORD}+ caracteres.` };
  }

  await createUser({
    username,
    passwordHash: hashPassword(password),
    role: "admin", // the first user is always the administrator
    createdAt: new Date().toISOString(),
  });
  await startSession(username);
  redirect("/");
}

export async function logoutAction() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect("/login");
}

export async function addUserAction(
  _prev: AuthState | null,
  formData: FormData,
): Promise<AuthState> {
  if (!(await can("users:manage"))) return { ok: false, message: "Não autorizado." };

  const username = normalizeUsername(String(formData.get("username") ?? ""));
  const password = String(formData.get("password") ?? "");
  const role: Role = toRole(formData.get("role"));
  if (username.length < MIN_USERNAME) {
    return { ok: false, message: `Usuário precisa de ${MIN_USERNAME}+ caracteres.` };
  }
  if (password.length < MIN_PASSWORD) {
    return { ok: false, message: `Senha precisa de ${MIN_PASSWORD}+ caracteres.` };
  }
  if (await getUser(username)) {
    return { ok: false, message: "Esse usuário já existe." };
  }

  await createUser({
    username,
    passwordHash: hashPassword(password),
    role,
    createdAt: new Date().toISOString(),
  });
  revalidatePath("/config");
  return { ok: true, message: `Usuário "${username}" criado.` };
}

export async function deleteUserAction(username: string): Promise<AuthState> {
  const me = await getCurrentUser();
  if (!me || !(await can("users:manage"))) return { ok: false, message: "Não autorizado." };

  const target = normalizeUsername(username);
  if (target === me.username) {
    return { ok: false, message: "Você não pode remover o próprio usuário." };
  }
  if ((await countUsers()) <= 1) {
    return { ok: false, message: "Precisa haver ao menos um usuário." };
  }

  await deleteUser(target);
  revalidatePath("/config");
  return { ok: true, message: `Usuário "${target}" removido.` };
}

export async function setUserRoleAction(username: string, role: Role): Promise<AuthState> {
  const me = await getCurrentUser();
  if (!me || !(await can("users:manage"))) return { ok: false, message: "Não autorizado." };

  const target = normalizeUsername(username);
  if (target === me.username) {
    return { ok: false, message: "Você não pode alterar o próprio papel." };
  }
  await setUserRole(target, toRole(role));
  revalidatePath("/config");
  return { ok: true, message: `Papel de "${target}" atualizado.` };
}
