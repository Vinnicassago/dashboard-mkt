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
  // As 14 abas viraram 7, nomeadas pela pergunta que respondem. Favoritos e
  // links salvos continuam chegando — na página que absorveu a antiga.
  async redirects() {
    return [
      { source: "/trafego", destination: "/dinheiro", permanent: false },
      { source: "/criativos", destination: "/dinheiro", permanent: false },
      { source: "/funil", destination: "/jornada", permanent: false },
      { source: "/robo", destination: "/jornada", permanent: false },
      { source: "/leads", destination: "/pessoas", permanent: false },
      { source: "/comercial", destination: "/pessoas", permanent: false },
      { source: "/instagram", destination: "/conteudo", permanent: false },
      { source: "/posts", destination: "/conteudo/posts", permanent: false },
      { source: "/producao", destination: "/conteudo/producao", permanent: false },
      { source: "/utm", destination: "/config", permanent: false },
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
