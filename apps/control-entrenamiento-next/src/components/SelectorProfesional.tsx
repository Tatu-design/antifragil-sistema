import Link from "next/link";

import type { Perfil } from "@/repositories/tipos";

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
 */
export function SelectorProfesional({
  profesionales,
  elegido,
}: {
  profesionales: Perfil[];
  elegido: string;
}) {
  return (
    <div className="filtros-profesional" role="group" aria-label="Ver la economía de">
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
