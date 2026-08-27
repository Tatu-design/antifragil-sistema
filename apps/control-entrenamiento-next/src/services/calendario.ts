/**
 * El calendario de sesiones firmadas.
 *
 * **No hay una tabla de calendario ni sesiones duplicadas.** Esta pantalla es
 * otra forma de mirar las sesiones que ya existen: se piden las del mes en una
 * sola consulta y se cuentan por día. La fuente de verdad sigue siendo
 * `sesiones`.
 *
 * DE QUIÉN ES CADA SESIÓN. Se usa la misma atribución que Economía
 * (`domain/atribucion.ts`), NO quién pulsó el botón. Son dos cosas distintas y
 * el sistema ya las distingue: `firmadaPor` es trazabilidad y `profesionalId`
 * es propiedad. Dos razones para elegir la propiedad:
 *
 *   1. Coherencia. Lo que un profesional ve en su calendario tiene que cuadrar
 *      con su economía y con su lista de clientes. Si Fernando firma
 *      excepcionalmente una sesión de un cliente de Rafa, esa sesión es trabajo
 *      de Rafa en todas las pantallas o el sistema se contradice.
 *   2. Cobertura. Solo un tercio del histórico tiene guardado quién firmó —la
 *      columna se añadió el 2026-08-09—, así que un calendario basado en eso
 *      enseñaría junio y julio en blanco.
 */

import {
  construirMes,
  rangoDelMes,
  type Mes,
} from "@/domain/calendario";
import type { SesionDelCalendario } from "@/domain/tipos";
import { hoyNegocio } from "@/lib/fechas";
import { repositorio } from "@/repositories";

export interface VistaCalendario {
  /** La cuadrícula, con el número de sesiones de cada día. */
  mes: Mes;
  /** Las sesiones del mes entero, ya filtradas por quien puede verlas. */
  sesiones: SesionDelCalendario[];
  /** `AAAA-MM-DD` de hoy en Madrid. */
  hoy: string;
}

/**
 * Lo que enseña la pantalla: un mes y sus sesiones.
 *
 * Se devuelven las sesiones del MES ENTERO, no las de un día. Son unas
 * decenas de líneas de texto y permite que pulsar un día sea instantáneo, sin
 * volver al servidor. Pedir un día cada vez serían treinta viajes de red para
 * mirar un mes.
 *
 * `profesionalId` es de quién se quiere ver. Sin él, de todo el equipo — y esa
 * decisión NO se toma aquí: la toma la pantalla, que es quien sabe si quien
 * mira es administrador. Ver `alcanceEconomico` en el dominio.
 */
export async function obtenerCalendario(peticion: {
  anio: number;
  mes: number;
  profesionalId?: string | null;
  adminId?: string | null;
}): Promise<VistaCalendario> {
  const { desde, hasta } = rangoDelMes(peticion.anio, peticion.mes);
  const hoy = hoyNegocio();

  // UNA consulta para todo el mes, del día 1 al último. Ni un día suelto ni el
  // histórico entero.
  const sesiones = await repositorio().sesionesEntre(desde, hasta, {
    soloDe: peticion.profesionalId ?? null,
    adminId: peticion.adminId ?? null,
  });

  const conteos = new Map<string, number>();
  for (const sesion of sesiones) {
    conteos.set(sesion.fecha, (conteos.get(sesion.fecha) ?? 0) + 1);
  }

  return { mes: construirMes(peticion.anio, peticion.mes, hoy, conteos), sesiones, hoy };
}
