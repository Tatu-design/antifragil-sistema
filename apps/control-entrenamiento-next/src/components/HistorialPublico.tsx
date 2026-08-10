"use client";

import { useState } from "react";

import type { SesionPublica } from "@/services/publico";
import { fechaEs } from "@/lib/formato";
import { Icono } from "./Iconos";

/**
 * El historial de sesiones del cliente, en su enlace personal.
 *
 * **Plegado por defecto** (Fernando, 2026-08-10), como el de la ficha interna.
 * Con dieciséis sesiones, la lista entera empujaba hacia abajo lo que el
 * cliente abre a mirar: cuántas lleva y cuántas le quedan.
 *
 * **Solo fecha y hora.** Antes cada línea decía también el nombre del servicio
 * y el número de sesión — y el nombre del servicio lleva dentro el precio
 * («Antiguo 35€ x16»), así que el cliente estaba viendo su tarifa en cada
 * línea del historial sin que nadie lo hubiera decidido. El número sigue en su
 * círculo, que es donde se lee de un vistazo.
 *
 * Recibe `SesionPublica`, no `Sesion`: la tarifa y el nombre del servicio se
 * quedan en el servidor. Dejar de pintarlos no bastaba —Next incrusta en la
 * página lo que recibe el navegador— y se veían en el código fuente.
 */
export function HistorialPublico({ sesiones }: { sesiones: SesionPublica[] }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <div className="lista">
      <button
        type="button"
        className="cabecera-seccion cabecera-plegable"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
      >
        <span>
          Historial de sesiones {sesiones.length > 0 && `· ${sesiones.length}`}
        </span>
        <Icono nombre={abierto ? "i-chevron-down" : "i-chevron-right"} pequeno />
      </button>

      {abierto &&
        (sesiones.length === 0 ? (
          <p className="empty">Todavía no hay sesiones registradas con fecha.</p>
        ) : (
          sesiones.map((sesion) => (
            <div className="fila" key={sesion.id}>
              <div className="sesion-fila">
                <div className="sesion-badge">{sesion.numeroSesion}</div>
                <div className="sesion-info">
                  <div className="fecha">{fechaEs(sesion.fecha)}</div>
                  {sesion.hora && <div className="tipo">{sesion.hora}</div>}
                </div>
              </div>
            </div>
          ))
        ))}
    </div>
  );
}
