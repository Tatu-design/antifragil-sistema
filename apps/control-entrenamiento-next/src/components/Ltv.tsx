"use client";

import { useState } from "react";

import type { Ltv as ValorLtv } from "@/domain/ltv";
import { eurosRedondos } from "@/lib/formato";

/**
 * El valor económico acumulado del cliente, para el administrador.
 *
 * **Tapado hasta que se pulsa** (Fernando, 2026-08-10). El motivo no es
 * estético: la sesión se firma con el cliente delante, mirando la pantalla, y
 * ahí no pinta nada una cifra que dice cuánto lleva gastado en el negocio.
 * Pulsar para verlo cuesta un gesto y evita esa situación por completo.
 *
 * Vuelve a taparse solo al recargar la ficha, así que el descuido no se
 * queda pegado a la pantalla.
 *
 * **Solo lo ve el administrador.** El perfil público del cliente
 * (`/mi/<token>`) no recibe este dato: `obtenerPerfilPublico` ni lo calcula.
 * Y un entrenador tampoco: lo suyo es entrenar, no la contabilidad del
 * negocio.
 *
 * Es deliberadamente pequeño. La ficha tiene una jerarquía —nombre y estado,
 * servicio actual, firmar sesión— y el LTV va por debajo de las tres: se
 * consulta de vez en cuando, no se usa cada día. Por eso va DESPUÉS del botón
 * de firmar, junto a las acciones secundarias.
 *
 * No cambia de aspecto según el estado de pago ni el del cliente. Es historia
 * acumulada: marcar un cobro no la mueve, y pausar a alguien tampoco.
 *
 * El desglose por modalidad ya viene calculado en `ltv`, pero todavía no se
 * enseña. Primero validar que el total cuadra (Fernando, 2026-08-09).
 */
export function Ltv({ ltv }: { ltv: ValorLtv }) {
  const [visible, setVisible] = useState(false);

  if (!visible) {
    return (
      <button type="button" className="ltv ltv-tapado" onClick={() => setVisible(true)}>
        {/* «LTV» es una sigla, así que la explicación va debajo como texto
            real, no como un `title` que en un móvil no se puede ver. */}
        <span className="ltv-etiqueta">LTV</span>
        <span className="ltv-oculto">Pulsa para ver el valor acumulado</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className="ltv"
      onClick={() => setVisible(false)}
      aria-label="Ocultar el valor acumulado"
    >
      <span className="ltv-etiqueta">LTV</span>
      <span className="ltv-valor">{eurosRedondos(ltv.total)}</span>
      <span className="ltv-nota">Valor acumulado · pulsa para ocultar</span>
    </button>
  );
}
