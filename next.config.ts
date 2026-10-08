import type { NextConfig } from "next";

// Domínios extras confiáveis para Server Actions (ex.: seu domínio próprio),
// separados por vírgula em ALLOWED_ORIGINS.
const extraOrigins =
  process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? [];

const nextConfig: NextConfig = {
  // Standalone output = a self-contained server for Docker / EasyPanel.
  output: "standalone",
  // Keep the pg driver as a normal Node dependency (don't bundle it).
  serverExternalPackages: ["pg"],
  // As 14 abas viraram 7, nomeadas pela pergunta que respondem; em out/2026
  // ganharam os nomes do relatório (Funil, Mídia, Leads, Configurações).
  // Favoritos e links salvos continuam chegando — na página que absorveu a
  // antiga. Rota antiga = redirect, nunca 404.
  async redirects() {
    return [
      { source: "/trafego", destination: "/midia", permanent: false },
      { source: "/criativos", destination: "/midia", permanent: false },
      { source: "/dinheiro", destination: "/midia", permanent: false },
      { source: "/robo", destination: "/funil", permanent: false },
      { source: "/jornada", destination: "/funil", permanent: false },
      { source: "/comercial", destination: "/leads", permanent: false },
      { source: "/pessoas", destination: "/leads", permanent: false },
      { source: "/pessoas/:path*", destination: "/leads/:path*", permanent: false },
      { source: "/instagram", destination: "/conteudo", permanent: false },
      { source: "/posts", destination: "/conteudo/posts", permanent: false },
      { source: "/producao", destination: "/conteudo/producao", permanent: false },
      { source: "/utm", destination: "/configuracoes/ferramentas", permanent: false },
      { source: "/config", destination: "/configuracoes", permanent: false },
      { source: "/config/:path*", destination: "/configuracoes/:path*", permanent: false },
      { source: "/ajustes", destination: "/configuracoes", permanent: false },
    ];
  },
  experimental: {
    // Atrás de um proxy (EasyPanel/Traefik) o Next precisa saber quais origens
    // podem disparar Server Actions, senão o envio de formulários dá erro 500.
    serverActions: {
      allowedOrigins: [
        "reserva-salas-dashboard-consorcio.vatuku.easypanel.host",
        "*.easypanel.host",
        ...extraOrigins,
      ],
    },
  },
};

export default nextConfig;
