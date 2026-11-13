import { RegistrarAlertas } from "@/components/layout/alertas";
import { Recolhido } from "@/components/funil/recolhido";
import { CriativosDaLiveCard } from "@/components/midia/criativos-live";
import { CriativosNoAr } from "@/components/midia/criativos-no-ar";
import { Detalhes } from "@/components/midia/detalhes";
import { Pausados } from "@/components/midia/pausados";
import { ResumoDaMidia } from "@/components/midia/resumo-da-midia";
import { Verba } from "@/components/midia/verba";
import { RolarParaAncora } from "@/components/ui/rolar-para-ancora";
import { activeBrandSlug } from "@/lib/active-brand";
import { carregarMidia } from "@/lib/midia-server";

export const dynamic = "force-dynamic";

/**
 * Mídia — o que faço com a verba esta semana? Sem `?range=`, os últimos 7 dias. O resumo
 * é o do Início em uma linha; "Para onde vai a verba" compara gasto e leads por conjunto
 * no ar; os cartões dão o sinal de cada criativo no ar. O resto fica recolhido.
 */
export default async function MidiaPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[]; [chave: string]: string | string[] | undefined }>;
}) {
  const brand = await activeBrandSlug();
  const sp = await searchParams;
  const r = Array.isArray(sp.range) ? sp.range[0] : sp.range;
  // Sem `?range=` o carregador resolve o padrão da Mídia (`PERIODO_PADRAO_DA_MIDIA`, 7 dias).
  const { midia: m } = await carregarMidia(brand, r);

  return (
    <div className="space-y-6">
      <RegistrarAlertas alertas={m.alertas} />
      {/* Abre o <details> da âncora e rola até ela: na chegada, no hashchange e no clique em <a href="#…"> (K27). */}
      <RolarParaAncora abrirDetalhes />

      {/* 1–2. A resposta em uma linha (os números do Início) e o link da conferência. */}
      <ResumoDaMidia resumo={m.resumo} conferir={m.conferir} />

      {/* 3. Para onde vai a verba: % do gasto × % dos leads por conjunto no ar. */}
      {m.verba ? <Verba verba={m.verba} /> : null}

      {/* 4. Os criativos de conversão no ar, com o sinal de cada um. */}
      {m.criativos ? <CriativosNoAr criativos={m.criativos} colunasDoRobo={m.colunasDoRobo} /> : null}

      {/* 5–7. Recolhidos: a live (o mesmo conteúdo), o que parou e os detalhes. */}
      {m.live ? (
        <Recolhido id="criativos-live" resumo="Criativos da live 01/12" dica={m.live.dica} rotulo="Sobre os criativos da live">
          <CriativosDaLiveCard r={m.live.r} />
        </Recolhido>
      ) : null}
      {m.pausados ? (
        <Pausados pausados={m.pausados} colunasDoRobo={m.colunasDoRobo} piso={m.pisoDeGasto} regras={m.detalhes.criativos.regras} />
      ) : null}
      <Detalhes detalhes={m.detalhes} colunasDoRobo={m.colunasDoRobo} piso={m.pisoDeGasto} />
    </div>
  );
}
