import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` lança fora do servidor do Next; nos testes é um módulo vazio.
      "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Os testes de contrato do store usam arquivo/banco próprios: um por vez.
    fileParallelism: false,
  },
});
