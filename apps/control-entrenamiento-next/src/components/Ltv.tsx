import type { Ltv as ValorLtv } from "@/domain/ltv";
import { eurosRedondos } from "@/lib/formato";

/**
 * El valor económico acumulado del cliente, para el profesional.
 *
 * **Solo se pinta en la ficha interna.** El perfil público del cliente
 * (`/mi/<token>`) no recibe este dato: `obtenerPerfilPublico` ni lo calcula.
 * Que un cliente vea cuánto lleva gastado no aporta nada y puede incomodar.
 *
 * Es deliberadamente pequeño. La ficha tiene una jerarquía —nombre y estado,
 * servicio actual, firmar sesión— y el LTV va por debajo de las tres: se
 * consulta de vez en cuando, no se usa cada día. Por eso va DESPUÉS del botón
 * de firmar, junto a las acciones secundarias, y no entre el servicio y el
 * botón: ahí lo empujaría hacia abajo sin ganar nada.
 *
 * No cambia de aspecto según el estado de pago ni el del cliente. Es historia
 * acumulada: marcar un cobro no la mueve, y pausar a alguien tampoco.
 *
 * El desglose por modalidad ya viene calculado en `ltv`, pero todavía no se
 * enseña. Primero validar que el total cuadra (Fernando, 2026-08-09).
 */
export function Ltv({ ltv }: { ltv: ValorLtv }) {
  return (
    <section className="ltv">
      {/* «LTV» es una sigla, así que la explicación va debajo como texto real,
          no como un `title` que en un móvil no se puede ver. */}
      <span className="ltv-etiqueta">LTV</span>
      <span className="ltv-valor">{eurosRedondos(ltv.total)}</span>
      <span className="ltv-nota">Valor acumulado</span>
    </section>
  );
}
