"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  accionBorrarSesion,
  accionEditarSesion,
  accionMarcarCobro,
  type Resultado,
} from "@/app/actions";
import type { Ciclo, Sesion } from "@/domain/tipos";
import { ETIQUETAS } from "@/domain/modalidades";
import { fechaEs, nombreMes } from "@/lib/fechas";
import { Aviso } from "./Aviso";

type Servicio = Ciclo & { sesiones: Sesion[]; esActual: boolean };

const euros = (valor: number | null) =>
  valor === null ? "—" : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(valor);

/**
 * El historial, agrupado por SERVICIO contratado y no por nombre de programa:
 * tres bonos iguales seguidos son tres bonos, no uno de 24 sesiones.
 * Va plegado, porque lo habitual es no necesitarlo.
 */
export function HistorialServicios({
  clienteId,
  servicios,
}: {
  clienteId: string;
  servicios: Servicio[];
}) {
  const [resultado, accion] = useActionState<Resultado | null, FormData>(accionMarcarCobro, null);
  const [resultadoBorrado, accionBorrar] = useActionState<Resultado | null, FormData>(
    accionBorrarSesion,
    null,
  );
  const [resEditar, accionEditar] = useActionState<Resultado | null, FormData>(accionEditarSesion, null);
  const [editando, setEditando] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-2" aria-label="Historial de servicios">
      <h2 className="text-lg font-medium">Historial de servicios</h2>
      <Aviso resultado={resultado} />
      <Aviso resultado={resultadoBorrado} />
      <Aviso resultado={resEditar} />

      {servicios.map((servicio) => (
        <details key={servicio.ciclo} className="tarjeta" open={servicio.esActual}>
          <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm font-medium">
            <span>
              {servicio.servicio}
              {servicio.anio && servicio.mes ? ` · ${nombreMes(servicio.mes)} ${servicio.anio}` : ""}
            </span>
            <span className="text-xs font-normal text-tinta-suave">
              {servicio.sesiones.length} {servicio.sesiones.length === 1 ? "sesión" : "sesiones"}
            </span>
          </summary>

          <div className="mt-3 flex flex-col gap-3">
            <p className="text-xs text-tinta-suave">
              {ETIQUETAS[servicio.modalidad]}
              {servicio.tarifa !== null && ` · ${euros(servicio.tarifa)} por sesión`}
              {servicio.cuotaMensual !== null && ` · cuota ${euros(servicio.cuotaMensual)}`}
              {servicio.esActual ? " · servicio actual" : ""}
            </p>

            {/* El control de cobro va aquí dentro y no en la cabecera: esa
                cabecera ya es un botón y no puede contener otro. */}
            <form action={accion} className="flex items-center gap-2">
              <input type="hidden" name="clienteId" value={clienteId} />
              <input type="hidden" name="ciclo" value={servicio.ciclo} />
              <input type="hidden" name="pagado" value={servicio.pagado ? "no" : "si"} />
              <span
                className={`rounded-full px-2 py-1 text-xs ${
                  servicio.pagado === null
                    ? "bg-borde text-tinta-suave"
                    : servicio.pagado
                      ? "bg-acento/10 text-acento-oscuro"
                      : "bg-aviso/10 text-aviso"
                }`}
              >
                {/* `null` = nunca se registró. No es «sin pagar». */}
                {servicio.pagado === null ? "Sin marcar" : servicio.pagado ? "Cobrado" : "Pendiente de cobro"}
              </span>
              <BotonCobro pagado={servicio.pagado} />
            </form>

            {servicio.sesiones.length === 0 ? (
              <p className="text-sm text-tinta-suave">Todavía sin sesiones firmadas.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {servicio.sesiones.map((sesion) => (
                  <li
                    key={sesion.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-borde pt-2 text-sm"
                  >
                    <span className="tabular-nums">
                      <strong className="font-medium">#{sesion.numeroSesion}</strong> · {fechaEs(sesion.fecha)}
                      {sesion.hora ? ` · ${sesion.hora}` : ""}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-tinta-suave tabular-nums">
                        {sesion.tarifa === null ? "incluida" : euros(sesion.tarifa)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditando(editando === sesion.id ? null : sesion.id)}
                        aria-expanded={editando === sesion.id}
                        className="rounded px-2 py-1 text-xs text-tinta-suave transition hover:text-acento"
                      >
                        Editar
                      </button>
                      <form action={accionBorrar}>
                        <input type="hidden" name="clienteId" value={clienteId} />
                        <input type="hidden" name="sesionId" value={sesion.id} />
                        <BotonBorrar />
                      </form>
                    </span>
                    {editando === sesion.id && <CorregirSesion clienteId={clienteId} sesion={sesion} accion={accionEditar} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      ))}
    </section>
  );
}

function BotonCobro({ pagado }: { pagado: boolean | null }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-tarjeta border border-borde px-3 py-1 text-xs font-medium transition hover:border-acento hover:text-acento disabled:opacity-60"
    >
      {pending ? "Guardando…" : pagado ? "Marcar pendiente" : "Marcar cobrado"}
    </button>
  );
}

function BotonBorrar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded px-2 py-1 text-xs text-tinta-suave transition hover:text-red-600 disabled:opacity-60"
      aria-label="Borrar esta sesión"
    >
      {pending ? "…" : "Borrar"}
    </button>
  );
}

/**
 * Corregir la fecha o el número de una sesión ya guardada.
 *
 * Si la fecha la mueve a otra semana, su importe y su hora se trasladan con
 * ella — con el precio que tenía entonces, no con el de ahora.
 */
function CorregirSesion({
  clienteId,
  sesion,
  accion,
}: {
  clienteId: string;
  sesion: Sesion;
  accion: (datos: FormData) => void;
}) {
  return (
    <form action={accion} className="mt-2 flex w-full flex-col gap-2 border-t border-borde pt-2">
      <input type="hidden" name="clienteId" value={clienteId} />
      <input type="hidden" name="sesionId" value={sesion.id} />
      <div className="flex gap-2">
        <span className="flex-1">
          <label className="etiqueta" htmlFor={`fecha-${sesion.id}`}>
            Fecha
          </label>
          <input
            id={`fecha-${sesion.id}`}
            name="fecha"
            type="date"
            defaultValue={sesion.fecha}
            className="campo"
          />
        </span>
        <span className="w-24">
          <label className="etiqueta" htmlFor={`num-${sesion.id}`}>
            Número
          </label>
          <input
            id={`num-${sesion.id}`}
            name="numeroSesion"
            inputMode="numeric"
            defaultValue={sesion.numeroSesion}
            className="campo"
          />
        </span>
      </div>
      <p className="text-xs text-tinta-suave">
        Si la mueves a otra semana, su importe y su hora se trasladan con ella.
      </p>
      <BotonGuardar />
    </form>
  );
}

function BotonGuardar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-tarjeta border border-borde px-3 py-2 text-xs font-medium transition hover:border-acento hover:text-acento disabled:opacity-60"
    >
      {pending ? "Guardando…" : "Guardar corrección"}
    </button>
  );
}
