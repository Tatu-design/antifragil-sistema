"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import { accionMarcarCobro } from "@/app/actions";
import { ETIQUETAS } from "@/domain/modalidades";
import type { Ciclo, Sesion } from "@/domain/tipos";
import { euros, fechaEs, mesEs } from "@/lib/formato";
import { Icono } from "./Iconos";

type Servicio = Ciclo & { sesiones: Sesion[]; esActual: boolean };

/**
 * Historial plegado y agrupado por SERVICIO contratado, igual que la sección
 * `.lista.historial` de `webapp/templates/perfil_cliente.html`.
 *
 * Agrupa por ciclo, no por nombre: tres bonos iguales seguidos son tres bonos,
 * no uno de 24 sesiones.
 */
export function HistorialProgramas({
  clienteId,
  nombre,
  servicios,
  verImportes = true,
}: {
  clienteId: string;
  nombre: string;
  servicios: Servicio[];
  /** El entrenador ve el historial de sesiones, no el tarifario. */
  verImportes?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [abiertos, setAbiertos] = useState<number[]>([]);

  const alternar = (ciclo: number) =>
    setAbiertos((previos) =>
      previos.includes(ciclo) ? previos.filter((c) => c !== ciclo) : [...previos, ciclo],
    );

  return (
    <div className="lista historial">
      <button
        type="button"
        className="cabecera-seccion plegable"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
      >
        <span>Historial de programas · {servicios.length}</span>
        <Icono nombre="i-chevron-right" pequeno clase="flecha-plegable" />
      </button>

      <div hidden={!abierto}>
        {servicios.length === 0 && <p className="empty">Todavía no hay ningún programa registrado.</p>}

        {servicios.map((servicio) => (
          <div className="fila" key={servicio.ciclo}>
            <button
              type="button"
              className="bono-cabecera plegable"
              aria-expanded={abiertos.includes(servicio.ciclo)}
              onClick={() => alternar(servicio.ciclo)}
            >
              <span className="bono-info">
                <span className="nombre">
                  {servicio.esActual ? "Servicio actual" : servicio.servicio}{" "}
                  {servicio.pagado
                    ? <span className="pill aldia">Pagado</span>
                    : <span className="pill pendiente">Pendiente de pago</span>}
                </span>
                <span className="programa">
                  {servicio.esActual ? `${servicio.servicio} · ` : ""}
                  {ETIQUETAS[servicio.modalidad]}
                  {servicio.mes ? ` · ${mesEs(servicio.mes)} ${servicio.anio}` : ""}
                </span>
                {/* La fotografía de las condiciones con las que se hizo ese
                    ciclo. Cambiar las condiciones de hoy no toca esto. */}
                <span className="programa">{condiciones(servicio, verImportes)}</span>
                <span className="programa">
                  {servicio.fechaInicio ? `Desde ${fechaEs(servicio.fechaInicio)}` : "Sin sesiones todavía"}
                  {servicio.fechaFin ? ` — ${fechaEs(servicio.fechaFin)} · Cerrado` : ""}
                </span>
              </span>
              <Icono nombre="i-chevron-right" pequeno clase="flecha-plegable" />
            </button>

            <div className="bono-sesiones" hidden={!abiertos.includes(servicio.ciclo)}>
              {/* Estado de cobro de ESTE servicio, se pueda o no seguir usando.
                  Vale también para los ya cerrados: un bono agotado o un mes
                  terminado se cobran después. */}
              <form
                action={accionMarcarCobro}
                className="cobro-ciclo"
                onSubmit={(evento) => {
                  const pregunta = servicio.pagado
                    ? `¿Volver a dejar este servicio de ${nombre} como pendiente de pago?`
                    : `¿Marcar como pagado este servicio de ${nombre}?`;
                  if (!confirm(pregunta)) evento.preventDefault();
                }}
              >
                <input type="hidden" name="clienteId" value={clienteId} />
                <input type="hidden" name="ciclo" value={servicio.ciclo} />
                <input type="hidden" name="pagado" value={servicio.pagado ? "no" : "si"} />
                <span className="cobro-etiqueta">{servicio.pagado ? "Pagado" : "Pendiente de pago"}</span>
                <BotonCobro pagado={servicio.pagado} />
              </form>

              {servicio.sesiones.length === 0 ? (
                <p className="empty">Este programa todavía no tiene sesiones firmadas.</p>
              ) : (
                servicio.sesiones.map((sesion) => (
                  <div className="sesion-fila" key={sesion.id}>
                    <div className="sesion-badge">{sesion.numeroSesion}</div>
                    <div className="sesion-info" style={{ flex: 1 }}>
                      <div className="fecha">Sesión {sesion.numeroSesion}</div>
                      <div className="tipo">
                        {fechaEs(sesion.fecha)}
                        {sesion.hora ? ` · ${sesion.hora}` : ""}
                      </div>
                    </div>
                    <Link className="editar" href={`/clientes/${clienteId}/sesion/${sesion.id}`}>
                      Editar
                    </Link>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * La misma línea de condiciones que arma la plantilla, según la modalidad.
 *
 * Sin `verImportes` dice lo mismo pero sin cifras: cuántas sesiones lleva ese
 * servicio y poco más. Un entrenador necesita saber en qué punto va su
 * cliente, no cuánto paga.
 */
function condiciones(servicio: Servicio, verImportes: boolean): string {
  const n = servicio.sesiones.length;
  const sesiones = `${n} ${n === 1 ? "sesión" : "sesiones"}`;

  if (!verImportes) {
    if (servicio.modalidad === "bono" && servicio.sesionesTotales) {
      return `${n} de ${servicio.sesionesTotales} sesiones`;
    }
    return sesiones;
  }

  if (servicio.modalidad === "mensualidad") {
    const efectivo = n && servicio.cuotaMensual ? ` · ${euros(servicio.cuotaMensual / n)}/h` : "";
    const referencia = servicio.sesionesReferencia ? ` · ref. ${servicio.sesionesReferencia}` : "";
    return `Cuota ${euros(servicio.cuotaMensual)} · ${sesiones}${efectivo}${referencia}`;
  }
  if (servicio.modalidad === "cuenta") {
    const total = euros((servicio.tarifa ?? 0) * n);
    return `${euros(servicio.tarifa)}/sesión · ${sesiones} · total ${total}`;
  }
  const precio = servicio.precioTotal ? ` · ${euros(servicio.precioTotal)}` : "";
  const porSesion = servicio.tarifa ? ` · ${euros(servicio.tarifa)}/sesión` : "";
  return `${n} de ${servicio.sesionesTotales} sesiones${precio}${porSesion}`;
}

function BotonCobro({ pagado }: { pagado: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="boton-secundario boton-cobro" disabled={pending}>
      {pending ? "Guardando…" : pagado ? "Marcar pendiente" : "Marcar pagado"}
    </button>
  );
}
