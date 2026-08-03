import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Antifrágil · Control de entrenamiento",
  description: "Gestión de clientes, bonos y sesiones de entrenamiento personal.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pensada para el iPhone de Fernando, pero sin bloquear el zoom: impedirlo
  // es una barrera de accesibilidad real.
  themeColor: "#F5F7F4",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-dvh antialiased">
        {/* Columna de 430 px, igual que la app actual. Sin puntos de ruptura
            por ancho: el diseño de Fernando no los tiene. */}
        <div className="mx-auto w-full max-w-app px-4 pb-16 pt-6">{children}</div>
      </body>
    </html>
  );
}
