"use client";

import { useState } from "react";

import type { Ltv as ValorLtv } from "@/domain/ltv";
import { eurosRedondos } from "@/lib/formato";
import { Icono } from "./Iconos";

/**
 * El valor económico acumulado del cliente, para el administrador.
 *
 * **Tapado hasta que se pulsa** (Fernando, 2026-08-10). El motivo no es
 * estético: la sesión se firma con el cliente delante, mirando la pantalla, y
 * ahí no pinta nada una cifra que dice cuánto lleva gastado en el negocio.
 *
 * Y **discreto** (Fernando otra vez, el mismo día): la primera versión era una
 * tarjeta con su recuadro y su frase explicativa, y pesaba tanto como el
 * servicio del cliente. Ahora es una línea pequeña —la sigla y un ojo
 * tachado— que no compite con nada. Al pulsarla aparece la cifra en su sitio.
 *
 * Vuelve a taparse solo al recargar la ficha, así que el descuido no se queda
 * pegado a la pantalla.
 *
 * SOBRE LA SIGLA SOLA
 *
 * Visualmente solo pone «LTV», que a secas no explica nada. La explicación
 * («valor acumulado del cliente») viaja en el `aria-label`, así que quien use
 * un lector de pantalla la oye entera. Se sacrifica el texto a la vista, no la
 * información.
 *
 * **Solo lo ve el administrador.** El perfil público del cliente
 * (`/mi/<token>`) no recibe este dato: `obtenerPerfilPublico` ni lo calcula.
 * Y un entrenador tampoco: lo suyo es entrenar, no la contabilidad.
 *
 * El desglose por modalidad ya viene calculado en `ltv`, pero todavía no se
 * enseña. Primero validar que el total cuadra (Fernando, 2026-08-09).
 */
export function Ltv({ ltv }: { ltv: ValorLtv }) {
  const [visible, setVisible] = useState(false);

  return (
    <button
      type="button"
      className="ltv"
      onClick={() => setVisible((v) => !v)}
      aria-label={
        visible
          ? "Ocultar el valor acumulado del cliente"
          : "Ver el valor acumulado del cliente"
      }
      aria-pressed={visible}
    >
      <span className="ltv-etiqueta">LTV</span>
      {visible && <span className="ltv-valor">{eurosRedondos(ltv.total)}</span>}
      <Icono nombre={visible ? "i-eye" : "i-eye-off"} pequeno />
    </button>
  );
}
