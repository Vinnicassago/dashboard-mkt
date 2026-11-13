"use client";

import { useActionState } from "react";
import { updatePostsMetaAction } from "@/app/(dashboard)/configuracoes/actions";
import type { LinhaDeRegistro } from "@/lib/conteudo-tela";
import { cn } from "@/lib/utils";
import { Message, SubmitButton, inputCls } from "./form-primitives";

/**
 * O formulário de conteúdo dos posts (Conteúdo → Registros): teste, duração do
 * reel, pilar/série e CTA, só dos posts do período. A ação continua em
 * `configuracoes/actions.ts` (`updatePostsMetaAction`). O snapshot manual, as DMs
 * e a rotina de presença saíram na Fase 5 de nov/26 (o sync grava a mesma linha;
 * DMs e rotina nunca foram usadas).
 *
 * Cada campo leva o valor de quando a página abriu num oculto `orig_<campo>_<id>`:
 * a ação só grava o campo que a pessoa mudou — uma aba aberta antes de uma
 * marcação feita no Conteúdo não a desfaz ao salvar outro campo.
 */

const PILLAR_SUGGESTIONS = ["Simulação da semana", "Mito ou verdade", "Bastidor", "Prova social", "Card de frase"];

const CTA_OPTIONS: { value: string; label: string }[] = [
  { value: "dm", label: "DM" },
  { value: "comentario", label: "Comentário" },
  { value: "salvamento", label: "Salvamento" },
  { value: "marcacao", label: "Marcação" },
  { value: "outro", label: "Outro" },
];

export function PostsMetaForm({ posts }: { posts: LinhaDeRegistro[] }) {
  const [state, action] = useActionState(updatePostsMetaAction, null);
  // Sem post: nada (o título do card de Registros já diz "Nenhum post no período").
  if (posts.length === 0) return null;
  return (
    <form action={action} className="space-y-3">
      <datalist id="pillar-suggestions">
        {PILLAR_SUGGESTIONS.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Post</th>
              <th className="py-2 pr-3 font-medium">Duração (s)</th>
              <th className="py-2 pr-3 font-medium">Pilar / série</th>
              <th className="py-2 pr-3 font-medium">CTA</th>
              <th className="py-2 font-medium">Teste?</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => {
              const duracao = p.durationSec != null ? String(p.durationSec) : "";
              const pilar = p.pillar ?? "";
              const cta = p.ctaType ?? "";
              const teste = p.isTest ? "1" : "";
              // A linha REMONTA quando o valor gravado muda: o React não reaplica o
              // `defaultValue` de um <select> numa atualização, e o reset do form depois da
              // action voltaria o select ao valor da montagem enquanto o `orig_` (controlado)
              // já segue o banco — o salvamento seguinte desfaria a marcação. Com a chave, o
              // padrão visível e o `orig_` de cada campo andam juntos.
              return (
                <tr key={`${p.id}|${teste}|${cta}|${pilar}|${duracao}`} className="border-b last:border-0">
                  <td className="max-w-[280px] py-2 pr-3">
                    {p.href ? (
                      <a
                        href={p.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="line-clamp-1 break-words font-medium underline-offset-2 hover:underline"
                      >
                        {p.legenda}
                      </a>
                    ) : (
                      <span className="line-clamp-1 break-words font-medium">{p.legenda}</span>
                    )}
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="whitespace-nowrap">{`${p.quando} · ${p.tipoTexto}`}</span>
                      {p.impulsionado ? (
                        <span className="rounded border px-1 py-px text-[10px] font-medium">Impulsionado</span>
                      ) : null}
                    </span>
                    <input type="hidden" name={`orig_test_${p.id}`} value={teste} />
                    <input type="hidden" name={`orig_pillar_${p.id}`} value={pilar} />
                    <input type="hidden" name={`orig_cta_${p.id}`} value={cta} />
                    {p.tipo === "reel" ? (
                      <input type="hidden" name={`orig_duration_${p.id}`} value={duracao} />
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">
                    {p.tipo === "reel" ? (
                      <input
                        type="number"
                        name={`duration_${p.id}`}
                        min="1"
                        step="1"
                        defaultValue={duracao}
                        placeholder="s"
                        aria-label="Duração do reel em segundos"
                        className={cn(inputCls, "w-20")}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="text"
                      name={`pillar_${p.id}`}
                      list="pillar-suggestions"
                      defaultValue={pilar}
                      placeholder="ex.: Mito ou verdade"
                      aria-label="Pilar ou série"
                      className={cn(inputCls, "w-44")}
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <select name={`cta_${p.id}`} defaultValue={cta} aria-label="CTA" className={cn(inputCls, "w-36")}>
                      <option value="">Auto{p.detectedCta ? ` (${p.detectedCta})` : " (nenhum)"}</option>
                      {CTA_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2">
                    {/* select (não checkbox): ausente do form = não mexe; "" = não; "1" = sim */}
                    <select name={`test_${p.id}`} defaultValue={teste} aria-label="Post de teste" className={cn(inputCls, "w-20")}>
                      <option value="">Não</option>
                      <option value="1">Sim</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <SubmitButton>Salvar conteúdo</SubmitButton>
      <Message state={state} />
    </form>
  );
}
