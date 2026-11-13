import { Clapperboard, Lock } from "lucide-react";
import { PostsMetaForm } from "@/components/config/registros-forms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info } from "@/components/ui/info";
import { getData } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { can } from "@/lib/auth/guard";
import { registrosDoPeriodo } from "@/lib/conteudo";
import { pageRange } from "@/lib/page-range";
import { PERIODO_PADRAO_DO_CONTEUDO, hojeEmBrasilia } from "@/lib/range";

// O formulário mostra o que está gravado AGORA (o teste marcado no Conteúdo, a
// duração salva em outra aba) — nunca a página do build.
export const dynamic = "force-dynamic";

/** O ⓘ do card: uma frase por item, cada uma ≤ 25 palavras. */
const SOBRE_O_CONTEUDO_DOS_POSTS = [
  "Teste = Sim tira o post do placar, da cadência, do último post, dos melhores posts e das ações.",
  "Duração do reel: habilita a retenção em % e o aviso de reel longo; a API não a fornece.",
  "Pilar e CTA alimentam a Produção e o resumo da IA; CTA em Auto lê a legenda.",
  "Lista os posts do período do seletor, no dia de Brasília; a legenda abre o post.",
  "Só o campo que você mudar é gravado: outra aba aberta não desfaz uma marcação.",
].join(" ");

/**
 * Registros (Fase 5, nov/26) — só "Conteúdo dos posts": teste, duração do reel,
 * pilar e CTA dos posts do período. A página só carrega e renderiza: a lista e o
 * título saem de `registrosDoPeriodo` (`lib/conteudo.ts`), a ação continua em
 * `configuracoes/actions.ts`. O snapshot manual, as DMs e a rotina saíram.
 */
export default async function RegistrosPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const sp = await searchParams;
  const rangeParam = Array.isArray(sp.range) ? sp.range[0] : sp.range;
  const brand = await activeBrandSlug();
  const [data, podeEditar] = await Promise.all([getData(brand), can("data:write")]);
  const { range } = pageRange(data, rangeParam ?? PERIODO_PADRAO_DO_CONTEUDO, hojeEmBrasilia());
  const { titulo, linhas } = registrosDoPeriodo(data, range);

  return (
    <div className="space-y-6">
      <Card id="posts" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Clapperboard className="size-4 text-primary" />
            {titulo}
            <Info rotulo="Sobre o conteúdo dos posts" texto={SOBRE_O_CONTEUDO_DOS_POSTS} />
          </CardTitle>
        </CardHeader>
        {/* Período sem post: o título já diz "Nenhum post no período" (um fato, um lugar). */}
        {linhas.length > 0 ? (
          <CardContent className="space-y-3">
            {!podeEditar ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="size-3.5" />
                Seu papel só lê: o formulário não grava.
              </p>
            ) : null}
            <PostsMetaForm posts={linhas} />
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}
