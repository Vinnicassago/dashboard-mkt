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
