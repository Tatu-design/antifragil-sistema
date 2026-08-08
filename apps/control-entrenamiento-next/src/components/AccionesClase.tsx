"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";

import { accionBorrarClase, accionFirmarClase } from "@/app/actions";
import type { TipoClase } from "@/domain/economia";

/**
 * El botón de firmar de una cuenta de actividad.
 *
 * Un solo toque, sin preguntar: si se firma de más, se borra esa clase desde
 * el historial de abajo (decisión de Fernando, 2026-08-08). Preguntar antes
 * en algo que se hace varias veces al día molesta más de lo que protege.
 */
export function AccionesClase({ tipo, esKids }: { tipo: TipoClase; esKids: boolean }) {
  return (
    <>
      <form action={accionFirmarClase} className="accion-principal">
        <input type="hidden" name="tipo" value={tipo} />
        <BotonFirmar />
      </form>

      {esKids && (
        <div className="acciones-perfil">
          <Link className="boton-secundario" href={`/clases/${tipo}/facturacion`} style={{ flex: 1 }}>
            Registrar facturación del mes
          </Link>
        </div>
      )}
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

/**
 * Borra UNA clase del historial, la que se elija.
 *
 * Sustituye al antiguo «deshacer la última»: aquí se ve cuál se está
 * borrando. Sí pregunta, porque borrar es lo que no se puede deshacer.
 */
export function BorrarClase({ id, tipo, fecha }: { id: string; tipo: TipoClase; fecha: string }) {
  return (
    <form
      action={accionBorrarClase}
      onSubmit={(evento) => {
        if (!confirm(`¿Borrar la clase del ${fecha}? También se descuenta de la economía.`)) {
          evento.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="tipo" value={tipo} />
      <BotonBorrar />
    </form>
  );
}

function BotonBorrar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="editar" disabled={pending}>
      {pending ? "Borrando…" : "Borrar"}
    </button>
  );
}
