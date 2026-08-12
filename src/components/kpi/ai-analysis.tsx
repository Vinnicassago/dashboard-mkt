"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Sparkles } from "lucide-react";
import { runAnalysisAction, type ActionState } from "@/app/(dashboard)/ai-actions";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateShort, formatDateTime } from "@/lib/format";
import type { AiAction, AiAnalysis } from "@/lib/types";
import { cn } from "@/lib/utils";

const PRIORIDADE: Record<AiAction["prioridade"], { label: string; cor: string }> = {
  alta: { label: "Agora", cor: "var(--danger-text)" },
  media: { label: "Otimizar", cor: "var(--primary)" },
  baixa: { label: "Oportunidade", cor: "var(--muted-foreground)" },
};

/**
 * "Leitura do período" — a análise escrita pela IA sobre os números já
 * calculados. Fica marcada como IA, com modelo e data: conselho é conselho, e
 * quem lê precisa saber a procedência para calibrar a confiança.
 */
export function AiAnalysisCard({
  analysis,
  rangeKey,
  rangeLabel,
  currentPeriod,
  canWrite,
}: {
  analysis: AiAnalysis | null;
  /** Chave do período selecionado (`7d`, `all`…) — a análise roda sobre ele. */
  rangeKey: string;
  rangeLabel: string;
  /** Período resolvido na tela AGORA, no mesmo formato que a análise grava. */
  currentPeriod: { de: string; ate: string };
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState | null>(null);

  function run() {
    startTransition(async () => {
      const res = await runAnalysisAction(rangeKey);
      setState(res);
      if (res.ok) router.refresh();
    });
  }

  // A análise guardada é de UM período. Se a pessoa trocou o filtro, o texto na
  // tela não fala mais do que ela está vendo — avisar é obrigatório.
  const outroPeriodo =
    analysis != null &&
    (analysis.periodo.de !== currentPeriod.de || analysis.periodo.ate !== currentPeriod.ate);

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="size-4 text-muted-foreground" />
          <p className="text-sm font-medium">Leitura do período</p>
          {analysis ? (
            <span className="text-xs text-muted-foreground">
              {analysis.periodo.de === "início da campanha"
                ? "campanha inteira"
                : `${formatDateShort(analysis.periodo.de)} – ${formatDateShort(analysis.periodo.ate)}`}
            </span>
          ) : null}
          {canWrite ? (
            <button
              type="button"
              onClick={run}
              disabled={pending}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
              {pending ? "Analisando…" : analysis ? "Atualizar" : `Analisar ${rangeLabel}`}
            </button>
          ) : null}
        </div>

        {state && !state.ok ? (
          <p className="text-sm text-[var(--danger-text)]">{state.message}</p>
        ) : null}

        {!analysis ? (
          <p className="text-sm text-muted-foreground">
            {canWrite
              ? "Ainda sem leitura. Clique em analisar para a IA ler os números do período e escrever o diagnóstico com as ações da semana."
              : "Ainda sem leitura para este período."}
          </p>
        ) : (
          <>
            {outroPeriodo ? (
              <p className="rounded-lg bg-[var(--warning)]/10 px-3 py-2 text-xs text-[var(--warning-text)]">
                Esta leitura é de outro período. Atualize para falar do que está na tela.
              </p>
            ) : null}

            <p className="text-sm leading-relaxed">{analysis.diagnostico}</p>

            <ul className="space-y-3.5 border-t pt-3">
              {analysis.acoes.map((a, i) => {
                const p = PRIORIDADE[a.prioridade] ?? PRIORIDADE.media;
                return (
                  <li key={i} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
                        style={{
                          color: p.cor,
                          background: `color-mix(in srgb, ${p.cor} 12%, transparent)`,
                        }}
                      >
                        {p.label}
                      </span>
                      <p className="min-w-0 text-sm font-medium">{a.titulo}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">{a.porque}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium">Como medir:</span> {a.comoMedir}
                    </p>
                  </li>
                );
              })}
            </ul>

            <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Testar nesta semana</p>
                <p className="text-sm">{analysis.testarNaSemana}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">O que não mudou</p>
                <p className="text-sm">{analysis.naoMudou}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 border-t pt-3">
              <Badge variant="muted">IA</Badge>
              <span className="text-xs text-muted-foreground">
                {analysis.modelo} · {formatDateTime(analysis.criadoEm)} · os números vêm do painel,
                o texto é interpretação
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
