"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LogIn, UserPlus } from "lucide-react";
import {
  loginAction,
  setupFirstUserAction,
  type AuthState,
} from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

const inputCls =
  "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40";
const labelCls = "text-xs font-medium text-muted-foreground";

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function ErrorMessage({ state }: { state: AuthState | null }) {
  if (!state || state.ok) return null;
  return <p className="text-sm text-[var(--danger-text)]">{state.message}</p>;
}

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Usuário</span>
        <input name="username" autoComplete="username" autoFocus className={inputCls} required />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Senha</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          className={inputCls}
          required
        />
      </label>
      <ErrorMessage state={state} />
      <SubmitButton>
        <LogIn className="size-4" />
        Entrar
      </SubmitButton>
    </form>
  );
}

export function SetupForm() {
  const [state, action] = useActionState(setupFirstUserAction, null);
  return (
    <form action={action} className="space-y-4">
      <div className={cn("rounded-lg border bg-primary/[0.06] px-3 py-2 text-xs text-muted-foreground")}>
        Nenhum usuário cadastrado ainda. Crie o primeiro acesso — ele vira
        administrador e poderá adicionar os demais em Config.
      </div>
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Usuário</span>
        <input name="username" autoComplete="username" autoFocus className={inputCls} required />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelCls}>Senha (mínimo 8 caracteres)</span>
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={8}
          className={inputCls}
          required
        />
      </label>
      <ErrorMessage state={state} />
      <SubmitButton>
        <UserPlus className="size-4" />
        Criar acesso
      </SubmitButton>
    </form>
  );
}
