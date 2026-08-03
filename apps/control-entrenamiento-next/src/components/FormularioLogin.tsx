"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { accionEntrar, type Resultado } from "@/app/actions";
import { Aviso } from "./Aviso";

function BotonEntrar() {
  // `pending` viene del propio formulario: el botón se desactiva mientras la
  // petición está en marcha, así un doble toque no manda dos peticiones.
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton" disabled={pending}>
      {pending ? "Entrando…" : "Entrar"}
    </button>
  );
}

export function FormularioLogin() {
  const [resultado, accion] = useActionState<Resultado | null, FormData>(accionEntrar, null);

  return (
    <form action={accion} className="tarjeta flex flex-col gap-3">
      <div>
        <label className="etiqueta" htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          className="campo"
        />
      </div>
      <Aviso resultado={resultado} />
      <BotonEntrar />
    </form>
  );
}
