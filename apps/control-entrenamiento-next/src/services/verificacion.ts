/**
 * ¿Sigue cuadrando lo firmado con lo facturado?
 *
 * Port de `economia.registro.verificar_sincronizacion_semana`. Recalcula desde
 * las sesiones reales lo que debería haber en la economía de una semana y lo
 * compara con lo guardado.
 *
 * **Nunca corrige nada por su cuenta.** Solo detecta y deja un aviso. Corregir
 * automáticamente una cifra de dinero sin que nadie lo vea es exactamente lo
 * que no se quiere: si algo no cuadra, hay que mirarlo.
 *
 * Se ejecuta después de cada firma, edición o borrado, y por eso Fernando se
 * entera el mismo día en vez de descubrirlo semanas después comparando con su
 * hoja de cálculo — que fue justo lo que pasó en julio de 2026.
 */

import { TARIFA_LIDOMARE } from "@/domain/economia";
import { hoyNegocio, rangoSemana } from "@/lib/fechas";
import { repositorio } from "@/repositories";

const CENTIMO = 0.005;

/** Devuelve las diferencias encontradas. Vacío = todo cuadra. */
export async function verificarSemana(fechaIso: string): Promise<string[]> {
  const repo = repositorio();
  const { inicio, fin } = rangoSemana(fechaIso);

  const semana = (await repo.listarSemanas()).find((s) => s.inicio === inicio);
  if (!semana) return [];

  // Lo que de verdad hay firmado esa semana, cliente a cliente.
  let facturacionReal = 0;
  let horasReales = 0;
  let horasSinImporteReales = 0;
  for (const cliente of await repo.listarClientes()) {
    for (const sesion of await repo.listarSesiones(cliente.id)) {
      if (sesion.fecha < inicio || sesion.fecha > fin) continue;
      if (sesion.tarifa === null) horasSinImporteReales += 1;
      else {
        facturacionReal += sesion.tarifa;
        horasReales += 1;
      }
    }
  }

  // Las clases de Lidomare van al mismo saco de dinero que las sesiones de PT,
  // así que hay que sumarlas antes de comparar.
  const clases = await repo.contarClases(inicio, fin);
  facturacionReal += clases.lidomare * TARIFA_LIDOMARE;
  horasReales += clases.lidomare;

  const diferencias: string[] = [];
  if (Math.abs(facturacionReal - semana.facturacion) > CENTIMO) {
    diferencias.push(
      `Semana del ${inicio}: la economía dice ${semana.facturacion.toFixed(2)} € pero las sesiones ` +
        `firmadas suman ${facturacionReal.toFixed(2)} €`,
    );
  }
  if (horasReales !== semana.horas) {
    diferencias.push(
      `Semana del ${inicio}: la economía dice ${semana.horas} horas con importe pero hay ${horasReales} reales`,
    );
  }
  if (horasSinImporteReales !== semana.horasSinImporte) {
    diferencias.push(
      `Semana del ${inicio}: la economía dice ${semana.horasSinImporte} horas sin importe pero hay ` +
        `${horasSinImporteReales} reales`,
    );
  }
  if (clases.kids !== semana.sesionesKids) {
    diferencias.push(
      `Semana del ${inicio}: la economía dice ${semana.sesionesKids} clases de CrossFit Kids pero hay ` +
        `${clases.kids} reales`,
    );
  }

  return diferencias;
}

/**
 * Comprueba y, si algo no cuadra, deja un aviso.
 *
 * Se llama DESPUÉS de que la operación se haya guardado, no dentro: es una
 * comprobación posterior de solo lectura, y si fallara no debe tumbar una
 * firma que ya era correcta.
 */
export async function comprobarYAvisar(fechaIso: string): Promise<void> {
  try {
    const diferencias = await verificarSemana(fechaIso);
    if (diferencias.length === 0) return;

    const repo = repositorio();
    for (const detalle of diferencias) {
      await repo.registrarAviso({ fecha: hoyNegocio(), tipo: "descuadre", detalle });
    }
  } catch {
    // Que la comprobación falle no puede romper la operación que ya se guardó.
  }
}
