import { UtmBuilder } from "@/components/utm/utm-builder";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getData } from "@/lib/data/store";

export const dynamic = "force-dynamic";

export default async function UtmPage() {
  const data = await getData();
  const creatives = data.creatives.map((c) => ({ adId: c.adId, name: c.name }));

  return (
    <div className="max-w-4xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Gerador de UTMs</CardTitle>
          <CardDescription>
            Use estes links nos anúncios para que cada lead chegue com a origem certa.
            Padronizar agora é o que permite comparar criativos depois — UTM que não foi
            marcada no anúncio não tem como ser reconstruída.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UtmBuilder
            defaultBase={process.env.LP_BASE_URL ?? ""}
            defaultCampaign={(data.campaign.id || "campanha").toLowerCase()}
            creatives={creatives}
          />
        </CardContent>
      </Card>
    </div>
  );
}
