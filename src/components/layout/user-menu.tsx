"use client";

import { LogOut } from "lucide-react";
import { logoutAction } from "@/lib/auth/actions";

export function UserMenu({ username }: { username: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-[120px] truncate text-sm text-muted-foreground sm:inline">
        {username}
      </span>
      <form action={logoutAction}>
        <button
          type="submit"
          title="Sair"
          aria-label="Sair"
          className="flex size-9 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
        >
          <LogOut className="size-4" />
        </button>
      </form>
    </div>
  );
}
