"use client";

import { useFormStatus } from "react-dom";

import { accionDeshacerClase, accionRegistrarClase } from "@/app/actions";

/**
 * Los cuatro botones de CrossFit, en las mismas dos filas que
 * `webapp/templates/economia.html`: arriba sumar, abajo deshacer.
 *
 * Deshacer pregunta antes, porque quita una clase ya contada.
 */
export function BotonesClase() {
  return (
    <>
      <div className="botones-clase">
        <form action={accionRegistrarClase} style={{ flex: 1 }}>
          <input type="hidden" name="tipo" value="lidomare" />
          <Sumar texto="+1 CrossFit Lidomare hoy" />
        </form>
        <form action={accionRegistrarClase} style={{ flex: 1 }}>
          <input type="hidden" name="tipo" value="kids" />
          <Sumar texto="+1 CrossFit Kids hoy" />
        </form>
      </div>

      <div className="botones-clase" style={{ marginTop: "0.5rem" }}>
        <form
          action={accionDeshacerClase}
          style={{ flex: 1 }}
          onSubmit={(e) => {
            if (!confirm("¿Deshacer la última clase de CrossFit Lidomare registrada?")) e.preventDefault();
          }}
        >
          <input type="hidden" name="tipo" value="lidomare" />
          <Deshacer texto="Deshacer última Lidomare" />
        </form>
        <form
          action={accionDeshacerClase}
          style={{ flex: 1 }}
          onSubmit={(e) => {
            if (!confirm("¿Deshacer la última clase de CrossFit Kids registrada?")) e.preventDefault();
          }}
        >
          <input type="hidden" name="tipo" value="kids" />
          <Deshacer texto="Deshacer última Kids" />
        </form>
      </div>
    </>
  );
}

function Sumar({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton-clase" disabled={pending}>
      {pending ? "Guardando…" : texto}
    </button>
  );
}

function Deshacer({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton-secundario" style={{ width: "100%" }} disabled={pending}>
      {pending ? "…" : texto}
    </button>
  );
}
