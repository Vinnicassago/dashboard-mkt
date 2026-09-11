import { CalendarDays, ClipboardCheck, Lock } from "lucide-react";
import { ProducaoBoard } from "@/components/producao/producao-board";
import { OutcomesPanel } from "@/components/producao/outcomes-panel";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getData, listDrafts } from "@/lib/data/store";
import { activeBrandSlug } from "@/lib/active-brand";
import { can } from "@/lib/auth/guard";
import { ctaOf, dayOf } from "@/lib/metrics";
import {
  PLAYBOOK_DATE,
  PLAYBOOK_VERSION,
  WEEKLY_MIX,
  WEEK_ORDER,
  hasPlaybook,
} from "@/lib/content/playbook";
import { isAiConfigured } from "@/lib/ai/config";
import { buildOutcomeReport, presenceRoutine } from "@/lib/content/outcomes";
import { ROTINA_DIARIA } from "@/lib/content/playbook";
import { formatDateShort, formatDecimal, formatPercentValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PostDraft } from "@/lib/types";

// A grade da semana depende de "hoje" — nunca do momento do build.
export const dynamic = "force-dynamic";

/** Segunda-feira (UTC) da semana de uma data — mesma convenção de `weekdayOf`. */
function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

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

  // Contexto do ciclo de CTA: peças já publicadas, mais recente primeiro.
  const published = data.igPosts
    .filter((p) => !p.isTest)
    .map((p) => ({ day: dayOf(p.publishedAt), cta: ctaOf(p) }))
    .sort((a, b) => b.day.localeCompare(a.day));

  // ---- loop fechado e rotina (Etapa 4) ----
  const outcomes = buildOutcomeReport(drafts, data.igPosts);
  const rotina = presenceRoutine(data.igAccountDaily);

  // ---- grade da semana corrente ----
  const hoje = new Date().toISOString().slice(0, 10);
  const inicio = weekStart(hoje);
  const publicadosPorDia = new Map<string, number>();
  for (const p of published) publicadosPorDia.set(p.day, (publicadosPorDia.get(p.day) ?? 0) + 1);

  const draftsAtivos = drafts.filter((d) => d.status !== "descartado");
  const draftsPorDia = new Map<string, PostDraft[]>();
  for (const d of draftsAtivos) {
    if (!d.plannedFor) continue;
    draftsPorDia.set(d.plannedFor, [...(draftsPorDia.get(d.plannedFor) ?? []), d]);
  }

  const semana = WEEK_ORDER.map((slot, i) => {
    const day = addDays(inicio, i);
    return {
      slot,
      day,
      isToday: day === hoje,
      publicados: publicadosPorDia.get(day) ?? 0,
      drafts: draftsPorDia.get(day) ?? [],
    };
  });

  // Aderência: dos slots de feed da grade, quantos têm peça (publicada ou agendada).
  const slotsDeFeed = semana.filter((d) => d.slot.type !== null);
  const preenchidos = slotsDeFeed.filter((d) => d.publicados > 0 || d.drafts.length > 0).length;
  const aprovadas = draftsAtivos.filter((d) => d.status === "aprovado").length;

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
                {formatDateShort(inicio)} – {formatDateShort(addDays(inicio, 6))}
              </span>
            </p>
            <div className="flex items-center gap-2">
              <Badge variant={preenchidos === slotsDeFeed.length ? "good" : "muted"}>
                {preenchidos}/{slotsDeFeed.length} slots com peça
              </Badge>
              {aprovadas > 0 ? <Badge variant="good">{aprovadas} aprovada(s)</Badge> : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {semana.map((d) => {
              const semFeed = d.slot.type === null;
              const total = d.publicados + d.drafts.length;
              const canibaliza = total > 1;
              return (
                <div
                  key={d.day}
                  className={cn(
                    "rounded-lg border p-2.5",
                    d.isToday && "border-primary/40 bg-primary/5",
                    canibaliza && "border-[var(--critical)]/50",
                  )}
                >
                  <p className="flex items-baseline justify-between gap-1">
                    <span className="text-xs font-semibold">{d.slot.label}</span>
                    <span className="tabular text-[11px] text-muted-foreground">
                      {formatDateShort(d.day)}
                    </span>
                  </p>
                  <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
                    {semFeed ? "Sem feed — stories" : (d.slot.pillar ?? d.slot.note)}
                  </p>
                  <div className="mt-2 space-y-1">
                    {d.publicados > 0 ? (
                      <Badge variant="muted">{d.publicados} publicado(s)</Badge>
                    ) : null}
                    {d.drafts.map((dr) => (
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

          {semana.some((d) => d.publicados + d.drafts.length > 1) ? (
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
