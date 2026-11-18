import type { MetadataRoute } from "next";

/**
 * Manifesto do painel (servido em /manifest.webmanifest). Existe por causa dos
 * avisos de lead novo no iPhone/iPad: lá o Web Push só funciona com o painel
 * adicionado à Tela de Início ("Compartilhar → Adicionar à Tela de Início"), aberto
 * como app (`standalone`). Abre na Fila, onde o comercial trabalha. As cores são as
 * do tema escuro da marca de consórcio (a que recebe leads).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dashboard de Campanha",
    short_name: "Painel",
    description: "Leads, fila de contato e números da campanha.",
    start_url: "/fila",
    scope: "/",
    display: "standalone",
    background_color: "#0d0d0d",
    theme_color: "#0d0d0d",
    lang: "pt-BR",
    icons: [{ src: "/favicon.ico", sizes: "256x256 48x48 32x32 16x16", type: "image/x-icon" }],
  };
}
