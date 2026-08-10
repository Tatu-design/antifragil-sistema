/**
 * Avisos: lo que Fernando debería mirar.
 *
 * Se crean en el momento en que ocurre lo que los provoca (un bono agotado,
 * una última sesión) y se leen la próxima vez que abre la aplicación. No hay
 * ninguna tarea programada detrás: se intentó una automatización en la nube en
 * julio de 2026 y nunca se pudo comprobar que funcionara. Esto sí.
 */

import type { Aviso } from "@/repositories";
import { repositorio } from "@/repositories";

/**
 * Los avisos sin resolver, del más reciente al más antiguo.
 *
 * `soloDe` es el profesional cuando quien mira es un entrenador: ve los de sus
 * clientes y ninguno más. Los del sistema —un descuadre con Calendar— no son
 * de nadie y quedan para el administrador.
 */
export async function listarAvisos(soloDe?: string | null): Promise<Aviso[]> {
  return repositorio().listarAvisos(soloDe);
}

/** Cuántos hay SIN VER. Se enseña en la barra para no tener que entrar. */
export async function contarNoLeidos(soloDe?: string | null): Promise<number> {
  return repositorio().contarNoLeidos(soloDe);
}

/**
 * Entrar en la bandeja los marca como vistos — pero NO como resueltos.
 * Verlo no lo arregla: son dos cosas distintas y se guardan por separado.
 */
export async function marcarTodosLeidos(soloDe?: string | null): Promise<void> {
  const repo = repositorio();
  await repo.transaccion(() => repo.marcarTodosLeidos(soloDe));
}

/** Resolver un aviso ajeno no hace nada. La condición va en el propio `update`. */
export async function resolverAviso(id: string, soloDe?: string | null): Promise<boolean> {
  const repo = repositorio();
  return repo.transaccion(() => repo.resolverAviso(id, soloDe));
}

/**
 * Descarta de golpe todos los de un tipo.
 *
 * Hace falta porque un mismo motivo puede generar muchos avisos seguidos, y
 * limpiarlos de uno en uno es inviable: le pasó a Fernando con 28 de golpe.
 */
export async function resolverPorTipo(tipo: string, soloDe?: string | null): Promise<number> {
  const repo = repositorio();
  return repo.transaccion(() => repo.resolverPorTipo(tipo, soloDe));
}
