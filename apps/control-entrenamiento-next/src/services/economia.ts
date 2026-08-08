/**
 * Consultas y operaciones de la pantalla de Economía.
 *
 * Los cálculos viven en `domain/economia.ts`. Aquí solo se leen los datos y se
 * les pasan — para que las reglas se puedan comprobar sin base de datos.
 *
 * **Consultar Economía nunca escribe.** Es una regla del sistema actual y se
 * mantiene: una pantalla que se limita a mirar no puede crear ni duplicar
 * nada, y esa es la garantía más fácil de sostener.
 */

import { ErrorDeNegocio } from "@/domain/modalidades";
import {
  precioClaseKids,
  resumirMes,
  type ResumenMes,
  type TipoClase,
} from "@/domain/economia";
import { hoyNegocio } from "@/lib/fechas";
import { repositorio } from "@/repositories";
import { comprobarYAvisar } from "./verificacion";

export interface VistaEconomia {
  /** El mes natural en curso. **Siempre existe**, aunque esté todo a cero. */
  mesActual: ResumenMes;
  /** Los demás meses con actividad, del más reciente al más antiguo. */
  anteriores: ResumenMes[];
}

/**
 * Lo que enseña la pantalla de Economía: el mes en curso y los anteriores.
 *
 * Desde el 2026-08-08 la pantalla es solo mensual, así que ya NO se piden ni
 * las semanas ni las clases de esta semana: eran dos viajes de red para
 * pintar algo que ha dejado de existir. Los métodos siguen en el repositorio
 * porque la comprobación de sincronización sí los usa.
 *
 * El mes en curso se calcula aparte y siempre, aunque no tenga ninguna sesión
 * todavía: la pantalla debe enseñar su bloque en cero el día 1, no un hueco.
 */
export async function obtenerEconomia(): Promise<VistaEconomia> {
  const repo = repositorio();
  const hoy = hoyNegocio();
  const anio = Number(hoy.slice(0, 4));
  const mes = Number(hoy.slice(5, 7));

  const conDatos = await repo.mesesConDatos();
  const anteriores = conDatos.filter((m) => m.anio !== anio || m.mes !== mes);

  // El mes en curso y los anteriores se calculan a la vez.
  const [mesActual, ...resto] = await Promise.all([
    repo.datosDelMes(anio, mes).then((datos) => resumirMes({ anio, mes, ...datos })),
    ...anteriores.map(async (m) =>
      resumirMes({ anio: m.anio, mes: m.mes, ...(await repo.datosDelMes(m.anio, m.mes)) }),
    ),
  ]);

  return { mesActual, anteriores: resto };
}

export async function obtenerMes(anio: number, mes: number): Promise<ResumenMes | null> {
  const repo = repositorio();
  const existe = (await repo.mesesConDatos()).some((m) => m.anio === anio && m.mes === mes);
  if (!existe) return null;
  return resumirMes({ anio, mes, ...(await repo.datosDelMes(anio, mes)) });
}

/** Suma una clase de grupo de hoy. */
export async function registrarClase(tipo: TipoClase, fecha?: string): Promise<string> {
  const repo = repositorio();
  const cuando = fecha ?? hoyNegocio();
  await repo.transaccion(() => repo.registrarClase(cuando, tipo));
  await comprobarYAvisar(cuando);
  // Devuelve el día anotado para poder enseñarlo al volver a la ficha.
  return cuando;
}

/** Deshace la última clase de ese tipo — un toque de más se puede corregir. */
export async function deshacerClase(tipo: TipoClase): Promise<string> {
  const repo = repositorio();
  return repo.transaccion(async () => {
    const cuando = await repo.deshacerUltimaClase(tipo);
    if (!cuando) throw new ErrorDeNegocio(`No hay ninguna clase de ${etiqueta(tipo)} registrada todavía`);
    return cuando;
  }).then(async (cuando) => {
    await comprobarYAvisar(cuando);
    return cuando;
  });
}

/**
 * Guarda lo facturado por CrossFit Kids un mes.
 *
 * A partir de ese momento sus clases cuentan como horas y su dinero entra en
 * el total; hasta entonces el mes se marca provisional.
 */
export async function guardarFacturacionKids(anio: number, mes: number, importe: number): Promise<number> {
  if (!(importe > 0)) throw new ErrorDeNegocio("La facturación de Kids tiene que ser un importe positivo");

  const repo = repositorio();
  return repo.transaccion(async () => {
    await repo.guardarFacturacionKids(anio, mes, importe);
    const { clasesKids } = await repo.datosDelMes(anio, mes);
    return precioClaseKids(importe, clasesKids);
  });
}

export function etiqueta(tipo: TipoClase): string {
  return tipo === "lidomare" ? "CrossFit Lidomare" : "CrossFit Kids";
}
