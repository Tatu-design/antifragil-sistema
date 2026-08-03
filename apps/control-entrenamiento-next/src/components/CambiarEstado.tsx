"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { accionCambiarEstado, accionRenombrar, type Resultado } from "@/app/actions";
import { ESTADOS, type Estado } from "@/domain/tipos";
import { Aviso } from "./Aviso";

function Guardar({ texto = "Guardar" }: { texto?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton-suave" disabled={pending}>
      {pending ? "Guardando…" : texto}
    </button>
  );
}

/**
 * Editar los datos del cliente: quién es y en qué estado está.
 *
 * Va plegado porque es una acción poco frecuente y no debe competir con el
 * botón de firmar, que es lo que Fernando usa cada día.
 */
export function CambiarEstado({
  clienteId,
  estado,
  nombre,
}: {
  clienteId: string;
  estado: Estado;
  nombre: string;
}) {
  const [resEstado, accionEstado] = useActionState<Resultado | null, FormData>(accionCambiarEstado, null);
  const [resNombre, accionNombre] = useActionState<Resultado | null, FormData>(accionRenombrar, null);
  const [abierto, setAbierto] = useState(false);

  return (
    <section className="tarjeta flex flex-col gap-3" aria-label="Editar datos del cliente">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="text-left text-sm font-medium hover:text-acento"
      >
        Editar datos {abierto ? "▴" : "▾"}
      </button>

      {abierto && (
        <>
          <form action={accionNombre} className="flex flex-col gap-2">
            <input type="hidden" name="clienteId" value={clienteId} />
            <div>
              <label className="etiqueta" htmlFor="nombre">
                Nombre
              </label>
              <input id="nombre" name="nombre" defaultValue={nombre} required maxLength={80} className="campo" />
            </div>
            <p className="text-xs text-tinta-suave">
              Cambiar el nombre no toca su historial ni su enlace personal.
            </p>
            <Guardar texto="Guardar nombre" />
          </form>
          <Aviso resultado={resNombre} />

          <form action={accionEstado} className="flex flex-col gap-2 border-t border-borde pt-3">
            <input type="hidden" name="clienteId" value={clienteId} />
            <div>
              <label className="etiqueta" htmlFor="estado">
                Estado
              </label>
              <select id="estado" name="estado" defaultValue={estado} className="campo">
                {ESTADOS.map((valor) => (
                  <option key={valor} value={valor}>
                    {valor[0]!.toUpperCase() + valor.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-tinta-suave">
              Pausar o cancelar conserva ficha, historial, economía y deuda. Volver a «activo» lo
              reactiva tal y como estaba.
            </p>
            <Guardar texto="Guardar estado" />
          </form>
          <Aviso resultado={resEstado} />
        </>
      )}
    </section>
  );
}
