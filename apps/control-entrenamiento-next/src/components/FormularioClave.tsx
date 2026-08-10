"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { accionCambiarClave } from "@/app/actions";

/**
 * Cambiar la propia contraseña.
 *
 * Existe porque una contraseña temporal que no se puede cambiar no es
 * temporal (2026-08-10). Rafa entró con una que le pasó Fernando por escrito,
 * y hasta hoy no había ninguna pantalla para estrenar la suya.
 *
 * Tres campos y ya. Nada de preguntas de seguridad ni de recuperación por
 * correo: si alguien pierde la contraseña, se la repone Fernando con el
 * comando de alta, que también sirve para eso.
 */
export function FormularioClave({ correo }: { correo: string }) {
  const [resultado, enviar] = useActionState(accionCambiarClave, null);

  return (
    <>
      <h1>Mi contraseña</h1>
      <p className="subtitulo">
        Estás dentro como <strong>{correo}</strong>.
      </p>

      {resultado && (
        <div className={resultado.ok ? "aviso-guardado" : "aviso-error"}>
          {resultado.ok ? "✔ " : ""}
          {resultado.mensaje}
        </div>
      )}

      <form className="formulario" action={enviar}>
        <label className="campo">
          <span>Contraseña actual</span>
          <input
            type="password"
            name="actual"
            required
            autoComplete="current-password"
            // El teclado del móvil no debe corregir ni poner mayúscula.
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>

        <label className="campo">
          <span>Contraseña nueva</span>
          <input
            type="password"
            name="nueva"
            required
            minLength={8}
            autoComplete="new-password"
            autoCapitalize="off"
            autoCorrect="off"
          />
          <span className="meta">Al menos 8 caracteres.</span>
        </label>

        <label className="campo">
          <span>Repite la contraseña nueva</span>
          <input
            type="password"
            name="repetir"
            required
            minLength={8}
            autoComplete="new-password"
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>

        <Guardar />
      </form>

      <p className="meta">
        Si alguna vez la pierdes, pídesela a Fernando: puede ponerte una nueva. No hay recuperación por
        correo.
      </p>
    </>
  );
}

function Guardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton" disabled={pending}>
      {pending ? "Guardando…" : "Cambiar contraseña"}
    </button>
  );
}
