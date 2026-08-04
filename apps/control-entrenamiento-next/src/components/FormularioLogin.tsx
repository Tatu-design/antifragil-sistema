"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { accionEntrar, accionEntrarClaveUnica, type Resultado } from "@/app/actions";

function Boton({ texto = "Entrar" }: { texto?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton" disabled={pending}>
      {pending ? "Entrando…" : texto}
    </button>
  );
}

/** Mismo formulario que Flask, con un campo más: el correo. La contraseña
 *  compartida deja de ser el acceso, así que hace falta saber quién entra. */
export function FormularioLogin({ conClaveUnica }: { conClaveUnica: boolean }) {
  const [resultado, accion] = useActionState<Resultado | null, FormData>(accionEntrar, null);
  const [resRespaldo, accionRespaldo] = useActionState<Resultado | null, FormData>(
    accionEntrarClaveUnica,
    null,
  );
  const [verRespaldo, setVerRespaldo] = useState(false);

  return (
    <>
      {resultado && !resultado.ok && <div className="aviso-error">{resultado.mensaje}</div>}

      <form className="formulario" action={accion}>
        <label className="campo">
          <span>Correo</span>
          <input type="email" name="correo" autoComplete="username" required autoFocus />
        </label>
        <label className="campo">
          <span>Contraseña</span>
          <input type="password" name="password" autoComplete="current-password" required />
        </label>
        <Boton />
      </form>

      {conClaveUnica && (
        <>
          <button
            type="button"
            className="meta boton-texto"
            aria-expanded={verRespaldo}
            onClick={() => setVerRespaldo((v) => !v)}
          >
            Entrar con la contraseña de pruebas
          </button>
          {verRespaldo && (
            <form className="formulario" action={accionRespaldo}>
              {resRespaldo && !resRespaldo.ok && <div className="aviso-error">{resRespaldo.mensaje}</div>}
              <label className="campo">
                <span>Contraseña de pruebas</span>
                <input type="password" name="password" required />
              </label>
              <p className="meta">
                Solo para el entorno de pruebas. No identifica a nadie y no debe usarse con datos reales.
              </p>
              <Boton texto="Entrar en pruebas" />
            </form>
          )}
        </>
      )}
    </>
  );
}
