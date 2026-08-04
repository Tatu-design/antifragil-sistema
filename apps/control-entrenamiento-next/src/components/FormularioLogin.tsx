"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { accionEntrar, accionEntrarClaveUnica, type Resultado } from "@/app/actions";
import { Aviso } from "./Aviso";

function BotonEntrar({ texto = "Entrar" }: { texto?: string }) {
  // El botón se apaga mientras la petición está en marcha: un doble toque no
  // manda dos veces.
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton" disabled={pending}>
      {pending ? "Entrando…" : texto}
    </button>
  );
}

/**
 * Entrar con la cuenta de Supabase.
 *
 * La puerta de emergencia con contraseña única solo se ofrece si el servidor
 * dice que está encendida, y nunca es la opción principal.
 */
export function FormularioLogin({ conClaveUnica }: { conClaveUnica: boolean }) {
  const [resultado, accion] = useActionState<Resultado | null, FormData>(accionEntrar, null);
  const [resRespaldo, accionRespaldo] = useActionState<Resultado | null, FormData>(
    accionEntrarClaveUnica,
    null,
  );
  const [verRespaldo, setVerRespaldo] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <form action={accion} className="tarjeta flex flex-col gap-3">
        <div>
          <label className="etiqueta" htmlFor="correo">
            Correo
          </label>
          <input
            id="correo"
            name="correo"
            type="email"
            autoComplete="username"
            required
            autoFocus
            className="campo"
          />
        </div>
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
            className="campo"
          />
        </div>
        <Aviso resultado={resultado} />
        <BotonEntrar />
      </form>

      {conClaveUnica && (
        <>
          <button
            type="button"
            onClick={() => setVerRespaldo((v) => !v)}
            aria-expanded={verRespaldo}
            className="text-center text-xs text-tinta-suave underline hover:text-acento"
          >
            Entrar con la contraseña de pruebas
          </button>
          {verRespaldo && (
            <form action={accionRespaldo} className="tarjeta flex flex-col gap-3">
              <p className="text-xs text-tinta-suave">
                Solo para el entorno de pruebas. No identifica a nadie y no debe usarse con datos
                reales.
              </p>
              <input
                name="password"
                type="password"
                placeholder="Contraseña de pruebas"
                required
                className="campo"
              />
              <Aviso resultado={resRespaldo} />
              <BotonEntrar texto="Entrar en pruebas" />
            </form>
          )}
        </>
      )}
    </div>
  );
}
