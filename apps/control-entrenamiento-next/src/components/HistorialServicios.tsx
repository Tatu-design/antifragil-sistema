"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { accionBorrarSesion, accionMarcarCobro, type Resultado } from "@/app/actions";
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

  return (
    <section className="flex flex-col gap-2" aria-label="Historial de servicios">
      <h2 className="text-lg font-medium">Historial de servicios</h2>
      <Aviso resultado={resultado} />
      <Aviso resultado={resultadoBorrado} />

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
                    className="flex items-center justify-between gap-2 border-t border-borde pt-2 text-sm"
                  >
                    <span className="tabular-nums">
                      <strong className="font-medium">#{sesion.numeroSesion}</strong> · {fechaEs(sesion.fecha)}
                      {sesion.hora ? ` · ${sesion.hora}` : ""}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-tinta-suave tabular-nums">
                        {sesion.tarifa === null ? "incluida" : euros(sesion.tarifa)}
                      </span>
                      <form action={accionBorrar}>
                        <input type="hidden" name="clienteId" value={clienteId} />
                        <input type="hidden" name="sesionId" value={sesion.id} />
                        <BotonBorrar />
                      </form>
                    </span>
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
