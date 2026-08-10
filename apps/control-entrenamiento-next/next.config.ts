import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { NextConfig } from "next";

/**
 * La huella de la hoja de estilos, calculada AL COMPILAR.
 *
 * Se intentó primero calcularla al arrancar el servidor, leyendo el archivo.
 * En Vercel no funciona: `public/` no viaja dentro del paquete de la función,
 * así que caía en el respaldo y usaba la hora de arranque. Servía —cambiaba en
 * cada despliegue— pero también cambiaba en cada instancia nueva, y eso hace
 * descargar otra vez una hoja idéntica sin motivo.
 *
 * Aquí se lee una sola vez, al compilar, y el valor queda cocido en el
 * paquete: igual en todas las instancias y distinto solo cuando el archivo
 * cambia de verdad.
 */
function huellaEstilos(): string {
  try {
    const css = readFileSync(path.join(process.cwd(), "public", "style.css"));
    return createHash("sha1").update(css).digest("hex").slice(0, 8);
  } catch {
    // No debería pasar; si pasa, al menos cambia con cada despliegue.
    return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? "dev";
  }
}

const nextConfig: NextConfig = {
  // El repositorio de staging escribe en disco, así que estas rutas no se
  // pueden pre-renderizar como estáticas.
  experimental: {},
  env: {
    HUELLA_ESTILOS: huellaEstilos(),
  },
};

export default nextConfig;
