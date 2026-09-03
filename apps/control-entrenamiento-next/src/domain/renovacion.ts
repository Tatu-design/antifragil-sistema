import { esMensual, MENSUALIDAD, type Modalidad } from "./modalidades";

/**
 * El cambio de mes de las mensualidades y las cuentas de cliente.
 *
 * El sistema ya decía —en `modalidades.ts`— que un bono se cierra al agotarse
 * y que una mensualidad o una cuenta se cierran **al cambiar de mes**. Lo
 * decía y no lo hacía nadie: el ciclo del mes nuevo solo aparecía si alguien
 * entraba a configurar el servicio a mano. El 1 de septiembre de 2026 nadie
 * cambió de mes y Fernando se lo encontró (2026-09-02).
 *
 * Aquí están las reglas, sin base de datos: qué le toca a cada cliente. Quién
 * lo escribe es `services/renovacion.ts`.
 */

/** Lo que hay que hacer con un cliente cuando llega un mes nuevo. */
export type Decision =
  | { que: "nada"; porque: string }
  | { que: "renovar"; anio: number; mes: number }
  | { que: "revisar"; porque: string; mesesDeDesfase: number };

export interface ClienteAMirar {
  estado: string;
  /** El ciclo en curso: el que dice en qué mes se quedó. */
  modalidad: Modalidad;
  anio: number | null;
  mes: number | null;
}

/** Cuántos meses van de un mes a otro. Negativo si el segundo es anterior. */
export function mesesEntre(desde: { anio: number; mes: number }, hasta: { anio: number; mes: number }): number {
  return (hasta.anio - desde.anio) * 12 + (hasta.mes - desde.mes);
}

/**
 * Qué hacer con este cliente hoy.
 *
 * Las reglas, en orden:
 *
 *   - Los bonos no entran: se renuevan al agotarse, no por el calendario.
 *   - Quien no está activo no se renueva. Un cliente pausado o cancelado no
 *     debe empezar a acumular meses —ni cuotas— mientras no entrena.
 *   - Si el ciclo ya es del mes en curso, no hay nada que hacer. Es lo que
 *     hace que ejecutarlo dos veces no cambie nada.
 *   - Si va un mes por detrás, se renueva.
 *   - Si va MÁS de un mes por detrás, no se inventan los meses de en medio:
 *     se marca para revisar. Crear cuotas de meses pasados en silencio es
 *     escribir historia económica que nadie ha visto.
 */
export function decidir(cliente: ClienteAMirar, hoy: { anio: number; mes: number }): Decision {
  if (cliente.modalidad === "bono") {
    return { que: "nada", porque: "los bonos se renuevan al agotarse, no al cambiar de mes" };
  }
  if (cliente.estado !== "activo") {
    return { que: "nada", porque: `está ${cliente.estado}` };
  }
  if (cliente.anio === null || cliente.mes === null) {
    // Un ciclo mensual sin mes es un dato incoherente: se mira, no se arregla
    // por las bravas.
    return { que: "revisar", porque: "su servicio no dice de qué mes es", mesesDeDesfase: 0 };
  }

  const desfase = mesesEntre({ anio: cliente.anio, mes: cliente.mes }, hoy);

  if (desfase <= 0) return { que: "nada", porque: "ya está en el mes en curso" };
  if (desfase === 1) return { que: "renovar", anio: hoy.anio, mes: hoy.mes };

  return {
    que: "revisar",
    porque: `lleva ${desfase} meses sin cambiar de mes`,
    mesesDeDesfase: desfase,
  };
}

/** ¿Este servicio lleva una cuota fija al mes? Solo la mensualidad. */
export function llevaCuota(modalidad: Modalidad): boolean {
  return modalidad === MENSUALIDAD;
}

/** Los servicios que van por mes natural: mensualidad y cuenta de cliente. */
export function vaPorMeses(modalidad: Modalidad): boolean {
  return esMensual(modalidad);
}

/**
 * El último día del mes que se cierra.
 *
 * Una mensualidad **es** un mes natural, así que el mes de agosto se cierra el
 * 31 de agosto, no el día en que a la tarea le dé por ejecutarse. Ponía la
 * fecha de ejecución, y el ciclo de agosto acababa marcado «hasta el 2 de
 * septiembre»: un mes que termina dentro del siguiente (2026-09-03).
 */
export function ultimoDiaDelMes(anio: number, mes: number): string {
  const dias = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dias).padStart(2, "0")}`;
}
