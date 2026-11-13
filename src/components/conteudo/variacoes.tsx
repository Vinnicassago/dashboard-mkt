"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, FlaskConical, Lock } from "lucide-react";
import { marcarComoTesteAction } from "@/app/(dashboard)/conteudo/registros/actions";
import { Badge } from "@/components/ui/badge";
import type { PostDaVariacaoNaTela, VariacaoParaConferir } from "@/lib/conteudo-tela";
import { cn } from "@/lib/utils";

/** Uma linha por post do grupo: o checkbox (só os da grade), "{Tipo} · {hh:mm}", o selo e o "abrir". */
function LinhaDoPost({
  post,
  marcado,
  bloqueado,
  alternar,
}: {
  post: PostDaVariacaoNaTela;
  marcado: boolean;
  bloqueado: boolean;
  alternar: () => void;
}) {
  const quando = `${post.tipo} · ${post.hora}`;
  return (
    <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {post.estado === "grade" ? (
        <label className={cn("inline-flex min-h-6 items-center gap-2", bloqueado ? "cursor-not-allowed" : "cursor-pointer")}>
          <input
            type="checkbox"
            checked={marcado}
            disabled={bloqueado}
            onChange={alternar}
            className="size-4 shrink-0 accent-primary"
          />
          <span className="tabular">{quando}</span>
        </label>
      ) : (
        <span className="inline-flex min-h-6 items-center gap-2 text-muted-foreground">
          <span className="tabular">{quando}</span>
          <Badge variant={post.estado === "teste" ? "warning" : "default"}>{post.estado}</Badge>
        </span>
      )}
      {post.href ? (
        <a
          href={post.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-6 items-center gap-1 text-primary underline-offset-4 hover:underline"
        >
          abrir
          <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}

/**
 * O miolo do recolhido "Posts iguais no mesmo dia" (Fase 5 de nov/26, §2.3): os grupos
 * de `variacoesNaGrade` (histórico inteiro, só os que ainda têm 2+ posts na GRADE), do
 * dia mais recente ao mais antigo. Em cada grupo, um checkbox por post da grade — todos
 * MARCADOS de início: a pessoa desmarca o post que fica na grade (a peça do dia) — com a
 * hora de Brasília e o "abrir" do post (conteúdo público da marca); o de teste e o
 * impulsionado aparecem só com o selo. "Marcar {p} como teste" manda só os marcados do
 * grupo por `marcarComoTesteAction` (o MESMO caminho de escrita de Registros, que confere
 * `data:write` no servidor); depois do ok, `router.refresh()` — o grupo resolvido some.
 * Nada muda sem uma pessoa confirmar; desmarcar um teste é em Registros.
 */
export function VariacoesParaConferir({
  variacoes,
  podeEditar,
  registrosHref,
}: {
  variacoes: VariacaoParaConferir[];
  podeEditar: boolean;
  registrosHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [emCurso, setEmCurso] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);
  // Os DESMARCADOS (ids de post são únicos): vazio de início = todos os da grade marcados.
  const [desmarcados, setDesmarcados] = useState<ReadonlySet<string>>(() => new Set());

  const alternar = (id: string) =>
    setDesmarcados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });

  const marcar = (g: VariacaoParaConferir, selecionados: string[]) => {
    if (selecionados.length === 0) return;
    setEmCurso(g.chave);
    setMensagem(null);
    startTransition(async () => {
      const r = await marcarComoTesteAction(selecionados);
      setMensagem({ ok: r.ok, texto: r.message });
      setEmCurso(null);
      if (r.ok) router.refresh();
    });
  };

  return (
    <div className="min-w-0 space-y-3">
      {podeEditar ? null : (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3.5 shrink-0" aria-hidden="true" />
          Só admin e marketing marcam posts como teste.
        </p>
      )}
      <ul className="space-y-3">
        {variacoes.map((g) => {
          const selecionados = g.naGrade.filter((id) => !desmarcados.has(id));
          const ocupado = pending && emCurso === g.chave;
          const bloqueado = !podeEditar || pending;
          return (
            <li key={g.chave} className="min-w-0 space-y-2 rounded-lg border p-3">
              <span className="block text-sm font-medium break-words">
                {`${g.diaTexto} · ${g.posts.length} posts · ${g.legenda}`}
              </span>
              <div className="space-y-0.5">
                {g.posts.map((p) => (
                  <LinhaDoPost
                    key={p.id}
                    post={p}
                    marcado={!desmarcados.has(p.id)}
                    bloqueado={bloqueado}
                    alternar={() => alternar(p.id)}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => marcar(g, selecionados)}
                disabled={selecionados.length === 0 || bloqueado}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors",
                  "hover:bg-foreground/[0.04] disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <FlaskConical className="size-3.5" aria-hidden="true" />
                {ocupado ? "Marcando…" : `Marcar ${selecionados.length} como teste`}
              </button>
            </li>
          );
        })}
      </ul>
      {mensagem ? (
        <p
          role="status"
          className={cn("text-sm", mensagem.ok ? "text-[var(--success-text)]" : "text-[var(--danger-text)]")}
        >
          {mensagem.texto}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Para desmarcar um post, use{" "}
        <Link href={registrosHref} className="underline underline-offset-2">
          Registros
        </Link>
        .
      </p>
    </div>
  );
}
