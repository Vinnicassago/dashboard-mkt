"use client";

import { useEffect } from "react";

/** O mínimo de um elemento que `detalhesParaAbrir` lê (objetos falsos no teste). */
interface NoDaArvore {
  tagName: string;
  open?: boolean;
  parentElement: unknown;
}

/**
 * O caminho de `<details>` FECHADOS de `alvo` até a raiz, de dentro para fora — o
 * próprio alvo incluído, se for um. Puro: `:target` não abre `<details>`, e o
 * navegador não os abre sozinho na navegação por fragmento; quem abre é quem chama.
 */
export function detalhesParaAbrir(alvo: NoDaArvore | null): { open?: boolean }[] {
  const out: { open?: boolean }[] = [];
  for (let no: NoDaArvore | null = alvo; no; no = (no.parentElement as NoDaArvore | null | undefined) ?? null) {
    if (String(no.tagName).toUpperCase() === "DETAILS" && !no.open) out.push(no);
  }
  return out;
}

/** Abre os `<details>` do caminho e rola até o alvo (o `scroll-mt-24` dele desconta o cabeçalho, K37). */
function irPara(alvo: HTMLElement | null, abrirDetalhes: boolean): void {
  if (!alvo) return;
  if (abrirDetalhes) for (const d of detalhesParaAbrir(alvo)) d.open = true;
  alvo.scrollIntoView?.({ block: "start" });
}

/** O elemento do id de um fragmento ("#detalhes", "detalhes"); null sem id ou sem elemento. */
function alvoDoHash(doc: Pick<Document, "getElementById">, hash: string): HTMLElement | null {
  let id = hash.replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    // "%" solto na URL: usa o fragmento como veio.
  }
  return id ? doc.getElementById(id) : null;
}

/**
 * Os ouvintes do `abrirDetalhes` (K27): a cada `hashchange` e a cada clique num
 * `<a href="#…">` da página (delegado no `document`), abre os `<details>` do
 * caminho até o alvo e rola. O clique conta porque clicar de novo em "Ver todos"
 * depois de fechar "Detalhes" não dispara `hashchange` (o hash é o mesmo).
 * Devolve a função que tira os dois ouvintes (o desmonte).
 */
export function ouvirAncoras(
  win: Pick<Window, "addEventListener" | "removeEventListener" | "location">,
  doc: Pick<Document, "addEventListener" | "removeEventListener" | "getElementById">,
): () => void {
  const aoMudarHash = () => irPara(alvoDoHash(doc, win.location?.hash ?? ""), true);
  const aoClicar = (e: Event) => {
    const m = e as MouseEvent;
    // Só o clique simples: ctrl/⌘-clique abre outra aba, e esta não precisa rolar.
    if (m.defaultPrevented || (m.button ?? 0) !== 0 || m.metaKey || m.ctrlKey || m.shiftKey || m.altKey) return;
    const origem = e.target as Element | null;
    const link = origem && typeof origem.closest === "function" ? origem.closest('a[href^="#"]') : null;
    if (!link) return;
    irPara(alvoDoHash(doc, link.getAttribute("href") ?? ""), true);
  };
  win.addEventListener("hashchange", aoMudarHash);
  doc.addEventListener("click", aoClicar);
  return () => {
    win.removeEventListener("hashchange", aoMudarHash);
    doc.removeEventListener("click", aoClicar);
  };
}

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
 *
 * `abrirDetalhes` (a Mídia, §3.10): a âncora pode morar dentro de um `<details>`
 * fechado ("Detalhes", "Pausados no período"). Na chegada, a cada `hashchange` e a
 * cada clique num `<a href="#…">`, abre os `<details>` do caminho e rola. Sem a
 * prop, o comportamento é o de sempre: só na chegada, sem abrir nada.
 */
export function RolarParaAncora({ padrao, abrirDetalhes }: { padrao?: string | null; abrirDetalhes?: boolean } = {}) {
  useEffect(() => {
    const alvo = alvoDoHash(document, window.location?.hash ?? "") || (padrao ? document.getElementById(padrao) : null);
    irPara(alvo, Boolean(abrirDetalhes));
    // Sem a prop, só na chegada: a recarga automática da Fila não pode puxar a tela de volta.
    return abrirDetalhes ? ouvirAncoras(window, document) : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
