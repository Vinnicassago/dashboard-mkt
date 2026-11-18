import { Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info } from "@/components/ui/info";
import {
  CHAVES_DO_RAIO_X,
  NOTAS_DO_RAIO_X,
  textoDasConquistas,
} from "@/lib/diagnostico-live";
import { formatDateTimeCurta } from "@/lib/format";
import type { DiagnosticoTentativa } from "@/lib/types";
import { cn } from "@/lib/utils";

/** O ⓘ do card (cada frase ≤ 25 palavras, a régua de `t3-ficha-tela.test.ts`). */
export const SOBRE_DEPOIS_DA_INSCRICAO_NA_FICHA = [
  "O que a pessoa fez depois de se inscrever na live: o clique na comunidade e o Diagnóstico do Próximo Patrimônio.",
  "Com mais de uma tentativa, vale a mais avançada: concluída vence incompleta e, entre iguais, vale a mais recente.",
  "Horários de Brasília, da hora em que o evento chegou ao painel.",
].join(" ");

/** O título responde: concluiu, até onde foi, ou que nada aconteceu. */
export function tituloDepoisDaInscricao(t: DiagnosticoTentativa | undefined, comunidadeEm: string | undefined): string {
  if (t?.concluidoEm) return "Live · concluiu o diagnóstico";
  if (t) return `Live · respondeu ${t.respondidas} de ${t.total}`;
  return comunidadeEm ? "Live · não começou o diagnóstico" : "Live · nem comunidade nem diagnóstico";
}

function Passo({ feito, rotulo, quando }: { feito: boolean; rotulo: string; quando: string }) {
  return (
    <li className="relative flex items-baseline justify-between gap-4 pl-4 text-sm">
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-1.5 size-2 rounded-full",
          feito ? "bg-[var(--success-text)]" : "border border-muted-foreground/50",
        )}
      />
      <span className={feito ? undefined : "text-muted-foreground"}>{rotulo}</span>
      <span className="text-right tabular-nums text-muted-foreground">{quando}</span>
    </li>
  );
}

/**
 * Ficha → "Live · …": a linha do tempo depois da inscrição (inscrição, clique na
 * comunidade, início e fim do diagnóstico), o resultado (perfil, raio-x,
 * conquistas) e as respostas, com acerto ou erro nas de verdadeiro ou falso. Sem
 * clique e sem diagnóstico, só o título (a régua da ficha: vazio = uma linha).
 */
export function FichaDepoisDaInscricao({
  inscricaoEm,
  comunidadeEm,
  tentativa: t,
  tentativas,
}: {
  inscricaoEm: string;
  comunidadeEm?: string;
  /** A tentativa mais avançada (`maisAvancada`). */
  tentativa?: DiagnosticoTentativa;
  /** Quantas tentativas a pessoa fez. */
  tentativas: number;
}) {
  const vazio = !t && !comunidadeEm;
  const parou = t && !t.concluidoEm ? `parou com ${t.respondidas} de ${t.total}` : "—";
  const notas = t?.notas ?? {};
  const comNota = CHAVES_DO_RAIO_X.filter((k) => notas[k] !== undefined);
  return (
    <Card id="depois-da-inscricao" className="scroll-mt-24">
      <CardHeader className={vazio ? "pb-5" : undefined}>
        <CardTitle className="flex items-center gap-0.5" data-titulo>
          <span className="min-w-0">{tituloDepoisDaInscricao(t, comunidadeEm)}</span>
          <Info texto={SOBRE_DEPOIS_DA_INSCRICAO_NA_FICHA} rotulo="Sobre o depois da inscrição" className="-my-1" />
        </CardTitle>
      </CardHeader>
      {vazio ? null : (
        <CardContent className="space-y-4">
          <ol className="space-y-1.5" aria-label="Linha do tempo depois da inscrição">
            <Passo feito rotulo="Inscrição" quando={formatDateTimeCurta(inscricaoEm)} />
            <Passo feito={Boolean(comunidadeEm)} rotulo="Clicou na comunidade" quando={comunidadeEm ? formatDateTimeCurta(comunidadeEm) : "—"} />
            {/* Sem diagnóstico, o título já diz "não começou": dois "—" a mais seriam ruído. */}
            {t ? (
              <>
                <Passo feito rotulo="Começou o diagnóstico" quando={formatDateTimeCurta(t.iniciadoEm)} />
                <Passo
                  feito={Boolean(t.concluidoEm)}
                  rotulo="Concluiu o diagnóstico"
                  quando={t.concluidoEm ? formatDateTimeCurta(t.concluidoEm) : parou}
                />
              </>
            ) : null}
          </ol>

          {t?.concluidoEm ? (
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-sm">
                <span className="text-muted-foreground">Perfil </span>
                <span className="font-semibold" data-medir-texto-ignorar="true">
                  {t.perfil ?? "—"}
                </span>
              </p>
              {comNota.length ? (
                <div className="space-y-1.5" aria-label="Raio-x">
                  {comNota.map((k) => (
                    <div key={k} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-sm">
                      <span className="text-muted-foreground">{NOTAS_DO_RAIO_X[k]}</span>
                      <span className="h-2 rounded-full bg-muted" aria-hidden="true">
                        <span className="block h-2 rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, notas[k]))}%` }} />
                      </span>
                      <span className="text-right tabular-nums">{Math.round(notas[k])}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {t.conquistas !== undefined ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">Conquistas </span>
                  <span className="tabular-nums">{textoDasConquistas(t)}</span>
                </p>
              ) : null}
            </div>
          ) : null}

          {t && t.respostas.length ? (
            <ol className="space-y-2 text-sm" aria-label="Respostas do diagnóstico">
              {t.respostas.map((r) => (
                <li key={r.n}>
                  <p className="text-xs text-muted-foreground" data-medir-texto-ignorar="true">
                    {r.n}. {r.pergunta}
                  </p>
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span data-medir-texto-ignorar="true">{r.resposta}</span>
                    {r.acertou === true ? (
                      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-[var(--success-text)]">
                        <Check className="size-3" aria-hidden="true" />
                        acertou
                      </span>
                    ) : r.acertou === false ? (
                      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-[var(--status-fora-text)]">
                        <X className="size-3" aria-hidden="true" />
                        errou
                      </span>
                    ) : null}
                  </p>
                </li>
              ))}
            </ol>
          ) : null}

          {tentativas > 1 ? (
            <p className="text-xs text-muted-foreground">{tentativas} tentativas; aqui, a mais avançada.</p>
          ) : null}
        </CardContent>
      )}
    </Card>
  );
}
