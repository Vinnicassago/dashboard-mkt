import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { MobileNav, Sidebar } from "@/components/layout/sidebar";
import { SubNav } from "@/components/layout/sub-nav";
import { getLastSync } from "@/lib/meta/sync";
import { integrationStatus } from "@/lib/meta/config";
import { frescorDaFonte, type Frescor } from "@/lib/frescor";
import { activeBrand } from "@/lib/active-brand";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isAuthEnabled } from "@/lib/auth/config";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sessionUser = await getCurrentUser();
  // Auth on but no valid user (e.g. a deleted account with a still-signed
  // cookie) → send them to log in. Middleware handles the no-cookie case.
  if (isAuthEnabled() && !sessionUser) redirect("/login");

  const brand = await activeBrand();
  // Uma linha por fonte configurada; o painel (leads) é ao vivo.
  const status = integrationStatus();
  const sync = await getLastSync();
  const frescor: Frescor[] = [];
  if (status.ads) frescor.push(frescorDaFonte("Meta", sync.ads));
  if (status.instagram) frescor.push(frescorDaFonte("Instagram", sync.instagram));

  return (
    <div className="flex min-h-screen">
      <Sidebar brand={brand} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav brand={brand} />
        <Header frescor={frescor} username={sessionUser?.username ?? null} brand={brand.slug} />
        <main className="flex-1 p-4 md:p-6">
          <div className="mx-auto w-full max-w-[1600px]">
            <Suspense fallback={null}>
              <SubNav brand={brand} />
            </Suspense>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
