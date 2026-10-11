"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { marcarComoTesteAction } from "@/app/(dashboard)/conteudo/registros/actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Um grupo de variação já formatado no servidor — só o que a tela mostra. */
export interface VariacaoExibida {
  dia: string;
  /** "dd/mm". */
  diaLabel: string;
  legenda: string;
  posts: { id: string; tipo: string; hora: string; isTest: boolean }[];
  /** Ids que o botão marca (os ainda não marcados como teste). */
  pendentes: string[];
}

/**
 * "Variação de anúncio/teste?" — 2+ posts com a mesma legenda no mesmo dia.
 * Nada é corrigido sozinho: uma pessoa confirma, e só então os posts saem das
 * médias e da cadência (isTest). O botão passa pelo mesmo caminho de escrita da
 * marcação de posts em Registros (`updatePostsMetaAction`).
 */
export function VariacoesCard({
  grupos,
  registrosHref,
  podeEditar,
}: {
  grupos: VariacaoExibida[];
  registrosHref: string;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [emCurso, setEmCurso] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);

  if (grupos.length === 0) return null;

  const marcar = (g: VariacaoExibida) => {
    const chave = `${g.dia}|${g.legenda}`;
    setEmCurso(chave);
    setMensagem(null);
    startTransition(async () => {
      const r = await marcarComoTesteAction(g.pendentes);
      setMensagem({ ok: r.ok, texto: r.message });
      setEmCurso(null);
      if (r.ok) router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="size-4 text-primary" />
          Variação de anúncio/teste?
        </CardTitle>
        <CardDescription>
          Posts com a mesma legenda publicados no mesmo dia costumam ser cortes de um teste ou
          versões de um anúncio. Confirmados como teste, saem das médias e da cadência — eles só
          mudam se você confirmar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-3">
          {grupos.map((g) => {
            const chave = `${g.dia}|${g.legenda}`;
            const ocupado = pending && emCurso === chave;
            return (
              <li key={chave} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">
                      {g.diaLabel} · {g.posts.length} posts com a mesma legenda
                    </p>
                    <p className="line-clamp-2 text-sm font-medium">{g.legenda}</p>
                    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {g.posts.map((p) => (
                        <li key={p.id} className="flex items-center gap-1">
                          <span>
                            {p.tipo} · {p.hora}
                          </span>
                          {p.isTest ? <Badge variant="muted">teste</Badge> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <button
                    type="button"
                    onClick={() => marcar(g)}
                    disabled={!podeEditar || pending}
                    title={
                      podeEditar
                        ? `Marca ${g.pendentes.length} post(s) como teste`
                        : "Seu papel não edita dados de conteúdo"
                    }
                    className={cn(
                      "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors",
                      "hover:bg-foreground/[0.04] disabled:cursor-not-allowed disabled:opacity-50",
                    )}
                  >
                    <FlaskConical className="size-3.5" />
                    {ocupado ? "Marcando…" : `Marcar como teste (${g.pendentes.length})`}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {mensagem ? (
          <p
            className={cn(
              "text-sm",
              mensagem.ok ? "text-[var(--success-text)]" : "text-[var(--danger-text)]",
            )}
          >
            {mensagem.texto}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Marcou errado? Desfaça em{" "}
          <Link href={registrosHref} className="underline underline-offset-2">
            Registros → Conteúdo dos posts
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
