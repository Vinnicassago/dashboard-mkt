import "server-only";
import { cookies } from "next/headers";
import { BRANDS, BRAND_COOKIE, brandDef, type BrandDef } from "./brands";
import { DEFAULT_BRAND } from "./types";

/**
 * Marca ativa do painel, lida do cookie no servidor (não de searchParams — o
 * layout do Next não recebe searchParams e não escoparia getData). Um slug
 * desconhecido cai na marca padrão (consorcio.brunno).
 */
export async function activeBrandSlug(): Promise<string> {
  const c = await cookies();
  const slug = c.get(BRAND_COOKIE)?.value;
  return slug && BRANDS.some((b) => b.slug === slug) ? slug : DEFAULT_BRAND;
}

export async function activeBrand(): Promise<BrandDef> {
  return brandDef(await activeBrandSlug());
}
