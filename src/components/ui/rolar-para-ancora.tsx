"use client";

import { useEffect } from "react";

/**
 * Rola até a âncora da URL quando o conteúdo da página chega.
 *
 * Link com âncora vindo de outra página (home → /config#marcas) caía no topo: a
 * página tem loading.tsx, então o Next procura o id enquanto ainda mostra o
 * esqueleto, não acha, e não tenta de novo quando o conteúdo entra. Montado
 * junto com o conteúdo, este componente roda quando o id já existe.
 *
 * `padrao`: o id para quando a URL não traz âncora — a Fila rola até o grupo do
 * link antigo (`?etapa=novo` → `#resgate`). A âncora da URL vence quando existe na
 * página; a que não existe mais (o aviso de `#resgate` aberto depois de desligar o
 * robô) cai no `padrao`, que `grupoDaUrl` já traduziu.
 */
export function RolarParaAncora({ padrao }: { padrao?: string | null } = {}) {
  useEffect(() => {
    const doHash = decodeURIComponent(window.location.hash.slice(1));
    const alvo = (doHash && document.getElementById(doHash)) || (padrao ? document.getElementById(padrao) : null);
    alvo?.scrollIntoView({ block: "start" });
    // Só na chegada: a recarga automática da Fila não pode puxar a tela de volta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
