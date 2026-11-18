"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MENSAGEM_LEAD_NOVO } from "@/lib/push/mensagem";

/** Vários leads juntos viram UMA atualização. */
const ESPERA_MS = 1_000;

/**
 * Chegou o aviso de um lead (`public/sw.js` manda `MENSAGEM_LEAD_NOVO` às abas
 * abertas): a tela pede os dados de novo ao servidor e o lead aparece sem
 * recarregar. É o mesmo `router.refresh()` da Fila (`AtualizacaoAutomatica`): o
 * que a pessoa está digitando continua no lugar. Aba escondida = atualiza quando
 * voltar a ela. Só funciona onde o sino está ligado (sem ele não há service worker
 * nem aviso); as outras telas seguem com o "Atualizar" do cabeçalho.
 */
export function AtualizarComAviso() {
  const router = useRouter();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;
    let pendente = false;
    let espera: ReturnType<typeof setTimeout> | null = null;

    const atualizar = () => {
      if (document.visibilityState !== "visible") {
        pendente = true;
        return;
      }
      espera ??= setTimeout(() => {
        espera = null;
        router.refresh();
      }, ESPERA_MS);
    };
    const aoReceber = (e: MessageEvent) => {
      if ((e.data as { tipo?: unknown } | null)?.tipo === MENSAGEM_LEAD_NOVO) atualizar();
    };
    const aoVoltar = () => {
      if (pendente && document.visibilityState === "visible") {
        pendente = false;
        atualizar();
      }
    };

    sw.addEventListener("message", aoReceber);
    // Com addEventListener a fila de mensagens só abre com startMessages().
    sw.startMessages();
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      sw.removeEventListener("message", aoReceber);
      document.removeEventListener("visibilitychange", aoVoltar);
      if (espera) clearTimeout(espera);
    };
  }, [router]);

  return null;
}
