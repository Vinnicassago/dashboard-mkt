/**
 * Registro de marcas/contas do painel (metadados puros — sem I/O, importável no
 * cliente e no servidor). O campo decisivo é `type`: é ele, não o slug, que
 * governa quais KPIs, páginas e North Star aparecem.
 *
 *   `conversao` — funil lead → reunião → cliente (consorcio.brunno). North Star: CPR.
 *   `awareness` — só crescimento de perfil (krone.capital, campanhas de seguidores).
 *                 North Star: custo por seguidor + custo por 1k alcance. Sem
 *                 CPL/CPR/funil de leads.
 *
 * As CREDENCIAIS por marca (IG_USER_ID, ad account, tokens) NÃO vivem aqui — elas
 * entram em meta/config.ts na Fase 3. Isto é só a identidade + o tipo.
 */

import type { Brand } from "./types";
import { DEFAULT_BRAND } from "./types";

/** Cookie que guarda a marca ativa do painel (lido no servidor, escrito por ação). */
export const BRAND_COOKIE = "brand";

export type BrandType = "conversao" | "awareness";

export type ThemeMode = "dark" | "light";

export interface BrandDef {
  slug: Brand;
  /** Nome de exibição completo (o @handle sem o arroba). */
  label: string;
  /** Rótulo curto para chips/sidebar. */
  short: string;
  /** Inicial do "logo". */
  initial: string;
  /** @handle do Instagram. */
  handle: string;
  type: BrandType;
  /**
   * Identidade visual da marca: o tema (claro/escuro) é definido pela MARCA, não
   * por preferência do usuário. O accent (âmbar vs. verde) é derivado do slug via
   * `[data-brand]` em globals.css. Estampado no <html> pelo SSR (cookie da marca
   * já é conhecido no servidor) → sem flash — e aplicado otimisticamente no
   * cliente ao trocar de marca para a animação de transição.
   */
  theme: ThemeMode;
}

export const BRANDS: BrandDef[] = [
  {
    slug: DEFAULT_BRAND, // "consorcio"
    label: "consorcio.brunno",
    short: "Consórcio",
    initial: "C",
    handle: "@consorcio.brunno",
    type: "conversao",
    theme: "dark", // escuro + accent âmbar/ouro
  },
  {
    slug: "krone",
    label: "krone.capital",
    short: "Krone",
    initial: "K",
    handle: "@krone.capital",
    type: "awareness",
    theme: "light", // claro + accent verde floresta
  },
];

/** Definição de uma marca pelo slug; cai na marca padrão se o slug for desconhecido. */
export function brandDef(slug: string): BrandDef {
  return BRANDS.find((b) => b.slug === slug) ?? BRANDS[0];
}

/**
 * Tema (claro/escuro) da marca — fonte única usada tanto no SSR (layout raiz
 * estampa data-theme) quanto no cliente (brand-selector aplica otimista ao trocar).
 */
export function brandTheme(slug: string): ThemeMode {
  return brandDef(slug).theme;
}

/** A marca é do tipo "awareness" (só seguidores, sem funil de leads)? */
export function isAwareness(slug: string): boolean {
  return brandDef(slug).type === "awareness";
}

/** A marca é do tipo "conversao" (funil lead → reunião)? */
export function isConversao(slug: string): boolean {
  return brandDef(slug).type === "conversao";
}
