import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Las pruebas contra Supabase van y vuelven a Irlanda en cada consulta:
    // 5 segundos se quedan cortos, y no por lentitud del código.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Los archivos van de uno en uno: si corren a la vez, cada uno abre su
    // conexión a Supabase y el plan gratuito se queda sin ninguna
    // (ECONNRESET). Tarda algo más, pero no falla por motivos que no son.
    fileParallelism: false,
  },
  // Las pruebas de dibujado (`tests/ltv.test.ts`) montan componentes de React
  // de verdad. Sin esto, el JSX se transformaba a la forma antigua y pedía un
  // `React` global que en estos archivos no existe.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/dobles/server-only.ts"),
    },
  },
});
