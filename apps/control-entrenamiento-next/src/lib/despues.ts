import { after } from "next/server";

/**
 * Trabajo que se hace DESPUÉS de contestar, no antes.
 *
 * POR QUÉ EXISTE (2026-09-02)
 *
 * Al firmar una sesión, la comprobación de descuadre se hacía antes de
 * contestar. La sesión ya estaba guardada —la transacción había confirmado—
 * pero la pantalla seguía en «Guardando…» esperando a una comprobación que no
 * cambia nada de lo que se acaba de guardar. Si esa comprobación tardaba, o la
 * red se cortaba a mitad, quedaba el peor estado posible: **la sesión guardada
 * y la pantalla diciendo que no**.
 *
 * `after()` es lo que Next.js (15.5) ofrece para esto, y en Vercel se apoya en
 * el mecanismo del propio servidor para no cortar el trabajo al terminar la
 * respuesta. NO es una promesa suelta: una promesa suelta sí la puede cortar
 * Vercel en cuanto contesta, y entonces la comprobación no se haría nunca sin
 * que nadie se enterara.
 *
 * FUERA DE UNA PETICIÓN —pruebas, scripts sueltos— no hay a qué engancharse, y
 * entonces la tarea se hace aquí mismo. La promesa queda en `tareaEnCurso`
 * para que una prueba pueda esperarla; en producción nadie la mira.
 *
 * El error nunca sube: esto va detrás de algo que YA se guardó bien, y que
 * falle la comprobación no puede convertir en fallo una operación correcta.
 */

/** Solo para las pruebas: la última tarea lanzada fuera de una petición. */
export let tareaEnCurso: Promise<void> = Promise.resolve();

export function despues(nombre: string, tarea: () => Promise<void>): void {
  const protegida = async () => {
    try {
      await tarea();
    } catch (error) {
      // Que se vea en el registro del servidor, sin datos de nadie: solo qué
      // tarea falló y por qué. Si esto empieza a aparecer, hay algo que mirar.
      console.error(`[despues] «${nombre}» ha fallado:`, error instanceof Error ? error.message : error);
    }
  };

  try {
    // SE LE PASA LA FUNCIÓN, NO LA PROMESA. `after(protegida())` la habría
    // arrancado aquí mismo, antes de contestar, que es justo lo que se
    // quería evitar: la tarea empezaría a competir por la conexión mientras
    // la respuesta todavía se está enviando. Con la función, Next la llama
    // cuando ya ha contestado (2026-09-03).
    after(protegida);
  } catch {
    // No estamos dentro de una petición. Se hace ahora.
    tareaEnCurso = protegida();
  }
}
