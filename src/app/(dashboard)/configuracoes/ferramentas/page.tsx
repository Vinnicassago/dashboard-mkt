import { Link2, MessageCircle, Stethoscope } from "lucide-react";
import { DiagnosticoLeadsPanel, MensagemWhatsappForm } from "@/components/config/ferramentas-forms";
import { SemPermissao } from "@/components/config/sem-permissao";
import { UtmBuilder } from "@/components/utm/utm-builder";
import { RolarParaAncora } from "@/components/ui/rolar-para-ancora";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getData } from "@/lib/data/store";
import { MENSAGEM_WHATSAPP_PADRAO, mensagemWhatsapp } from "@/lib/integracoes";
import { contextoDeConfiguracoes } from "../_carregar";

export const dynamic = "force-dynamic";

/**
 * Configurações → Ferramentas (relatório §7.7 item 6): o gerador de UTM no
 * padrão D6 (só para marcas de conversão), a mensagem do WhatsApp da Fila e o
 * diagnóstico e reparo de leads (só administrador; nada muda sem aprovação).
 */
export default async function FerramentasPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await contextoDeConfiguracoes(searchParams);
  const temUtm = ctx.brand.type !== "awareness";
  const temWhatsapp = ctx.papeis.leads || ctx.papeis.dados;
  const creatives = temUtm ? (await getData(ctx.brand.slug)).creatives.map((c) => ({ adId: c.adId, name: c.name })) : [];

  return (
    <div className="max-w-3xl space-y-6">
      <RolarParaAncora />
      <p className="text-sm text-muted-foreground">
        O que ajuda a operar: o link certo para os anúncios, a mensagem da Fila e o conserto de leads.
      </p>

      {/* Gerador de UTMs — era uma aba só para ele; é configuração de anúncio. */}
      {temUtm ? (
        <Card id="utm" className="scroll-mt-24">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="size-4 text-primary" />
              Gerador de UTMs
            </CardTitle>
            <CardDescription>
              Um link com as macros da Meta ({"{{campaign.id}}"}, {"{{adset.id}}"}, {"{{ad.id}}"}) para todos
              os anúncios: cada lead chega com campanha › conjunto › anúncio resolvidos. UTM que não foi marcada
              no anúncio não tem como ser reconstruída depois.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UtmBuilder defaultBase={process.env.LP_BASE_URL ?? ""} creatives={creatives} />
          </CardContent>
        </Card>
      ) : null}

      {/* Mensagem do WhatsApp da Fila — quem usa é o comercial. */}
      {temWhatsapp ? (
        <Card id="whatsapp" className="scroll-mt-24">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="size-4 text-primary" />
              Mensagem do WhatsApp (Fila)
            </CardTitle>
            <CardDescription>O botão de WhatsApp da Fila abre a conversa com este texto já escrito.</CardDescription>
          </CardHeader>
          <CardContent>
            <MensagemWhatsappForm atual={await mensagemWhatsapp()} padrao={MENSAGEM_WHATSAPP_PADRAO} />
          </CardContent>
        </Card>
      ) : null}

      {/* Diagnóstico dos leads — lê o histórico, só altera com aprovação. */}
      {ctx.papeis.perigo ? (
        <Card id="diagnostico-leads" className="scroll-mt-24">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Stethoscope className="size-4 text-primary" />
              Diagnóstico e reparo de leads
            </CardTitle>
            <CardDescription>
              Até out/2026, quando alguém reenviava o formulário da landing page, o lead voltava a
              &ldquo;Novo&rdquo;, perdia a data de entrada e a reunião registrada. O histórico guardou tudo: aqui
              dá para ver quantos foram afetados e devolver cada um ao estado certo. Nada muda até você aplicar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DiagnosticoLeadsPanel />
          </CardContent>
        </Card>
      ) : (
        <SemPermissao quem="Administrador" oque="roda o diagnóstico e o reparo de leads" />
      )}
    </div>
  );
}
