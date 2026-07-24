import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output = a self-contained server for Docker / EasyPanel.
  output: "standalone",
  // Keep the pg driver as a normal Node dependency (don't bundle it).
  serverExternalPackages: ["pg"],
};

export default nextConfig;
