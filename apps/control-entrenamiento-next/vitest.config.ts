import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Las pruebas contra Supabase van y vuelven a Irlanda en cada consulta:
    // 5 segundos se quedan cortos, y no por lentitud del código.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/dobles/server-only.ts"),
    },
  },
});
