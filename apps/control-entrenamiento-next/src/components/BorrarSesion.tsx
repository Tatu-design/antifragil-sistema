"use client";

import { useFormStatus } from "react-dom";

import { accionBorrarSesion } from "@/app/actions";

/** «Eliminar esta sesión», con la misma pregunta previa que Flask. */
export function BorrarSesion({ clienteId, sesionId }: { clienteId: string; sesionId: string }) {
  return (
    <form
      action={accionBorrarSesion}
      style={{ marginTop: "1rem" }}
      onSubmit={(evento) => {
        if (!confirm("¿Borrar esta sesión del historial?")) evento.preventDefault();
      }}
    >
      <input type="hidden" name="clienteId" value={clienteId} />
      <input type="hidden" name="sesionId" value={sesionId} />
      <Boton />
    </form>
  );
}

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton-secundario" style={{ width: "100%" }} disabled={pending}>
      {pending ? "Borrando…" : "Eliminar esta sesión"}
    </button>
  );
}
