import "server-only";
import { activeBrandSlug } from "@/lib/active-brand";
import { BRANDS, brandDef, type BrandDef } from "@/lib/brands";
import { can } from "@/lib/auth/guard";
import { activeBackend, getData, getState } from "@/lib/data/store";
import { STATE_KEYS } from "@/lib/data/backend";
import { NAO_CLASSIFICADO, brandForCampaign, resolveMetaBrands } from "@/lib/meta/config";

/**
 * O que várias vistas de Configurações precisam: marca ativa, período da URL,
 * papéis (conferidos no servidor com `can()`, nunca só na UI) e o banco ativo.
 * Cada página chama isto e carrega só o resto que lhe cabe.
 */
export interface ContextoDeConfiguracoes {
  brand: BrandDef;
  /** `?range=` da URL — viaja em todo link (`comPeriodo`). */
  rangeKey: string | undefined;
  papeis: {
    /** users:manage — administrador. */
    admin: boolean;
    /** data:write — administrador e marketing. */
    dados: boolean;
    /** leads:write — administrador e comercial. */
    leads: boolean;
    /** danger:run — administrador. */
    perigo: boolean;
  };
  banco: { nome: string; conectado: boolean };
}

export async function contextoDeConfiguracoes(
  searchParams?: Promise<{ range?: string }>,
): Promise<ContextoDeConfiguracoes> {
  const [slug, params, admin, dados, leads, perigo] = await Promise.all([
    activeBrandSlug(),
    searchParams ?? Promise.resolve({} as { range?: string }),
    can("users:manage"),
    can("data:write"),
    can("leads:write"),
    can("danger:run"),
  ]);
  const backend = activeBackend();
  return {
    brand: brandDef(slug),
    rangeKey: params.range,
    papeis: { admin, dados, leads, perigo },
    banco: {
      nome: backend === "postgres" ? "Postgres" : backend === "supabase" ? "Supabase" : "JSON local",
      conectado: backend !== "local",
    },
  };
}

// ---------------------------------------------------------------- marcas

export interface CampanhaDaMarca {
  name: string;
  spend: number;
  /** Para onde a campanha iria se reclassificasse agora (quando muda de marca). */
  vaiPara?: string;
}

export interface GastoPorMarca {
  slug: string;
  label: string;
  spend: number;
  campaigns: CampanhaDaMarca[];
}

export interface SeparacaoDeMarcas {
  multiBrand: boolean;
  /** Gasto + campanhas atribuídas a cada marca, com a prévia da regra atual. */
  porMarca: GastoPorMarca[];
  /** A regra salva, por marca, como texto do campo ("[KRN], 1200…"). */
  regraAtual: Record<string, string>;
  /** Gasto no balde "não classificado": fora de TODOS os números. */
  naoClassificado: number;
}

/**
 * Separação por marca: gasto + campanhas atribuídas a cada marca + regra atual,
 * com a PRÉVIA — para onde cada campanha iria se reclassificasse agora.
 */
export async function separacaoDeMarcas(): Promise<SeparacaoDeMarcas> {
  const multiBrand = BRANDS.length > 1;
  const matchState = (await getState<Record<string, string[]>>(STATE_KEYS.brandCampaignMatch)) ?? {};
  const regraAtual: Record<string, string> = {};
  for (const [slug, list] of Object.entries(matchState)) regraAtual[slug] = (list ?? []).join(", ");
  if (!multiBrand) return { multiBrand, porMarca: [], regraAtual, naoClassificado: 0 };

  const regras = await resolveMetaBrands();
  const nomeDaMarca = (slug: string) =>
    slug === NAO_CLASSIFICADO ? "não classificado" : (BRANDS.find((b) => b.slug === slug)?.label ?? slug);
  const baldes = [...BRANDS.map((b) => ({ slug: b.slug, label: b.label })), { slug: NAO_CLASSIFICADO, label: "Não classificado" }];
  const porMarca = (
    await Promise.all(
      baldes.map(async (b): Promise<GastoPorMarca> => {
        const d = await getData(b.slug);
        const byCamp = new Map<string, { spend: number; id?: string }>();
        for (const r of d.adDaily) {
          const name = r.campaign || "(sem nome)";
          const cur = byCamp.get(name) ?? { spend: 0, id: r.campaignId };
          byCamp.set(name, { spend: cur.spend + r.spend, id: cur.id ?? r.campaignId });
        }
        const campaigns = [...byCamp.entries()]
          .map(([name, c]) => {
            const destino = brandForCampaign(name, c.id, regras);
            return { name, spend: c.spend, vaiPara: destino !== b.slug ? nomeDaMarca(destino) : undefined };
          })
          .sort((a, b) => b.spend - a.spend);
        return { slug: b.slug, label: b.label, spend: campaigns.reduce((s, c) => s + c.spend, 0), campaigns };
      }),
    )
  ).filter((b) => b.slug !== NAO_CLASSIFICADO || b.campaigns.length > 0);
  const naoClassificado = porMarca.find((b) => b.slug === NAO_CLASSIFICADO)?.spend ?? 0;
  return { multiBrand, porMarca, regraAtual, naoClassificado };
}
