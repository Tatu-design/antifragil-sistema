import Link from "next/link";

import type { PerfilVisible } from "@/lib/foto-perfil";

/**
 * De qué profesional se está mirando la economía.
 *
 * Son **enlaces, no botones con estado**. Cambiar de profesional cambia la
 * dirección (`/economia?profesional=<id>`), así que el servidor vuelve a
 * calcular y devuelve otra pantalla. Ventajas de hacerlo así:
 *
 *   - recargar mantiene lo que estabas mirando;
 *   - no hay ni una línea de estado en el navegador;
 *   - y, sobre todo, **no se puede engañar**: el identificador de la dirección
 *     se comprueba en el servidor contra la lista real de profesionales antes
 *     de consultar nada. Uno inventado no devuelve la economía de nadie.
 *
 * Se lee igual que los filtros de la lista de clientes, a propósito.
 *
 * **«Todos» va primero y es lo que se ve al entrar** (Fernando, 2026-08-12):
 * es el total real del negocio. Los nombres de al lado desglosan; no son la
 * puerta de entrada. Se distingue porque `elegido` es `null`.
 */
export function SelectorProfesional({
  profesionales,
  elegido,
}: {
  profesionales: PerfilVisible[];
  /** `null` = el negocio entero. */
  elegido: string | null;
}) {
  return (
    <div className="filtros-profesional" role="group" aria-label="Ver la economía de">
      <Link
        href="/economia"
        className={`panel-opcion${elegido === null ? " marcada" : ""}`}
        aria-current={elegido === null ? "page" : undefined}
      >
        Todos
      </Link>
      {profesionales.map((p) => (
        <Link
          key={p.id}
          href={`/economia?profesional=${p.id}`}
          className={`panel-opcion${p.id === elegido ? " marcada" : ""}`}
          aria-current={p.id === elegido ? "page" : undefined}
        >
          {p.nombre}
        </Link>
      ))}
    </div>
  );
}
