/**
 * Una pantalla, una fuente.
 *
 * Port de `servicios/modalidades.ficha_servicio()`. Antes la plantilla mezclaba
 * dos fuentes —los campos heredados del cliente y el ciclo en curso— y podían
 * contradecirse: el formulario guardaba bien el ciclo y la pantalla seguía
 * leyendo lo viejo. El resultado fue que el botón «Firmar sesión» desapareció
 * en dos de las tres modalidades sin que ninguna prueba lo viera.
 *
 * Aquí se construye UNA estructura con todo resuelto, y el componente pinta.
 */

import {
  BONO,
  CUENTA,
  ETIQUETAS,
  MENSUALIDAD,
  MODALIDAD_POR_DEFECTO,
  etiquetaPago,
  precioEfectivo,
  redondear,
} from "./modalidades";
import type { Ciclo, Estado, FichaServicio } from "./tipos";

/**
 * Qué le falta a un servicio para poder funcionar, en lenguaje llano.
 *
 * Vacío = está completo. Se usa para decidir si se puede firmar y, cuando no,
 * para decir exactamente qué hay que rellenar en vez de dejar una pantalla
 * muda.
 */
export function datosQueFaltan(ciclo: Ciclo | null): string[] {
  if (!ciclo) return ["el servicio del cliente"];
  const modalidad = ciclo.modalidad ?? MODALIDAD_POR_DEFECTO;
  const faltan: string[] = [];

  if (modalidad === BONO) {
    if (!ciclo.sesionesTotales) faltan.push("el número de sesiones del bono");
    if (!ciclo.tarifa && !ciclo.precioTotal) faltan.push("el precio del bono");
  } else if (modalidad === MENSUALIDAD) {
    if (!ciclo.cuotaMensual) faltan.push("la cuota mensual");
  } else if (!ciclo.tarifa) {
    faltan.push("el precio por sesión");
  }

  return faltan;
}

/**
 * ¿Se puede firmar una sesión de este cliente ahora mismo?
 *
 * Tres condiciones, y ninguna es «tener sesionesTotales» — ese era justamente
 * el error: una mensualidad y una cuenta valen 0 ahí porque no consumen saldo.
 */
export function puedeFirmarse(ciclo: Ciclo | null, estado: Estado): boolean {
  if (estado !== "activo") return false;
  if (!ciclo) return false;
  return datosQueFaltan(ciclo).length === 0;
}

export interface EntradaFicha {
  ciclo: Ciclo | null;
  /** Sesiones realmente firmadas en el ciclo en curso. */
  sesionesDelCiclo: number;
  /** El contador del bono, que Fernando puede corregir a mano. Manda en un
   *  bono porque es el que decide la renovación al firmar: si la ficha
   *  enseñara otro número, diría una cosa y pasaría otra. */
  sesionesCompletadas?: number | null;
  estado?: Estado;
  pendientePago?: boolean;
}

export function fichaServicio({
  ciclo,
  sesionesDelCiclo,
  sesionesCompletadas = null,
  estado = "activo",
  pendientePago = false,
}: EntradaFicha): FichaServicio {
  const modalidad = ciclo?.modalidad ?? MODALIDAD_POR_DEFECTO;
  const faltan = datosQueFaltan(ciclo);
  const hechas =
    modalidad === BONO && sesionesCompletadas !== null && sesionesCompletadas !== undefined
      ? sesionesCompletadas
      : sesionesDelCiclo;

  const base = {
    modalidad,
    etiqueta: ETIQUETAS[modalidad],
    servicio: ciclo?.servicio ?? null,
    ciclo: ciclo?.ciclo ?? null,
    anio: ciclo?.anio ?? null,
    mes: ciclo?.mes ?? null,
    tarifa: ciclo?.tarifa ?? null,
    precioTotal: ciclo?.precioTotal ?? null,
    cuotaMensual: ciclo?.cuotaMensual ?? null,
    sesionesReferencia: ciclo?.sesionesReferencia ?? null,
    sesionesHechas: hechas,
    pendientePago,
    etiquetaPago: etiquetaPago(modalidad, pendientePago),
    estado,
    faltan,
    completo: faltan.length === 0,
    puedeFirmar: puedeFirmarse(ciclo, estado),
  };

  if (modalidad === BONO) {
    const totales = ciclo?.sesionesTotales ?? 0;
    return {
      ...base,
      sesionesTotales: totales || null,
      sesionesRestantes: totales ? Math.max(totales - hechas, 0) : null,
      muestraBarra: Boolean(totales),
      porcentaje: totales ? Math.min(Math.trunc((hechas / totales) * 100), 100) : 0,
      facturacion: redondear((ciclo?.tarifa ?? 0) * hechas),
      precioEfectivo: ciclo?.tarifa ?? null,
    };
  }

  if (modalidad === MENSUALIDAD) {
    const cuota = ciclo?.cuotaMensual ?? null;
    return {
      ...base,
      // Sin tope: no hay sesiones restantes ni barra que llenar.
      sesionesTotales: null,
      sesionesRestantes: null,
      muestraBarra: false,
      porcentaje: null,
      facturacion: cuota,
      precioEfectivo: precioEfectivo(cuota, hechas),
    };
  }

  const tarifa = ciclo?.tarifa ?? 0;
  return {
    ...base,
    sesionesTotales: null,
    sesionesRestantes: null,
    muestraBarra: false,
    porcentaje: null,
    facturacion: redondear(tarifa * hechas),
    precioEfectivo: ciclo?.tarifa ?? null,
  };
}

export { CUENTA, BONO, MENSUALIDAD };
