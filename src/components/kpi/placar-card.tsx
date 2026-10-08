import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Placar } from "@/lib/placar";
import type { PontoSemanal } from "@/lib/kpis";
import { DONO_LABEL } from "@/lib/dono";
import { comPeriodo } from "@/lib/range";
import { dica } from "@/lib/dicionario";
import { formatDateShort, formatInt } from "@/lib/format";
import { StatusMetaBadge } from "./status-meta";
import { cn } from "@/lib/utils";

/**
 * O PLACAR — primeiro bloco da Bússola e o único com destaque (hierarquia é
 * escassez). Uma linha de veredito, a tendência de 10 semanas, o gargalo e a
 * linha de proteção. O custo por reunião aparece como FATO (decisão 4.2).
 */

const ESTILO: Record<Placar["estado"], { card: string; verbo: string; ponto?: string }> = {
  ok: { card: "border-[var(--status-ok)]/50", verbo: "text-[var(--status-ok-text)]", ponto: "var(--status-ok)" },
  perto: { card: "border-[var(--status-perto)]/50", verbo: "text-[var(--status-perto-text)]", ponto: "var(--status-perto)" },
  fora: { card: "border-[var(--status-fora)]/50 bg-[var(--status-fora)]/[0.04]", verbo: "text-[var(--status-fora-text)]", ponto: "var(--status-fora)" },
  "sem-meta": { card: "border-dashed", verbo: "text-muted-foreground" },
  "sem-dado": { card: "border-dashed", verbo: "text-muted-foreground" },
};

/** Barras das últimas 10 semanas (SVG puro). A semana corrente, incompleta, sai vazada. */
function BarrasSemanais({ serie, alvo }: { serie: PontoSemanal[]; alvo?: number }) {
  const max = Math.max(1, alvo ?? 0, ...serie.map((p) => p.reunioesAgendadas));
  const w = 10;
  const gap = 3;
  const h = 28;
  const largura = serie.length * (w + gap) - gap;
  const titulo = serie
    .map((p) => `${formatDateShort(p.semana)}: ${formatInt(p.reunioesAgendadas)}${p.incompleta ? " (em curso)" : ""}`)
    .join(" · ");
  return (
    <svg viewBox={`0 0 ${largura} ${h}`} width={largura} height={h} aria-label={`Reuniões agendadas por semana — ${titulo}`} role="img">
      <title>{titulo}</title>
      {alvo ? (
        <line x1={0} x2={largura} y1={h - (alvo / max) * (h - 2) - 1} y2={h - (alvo / max) * (h - 2) - 1} stroke="var(--muted-foreground)" strokeDasharray="2 2" strokeOpacity={0.6} />
      ) : null}
      {serie.map((p, i) => {
        const altura = Math.max(p.reunioesAgendadas > 0 ? 2 : 1, (p.reunioesAgendadas / max) * (h - 2));
        return (
          <rect
            key={p.semana}
            x={i * (w + gap)}
            y={h - altura}
            width={w}
            height={altura}
            rx={1.5}
            fill={p.incompleta ? "none" : "var(--primary)"}
            stroke="var(--primary)"
            strokeWidth={p.incompleta ? 1 : 0}
            fillOpacity={p.reunioesAgendadas > 0 ? 0.85 : 0.25}
          />
        );
      })}
    </svg>
  );
}

export function PlacarCard({ placar, serie, rangeKey }: { placar: Placar; serie: PontoSemanal[]; rangeKey?: string }) {
  const e = ESTILO[placar.estado];
  return (
    <Card className={cn("overflow-hidden", e.card)} data-bloco="placar">
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div className="min-w-0 space-y-1">
            <p className={cn("flex items-center gap-2 text-xs font-semibold tracking-[0.14em]", e.verbo)}>
              {e.ponto ? <span aria-hidden className="size-2 rounded-full" style={{ background: e.ponto }} /> : null}
              {placar.verbo}
            </p>
            <p className="text-xl font-semibold leading-tight sm:text-2xl" title={dica("reunioes_agendadas")}>
              {placar.frase}
              {placar.provisoria && placar.alvo ? (
                <span className="ml-2 text-sm font-normal text-muted-foreground" title="Meta provisória: sem amostra quando foi calculada">
                  (meta provisória)
                </span>
              ) : null}
            </p>
            {placar.motivo ? <p className="text-sm text-muted-foreground">{placar.motivo}</p> : null}
          </div>
          <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
            <BarrasSemanais serie={serie} alvo={placar.alvoSemanal} />
            <span>reuniões agendadas · 10 semanas{placar.alvoSemanal ? " · tracejado = meta semanal" : ""}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {placar.gargalo ? (
            <p>
              <span className="text-muted-foreground">Gargalo: </span>
              <Link href={comPeriodo(placar.gargalo.href, rangeKey)} className="font-medium underline-offset-4 hover:underline">
                {placar.gargalo.rotulo}
              </Link>{" "}
              <span className="text-muted-foreground">
                ({DONO_LABEL[placar.gargalo.dono]}, vs {placar.gargalo.origem === "meta" ? "meta" : "média de 8 sem."})
                {placar.gargalo.impactoTexto ? ` · ${placar.gargalo.impactoTexto}` : ""}
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground">Gargalo: — (nenhuma transição com 10 entradas e uma régua)</p>
          )}
          <p title={dica("comparecimento")}>
            <span className="text-muted-foreground">Comparecimento: </span>
            <span className="font-medium">{placar.comparecimento.texto}</span>
            {placar.comparecimento.avaliacao ? (
              <StatusMetaBadge meta={{ avaliacao: placar.comparecimento.avaliacao }} className="ml-1.5" />
            ) : null}
            {placar.comparecimento.motivo ? <span className="text-muted-foreground"> ({placar.comparecimento.motivo})</span> : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span title={dica("custo_por_reuniao")}>{placar.custo}</span>
          {placar.campanha ? <span>{placar.campanha}</span> : null}
          {placar.acao ? (
            <Link href={comPeriodo(placar.acao.href, rangeKey)} className="ml-auto inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
              {placar.acao.label}
              <ArrowRight className="size-3.5" />
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
