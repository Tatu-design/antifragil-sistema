/**
 * Las reglas del dinero. Port de `economia/registro.py`.
 *
 * Aquí no se consulta nada: entran los datos en bruto de un mes y sale el
 * resumen. Así se puede comprobar al céntimo sin montar una base de datos.
 *
 * DOS VISTAS QUE NO SE CALCULAN IGUAL, Y ES A PROPÓSITO
 *
 * - La **semanal** sale de un agregado que se va actualizando en cada firma.
 *   Una semana a caballo entre dos meses se muestra **entera**, que es lo que
 *   se espera al mirar «esta semana».
 * - La **mensual** se calcula desde las sesiones, por su fecha REAL. Antes
 *   agrupaba por el lunes de cada semana y una sesión del 1 de agosto contaba
 *   en julio.
 *
 * CROSSFIT KIDS
 *
 * Se factura al final: el importe lo introduce Fernando cuando acaba el mes y
 * ya sabe cuánto ha cobrado.
 *
 * **Sus horas cuentan siempre** (decisión de Fernando, 2026-08-08). Una clase
 * de Kids es una hora de trabajo, se sepa o no lo que se va a cobrar por ella.
 * Antes no contaban hasta conocer el importe, para que el precio medio no
 * saliera hundido; el problema es que eso escondía trabajo real.
 *
 * La solución al precio medio no es esconder horas, es **decir la verdad**:
 * mientras falte el importe de Kids, el mes queda marcado como provisional y
 * `precioMedioFiable` es `false`. La pantalla enseña entonces por qué está
 * incompleto en vez de un número que no se sostiene.
 */

import { redondear } from "./modalidades";
import type { Modalidad } from "./modalidades";

/** Tarifa fija, no depende del cliente. Ver docs/TARIFAS.md. */
export const TARIFA_LIDOMARE = 15;

export type TipoClase = "lidomare" | "kids";

export interface SesionEconomica {
  fecha: string;
  /** `null` = hora trabajada sin importe (mensualidad). */
  tarifa: number | null;
  modalidad: Modalidad;
}

export interface EntradaMes {
  anio: number;
  mes: number;
  sesiones: SesionEconomica[];
  /** Cuotas de mensualidad cobradas ese mes. */
  cuotas: number[];
  clasesLidomare: number;
  clasesKids: number;
  /** Lo facturado por Kids ese mes. `null` = todavía sin introducir. */
  facturacionKids: number | null;
  ajustes: Array<{ origen: string; importe: number; horas: number; motivo: string }>;
}

export interface ResumenMes {
  anio: number;
  mes: number;
  facturacionTotal: number;
  horasTotales: number;
  precioMedioHora: number;
  /** `false` cuando falta el importe de Kids: sus horas ya cuentan y su
   *  dinero no, así que el medio saldría a la baja. */
  precioMedioFiable: boolean;
  /** Dinero de las cuotas fijas. No sale de contar sesiones. */
  facturacionCuotas: number;
  numeroCuotas: number;
  sesionesKids: number;
  facturacionKids: number | null;
  /** Hay clases de Kids sin importe todavía: el total aún no las incluye. */
  provisional: boolean;
  ajusteImporte: number;
  ajusteHoras: number;
  ajustes: Array<{ origen: string; importe: number; horas: number; motivo: string }>;
  porModalidad: Record<string, { horas: number; facturacion: number }>;
  facturacionLidomare: number;
  clasesLidomare: number;
}

export function resumirMes(entrada: EntradaMes): ResumenMes {
  // El dinero sale solo de las sesiones que llevan importe. Las HORAS salen de
  // todas: una sesión de mensualidad se ha trabajado igual, su dinero está en
  // la cuota del mes.
  const facturacionSesiones = entrada.sesiones.reduce((suma, s) => suma + (s.tarifa ?? 0), 0);
  const horasSesiones = entrada.sesiones.length;

  const facturacionCuotas = entrada.cuotas.reduce((suma, c) => suma + c, 0);

  const facturacionLidomare = entrada.clasesLidomare * TARIFA_LIDOMARE;

  // Hay clases de Kids pero todavía no se sabe lo que se cobró por ellas: el
  // mes está incompleto en dinero, aunque sus horas ya sean reales.
  const provisional = entrada.clasesKids > 0 && entrada.facturacionKids === null;

  const ajusteImporte = entrada.ajustes.reduce((suma, a) => suma + a.importe, 0);
  const ajusteHoras = entrada.ajustes.reduce((suma, a) => suma + a.horas, 0);

  // Las horas de Kids cuentan SIEMPRE (2026-08-08): una clase es una hora
  // trabajada, se sepa o no lo que se va a cobrar por ella.
  const horasTotales =
    horasSesiones + entrada.clasesLidomare + entrada.clasesKids + ajusteHoras;

  const facturacionTotal = redondear(
    facturacionSesiones +
      facturacionCuotas +
      facturacionLidomare +
      (entrada.facturacionKids ?? 0) +
      ajusteImporte,
  );

  // De dónde sale el dinero, por tipo de servicio. Se calcula al vuelo: no se
  // guarda en ningún sitio que pueda desincronizarse.
  const porModalidad: Record<string, { horas: number; facturacion: number }> = {};
  for (const sesion of entrada.sesiones) {
    const entradaModalidad = (porModalidad[sesion.modalidad] ??= { horas: 0, facturacion: 0 });
    entradaModalidad.horas += 1;
    entradaModalidad.facturacion = redondear(entradaModalidad.facturacion + (sesion.tarifa ?? 0));
  }
  // La facturación de una mensualidad no está en sus sesiones, sino en su
  // cuota: se le suma aquí para que la línea diga la verdad.
  if (facturacionCuotas) {
    const mensual = (porModalidad.mensualidad ??= { horas: 0, facturacion: 0 });
    mensual.facturacion = redondear(mensual.facturacion + facturacionCuotas);
  }
  // Las dos cuentas de actividad, con sus horas y su dinero.
  if (entrada.clasesLidomare) {
    porModalidad.lidomare = { horas: entrada.clasesLidomare, facturacion: facturacionLidomare };
  }
  if (entrada.clasesKids) {
    porModalidad.kids = { horas: entrada.clasesKids, facturacion: entrada.facturacionKids ?? 0 };
  }

  return {
    anio: entrada.anio,
    mes: entrada.mes,
    facturacionTotal,
    horasTotales,
    precioMedioHora: horasTotales ? redondear(facturacionTotal / horasTotales) : 0,
    // Con Kids sin facturar, ese precio medio sale a la baja: las horas ya
    // están contadas y su dinero todavía no. No se maquilla el número — se
    // avisa de que aún no es el definitivo y la pantalla lo dice.
    precioMedioFiable: !provisional,
    facturacionCuotas: redondear(facturacionCuotas),
    numeroCuotas: entrada.cuotas.length,
    sesionesKids: entrada.clasesKids,
    facturacionKids: entrada.facturacionKids,
    provisional,
    ajusteImporte: redondear(ajusteImporte),
    ajusteHoras,
    ajustes: entrada.ajustes,
    porModalidad,
    facturacionLidomare,
    clasesLidomare: entrada.clasesLidomare,
  };
}

/**
 * Precio por clase de CrossFit Kids de un mes.
 *
 * Su facturación entre las clases que de verdad se dieron ESE mes. Devuelve 0
 * si falta el importe o no hubo clases — nunca una división por cero.
 */
export function precioClaseKids(importe: number | null, clases: number): number {
  if (!importe || !clases) return 0;
  return redondear(importe / clases);
}

export interface ResumenSemana {
  inicio: string;
  fin: string;
  facturacionTotal: number;
  horasTotales: number;
  precioMedioHora: number;
  /** `false` cuando falta el importe de Kids: sus horas ya cuentan y su
   *  dinero no, así que el medio saldría a la baja. */
  precioMedioFiable: boolean;
  sesionesKids: number;
  facturacionKids: number | null;
  provisional: boolean;
}

/**
 * El resumen de una semana a partir de lo guardado.
 *
 * `horasSinImporte` son las sesiones de mensualidad: cuentan como hora
 * trabajada y no aportan dinero (corrección H-01). Sin ellas, el precio medio
 * por hora de la semana salía inflado.
 */
export function resumirSemana(datos: {
  inicio: string;
  fin: string;
  facturacion: number;
  horas: number;
  horasSinImporte: number;
  sesionesKids: number;
  facturacionKids: number | null;
}): ResumenSemana {
  const provisional = datos.sesionesKids > 0 && datos.facturacionKids === null;
  const kidsCuenta = datos.facturacionKids !== null;

  const horasTotales = datos.horas + datos.horasSinImporte + (kidsCuenta ? datos.sesionesKids : 0);
  const facturacionTotal = redondear(datos.facturacion + (datos.facturacionKids ?? 0));

  return {
    inicio: datos.inicio,
    fin: datos.fin,
    facturacionTotal,
    horasTotales,
    precioMedioHora: horasTotales ? redondear(facturacionTotal / horasTotales) : 0,
    // Con Kids sin facturar, ese precio medio sale a la baja: las horas ya
    // están contadas y su dinero todavía no. No se maquilla el número — se
    // avisa de que aún no es el definitivo y la pantalla lo dice.
    precioMedioFiable: !provisional,
    sesionesKids: datos.sesionesKids,
    facturacionKids: datos.facturacionKids,
    provisional,
  };
}
