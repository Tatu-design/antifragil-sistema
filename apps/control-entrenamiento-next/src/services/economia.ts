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
  resumirSemana,
  type ResumenMes,
  type ResumenSemana,
  type TipoClase,
} from "@/domain/economia";
import { hoyNegocio, rangoSemana } from "@/lib/fechas";
import { repositorio } from "@/repositories";
import { comprobarYAvisar } from "./verificacion";

export interface VistaEconomia {
  /** La semana más reciente con movimiento, no necesariamente la de hoy. */
  semana: ResumenSemana | null;
  semanas: ResumenSemana[];
  meses: ResumenMes[];
  /** Clases dadas esta semana, para los botones de CrossFit. */
  clasesEstaSemana: Record<TipoClase, number>;
  precioClaseKidsDelMes: number;
}

export async function obtenerEconomia(): Promise<VistaEconomia> {
  const repo = repositorio();

  const hoy = hoyNegocio();
  const { inicio, fin } = rangoSemana(hoy);

  // Las tres lecturas de arranque no dependen entre sí, así que van a la vez
  // (2026-08-05). Contra Supabase cada consulta es un viaje de red de ~180 ms:
  // encadenarlas era esperar tres veces para nada.
  const [filasSemanas, mesesConDatos, clasesEstaSemana] = await Promise.all([
    repo.listarSemanas(),
    repo.mesesConDatos(),
    repo.contarClases(inicio, fin),
  ]);
  const semanas = filasSemanas.map(resumirSemana);

  // Y cada mes se calcula en paralelo con los demás, no uno detrás de otro.
  const meses: ResumenMes[] = await Promise.all(
    mesesConDatos.map(async ({ anio, mes }) =>
      resumirMes({ anio, mes, ...(await repo.datosDelMes(anio, mes)) }),
    ),
  );

  const anio = Number(hoy.slice(0, 4));
  const mes = Number(hoy.slice(5, 7));
  const delMes = meses.find((m) => m.anio === anio && m.mes === mes);

  return {
    semana: semanas[0] ?? null,
    semanas,
    meses,
    clasesEstaSemana,
    precioClaseKidsDelMes: precioClaseKids(delMes?.facturacionKids ?? null, delMes?.sesionesKids ?? 0),
  };
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
