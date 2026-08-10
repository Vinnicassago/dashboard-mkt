"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { BRANDS, BRAND_COOKIE } from "@/lib/brands";

/**
 * Troca a marca ativa do painel. Grava o slug no cookie (httpOnly, lido no
 * servidor por activeBrandSlug) e revalida todo o layout para as páginas
 * re-renderizarem já recortadas pela nova marca. Ignora slug desconhecido.
 */
export async function setActiveBrand(slug: string): Promise<void> {
  if (!BRANDS.some((b) => b.slug === slug)) return;
  const c = await cookies();
  c.set(BRAND_COOKIE, slug, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
