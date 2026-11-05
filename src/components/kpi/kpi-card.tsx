import { ArrowDown, ArrowUp, Minus, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Info } from "@/components/ui/info";
import { KpiSparkline } from "./kpi-sparkline";
import { cn } from "@/lib/utils";
import { aplicarConfianca, type Quarentena } from "@/lib/trust";
import { StatusMetaBadge, type MetaExibida } from "./status-meta";

export interface KpiDelta {
  text: string;
  direction: "up" | "down" | "flat";
  intent: "good" | "bad" | "neutral";
  /** Contra o que a seta compara, quando o texto é só a variação (`pctDelta(..., { curto: true })`). */
  title?: string;
}

const intentClass: Record<KpiDelta["intent"], string> = {
  good: "text-[var(--success-text)]",
  bad: "text-[var(--danger-text)]",
  neutral: "text-muted-foreground",
};

export function KpiCard({
  label,
  value,
  hint,
  delta,
  Icon,
  highlight = false,
  spark,
  quarentena,
  meta,
  info,
  ressalvaNoInfo = false,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: KpiDelta;
  Icon?: LucideIcon;
  highlight?: boolean;
  /** Série diária opcional — vira uma sparkline sutil no rodapé do card. */
  spark?: number[];
  /**
   * Veredito de confiança (lib/trust.ts). Em `quarentena` o card troca o valor
   * por "—" e some com o delta e a sparkline: um número não confiável não pode
   * ganhar tendência nem comparação, senão volta a parecer medição.
   */
  quarentena?: Quarentena;
  /**
   * Meta e status (lib/metas.ts). Sem meta, o card mostra só o delta; com meta,
   * a cor vem SEMPRE com o texto ("Abaixo da meta (60%)"). Em quarentena o
   * status some: número que não se sustenta não fica verde nem vermelho.
   */
  meta?: MetaExibida;
  /**
   * O ⓘ do cartão (régua de texto de nov/26): a explicação que era a linha de
   * `hint` embaixo do número vai para cá, ao lado do rótulo. Texto pronto
   * (serializável: o `Info` é client).
   */
  info?: string;
  /**
   * Com `quarentena`, a explicação (`motivo`) vai para o ⓘ em vez do corpo — o
   * "—" fica colado no número e o motivo, no ⓘ e no ⚠ do cabeçalho (régua de
   * texto). Sem ela, o corpo mostra o motivo como sempre.
   */
  ressalvaNoInfo?: boolean;
}) {
  const DeltaIcon =
    delta?.direction === "up" ? ArrowUp : delta?.direction === "down" ? ArrowDown : Minus;

  const suprimido = quarentena?.nivel === "quarentena";
  const mostrado = aplicarConfianca(value, quarentena);
  const deltaVisivel = suprimido ? undefined : delta;
  const ressalvaNoCorpo = quarentena && !ressalvaNoInfo;
  const textoDoInfo = quarentena && ressalvaNoInfo ? [`${quarentena.motivo}.`, info].filter(Boolean).join(" ") : info;

  return (
    <Card
      className={cn(
        "relative isolate overflow-hidden p-5",
        highlight && "ring-1 ring-primary/40",
      )}
    >
      <div className="flex items-center justify-between">
        <p className="flex min-w-0 items-center gap-0.5 text-sm font-medium text-muted-foreground">
          <span className="min-w-0">{label}</span>
          {textoDoInfo ? <Info texto={textoDoInfo} rotulo={`Sobre “${label}”`} className="-my-1" /> : null}
        </p>
        {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold tracking-tight tabular sm:text-3xl",
          suprimido && "text-muted-foreground",
        )}
      >
        {mostrado}
      </p>
      {/* min-h reserva a linha do delta/hint p/ cards sem eles ficarem da mesma altura. */}
      <div className="mt-1.5 flex min-h-[1.25rem] flex-wrap items-center gap-2 text-xs">
        {deltaVisivel ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium",
              intentClass[deltaVisivel.intent],
            )}
            title={deltaVisivel.title}
          >
            <DeltaIcon className="size-3.5" />
            {deltaVisivel.text}
          </span>
        ) : null}
        {ressalvaNoCorpo ? (
          <span className="text-[var(--warning-text)]">{quarentena.motivo}</span>
        ) : hint ? (
          <span className="text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      {meta ? (
        <StatusMetaBadge
          meta={suprimido ? { ...meta, avaliacao: undefined } : meta}
          className="mt-1"
        />
      ) : null}
      {spark && spark.length > 1 && !suprimido ? (
        <KpiSparkline
          data={spark}
          className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-9 w-full"
        />
      ) : null}
    </Card>
  );
}
