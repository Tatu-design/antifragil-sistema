/**
 * CrossFit Lidomare y CrossFit Kids como cuentas de actividad (2026-08-08).
 *
 * Fernando las gestiona desde la lista de clientes, igual que entra en un
 * cliente de PT para firmarle su sesión. Pero **no son clientes**: no tienen
 * bono, ni pendiente de pago, ni estado, ni enlace público. Por dentro siguen
 * viviendo en `clases_grupo`, que es su sitio y su única fuente de verdad.
 *
 * LAS DOS SE PARECEN POR FUERA Y SE COBRAN MUY DISTINTO
 *
 * **Lidomare** es una cuenta de actividad pura: cada clase son 15 € y una
 * hora. Sin tope, sin renovación, sin deuda. Un mes 4 clases y otro 6.
 *
 * **Kids** se factura al final: Fernando no sabe cuánto cobrará hasta que
 * acaba el mes. Las 8 clases mensuales son una REFERENCIA, no un límite —
 * si un mes salen 9, se firman las 9 y se enseña «9 de 8». El precio por
 * hora se calcula al final dividiendo lo cobrado entre las clases reales.
 *
 * Aquí no se consulta nada: entran números y salen números.
 */

import { redondear } from "./modalidades";
import { TARIFA_LIDOMARE, type TipoClase } from "./economia";

/** Clases al mes que Fernando espera dar de Kids. Referencia, no tope. */
export const REFERENCIA_KIDS = 8;

export const NOMBRES_CLASE: Record<TipoClase, string> = {
  lidomare: "CrossFit Lidomare",
  kids: "CrossFit Kids",
};

export interface ClaseDelHistorial {
  id: string;
  fecha: string;
}

/** Todo lo que la tarjeta y la ficha de una cuenta necesitan enseñar. */
export interface FichaClase {
  tipo: TipoClase;
  nombre: string;
  anio: number;
  mes: number;
  /** Clases dadas este mes. */
  sesiones: number;
  /** Solo Kids: cuántas se esperan al mes. `null` en Lidomare. */
  referencia: number | null;
  /** Solo Kids: cuántas faltan para la referencia. Nunca negativo. */
  restantes: number | null;
  /** Solo Kids: 0-100 para la barra. `null` en Lidomare, que no tiene tope. */
  porcentaje: number | null;
  /** Solo Lidomare: lo que cuesta cada clase. `null` en Kids. */
  tarifa: number | null;
  /** Lo facturado este mes. `null` en Kids mientras no se sepa. */
  facturacion: number | null;
  /** Kids con clases dadas pero sin importe introducido todavía. */
  facturacionPendiente: boolean;
  /** Lo que ha salido cada hora. `null` si aún no se puede saber. */
  precioHora: number | null;
}

/**
 * La ficha de CrossFit Lidomare de un mes.
 *
 * Sin tope ni referencia: se enseñan las clases dadas y lo que suman, y ya.
 */
export function fichaLidomare(anio: number, mes: number, sesiones: number): FichaClase {
  const facturacion = redondear(sesiones * TARIFA_LIDOMARE);
  return {
    tipo: "lidomare",
    nombre: NOMBRES_CLASE.lidomare,
    anio,
    mes,
    sesiones,
    referencia: null,
    restantes: null,
    porcentaje: null,
    tarifa: TARIFA_LIDOMARE,
    facturacion,
    facturacionPendiente: false,
    // Es fija por definición, pero se devuelve calculada para que la ficha
    // no tenga que saberlo.
    precioHora: sesiones > 0 ? redondear(facturacion / sesiones) : TARIFA_LIDOMARE,
  };
}

/**
 * La ficha de CrossFit Kids de un mes.
 *
 * `facturacion` es lo que Fernando haya introducido para ese mes, o `null` si
 * todavía no lo sabe. Mientras no lo sepa, el precio por hora tampoco se
 * puede calcular: se devuelve `null` en vez de inventar un número.
 *
 * Superar la referencia es normal y no se corrige: 9 clases de 8 son 9 de 8,
 * con 0 restantes y la barra llena.
 */
export function fichaKids(
  anio: number,
  mes: number,
  sesiones: number,
  facturacion: number | null,
): FichaClase {
  return {
    tipo: "kids",
    nombre: NOMBRES_CLASE.kids,
    anio,
    mes,
    sesiones,
    referencia: REFERENCIA_KIDS,
    restantes: Math.max(REFERENCIA_KIDS - sesiones, 0),
    porcentaje: Math.min(Math.round((sesiones / REFERENCIA_KIDS) * 100), 100),
    tarifa: null,
    facturacion,
    facturacionPendiente: sesiones > 0 && facturacion === null,
    precioHora: facturacion !== null && sesiones > 0 ? redondear(facturacion / sesiones) : null,
  };
}

/**
 * Lo que costaría cada clase si se guardara este importe. Para enseñarlo en
 * la pantalla de confirmación ANTES de guardar.
 */
export function precioResultante(importe: number, sesiones: number): number | null {
  if (sesiones <= 0) return null;
  return redondear(importe / sesiones);
}

/**
 * Por qué no se puede registrar la facturación de un mes, si es que no se
 * puede. Devuelve `null` cuando sí se puede.
 *
 * Sin clases no hay nada entre lo que repartir el dinero, y guardarlo dejaría
 * un importe suelto que no se podría convertir en precio por hora.
 */
export function motivoParaNoFacturar(sesiones: number, importe: number): string | null {
  if (sesiones <= 0) {
    return "Este mes no hay ninguna clase de CrossFit Kids registrada todavía, así que no hay entre qué repartir la facturación.";
  }
  if (!Number.isFinite(importe) || importe < 0) {
    return "La facturación tiene que ser un número igual o mayor que cero.";
  }
  return null;
}
