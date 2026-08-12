"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, FileText, Link2, Plus, Sparkles, Trash2, X } from "lucide-react";
import {
  deleteDraftAction,
  linkDraftToPostAction,
  reviewDraftAction,
  saveDraftAction,
  type ActionState,
} from "@/app/(dashboard)/producao/actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  CHECKLIST,
  CTA_CYCLE,
  HOOK_MOLDS,
  LEGENDA,
  REEL,
  SERIES,
  slotForWeekday,
  weekdayOf,
} from "@/lib/content/playbook";
import {
  buildValidationContext,
  firstLine,
  validateDraft,
  type ValidationResult,
} from "@/lib/content/validator";
import { suggestMatches } from "@/lib/content/outcomes";
import { CTA_LABEL } from "@/lib/metrics";
import { formatDateShort, formatDateTime } from "@/lib/format";
import type { AiReview, CtaType, DraftStatus, IgMediaType, PostDraft } from "@/lib/types";
import { cn } from "@/lib/utils";

const inputCls =
  "h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40";
const areaCls =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40";
const labelCls = "text-xs font-medium text-muted-foreground";

const TYPE_LABEL: Record<IgMediaType, string> = {
  reel: "Reel",
  carrossel: "Carrossel",
  feed: "Feed",
  story: "Story",
};

const VEREDITO_LABEL: Record<AiReview["veredito"], string> = {
  aprova: "Pode gravar",
  ajusta: "Grava com reparos",
  refaz: "Refaz o gancho",
};

const VEREDITO_VARIANT: Record<AiReview["veredito"], "good" | "warning" | "critical"> = {
  aprova: "good",
  ajusta: "warning",
  refaz: "critical",
};

const STATUS_LABEL: Record<DraftStatus, string> = {
  rascunho: "Rascunho",
  aprovado: "Aprovado",
  publicado: "Publicado",
  descartado: "Descartado",
};

/** Data local (não UTC): à noite no Brasil o toISOString já apontaria p/ amanhã. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function blankDraft(): PostDraft {
  return {
    id: "",
    brand: "",
    status: "rascunho",
    createdAt: "",
    updatedAt: "",
    plannedFor: today(),
    type: "reel",
    hookText: "",
    hookSpoken: "",
    script: "",
    caption: "",
    hasBurnedCaptions: false,
  };
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2">
        <span className={labelCls}>{label}</span>
        {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export function ProducaoBoard({
  initialDrafts,
  published,
  canWrite,
  aiEnabled,
  posts,
}: {
  initialDrafts: PostDraft[];
  /** Peças já publicadas (mais recente primeiro) — contexto do ciclo de CTA. */
  published: { day: string; cta?: CtaType }[];
  canWrite: boolean;
  /** ANTHROPIC_API_KEY presente? Sem ela o botão de revisão nem aparece. */
  aiEnabled: boolean;
  /** Posts publicados da marca — candidatos ao vínculo previsto×realizado. */
  posts: { id: string; publishedAt: string; caption: string; type: IgMediaType }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState | null>(null);
  const [model, setModel] = useState<PostDraft>(blankDraft());

  const set = <K extends keyof PostDraft>(key: K, value: PostDraft[K]) =>
    setModel((m) => ({ ...m, [key]: value }));

  // Validação ao vivo: mesmo módulo puro que roda no servidor ao salvar, então
  // o que aparece aqui é exatamente o que será gravado.
  const result: ValidationResult = useMemo(() => {
    const ctx = buildValidationContext({
      published,
      drafts: initialDrafts
        .filter((d) => d.id !== model.id && !d.publishedPostId)
        .map((d) => ({ day: d.plannedFor, cta: d.ctaType, status: d.status })),
    });
    return validateDraft(model, ctx);
  }, [model, initialDrafts, published]);

  const slot = model.plannedFor ? slotForWeekday(weekdayOf(model.plannedFor)) : undefined;
  const hookWords = model.hookText.trim() ? model.hookText.trim().split(/\s+/).length : 0;
  const l1 = firstLine(model.caption);
  const isReel = model.type === "reel";

  function save(status?: DraftStatus) {
    if (!canWrite) return;
    startTransition(async () => {
      const res = await saveDraftAction({
        id: model.id || undefined,
        status: status ?? model.status,
        plannedFor: model.plannedFor,
        type: model.type,
        pillar: model.pillar,
        hookText: model.hookText,
        hookSpoken: model.hookSpoken,
        promise: model.promise,
        script: model.script,
        caption: model.caption,
        ctaType: model.ctaType,
        ctaKeyword: model.ctaKeyword,
        durationSec: model.durationSec ?? null,
        hasBurnedCaptions: model.hasBurnedCaptions,
        notes: model.notes,
      });
      setState(res);
      if (res.ok && res.id) {
        setModel((m) => ({ ...m, id: res.id!, status: status ?? m.status }));
        router.refresh();
      }
    });
  }

  function review() {
    if (!canWrite || !model.id) return;
    startTransition(async () => {
      const res = await reviewDraftAction(model.id);
      setState(res);
      router.refresh();
    });
  }

  function link(postId: string) {
    if (!canWrite || !model.id) return;
    startTransition(async () => {
      const res = await linkDraftToPostAction(model.id, postId);
      setState(res);
      if (res.ok) {
        setModel((m) => ({
          ...m,
          publishedPostId: postId || undefined,
          status: postId ? "publicado" : m.status,
        }));
        router.refresh();
      }
    });
  }

  function remove(id: string) {
    if (!window.confirm("Excluir este rascunho? A ação não pode ser desfeita.")) return;
    startTransition(async () => {
      const res = await deleteDraftAction(id);
      setState(res);
      if (res.ok) {
        if (model.id === id) setModel(blankDraft());
        router.refresh();
      }
    });
  }

  const bloqueios = result.issues.filter((i) => i.severity === "bloqueio");
  const avisos = result.issues.filter((i) => i.severity === "aviso");

  // A revisão vem do que está GRAVADO (não do modelo em edição): parecer de IA
  // é sobre um texto específico, então mostrar junto de edições não salvas
  // faria o conselho parecer valer para algo que a IA nunca leu.
  // Candidatos ao vínculo: posts ainda não usados por outro rascunho.
  const jaVinculados = new Set(
    initialDrafts.filter((d) => d.id !== model.id && d.publishedPostId).map((d) => d.publishedPostId!),
  );
  const candidatos = model.id ? suggestMatches(model, posts, jaVinculados) : [];

  const saved = initialDrafts.find((d) => d.id === model.id);
  const aiReview = saved?.aiReview;
  const reviewStale =
    aiReview != null && saved != null && saved.updatedAt > aiReview.criadoEm;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      {/* ---- fila de peças ---- */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold tracking-tight">Peças</h2>
          <button
            type="button"
            onClick={() => {
              setModel(blankDraft());
              setState(null);
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3.5" />
            Nova peça
          </button>
        </div>

        {initialDrafts.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
            Nenhuma peça em produção. Crie a primeira e o validador confere o checklist do guia
            enquanto você escreve.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {initialDrafts.map((d) => {
              const active = d.id === model.id;
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setModel(d);
                      setState(null);
                    }}
                    className={cn(
                      "w-full rounded-lg border p-3 text-left transition-colors",
                      active ? "border-primary/40 bg-primary/5" : "hover:bg-foreground/[0.04]",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {d.hookText || "(sem gancho)"}
                      </span>
                      {d.score != null ? (
                        <Badge
                          variant={d.score >= 90 ? "good" : d.score >= 70 ? "warning" : "critical"}
                        >
                          {d.score}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{TYPE_LABEL[d.type]}</span>
                      <span>·</span>
                      <span>{STATUS_LABEL[d.status]}</span>
                      {d.plannedFor ? (
                        <>
                          <span>·</span>
                          <span className="tabular">{formatDateShort(d.plannedFor)}</span>
                        </>
                      ) : null}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ---- editor + veredito ---- */}
      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Data planejada" hint={slot ? slot.label : undefined}>
                <input
                  type="date"
                  value={model.plannedFor ?? ""}
                  onChange={(e) => set("plannedFor", e.target.value || undefined)}
                  className={inputCls}
                />
              </Field>
              <Field label="Formato">
                <select
                  value={model.type}
                  onChange={(e) => set("type", e.target.value as IgMediaType)}
                  className={inputCls}
                >
                  {(Object.keys(TYPE_LABEL) as IgMediaType[]).map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Série / pilar">
                <input
                  list="series-guia"
                  value={model.pillar ?? ""}
                  onChange={(e) => set("pillar", e.target.value || undefined)}
                  placeholder={slot?.pillar ?? "—"}
                  className={inputCls}
                />
                <datalist id="series-guia">
                  {SERIES.map((s) => (
                    <option key={s.pillar} value={s.pillar} />
                  ))}
                </datalist>
              </Field>
            </div>

            {slot ? (
              <p className="rounded-lg bg-foreground/[0.04] px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{slot.label} na grade:</span>{" "}
                {slot.note}
                {slot.targetSec ? ` (${slot.targetSec}s)` : ""}
              </p>
            ) : null}

            <Field
              label="Texto de tela do gancho"
              hint={`${hookWords}/${REEL.hookMaxWords} palavras`}
            >
              <input
                value={model.hookText}
                onChange={(e) => set("hookText", e.target.value)}
                placeholder="Financiar 500 mil devolve 1,1 milhão"
                className={cn(inputCls, hookWords > REEL.hookMaxWords && "border-[var(--critical)]")}
              />
            </Field>

            <Field label="Gancho falado (1ª frase)" hint="teste do áudio">
              <textarea
                rows={2}
                value={model.hookSpoken}
                onChange={(e) => set("hookSpoken", e.target.value)}
                placeholder="Ontem um cliente me mostrou o financiamento que ele ia assinar hoje…"
                className={areaCls}
              />
            </Field>

            <Field label="Promessa (2ª frase)" hint="o que a pessoa leva">
              <input
                value={model.promise ?? ""}
                onChange={(e) => set("promise", e.target.value || undefined)}
                placeholder="Deixa eu te mostrar a conta que o banco não faz."
                className={inputCls}
              />
            </Field>

            <Field
              label={model.type === "carrossel" ? "Slides (um por linha)" : "Roteiro"}
              hint="método direto, sem enrolar"
            >
              <textarea
                rows={5}
                value={model.script}
                onChange={(e) => set("script", e.target.value)}
                className={areaCls}
              />
            </Field>

            <Field
              label="Legenda"
              hint={`1ª linha: ${l1.length}/${LEGENDA.primeiraLinhaMaxChars}`}
            >
              <textarea
                rows={4}
                value={model.caption}
                onChange={(e) => set("caption", e.target.value)}
                placeholder="Consórcio imobiliário sem descapitalizar: a conta completa.&#10;&#10;Comenta SIMULA que eu te mando o comparativo."
                className={areaCls}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="CTA" hint={`da vez: ${CTA_LABEL[result.ctaExpected]}`}>
                <select
                  value={model.ctaType ?? ""}
                  onChange={(e) => set("ctaType", (e.target.value || undefined) as CtaType)}
                  className={inputCls}
                >
                  <option value="">—</option>
                  {CTA_CYCLE.map((c) => (
                    <option key={c} value={c}>
                      {CTA_LABEL[c]}
                    </option>
                  ))}
                  <option value="outro">{CTA_LABEL.outro}</option>
                </select>
              </Field>
              <Field label="Palavra-chave" hint="ex.: SIMULA">
                <input
                  value={model.ctaKeyword ?? ""}
                  onChange={(e) => set("ctaKeyword", e.target.value || undefined)}
                  className={inputCls}
                />
              </Field>
              {isReel ? (
                <Field label="Duração (s)" hint={`máx. ${REEL.maxDurationSec}s`}>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={model.durationSec ?? ""}
                    onChange={(e) =>
                      set("durationSec", e.target.value ? Number(e.target.value) : undefined)
                    }
                    className={inputCls}
                  />
                </Field>
              ) : null}
            </div>

            {isReel ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={model.hasBurnedCaptions ?? false}
                  onChange={(e) => set("hasBurnedCaptions", e.target.checked || undefined)}
                  className="size-4 rounded border"
                />
                Legenda embutida no vídeo inteiro (85% assistem no mudo)
              </label>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <button
                type="button"
                disabled={!canWrite || pending}
                onClick={() => save()}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Salvar rascunho
              </button>
              <button
                type="button"
                disabled={!canWrite || pending || !result.ready}
                onClick={() => save("aprovado")}
                title={result.ready ? undefined : "Resolva os bloqueios primeiro"}
                className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <Check className="size-4" />
                Aprovar para publicar
              </button>
              {aiEnabled ? (
                <button
                  type="button"
                  disabled={!canWrite || pending || !model.id}
                  onClick={review}
                  title={model.id ? undefined : "Salve o rascunho antes de revisar"}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  <Sparkles className="size-4" />
                  {pending ? "Revisando…" : "Revisar com IA"}
                </button>
              ) : null}
              {model.id ? (
                <button
                  type="button"
                  disabled={!canWrite || pending}
                  onClick={() => remove(model.id)}
                  className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:text-[var(--danger-text)] disabled:opacity-50"
                >
                  <Trash2 className="size-4" />
                  Excluir
                </button>
              ) : null}
            </div>

            {/* ---- vínculo com o post publicado (fecha o loop) ---- */}
            {model.id ? (
              <div className="space-y-2 border-t pt-3">
                <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Link2 className="size-3.5" />
                  Post publicado
                </p>
                {model.publishedPostId ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="good">Vinculado</Badge>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {posts.find((p) => p.id === model.publishedPostId)?.caption ??
                        model.publishedPostId}
                    </span>
                    <button
                      type="button"
                      disabled={!canWrite || pending}
                      onClick={() => link("")}
                      className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
                    >
                      desvincular
                    </button>
                  </div>
                ) : candidatos.length > 0 ? (
                  <ul className="space-y-1">
                    {candidatos.slice(0, 3).map((c) => (
                      <li key={c.postId} className="flex items-center gap-2">
                        <Badge variant={c.confianca === "alta" ? "good" : "muted"}>
                          {c.motivo}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                          {c.caption || "(sem legenda)"} ·{" "}
                          {formatDateShort(c.publishedAt.slice(0, 10))}
                        </span>
                        <button
                          type="button"
                          disabled={!canWrite || pending}
                          onClick={() => link(c.postId)}
                          className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
                        >
                          vincular
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Nenhum post publicado parecido ainda. Depois de publicar e sincronizar o
                    Instagram, o vínculo aparece aqui — é ele que alimenta o previsto × realizado.
                  </p>
                )}
              </div>
            ) : null}

            {state ? (
              <p
                className={cn(
                  "text-sm",
                  state.ok ? "text-[var(--success-text)]" : "text-[var(--danger-text)]",
                )}
              >
                {state.message}
              </p>
            ) : null}
            {!canWrite ? (
              <p className="text-xs text-muted-foreground">
                Somente leitura — seu papel não tem permissão para editar a produção.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* ---- veredito ---- */}
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-3xl font-semibold tabular">{result.score}</span>
              <span className="text-sm text-muted-foreground">/100</span>
              <Badge variant={result.ready ? "good" : "critical"}>
                {result.ready ? "Pronto para publicar" : `${bloqueios.length} bloqueio(s)`}
              </Badge>
              {avisos.length > 0 ? (
                <Badge variant="warning">{avisos.length} aviso(s)</Badge>
              ) : null}
              <span className="ml-auto text-xs text-muted-foreground">
                guia {result.playbookVersion}
              </span>
            </div>

            {/* checklist do guia */}
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {CHECKLIST.map((item) => {
                const ok = result.passed.includes(item.id);
                return (
                  <li key={item.id} className="flex items-start gap-2 text-sm">
                    {ok ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-[var(--success-text)]" />
                    ) : (
                      <X className="mt-0.5 size-4 shrink-0 text-[var(--danger-text)]" />
                    )}
                    <span className={ok ? "text-muted-foreground" : ""}>{item.label}</span>
                  </li>
                );
              })}
            </ul>

            {result.issues.length > 0 ? (
              <ul className="space-y-2 border-t pt-3">
                {result.issues.map((i, idx) => (
                  <li key={`${i.id}-${idx}`} className="flex items-start gap-2">
                    <AlertTriangle
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        i.severity === "bloqueio"
                          ? "text-[var(--danger-text)]"
                          : "text-[var(--warning-text)]",
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-sm">{i.message}</p>
                      <p className="text-xs text-muted-foreground">{i.rule}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-t pt-3 text-sm text-[var(--success-text)]">
                Checklist completo. A peça está dentro do guia.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ---- revisão da IA ---- */}
        {aiReview ? (
          <Card>
            <CardContent className="space-y-3 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles className="size-4 text-muted-foreground" />
                <p className="text-sm font-medium">Revisão editorial</p>
                <Badge variant={VEREDITO_VARIANT[aiReview.veredito]}>
                  {VEREDITO_LABEL[aiReview.veredito]}
                </Badge>
                <span className="ml-auto text-xs text-muted-foreground">
                  IA · {aiReview.modelo} · {formatDateTime(aiReview.criadoEm)}
                </span>
              </div>

              {reviewStale ? (
                <p className="rounded-lg bg-[var(--warning)]/10 px-3 py-2 text-xs text-[var(--warning-text)]">
                  A peça mudou depois desta revisão — rode de novo para o parecer valer.
                </p>
              ) : null}

              <p className="text-sm">{aiReview.resumo}</p>

              <ul className="space-y-2 border-t pt-3">
                {(
                  [
                    ["Teste do áudio", aiReview.testeDoAudio],
                    ["Gancho cria tensão", aiReview.ganchoCriaTensao],
                    ["Promessa concreta", aiReview.promessaConcreta],
                    ["Número específico", aiReview.numeroEspecifico],
                    ["Fecha em replay", aiReview.fechaEmReplay],
                  ] as const
                ).map(([label, j]) => (
                  <li key={label} className="flex items-start gap-2">
                    {j.ok ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-[var(--success-text)]" />
                    ) : (
                      <X className="mt-0.5 size-4 shrink-0 text-[var(--danger-text)]" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">{j.porque}</p>
                    </div>
                  </li>
                ))}
              </ul>

              {aiReview.ganchosAlternativos.length > 0 ? (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Reescritas do gancho — clique para usar
                  </p>
                  {aiReview.ganchosAlternativos.map((g, i) => (
                    <button
                      key={`${g.molde}-${i}`}
                      type="button"
                      onClick={() =>
                        setModel((m) => ({ ...m, hookText: g.textoDeTela, hookSpoken: g.falado }))
                      }
                      className="block w-full rounded-lg border p-2.5 text-left transition-colors hover:bg-foreground/[0.04]"
                    >
                      <p className="text-sm font-medium">{g.textoDeTela}</p>
                      <p className="text-xs text-muted-foreground italic">“{g.falado}”</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">molde: {g.molde}</p>
                    </button>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {/* ---- banco de ganchos ---- */}
        <Card>
          <CardContent className="space-y-2 p-5">
            <p className="flex items-center gap-2 text-sm font-medium">
              <FileText className="size-4 text-muted-foreground" />
              Banco de ganchos
            </p>
            <p className="text-xs text-muted-foreground">
              Moldes do guia — troque pelo caso e pelo número da semana. Se travar a língua lendo em
              voz alta, reescreva.
            </p>
            <ul className="space-y-2 pt-1">
              {HOOK_MOLDS.map((m) => (
                <li key={m.key} className="text-sm">
                  <span className="font-medium">{m.label}</span>{" "}
                  <span className="text-muted-foreground italic">“{m.example}”</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
