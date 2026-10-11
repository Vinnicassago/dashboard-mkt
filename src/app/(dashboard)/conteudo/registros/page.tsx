import Link from "next/link";
import { CalendarCheck, Camera, Clapperboard, Lock, MessageCircle, PencilLine } from "lucide-react";
import {
  DmForm,
  ManualIgForm,
  PostsMetaForm,
  RoutineForm,
  type PostMetaRow,
} from "@/components/config/config-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getData } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { can } from "@/lib/auth/guard";
import { pageRange } from "@/lib/page-range";
import { comPeriodo } from "@/lib/range";
import { CTA_LABEL, detectCta } from "@/lib/metrics";
import { formatDateShort, formatInt } from "@/lib/format";

// Os formulários abrem com a data de hoje — nunca a do build.
export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  feed: "Feed",
  carrossel: "Carrossel",
  reel: "Reel",
  story: "Story",
};

/**
 * Registros — o que a API não fornece, registra-se aqui, e só aqui (o relatório
 * tirou estes quatro formulários de Configurações: são trabalho de conteúdo,
 * não ajuste do painel). As ações são as mesmas de sempre
 * (`configuracoes/actions.ts`); esta vista só muda onde a pessoa as encontra.
 */
export default async function RegistrosPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const brand = await activeBrandSlug();
  const data = await getData(brand);
  const { rangeKey } = pageRange(data, (await searchParams).range);
  const podeEditar = await can("data:write");

  // O que já está preenchido — para a pessoa saber o que falta, não adivinhar.
  const dias = [...data.igAccountDaily].sort((a, b) => a.date.localeCompare(b.date));
  const ultimoSnapshot = dias.at(-1)?.date;
  const ultimoDm = dias.filter((r) => r.dmConversations != null).at(-1)?.date;
  const ultimaRotina = dias
    .filter(
      (r) =>
        r.storiesPosted != null ||
        r.nicheComments != null ||
        r.accountsFollowed != null ||
        r.repliedAll != null,
    )
    .at(-1)?.date;

  // Metadados manuais de conteúdo: duração de reel, pilar, CTA e teste por post.
  const postMeta: PostMetaRow[] = [...data.igPosts]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .map((p) => {
      // Sempre a heurística pura: o rótulo "Auto (…)" mostra o que valeria ao
      // voltar para Auto, mesmo com override manual ativo.
      const detected = detectCta(p.caption);
      return {
        id: p.id,
        dateLabel: formatDateShort(p.publishedAt),
        type: TYPE_LABEL[p.type] ?? p.type,
        caption: p.caption,
        durationSec: p.durationSec,
        pillar: p.pillar,
        ctaType: p.ctaType,
        detectedCta: detected ? CTA_LABEL[detected] : undefined,
        isTest: p.isTest,
      };
    });
  const testes = data.igPosts.filter((p) => p.isTest).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <PencilLine className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="text-sm">
          <p>
            O que a API do Instagram não fornece, registra-se aqui — e só aqui. Os números
            aparecem em{" "}
            <Link href={comPeriodo("/conteudo", rangeKey)} className="underline underline-offset-2">
              Conta
            </Link>{" "}
            e{" "}
            <Link href={comPeriodo("/conteudo/posts", rangeKey)} className="underline underline-offset-2">
              Posts
            </Link>
            ; dia sem registro mostra “—”, não zero.
          </p>
          {!podeEditar ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="size-3.5" />
              Seu papel só lê: os formulários não gravam.
            </p>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="size-4 text-primary" />
            Snapshot diário do Instagram
          </CardTitle>
          <CardDescription>
            Os números do dia (Instagram Insights) quando a sincronização não roda. É o snapshot
            que constrói o histórico — a API só retém ~90 dias.{" "}
            {ultimoSnapshot
              ? `Último dia com snapshot: ${formatDateShort(ultimoSnapshot)}.`
              : "Ainda não há nenhum snapshot."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ManualIgForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="size-4 text-primary" />
            Conversas de DM
          </CardTitle>
          <CardDescription>
            A métrica de negócio do perfil — a API não expõe DMs. Anote as conversas iniciadas por
            dia (ou a soma da semana num dia só); a Conta mostra o período e a série semanal.{" "}
            {ultimoDm
              ? `Último registro: ${formatDateShort(ultimoDm)}.`
              : "Ainda sem registro — o card de DMs mostra “—”."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DmForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarCheck className="size-4 text-primary" />
            Rotina diária de presença
          </CardTitle>
          <CardDescription>
            Os 15–20 min por dia útil que o guia cobra: 3–5 stories (ao menos 1 interativo), 20
            comentários no nicho, responder 100% e seguir 10–15 contas. Sem registro não há como
            cobrar aderência.{" "}
            {ultimaRotina
              ? `Último registro: ${formatDateShort(ultimaRotina)}.`
              : "Ainda sem registro."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RoutineForm />
        </CardContent>
      </Card>

      <Card id="posts" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clapperboard className="size-4 text-primary" />
            Conteúdo dos posts
          </CardTitle>
          <CardDescription>
            Duração do reel (habilita a retenção % real), pilar/série e CTA (comparação por
            categoria e alertas) e <strong>Teste? = Sim</strong> nos cortes de validação e nas
            variações de anúncio — eles ganham selo e ficam fora das médias e da cadência.
            {testes > 0 ? ` Hoje ${formatInt(testes)} post(s) marcado(s) como teste.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PostsMetaForm posts={postMeta} />
        </CardContent>
      </Card>
    </div>
  );
}
