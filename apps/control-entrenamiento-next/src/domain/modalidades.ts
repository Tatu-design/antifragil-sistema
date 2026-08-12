/**
 * Las tres modalidades de servicio y sus reglas.
 *
 * Port directo de `servicios/modalidades.py`. Como allí, este módulo NO toca
 * la base de datos ni sabe nada de pantallas: solo números que entran y
 * números que salen. Así se puede probar exhaustivamente y ningún componente
 * de React necesita repetir estas decisiones.
 *
 * La regla que atraviesa todo el proyecto:
 *
 *     dinero producido ≠ horas trabajadas ≠ dinero cobrado
 *
 * Marcar un ciclo como cobrado solo cambia lo tercero. Nunca lo primero ni lo
 * segundo, ni hacia adelante ni hacia atrás.
 */

export const BONO = "bono";
export const MENSUALIDAD = "mensualidad";
export const CUENTA = "cuenta";

export const MODALIDADES = [BONO, MENSUALIDAD, CUENTA] as const;
export type Modalidad = (typeof MODALIDADES)[number];

export const MODALIDAD_POR_DEFECTO: Modalidad = BONO;

/** Cómo se llama cada una en pantalla. Fernando no lee código. */
export const ETIQUETAS: Record<Modalidad, string> = {
  [BONO]: "Bono",
  [MENSUALIDAD]: "Mensualidad",
  [CUENTA]: "Cuenta de cliente",
};

/** «Bono pagado» y «Mensualidad pagada» son conceptos distintos. */
const ETIQUETAS_PAGO: Record<Modalidad, [pagado: string, debe: string]> = {
  [BONO]: ["Bono pagado", "Pago pendiente"],
  [MENSUALIDAD]: ["Mensualidad pagada", "Pago pendiente"],
  [CUENTA]: ["Cuenta pagada", "Pendiente de pago"],
};

export function esModalidad(valor: unknown): valor is Modalidad {
  return typeof valor === "string" && (MODALIDADES as readonly string[]).includes(valor);
}

/** ¿Firmar una sesión descuenta de un saldo? Solo en los bonos. */
export function consumeSesiones(modalidad: Modalidad): boolean {
  return modalidad === BONO;
}

/** ¿El ciclo se cierra al agotar las sesiones? Solo en los bonos. Una
 *  mensualidad o una cuenta se cierran al cambiar de mes. */
export function renuevaPorConsumo(modalidad: Modalidad): boolean {
  return modalidad === BONO;
}

/** ¿El ciclo va por mes natural? */
export function esMensual(modalidad: Modalidad): boolean {
  return modalidad === MENSUALIDAD || modalidad === CUENTA;
}

/** ¿Tiene sentido hablar de «sesiones restantes»? Solo en los bonos. */
export function tieneTope(modalidad: Modalidad): boolean {
  return modalidad === BONO;
}

/**
 * Cuánto dinero aporta a la economía UNA sesión firmada.
 *
 * En una mensualidad la respuesta es `null` (ninguno): la cuota completa del
 * mes ya se registró aparte, así que sumar también cada sesión sería cobrar
 * dos veces. La sesión sigue guardándose y sigue contando como hora
 * trabajada — simplemente no lleva importe.
 */
export function tarifaDeLaSesion(modalidad: Modalidad, tarifa: number | null): number | null {
  return modalidad === MENSUALIDAD ? null : tarifa;
}

/**
 * Lo que ha salido cada hora de verdad.
 *
 * 720 € entre 12 son 60 €/h, pero entre 9 son 80 €/h y entre 13 son 55,38 €/h.
 * Devuelve `null` si todavía no hay sesiones — nunca una división por cero.
 */
export function precioEfectivo(facturacion: number | null, sesiones: number | null): number | null {
  if (!sesiones || facturacion === null || facturacion === undefined) return null;
  return redondear(facturacion / sesiones);
}

export function etiquetaPago(modalidad: Modalidad, pendiente: boolean): string {
  const [pagado, debe] = ETIQUETAS_PAGO[modalidad];
  return pendiente ? debe : pagado;
}

/** Al céntimo, que es la unidad real del negocio. */
export function redondear(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/** Las condiciones económicas de un servicio, ya normalizadas. */
export interface Condiciones {
  modalidad: Modalidad;
  sesionesTotales: number | null;
  precioTotal: number | null;
  tarifa: number | null;
  cuotaMensual: number | null;
  sesionesReferencia: number | null;
}

export interface EntradaCondiciones {
  sesionesTotales?: number | null;
  precioTotal?: number | null;
  cuotaMensual?: number | null;
  tarifa?: number | null;
  sesionesReferencia?: number | null;
}

export class ErrorDeNegocio extends Error {}

function numero(valor: unknown, etiqueta: string): number {
  const n = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(n)) throw new ErrorDeNegocio(`${etiqueta} tiene que ser un número`);
  if (n <= 0) throw new ErrorDeNegocio(`${etiqueta} tiene que ser mayor que cero`);
  return n;
}

function vacio(valor: unknown): boolean {
  return valor === null || valor === undefined || valor === "" || valor === 0;
}

/**
 * Comprueba que las condiciones son coherentes con la modalidad y devuelve el
 * juego completo, con `null` en lo que esa modalidad no usa.
 *
 * Rechaza combinaciones imposibles en vez de guardarlas y descubrir el
 * problema semanas después en la facturación.
 */
export function validarCondiciones(modalidad: Modalidad, entrada: EntradaCondiciones): Condiciones {
  if (modalidad === BONO) {
    if (!vacio(entrada.cuotaMensual)) {
      throw new ErrorDeNegocio("Un bono no lleva cuota mensual: se paga por el paquete de sesiones");
    }
    const sesiones = Math.trunc(numero(entrada.sesionesTotales, "El número de sesiones del bono"));
    const total = numero(entrada.precioTotal, "El precio total del bono");
    return {
      modalidad: BONO,
      sesionesTotales: sesiones,
      precioTotal: redondear(total),
      // El precio por sesión NO se pide: se calcula, para que no pueda
      // contradecir al precio total.
      tarifa: redondear(total / sesiones),
      cuotaMensual: null,
      sesionesReferencia: null,
    };
  }

  if (modalidad === MENSUALIDAD) {
    if (!vacio(entrada.sesionesTotales)) {
      throw new ErrorDeNegocio(
        "Una mensualidad no tiene un número de sesiones que se consuma. " +
          "Si quieres anotar las previstas, usa las sesiones de referencia.",
      );
    }
    const cuota = numero(entrada.cuotaMensual, "La cuota mensual");
    const referencia = vacio(entrada.sesionesReferencia)
      ? null
      : Math.trunc(numero(entrada.sesionesReferencia, "Las sesiones de referencia"));
    return {
      modalidad: MENSUALIDAD,
      sesionesTotales: null,
      precioTotal: null,
      // Deliberadamente sin tarifa por sesión: las sesiones de una
      // mensualidad no aportan dinero, solo horas.
      tarifa: null,
      cuotaMensual: redondear(cuota),
      sesionesReferencia: referencia,
    };
  }

  if (!vacio(entrada.cuotaMensual)) {
    throw new ErrorDeNegocio("Una cuenta de cliente no lleva cuota mensual: se paga por lo realmente hecho");
  }
  if (!vacio(entrada.sesionesTotales)) {
    throw new ErrorDeNegocio("Una cuenta de cliente no tiene tope de sesiones");
  }
  return {
    modalidad: CUENTA,
    sesionesTotales: null,
    precioTotal: null,
    tarifa: redondear(numero(entrada.tarifa, "El precio por sesión")),
    cuotaMensual: null,
    sesionesReferencia: null,
  };
}

/**
 * A qué programa pertenece una sesión, según su fecha.
 *
 * **Una mensualidad es un MES NATURAL**: julio va del 1 al 31 de julio, punto
 * (regla de Fernando, 2026-08-12). Da igual cuándo se cerrara
 * administrativamente el ciclo: si la sesión se hizo en julio, es de la
 * mensualidad de julio.
 *
 * POR QUÉ EXISTE ESTO
 *
 * Antes se usaba siempre «el ciclo actual del cliente». Con una mensualidad
 * eso es el mes en curso, así que las sesiones de los últimos días de un mes
 * —cuando el ciclo ya se había cerrado y el siguiente aún no había
 * empezado— no cabían en ninguna parte y desaparecían. A Felipe y Javi les
 * pasó con el 27 y el 29 de julio: dos horas trabajadas que no llegaron a
 * registrarse nunca.
 *
 * Un bono no tiene esta pregunta: no va por meses, así que siempre es el suyo
 * en curso.
 */
export function cicloDeLaFecha<T extends { ciclo: number; modalidad: Modalidad; anio: number | null; mes: number | null }>(
  ciclos: T[],
  actual: T | null,
  fecha: string,
): T | null {
  if (!actual || !esMensual(actual.modalidad)) return actual;

  const anio = Number(fecha.slice(0, 4));
  const mes = Number(fecha.slice(5, 7));

  const delMes = ciclos.find(
    (c) => esMensual(c.modalidad) && c.anio === anio && c.mes === mes,
  );

  // Si ese mes no tuvo mensualidad, se queda en el actual: no se inventa un
  // programa que no existió.
  return delMes ?? actual;
}
