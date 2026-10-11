import { Layers } from "lucide-react";
import { BrandMatchForm, ReclassifyAdsButton } from "@/components/config/marcas-forms";
import { SemPermissao } from "@/components/config/sem-permissao";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency0 } from "@/lib/format";
import { NAO_CLASSIFICADO } from "@/lib/meta/config";
import { cn } from "@/lib/utils";
import { contextoDeConfiguracoes, separacaoDeMarcas } from "../_carregar";

export const dynamic = "force-dynamic";

/**
 * Configurações → Marcas e atribuição (relatório §7.7 item 3): a regra por
 * marca (token ou id de campanha), a prévia de para onde cada campanha iria e o
 * balde "não classificado" — gasto fora de todos os números até alguém dizer de
 * quem é. Reclassificar troca tudo numa transação (`replaceAdData`).
 */
export default async function MarcasPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await contextoDeConfiguracoes(searchParams);

  if (!ctx.papeis.dados) {
    return (
      <div className="max-w-3xl space-y-6">
        <SemPermissao quem="Administrador e Marketing" oque="definem a regra de marca e reclassificam os anúncios" />
      </div>
    );
  }

  const sep = await separacaoDeMarcas();

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">
        As marcas dividem o mesmo ad account: o gasto é separado pela campanha, e o que nenhuma regra
        reivindica fica fora de todos os números.
      </p>

      {!sep.multiBrand ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Uma marca só: todo o gasto do ad account é dela. A regra de separação só entra quando houver uma
          segunda marca declarada.
        </p>
      ) : (
        <Card id="marcas" className="scroll-mt-24">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="size-4 text-primary" />
              Separação de marcas (tráfego pago)
            </CardTitle>
            <CardDescription>
              Defina como reconhecer as campanhas de cada marca — um token do nome (ex.: [KRN]) ou o id da
              campanha — e reclassifique os anúncios já coletados.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sep.naoClassificado > 0 ? (
              <p className="rounded-lg border border-[var(--warning)]/50 bg-[var(--warning)]/10 p-3 text-sm">
                <strong>{formatCurrency0(sep.naoClassificado)} de gasto não classificado</strong> — nenhuma regra
                reivindica essas campanhas, então elas estão fora do investimento, do CPL e do custo por reunião
                de todas as marcas. Diga de quem são na regra abaixo e reclassifique.
              </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              {sep.porMarca.map((b) => (
                <div
                  key={b.slug}
                  className={cn("rounded-lg border p-3", b.slug === NAO_CLASSIFICADO && "border-[var(--warning)]/50")}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">{b.label}</p>
                    <p className="tabular text-lg font-semibold">{formatCurrency0(b.spend)}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">gasto atribuído · campanhas:</p>
                  <ul className="mt-1.5 space-y-1">
                    {b.campaigns.length === 0 ? (
                      <li className="text-xs text-muted-foreground">nenhuma campanha</li>
                    ) : (
                      b.campaigns.map((c) => (
                        <li key={c.name} className="flex items-baseline justify-between gap-2 text-xs">
                          <span className="min-w-0 truncate text-muted-foreground" title={c.name}>
                            {c.name}
                            {c.vaiPara ? (
                              <span className="ml-1.5 font-medium text-[var(--warning-text)]">
                                → {c.vaiPara} ao reclassificar
                              </span>
                            ) : null}
                          </span>
                          <span className="tabular shrink-0 text-muted-foreground">{formatCurrency0(c.spend)}</span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Confira acima se cada campanha está na marca certa. Uma campanha na marca errada? Ajuste a regra
              abaixo (ou renomeie a campanha no Ads Manager) e clique em Reclassificar.
            </p>
            <BrandMatchForm current={sep.regraAtual} />
            <ReclassifyAdsButton />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
