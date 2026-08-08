/**
 * Las dos cuentas de actividad: CrossFit Lidomare y CrossFit Kids.
 *
 * Fernando las abre desde la lista de clientes y les firma la clase igual que
 * entra en un cliente de PT. Por dentro **no son clientes**: siguen viviendo
 * en `clases_grupo`, que es su única fuente de verdad.
 *
 * Este archivo no inventa ninguna operación nueva. Firmar y deshacer llaman a
 * `registrarClase` y `deshacerUltimaClase`, que ya existían y ya dejaban la
 * economía de la semana cuadrada. Lo que se añade es la forma de mirarlas: el
 * mes en curso, su historial y su facturación.
 */

import "server-only";

import { ErrorDeNegocio } from "@/domain/modalidades";
import type { TipoClase } from "@/domain/economia";
import {
  type ClaseDelHistorial,
  type FichaClase,
  fichaKids,
  fichaLidomare,
  motivoParaNoFacturar,
  precioResultante,
} from "@/domain/clases";
import { anioDe, hoyNegocio, mesDe } from "@/lib/fechas";
import { repositorio } from "@/repositories";
import { comprobarYAvisar } from "./verificacion";

export interface VistaCuenta {
  ficha: FichaClase;
  historial: ClaseDelHistorial[];
}

/** El mes natural que se está mirando. Por defecto, el de hoy. */
function mesActual(anio?: number, mes?: number): { anio: number; mes: number } {
  const hoy = hoyNegocio();
  return { anio: anio ?? anioDe(hoy), mes: mes ?? mesDe(hoy) };
}

/**
 * La ficha de una cuenta y su historial del mes.
 *
 * No hay contador guardado en ninguna parte: las clases del mes se cuentan
 * filtrando por fecha. Por eso el 1 de septiembre empieza solo en 0 sin que
 * nadie reinicie nada, y las de agosto siguen en su sitio.
 */
export async function obtenerCuenta(
  tipo: TipoClase,
  anio?: number,
  mes?: number,
): Promise<VistaCuenta> {
  const repo = repositorio();
  const periodo = mesActual(anio, mes);

  // Las dos lecturas no dependen entre sí: van a la vez. Contra Supabase cada
  // consulta es un viaje de red.
  const [clases, importeKids] = await Promise.all([
    repo.clasesDelMes(tipo, periodo.anio, periodo.mes),
    tipo === "kids" ? repo.facturacionKids(periodo.anio, periodo.mes) : Promise.resolve(null),
  ]);

  const ficha =
    tipo === "lidomare"
      ? fichaLidomare(periodo.anio, periodo.mes, clases.length)
      : fichaKids(periodo.anio, periodo.mes, clases.length, importeKids);

  return { ficha, historial: clases.map((c) => ({ id: c.id, fecha: c.fecha })) };
}

/**
 * Firmar y deshacer NO se reimplementan aquí.
 *
 * `registrarClase` y `deshacerClase` ya existen en `services/economia.ts` y
 * hacen exactamente lo que hace falta: anotan la clase con su fecha, mueven la
 * economía de la semana y dejan un aviso si algo deja de cuadrar. Tener una
 * segunda versión sería dos sitios distintos para firmar lo mismo, que es
 * justo lo que esta iteración venía a quitar.
 *
 * Se reexportan para que las pantallas de las cuentas no tengan que saber que
 * viven en el módulo de economía.
 */
export { registrarClase as firmarClase } from "./economia";

/**
 * Borra una clase CONCRETA del historial.
 *
 * Sustituye al antiguo «deshacer la última» (2026-08-08). Fernando prefiere
 * ir al historial y borrar la que se equivocó, igual que hace con la sesión de
 * un cliente: así elige cuál, y no depende de que sea la más reciente.
 *
 * El repositorio se encarga de descontar su importe de la semana, igual que
 * hacía el deshacer. Después se comprueba que esa semana sigue cuadrando.
 */
export async function borrarClase(id: string): Promise<{ fecha: string; tipo: TipoClase }> {
  const repo = repositorio();

  const borrada = await repo.transaccion(() => repo.borrarClase(id));
  if (!borrada) throw new ErrorDeNegocio("Esa clase ya no existe");

  await comprobarYAvisar(borrada.fecha);
  return borrada;
}

import { guardarFacturacionKids as guardarImporteKids } from "./economia";

export interface AvanceFacturacionKids {
  anio: number;
  mes: number;
  sesiones: number;
  importe: number;
  precioResultante: number | null;
}

/**
 * Lo que se guardaría, para poder enseñarlo ANTES de guardarlo.
 *
 * Se niega si ese mes no tiene ninguna clase: no habría entre qué repartir el
 * dinero, y quedaría un importe suelto imposible de convertir en precio por
 * hora. El mensaje explica el porqué, no dice solo que no.
 */
export async function revisarFacturacionKids(
  anio: number,
  mes: number,
  importe: number,
): Promise<AvanceFacturacionKids> {
  const clases = await repositorio().clasesDelMes("kids", anio, mes);

  const motivo = motivoParaNoFacturar(clases.length, importe);
  if (motivo) throw new ErrorDeNegocio(motivo);

  return {
    anio,
    mes,
    sesiones: clases.length,
    importe,
    precioResultante: precioResultante(importe, clases.length),
  };
}

/**
 * Guarda la facturación de un mes de Kids, después de comprobar que se puede.
 *
 * El guardado en sí lo hace `guardarFacturacionKids` de `services/economia`,
 * que ya existía: lo único que se añade aquí es negarse cuando el mes no
 * tiene clases. A partir de ese momento el mes deja de estar provisional y su
 * dinero entra en la Economía; sus horas ya contaban desde antes.
 */
export async function confirmarFacturacionKids(
  anio: number,
  mes: number,
  importe: number,
): Promise<AvanceFacturacionKids> {
  const avance = await revisarFacturacionKids(anio, mes, importe);
  await guardarImporteKids(anio, mes, importe);
  return avance;
}
