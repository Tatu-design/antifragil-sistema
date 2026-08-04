import type { MetadataRoute } from "next";

/**
 * La ficha que le dice al móvil qué es esta aplicación.
 *
 * Sin ella, al añadirla a la pantalla de inicio el iPhone se inventa hasta
 * dónde llega la app: toma la dirección con la que se añadió y trata todo lo
 * demás como «otra web». Por eso al saltar a Economía o a Avisos aparecía una
 * barra con el enlace y una X encima — no era un fallo de la pantalla, era el
 * navegador diciendo «esto ya no es tu app» (encontrado por Fernando,
 * 2026-08-04).
 *
 * `scope: "/"` es la línea que lo arregla: **toda** la dirección es la app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Antifrágil — Entrenamiento personal",
    short_name: "Antifrágil",
    description: "Clientes, sesiones y economía de Antifrágil.",
    // Se abre por donde se empieza a trabajar, no por la pantalla de entrada.
    start_url: "/clientes",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "es",
    theme_color: "#1fa99a",
    background_color: "#f5f7f4",
    icons: [
      { src: "/favicon.png", sizes: "180x180", type: "image/png", purpose: "any" },
      { src: "/favicon.png", sizes: "180x180", type: "image/png", purpose: "maskable" },
    ],
  };
}
