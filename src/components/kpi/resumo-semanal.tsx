"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, RefreshCw, Sparkles } from "lucide-react";
import { gerarResumoSemanalAction, type ActionState } from "@/app/(dashboard)/ai-actions";
import { Badge } from "@/components/ui/badge";
import { formatDateShort, formatDateTime } from "@/lib/format";
import type { AiAction, ResumoSemanal } from "@/lib/types";
import { cn } from "@/lib/utils";

const PRIORIDADE: Record<AiAction["prioridade"], { label: string; cor: string }> = {
  alta: { label: "Agora", cor: "var(--danger-text)" },
  media: { label: "Otimizar", cor: "var(--primary)" },
  baixa: { label: "Oportunidade", cor: "var(--muted-foreground)" },
};

function Analise({ r }: { r: ResumoSemanal }) {
  const a = r.analise;
  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed">{a.diagnostico}</p>
      <ul className="space-y-3 border-t pt-3">
        {a.acoes.map((x, i) => {
          const p = PRIORIDADE[x.prioridade] ?? PRIORIDADE.media;
          return (
            <li key={i} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
                  style={{ color: p.cor, background: `color-mix(in srgb, ${p.cor} 12%, transparent)` }}
                >
                  {p.label}
                </span>
                <p className="min-w-0 text-sm font-medium">{x.titulo}</p>
              </div>
              <p className="text-sm text-muted-foreground">{x.porque}</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Como medir:</span> {x.comoMedir}
              </p>
            </li>
          );
        })}
      </ul>
      <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Testar nesta semana</p>
          <p className="text-sm">{a.testarNaSemana}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">O que não mudou</p>
          <p className="text-sm">{a.naoMudou}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <Badge variant="muted">IA</Badge>
        <span className="text-xs text-muted-foreground">
          {a.modelo} · {formatDateTime(r.criadoEm)} · {r.origem === "cron" ? "automático (segunda 08:00)" : "gerado à mão"} · os números vêm do painel, o texto é interpretação
        </span>
      </div>
    </div>
  );
}

/** Gerar o resumo à mão (só com `data:write` e a IA ligada — a ação confere de novo no servidor). */
function useGerarResumo() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState | null>(null);
  function gerar() {
    startTransition(async () => {
      const res = await gerarResumoSemanalAction();
      setState(res);
      if (res.ok) router.refresh();
    });
  }
  return { pending, state, gerar };
}

function Mensagem({ state }: { state: ActionState | null }) {
  if (!state) return null;
  return <span className={cn("text-xs", state.ok ? "text-muted-foreground" : "text-[var(--danger-text)]")}>{state.message}</span>;
}

/**
 * RESUMO DA SEMANA (H7) — recolhido por padrão. Só existe na tela quando há
 * leitura (Fase 2, F17): mostra a mais recente, guarda as 12 últimas ("leituras
 * anteriores", dentro dele) e deixa gerar de novo. Sem leitura nenhuma, sobra UMA
 * linha — o botão "Gerar o resumo da semana" — para quem pode (`canWrite` e a IA
 * ligada); sem poder, nada. A instrução do cron mora em Configurações →
 * Integrações, não aqui.
 */
export function ResumoSemanalCard({
  resumos,
  canWrite,
  aiEnabled,
  className,
}: {
  resumos: ResumoSemanal[];
  canWrite: boolean;
  aiEnabled: boolean;
  className?: string;
}) {
  const { pending, state, gerar } = useGerarResumo();
  const ultimo = resumos[0];
  const anteriores = resumos.slice(1);
  const podeGerar = canWrite && aiEnabled;

  if (!ultimo) {
    if (!podeGerar) return null;
    return (
      <div className={cn("flex flex-wrap items-center gap-2", className)} data-bloco="resumo">
        <button
          type="button"
          onClick={gerar}
          disabled={pending}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          <Sparkles className={cn("size-3.5", pending && "animate-pulse")} />
          {pending ? "Gerando…" : "Gerar o resumo da semana"}
        </button>
        <Mensagem state={state} />
      </div>
    );
  }

  return (
    <details className={cn("group rounded-xl border bg-card text-card-foreground shadow-sm", className)} data-bloco="resumo">
      <summary
        className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm"
        title={`Semana de ${formatDateShort(ultimo.periodo.de)} a ${formatDateShort(ultimo.periodo.ate)} · ${
          ultimo.origem === "cron" ? "automático (segunda 08:00)" : "gerado à mão"
        }`}
      >
        <Sparkles className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">
          <span className="font-medium">Resumo da IA</span>
          <span className="text-muted-foreground">
            {" "}
            · {formatDateShort(ultimo.periodo.de)}–{formatDateShort(ultimo.periodo.ate)}
          </span>
        </span>
        <ChevronDown aria-hidden className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t p-4">
        {podeGerar ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={gerar}
              disabled={pending}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
              {pending ? "Gerando…" : "Gerar de novo"}
            </button>
            <span className="text-xs text-muted-foreground">lê a semana fechada mais recente (segunda a domingo)</span>
            <Mensagem state={state} />
          </div>
        ) : null}
        <Analise r={ultimo} />
        {anteriores.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
              leituras anteriores ({anteriores.length})
            </summary>
            <div className="space-y-2 pt-2">
              {anteriores.map((r) => (
                <details key={r.id} className="rounded-lg border p-3">
                  <summary className="cursor-pointer text-xs">
                    <span className="font-medium">
                      {formatDateShort(r.periodo.de)} a {formatDateShort(r.periodo.ate)}
                    </span>{" "}
                    <span className="text-muted-foreground">· {r.analise.diagnostico.slice(0, 120)}…</span>
                  </summary>
                  <div className="pt-3">
                    <Analise r={r} />
                  </div>
                </details>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </details>
  );
}
