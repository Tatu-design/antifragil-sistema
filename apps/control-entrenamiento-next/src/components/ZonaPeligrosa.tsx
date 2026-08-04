"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { accionBorrarCliente, type Resultado } from "@/app/actions";
import { Aviso } from "./Aviso";

const euros = (v: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(v);

/**
 * Dar de baja a un cliente.
 *
 * Va plegado, al final, y pide escribir BORRAR: no es algo que se pulse sin
 * querer. Antes de tocar nada dice **cuántas sesiones y cuánto dinero** se van
 * a retirar, con números concretos — la misma regla que el resto de escrituras
 * del proyecto.
 *
 * Si el cliente ya ha entrenado, casi siempre lo correcto es **cancelarlo**,
 * que conserva su historial. Por eso se dice aquí mismo.
 */
export function ZonaPeligrosa({
  clienteId,
  nombre,
  sesiones,
  importe,
}: {
  clienteId: string;
  nombre: string;
  sesiones: number;
  importe: number;
}) {
  const [resultado, accion] = useActionState<Resultado | null, FormData>(accionBorrarCliente, null);
  const [abierto, setAbierto] = useState(false);

  return (
    <section className="tarjeta flex flex-col gap-3" aria-label="Dar de baja">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="text-left text-sm font-medium text-tinta-suave hover:text-red-600"
      >
        Dar de baja {abierto ? "▴" : "▾"}
      </button>

      {abierto && (
        <>
          {sesiones > 0 ? (
            <p className="rounded-tarjeta border border-aviso/30 bg-aviso/10 px-3 py-2 text-sm text-aviso">
              «{nombre}» tiene <strong>{sesiones} sesiones</strong> firmadas. Borrarlo retirará también{" "}
              <strong>{euros(importe)}</strong> de la facturación.
              <br />
              Si simplemente ha dejado de entrenar, lo correcto es <strong>cancelarlo</strong> en «Editar
              datos»: conserva su historial y su economía.
            </p>
          ) : (
            <p className="text-sm text-tinta-suave">
              «{nombre}» no tiene ninguna sesión firmada. Borrarlo no afecta a la economía.
            </p>
          )}

          <form action={accion} className="flex flex-col gap-2">
            <input type="hidden" name="clienteId" value={clienteId} />
            <label className="etiqueta" htmlFor="confirmacion">
              Escribe BORRAR para confirmar
            </label>
            <input id="confirmacion" name="confirmacion" autoComplete="off" className="campo" />
            <Boton />
          </form>
          <Aviso resultado={resultado} />
        </>
      )}
    </section>
  );
}

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-[48px] w-full rounded-tarjeta border border-red-300 bg-red-50 text-base font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-60"
    >
      {pending ? "Borrando…" : "Borrar este cliente y su historial"}
    </button>
  );
}
