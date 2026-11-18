/*
 * Service worker do painel — SÓ os avisos de lead novo (Web Push). Sem cache e sem
 * `fetch`: a navegação do painel nunca passa por aqui. Registrado pelo sino do
 * cabeçalho (src/components/layout/avisos-push.tsx) quando a pessoa ativa os avisos.
 *
 * O aviso chega cifrado do servidor (src/lib/push/enviar.ts) com
 * { titulo, corpo, url, tag } — `AvisoPush` em src/lib/push/aviso.ts.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let aviso = {};
  try {
    aviso = event.data ? event.data.json() : {};
  } catch {
    aviso = { corpo: event.data ? event.data.text() : "" };
  }
  const tag = typeof aviso.tag === "string" && aviso.tag ? aviso.tag : undefined;
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(aviso.titulo || "Lead novo", {
        body: aviso.corpo || "",
        tag,
        // O mesmo lead de novo troca o aviso anterior, mas toca de novo.
        renotify: Boolean(tag),
        icon: "/favicon.ico",
        lang: "pt-BR",
        data: { url: typeof aviso.url === "string" ? aviso.url : "/fila" },
      });
      // Aviso de LEAD (não o de teste): as abas do painel abertas se atualizam e o
      // lead aparece sem recarregar (src/components/layout/atualizar-com-aviso.tsx).
      // O texto é MENSAGEM_LEAD_NOVO de src/lib/push/mensagem.ts.
      if (tag && tag.startsWith("lead:")) {
        const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const janela of janelas) janela.postMessage({ tipo: "painel:lead-novo" });
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = new URL((event.notification.data && event.notification.data.url) || "/fila", self.location.origin);
  // Só caminhos do próprio painel.
  if (destino.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      // Uma aba já aberta NESSA página só ganha foco; senão abre outra — nunca
      // troca a página de uma aba aberta (alguém pode estar no meio de uma anotação).
      const janelas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const mesma = janelas.find((c) => c.url === destino.href);
      if (mesma && "focus" in mesma) return mesma.focus();
      return self.clients.openWindow(destino.href);
    })(),
  );
});

// O navegador trocou a inscrição (expirou, chave nova): grava a nova e tira a antiga.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const antiga = event.oldSubscription;
      let nova = event.newSubscription;
      if (!nova) {
        const chave = antiga && antiga.options ? antiga.options.applicationServerKey : null;
        if (!chave) return;
        nova = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave });
      }
      await fetch("/api/push/inscricao", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inscricao: nova.toJSON(), anterior: antiga ? antiga.endpoint : undefined }),
      });
    })(),
  );
});
