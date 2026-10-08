"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/**
 * Recarrega os dados da página sozinha e diz de quando eles são (B4).
 *
 * A aba da Fila que ficou aberta mostrava 62 pessoas esperando; recarregada,
 * mostrava 1 — o dado tinha um dia. Aqui a página pede dados novos ao servidor a
 * cada `segundos` (só com a aba visível, para não gastar à toa) e o rótulo conta
 * a idade do que está na tela a partir de `geradoEm`, que vem do servidor.
 * `titulo` vai para a aba do navegador (ex.: "(3) Fila de contato").
 */
export function AtualizacaoAutomatica({
  geradoEm,
  segundos = 60,
  titulo,
}: {
  geradoEm: string;
  segundos?: number;
  titulo?: string;
}) {
  const router = useRouter();
  // Começa em `geradoEm` (servidor e navegador concordam: "0 s") e só depois
  // passa a contar o relógio do navegador — senão a hidratação diverge.
  const [agora, setAgora] = useState(() => Date.parse(geradoEm));

  useEffect(() => {
    setAgora(Date.now());
    const relogio = setInterval(() => setAgora(Date.now()), 5_000);
    const recarga = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, segundos * 1_000);
    // Voltou para a aba depois de um tempo: atualiza na hora.
    const aoVoltar = () => {
      if (document.visibilityState === "visible" && Date.now() - Date.parse(geradoEm) > segundos * 1_000) {
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      clearInterval(relogio);
      clearInterval(recarga);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [router, segundos, geradoEm]);

  useEffect(() => {
    if (!titulo) return;
    const antes = document.title;
    document.title = titulo;
    return () => {
      document.title = antes;
    };
  }, [titulo]);

  const idade = Math.max(0, Math.round((agora - Date.parse(geradoEm)) / 1_000));
  const texto = idade < 60 ? `${idade} s` : `${Math.floor(idade / 60)} min`;

  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      title="Atualizar agora"
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      <RefreshCw className="size-3" />
      atualizado há {texto}
    </button>
  );
}
