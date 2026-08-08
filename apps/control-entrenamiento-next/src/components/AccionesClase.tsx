"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";

import { accionDeshacerClase, accionFirmarClase } from "@/app/actions";
import type { TipoClase } from "@/domain/economia";

/**
 * Las acciones de una cuenta de actividad, en el mismo orden que la ficha de
 * un cliente: primero la que se usa a diario, después las de corrección.
 *
 * Firmar es un toque. Deshacer pregunta antes, porque quita una clase ya
 * contada y su dinero.
 */
export function AccionesClase({
  tipo,
  nombre,
  hayClases,
  esKids,
}: {
  tipo: TipoClase;
  nombre: string;
  hayClases: boolean;
  esKids: boolean;
}) {
  return (
    <>
      <form action={accionFirmarClase} className="accion-principal">
        <input type="hidden" name="tipo" value={tipo} />
        <BotonFirmar />
      </form>

      <div className="acciones-perfil">
        {esKids && (
          <Link className="boton-secundario" href={`/clases/${tipo}/facturacion`}>
            Registrar facturación
          </Link>
        )}

        <form
          action={accionDeshacerClase}
          style={{ flex: 1 }}
          onSubmit={(evento) => {
            if (!confirm(`¿Deshacer la última clase de ${nombre}? También se descuenta de la economía.`)) {
              evento.preventDefault();
            }
          }}
        >
          <input type="hidden" name="tipo" value={tipo} />
          <BotonDeshacer desactivado={!hayClases} />
        </form>
      </div>
    </>
  );
}

function BotonFirmar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton-firmar" disabled={pending}>
      {pending ? "Guardando…" : "✓ Firmar sesión de hoy"}
    </button>
  );
}

function BotonDeshacer({ desactivado }: { desactivado: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton-secundario" style={{ width: "100%" }} disabled={pending || desactivado}>
      {pending ? "Deshaciendo…" : "Deshacer última"}
    </button>
  );
}
