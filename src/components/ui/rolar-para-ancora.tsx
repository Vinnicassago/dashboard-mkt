"use client";

import { useEffect } from "react";

/**
 * Rola até a âncora da URL quando o conteúdo da página chega.
 *
 * Link com âncora vindo de outra página (home → /config#marcas) caía no topo: a
 * página tem loading.tsx, então o Next procura o id enquanto ainda mostra o
 * esqueleto, não acha, e não tenta de novo quando o conteúdo entra. Montado
 * junto com o conteúdo, este componente roda quando o id já existe.
 */
export function RolarParaAncora() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);
  return null;
}
