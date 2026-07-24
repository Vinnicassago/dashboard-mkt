"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Trash2, UserPlus } from "lucide-react";
import {
  addUserAction,
  deleteUserAction,
  setUserRoleAction,
  type AuthState,
} from "@/lib/auth/actions";
import type { PublicUser } from "@/lib/data/backend";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

const inputCls =
  "h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40";
const labelCls = "text-xs font-medium text-muted-foreground";

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      <UserPlus className="size-4" />
      Adicionar usuário
    </button>
  );
}

function RoleSelect({
  username,
  role,
  disabled,
  onDone,
}: {
  username: string;
  role: Role;
  disabled: boolean;
  onDone: (msg: string) => void;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <select
      aria-label={`Papel de ${username}`}
      value={role}
      disabled={disabled || pending}
      onChange={(e) => {
        const next = e.target.value as Role;
        start(async () => {
          const res = await setUserRoleAction(username, next);
          onDone(res.message);
          router.refresh();
        });
      }}
      className={cn("h-8 rounded-md border bg-background px-1.5 text-xs outline-none", (disabled || pending) && "opacity-50")}
    >
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </select>
  );
}

function DeleteButton({
  username,
  disabled,
  onDone,
}: {
  username: string;
  disabled: boolean;
  onDone: (msg: string) => void;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={disabled || pending}
      title={disabled ? "Não é possível remover" : "Remover usuário"}
      onClick={() => {
        if (!window.confirm(`Remover o usuário "${username}"?`)) return;
        start(async () => {
          const res = await deleteUserAction(username);
          onDone(res.message);
          router.refresh();
        });
      }}
      className="inline-flex size-8 items-center justify-center rounded-lg border text-muted-foreground hover:text-[var(--danger-text)] disabled:opacity-40"
    >
      <Trash2 className="size-4" />
    </button>
  );
}

export function UsersManager({
  users,
  currentUser,
  authEnabled,
}: {
  users: PublicUser[];
  currentUser: string | null;
  authEnabled: boolean;
}) {
  const [state, action] = useActionState(addUserAction, null);
  const [note, setNote] = useState("");
  const canDelete = users.length > 1;

  return (
    <div className="space-y-4">
      {!authEnabled ? (
        <div className="rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-3 py-2 text-xs text-muted-foreground">
          O login está <strong className="text-foreground">desativado</strong>. Defina
          a variável <code className="font-mono">AUTH_SECRET</code> para exigir usuário
          e senha. Você já pode cadastrar os usuários abaixo.
        </div>
      ) : null}

      {users.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {users.map((u) => {
            const isSelf = u.username === currentUser;
            return (
              <li key={u.username} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <span className="font-medium">{u.username}</span>
                  {isSelf ? <span className="ml-2 text-xs text-muted-foreground">(você)</span> : null}
                </div>
                <div className="flex items-center gap-2">
                  <RoleSelect
                    username={u.username}
                    role={u.role}
                    disabled={isSelf}
                    onDone={setNote}
                  />
                  <DeleteButton
                    username={u.username}
                    disabled={!canDelete || isSelf}
                    onDone={setNote}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum usuário cadastrado ainda.</p>
      )}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}

      <form action={action} className="space-y-3 border-t pt-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Novo usuário</span>
            <input name="username" autoComplete="off" className={inputCls} required />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Senha (mínimo 8)</span>
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              minLength={8}
              className={inputCls}
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Papel</span>
            <select name="role" defaultValue="comercial" className={inputCls}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <AddButton />
        {state && !state.ok ? (
          <p className="text-sm text-[var(--danger-text)]">{state.message}</p>
        ) : null}
        {state && state.ok ? (
          <p className="text-sm text-[var(--success-text)]">{state.message}</p>
        ) : null}
      </form>
    </div>
  );
}
