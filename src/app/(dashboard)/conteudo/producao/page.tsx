import { CalendarDays, ClipboardCheck, Lock } from "lucide-react";
import { ProducaoBoard } from "@/components/producao/producao-board";
import { OutcomesPanel } from "@/components/producao/outcomes-panel";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getData, listDrafts } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { can } from "@/lib/auth/guard";
import { ctaOf, diaDoPost } from "@/lib/metrics";
import {
  PLAYBOOK_DATE,
  PLAYBOOK_VERSION,
  WEEKLY_MIX,
  hasPlaybook,
} from "@/lib/content/playbook";
import { isAiConfigured } from "@/lib/ai/config";
import { buildOutcomeReport, gradeDaSemana, presenceRoutine } from "@/lib/content/outcomes";
import { ROTINA_DIARIA } from "@/lib/content/playbook";
import { formatDateShort, formatDecimal, formatPercentValue } from "@/lib/format";
import { hojeEmBrasilia } from "@/lib/range";
import { cn } from "@/lib/utils";

// A grade da semana depende de "hoje" — nunca do momento do build.
export const dynamic = "force-dynamic";

export default async function ProducaoPage() {
  const brand = await activeBrandSlug();

  if (!hasPlaybook(brand)) {
    return (
      <EmptyState
        title="Esta marca ainda não tem guia de produção"
        hint="O guia v3 é do @consorcio.brunno. Quando a krone.capital tiver o seu, a validação passa a valer para ela também."
        Icon={Lock}
      />
    );
  }

  const [data, drafts] = await Promise.all([getData(brand), listDrafts(brand)]);
  const canWrite = await can("data:write");
  // Sem ANTHROPIC_API_KEY o botão de revisão nem é renderizado — o painel
  // funciona igual, só sem a camada de julgamento editorial.
  const aiEnabled = isAiConfigured();

  // Contexto do ciclo de CTA: peças já publicadas, mais recente primeiro (no dia de Brasília, `diaDoPost`).
  const published = data.igPosts
    .filter((p) => !p.isTest)
    .map((p) => ({ day: diaDoPost(p), cta: ctaOf(p) }))
    .sort((a, b) => b.day.localeCompare(a.day));

  // ---- loop fechado e rotina (Etapa 4) ----
  const outcomes = buildOutcomeReport(drafts, data.igPosts);
  const rotina = presenceRoutine(data.igAccountDaily);

  // ---- grade da semana corrente ----
  // UMA função (`gradeDaSemana`, dia de Brasília): a MESMA da ação "Complete a grade da
  // semana" do Conteúdo — o "{p}/{s} slots com peça" daqui é o "{p} de {s}" de lá.
  const g = gradeDaSemana(data.igPosts, drafts, hojeEmBrasilia());
  const aprovadas = drafts.filter((d) => d.status === "aprovado").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ClipboardCheck className="size-4 text-muted-foreground" />
        <p className="text-sm">
          Validação contra o <span className="font-medium">Guia de Produção {PLAYBOOK_VERSION}</span>
        </p>
        <span className="text-xs text-muted-foreground">
          ({formatDateShort(PLAYBOOK_DATE)}) · {WEEKLY_MIX.reels} reels + {WEEKLY_MIX.carrosseis}{" "}
          carrosséis por semana, nunca 2 peças no mesmo dia
        </span>
      </div>

      {/* ---- grade da semana ---- */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <CalendarDays className="size-4 text-muted-foreground" />
              Grade da semana
              <span className="font-normal text-muted-foreground">
                {formatDateShort(g.inicio)} – {formatDateShort(g.fim)}
              </span>
            </p>
            <div className="flex items-center gap-2">
              <Badge variant={g.preenchidos === g.slotsDeFeed ? "good" : "muted"}>
                {g.preenchidos}/{g.slotsDeFeed} slots com peça
              </Badge>
              {aprovadas > 0 ? <Badge variant="good">{aprovadas} aprovada(s)</Badge> : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {g.dias.map((d) => {
              const semFeed = d.slot.type === null;
              const total = d.publicados + d.pecas.length;
              const canibaliza = total > 1;
              return (
                <div
                  key={d.dia}
                  className={cn(
                    "rounded-lg border p-2.5",
                    d.ehHoje && "border-primary/40 bg-primary/5",
                    canibaliza && "border-[var(--critical)]/50",
                  )}
                >
                  <p className="flex items-baseline justify-between gap-1">
                    <span className="text-xs font-semibold">{d.slot.label}</span>
                    <span className="tabular text-[11px] text-muted-foreground">
                      {formatDateShort(d.dia)}
                    </span>
                  </p>
                  <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
                    {semFeed ? "Sem feed — stories" : (d.slot.pillar ?? d.slot.note)}
                  </p>
                  <div className="mt-2 space-y-1">
                    {d.publicados > 0 ? (
                      <Badge variant="muted">{d.publicados} publicado(s)</Badge>
                    ) : null}
                    {d.pecas.map((dr) => (
                      <Badge
                        key={dr.id}
                        variant={dr.status === "aprovado" ? "good" : "warning"}
                        className="max-w-full"
                      >
                        <span className="truncate">
                          {dr.status === "aprovado" ? "Aprovado" : "Rascunho"}
                          {dr.score != null ? ` · ${dr.score}` : ""}
                        </span>
                      </Badge>
                    ))}
                    {total === 0 && !semFeed ? (
                      <span className="text-[11px] text-muted-foreground">vazio</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {g.dias.some((d) => d.publicados + d.pecas.length > 1) ? (
            <p className="text-xs text-[var(--danger-text)]">
              Há dia com 2+ peças — elas disputam a mesma janela de teste do algoritmo. Espace uma
              por dia.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {rotina.temDados ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-2 p-5">
            <p className="text-sm font-medium">Rotina de presença</p>
            <RotinaStat
              label="Stories / dia"
              value={formatDecimal(rotina.storiesPorDia, 1)}
              meta={`${ROTINA_DIARIA.storiesMin}–${ROTINA_DIARIA.storiesMax}`}
            />
            <RotinaStat
              label="Comentários / dia"
              value={formatDecimal(rotina.comentariosPorDia, 0)}
              meta={String(ROTINA_DIARIA.comentariosNoNicho)}
            />
            <RotinaStat
              label="Seguidas / dia"
              value={formatDecimal(rotina.seguidasPorDia, 0)}
              meta={`${ROTINA_DIARIA.seguirPorDia[0]}–${ROTINA_DIARIA.seguirPorDia[1]}`}
            />
            <RotinaStat
              label="Respondeu tudo"
              value={formatPercentValue(rotina.respondeuTudoPct * 100, 0)}
              meta="100%"
            />
            {rotina.diasUteisSemStory > 0 ? (
              <Badge variant="critical">
                {rotina.diasUteisSemStory} dia(s) útil(eis) sem story
              </Badge>
            ) : null}
            <span className="ml-auto text-xs text-muted-foreground">
              {rotina.diasComRegistro} dia(s) registrado(s)
            </span>
          </CardContent>
        </Card>
      ) : null}

      <OutcomesPanel report={outcomes} />

      <ProducaoBoard
        initialDrafts={drafts}
        published={published}
        canWrite={canWrite}
        aiEnabled={aiEnabled}
        posts={data.igPosts.map((p) => ({
          id: p.id,
          publishedAt: p.publishedAt,
          caption: p.caption,
          type: p.type,
        }))}
      />
    </div>
  );
}

function RotinaStat({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="tabular text-sm font-semibold">{value}</span>
      <span className="text-[11px] text-muted-foreground">meta {meta}</span>
    </div>
  );
}
