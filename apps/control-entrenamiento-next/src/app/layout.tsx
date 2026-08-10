import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Antifrágil — Clientes",
  icons: { icon: "/favicon.png", apple: "/favicon.png" },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Antifrágil", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1fa99a",
};

/**
 * El armazón, igual que en la aplicación Flask.
 *
 * La hoja de estilos es literalmente la misma (`webapp/static/style.css`,
 * copiada a `/style.css`), así que no hay que traducir nada: las pantallas
 * usan sus mismas clases.
 *
 * Cada pantalla pone su propio contenedor (`page`, `page-ancha`, `sin-barra`),
 * como hacía cada plantilla.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        {/* La hoja de estilos es la MISMA que la de Flask, copiada tal cual a
            `public/style.css`. Se enlaza a mano a propósito: pasarla por el
            empaquetador la reescribiría y dejaría de ser la misma.

            LA HUELLA DEL FINAL NO ES DECORACIÓN (2026-08-10). Sin ella, el
            enlace es siempre `/style.css` y el navegador se queda con la
            versión que ya tiene: Fernando vio su perfil perfecto y el de Rafa
            descolocado, con el mismo código, porque uno tenía la hoja nueva y
            el otro la vieja. Con la huella, cada versión es una dirección
            distinta y no hay nada que reutilizar.

            Se calcula al COMPILAR (ver `next.config.ts`): `public/` no viaja
            dentro del paquete de la función, así que leerlo al arrancar no
            funciona en Vercel. */}
        <link rel="stylesheet" href={`/style.css?v=${process.env.HUELLA_ESTILOS}`} />
        {/* Next ya emite `mobile-web-app-capable`, que es el nombre moderno.
            Este es el de siempre y lo entienden también los iPhone con iOS
            antiguo: sin él, la app añadida a la pantalla de inicio se abre
            con la barra del navegador encima. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body>{children}</body>
    </html>
  );
}
