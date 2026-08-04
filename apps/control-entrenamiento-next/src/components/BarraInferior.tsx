import { Euro, Users } from "lucide-react";
import Link from "next/link";

/**
 * Barra de pestañas inferior, como en la aplicación actual.
 *
 * Reserva `env(safe-area-inset-bottom)` porque en el iPhone la franja de
 * gestos tapaba la última tarjeta.
 */
const PESTANAS = [
  { clave: "clientes", href: "/clientes", texto: "Clientes", Icono: Users },
  { clave: "economia", href: "/economia", texto: "Economía", Icono: Euro },
] as const;

export function BarraInferior({ activa }: { activa: "clientes" | "economia" }) {
  return (
    <>
      {/* Hueco para que la barra fija no tape el contenido. */}
      <div aria-hidden className="h-20" />
      <nav
        aria-label="Secciones"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-borde bg-white/95"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto flex max-w-app">
          {PESTANAS.map(({ clave, href, texto, Icono }) => {
            const seleccionada = clave === activa;
            return (
              <li key={clave} className="flex-1">
                <Link
                  href={href}
                  aria-current={seleccionada ? "page" : undefined}
                  className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-xs transition ${
                    seleccionada ? "font-semibold text-acento" : "text-tinta-suave hover:text-acento"
                  }`}
                >
                  <Icono className="h-5 w-5" aria-hidden />
                  {texto}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
