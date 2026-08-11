import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { MobileNav, Sidebar } from "@/components/layout/sidebar";
import { getData } from "@/lib/data/store";
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
  const { updatedAt } = await getData(brand.slug);

  return (
    <div className="flex min-h-screen">
      <Sidebar brand={brand} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav brand={brand} />
        <Header updatedAt={updatedAt} username={sessionUser?.username ?? null} brand={brand.slug} />
        <main className="flex-1 p-4 md:p-6">
          <div className="mx-auto w-full max-w-[1600px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
