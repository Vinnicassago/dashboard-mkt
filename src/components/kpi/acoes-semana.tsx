"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, RotateCcw, Sparkles, X } from "lucide-react";
import { marcarAcaoAction } from "@/app/(dashboard)/acoes-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Acao, SeveridadeAcao } from "@/lib/motor";
import { DONO_LABEL } from "@/lib/dono";
import { comPeriodo } from "@/lib/range";
import { formatDateShort } from "@/lib/format";
import type { AcaoEstado } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * AÇÕES DA SEMANA — as 3 primeiras do motor v2; o resto fica em "ver todas".
 * Cada uma com dono, frase com número, link, impacto (só com amostra),
 * confiança (quando não é alta) e os botões Feito / Ignorar (com motivo). O
 * estado vale por semana e fica no histórico.
 */

const TONE: Record<SeveridadeAcao, string> = {
  agora: "var(--danger-text)",
  alta: "var(--danger-text)",
  media: "var(--primary)",
  baixa: "var(--muted-foreground)",
};
const SEV_LABEL: Record<SeveridadeAcao, string> = {
  agora: "Agora",
  alta: "Esta semana",
  media: "Otimizar",
  baixa: "Oportunidade",
};

const ESTADO_LABEL: Record<NonNullable<AcaoEstado["estado"]>, string> = {
  feita: "feita",
  ignorada: "ignorada",
  reaberta: "reaberta",
};

function Chip({ cor, children }: { cor: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
      style={{ color: cor, background: `color-mix(in srgb, ${cor} 12%, transparent)` }}
    >
      {children}
    </span>
  );
}

function LinhaAcao({
  a,
  rangeKey,
  podeDecidir,
  onMarcar,
  ocupado,
}: {
  a: Acao;
  rangeKey?: string;
  podeDecidir: boolean;
  onMarcar: (a: Acao, estado: AcaoEstado["estado"], motivo?: string) => void;
  ocupado: boolean;
}) {
  const [ignorando, setIgnorando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const decidida = Boolean(a.estado);
  return (
    <li className={cn("flex flex-col gap-1", decidida && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip cor={TONE[a.severidade]}>{SEV_LABEL[a.severidade]}</Chip>
        <span className="shrink-0 rounded border px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
          {DONO_LABEL[a.dono]}
        </span>
        <p className={cn("min-w-0 text-sm font-medium", decidida && "line-through decoration-muted-foreground/60")}>{a.titulo}</p>
        {a.estado ? (
          <span className="text-xs text-muted-foreground">
            {ESTADO_LABEL[a.estado.estado]} por {a.estado.por}
            {a.estado.motivo ? `: ${a.estado.motivo}` : ""}
          </span>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {a.detalhe}{" "}
        <Link href={comPeriodo(a.href, rangeKey)} className="font-medium text-primary underline-offset-4 hover:underline">
          abrir →
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {a.impacto ? (
          <span className="font-medium text-foreground">{a.impacto.texto}</span>
        ) : a.semImpacto ? (
          <span>{a.semImpacto}</span>
        ) : null}
        {a.confianca !== "alta" ? (
          <span title={a.confiancaMotivo}>
            confiança {a.confianca}
            {a.confiancaMotivo ? ` — ${a.confiancaMotivo}` : ""}
          </span>
        ) : null}
        <span className="text-[11px]">{a.regra}</span>
        {podeDecidir ? (
          <span className="ml-auto flex items-center gap-1.5">
            {decidida ? (
              <button
                type="button"
                disabled={ocupado}
                onClick={() => onMarcar(a, "reaberta")}
                className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium hover:bg-foreground/[0.04] disabled:opacity-50"
              >
                <RotateCcw className="size-3" /> Reabrir
              </button>
            ) : ignorando ? (
              <>
                <input
                  autoFocus
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="por quê? (fica no histórico)"
                  maxLength={300}
                  className="h-7 w-56 rounded-md border bg-background px-2 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && motivo.trim()) onMarcar(a, "ignorada", motivo.trim());
                    if (e.key === "Escape") setIgnorando(false);
                  }}
                />
                <button
                  type="button"
                  disabled={ocupado || !motivo.trim()}
                  onClick={() => onMarcar(a, "ignorada", motivo.trim())}
                  className="inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium hover:bg-foreground/[0.04] disabled:opacity-50"
                >
                  Ignorar
                </button>
                <button type="button" onClick={() => setIgnorando(false)} className="inline-flex h-7 items-center rounded-md px-1.5 text-xs text-muted-foreground hover:text-foreground">
                  <X className="size-3" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => onMarcar(a, "feita")}
                  className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium hover:bg-foreground/[0.04] disabled:opacity-50"
                >
                  <Check className="size-3" /> Feito
                </button>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => setIgnorando(true)}
                  className="inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  Ignorar…
                </button>
              </>
            )}
          </span>
        ) : null}
      </div>
    </li>
  );
}

export function AcoesSemana({
  acoes,
  historico,
  rangeKey,
  podeDecidir,
  roboErro = false,
}: {
  acoes: Acao[];
  historico: AcaoEstado[];
  rangeKey?: string;
  podeDecidir: boolean;
  /** A leitura do robô quebrou: quem espera por ele não está nesta lista. */
  roboErro?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  function marcar(a: Acao, estado: AcaoEstado["estado"], motivo?: string) {
    setErro(null);
    startTransition(async () => {
      const r = await marcarAcaoAction({ acao: a.id, estado, motivo, titulo: a.titulo });
      if (!r.ok) setErro(r.message);
      else router.refresh();
    });
  }

  const abertas = acoes.filter((a) => !a.estado);
  const topo = abertas.slice(0, 3);
  const resto = acoes.filter((a) => !topo.includes(a));

  return (
    <Card data-bloco="acoes">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          Ações da semana
          <span className="text-xs font-normal text-muted-foreground">
            {abertas.length === 0 ? "nenhuma aberta" : `${abertas.length} ${abertas.length === 1 ? "aberta" : "abertas"}`} · estado vale até domingo
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {erro ? <p className="text-sm text-[var(--danger-text)]">{erro}</p> : null}
        {roboErro ? (
          <p className="text-sm text-[var(--warning-text)]">
            Não consegui ler o robô: quem espera o 1º contato por ele não está nesta lista. Se o robô está parado, desative-o em Ajustes.
          </p>
        ) : null}
        {topo.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {acoes.length === 0
              ? roboErro
                ? "Nenhuma regra disparou com o que deu para ler — a fila do robô ficou de fora."
                : "Nenhuma regra disparou: os números estão dentro da régua e ninguém está esperando além do prazo."
              : "Tudo o que disparou nesta semana já foi feito ou ignorado."}
          </p>
        ) : (
          <ol className="space-y-3.5">
            {topo.map((a) => (
              <LinhaAcao key={a.id} a={a} rangeKey={rangeKey} podeDecidir={podeDecidir} onMarcar={marcar} ocupado={pending} />
            ))}
          </ol>
        )}
        {resto.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
              ver todas ({resto.length} a mais{acoes.some((a) => a.estado) ? ", incluindo feitas e ignoradas" : ""})
            </summary>
            <ol className="space-y-3.5 pt-3">
              {resto.map((a) => (
                <LinhaAcao key={a.id} a={a} rangeKey={rangeKey} podeDecidir={podeDecidir} onMarcar={marcar} ocupado={pending} />
              ))}
            </ol>
          </details>
        ) : null}
        {historico.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">histórico ({historico.length})</summary>
            <ul className="space-y-1 pt-2 text-xs text-muted-foreground">
              {historico.map((h) => (
                <li key={h.id}>
                  <span className="tabular">{formatDateShort(h.em)}</span> · semana de {formatDateShort(h.semana)} · {h.titulo} —{" "}
                  <span className="font-medium text-foreground">{ESTADO_LABEL[h.estado]}</span> por {h.por}
                  {h.motivo ? `: ${h.motivo}` : ""}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
