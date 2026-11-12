import { RegistrarAlertas } from "@/components/layout/alertas";
import { CoortesTable } from "@/components/funil/coortes-table";
import { FunilDoProcesso } from "@/components/funil/funil-do-processo";
import { Manchete } from "@/components/funil/manchete";
import { PerdasLista } from "@/components/funil/perdas-lista";
import { Recolhido } from "@/components/funil/recolhido";
import { TendenciaChart } from "@/components/funil/tendencia-chart";
import { activeBrandSlug } from "@/lib/active-brand";
import { carregarFunil } from "@/lib/funil-server";

export const dynamic = "force-dynamic";

/**
 * Funil — onde exatamente estamos perdendo reuniões? A manchete diz a maior perda em
 * pessoas e de quem é a etapa; o card mostra até onde cada lead do período chegou;
 * "Por que perdemos" diz quem encerrou e onde atacar. Só coorte, só carrega e desenha.
 */
export default async function FunilPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[]; [chave: string]: string | string[] | undefined }>;
}) {
  const brand = await activeBrandSlug();
  const sp = await searchParams;
  const r = Array.isArray(sp.range) ? sp.range[0] : sp.range;
  const { funil: f } = await carregarFunil(brand, r);

  return (
    <div className="space-y-6">
      <RegistrarAlertas alertas={f.alertas} />

      {/* 1. A resposta: a maior perda em pessoas, com o dono da etapa e o grupo da Fila. */}
      <Manchete manchete={f.manchete} />

      {/* 2–3. O funil e as perdas — só com lead no período (sem lead, a manchete é o vazio). */}
      {f.funil || f.perdas ? (
        <div className="grid items-start gap-4 lg:grid-cols-5">
          {f.funil ? <FunilDoProcesso funil={f.funil} className="lg:col-span-3" /> : null}
          {f.perdas ? <PerdasLista perdas={f.perdas} className="lg:col-span-2" /> : null}
        </div>
      ) : null}

      {/* 4–5. Recolhidos: a tendência das taxas e a coorte por semana de entrada. */}
      <Recolhido resumo={f.semanas.resumo} dica={f.semanas.dica} rotulo="Sobre a tendência semanal">
        <TendenciaChart data={f.semanas.pontos} />
      </Recolhido>
      <Recolhido resumo={f.coortes.resumo} dica={f.coortes.dica} rotulo="Sobre a coorte por semana">
        <CoortesTable coortes={f.coortes.linhas} />
      </Recolhido>
    </div>
  );
}
