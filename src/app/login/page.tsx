import { redirect } from "next/navigation";
import { isAuthEnabled } from "@/lib/auth/config";
import { getCurrentUser } from "@/lib/auth/current-user";
import { countUsers } from "@/lib/data/store";
import { LoginForm, SetupForm } from "./login-forms";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // With auth off there is nothing to log into.
  if (!isAuthEnabled()) redirect("/");
  if (await getCurrentUser()) redirect("/");

  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const firstRun = (await countUsers()) === 0;

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            C
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Dashboard de Campanha</p>
            <p className="text-xs text-muted-foreground">Consórcio · acesso restrito</p>
          </div>
        </div>
        {firstRun ? <SetupForm /> : <LoginForm next={next} />}
      </div>
    </div>
  );
}
