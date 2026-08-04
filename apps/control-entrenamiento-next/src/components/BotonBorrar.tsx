"use client";

import { useFormStatus } from "react-dom";

/** Se apaga y cambia de texto al pulsarlo, como el `onsubmit` de
 *  `webapp/templates/eliminar_cliente.html`. */
export function BotonBorrar({ nombre }: { nombre: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton" disabled={pending}>
      {pending ? "Borrando…" : `Sí, borrar a ${nombre}`}
    </button>
  );
}
