"use client";

import { LogOut } from "lucide-react";
import { logoutAction } from "@/lib/auth/actions";

/**
 * O usuário e o "Sair". O nome só aparece com folga (≥ 1.800 px): o grupo da
 * direita do cabeçalho não encolhe, e com ele (até 128 px) a data do dado do
 * cabeçalho ficava por baixo dos botões num notebook. Abaixo disso o nome vai no
 * `title` e no `aria-label` do botão.
 */
export function UserMenu({ username }: { username: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-[120px] truncate text-sm text-muted-foreground min-[1800px]:inline">
        {username}
      </span>
      <form action={logoutAction}>
        <button
          type="submit"
          title={`Sair (${username})`}
          aria-label={`Sair (${username})`}
          className="flex size-9 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
        >
          <LogOut className="size-4" />
        </button>
      </form>
    </div>
  );
}
