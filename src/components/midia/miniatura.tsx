"use client";

import { useEffect, useRef, useState } from "react";
import { Film, GalleryHorizontal, Image as ImagemIcone } from "lucide-react";
import type { Creative } from "@/lib/types";

const ICONE: Record<Creative["format"], typeof Film> = { video: Film, carrossel: GalleryHorizontal, imagem: ImagemIcone };

/**
 * A miniatura do criativo (F4-D13): `<img>` simples, 48×48 (40×40 na tabela, com
 * `pequena`) — a URL da Meta muda a cada sync, e `next/image` erraria o cache e
 * viraria proxy aberto do fbcdn. O servidor já tira a URL vencida
 * (`miniaturaValida`); se a imagem falhar mesmo assim (`onError`, ou já falhada
 * antes da hidratação), cai no quadrado do formato com um ícone genérico. Sem texto:
 * o ícone é desenho (`aria-hidden`).
 *
 * Uma CSP futura precisa de `img-src https://*.fbcdn.net` (K28).
 */
export function MiniaturaDoCriativo({
  url,
  formato,
  pequena,
}: {
  url: string | null;
  formato: Creative["format"];
  /** 40×40, para a célula da tabela; o cartão usa o tamanho padrão (48×48). */
  pequena?: boolean;
}) {
  // Guarda a URL que falhou: uma URL nova (o próximo sync) tenta de novo.
  const [falhou, setFalhou] = useState<string | null>(null);
  const img = useRef<HTMLImageElement>(null);
  const tamanho = pequena ? "size-10" : "size-12";

  // O erro que aconteceu antes da hidratação não chega ao `onError`: confere na montagem.
  useEffect(() => {
    const el = img.current;
    if (url && el && el.complete && el.naturalWidth === 0) setFalhou(url);
  }, [url]);

  if (url && falhou !== url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={img}
        src={url}
        alt=""
        width={pequena ? 40 : 48}
        height={pequena ? 40 : 48}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFalhou(url)}
        className={`${tamanho} shrink-0 rounded-md border object-cover`}
      />
    );
  }
  const Icone = ICONE[formato] ?? ImagemIcone;
  return (
    <span
      aria-hidden="true"
      className={`flex ${tamanho} shrink-0 items-center justify-center rounded-md border bg-foreground/[0.03] text-muted-foreground`}
    >
      <Icone className="size-5" />
    </span>
  );
}
