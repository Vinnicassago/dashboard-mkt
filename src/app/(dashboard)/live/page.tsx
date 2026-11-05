import { redirect } from "next/navigation";
import { activeBrand } from "@/lib/active-brand";
import { destinoDaLive } from "@/lib/atalho-live";
import { campanhaDaLive } from "@/lib/live-server";

export const dynamic = "force-dynamic";

/**
 * A antiga aba "Live 01/12" (Fase 2, C10): o painel da live é o Início no período
 * da live, então `/live` só redireciona — e na própria página, não no
 * `next.config.ts`, porque as datas da régua estão no store (editáveis). Mantém o
 * `?range=` recebido só se ele é uma das três janelas da régua (campanha,
 * captação, pós-live); qualquer outro (preset, `all`, período livre comum, chave
 * antiga, ausente) vai para a campanha inteira. Marca de awareness → `/`.
 */
export default async function LivePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const [brand, { range }, cfg] = await Promise.all([activeBrand(), searchParams, campanhaDaLive()]);
  if (brand.type === "awareness") redirect("/");
  redirect(`/?range=${encodeURIComponent(destinoDaLive(range, cfg))}`);
}
