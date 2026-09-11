import Link from "next/link";
import { AlertTriangle, EyeOff } from "lucide-react";
import { Cascata } from "@/components/charts/cascata";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getData } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { pageRange } from "@/lib/page-range";
import { getCascataFontes } from "@/lib/robo/client";
import { montarCascata } from "@/lib/cascata";
import { FILA_ETAPAS } from "@/lib/fila";
import { objectiveBreakdown } from "@/lib/metrics";
import { formatCurrency0, formatInt } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Do anúncio à venda — a cascata inteira, num lugar só.
 *
 * É a resposta literal à queixa que originou o redesenho: as etapas existem e
 * são medidas, mas viviam em cinco telas que nunca somavam. Aqui elas viram uma
 * coluna, com o selo de cada fonte e a junta tracejada onde o dado troca de
 * sistema — que é justamente onde os números param de bater.
 */
export default async function JornadaPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const data = await getData(await activeBrandSlug());
  const { range } = pageRange(data, (await searchParams).range);

  const obj = objectiveBreakdown(data, range);
  const fontes = await getCascataFontes();

  const cascata = montarCascata({
    data,
    range,
    robo: fontes.robo,
    comercial: fontes.comercial,
    investimentoConversao: obj.conversao.spend,
  });

  const parcial = fontes.falha?.tipo === "erro";
  const semRobo = fontes.falha?.tipo === "desligado";

  // O degrau com mais gente parada agora — o que dá para recuperar sem gastar.
  const paradoMaisCaro = [...cascata.degraus]
    .filter((d) => d.parados)
    .sort((a, b) => (b.midiaParada ?? 0) - (a.midiaParada ?? 0))[0];

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Cada degrau vem de um sistema diferente — Meta, landing page, painel, robô e
        atendimento. A junta <span className="font-medium text-foreground">tracejada</span> marca
        onde o dado troca de dono, que é onde os números costumam parar de bater. Percentuais
        têm duas âncoras: acima de Leads medem sobre as impressões; de Leads para baixo,
        Leads é 100%.
      </p>

      {parcial ? (
        <Card className="border-[var(--warning)]/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning-text)]" />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">A cascata está truncada.</span> Não
              consegui ler o robô, então ela termina nos leads — o fundo do funil não está
              aqui, e não é porque não aconteceu.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {paradoMaisCaro ? (
        <Card className="border-[var(--danger)]/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--danger-text)]" />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {formatInt(paradoMaisCaro.parados!)}{" "}
                {paradoMaisCaro.parados === 1 ? "pessoa" : "pessoas"} ·{" "}
                {paradoMaisCaro.etapaFila
                  ? FILA_ETAPAS[paradoMaisCaro.etapaFila].label.toLowerCase()
                  : paradoMaisCaro.label}
              </p>
              <p className="text-xs text-muted-foreground">
                A mídia já pagou {formatCurrency0(paradoMaisCaro.midiaParada ?? 0)}{" "}
                para trazer essas pessoas até aqui. Elas não custam nada a mais para avançar —
                só um contato.{" "}
                <Link href="/fila" className="text-primary underline-offset-4 hover:underline">
                  Abrir a fila
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Do anúncio à venda</CardTitle>
          <CardDescription>
            Custo por unidade acumulado sobre {formatCurrency0(cascata.investimentoConversao)} de
            verba de conversão. Cada degrau reparte o mesmo dinheiro — não some entre linhas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Cascata degraus={cascata.degraus} />

          {semRobo ? (
            <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
              O robô de WhatsApp não está conectado, então a cascata usa o funil do painel do
              lead para baixo. Com ele ligado, aparecem as etapas de conversa, convite e
              transferência ao especialista.
            </p>
          ) : null}

          {cascata.conversoesPixel > 0 ? (
            <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                Número-sombra: {formatInt(cascata.conversoesPixel)} conversões do Pixel.
              </span>{" "}
              É a janela de atribuição da Meta, carimbada na data do clique — serve para a Meta
              otimizar a entrega e não entra em nenhuma taxa desta cascata. Quando ele diverge
              da contagem de leads, os dois estão certos: contam coisas diferentes.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {cascata.naoAgir.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <EyeOff className="size-4 text-muted-foreground" />
              Onde não agir
            </CardTitle>
            <CardDescription>
              Metade da resposta a “para onde olhar” é saber o que ignorar. Estas parecem as
              maiores perdas do funil e não são perdas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {cascata.naoAgir.map((n) => (
              <div key={n.titulo} className="space-y-1">
                <p className="text-sm font-medium text-muted-foreground line-through decoration-1">
                  {n.titulo}
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">{n.detalhe}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
