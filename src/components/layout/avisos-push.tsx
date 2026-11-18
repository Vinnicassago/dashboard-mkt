"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * O sino do cabeçalho: liga e desliga os avisos de lead novo (Web Push) NESTE
 * aparelho. Cada pessoa decide no próprio navegador; o servidor manda para todos
 * os que ligaram (`lib/push/enviar.ts`). Só aparece com as chaves VAPID no servidor
 * (`chavePublica`) e num navegador que tem push. No iPhone/iPad, o push só existe
 * com o painel aberto pela Tela de Início — o sino diz isso no clique.
 *
 * O service worker (`/sw.js`) só é registrado quando a pessoa liga: quem nunca
 * ligou não ganha service worker nenhum.
 */

type Estado = "carregando" | "sem-suporte" | "ios-sem-app" | "bloqueado" | "desligado" | "ligado" | "ocupado";

const ROTA = "/api/push/inscricao";

/** A chave pública VAPID (base64url) nos bytes que o navegador pede. */
function chaveEmBytes(base64: string): Uint8Array<ArrayBuffer> {
  const comPreenchimento = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const bruto = atob(comPreenchimento.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(bruto.length));
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i);
  return bytes;
}

/** A inscrição foi feita com a chave que o servidor usa hoje? (Chave trocada = refazer.) */
function mesmaChave(sub: PushSubscription, chave: string): boolean {
  const atual = sub.options?.applicationServerKey;
  if (!atual) return true; // o navegador não diz: confia
  const a = new Uint8Array(atual);
  const b = chaveEmBytes(chave);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function temPush(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function iPhoneForaDoApp(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const app =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !app;
}

async function salvarNoServidor(
  sub: PushSubscription,
  opts: { testar?: boolean; anterior?: string } = {},
): Promise<{ ok: boolean; teste?: string; erro?: string }> {
  try {
    const res = await fetch(ROTA, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inscricao: sub.toJSON(), testar: opts.testar === true, anterior: opts.anterior }),
    });
    const corpo = (await res.json().catch(() => ({}))) as { ok?: boolean; teste?: string; erro?: string };
    return res.ok && corpo.ok ? { ok: true, teste: corpo.teste } : { ok: false, erro: corpo.erro ?? "O servidor recusou a inscrição." };
  } catch {
    return { ok: false, erro: "Sem conexão com o painel." };
  }
}

const TEXTO: Record<Exclude<Estado, "carregando" | "sem-suporte">, string> = {
  "ios-sem-app": "Avisos de lead novo: no iPhone, abra o painel pela Tela de Início",
  bloqueado: "Avisos de lead novo bloqueados neste navegador",
  desligado: "Avisar leads novos neste aparelho",
  ligado: "Avisos de lead novo ligados neste aparelho — clique para desligar",
  ocupado: "Um momento…",
};

/** O corte da barra lateral (`md` do Tailwind): acima dele o sino é do cabeçalho. */
const LARGO = "(min-width: 768px)";

function useTelaLarga(): boolean | null {
  return useSyncExternalStore(
    (avisar) => {
      const m = window.matchMedia(LARGO);
      m.addEventListener("change", avisar);
      return () => m.removeEventListener("change", avisar);
    },
    () => window.matchMedia(LARGO).matches,
    () => null, // no servidor não se sabe: nada (sem diferença na hidratação)
  );
}

/**
 * Dois lugares, uma instância montada por vez: no celular, a ponta da barra de
 * navegação (`MobileNav`); da largura `md` para cima, o cabeçalho. Duas montadas
 * confirmariam a inscrição duas vezes e uma não veria o clique da outra.
 */
export function AvisosPush({ chavePublica, lugar }: { chavePublica: string; lugar: "cabecalho" | "celular" }) {
  const larga = useTelaLarga();
  if (larga === null || larga !== (lugar === "cabecalho")) return null;
  return <Sino chavePublica={chavePublica} />;
}

function Sino({ chavePublica }: { chavePublica: string }) {
  const [estado, setEstado] = useState<Estado>("carregando");
  const [mensagem, setMensagem] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  // Ao abrir o painel: em que pé está ESTE navegador. Ligado = confirma no servidor
  // (quem está logado agora) e, se a chave do servidor mudou, refaz a inscrição.
  useEffect(() => {
    let vivo = true;
    const definir = (e: Estado) => vivo && setEstado(e);
    (async () => {
      if (!temPush()) return definir(iPhoneForaDoApp() ? "ios-sem-app" : "sem-suporte");
      if (Notification.permission === "denied") return definir("bloqueado");
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (!reg || !sub || Notification.permission !== "granted") return definir("desligado");
      if (!mesmaChave(sub, chavePublica)) {
        const antiga = sub.endpoint;
        await sub.unsubscribe();
        const nova = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveEmBytes(chavePublica) });
        return definir((await salvarNoServidor(nova, { anterior: antiga })).ok ? "ligado" : "desligado");
      }
      await salvarNoServidor(sub);
      definir("ligado");
    })().catch(() => definir("desligado"));
    return () => {
      vivo = false;
    };
  }, [chavePublica]);

  // A mensagem do último clique some sozinha, ou com um clique fora dela.
  useEffect(() => {
    if (!mensagem) return;
    const tempo = setTimeout(() => setMensagem(null), 8_000);
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setMensagem(null);
    };
    document.addEventListener("mousedown", fora);
    return () => {
      clearTimeout(tempo);
      document.removeEventListener("mousedown", fora);
    };
  }, [mensagem]);

  if (estado === "carregando" || estado === "sem-suporte") return null;

  async function ligar() {
    setEstado("ocupado");
    setMensagem(null);
    // Pedido de permissão ANTES de qualquer await: o Safari só aceita direto do clique.
    const permissao = await Notification.requestPermission();
    if (permissao !== "granted") {
      setEstado(permissao === "denied" ? "bloqueado" : "desligado");
      setMensagem(
        permissao === "denied"
          ? "O navegador bloqueou as notificações deste site. Libere nas permissões do site e clique de novo."
          : "Sem a permissão do navegador, os avisos ficam desligados.",
      );
      return;
    }
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (sub && !mesmaChave(sub, chavePublica)) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveEmBytes(chavePublica) });
      const r = await salvarNoServidor(sub, { testar: true });
      if (!r.ok) {
        await sub.unsubscribe().catch(() => {});
        setEstado("desligado");
        setMensagem(`Não consegui ligar os avisos: ${r.erro}`);
        return;
      }
      setEstado("ligado");
      setMensagem(
        r.teste === "entregue"
          ? "Ligado. Um aviso de teste chega em instantes."
          : "Ligado, mas o aviso de teste não saiu. Veja em Configurações → Integrações.",
      );
    } catch {
      setEstado("desligado");
      setMensagem("Este navegador não deixou ligar os avisos. Tente de novo ou use outro navegador.");
    }
  }

  async function desligar() {
    setEstado("ocupado");
    setMensagem(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        // Primeiro o servidor para de mandar; depois o navegador solta a inscrição.
        await fetch(ROTA, {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => null);
        await sub.unsubscribe();
      }
      setEstado("desligado");
      setMensagem("Avisos desligados neste aparelho.");
    } catch {
      setEstado("ligado");
      setMensagem("Não consegui desligar. Tente de novo.");
    }
  }

  function clicar() {
    if (estado === "ocupado") return;
    if (estado === "ligado") return void desligar();
    if (estado === "desligado") return void ligar();
    if (estado === "bloqueado") {
      return setMensagem("O navegador bloqueou as notificações deste site. Libere nas permissões do site e recarregue.");
    }
    setMensagem("No iPhone, os avisos só funcionam com o painel na Tela de Início: Compartilhar → Adicionar à Tela de Início.");
  }

  const Icone = estado === "ocupado" ? Loader2 : estado === "ligado" ? BellRing : estado === "desligado" ? Bell : BellOff;
  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={clicar}
        disabled={estado === "ocupado"}
        title={TEXTO[estado]}
        aria-label={TEXTO[estado]}
        aria-pressed={estado === "ligado"}
        className={cn(
          "flex size-9 items-center justify-center rounded-lg border transition-colors hover:bg-foreground/[0.05]",
          estado === "ligado"
            ? "border-primary/50 text-primary"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Icone className={cn("size-4", estado === "ocupado" && "animate-spin")} aria-hidden />
      </button>
      {mensagem ? (
        <p
          role="status"
          className="absolute top-11 right-0 z-20 w-64 rounded-lg border bg-card p-3 text-xs text-foreground shadow-lg"
        >
          {mensagem}
        </p>
      ) : null}
    </div>
  );
}
