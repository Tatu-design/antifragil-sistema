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

  // Las tres a la vez: no dependen entre sí, y esto va detrás de una firma que
  // ya ha hecho esperar a alguien con el móvil en la mano.
  const [semanas, real, clases] = await Promise.all([
    repo.listarSemanas(),
    // LO FIRMADO ESA SEMANA, SUMADO POR LA BASE (2026-08-27). Antes se pedían
    // las sesiones cliente a cliente y se filtraban aquí: nueve consultas y
    // ciento veintiuna sesiones descargadas para mirar las quince de una
    // semana, con una consulta más por cada cliente nuevo. Eran casi cuatro
    // segundos pegados a cada firma, y la firma acabó pasándose del tiempo
    // que Vercel le da a una pantalla: a Fernando le salió «Algo ha fallado».
    repo.resumenDeSesionesEntre(inicio, fin),
    repo.contarClases(inicio, fin),
  ]);

  const semana = semanas.find((s) => s.inicio === inicio);
  if (!semana) return [];

  // Las clases de Lidomare van al mismo saco de dinero que las sesiones de PT,
  // así que hay que sumarlas antes de comparar.
  const facturacionReal = real.facturacion + clases.lidomare * TARIFA_LIDOMARE;
  const horasReales = real.horas + clases.lidomare;
  const horasSinImporteReales = real.horasSinImporte;

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
