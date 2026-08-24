import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Qué conexión está usando ESTA petición, sin que se mezclen entre sí.
 *
 * POR QUÉ EXISTE (2026-08-24)
 *
 * Antes esto era una variable suelta del módulo: `let enCurso`. Funciona
 * mientras solo haya una persona usando la aplicación, y deja de funcionar en
 * cuanto hay dos cosas a la vez —que es lo normal: mientras se guarda una
 * sesión, el navegador ya está pidiendo la lista de clientes.
 *
 * Lo que pasaba: una petición abría su transacción y dejaba escrito «la
 * conexión en curso es la mía». Cualquier otra que llegara en ese instante
 * leía esa nota y **mandaba sus consultas por la conexión ajena**, metiéndolas
 * dentro de una transacción que no era la suya. Cuando la primera terminaba y
 * devolvía la conexión al montón, la segunda se quedaba hablando con una
 * conexión que ya no era suya: la consulta no volvía nunca y la pantalla se
 * quedaba en «Guardando…» para siempre.
 *
 * `AsyncLocalStorage` es la forma que tiene Node de guardar algo «para esta
 * petición y las cosas que salgan de ella», sin que las demás lo vean. Cada
 * petición tiene su propia respuesta a «¿estoy dentro de una transacción?», y
 * dos que corran a la vez ya no pueden pisarse.
 */
const almacen = new AsyncLocalStorage<unknown>();

/** La conexión de la transacción de ESTA petición, o `null` si no hay ninguna. */
export function conexionEnCurso<C>(): C | null {
  return (almacen.getStore() as C | undefined) ?? null;
}

/** Ejecuta la tarea marcando esa conexión como la de esta petición. */
export function conConexion<C, T>(conexion: C, tarea: () => Promise<T>): Promise<T> {
  return almacen.run(conexion, tarea);
}
