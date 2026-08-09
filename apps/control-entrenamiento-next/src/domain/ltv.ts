/**
 * Cuánto valor económico ha generado un cliente desde que empezó.
 *
 * Es una métrica del profesional, no del cliente: contesta a «¿cuánto ha
 * supuesto esta persona para el negocio?» sin tener que entrar en Economía.
 *
 * QUÉ CUENTA Y POR QUÉ (decisión importante, 2026-08-09)
 *
 * Se cuenta exactamente lo mismo que cuenta Economía, ni un euro más:
 *
 *   - Bono y cuenta de cliente → el importe de CADA SESIÓN FIRMADA.
 *   - Mensualidad             → la CUOTA de cada mes cobrada.
 *
 * Es decir, valor ya producido. Un bono de 16 sesiones a 45 € con 6 firmadas
 * aporta 270 €, no 720: las diez que faltan todavía no se han dado, y podrían
 * no darse nunca —el cliente se va, se pausa, se cambia de modalidad—.
 *
 * La consecuencia buena de elegirlo así: **sumar el LTV de todos los clientes
 * da la facturación histórica de la app**. Si en vez de eso se contara el bono
 * entero al contratarlo, el LTV diría una cifra y Economía otra distinta, y no
 * habría forma de saber cuál de las dos está mal.
 *
 * Y lo que NO cambia el LTV: que un servicio esté pagado o pendiente. Eso es
 * el otro eje —dinero cobrado— y tiene su propia etiqueta en la ficha. El LTV
 * es historia acumulada: no sube ni baja al marcar un cobro.
 */

import type { Modalidad } from "./modalidades";

export interface Ltv {
  /** Lo que se enseña: la suma de todo. */
  total: number;
  /** El desglose se calcula, pero todavía no se enseña (así lo pidió
   *  Fernando: primero validar que el total es correcto). */
  bonos: number;
  mensualidades: number;
  cuentas: number;
}

interface Entradas {
  /** Los ciclos del cliente, para saber de qué modalidad era cada sesión. */
  ciclos: Array<{ ciclo: number; modalidad: Modalidad }>;
  /** Todas sus sesiones, de todos los ciclos. */
  sesiones: Array<{ ciclo: number; tarifa: number | null }>;
  /** Sus cuotas mensuales. Solo las tienen las mensualidades. */
  cargos: Array<{ importe: number }>;
}

/**
 * Los céntimos, sumados sin que se escapen.
 *
 * Sumar decimales en coma flotante arrastra restos (0,1 + 0,2 = 0,30000000004),
 * y con muchas sesiones eso acaba viéndose. Se suma en céntimos enteros y se
 * divide al final, que es como se cuenta el dinero.
 */
function sumar(importes: number[]): number {
  return importes.reduce((total, importe) => total + Math.round(importe * 100), 0) / 100;
}

export function calcularLtv({ ciclos, sesiones, cargos }: Entradas): Ltv {
  const modalidadDe = new Map(ciclos.map((c) => [c.ciclo, c.modalidad]));

  const porModalidad = (buscada: Modalidad) =>
    sumar(
      sesiones
        .filter((s) => modalidadDe.get(s.ciclo) === buscada)
        .map((s) => s.tarifa ?? 0),
    );

  // Las sesiones de una mensualidad no llevan importe a propósito: su dinero
  // es la cuota del mes, que ya está en `cargos`. Sumar ambas cosas sería
  // cobrar dos veces al mismo cliente.
  const bonos = porModalidad("bono");
  const cuentas = porModalidad("cuenta");
  const mensualidades = sumar(cargos.map((c) => c.importe));

  return {
    total: sumar([bonos, cuentas, mensualidades]),
    bonos,
    cuentas,
    mensualidades,
  };
}
